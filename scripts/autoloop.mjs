#!/usr/bin/env node
'use strict'
/**
 * 小智工作站 · Qoder 自主迭代驱动器（autoloop）
 * ================================================================
 * 定位：Qoder 是执行者，本驱动器是**监工层**——
 *   注入环境 → 调用 Qoder → **独立复验门禁** → 判定通过/失败 → 记录 → 决定是否继续。
 *   不采信 Qoder 的自述，一切以驱动器实测为准。
 *
 * 用法：
 *   node scripts/autoloop.mjs --check                环境预检（零费用，不调用 AI）
 *   node scripts/autoloop.mjs --dry-run              只组装提示词并落盘，不调用 AI
 *   node scripts/autoloop.mjs --rounds 5             连续跑 5 轮（默认 1 轮）
 *   node scripts/autoloop.mjs --gate-only            只跑门禁复验（零费用）
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
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------- 常量
const ROOT = path.resolve(import.meta.dirname, '..')
const PROMPT_FILE = path.join(ROOT, 'Qoder自主迭代提示词-v2.md')
const EVOLUTION_DIR = path.join(ROOT, 'docs', 'evolution')
const STATE_FILE = path.join(EVOLUTION_DIR, '_loop_state.json')
const STOP_FILE = path.join(EVOLUTION_DIR, '_STOP.md')
const RUN_LOG = path.join(EVOLUTION_DIR, '_autoloop.log')

const ESLINT_BASELINE_FALLBACK = 160
const START_ROUND = 34

/** 注入给 Qoder 及其所有子进程的环境（见文件头「沙箱约束」） */
const CHILD_ENV = {
  XIAOZHI_AUTOLOOP: '1',
  CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD: '100000',
}

const QODER_ARGS = ['-p', '--permission-mode', 'accept_edits', '-o', 'json']
const MAX_QODER_MS = 90 * 60 * 1000 // 单轮 Qoder 上限 90 分钟
const MAX_GATE_MS = 30 * 60 * 1000 // 单条门禁上限 30 分钟
const MAX_CONSECUTIVE_FAIL = 2 // 连续失败轮数上限，达到即停

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
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let child
    try {
      child = spawn(cmd, args, {
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
    gates: {},
    backlog: [],
    history: [],
  }
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return { ...defaultState(), ...parsed }
  } catch {
    return defaultState()
  }
}

function writeState(state) {
  fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/**
 * 轮末提交驱动器产物（状态 / 轮报 / 日志），保持工作区干净——否则下一轮开工时
 * 状态文件恒为「已修改」，既污染 git 又让 Qoder 的「开工先看 git status」失去意义。
 * 只 add docs/evolution；若仍有其它未提交改动（说明 Qoder 未按 §6 提交完），只告警不代提。
 */
async function commitArtifacts(roundId) {
  await run('git', ['add', 'docs/evolution'], { timeoutMs: 60000 })
  const staged = await run('git', ['status', '--porcelain'], { timeoutMs: 60000 })
  if (!staged.stdout.trim()) return { committed: false, leftover: 0 }
  const c = await run('git', ['commit', '-q', '-m', `chore(loop): ${roundId} 驱动器回写状态与日志`], { timeoutMs: 60000 })
  const after = await run('git', ['status', '--porcelain'], { timeoutMs: 60000 })
  const leftover = after.stdout.trim() ? after.stdout.trim().split(/\r?\n/).length : 0
  if (leftover) log(`⚠ 轮末仍有 ${leftover} 项未提交（非 docs/evolution；Qoder 可能未按 §6 提交，留人工核查）`)
  return { committed: c.code === 0, leftover }
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

/** 组装本轮要注入的完整提示词 = 模板正文 + 驱动器动态上下文 */
async function buildPrompt(state, seq, total) {
  const template = loadPromptTemplate()
  let dirty = ''
  try { dirty = await gitStatusPorcelain() } catch { dirty = '' }
  const dirtyCount = dirty ? dirty.split(/\r?\n/).length : 0

  const backlogText = state.backlog && state.backlog.length
    ? state.backlog.slice(0, 5).map((b) => `${b.id}:${b.title}(${b.priority || 'n/a'})`).join(' / ')
    : '（空 —— 请从最近轮报、对标清单或实测缺陷中自行选题）'

  const ctx = [
    '',
    '---',
    '## 【驱动器注入 · 本轮动态上下文】',
    '',
    `- 轮次：**R${state.round}**（本次运行第 ${seq}/${total} 轮）`,
    `- 工作区未提交改动：${dirtyCount} 项${dirtyCount ? '（开工前按 §1 第 4 条处理：与本轮无关的先提交或回滚）' : '（干净）'}`,
    `- eslint 基线：**${state.eslintBaseline}**（本轮结束不得高于此数）`,
    `- 上轮结论：${state.lastRound ? `${state.lastRound.id} · ${state.lastRound.theme} · ${state.lastRound.verdict}` : '（无，可能是首轮）'}`,
    `- backlog 当前项：${backlogText}`,
    ...(state.focus
      ? [
          '',
          `- **本轮专项（必须做，优先级高于 §2 的 P1/P2）**：${state.focus}`,
          '  若专项确实做不了（依赖缺失/前提前提不成立），先做 P1 并在轮报里写清为什么专项没做。',
        ]
      : []),
    '',
    '**严格要求**：按 §4 跑完四门并把**真实输出**写进轮报；按 §6 做齐三件收尾（轮报 + 状态 + commit）。',
  ].join('\n')

  return template + '\n' + ctx
}

// ---------------------------------------------------------------- Qoder 调用
function parseQoderOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const obj = JSON.parse(line)
      if (obj && obj.type === 'result') return obj
    } catch {
      /* 非 JSON 行，继续向上找 */
    }
  }
  return null
}

async function runQoder(prompt) {
  const r = await run('qodercli', QODER_ARGS, { stdin: prompt, timeoutMs: MAX_QODER_MS })
  return { ...r, parsed: parseQoderOutput(r.stdout) }
}

// ---------------------------------------------------------------- 四门门禁（独立复验）
async function gateTsc() {
  const r = await run('npx', ['tsc', '-b'], { timeoutMs: MAX_GATE_MS })
  const out = (r.stdout + r.stderr).trim()
  const errors = (out.match(/error TS\d+/g) || []).length
  return { name: 'tsc', ok: r.code === 0 && errors === 0, detail: errors ? `${errors} 个 error：${lastLines(out, 2)}` : '0 error' }
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
function findReport(round) {
  try {
    const files = fs.readdirSync(EVOLUTION_DIR)
    const re = new RegExp(`^R0*${round}[_.]`)
    return files.find((f) => re.test(f)) || null
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
  const v = await run('qodercli', ['--version'], { timeoutMs: 60000 })
  if (v.code !== 0) problems.push('qodercli 不可用（command not found 或启动失败）')
  else log(`qodercli 版本：${v.stdout.trim()}`)

  if (!process.env.QODER_PERSONAL_ACCESS_TOKEN) {
    problems.push('环境变量 QODER_PERSONAL_ACCESS_TOKEN 未设置（headless 登录需要它）')
  }
  if (!fs.existsSync(PROMPT_FILE)) problems.push(`提示词文件不存在：${PROMPT_FILE}`)
  return problems
}

// ---------------------------------------------------------------- 模式：--check
async function doCheck() {
  log('=== 环境预检（零费用） ===')
  const problems = await preflight()
  const state = readState()
  log(`状态文件：轮次 R${state.round}，eslint 基线 ${state.eslintBaseline}，backlog ${state.backlog.length} 项`)
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
  const gates = await runAllGates(state.eslintBaseline)
  gates.forEach((g) => log(`  门禁 ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`))
  return gates.every((g) => g.ok) ? 0 : 1
}

// ---------------------------------------------------------------- 主流程：多轮迭代
async function doRun(rounds) {
  const problems = await preflight()
  if (problems.length) {
    problems.forEach((p) => log(`✗ ${p}`))
    writeStop('环境预检未通过', problems.map((p) => `- ${p}`).join('\n'))
    return 1
  }

  let consecutiveFail = 0
  for (let seq = 1; seq <= rounds; seq++) {
    const state = readState()
    log(`═══════════ 第 ${seq}/${rounds} 轮 · R${state.round} ═══════════`)

    // 1) 组装并留档提示词
    const prompt = await buildPrompt(state, seq, rounds)
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true })
    const promptPath = path.join(EVOLUTION_DIR, `_prompt_R${state.round}.md`)
    fs.writeFileSync(promptPath, prompt, 'utf8')
    log(`提示词已留档：${promptPath}（${prompt.length} 字符）`)

    // 2) 调用 Qoder
    log('调用 Qoder（headless，可能数十分钟）…')
    const t0 = Date.now()
    const q = await runQoder(prompt)
    const durSec = Math.round((Date.now() - t0) / 1000)
    const qoderOk = !!(q.parsed && q.parsed.is_error === false)
    log(`Qoder 返回：exit=${q.code} is_error=${q.parsed ? q.parsed.is_error : 'n/a'} turns=${q.parsed ? q.parsed.num_turns : '?'} 用时=${durSec}s`)
    if (q.parsed && q.parsed.result) log(`Qoder 结语：${String(q.parsed.result).slice(0, 400)}`)
    if (q.parsed && Array.isArray(q.parsed.permission_denials) && q.parsed.permission_denials.length) {
      log(`⚠ 权限被拒 ${q.parsed.permission_denials.length} 次（可能命中守卫红线）`)
    }

    // 3) 独立复验（不采信自述）
    log('独立复验四门…')
    const gates = await runAllGates(state.eslintBaseline)
    gates.forEach((g) => log(`  门禁 ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`))
    const report = findReport(state.round)
    log(`轮报：${report || '未找到（异常）'}`)

    const allOk = q.code === 0 && qoderOk && gates.every((g) => g.ok) && !!report
    log(`本轮判定：${allOk ? 'PASS' : 'FAIL'}`)

    // 4) 回写状态（Qoder 未推进轮次时由驱动器兜底推进）
    const after = readState()
    after.gates = Object.fromEntries(gates.map((g) => [g.name, g.ok ? 'pass' : 'fail']))
    if (after.round <= state.round) {
      log(`注意：Qoder 未推进轮次（仍为 ${after.round}），驱动器代为 +1`)
      after.round = state.round + 1
      after.history = [...(after.history || []), {
        id: `R${state.round}`, theme: '(驱动器兜底推进)', verdict: allOk ? 'pass' : 'fail',
        at: new Date().toISOString().slice(0, 10),
      }]
    }
    after.lastRound = {
      id: `R${state.round}`,
      theme: (after.lastRound && after.lastRound.theme) || '(未记录)',
      verdict: allOk ? 'pass' : 'fail',
    }
    writeState(after)

    // 4b) 提交驱动器产物，保持工作区干净（否则下一轮开工恒为「1 项未提交」）
    const ci = await commitArtifacts(`R${state.round}`)
    if (ci.committed) log(`已提交驱动器产物（R${state.round}），工作区剩余未提交：${ci.leftover}`)

    // 5) 失败计数与停机
    if (!allOk) {
      consecutiveFail++
      if (consecutiveFail >= MAX_CONSECUTIVE_FAIL) {
        writeStop(
          `门禁连续 ${MAX_CONSECUTIVE_FAIL} 轮不通过`,
          `最后一轮 R${state.round}，用时 ${durSec}s。\n\n门禁结果：\n${gates.map((g) => `- ${g.name}: ${g.ok ? 'PASS' : 'FAIL'} — ${g.detail}`).join('\n')}`,
        )
        log(`连续 ${MAX_CONSECUTIVE_FAIL} 轮失败，停机。`)
        break
      }
    } else {
      consecutiveFail = 0
    }
  }
  log('驱动器运行结束。')
  return 0
}

// ---------------------------------------------------------------- 入口
function parseArgs(argv) {
  const out = { rounds: 1, check: false, dryRun: false, gateOnly: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--rounds' || a === '-r') out.rounds = Math.max(1, Number(argv[++i]) || 1)
    else if (a === '--check') out.check = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--gate-only') out.gateOnly = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function printHelp() {
  process.stdout.write([
    '小智工作站 · Qoder 自主迭代驱动器',
    '',
    '  node scripts/autoloop.mjs --check              环境预检（零费用）',
    '  node scripts/autoloop.mjs --dry-run            组装提示词落盘，不调用 AI',
    '  node scripts/autoloop.mjs --gate-only          只跑四门门禁复验（零费用）',
    '  node scripts/autoloop.mjs --rounds 5           连续跑 5 轮',
    '',
    `  提示词：${PROMPT_FILE}`,
    `  状态：  ${STATE_FILE}`,
    '',
  ].join('\n'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { printHelp(); return 0 }
  if (args.check) return doCheck()
  if (args.gateOnly) return doGateOnly()
  if (args.dryRun) return doDryRun(args.rounds)
  return doRun(args.rounds)
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    log(`驱动器异常：${(err && err.stack) || err}`)
    process.exit(2)
  })
