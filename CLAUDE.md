# 小智工作站 · 项目约定（供 AI 助手阅读）

## 项目是什么

医疗信息化售前工作台。前端 React + TypeScript + Vite（本地 5173），后端 PocketBase（本地 7000）。
模块：方案工作室 / 标书工作台 / PPT 报价 / 知识库 / 情报竞品 / 大模型通道 / 助手。
**核心价值只有一条：产出可对外交付的标书 / 方案 / PPT。**

## 门禁（任何改动后必须逐条实测，禁止凭想象结论）

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `npx tsc -b` | 0 error |
| 2 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | 构建成功 |
| 3 | `npx vitest run` | 全绿（基线 211 files / 2482 passed / 2 skipped） |
| 4 | `npx eslint .` | 错误数 ≤ 160（存量基线，见 `docs/evolution/_loop_state.json`） |

**第 2 条的 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD` 前缀是必需的**：本机沙箱通过 `NODE_OPTIONS`
注入了 safe-delete 守卫，`vite build` 清空 `dist/` 时会触发批量删除拦截（阈值 50，`dist/assets` 有 260+ 文件）。
不写该前缀会看到 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 失败。

## 自主迭代机制（v2）

- 提示词：`Qoder自主迭代提示词-v2.md`
- 驱动器：`scripts/autoloop.mjs`
  - `--check` 环境预检（零费用）｜`--gate-only` 只跑四门（零费用）｜`--dry-run` 只组装提示词
  - `--rounds N` 连续跑 N 轮（注入 `XIAOZHI_AUTOLOOP=1`，无人值守）
- 状态：`docs/evolution/_loop_state.json`（轮次 / eslint 基线 / backlog / history）
- 轮报：`docs/evolution/R{轮次}_{YYYYMMDD}.md`　停机说明：`docs/evolution/_STOP.md`
- 一键启动：`qoder-auto.cmd run N`（睡前多轮用）

## 红线（触犯即停）

- 不改 `.qoder/settings.json`、`.qoder/hooks/**`（权限与守卫）
- 不执行 `git push` / `reset` / `clean` / `rebase`；不删 `pocketbase/pb_data`
- 不动 `.env` 等凭据文件；密钥不得进代码或日志
- **不删用户既有产物**（已生成的标书正文、方案、PPT 数据）

## 源码来源

本项目源码由 VibeX 导出。改动或准备回传文件前，请先读
`.vibex/skills/vibex-app-source-roundtrip/SKILL.md`，保持 VibeX app id 与平台集成不变。
