#!/usr/bin/env node
'use strict';

/**
 * Qoder PreToolUse 权限守卫（硬拦截层）
 * ============================================================
 * 职责
 *   在 Qoder 权限管道之前做最后一道**确定性**检查。
 *   与 .qoder/settings.json 的 deny 规则形成双保险：Hook 的权限决策优先级
 *   **高于权限模式**，因此即使以 --yolo / bypass_permissions 运行，本守卫
 *   返回的 deny 依然生效 —— 这是唯一不可绕过的拦截点。
 *
 * 协议
 *   输入（stdin，JSON）：{ tool_name, tool_input, session_id, cwd, ... }
 *   输出（stdout，JSON）：
 *     命中禁区 → {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *                 "permissionDecision":"deny","permissionDecisionReason":"..."}}
 *     未命中   → {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *                 "permissionDecision":"ask"}}   ← "ask" = 继续走正常权限管道
 *
 * 失败策略（重要）
 *   任何内部异常一律输出 "ask"，绝不因为守卫自身故障而阻断正常工作。
 *   守卫只做"确定性拦截"，不做概率判断。
 */

const MAX_STDIN_BYTES = 4 * 1024 * 1024; // 防御：超长输入不解析，直接放行到正常管道

/** Bash 命令禁区。每条都针对本项目真实风险，不是通用套话。 */
const BASH_DENY_RULES = [
  // ---- 破坏性删除 ----
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, why: '递归强制删除' },
  { re: /\brm\s+-[rf]{1,2}\b/i, why: '强制/递归删除' },
  { re: /\brm\s+(-[a-z]+\s+)*(\/|[a-z]:[\\/]|~|\$HOME)(\s|$)/i, why: '删除根目录或家目录' },
  { re: /\bdel\s+\/[a-z]*[sq][a-z]*/i, why: 'Windows 递归/静默删除' },
  { re: /\brmdir\s+\/[a-z]*s/i, why: 'Windows 递归删目录' },
  { re: /\bRemove-Item\b[^|;]*-(Recurse|Force)/i, why: 'PowerShell 递归/强制删除' },
  { re: /\b(erase|del)\s+[^|;]*\*\.[a-z]+/i, why: '通配符批量删除' },

  // ---- 磁盘 / 分区 ----
  { re: /\bformat\s+[a-z]:/i, why: '格式化磁盘' },
  { re: /\bmkfs(\.[a-z0-9]+)?\b/i, why: '创建文件系统' },
  { re: /\bdiskpart\b/i, why: '磁盘分区操作' },
  { re: /\bbcdedit\b/i, why: '引导配置修改' },

  // ---- Git 不可逆操作 ----
  { re: /\bgit\s+push\b/i, why: '推送到远端（本项目只做本地迭代，外发需人工）' },
  { re: /\bgit\s+reset\s+--hard/i, why: '硬重置（丢弃所有改动）' },
  { re: /\bgit\s+clean\s+-[a-z]*[fd]/i, why: '清理未跟踪文件' },
  { re: /\bgit\s+(checkout|restore)\s+--\s+\./i, why: '整体丢弃工作区改动' },
  { re: /\bgit\s+branch\s+-D\b/i, why: '强制删除分支' },

  // ---- 提权 / 系统 ----
  { re: /\bsudo\b/i, why: '提权执行' },
  { re: /\brunas\b/i, why: 'Windows 提权执行' },
  { re: /\breg\s+(add|delete|import)\b/i, why: '修改注册表' },
  { re: /\bwmic\b/i, why: 'WMI 系统操作（本机已被安全策略封锁）' },
  { re: /\bicacls\b|\btakeown\b/i, why: '修改文件权限/属主' },
  { re: /\bschtasks\b/i, why: '创建计划任务（应由用户本人操作）' },
  { re: /\btaskkill\b/i, why: '结束进程（可能杀掉 PocketBase/Vite 服务，请用 stop-local.cmd）' },

  // ---- 供应链 ----
  { re: /\b(npm|pnpm|yarn)\s+(i|install|add)\s+(-g|--global)\b/i, why: '安装全局包' },
  { re: /\b(npm|pnpm|yarn)\s+publish\b/i, why: '发布包到 registry' },
  { re: /\bwinget\b|\bchoco\b|\bscoop\b/i, why: '系统级软件安装' },

  // ---- 下载即执行 ----
  { re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^|;]*\|\s*(ba)?sh\b/i, why: '下载内容直接交给 shell 执行' },
  { re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^|;]*\|\s*(node|python|py)\b/i, why: '下载内容直接交给解释器执行' },

  // ---- 凭据与数据外泄 ----
  { re: /(>|>>)\s*[^\s|;]*\.env(\b|$)/i, why: '写入 .env（凭据文件）' },
  {
    re: /\b(cat|type|more|Get-Content|gc|head|tail|less)\b[^|;]*\.env(\b|$)/i,
    why: '读取 .env 内容（可能含密钥）',
  },
  {
    re: /\b(cat|type|more|Get-Content|gc|head|tail|less)\b[^|;]*pb_data/i,
    why: '读取 PocketBase 数据文件',
  },
];

/** 写入禁区（作用于 Edit / Write 的 file_path）。相对项目根的路径片段。 */
const WRITE_DENY_RULES = [
  { test: (p) => /(^|\/)\.env($|\.)/.test(p), why: '凭据文件（.env / .env.local）' },
  { test: (p) => /(^|\/)\.git\//.test(p), why: 'Git 内部目录' },
  { test: (p) => /(^|\/)node_modules\//.test(p), why: '依赖目录' },
  { test: (p) => /(^|\/)dist\//.test(p), why: '构建产物' },
  { test: (p) => /(^|\/)pocketbase\/pb_data\//.test(p), why: 'PocketBase 运行时数据库' },
  { test: (p) => /(^|\/)vibex-local\/bin\//.test(p), why: 'VibeX 打包的本地运行时（含自带 pb_data）' },
  { test: (p) => /(^|\/)\.vibex\//.test(p), why: 'VibeX 平台往返契约目录（平台提供，不得改写）' },
  { test: (p) => /\.(pem|key|pfx|p12)$/i.test(p), why: '私钥/证书文件' },
];

/** 从任意来源稳健提取字符串字段 */
function pickString(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/** 规范化路径：统一分隔符、转小写（Windows 不区分大小写）、去首尾空白 */
function normalizePath(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

/** 决定权限：返回 'deny' 或 'ask' */
function decide(payload) {
  const toolName = pickString(payload, ['tool_name', 'toolName', 'name']);
  const input = payload && typeof payload.tool_input === 'object' ? payload.tool_input
    : payload && typeof payload.toolInput === 'object' ? payload.toolInput
    : {};

  // --- Bash 检查 ---
  if (/^bash$/i.test(toolName)) {
    const cmd = pickString(input, ['command', 'cmd']);
    if (cmd) {
      for (const rule of BASH_DENY_RULES) {
        if (rule.re.test(cmd)) {
          return { decision: 'deny', reason: `[guard] 拒绝执行：${rule.why}。若确需执行，请由用户本人在终端手动操作。` };
        }
      }
    }
    return { decision: 'ask' };
  }

  // --- 文件写入检查（Edit / Write / NotebookEdit）---
  if (/^(edit|write|notebookedit)$/i.test(toolName)) {
    const raw = pickString(input, ['file_path', 'filePath', 'path', 'notebook_path']);
    const p = normalizePath(raw);
    if (p) {
      for (const rule of WRITE_DENY_RULES) {
        if (rule.test(p)) {
          return { decision: 'deny', reason: `[guard] 拒绝写入：${rule.why}（${raw}）。该路径受保护。` };
        }
      }
    }
    return { decision: 'ask' };
  }

  // --- 读取检查（避免读走凭据）---
  if (/^read$/i.test(toolName)) {
    const p = normalizePath(pickString(input, ['file_path', 'filePath', 'path']));
    if (p && (/(^|\/)\.env($|\.)/.test(p) || /\.(pem|key|pfx|p12)$/.test(p))) {
      return { decision: 'deny', reason: `[guard] 拒绝读取：凭据类文件（${p}）。` };
    }
    return { decision: 'ask' };
  }

  return { decision: 'ask' };
}

/** 输出 Hook 决策到 stdout */
function emit(result) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
    },
  };
  if (result.decision === 'deny') out.hookSpecificOutput.permissionDecisionReason = result.reason;
  process.stdout.write(JSON.stringify(out));
}

// ---------------------------------------------------------------- 主流程
let stdinData = '';
let guardTriggered = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (guardTriggered) return;
  stdinData += chunk;
  if (stdinData.length > MAX_STDIN_BYTES) {
    guardTriggered = true;
    emit({ decision: 'ask' }); // 超长输入：不解析，交回正常权限管道
    process.exit(0);
  }
});
process.stdin.on('error', () => {
  emit({ decision: 'ask' });
  process.exit(0);
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(stdinData || '{}');
    emit(decide(payload));
  } catch (e) {
    // 解析失败不阻断：交回正常权限管道
    emit({ decision: 'ask' });
  }
  process.exit(0);
});

// 兜底：3 秒内 stdin 未结束（异常宿主），放行
setTimeout(() => {
  emit({ decision: 'ask' });
  process.exit(0);
}, 3000).unref();
