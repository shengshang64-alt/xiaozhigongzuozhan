#!/usr/bin/env node

/**
 * 小智工作站 · Qoder 自主迭代驱动器
 * ============================================================
 * 把「AI-ITERATION.md 手动跑一轮」变成可定时、可续跑、可无人值守的循环。
 *
 * 它做四件事：
 *   1. 读双账本（.loop/ledger.json 主账本 + .nightrun/state.json 历史夜跑）
 *   2. 每轮按角色轮换组装提示词，交 Qoder CLI headless 执行
 *   3. 校验 AI 是否真的落盘了报告（防"假装完成"），并更新账本、自动提交
 *   4. 按停止条件停机，写晨报
 *
 * 设计原则
 *   - 状态在文件里，不在内存里 —— 崩溃可断点续跑
 *   - 驱动器状态与业务账本分离 —— 不污染 AI 维护的账本
 *   - 任何异常都不静默 —— 全部进日志与运行记录
 *   - 破坏性动作需显式开启 —— 默认不做
 *
 * 用法
 *   node scripts/qoder-loop.mjs --status           查看当前状态（不调 AI，零费用）
 *   node scripts/qoder-loop.mjs --check            环境预检（不调 AI，零费用）
 *   node scripts/qoder-loop.mjs --dry-run          只组装提示词并落盘，不调用
 *   node scripts/qoder-loop.mjs --rounds 3         跑 3 轮
 *   node scripts/qoder-loop.mjs --rounds 1 --scope /knowledge
 *   node scripts/qoder-loop.mjs --rounds 5 --permission-mode auto
 *
 * 常用选项
 *   --scope <路由|关键词>   限定本轮范围（如 /knowledge、"知识库分页"）
 *   --role <角色名>         强制指定主导视角（默认按轮次自动轮换）
 *   --agent <子代理>        使用哪个 Qoder 子代理（默认 iter-round）
 *   --permission-mode <m>   accept_edits(默认) / auto / dont_ask / bypass_permissions
 *   --max-turns <n>         单轮最大对话轮次（默认 80）
 *   --timeout <分钟>        单轮墙钟超时（默认 45）
 *   --model <名>            指定模型（默认用 Qoder 当前配置）
 *   --no-commit             不自动 git 提交
 *   --allow-dirty           允许在脏工作区开跑（默认拒绝）
 *   --backup-pb             跑前备份 pocketbase/pb_data
 *   --json                  以 JSON 输出结果（供上层程序消费）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// ============================================================ 1. 常量

// 本项目 package.json 为 "type": "module"，本文件按 ESM 解析。
// ESM 无内置 __dirname/__filename，按标准方式从 import.meta.url 推导。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOOP_DIR = path.join(PROJECT_ROOT, '.loop');
const REPORT_DIR = path.join(LOOP_DIR, 'reports');
const LOG_DIR = path.join(LOOP_DIR, 'logs');
const LEDGER_PATH = path.join(LOOP_DIR, 'ledger.json');
const RUN_STATE_PATH = path.join(LOOP_DIR, 'autoloop-state.json');
const MORNING_PATH = path.join(LOOP_DIR, 'MORNING.md');
const NIGHTRUN_STATE_PATH = path.join(PROJECT_ROOT, '.nightrun', 'state.json');
const PB_DATA_DIR = path.join(PROJECT_ROOT, 'pocketbase', 'pb_data');
const AI_ITERATION_PATH = path.join(PROJECT_ROOT, 'AI-ITERATION.md');

/** 角色轮换表：与 AI-ITERATION.md 第 6 节的「轮次 mod 6」一致 */
const ROLE_CYCLE = [
  { id: 'presales-engineer', label: '售前工程师', focus: '这个功能能不能帮我拿下项目' },
  { id: 'product-manager', label: '产品经理', focus: '是否让产品更有价值而非更复杂' },
  { id: 'qa-engineer', label: '测试工程师', focus: '边界、异常、数据一致性' },
  { id: 'hospital-it', label: '医院信息科', focus: '客户看这个界面会不会觉得不专业' },
  { id: 'bid-evaluator', label: '评标专家', focus: '输出内容是否经得起评审' },
  { id: 'biz-finance', label: '商务/财务', focus: '报价、成本、合规风险' },
];

const DEFAULTS = {
  agent: 'iter-round',
  permissionMode: 'accept_edits',
  maxTurns: 80,
  timeoutMin: 45,
  rounds: 1,
  commit: true,
  allowDirty: false,
  backupPb: false,
  json: false,
};

/** 停机阈值 */
const LIMITS = {
  maxConsecutiveNoReport: 3,   // 连续 N 轮没产出报告 → 判定失效停机
  maxConsecutiveEnvFail: 2,    // 连续 N 轮环境预检失败 → 停机
};

// ============================================================ 2. 基础工具

const LOG = [];
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  LOG.push(line);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/** 确保目录存在（递归） */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (e) {
    log('error', `无法创建目录 ${dir}: ${e.message}`);
    return false;
  }
}

/** 容错读取 JSON；失败返回 fallback 并记原因（不抛异常，避免中断长跑） */
function readJsonSafe(file, fallback) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return { ok: true, value: JSON.parse(txt) };
  } catch (e) {
    return { ok: false, value: fallback, error: e.code === 'ENOENT' ? 'NOT_FOUND' : e.message };
  }
}

/** 原子写入 JSON：先写临时文件再 rename，避免半写坏文件 */
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    ensureDir(path.dirname(file));
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    log('error', `原子写入失败 ${file}: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch (_) { /* 清理失败无副作用 */ }
    return false;
  }
}

/** 追加文本到文件 */
function appendFile(file, text) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, text, 'utf8');
    return true;
  } catch (e) {
    log('error', `追加写入失败 ${file}: ${e.message}`);
    return false;
  }
}

/** 同步执行命令，返回 { code, stdout, stderr } */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    shell: opts.shell === true,
    windowsHide: true,
  });
  return {
    code: r.status === null ? -1 : r.status,
    stdout: (r.stdout || '').toString().trim(),
    stderr: (r.stderr || '').toString().trim(),
    error: r.error ? r.error.message : null,
  };
}

/** 时间戳：用于文件名 */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 格式化耗时 */
function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

// ============================================================ 3. 状态读取

/** 读主账本，并做结构兜底（字段缺失时补齐，避免下游崩溃） */
function readLedger() {
  const r = readJsonSafe(LEDGER_PATH, null);
  if (!r.ok || !r.value || typeof r.value !== 'object') {
    return {
      ok: false,
      error: r.error || 'INVALID',
      value: {
        goal: '全模块循环提升',
        round: 0,
        backlog: [],
        closed: [],
        blocked: [],
        noProgressStreak: 0,
        lastRoundSummary: '',
      },
    };
  }
  const v = r.value;
  return {
    ok: true,
    value: {
      goal: v.goal || '全模块循环提升',
      round: typeof v.round === 'number' ? v.round : 0,
      backlog: Array.isArray(v.backlog) ? v.backlog : [],
      closed: Array.isArray(v.closed) ? v.closed : [],
      blocked: Array.isArray(v.blocked) ? v.blocked : [],
      noProgressStreak: typeof v.noProgressStreak === 'number' ? v.noProgressStreak : 0,
      lastRoundSummary: v.lastRoundSummary || '',
      _raw: v,
    },
  };
}

/** 读历史夜跑状态（只读，用于把未结项并入候选池） */
function readNightrun() {
  const r = readJsonSafe(NIGHTRUN_STATE_PATH, null);
  if (!r.ok || !r.value) return { ok: false, error: r.error || 'INVALID', value: null };
  return { ok: true, value: r.value };
}

/** 读驱动器自身运行状态 */
function readRunState() {
  const r = readJsonSafe(RUN_STATE_PATH, null);
  if (r.ok && r.value && typeof r.value === 'object') return r.value;
  return {
    schema_version: 1,
    total_rounds_run: 0,
    consecutive_no_report: 0,
    consecutive_env_fail: 0,
    history: [],
    last_run_at: null,
  };
}

/** 账本统计（人类可读摘要用） */
function ledgerStats(ledger) {
  const b = ledger.value.backlog;
  const count = (s) => b.filter((i) => i && i.status === s).length;
  return {
    round: ledger.value.round,
    backlog_total: b.length,
    open: count('open'),
    in_progress: count('in_progress'),
    done: count('done'),
    blocked: count('blocked'),
    closed: ledger.value.closed.length,
    noProgressStreak: ledger.value.noProgressStreak,
  };
}

// ============================================================ 4. 结果解析

/** 从文本中提取最后一个 ```json 围栏块并解析（驱动器与 AI 的机器可读契约） */
function extractJsonBlock(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const re = /```json\s*\n([\s\S]*?)```/g;
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last.trim());
  } catch (e) {
    return { _parse_error: e.message };
  }
}

/**
 * 识别 CLI 层失败（未登录 / 限额 / 参数错误）。
 * 必须在解析产物之前判定：否则「未登录」会被误判成「AI 没写好报告」，掩盖真实原因。
 */
function detectCliError(cliResult, res) {
  const text = cliResult && typeof cliResult.result === 'string' ? cliResult.result : '';
  if (/not logged in|please run \/login|not authenticated|unauthor/i.test(text)) {
    return {
      kind: 'auth',
      message: 'Qoder CLI 未登录',
      hint: '在终端执行 qodercli 后输入 /login 完成登录；或从 https://qoder.com/account/integrations 获取 token，设为环境变量 QODER_PERSONAL_ACCESS_TOKEN',
    };
  }
  if (cliResult && cliResult.is_error === true) {
    return {
      kind: 'cli',
      message: text || `CLI 返回错误（subtype=${cliResult.subtype || 'unknown'}）`,
      hint: '查看本轮运行日志了解详情',
    };
  }
  if (!cliResult && res.code !== 0 && !res.timedOut) {
    return {
      kind: 'cli',
      message: `CLI 以退出码 ${res.code} 结束且无结构化输出`,
      hint: '查看运行日志；常见原因：参数不被支持、网络不可达、额度不足',
    };
  }
  return null;
}

/** 提取 CLI 元数据（轮次 / 费用 / 会话 / 权限拒绝数），用于成本监控与事后追溯 */
function extractCliMeta(cliResult) {
  if (!cliResult || typeof cliResult !== 'object') return null;
  return {
    sessionId: cliResult.session_id || '',
    numTurns: typeof cliResult.num_turns === 'number' ? cliResult.num_turns : null,
    durationMs: typeof cliResult.duration_ms === 'number' ? cliResult.duration_ms : null,
    totalCostUsd: typeof cliResult.total_cost_usd === 'number' ? cliResult.total_cost_usd : null,
    permissionDenials: Array.isArray(cliResult.permission_denials) ? cliResult.permission_denials.length : 0,
    subtype: cliResult.subtype || '',
  };
}

/** 取目录下最新的文件（按 mtime） */
function newestFile(dir, filterFn) {
  try {
    const names = fs.readdirSync(dir);
    let best = null;
    for (const n of names) {
      const full = path.join(dir, n);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile()) continue;
      if (filterFn && !filterFn(n, st)) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { name: n, full, mtimeMs: st.mtimeMs, size: st.size };
    }
    return best;
  } catch (e) {
    return null;
  }
}

// ============================================================ 5. 环境预检

/** 定位 qodercli 可执行文件（兼容 qodercli / qoder） */
function locateQoderCli() {
  // 1) 优先走 PATH
  for (const c of ['qodercli', 'qoder']) {
    const r = run('where', [c], { shell: true, timeout: 10000 });
    if (r.code === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      // 排除 Qoder IDE 的启动器：它是 Electron 外壳，不能用于 headless
      if (first && /qodercli|\bnpm\b/i.test(first) && !/Qoder IDE/i.test(first)) {
        return { found: true, cmd: first, path: first };
      }
    }
  }
  // 2) 回退：npm 用户级全局前缀下的 shim（PATH 未刷新时的常见情形）
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'qodercli.cmd'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'qodercli.cmd') : '',
    path.join(os.homedir(), '.npm-global', 'bin', 'qodercli'),
    '/usr/local/bin/qodercli',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return { found: true, cmd: c, path: c };
  }
  return { found: false, cmd: null, path: null };
}

/**
 * 探测 HTTP 服务状态（进程内直连实现）。
 *
 * 为什么不用子进程：旧实现以 spawnSync(node, ['-e', script]) 派生孙进程发请求。
 * 在受限环境（容器沙箱、部分终端安全策略）下「node 派生 node」会被直接拒绝
 * （Windows 上报 EBUSY），于是出现**服务明明在跑却报 HTTP ERR 的误报**，
 * 进而让整轮迭代在调用 AI 之前就被拦下 —— 且该失败与用户环境无关，极具误导性。
 * 改为进程内直连后：零进程开销、无引号转义风险、跨沙箱稳定。
 *
 * 返回：HTTP 状态码字符串 | 'ERR'（连接失败/URL 非法）| 'TIMEOUT'（超时）。
 * 复杂度 O(1)，无阻塞（异步），不抛异常（内部全兜底，避免单点失败中断整轮预检）。
 */
function probeHttp(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    // settled 保证 resolve 只生效一次（超时与 error 可能先后触发）
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let client;
    try {
      client = new URL(url).protocol === 'https:' ? https : http;
    } catch (_) {
      // URL 非法：判定为不可达，不抛异常
      settle('ERR');
      return;
    }

    let req;
    try {
      req = client.get(url, (res) => {
        res.resume(); // 主动排空响应体，避免 keep-alive socket 悬挂
        settle(String(res.statusCode));
      });
    } catch (_) {
      settle('ERR');
      return;
    }

    req.on('error', () => settle('ERR'));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      settle('TIMEOUT');
    });
  });
}

/** 完整环境预检：返回 Promise<{ ok, checks[] }>（服务探测为异步，故本函数 async） */
async function checkEnv() {
  const checks = [];
  const push = (name, ok, detail, hint) => checks.push({ name, ok, detail, hint: hint || '' });

  // 1) Node
  push('Node 运行时', true, process.version, '');

  // 2) qodercli
  const cli = locateQoderCli();
  push(
    'Qoder CLI',
    cli.found,
    cli.found ? cli.path : '未安装',
    cli.found
      ? ''
      : '安装：npm install -g @qoder-ai/qodercli   （装完用 qodercli --version 验证）'
  );

  // 3) 认证 —— 只有「环境变量存在」是确定信号。
  //    ~/.qoder/settings.json 主要是 Qoder IDE 的配置，与 CLI 是否已登录无关，
  //    因此这里不做"已登录"的强断言，避免给出误导性的绿色勾。
  const tokenEnv = process.env.QODER_PERSONAL_ACCESS_TOKEN || '';
  push(
    'Qoder 认证',
    true,
    tokenEnv
      ? '已通过环境变量 QODER_PERSONAL_ACCESS_TOKEN 提供'
      : '未检测到 token 环境变量（无法从外部可靠判断 CLI 登录状态——装好 CLI 后跑一次即可确认）',
    tokenEnv ? '' : '如需 token：https://qoder.com/account/integrations → 设为环境变量 QODER_PERSONAL_ACCESS_TOKEN'
  );

  // 4) 服务 —— 两个探测并发执行，避免串行超时叠加（最坏 6s 而非 12s）
  const [viteCode, pbCode] = await Promise.all([
    probeHttp('http://127.0.0.1:8000/'),
    probeHttp('http://127.0.0.1:7000/api/health'),
  ]);
  push('Vite 前端 :8000', viteCode === '200', `HTTP ${viteCode}`, viteCode === '200' ? '' : '启动：双击项目根目录 start-local.cmd');
  push('PocketBase :7000', pbCode === '200', `HTTP ${pbCode}`, pbCode === '200' ? '' : '启动：双击项目根目录 start-local.cmd');

  // 5) 关键文件
  push('主账本 .loop/ledger.json', fs.existsSync(LEDGER_PATH), fs.existsSync(LEDGER_PATH) ? '存在' : '缺失', '缺失时应先由人工跑一轮建立');
  push('唯一入口 AI-ITERATION.md', fs.existsSync(AI_ITERATION_PATH), fs.existsSync(AI_ITERATION_PATH) ? '存在' : '缺失', '');
  push('Qoder 规则 .qoder/rules', fs.existsSync(path.join(PROJECT_ROOT, '.qoder', 'rules')), '', '');
  push('Qoder 子代理 .qoder/agents', fs.existsSync(path.join(PROJECT_ROOT, '.qoder', 'agents')), '', '');

  // 6) git 状态
  const gitStatus = run('git', ['status', '--porcelain'], { timeout: 20000 });
  const dirty = gitStatus.code === 0 && gitStatus.stdout.length > 0;
  push(
    'Git 工作区',
    !dirty,
    dirty ? `有 ${gitStatus.stdout.split(/\r?\n/).filter(Boolean).length} 处未提交改动` : '干净',
    dirty ? '先提交或回滚，避免在脏工作区上叠加改动（可用 --allow-dirty 强制继续）' : ''
  );

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

// ============================================================ 6. 提示词组装

/**
 * 组装当轮提示词。
 * 规则文件（.qoder/rules/*）已由 Qoder 自动注入上下文，这里只给「本轮变量」，
 * 避免重复灌入造成上下文浪费。
 */
function buildPrompt(ctx) {
  const { round, role, scope, ledger, nightrun, runState } = ctx;
  const roleInfo = ROLE_CYCLE.find((r) => r.id === role) || ROLE_CYCLE[0];

  const openItems = (ledger.value.backlog || [])
    .filter((i) => i && (i.status === 'open' || i.status === 'in_progress'))
    .slice(0, 25)
    .map((i) => `| ${i.id || '-'} | ${i.priority || '-'} | ${i.module || '-'} | ${String(i.issue || '').slice(0, 110)} | ${i.status} |`)
    .join('\n');

  const nightBlockers = (nightrun.ok && nightrun.value && Array.isArray(nightrun.value.blockers))
    ? nightrun.value.blockers.map((b) => `| ${b.id} | ${b.desc} | ${b.needs || ''} |`).join('\n')
    : '（无历史夜跑数据）';

  const prevSummary = ledger.value.lastRoundSummary || '（无）';
  const scopeLine = scope
    ? `**本轮范围限定：${scope}**（不得越出该范围；范围外发现的问题只记账，不修改）`
    : '**本轮范围：不限**（但仍须遵守「一轮只做一件事」）';

  return `# 第 ${round} 轮 · 自主迭代（无人值守）

你现在执行**一轮**完整迭代。你不在交互式会话中，**没有人可以提问**——
凡是需要用户拍板的事项，写进报告的 \`needs_user_decision\` 并结束本轮，不要擅自决定。

## 本轮变量

| 项 | 值 |
|---|---|
| 轮次 | 第 ${round} 轮 |
| 主导视角 | **${roleInfo.label}**（${roleInfo.id}） |
| 该视角关注 | ${roleInfo.focus} |

${scopeLine}

## 当前账本快照

- 主账本轮次：${ledger.value.round}
- 候选池：共 ${(ledger.value.backlog || []).length} 项，其中未关闭 ${(ledger.value.backlog || []).filter((i) => i && (i.status === 'open' || i.status === 'in_progress')).length} 项
- 已关闭：${(ledger.value.closed || []).length} 项
- 连续无进展计数：${ledger.value.noProgressStreak}
- 上一轮小结：${prevSummary}

### 未关闭候选（前 25 条）

| id | 优先级 | 模块 | 问题 | 状态 |
|---|---|---|---|---|
${openItems || '| - | - | - | （候选池为空，请走七条发现通道重新扫描） | - |'}

### 历史夜跑未结阻塞项（只读参考）

| id | 描述 | 需要什么 |
|---|---|---|
${nightBlockers}

## 你必须遵守的（详细规则已在 .qoder/rules/ 中注入）

1. **一轮只做一件事**：选**一个**优先级最高的项，禁止并行多主题。
2. **先取证再动手**：确认问题真实存在，留下可重放证据。禁止"我觉得"。
3. **放行门**：A 类（修）/ B 类（优化）可自动执行；**C 类（新增能力）只写方案，不动代码**。
4. **红线**：不改 PB schema、不改 AI 提示词语义、不改费用与认证逻辑、不改导出格式、不重构 \`bidTypes.ts\`/\`useBidWorkspace.ts\`、不引入依赖、不删业务数据、不动 VibeX 平台保护文件。
5. **验证门禁**：\`npx tsc -b && npx vite build\` 通过 + \`npx eslint src\` 无**新增**错误。不过则先回滚。
6. **诚实原则**：没做的、没测到的、降级验证的，全部写进报告的诚实清单。**禁止谎报**。
7. **零费用优先**：静态读码/接口直查/DOM 快照/本地复算能得出结论的，不要调 AI。

## 你必须产出的（否则本轮视为失败）

**第一：报告文件**，路径 \`.loop/reports/${stamp()}.md\`（若已存在同名，加 \`-R${round}\` 后缀）。
格式按 \`.qoder/agents/iter-round.md\` 规定的 8 段式（本轮做了什么/为什么/改了哪些文件/你怎么自己验证/验证结果/遗留与新发现/下一轮建议/需要你决定的事）。
读者**不是程序员**，验证步骤要写到"打开哪个页面→点什么→看到什么算成功"。

**第二：账本更新**。更新 \`.loop/ledger.json\`：
- 本轮目标的 \`status\`（\`done\` / \`blocked\` / \`in_progress\`）
- 新发现追加进 \`backlog\`
- \`round\` 递增
- 若本轮确实推进了工作，\`noProgressStreak\` 归零；否则 +1

**第三：晨报追加**。把**一句话结论**追加到 \`.loop/MORNING.md\` **顶部**（最新在最上面）。

**第四：报告末尾的机器可读结论**（驱动器要解析，字段名不可改）：

\`\`\`json
{
  "round": ${round},
  "topic": "一句话主题",
  "module": "/路由",
  "work_class": "A",
  "role": "${roleInfo.id}",
  "status": "done",
  "files_changed": [],
  "build": "pass",
  "lint_new_errors": 0,
  "evidence": [],
  "next_recommend": "",
  "needs_user_decision": [],
  "honest_notes": []
}
\`\`\`

\`status\` 取值：\`done\`/\`blocked\`/\`skipped\`/\`c_class_waiting\`；
\`work_class\` 取值：\`A\`/\`B\`/\`C\`；\`honest_notes\` **必填**（哪怕写"无"）。

## 开始

现在开始执行。先读状态（\`.loop/ledger.json\` → \`.nightrun/state.json\` + \`.nightrun/MORNING_REPORT.md\` → \`docs/\`），
再走七条发现通道，然后按 9 步流程完成本轮。
`;
}

// ============================================================ 7. 调用 Qoder CLI

/**
 * 以 headless 方式调用 Qoder CLI。
 * 提示词走 stdin（避免命令行长度上限与转义问题）。
 * 返回 { ok, code, stdout, stderr, durationMs, timedOut, logPath }
 */
function runQoderCli(prompt, opts) {
  return new Promise((resolve) => {
    const logFile = path.join(LOG_DIR, `R${String(opts.round).padStart(3, '0')}-${stamp()}.log`);
    ensureDir(LOG_DIR);

    const args = [
      '-p',
      '--agent', opts.agent,
      '--output-format', 'json',
      '--permission-mode', opts.permissionMode,
      '--max-turns', String(opts.maxTurns),
    ];
    if (opts.model) args.push('-m', opts.model);

    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(opts.cliCmd, args, {
      cwd: PROJECT_ROOT,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env },
    });

    const hardKillTimer = setTimeout(() => {
      timedOut = true;
      log('warn', `第 ${opts.round} 轮超过 ${opts.timeoutMin} 分钟，终止进程`);
      try { child.kill('SIGTERM'); } catch (_) { /* 进程可能已退出 */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) { /* 兜底 */ }
      }, 30000).unref();
    }, opts.timeoutMin * 60 * 1000);
    hardKillTimer.unref();

    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      appendFile(logFile, s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      appendFile(logFile, `[stderr] ${s}`);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardKillTimer);
      resolve({
        ok: false, code: -1, stdout, stderr: `${stderr}\n[spawn error] ${err.message}`,
        durationMs: Date.now() - started, timedOut, logPath: logFile,
        error: `无法启动 ${opts.cliCmd}：${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardKillTimer);
      appendFile(logFile, `\n[drive] exit=${code} timedOut=${timedOut} duration=${fmtDuration(Date.now() - started)}\n`);
      resolve({
        ok: code === 0 && !timedOut,
        code: code === null ? -1 : code,
        stdout, stderr, durationMs: Date.now() - started, timedOut, logPath: logFile,
      });
    });

    // 提示词经 stdin 传入；显式 end 以触发 CLI 开始处理
    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch (e) {
      log('error', `写入提示词失败：${e.message}`);
    }
  });
}

// ============================================================ 8. Git 与备份

/** 提交本轮改动；返回 { ok, hash, message } */
function gitCommit(round, topic) {
  const add = run('git', ['add', '-A'], { timeout: 60000 });
  if (add.code !== 0) return { ok: false, hash: '', message: `git add 失败: ${add.stderr}` };

  const staged = run('git', ['diff', '--cached', '--name-only'], { timeout: 30000 });
  if (staged.code !== 0 || !staged.stdout) {
    return { ok: false, hash: '', message: '无暂存改动（本轮可能未修改文件）' };
  }

  const files = staged.stdout.split(/\r?\n/).filter(Boolean);
  const msg = [
    `R${String(round).padStart(3, '0')} ${topic || '自主迭代'}`,
    '',
    `自动化轮次：第 ${round} 轮（Qoder 自主迭代驱动器）`,
    `涉及文件 ${files.length} 个：`,
    ...files.slice(0, 20).map((f) => `  - ${f}`),
    files.length > 20 ? `  ... 其余 ${files.length - 20} 个见 diff` : '',
  ].filter(Boolean).join('\n');

  const c = run('git', ['commit', '-m', msg], { timeout: 120000 });
  if (c.code !== 0) return { ok: false, hash: '', message: `git commit 失败: ${c.stderr || c.stdout}` };
  const h = run('git', ['rev-parse', '--short', 'HEAD'], { timeout: 20000 });
  return { ok: true, hash: h.stdout.trim(), message: 'ok' };
}

/** 备份 pocketbase/pb_data 到 .loop/backup/<ts>/（可选，默认关闭） */
function backupPbData() {
  const dest = path.join(LOOP_DIR, 'backup', stamp());
  try {
    ensureDir(dest);
    fs.cpSync(PB_DATA_DIR, path.join(dest, 'pb_data'), { recursive: true, force: true });
    const files = countFiles(path.join(dest, 'pb_data'));
    log('info', `已备份 pb_data → ${dest}（${files} 个文件）`);
    return { ok: true, dest, files };
  } catch (e) {
    log('error', `备份 pb_data 失败：${e.message}`);
    return { ok: false, dest, error: e.message };
  }
}

function countFiles(dir, acc = { n: 0 }) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc.n; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) countFiles(full, acc);
    else acc.n++;
  }
  return acc.n;
}

// ============================================================ 9. 单轮执行

async function runOneRound(ctx) {
  const { round, opts } = ctx;
  log('info', `======== 第 ${round} 轮开始 ========`);

  // 9.1 环境预检（dry-run 只关心提示词质量，不做任何拦截）
  if (!opts.dryRun) {
    const env = await checkEnv();

    // 统一豁免名单：所有「可放宽项」集中在一处声明，避免多个分支各自为政。
    // 修正历史缺陷：旧实现里 --allow-dirty 是死代码 —— 工作区脏会使 env.ok=false，
    // 在 !env.ok 分支就提前 return 了，永远走不到下面那句 dirty 放行判断。
    const relaxed = new Set();
    if (opts.skipPrecheck) {
      relaxed.add('Vite 前端 :8000');
      relaxed.add('PocketBase :7000');
    }
    if (opts.allowDirty) relaxed.add('Git 工作区');

    const failed = env.checks.filter((c) => !c.ok && !relaxed.has(c.name));
    if (failed.length > 0) {
      for (const f of failed) {
        log('error', `预检未过：${f.name} —— ${f.detail}${f.hint ? ` | ${f.hint}` : ''}`);
      }
      return { status: 'env_fail', reason: failed.map((f) => f.name).join(', ') };
    }

    // 每个被用到的豁免都出声，确保「放宽」不被静默误用
    for (const name of relaxed) {
      const c = env.checks.find((x) => x.name === name);
      if (c && !c.ok) {
        log('warn', `⚠ 已豁免预检项「${name}」：${c.detail}。若本轮任务依赖该项，产出可能不完整。`);
      }
    }
  }

  // 9.2 备份（可选）
  if (opts.backupPb) backupPbData();

  // 9.3 组装提示词
  const prompt = buildPrompt(ctx);
  const promptFile = path.join(LOOP_DIR, `prompt-R${String(round).padStart(3, '0')}-${stamp()}.md`);
  ensureDir(LOOP_DIR);
  try {
    fs.writeFileSync(promptFile, prompt, 'utf8');
  } catch (e) {
    log('warn', `提示词存档失败（不致命）：${e.message}`);
  }

  if (opts.dryRun) {
    log('info', `[dry-run] 提示词已写入 ${promptFile}（${prompt.length} 字符），未调用 Qoder`);
    return { status: 'dry_run', promptFile };
  }

  // 9.4 记录调用前的报告目录快照（用于判断 AI 是否真的落盘）
  const beforeReports = new Set(
    (() => { try { return fs.readdirSync(REPORT_DIR); } catch (_) { return []; } })()
  );

  // 9.5 调用 Qoder CLI
  log('info', `调用 Qoder CLI（agent=${opts.agent} mode=${opts.permissionMode} maxTurns=${opts.maxTurns} timeout=${opts.timeoutMin}m）`);
  const res = await runQoderCli(prompt, { ...opts, round });

  if (res.error) log('error', res.error);
  log('info', `Qoder 退出码=${res.code} 耗时=${fmtDuration(res.durationMs)}${res.timedOut ? '（超时终止）' : ''} 日志=${res.logPath}`);

  // 9.6 解析 CLI 结构化输出
  let cliResult = null;
  if (res.stdout) {
    try {
      const parsed = JSON.parse(res.stdout.trim());
      cliResult = parsed;
    } catch (_) {
      // stdout 不是纯 JSON（可能夹带日志），尝试提取末尾 JSON 对象
      const m = res.stdout.match(/\{[\s\S]*\}\s*$/);
      if (m) {
        try { cliResult = JSON.parse(m[0]); } catch (_) { cliResult = null; }
      }
    }
  }
  const cliText = cliResult && typeof cliResult.result === 'string' ? cliResult.result : res.stdout;

  // 9.7 校验产物：报告是否新增
  const afterReports = (() => { try { return fs.readdirSync(REPORT_DIR); } catch (_) { return []; } })();
  const newReports = afterReports.filter((n) => !beforeReports.has(n));
  const reportProduced = newReports.length > 0;

  // 9.8 提取机器可读结论（优先从新报告文件，其次 CLI 文本）
  let contract = null;
  if (reportProduced) {
    const sorted = newReports
      .map((n) => ({ n, full: path.join(REPORT_DIR, n) }))
      .map((x) => { try { return { ...x, m: fs.statSync(x.full).mtimeMs }; } catch (_) { return { ...x, m: 0 }; } })
      .sort((a, b) => b.m - a.m);
    for (const r of sorted) {
      try {
        contract = extractJsonBlock(fs.readFileSync(r.full, 'utf8'));
        if (contract) break;
      } catch (_) { /* 读失败继续下一个候选 */ }
    }
  }
  if (!contract) contract = extractJsonBlock(cliText);

  // 9.9 git 提交
  let commit = { ok: false, hash: '', message: 'skipped' };
  if (opts.commit) {
    const topic = contract && contract.topic ? String(contract.topic).slice(0, 60) : '';
    commit = gitCommit(round, topic);
    if (commit.ok) log('info', `已提交 ${commit.hash}`);
    else log('warn', `未提交：${commit.message}`);
  }

  // 9.10 结果汇总
  const result = {
    status: reportProduced ? 'ran' : (res.ok ? 'no_report' : 'failed'),
    reportProduced,
    newReports,
    contract,
    commit,
    durationMs: res.durationMs,
    timedOut: res.timedOut,
    exitCode: res.code,
    logPath: res.logPath,
    promptFile,
  };

  if (!reportProduced) {
    log('warn', `第 ${round} 轮未产出报告文件 —— 判定为「无有效产出」`);
  } else {
    log('info', `第 ${round} 轮产出报告：${newReports.join(', ')}`);
  }
  if (contract && contract._parse_error) log('warn', `机器可读结论解析失败：${contract._parse_error}`);
  if (contract && Array.isArray(contract.needs_user_decision) && contract.needs_user_decision.length) {
    log('info', `需要用户决策 ${contract.needs_user_decision.length} 项（见报告）`);
  }

  return result;
}

// ============================================================ 10. 主流程

function parseArgs(argv) {
  const opts = { ...DEFAULTS, scope: '', role: '', model: '', dryRun: false, status: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--status': opts.status = true; break;
      case '--check': opts.check = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--rounds': opts.rounds = Math.max(1, parseInt(next(), 10) || 1); break;
      case '--scope': opts.scope = next() || ''; break;
      case '--role': opts.role = next() || ''; break;
      case '--agent': opts.agent = next() || DEFAULTS.agent; break;
      case '--permission-mode': opts.permissionMode = next() || DEFAULTS.permissionMode; break;
      case '--max-turns': opts.maxTurns = Math.max(1, parseInt(next(), 10) || DEFAULTS.maxTurns); break;
      case '--timeout': opts.timeoutMin = Math.max(1, parseInt(next(), 10) || DEFAULTS.timeoutMin); break;
      case '--model': opts.model = next() || ''; break;
      case '--no-commit': opts.commit = false; break;
      case '--allow-dirty': opts.allowDirty = true; break;
      // 逃生开关：跳过 8000/7000 服务可达性断言。
      // 适用场景：纯代码/文档类任务（如静态分析、标书文本处理）无需前端与数据库在跑，
      // 或处于无 GUI 的 headless/CI 环境。跳过时会打醒目告警，避免被静默误用。
      case '--skip-precheck': opts.skipPrecheck = true; break;
      case '--backup-pb': opts.backupPb = true; break;
      case '--json': opts.json = true; break;
      case '-h': case '--help': opts.help = true; break;
      default:
        if (a.startsWith('--')) log('warn', `未知参数已忽略：${a}`);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write('\n小智工作站 · Qoder 自主迭代驱动器\n\n');
  process.stdout.write(
    [
      '用法：',
      '  node scripts/qoder-loop.mjs --status            查看状态（零费用）',
      '  node scripts/qoder-loop.mjs --check             环境预检（零费用）',
      '  node scripts/qoder-loop.mjs --dry-run           只组装提示词，不调用',
      '  node scripts/qoder-loop.mjs --rounds 3          跑 3 轮',
      '',
      '选项：',
      '  --scope <路由|关键词>   限定本轮范围',
      '  --role <角色>           强制指定主导视角',
      '  --agent <子代理>        Qoder 子代理（默认 iter-round）',
      '  --permission-mode <m>   accept_edits(默认)/auto/dont_ask/bypass_permissions',
      '  --max-turns <n>         单轮最大轮次（默认 80）',
      '  --timeout <分钟>        单轮超时（默认 45）',
      '  --model <名>            指定模型',
      '  --no-commit             不自动 git 提交',
      '  --allow-dirty           允许脏工作区开跑',
      '  --skip-precheck         跳过 8000/7000 服务可达性断言（无 GUI/CI 环境用）',
      '  --backup-pb             跑前备份 pb_data',
      '  --json                  JSON 输出',
      '',
    ].join('\n')
  );
}

/** --status：零成本状态视图 */
function doStatus(opts) {
  const ledger = readLedger();
  const nightrun = readNightrun();
  const runState = readRunState();
  const stats = ledgerStats(ledger);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ledger: stats, ledgerOk: ledger.ok, nightrunOk: nightrun.ok, runState }, null, 2) + '\n');
    return 0;
  }

  const nextRound = stats.round + 1;
  const nextRole = ROLE_CYCLE[nextRound % ROLE_CYCLE.length];

  process.stdout.write('\n===== 小智工作站 · 自主迭代状态 =====\n\n');
  process.stdout.write(`主账本轮次      ${stats.round}（下一轮 = 第 ${nextRound} 轮）\n`);
  process.stdout.write(`候选池          ${stats.backlog_total} 项（未关闭 ${stats.open + stats.in_progress} / 完成 ${stats.done} / 阻塞 ${stats.blocked}）\n`);
  process.stdout.write(`已关闭          ${stats.closed} 项\n`);
  process.stdout.write(`连续无进展      ${stats.noProgressStreak}${stats.noProgressStreak >= LIMITS.maxConsecutiveNoReport ? '  ⚠ 已达停机阈值' : ''}\n`);
  process.stdout.write(`下一轮主导视角  ${nextRole.label}（${nextRole.id}）—— ${nextRole.focus}\n`);
  process.stdout.write(`账本可读        ${ledger.ok ? '是' : '否（' + ledger.error + '）'}\n`);
  process.stdout.write(`历史夜跑可读    ${nightrun.ok ? '是' : '否（' + nightrun.error + '）'}\n`);
  process.stdout.write(`\n驱动器累计跑过  ${runState.total_rounds_run} 轮；最近一次 ${runState.last_run_at || '（无记录）'}\n`);

  if (runState.history && runState.history.length) {
    process.stdout.write('\n最近 5 次运行：\n');
    for (const h of runState.history.slice(-5).reverse()) {
      process.stdout.write(
        `  R${String(h.round).padStart(3, '0')}  ${h.status.padEnd(9)} ${String(h.durationMs || 0).padStart(7)}ms  ` +
        `${h.topic || ''}${h.commitHash ? '  @' + h.commitHash : ''}\n`
      );
    }
  }

  if (stats.open + stats.in_progress > 0) {
    process.stdout.write('\n未关闭候选中优先级最高的 5 项：\n');
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const items = ledger.value.backlog
      .filter((i) => i && (i.status === 'open' || i.status === 'in_progress'))
      .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9))
      .slice(0, 5);
    for (const i of items) {
      process.stdout.write(`  [${i.priority || '-'}] ${i.module || '-'} · ${String(i.issue || '').slice(0, 70)}\n`);
    }
  }

  process.stdout.write('\n提示：跑一轮用 `node scripts/qoder-loop.mjs --rounds 1`\n\n');
  return 0;
}

/** --check：环境预检输出（async：内部 await 服务探测） */
async function doCheck(opts) {
  const env = await checkEnv();
  if (opts.json) {
    process.stdout.write(JSON.stringify(env, null, 2) + '\n');
    return env.ok ? 0 : 1;
  }
  process.stdout.write('\n===== 环境预检 =====\n\n');
  for (const c of env.checks) {
    process.stdout.write(`${c.ok ? '  ✅' : '  ❌'} ${c.name.padEnd(24)} ${c.detail}\n`);
    if (!c.ok && c.hint) process.stdout.write(`       → ${c.hint}\n`);
  }
  process.stdout.write(`\n结论：${env.ok ? '全部通过，可以开跑 ✅' : '存在未通过项 ⚠（见上方 → 提示）'}\n\n`);
  return env.ok ? 0 : 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { printHelp(); return 0; }
  ensureDir(LOOP_DIR);
  ensureDir(REPORT_DIR);
  ensureDir(LOG_DIR);

  if (opts.status) return doStatus(opts);
  if (opts.check) return await doCheck(opts);

  // ---- 循环模式 ----
  log('info', `驱动器启动：rounds=${opts.rounds} agent=${opts.agent} mode=${opts.permissionMode}${opts.dryRun ? ' [DRY-RUN]' : ''}`);

  const ledger = readLedger();
  if (!ledger.ok) log('warn', `主账本不可读（${ledger.error}），将使用空账本启动`);
  const nightrun = readNightrun();
  if (!nightrun.ok) log('warn', `历史夜跑状态不可读（${nightrun.error}），跳过合并`);

  const runState = readRunState();
  const startedAt = new Date();

  // 非 dry-run 时先做一次全局预检，快速失败优于跑到一半才发现没装 CLI
  if (!opts.dryRun) {
    const cli = locateQoderCli();
    if (!cli.found) {
      log('error', '未找到 Qoder CLI，无法执行自动化。');
      log('error', '安装：npm install -g @qoder-ai/qodercli');
      log('error', '认证：从 https://qoder.com/account/integrations 获取 token，设为 QODER_PERSONAL_ACCESS_TOKEN');
      log('error', '提示：D:\\Program Files\\Qoder IDE\\bin\\qoder 是 IDE 启动器，不能用于 headless。');
      return 3;
    }
    log('info', `Qoder CLI: ${cli.path}`);
  }

  const roundsRun = [];
  let consecutiveNoReport = runState.consecutive_no_report || 0;
  let consecutiveEnvFail = runState.consecutive_env_fail || 0;
  let stopReason = 'completed_requested_rounds';

  for (let k = 0; k < opts.rounds; k++) {
    const round = ledger.value.round + 1 + k;

    // 每轮重读账本（AI 上一轮可能改过它）
    const freshLedger = readLedger();
    if (freshLedger.ok) Object.assign(ledger.value, freshLedger.value);

    const role = opts.role || ROLE_CYCLE[round % ROLE_CYCLE.length].id;
    const cli = locateQoderCli();

    const ctx = {
      round,
      role,
      scope: opts.scope,
      ledger,
      nightrun,
      runState,
      opts: { ...opts, cliCmd: cli.cmd || 'qodercli' },
    };

    let result;
    try {
      result = await runOneRound(ctx);
    } catch (e) {
      log('error', `第 ${round} 轮抛出异常：${e && e.stack ? e.stack : e}`);
      result = { status: 'exception', reason: String(e && e.message) };
    }

    // 更新连续性计数
    if (result.status === 'env_fail') consecutiveEnvFail++;
    else consecutiveEnvFail = 0;

    if (result.status === 'no_report' || result.status === 'failed' || result.status === 'exception') {
      consecutiveNoReport++;
    } else if (result.status === 'ran') {
      consecutiveNoReport = 0;
    }

    const contract = result.contract || null;
    roundsRun.push({
      round,
      role,
      status: result.status,
      reason: result.reason || '',
      topic: contract && contract.topic ? String(contract.topic) : '',
      workClass: contract && contract.work_class ? String(contract.work_class) : '',
      durationMs: result.durationMs || 0,
      reportProduced: !!result.reportProduced,
      commitHash: result.commit && result.commit.ok ? result.commit.hash : '',
      needsUserDecision: contract && Array.isArray(contract.needs_user_decision) ? contract.needs_user_decision : [],
      honestNotes: contract && Array.isArray(contract.honest_notes) ? contract.honest_notes : [],
      cliMeta: result.cliMeta || null,
    });

    // 认证失败不会因为重试而好转，直接停机并把修复办法说清楚
    if (result.status === 'auth_fail') {
      stopReason = 'Qoder CLI 未登录，自动化无法继续';
      log('error', `停机：${stopReason}`);
      log('error', `修复：${result.hint || '在终端执行 qodercli 后输入 /login'}`);
      break;
    }

    // 停机判断
    if (consecutiveEnvFail >= LIMITS.maxConsecutiveEnvFail) {
      stopReason = `环境预检连续失败 ${consecutiveEnvFail} 次`;
      log('error', `停机：${stopReason}`);
      break;
    }
    if (consecutiveNoReport >= LIMITS.maxConsecutiveNoReport) {
      stopReason = `连续 ${consecutiveNoReport} 轮无有效产出`;
      log('error', `停机：${stopReason}`);
      break;
    }
  }

  // ---- 持久化运行状态 ----
  runState.schema_version = runState.schema_version || 1;
  runState.total_rounds_run = (runState.total_rounds_run || 0) + roundsRun.filter((r) => r.status === 'ran').length;
  runState.consecutive_no_report = consecutiveNoReport;
  runState.consecutive_env_fail = consecutiveEnvFail;
  runState.last_run_at = new Date().toISOString();
  runState.last_stop_reason = stopReason;
  runState.history = [...(runState.history || []), ...roundsRun].slice(-100);
  writeJsonAtomic(RUN_STATE_PATH, runState);

  // ---- 运行日志落盘 ----
  const logFile = path.join(LOG_DIR, `drive-${stamp()}.log`);
  appendFile(logFile, `\n===== 驱动器运行 ${startedAt.toISOString()} → ${new Date().toISOString()} =====\n${LOG.join('\n')}\n`);

  // ---- 汇总输出 ----
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    requestedRounds: opts.rounds,
    roundsRun,
    stopReason,
    dryRun: !!opts.dryRun,
    driveLog: logFile,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write('\n===== 运行汇总 =====\n\n');
    for (const r of roundsRun) {
      const icon = r.status === 'ran' ? (r.reportProduced ? '✅' : '⚠')
        : r.status === 'dry_run' ? '🧪'
        : '❌';
      process.stdout.write(
        `${icon} 第 ${r.round} 轮  ${r.role}  ${r.status}  ${fmtDuration(r.durationMs)}` +
        `${r.workClass ? `  [${r.workClass}类]` : ''}${r.commitHash ? `  @${r.commitHash}` : ''}\n`
      );
      if (r.topic) process.stdout.write(`    主题：${r.topic}\n`);
      if (r.needsUserDecision.length) {
        process.stdout.write(`    ⚠ 需要你决定 ${r.needsUserDecision.length} 项：\n`);
        for (const d of r.needsUserDecision.slice(0, 5)) process.stdout.write(`      · ${String(d).slice(0, 100)}\n`);
      }
      if (r.honestNotes.length) {
        for (const n of r.honestNotes.slice(0, 3)) process.stdout.write(`    诚实说明：${String(n).slice(0, 100)}\n`);
      }
    }
    process.stdout.write(`\n停机原因：${stopReason}\n`);
    process.stdout.write(`运行日志：${logFile}\n`);
    process.stdout.write(`状态文件：${RUN_STATE_PATH}\n\n`);
  }

  // 退出码：全部有产出=0；有失败=1；环境问题=3
  if (roundsRun.some((r) => r.status === 'env_fail')) return 3;
  if (roundsRun.some((r) => r.status !== 'ran' && r.status !== 'dry_run')) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log('error', `驱动器致命异常：${e && e.stack ? e.stack : e}`);
    try {
      appendFile(path.join(LOG_DIR, `fatal-${stamp()}.log`), LOG.join('\n') + '\n' + (e && e.stack ? e.stack : String(e)));
    } catch (_) { /* 日志写入失败不应掩盖原始异常 */ }
    process.exit(2);
  });
