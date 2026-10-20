#!/usr/bin/env node
'use strict'
/**
 * 小智工作站 · 自主迭代驱动器（autoloop）
 * ================================================================
 * 定位：Claude Code 是执行者，本驱动器是**监工层**——
 *   注入环境 → 调用 Claude → **独立复验门禁** → 判定通过/失败 → 记录 → 决定是否继续。
 *   不采信执行者的自述，一切以驱动器实测为准。
 *
 * 引擎切换（2026-10-20）：
 *   原引擎 qodercli 需要 QODER_PERSONAL_ACCESS_TOKEN，本机未设置 → 预检必失败、整条自动化线
 *   长期不可用。现改为 claude（@anthropic-ai/claude-code 2.1.304，经 ~/.claude/settings.json
 *   指向 opencode zen 代理，无需交互登录）。可用 --engine qoder 回退到旧引擎。
 *
 * 用法：
 *   node scripts/autoloop.mjs --check                环境预检（零费用，不调用 AI）
 *   node scripts/autoloop.mjs --dry-run              只组装提示词并落盘，不调用 AI
 *   node scripts/autoloop.mjs --rounds 5             连续跑 5 轮（默认 1 轮）
 *   node scripts/autoloop.mjs --gate-only            只跑门禁复验（零费用）
 *   node scripts/autoloop.mjs --verify-state         只校验状态文件口径（零费用，不跑门禁）
 *   node scripts/autoloop.mjs --engine qoder         回退到旧引擎
 *
 * 产物：
 *   docs/evolution/_loop_state.json   状态（轮次/基线/backlog/history）
 *   docs/evolution/_prompt_R{n}.md    每轮实际注入的提示词留档
 *   docs/evolution/_autoloop.log      运行日志
 *   docs/evolution/_STOP.md           异常停机说明
 *
 * 沙箱约束（2026-10-13 实测，勿改）：
 *   1. 必须用异步 spawn + shell:true —— spawnSync 派生 node 进程会 EBUSY。
 *   2. 必须注入 CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD，否则 vite build 清空 dist
 *      会被 safe-delete 拦截（阈值默认 50，dist/assets 有 260+ 文件）。
 *   3. 必须注入 XIAOZHI_AUTOLOOP=1，否则 guard.mjs 的 ask 在无人值守下堵死所有命令。
 *   4. 必须清空 NODE_OPTIONS —— 宿主经它注入 safe-delete 守卫，会把 dev server 打死。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------- 常量
const ROOT = path.resolve(import.meta.dirname, '..')
const PROMPT_FILE = path.join(ROOT, 'Qoder自主迭代提示词-v2.md')
/** Claude 权限配置（白名单 + 红线 deny）；必须走文件，见 claudeArgs() 里的实测教训 */
const CLAUDE_SETTINGS_FILE = path.join(ROOT, 'scripts', 'autoloop-claude-settings.json')
const EVOLUTION_DIR = path.join(ROOT, 'docs', 'evolution')
const STATE_FILE = path.join(EVOLUTION_DIR, '_loop_state.json')
const STOP_FILE = path.join(EVOLUTION_DIR, '_STOP.md')
const RUN_LOG = path.join(EVOLUTION_DIR, '_autoloop.log')

/**
 * 门禁基线（口径约定，2026-10-14 起）——唯一真源是**仓库根命令的实测输出**：
 *   tsc  ：`npx tsc -b` 的 error 数，恒为 0（绝对；不接受「本轮文件 pass / 全仓被在途文件挡」这类豁免口径）
 *   eslint：`npx eslint .`（仓库根，不是 src/ 子集）的 error 数
 * 改基线流程：改 eslint.config.js 忽略项或修代码 → 重跑命令 → 把实测数字写回此处与
 * _loop_state.json.gatesBaseline，两处必须相等（verifyStateIntegrity 会校验）。
 * 实测（2026-10-20 更正）：`npx eslint .` → **116 error / 11 warning**；`npx tsc -b` → 0 error。
 *   上面这条原写 151 error / 19 warning（2026-10-14 的实测），此后 R52 降到 116 但**没同步这里**。
 *   它与 _loop_state.json.eslintBaseline（116）、eslint-budget.json.totals.errors（116）、
 *   根 CLAUDE.md 第 4 条（≤116）三处都不一致 —— 正是 CLAUDE.md 警告过的「151/160/163 三数字并存」
 *   那类口径分裂。本常量只在 defaultState()（状态文件丢失/损坏时的兜底）生效，平时不参与判定，
 *   所以它长期没被发现；但无人值守时状态文件一旦损坏，它会把门禁**放宽 35 个 error** 且不报警。
 */
const ESLINT_BASELINE_FALLBACK = 116
const TSC_BASELINE = 0
const START_ROUND = 34

/** 注入给执行引擎及其所有子进程的环境（见文件头「沙箱约束」） */
const CHILD_ENV = {
  XIAOZHI_AUTOLOOP: '1',
  CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD: '100000',
  // 沙箱约束第 4 条：宿主经 NODE_OPTIONS 注入 safe-delete 守卫，会把 vite dev server 打死
  NODE_OPTIONS: '',
}

/** 执行引擎：claude（默认，本机已配通）| qoder（旧，需 QODER_PERSONAL_ACCESS_TOKEN） */
let ENGINE = 'claude'

const QODER_ARGS = ['-p', '--permission-mode', 'accept_edits', '-o', 'json']
/**
 * Claude Code 参数。
 * 关键教训（2026-10-20 实测）：**权限白名单必须走 --settings 文件，不能用 --allowedTools 命令行**。
 *   驱动器按沙箱约束用 spawn(cmd, args, { shell: true })（spawnSync 会 EBUSY），于是参数被拼成
 *   一条 cmd.exe 命令行；而 `Bash(git status:*)` 里的圆括号与 `*` 是 cmd 元字符，会被吃掉/错拆，
 *   claude 收到畸形参数后**立即 exit=1（0.1s）**，日志看起来像「模型没干活」，实际是传参失败。
 *   放进 JSON 文件后命令行只剩一个普通路径参数，不再有元字符。
 *
 *   -p / --print         非交互，stdin 读提示词、结束即退出
 *   --output-format json 单条 JSON（含 is_error / num_turns / result / permission_denials）
 *   --permission-mode    acceptEdits：允许改文件
 *   --settings           权限白名单 + 红线 deny（见 autoloop-claude-settings.json）
 *   不用 --dangerously-skip-permissions：它会连红线一起放开，白名单更可控。
 */
function claudeArgs() {
  return [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--settings', CLAUDE_SETTINGS_FILE,
    '--add-dir', ROOT,
  ]
}

const MAX_ENGINE_MS = 90 * 60 * 1000 // 单轮执行上限 90 分钟
const MAX_GATE_MS = 30 * 60 * 1000 // 单条门禁上限 30 分钟
const MAX_CONSECUTIVE_FAIL = 2 // 门禁连续失败轮数上限（代码问题），达到即停
/**
 * 引擎未产出的容忍度（2026-10-21 新增）。
 * 事故：R62/R63 上游 API 429「Go usage limit exceeded」，引擎一字未出、工作区未改、四门全绿，
 * 却被计入 MAX_CONSECUTIVE_FAIL 并停机，_STOP.md 还把「四门 PASS」写成停机原因 —— 归因错位。
 * 现在引擎类失败走独立的退避重试通道：每轮之间线性退避，连续 MAX_ENGINE_FAIL 次才停。
 */
const MAX_ENGINE_FAIL = 4 // 引擎连续未产出上限（429/网络/鉴权），达到才停
const ENGINE_BACKOFF_MS = 3 * 60 * 1000 // 引擎类失败的退避基数（×第几次）
const MAX_CONSECUTIVE_EMPTY = 3 // 连续空转（没改任何文件）轮数上限，达到即停

// ---------------------------------------------------------------- 基础工具
function nowIso() {
  return new Date().toISOString()
}

function log(msg) {
  const line = `[${nowIso()}] ${msg}`
  process.stdout.write(line + '\n')
  try {
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
    fs.appendFileSync(RUN_LOG, line + '\n', 'utf8')
  } catch {
    /* 日志写入失败不影响主流程 */
  }
}

function lastLines(text, n) {
  if (!text) return ''
  return text.trim().split(/\r?\n/).slice(-n).join(' | ')
}

/**
 * 执行外部命令并收集输出。
 * 必须异步 spawn + shell:true（见文件头「沙箱约束」第 1 条）。
 *
 * ⚠ 传参纪律（2026-10-20 实测，曾导致每轮成果提交静默丢失）：
 *   shell:true 时 Node 只是把 `cmd + ' ' + args.join(' ')` 原样交给 cmd.exe，**不做任何转义**。
 *   于是任何含空格的参数都会被拆成多个参数，含 ( ) & | < > ^ % ! 的还会被 cmd 当元字符处理。
 *   实测：`git commit -m "chore(loop): R58 驱动器回写状态与日志"`
 *         → git 收到 pathspec 'chore' 'loop:' 'R58' … 并报 "did not match any file(s)"，
 *           exit=1，而驱动器只把它记成「轮末仍有 N 项未提交」不去停轮 —— 结果是**驱动器的
 *           状态回写与日志一条都没入库**，但日志看起来像正常收尾。
 *   修法：这里统一做 Windows 命令行引用（含空格/元字符的参数加双引号并转义内部引号），
 *         同时把整条命令行作为单个字符串交给 shell（不再让 Node 去 join 未转义的 args）。
 *   另：多行/含引号的**文本内容**（如 commit message）优先走 stdin（git commit -F -），
 *       不要硬塞命令行——那是最容易被引用规则反噬的地方。
 */
const CMD_NEEDS_QUOTE = /[\s"&|<>^()%!]/
function quoteWinArg(a) {
  const s = String(a)
  if (!CMD_NEEDS_QUOTE.test(s)) return s
  // cmd.exe：双引号内空格与多数元字符失效；内部双引号用 \" 转义（标准库同款口径）
  return `"${s.replace(/"/g, '\\"')}"`
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let child
    const line = [cmd, ...args.map(quoteWinArg)].join(' ')
    try {
      // 传整条命令行 + shell:true：由 shell 解析，参数已完成引用
      child = spawn(line, {
        cwd: ROOT,
        shell: true,
        env: { ...process.env, ...CHILD_ENV, ...(opts.env || {}) },
        windowsHide: true,
      })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String((err && err.message) || err), ms: 0 })
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })

    const timeoutMs = opts.timeoutMs || MAX_GATE_MS
    const timer = setTimeout(() => {
      log(`[超时] ${cmd} ${args.join(' ')} 超过 ${Math.round(timeoutMs / 1000)}s，强制结束`)
      try { child.kill('SIGKILL') } catch { /* 进程可能已退出 */ }
    }, timeoutMs)

    // 提示词走 stdin（避免超长命令行参数的转义问题）
    try {
      if (typeof opts.stdin === 'string') child.stdin.write(opts.stdin)
      child.stdin.end()
    } catch {
      /* stdin 管道已关闭 */
    }

    const done = (code) => {
      clearTimeout(timer)
      resolve({ code: code == null ? -1 : code, stdout, stderr, ms: Date.now() - started })
    }
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String((err && err.message) || err), ms: Date.now() - started })
    })
    child.on('close', done)
  })
}

// ---------------------------------------------------------------- 状态
function defaultState() {
  return {
    round: START_ROUND,
    lastRound: null,
    eslintBaseline: ESLINT_BASELINE_FALLBACK,
    gatesBaseline: { tsc: TSC_BASELINE, eslint: ESLINT_BASELINE_FALLBACK },
    gates: {},
    backlog: [],
    history: [],
  }
}

function readState() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return defaultState()
  }
  const state = { ...defaultState(), ...parsed }
  // 兼容老状态：只有 eslintBaseline、没有 gatesBaseline 时以 eslintBaseline 为准
  const gb = { ...defaultState().gatesBaseline, ...(parsed.gatesBaseline || {}) }
  if (!parsed.gatesBaseline && typeof parsed.eslintBaseline === 'number') gb.eslint = parsed.eslintBaseline
  state.gatesBaseline = gb
  return state
}

/**
 * 状态文件口径自检（零费用）。核心目的：**禁止「自我豁免」**。
 * 历史教训（R38~R40）：_loop_state.json 里 lastRound.verdict 写 pass，同时 gates.tsc 却写
 * 「本轮文件 pass / 全仓被在途文件挡」——用一个自定义分母把红门说成绿门，驱动器照常判绿。
 * 规则：verdict=pass 时 gates 每一项必须**严格等于字符串 pass**，且四门齐全。
 */
function verifyStateIntegrity(state) {
  const problems = []
  const gb = state.gatesBaseline || {}
  if (typeof gb.tsc !== 'number') problems.push('gatesBaseline.tsc 缺失或非数字')
  if (typeof gb.eslint !== 'number') problems.push('gatesBaseline.eslint 缺失或非数字')
  if (typeof state.eslintBaseline === 'number' && typeof gb.eslint === 'number' && state.eslintBaseline !== gb.eslint) {
    problems.push(`eslintBaseline(${state.eslintBaseline}) 与 gatesBaseline.eslint(${gb.eslint}) 不一致——两处数字必须同源`)
  }
  const verdict = state.lastRound && state.lastRound.verdict
  const gates = state.gates || {}
  const keys = Object.keys(gates)
  if (verdict === 'pass') {
    if (!keys.length) problems.push('lastRound.verdict=pass 但 gates 为空——没有门禁记录就不许判 pass')
    for (const k of keys) {
      if (gates[k] !== 'pass') problems.push(`自我豁免：verdict=pass 但 gates.${k}=${JSON.stringify(gates[k])}`)
    }
    for (const need of ['tsc', 'build', 'vitest', 'eslint']) {
      if (!(need in gates)) problems.push(`自我豁免：verdict=pass 但 gates 缺 ${need} 项`)
    }
  }
  return problems
}

function writeState(state) {
  fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/**
 * 轮末提交驱动器产物（状态 / 轮报 / 日志），保持工作区干净——否则下一轮开工时
 * 状态文件恒为「已修改」，既污染 git 又让执行引擎的「开工先看 git status」失去意义。
 * add docs/evolution 与 .loop；若仍有其它未提交改动（说明执行引擎未按 §6 提交完），只告警不代提，并把路径写回 state.leftover。
 *
 * ⚠ 关于 `_prompt_R{n}.md` 的「永远剩 1 项」现象（2026-10-21 查清）：
 *   每轮开头驱动器写 `_prompt_R{当前轮}.md` 留档，**随后**才调执行引擎；引擎收尾时
 *   按 §6 自己 `git add -A` 提交，于是它提交进去的是**本轮**的 prompt（R62 提交里就带着
 *   `_prompt_R60.md`）。等驱动器再提交时，工作区里已多出**下一轮**刚写的 prompt，
 *   而那个文件属于下一轮，本就不该塞进本轮的 chore(loop) 提交。
 *   结论：这不是缺陷，是「留档先于执行」的必然结果；原日志文案会误导成「引擎没提交完」，
 *   故 leftover 只报**非 _prompt_** 的项，_prompt 残留单独降级为 debug 级说明。
 */
async function commitArtifacts(roundId) {
  await run('git', ['add', 'docs/evolution'], { timeoutMs: 60000 })
  await run('git', ['add', '.loop'], { timeoutMs: 60000 })
  const staged = await run('git', ['status', '--porcelain'], { timeoutMs: 60000 })
  if (!staged.stdout.trim()) return { committed: false, leftover: 0, leftoverPaths: [] }
  // commit message 走 stdin（-F -）：多行/含中文/含括号的文案不经过命令行，
  // 免遭 shell 引用规则反噬（见 run() 的「传参纪律」）
  const msg = `chore(loop): ${roundId} 驱动器回写状态与日志\n`
  const c = await run('git', ['commit', '-q', '-F', '-'], { stdin: msg, timeoutMs: 60000 })
  if (c.code !== 0) {
    log(`⚠ 驱动器产物提交失败（exit=${c.code}）：${lastLines(c.stderr || c.stdout, 3)}`)
  }
  const after = await run('git', ['status', '--porcelain'], { timeoutMs: 60000 })
  const allLeft = after.stdout.trim() ? after.stdout.trim().split(/\r?\n/) : []
  // 下一轮的提示词留档不算「引擎漏提交」（见函数头说明）
  const leftoverPaths = allLeft.filter((l) => !/_prompt_R\d+\.md/.test(l))
  const promptOnly = allLeft.filter((l) => /_prompt_R\d+\.md/.test(l))
  if (promptOnly.length) {
    log(`  （另有 ${promptOnly.length} 项下一轮提示词留档待下轮提交，属正常）`)
  }
  if (leftoverPaths.length) {
    log(`⚠ 轮末仍有 ${leftoverPaths.length} 项未提交（非驱动器产物；执行引擎可能未按 §6 提交，留人工核查）：`)
    leftoverPaths.slice(0, 10).forEach((l) => log(`    ${l}`))
  }
  return { committed: c.code === 0, leftover: leftoverPaths.length, leftoverPaths }
}

// ---------------------------------------------------------------- 提示词组装
function loadPromptTemplate() {
  const raw = fs.readFileSync(PROMPT_FILE, 'utf8')
  const beginTag = '<!-- PROMPT-BEGIN -->'
  const endTag = '<!-- PROMPT-END -->'
  const begin = raw.indexOf(beginTag)
  const end = raw.indexOf(endTag)
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error(`提示词文件缺少 ${beginTag} / ${endTag} 标记：${PROMPT_FILE}`)
  }
  return raw.slice(begin + beginTag.length, end).trim()
}

async function gitStatusPorcelain() {
  const r = await run('git', ['status', '--porcelain'], { timeoutMs: 60000 })
  return r.stdout.trim()
}

/**
 * 截断长文本到 n 字符（用于把上轮 theme 这类数千字的自述压成一句摘要）。
 * 历史 theme 动辄 3000-4000 字，原样注入会让每轮提示词的「上下文」压过「任务规则」，
 * 且挤占可用的决策注意力。只保留开头 + 明确标注被截断（不假装完整）。
 */
function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length <= n ? s : `${s.slice(0, n)}…（截断，全文见轮报）`
}

/** 组装本轮要注入的完整提示词 = 模板正文 + 驱动器动态上下文 */
async function buildPrompt(state, seq, total) {
  const template = loadPromptTemplate()
  let dirty = ''
  try { dirty = await gitStatusPorcelain() } catch { dirty = '' }
  const dirtyCount = dirty ? dirty.split(/\r?\n/).length : 0

  // backlog：只给「未完成的高优先级」前 3 条，标题截断。原实现取前 5 条全文，
  // 单条 title 就上千字，注入后大部分内容与「本轮做什么」无关。
  const openBacklog = (state.backlog || [])
    .filter((b) => !/【.*已完成.*】|可结/.test(b.title || ''))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 }
      return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)
    })
  const backlogText = openBacklog.length
    ? openBacklog.slice(0, 3).map((b) => `- ${b.id}（${b.priority || 'n/a'}）：${clip(b.title, 160)}`).join('\n')
    : '- （空 —— 请从最近轮报、对标清单或实测缺陷中自行选题）'

  const ctx = [
    '',
    '---',
    '## 【驱动器注入 · 本轮动态上下文】',
    '',
    `- 轮次：**R${state.round}**（本次运行第 ${seq}/${total} 轮）`,
    `- 工作区未提交改动：${dirtyCount} 项${dirtyCount ? '（开工前按 §1 第 4 条处理：与本轮无关的先提交或回滚）' : '（干净）'}`,
    `- 门禁基线（全仓口径）：tsc **≤${state.gatesBaseline.tsc} error**（绝对）/ eslint **≤${state.gatesBaseline.eslint} error**`,
    '- 判绿规则：verdict 写 pass 时 gates 每一项必须严格等于 pass（字符串）；写「本轮文件 pass / 全仓被在途文件挡」这类豁免口径会被 --verify-state 判为自我豁免并停机',
    `- 上轮结论：${state.lastRound ? `${state.lastRound.id}（${state.lastRound.verdict}）· ${clip(state.lastRound.theme, 300)}` : '（无，可能是首轮）'}`,
    '',
    `- 待办候选（按优先级，标题已截断；完整内容读 \`docs/evolution/_loop_state.json\`）：`,
    backlogText,
    ...(state.focus
      ? [
          '',
          `- **本轮专项（必须做，优先级高于 §2 的 P1/P2）**：${state.focus}`,
          '  若专项确实做不了（依赖缺失/前提不成立），先做 P1 并在轮报里写清为什么专项没做。',
        ]
      : []),
    '',
    '**严格要求**：按 §4 跑完四门并把**真实输出**写进轮报；按 §6 做齐三件收尾（轮报 + 状态 + commit）。',
  ].join('\n')

  return template + '\n' + ctx
}

// ---------------------------------------------------------------- 执行引擎调用
/**
 * 解析引擎输出里的结果对象。
 *   claude --output-format json：stdout 就是**一个**完整 JSON 对象（不是逐行流），
 *     字段与 qoder 的 result 行高度相似：{ type:"result", is_error, num_turns, result, permission_denials, ... }
 *   qoder -o json：stdout 是逐行流，最后一条 type=result。
 * 两者都按「从后往前找带 { 的行 + 整体 JSON 解析」兜底。
 */
function parseEngineOutput(stdout) {
  const raw = String(stdout || '').trim()
  if (!raw) return null
  // 先按整体 JSON 解析（claude 走这条）
  try {
    const whole = JSON.parse(raw)
    if (whole && (whole.type === 'result' || 'is_error' in whole)) return whole
  } catch {
    /* 不是单体 JSON，退化为逐行扫描 */
  }
  // 再按逐行流从后往前找（qoder 走这条）
  const lines = raw.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const obj = JSON.parse(line)
      if (obj && (obj.type === 'result' || 'is_error' in obj)) return obj
    } catch {
      /* 非 JSON 行，继续向上找 */
    }
  }
  return null
}

/** 调 claude：-p 从 stdin 读提示词，--output-format json 出单条结果 */
async function runClaude(prompt) {
  const r = await run('claude', claudeArgs(), { stdin: prompt, timeoutMs: MAX_ENGINE_MS })
  return { ...r, parsed: parseEngineOutput(r.stdout) }
}

/** 调 qoder（旧引擎，保留回退能力） */
async function runQoder(prompt) {
  const r = await run('qodercli', QODER_ARGS, { stdin: prompt, timeoutMs: MAX_ENGINE_MS })
  return { ...r, parsed: parseEngineOutput(r.stdout) }
}

async function runEngine(prompt) {
  return ENGINE === 'qoder' ? runQoder(prompt) : runClaude(prompt)
}

/** 引擎自述「失败」的判据（claude 与 qoder 同形） */
function engineFailed(q) {
  return !(q.parsed && q.parsed.is_error === false)
}

// ---------------------------------------------------------------- 四门门禁（独立复验）
async function gateTsc() {
  const r = await run('npx', ['tsc', '-b'], { timeoutMs: MAX_GATE_MS })
  const out = (r.stdout + r.stderr).trim()
  const errors = (out.match(/error TS\d+/g) || []).length
  return { name: 'tsc', ok: r.code === 0 && errors === 0, detail: errors ? `${errors} 个 error：${lastLines(out, 2)}` : `0 error / 基线 ${TSC_BASELINE}` }
}

async function gateBuild() {
  const r = await run('npx', ['vite', 'build'], { timeoutMs: MAX_GATE_MS })
  const out = (r.stdout + r.stderr).trim()
  const built = (out.match(/built in [\d.]+s/) || [])[0]
  return { name: 'build', ok: r.code === 0 && /built in/.test(out), detail: built || lastLines(out, 3) }
}

/** 单次 vitest 运行并解析「汇总行」（只看汇总，不看用例内部打印的堆栈） */
async function vitestOnce() {
  const r = await run('npx', ['vitest', 'run'], { timeoutMs: MAX_GATE_MS })
  // 剥离 ANSI 颜色码：vitest 在部分宿主下会着色，导致行首字符匹配失败
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  // 汇总行形如：Tests  2482 passed | 2 skipped (2484)
  // 注意：用例内部会打印 globalErrorCatch 的故意错误堆栈，不可据此判失败。
  const summary = out
    .split(/\r?\n/)
    .find((l) => /\bTests\b/.test(l) && /(passed|failed)/.test(l)) || ''
  const passedNum = Number((summary.match(/(\d+)\s+passed/) || [])[1] || 0)
  const failedNum = Number((summary.match(/(\d+)\s+failed/) || [])[1] || 0)
  const ok = r.code === 0 && (passedNum > 0 || failedNum > 0) && failedNum === 0
  let detail
  if (ok) {
    detail = summary.replace(/\s+/g, ' ').trim()
  } else {
    const failLines = out.split(/\r?\n/).filter((l) => /^\s*(FAIL|×)\s/.test(l)).slice(0, 5)
    detail = failLines.length
      ? failLines.map((l) => l.trim()).join(' | ')
      : `exit=${r.code}；汇总行=${summary ? summary.trim() : '未找到'}`
  }
  return { ok, detail }
}

/**
 * vitest 门禁。e2e 类用例依赖本地服务（PB 7000 / Vite 5173），存在负载抖动；
 * 首次未通过时等待 15s 重试一次，仍失败才判 FAIL —— 避免无人值守时误停。
 */
async function gateVitest() {
  const first = await vitestOnce()
  if (first.ok) return { name: 'vitest', ok: true, detail: first.detail }
  log(`  vitest 首次未通过（${first.detail}），15s 后重试一次…`)
  await new Promise((resolve) => setTimeout(resolve, 15000))
  const second = await vitestOnce()
  return second.ok
    ? { name: 'vitest', ok: true, detail: `${second.detail}（首跑抖动，重试通过）` }
    : { name: 'vitest', ok: false, detail: second.detail }
}

async function gateEslint(baseline) {
  const r = await run('npx', ['eslint', '.', '-f', 'json'], { timeoutMs: MAX_GATE_MS })
  const out = r.stdout || ''
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  let errors = null
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(out.slice(start, end + 1))
      errors = arr.reduce((acc, f) => acc + (f.errorCount || 0), 0)
    } catch {
      errors = null
    }
  }
  const ok = errors != null && errors <= baseline
  return {
    name: 'eslint',
    ok,
    detail: errors == null ? '无法解析 eslint 输出' : `${errors} error / 基线 ${baseline}`,
  }
}

async function runAllGates(baseline) {
  const gates = []
  gates.push(await gateTsc())
  gates.push(await gateBuild())
  gates.push(await gateVitest())
  gates.push(await gateEslint(baseline))
  return gates
}

// ---------------------------------------------------------------- 轮报查找 / 停机
/**
 * 找本轮轮报。
 * 实测教训（2026-10-20）：不能用「开工时的 state.round」去找——执行引擎会在本轮里
 * 自己把 round**推进**（R57 → 写 R58 轮报），于是驱动器按旧编号去找必然扑空，
 * 把一份合格的轮报判成「未找到（异常）」。R57 试跑即因此误判：
 * 实际已产出 R58_20261020.md，驱动器却找 R57_20261016.md（上一轮的旧文件），
 * 阴差阳错「找到了」，判定看着像对、其实是错的。
 * 现在的口径：轮报编号可以是**开工轮次**或**推进后的轮次**（两者都接受），
 * 但必须是**本次运行期间新写入/更新过的文件**（mtime 晚于开工时刻），
 * 防止把上一轮遗留的同名旧轮报当成本轮成果。
 */
function findReport(rounds, sinceMs) {
  try {
    const files = fs.readdirSync(EVOLUTION_DIR)
    const cands = []
    for (const f of files) {
      const m = /^R0*(\d+)[_.].*\.md$/.exec(f)
      if (!m) continue
      const num = Number(m[1])
      if (!rounds.includes(num)) continue
      let mtime = 0
      try { mtime = fs.statSync(path.join(EVOLUTION_DIR, f)).mtimeMs } catch { continue }
      if (sinceMs && mtime < sinceMs) continue
      cands.push({ file: f, num, mtime })
    }
    if (!cands.length) return null
    // 优先最大轮次编号（引擎推进后的那份）
    cands.sort((a, b) => b.num - a.num || b.mtime - a.mtime)
    return cands[0].file
  } catch {
    return null
  }
}

function writeStop(reason, detail) {
  const body = [
    '# 自动迭代已停机',
    '',
    `- 时间：${nowIso()}`,
    `- 原因：${reason}`,
    '',
    '## 详情',
    '',
    detail,
    '',
    '## 需要用户做什么',
    '',
    '请查看本文件与 `docs/evolution/` 下最近轮报，处理后重新启动驱动器（`node scripts/autoloop.mjs --rounds N`）。',
    '',
  ].join('\n')
  try {
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
    fs.writeFileSync(STOP_FILE, body, 'utf8')
    log(`已写停机说明：${STOP_FILE}`)
  } catch (err) {
    log(`写停机说明失败：${(err && err.message) || err}`)
  }
}

// ---------------------------------------------------------------- 预检
async function preflight() {
  const problems = []
  if (!fs.existsSync(PROMPT_FILE)) problems.push(`提示词文件不存在：${PROMPT_FILE}`)

  if (ENGINE === 'qoder') {
    const v = await run('qodercli', ['--version'], { timeoutMs: 60000 })
    if (v.code !== 0) problems.push('qodercli 不可用（command not found 或启动失败）')
    else log(`qodercli 版本：${v.stdout.trim()}`)
    if (!process.env.QODER_PERSONAL_ACCESS_TOKEN) {
      problems.push('环境变量 QODER_PERSONAL_ACCESS_TOKEN 未设置（headless 登录需要它）')
    }
    return problems
  }

  // claude：只要 --version 通就说明二进制与鉴权配置（~/.claude/settings.json）在位
  const v = await run('claude', ['--version'], { timeoutMs: 60000 })
  if (v.code !== 0) {
    problems.push(`claude 不可用（command not found 或启动失败）：${lastLines(v.stderr, 2)}`)
  } else {
    log(`claude 版本：${v.stdout.trim()}`)
  }
  // 代理配置检查（只报事实，不打印密钥）
  const cfg = path.join(process.env.USERPROFILE || '', '.claude', 'settings.json')
  if (!fs.existsSync(cfg)) {
    problems.push(`未找到 claude 配置：${cfg}（需要 ANTHROPIC_BASE_URL / API_KEY 才能免交互调用）`)
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'))
      const env = j.env || {}
      if (!env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_BASE_URL) {
        problems.push('claude 未配置 ANTHROPIC_BASE_URL（直连官方会缺鉴权）')
      }
      if (!env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_AUTH_TOKEN) {
        problems.push('claude 未配置 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN')
      }
      log(`claude 端点：${env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL}；模型：${env.ANTHROPIC_MODEL || '(默认)'}`)
    } catch (err) {
      problems.push(`claude 配置解析失败：${(err && err.message) || err}`)
    }
  }
  return problems
}

// ---------------------------------------------------------------- 模式：--check
async function doCheck() {
  log('=== 环境预检（零费用） ===')
  const problems = await preflight()
  const state = readState()
  log(`状态文件：轮次 R${state.round}，门禁基线 tsc≤${state.gatesBaseline.tsc} / eslint≤${state.gatesBaseline.eslint}，backlog ${state.backlog.length} 项`)
  verifyStateIntegrity(state).forEach((p) => problems.push(`[状态口径] ${p}`))
  const dirty = await gitStatusPorcelain()
  const dirtyCount = dirty ? dirty.split(/\r?\n/).length : 0
  log(`工作区未提交改动：${dirtyCount} 项`)
  if (problems.length) {
    problems.forEach((p) => log(`✗ ${p}`))
    log('预检未通过，请先解决上述问题。')
    return 1
  }
  log('✓ 预检通过，可以启动迭代。')
  return 0
}

// ---------------------------------------------------------------- 模式：--dry-run
async function doDryRun(rounds) {
  const state = readState()
  const prompt = await buildPrompt(state, 1, rounds)
  fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
  const p = path.join(EVOLUTION_DIR, `_prompt_R${state.round}.md`)
  fs.writeFileSync(p, prompt, 'utf8')
  log(`[dry-run] 提示词已落盘：${p}（${prompt.length} 字符），未调用 AI。`)
  return 0
}

// ---------------------------------------------------------------- 模式：--gate-only
async function doGateOnly() {
  const state = readState()
  log('=== 只跑门禁复验（零费用） ===')
  const gates = await runAllGates(state.gatesBaseline.eslint)
  gates.forEach((g) => log(`  门禁 ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`))
  return gates.every((g) => g.ok) ? 0 : 1
}

// ---------------------------------------------------------------- 模式：--verify-state
async function doVerifyState() {
  log('=== 状态文件口径自检（零费用，不跑门禁） ===')
  const state = readState()
  log(`轮次 R${state.round}；lastRound=${state.lastRound ? `${state.lastRound.id}/${state.lastRound.verdict}` : '（无）'}`)
  log(`门禁记录：${JSON.stringify(state.gates || {})}`)
  log(`门禁基线：tsc≤${state.gatesBaseline.tsc} / eslint≤${state.gatesBaseline.eslint}`)
  const problems = verifyStateIntegrity(state)
  if (problems.length) {
    problems.forEach((p) => log(`✗ ${p}`))
    log('状态口径不合法——请按门禁实测数字修正 _loop_state.json 后再启动迭代。')
    return 1
  }
  log('✓ 状态口径合法（无自我豁免、基线同源）。')
  return 0
}

// ---------------------------------------------------------------- 主流程：多轮迭代
async function doRun(rounds) {
  const problems = await preflight()
  if (problems.length) {
    problems.forEach((p) => log(`✗ ${p}`))
    writeStop('环境预检未通过', problems.map((p) => `- ${p}`).join('\n'))
    return 1
  }

  let consecutiveFail = 0 // 门禁类失败（引擎有产出但代码红）
  let consecutiveEngineFail = 0 // 引擎类失败（429/网络/鉴权，引擎根本没产出）
  for (let seq = 1; seq <= rounds; seq++) {
    const state = readState()
    log(`═══════════ 第 ${seq}/${rounds} 轮 · R${state.round} ═══════════`)

    // 0) 状态口径自检：上一轮若以豁免口径判绿，立即停机——不带着假绿继续跑
    const stateProblems = verifyStateIntegrity(state)
    if (stateProblems.length) {
      stateProblems.forEach((p) => log(`✗ [状态口径] ${p}`))
      writeStop('状态文件口径不合法（疑似自我豁免）', stateProblems.map((p) => `- ${p}`).join('\n'))
      return 1
    }

    // 1) 组装并留档提示词
    const prompt = await buildPrompt(state, seq, rounds)
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
    const promptPath = path.join(EVOLUTION_DIR, `_prompt_R${state.round}.md`)
    fs.writeFileSync(promptPath, prompt, 'utf8')
    log(`提示词已留档：${promptPath}（${prompt.length} 字符）`)

    // 2) 调用执行引擎
    log(`调用 ${ENGINE}（headless，可能数十分钟）…`)
    const t0 = Date.now()
    const q = await runEngine(prompt)
    const durSec = Math.round((Date.now() - t0) / 1000)
    const engineOk = !engineFailed(q)
    log(`${ENGINE} 返回：exit=${q.code} is_error=${q.parsed ? q.parsed.is_error : 'n/a'} turns=${q.parsed ? q.parsed.num_turns : '?'} 用时=${durSec}s`)
    if (q.parsed && q.parsed.result) log(`${ENGINE} 结语：${String(q.parsed.result).slice(0, 400)}`)
    if (q.parsed && Array.isArray(q.parsed.permission_denials) && q.parsed.permission_denials.length) {
      log(`⚠ 权限被拒 ${q.parsed.permission_denials.length} 次（可能命中守卫红线）`)
    }

    // 3) 独立复验（不采信自述）
    log('独立复验四门…')
    const gates = await runAllGates(state.gatesBaseline.eslint)
    gates.forEach((g) => log(`  门禁 ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`))

    // 轮报编号：执行引擎通常会在本轮把 round 推进（R57→写 R58），所以开环/闭环两个编号都接受，
    // 但必须是本次运行期间**新写入**的文件（mtime >= 开工时刻），不能把旧轮报当本轮成果。
    const closedState = readState()
    const reportRounds = [...new Set([state.round, closedState.round])]
    const report = findReport(reportRounds, t0)
    log(`轮报：${report || '未找到（异常）'}（接受编号 ${reportRounds.map((r) => `R${r}`).join(' / ')}，要求本次运行期间写入）`)

    // ── 区分「引擎没干活」与「引擎干了但门禁红」 ──────────────────────────
    // 实测事故（2026-10-21 R62/R63）：上游 API 429（Go usage limit exceeded），引擎根本没产出；
    // 四门却全 PASS（工作区没被改）。旧逻辑把两者混在一个 consecutiveFail 里，
    // 于是「配额耗尽」被记成「门禁连续 2 轮不通过」并停机，_STOP.md 里写的四门结果还全是 PASS
    // —— 归因完全错位，会把人引去查代码。
    const gatesOk = gates.every((g) => g.ok)
    const engineNoWork = !engineOk
    const allOk = q.code === 0 && engineOk && gatesOk && !!report
    if (allOk) {
      log('本轮判定：PASS')
    } else if (engineNoWork) {
      log(`本轮判定：ENGINE_FAIL（引擎未产出；四门${gatesOk ? '仍全绿' : '有红'}）`)
    } else if (!gatesOk) {
      log('本轮判定：GATE_FAIL（引擎有产出但门禁不通过）')
    } else {
      log('本轮判定：FAIL（引擎与门禁均无异常，但缺轮报等收尾产物）')
    }

    // 4) 回写状态（执行引擎未推进轮次时由驱动器兜底推进）
    const after = readState()
    after.gates = Object.fromEntries(gates.map((g) => [g.name, g.ok ? 'pass' : 'fail']))
    // 门禁基线与门禁结果同批回写，保证「数字」与「结论」出自同一次实测
    after.gatesBaseline = { tsc: TSC_BASELINE, eslint: state.gatesBaseline.eslint }
    after.eslintBaseline = state.gatesBaseline.eslint

    // 本轮轮次编号：引擎成功产出时通常自己推进（round 从 state.round → +1），以它为准；
    // 引擎未产出时不推进，编号沿用开环轮次（仅供停机文案引用）。
    const advanced = after.round > state.round
    const roundId = advanced ? after.round : state.round

    // 引擎类失败（429/网络/鉴权）：**不推进轮次、不写 lastRound、不记 history**。
    // 理由：这一轮什么都没发生，工作区与上一轮 PASS 后完全一致；若照样 +1 并写 fail，
    // 账本会出现「R63 fail / 四门全 PASS」这种自相矛盾的条目（正是 R62/R63 的实况），
    // 且把轮次号白送给一次没执行的运行。这里只记一条 engineFail 事件供事后审计。
    if (engineNoWork) {
      after.engineFail = {
        at: nowIso(),
        engine: ENGINE,
        exit: q.code,
        isError: q.parsed ? q.parsed.is_error : null,
        message: String((q.parsed && q.parsed.result) || q.stderr || '').trim().slice(0, 300),
        consecutive: consecutiveEngineFail,
      }
      writeState(after)
      log('本轮未推进轮次、未写 lastRound（引擎未产出，账本保持上一轮 PASS 状态）')
    } else {
      // 本轮实际产出的轮次编号见上方 roundId 定义（引擎自己推进则用它，否则用开环轮次）

      // 旧实现一律用 state.round（开环轮次）写 lastRound.id，会与引擎写下的 history 头部脱节
      // （R58 试跑即出现：history 记 R058 已完成，lastRound.id 却写 R57）。
      if (!advanced) {
        log(`注意：执行引擎未推进轮次（仍为 ${after.round}），驱动器代为 +1`)
        after.round = state.round + 1
        after.history = [...(after.history || []), {
          id: `R${state.round}`, theme: '(驱动器兜底推进)', verdict: allOk ? 'pass' : 'fail',
          at: new Date().toISOString().slice(0, 10),
        }]
      }
      // lastRound：以引擎写下的 theme 为内容，但 id/verdict 用驱动器**实测**结论覆盖
      after.lastRound = {
        id: `R${roundId}`,
        theme: (after.lastRound && after.lastRound.theme) || '(未记录)',
        verdict: allOk ? 'pass' : 'fail',
      }
      writeState(after)

      // 4b) 提交驱动器产物，保持工作区干净（否则下一轮开工恒为「1 项未提交」）
      const ci = await commitArtifacts(`R${roundId}`)
      if (ci.leftover) {
        const st = readState()
        st.leftover = { at: nowIso(), count: ci.leftover, paths: ci.leftoverPaths.slice(0, 20) }
        writeState(st)
      }
      if (ci.committed) log(`已提交驱动器产物（R${roundId}），工作区剩余未提交：${ci.leftover}`)
    }

    // 5) 失败计数与停机——**按成因分开计**（2026-10-21 修：原来混用一个计数器会误诊）
    //    · GATE_FAIL：引擎有产出但门禁红 → 这是代码问题，连续 2 轮即停（原语义，保留）
    //    · ENGINE_FAIL：引擎没产出（429 配额 / 网络 / 鉴权）→ 与代码无关，改走「退避重试」，
    //      连续 MAX_ENGINE_FAIL 轮才停，且停机文案明确指向上游而非门禁。
    if (allOk) {
      consecutiveFail = 0
      consecutiveEngineFail = 0
    } else if (engineNoWork) {
      consecutiveEngineFail++
      consecutiveFail = 0 // 引擎没干活不代表代码坏了，不累加门禁失败
      const summary = String((q.parsed && q.parsed.result) || q.stderr || '').trim().slice(0, 200)
      if (consecutiveEngineFail >= MAX_ENGINE_FAIL) {
        writeStop(
          `执行引擎连续 ${MAX_ENGINE_FAIL} 轮未产出（上游 API/网络问题，非代码缺陷）`,
          [
            `最后一轮 R${roundId}，用时 ${durSec}s。`,
            '',
            `引擎返回：exit=${q.code} is_error=${q.parsed ? q.parsed.is_error : 'n/a'}`,
            `引擎消息：${summary || '(空)'}`,
            '',
            '四门结果（工作区未被改动，因此**全绿不代表本轮做了什么**）：',
            ...gates.map((g) => `- ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`),
            '',
            '## 判断指引',
            '',
            '若引擎消息含 429 / usage limit / quota，属上游额度耗尽：等额度恢复后直接重启驱动器即可，**不需要改代码**。',
            '若为鉴权失败，检查 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL 与密钥。',
          ].join('\n'),
        )
        log(`引擎连续 ${MAX_ENGINE_FAIL} 轮未产出，停机（非门禁问题）。`)
        break
      }
      const waitMs = ENGINE_BACKOFF_MS * consecutiveEngineFail
      log(`引擎未产出（第 ${consecutiveEngineFail}/${MAX_ENGINE_FAIL} 次），${Math.round(waitMs / 1000)}s 后重试本轮…`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    } else {
      consecutiveFail++
      consecutiveEngineFail = 0
      if (consecutiveFail >= MAX_CONSECUTIVE_FAIL) {
        writeStop(
          consecutiveFail ? `门禁连续 ${MAX_CONSECUTIVE_FAIL} 轮不通过` : '本轮失败',
          `最后一轮 R${roundId}，用时 ${durSec}s。\n\n门禁结果：\n${gates.map((g) => `- ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`).join('\n')}`,
        )
        log(`连续 ${MAX_CONSECUTIVE_FAIL} 轮失败，停机。`)
        break
      }
    }
  }
  log('驱动器运行结束。')
  return 0
}

// ---------------------------------------------------------------- 入口
function parseArgs(argv) {
  const out = { rounds: 1, check: false, dryRun: false, gateOnly: false, verifyState: false, help: false, engine: 'claude' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--rounds' || a === '-r') out.rounds = Math.max(1, Number(argv[++i]) || 1)
    else if (a === '--engine' || a === '-e') out.engine = String(argv[++i] || 'claude').toLowerCase()
    else if (a === '--check') out.check = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--gate-only') out.gateOnly = true
    else if (a === '--verify-state') out.verifyState = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  if (out.engine !== 'claude' && out.engine !== 'qoder') out.engine = 'claude'
  return out
}

function printHelp() {
  process.stdout.write([
    '小智工作站 · 自主迭代驱动器',
    '',
    '  node scripts/autoloop.mjs --check              环境预检（零费用）',
    '  node scripts/autoloop.mjs --dry-run            组装提示词落盘，不调用 AI',
    '  node scripts/autoloop.mjs --gate-only          只跑四门门禁复验（零费用）',
    '  node scripts/autoloop.mjs --verify-state       只校验状态文件口径（零费用）',
    '  node scripts/autoloop.mjs --rounds 5           连续跑 5 轮',
    '  node scripts/autoloop.mjs --engine qoder       回退到旧引擎（默认 claude）',
    '',
    `  提示词：${PROMPT_FILE}`,
    `  状态：  ${STATE_FILE}`,
    '',
  ].join('\n'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ENGINE = args.engine
  if (args.help) { printHelp(); return 0 }
  if (args.check) return doCheck()
  if (args.gateOnly) return doGateOnly()
  if (args.verifyState) return doVerifyState()
  if (args.dryRun) return doDryRun(args.rounds)
  return doRun(args.rounds)
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    log(`驱动器异常：${(err && err.stack) || err}`)
    process.exit(2)
  })
