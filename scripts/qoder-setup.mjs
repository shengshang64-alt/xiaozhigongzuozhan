#!/usr/bin/env node

/**
 * 小智工作站 · Qoder 自主迭代 环境部署与自检
 * ============================================================
 * 幂等：可以反复运行，不会重复写入或破坏已有配置。
 *
 * 用法
 *   node scripts/qoder-setup.mjs                 自检 + 输出下一步指引
 *   node scripts/qoder-setup.mjs --doctor        同上，但把每个问题说透
 *   node scripts/qoder-setup.mjs --enable-auto-mode    （可选）写入用户级 autoMode 引导
 *
 * 它做什么
 *   1. 检查 Qoder 接线是否齐备（规则/子代理/权限/Hook/驱动器）
 *   2. 检查运行前提（CLI、认证、服务、账本、git）
 *   3. 给出「按顺序该做什么」的明确指引，而不是丢一堆问题给用户
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const USER_SETTINGS = path.join(HOME, '.qoder', 'settings.json');
const USER_NPM_PREFIX = path.join(HOME, 'AppData', 'Roaming', 'npm');

const ARGS = new Set(process.argv.slice(2));
const WANT_AUTO_MODE = ARGS.has('--enable-auto-mode');

// ---------------------------------------------------------------- 工具

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: true,
    timeout: opts.timeout || 30000,
    windowsHide: true,
    cwd: opts.cwd || PROJECT_ROOT,
  });
  return {
    code: r.status === null ? -1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  };
}

function exists(rel) {
  return fs.existsSync(path.join(PROJECT_ROOT, rel));
}

function readJsonSafe(file) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { ok: false, value: null, error: e.message }; }
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 探测 HTTP 状态码 */
function probeHttp(url, timeoutMs = 6000) {
  const script = `const h=require('http');const q=h.get(${JSON.stringify(url)},s=>{process.stdout.write(String(s.statusCode));s.resume();});q.on('error',()=>process.stdout.write('ERR'));q.setTimeout(${timeoutMs},()=>{q.destroy();process.stdout.write('TIMEOUT');});`;
  const r = run(process.execPath, ['-e', script], { timeout: timeoutMs + 4000 });
  return r.out || 'ERR';
}

// ---------------------------------------------------------------- 检查项

const results = [];
function check(name, ok, detail, fix) {
  results.push({ name, ok, detail, fix: fix || '' });
}

function checkWiring() {
  const ruleFiles = ['00-platform-contract.md', '10-project-facts.md', '20-iteration-protocol.md', '30-redlines.md', '40-code-conventions.md'];
  const missingRules = ruleFiles.filter((f) => !exists(path.join('.qoder', 'rules', f)));
  check('.qoder/rules 规则包', missingRules.length === 0,
    missingRules.length === 0 ? `${ruleFiles.length} 个规则文件齐备` : `缺少 ${missingRules.join(', ')}`,
    '规则包缺失会让 Qoder 失去项目上下文，需重新生成。');

  const agentFiles = ['presales-engineer.md', 'product-manager.md', 'qa-engineer.md', 'hospital-it.md', 'bid-evaluator.md', 'biz-finance.md', 'iter-round.md'];
  const missingAgents = agentFiles.filter((f) => !exists(path.join('.qoder', 'agents', f)));
  check('.qoder/agents 子代理', missingAgents.length === 0,
    missingAgents.length === 0 ? `7 个角色齐备` : `缺少 ${missingAgents.join(', ')}`, '');

  const settings = readJsonSafe(path.join(PROJECT_ROOT, '.qoder', 'settings.json'));
  const hasPerms = settings.ok && settings.value && settings.value.permissions
    && Array.isArray(settings.value.permissions.allow) && settings.value.permissions.allow.length > 0;
  check('.qoder/settings.json 权限白名单', hasPerms,
    hasPerms ? `allow ${settings.value.permissions.allow.length} 条 / deny ${(settings.value.permissions.deny || []).length} 条` : '缺失或结构不对',
    '权限白名单缺失时，headless 模式下 Bash 命令会被全部拒绝，AI 跑不了构建与检查。');

  check('.qoder/hooks/guard.mjs 硬拦截', exists(path.join('.qoder', 'hooks', 'guard.mjs')),
    exists(path.join('.qoder', 'hooks', 'guard.mjs')) ? '已就位' : '缺失',
    'Hook 是唯一不可被 --yolo 绕过的防线，建议补齐。');

  check('scripts/qoder-loop.mjs 驱动器', exists(path.join('scripts', 'qoder-loop.mjs')),
    exists(path.join('scripts', 'qoder-loop.mjs')) ? '已就位' : '缺失', '');

  check('qoder-auto.cmd 一键启动器', exists('qoder-auto.cmd'),
    exists('qoder-auto.cmd') ? '已就位（双击可用）' : '缺失',
    '没有它就只能手敲命令行。');

  check('AI-ITERATION.md 唯一入口', exists('AI-ITERATION.md'),
    exists('AI-ITERATION.md') ? '已就位' : '缺失', '');
}

function checkRuntime() {
  // Qoder CLI
  let cliPath = '';
  const w = run('where', ['qodercli']);
  if (w.code === 0 && w.out) cliPath = w.out.split(/\r?\n/)[0].trim();
  if (!cliPath) {
    const cand = path.join(USER_NPM_PREFIX, 'qodercli.cmd');
    if (fs.existsSync(cand)) cliPath = cand;
  }
  check('Qoder CLI 已安装', !!cliPath, cliPath || '未找到 qodercli',
    '在你的终端执行：npm install -g @qoder-ai/qodercli   然后 qodercli --version 验证');
  if (cliPath) {
    const v = run(`"${cliPath}"`, ['--version'], { timeout: 60000 });
    if (v.out || v.err) console.log(`    版本：${(v.out || v.err).split(/\r?\n/)[0]}`);
  }

  // 认证
  const token = process.env.QODER_PERSONAL_ACCESS_TOKEN || '';
  check('Qoder 认证凭据', true,
    token ? '已通过环境变量 QODER_PERSONAL_ACCESS_TOKEN 提供' : '未在环境变量中检测到（可能已通过 CLI 登录）',
    token ? '' : '若 CLI 首次运行提示登录，请执行 qodercli 交互登录一次；或从 https://qoder.com/account/integrations 获取 token 后设为环境变量 QODER_PERSONAL_ACCESS_TOKEN');

  // 服务
  const vite = probeHttp('http://127.0.0.1:8000/');
  check('Vite 前端 :8000', vite === '200', `HTTP ${vite}`,
    vite === '200' ? '' : '双击项目根目录 start-local.cmd 启动（同时会拉起 PocketBase）');

  const pb = probeHttp('http://127.0.0.1:7000/api/health');
  check('PocketBase :7000', pb === '200', `HTTP ${pb}`,
    pb === '200' ? '' : '双击项目根目录 start-local.cmd 启动');

  // 账本
  const ledger = readJsonSafe(path.join(PROJECT_ROOT, '.loop', 'ledger.json'));
  const round = ledger.ok && ledger.value ? ledger.value.round : null;
  check('.loop/ledger.json 主账本', ledger.ok, ledger.ok ? `当前轮次 ${round}` : '不可读/不存在',
    ledger.ok ? '' : '主账本是驱动器选题的依据，缺失时应先由人工按 AI-ITERATION.md 跑一轮建立。');

  // git
  const gs = run('git', ['status', '--porcelain']);
  const dirtyCount = gs.code === 0 ? gs.out.split(/\r?\n/).filter(Boolean).length : -1;
  const clean = dirtyCount === 0;
  check('Git 工作区干净', clean,
    dirtyCount < 0 ? '无法读取 git 状态' : clean ? '干净（有清晰回滚点）' : `${dirtyCount} 处未提交改动`,
    clean ? '' : [
      '自主迭代要求「每轮小而可回滚」，工作区不干净时无法判断哪一轮改坏了什么。',
      '建议先建立基线提交（在项目目录执行）：',
      '  git add -A && git commit -m "chore: 自主迭代接线前的基线快照"',
      '注意：提交前请确认 .gitignore 已排除 .env.local / pb_data / 日志等敏感文件。',
    ].join('\n      '));
}

// ---------------------------------------------------------------- 用户级 autoMode（可选）

function enableAutoMode() {
  console.log('\n----- 写入用户级 autoMode 引导（可选）-----');
  fs.mkdirSync(path.dirname(USER_SETTINGS), { recursive: true });

  let current = {};
  if (fs.existsSync(USER_SETTINGS)) {
    const r = readJsonSafe(USER_SETTINGS);
    if (!r.ok) {
      console.log(`  读取 ${USER_SETTINGS} 失败（${r.error}），为避免破坏已有配置，本次跳过。`);
      return false;
    }
    current = r.value || {};
    // 备份（带时间戳，不覆盖历史备份）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = `${USER_SETTINGS}.bak-${stamp}`;
    try {
      fs.copyFileSync(USER_SETTINGS, bak);
      console.log(`  已备份原配置 → ${bak}`);
    } catch (e) {
      console.log(`  备份失败（${e.message}），为避免风险本次跳过。`);
      return false;
    }
  }

  const merged = {
    ...current,
    autoMode: {
      allow: [
        'running pnpm/npx scripts defined in package.json (build, lint, test)',
        'reading files and searching within the project directory',
        'editing source files inside src/, pocketbase/pb_hooks/, scripts/, docs/',
        'running git status, git diff, git add, git commit inside this repository',
        'calling the local backend at http://127.0.0.1:7000 for read-only verification',
      ],
      soft_deny: [
        'deleting files outside the project directory',
        'modifying .env, credentials, or pocketbase/pb_data',
        'pushing to any remote, force-resetting, or rewriting git history',
        'installing global npm packages or system software',
        'editing VibeX platform contract files (.vibex, AGENTS.md in platform scope)',
      ],
      environment: [
        'This is a React 19 + Vite 8 + TypeScript frontend with a PocketBase v0.40.4 backend.',
        'Frontend runs at http://127.0.0.1:8000, backend at http://127.0.0.1:7000.',
        'Package manager is pnpm; build command is "tsc -b && vite build".',
        'The repository is a VibeX dev-source snapshot with a strict round-trip packaging contract.',
        'This project is an autonomous-iteration nightly run: one single topic per round, evidence required, never fabricate verification.',
      ],
    },
  };

  try {
    writeJsonAtomic(USER_SETTINGS, merged);
    console.log(`  ✅ 已写入 ${USER_SETTINGS}（保留原有全部字段，新增 autoMode）`);
    console.log('  说明：autoMode 仅在 --permission-mode auto 时生效，且只从用户级配置读取。');
    return true;
  } catch (e) {
    console.log(`  ❌ 写入失败：${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------- 主流程

console.log('\n============================================================');
console.log('  小智工作站 · Qoder 自主迭代 环境部署与自检');
console.log('============================================================\n');

checkWiring();
checkRuntime();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ✅' : '  ❌'} ${r.name.padEnd(28)} ${r.detail}`);
  if (!r.ok && r.fix) console.log(`      → ${r.fix}`);
}

if (WANT_AUTO_MODE) enableAutoMode();

// 下一步指引（按依赖顺序）
console.log('\n----- 下一步（按顺序做，缺哪步先补哪步）-----\n');

const needCli = failed.some((f) => f.name.includes('Qoder CLI'));
const needGit = failed.some((f) => f.name.includes('Git'));
const needService = failed.some((f) => f.name.includes('Vite') || f.name.includes('PocketBase'));

let step = 1;
if (needService) {
  console.log(`  ${step++}. 启动服务：双击项目根目录 start-local.cmd（等它弹 READY 并把浏览器打开）`);
}
if (needCli) {
  console.log(`  ${step++}. 安装 Qoder CLI：在你自己的终端执行  npm install -g @qoder-ai/qodercli`);
  console.log(`     验证： qodercli --version`);
  console.log(`     首次使用可能需要登录： qodercli   （按提示完成 OAuth）`);
}
if (needGit) {
  console.log(`  ${step++}. 建立基线提交（让每轮都有清晰回滚点）：`);
  console.log(`     cd "${PROJECT_ROOT}"`);
  console.log(`     git add -A && git commit -m "chore: 自主迭代接线前的基线快照"`);
}
console.log(`  ${step++}. 自检一遍：          "C:\\path\\to\\node.exe" scripts/qoder-setup.mjs`);
console.log(`  ${step++}. 试跑（零费用）：    qoder-auto.cmd dry`);
console.log(`     —— 会生成 .loop/prompt-R032-*.md，用记事本打开看看交给 AI 的指令是否合理`);
console.log(`  ${step++}. 正式跑一轮：        qoder-auto.cmd run 1`);
console.log(`     看结果： .loop/reports/ 下最新的那份报告，或 .loop/MORNING.md 顶部的一行结论`);

console.log('\n----- 关键事实（避免踩坑）-----\n');
console.log('  · D:\\Program Files\\Qoder IDE\\bin\\qoder 是「IDE 启动器」，不能用于 headless 自动化。');
console.log('    自动化走的是独立的 qodercli 命令。');
console.log('  · 权限模式默认 accept_edits + .qoder/settings.json 白名单 + Hook 硬拦截，');
console.log('    三者叠加 = 确定性放行确定的命令、拒绝危险操作。比 --yolo 安全，比 dont_ask 可用。');
console.log('  · 驱动器默认拒绝在「脏工作区」开跑（除非加 --allow-dirty），');
console.log('    这是为了保证每轮改动都可独立回滚。');
console.log('  · 停机条件：连续 3 轮无产出、或连续 2 次环境预检失败，会自动停。');

console.log(`\n自检结论：${failed.length === 0 ? '全部通过，可以开始 ✅' : `${failed.length} 项待处理 ⚠（见上方 → 提示）`}\n`);

process.exit(failed.length === 0 ? 0 : 1);
