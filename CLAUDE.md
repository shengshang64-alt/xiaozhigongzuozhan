# 小智工作站 · 项目约定（供 AI 助手阅读）

## 项目是什么

医疗信息化售前工作台。前端 React + TypeScript + Vite（**本地 8000**，由 `vibex-local/vite.local.config.ts` 启动，见 `start-local.cmd`），后端 PocketBase（本地 7000，前端经 `/__pb` 代理访问）。
模块：方案工作室 / 标书工作台 / PPT 报价 / 知识库 / 情报竞品 / 大模型通道 / 助手。
**核心价值只有一条：产出可对外交付的标书 / 方案 / PPT。**

> 注意：`npm run dev`（裸 `vite`）用的是**根** `vite.config.ts`，**没有 `/__pb` 代理**，会表现为「界面能开但数据全空」；
> 且它与 `start-local.cmd` 都声明 `port 8000 + strictPort`，两者不能同时起。日常开发一律走 `start-local.cmd`。

## 门禁（任何改动后必须逐条实测，禁止凭想象结论）

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `npx tsc -b` | 0 error |
| 2 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | 构建成功 |
| 3 | `npx vitest run` | 全绿（基线 **283 files / 3324 passed / 2 skipped**，R58 收修实测） |
| 4 | `npx eslint .` | error ≤ **116** 且 warning ≤ **11**（存量债预算，见 `eslint-budget.json`） |

> 第 3、4 条基线随轮次下降，**以 `eslint-budget.json` 与 `docs/evolution/_loop_state.json` 的 `gatesBaseline` 为准**（两者必须同源，
> `pnpm verify:eslint-budget` 会校验；不同源直接 exit 1）。改基线必须**同时**改这三处，否则会重演历史上「151 / 160 / 163 三个数字并存」的口径分裂。
>
> 第 3 条（vitest）的真源是账本 `baseline.r{最新轮次}`，每轮加/减用例后**必须同步本行**：R55 收尾时实测此处仍是 R52 期的
> 273 files / 3244 passed（R54 自己已记 3248，即本行落后 4 例、无人复算），已按 R55 实测值更正；R56 收尾时按当场实跑同步为
> 279 files / 3290 passed（+4 文件 / +26 例）；**R57 收尾时按当场实跑同步为 282 files / 3308 passed**（+3 文件 / +18 例：
> `hookSources.test.ts` 8 + `hookSourcesConvergence.test.ts` 5 + `useBidWorkspace.behavior.test.tsx` 5）；R58 收修（B28/B29）时
> 按当场实跑同步为 **283 files / 3324 passed**（+1 文件 / +16 例：`parseDegradation.test.ts` 新建 11 例 +
> `parseCoverage.test.ts` +3 例 + `useBidWorkspace.behavior.test.tsx` +2 例）。数字与账本不一致时以**当场实跑**为准。

**第 2 条的 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD` 前缀是必需的**：本机沙箱通过 `NODE_OPTIONS`
注入了 safe-delete 守卫，`vite build` 清空 `dist/` 时会触发批量删除拦截（阈值 50，`dist/assets` 有 260+ 文件）。
不写该前缀会看到 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 失败。

**行尾纪律（R52 新增）**：仓库根有 `.gitattributes`（`* text=auto eol=lf`）保证文本文件统一以 LF 存储与检出。
本仓曾因 `.gitattributes` 为空 + `core.autocrlf=true` 导致工作区行尾混乱（实测 351 CRLF / 394 LF / 21 混合），
并因此让「读源码做正则断言」的守卫测试**假红**——`proseFallbackWiring.test.ts` 的 `/\n\s*"bid-outline",\n/`
在 CRLF 下静默匹配 0 处，把「接线完好」误判成「接线缺失」。
**新增此类扫描型守卫时，行锚一律写 `\r?\n`（或先 `split(/\r?\n/)`），不要依赖文件行尾。**

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
