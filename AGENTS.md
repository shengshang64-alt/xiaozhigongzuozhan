# 小智工作站 · 项目约定（供 AI 助手阅读）

> 本文件与 `CLAUDE.md` 内容一致，均为项目约定的权威入口。

## 项目是什么

医疗信息化售前工作台。前端 React + TypeScript + Vite（**本地 8000**，由 `vibex-local/vite.local.config.ts` 启动，见 `start-local.cmd`），后端 PocketBase（本地 7000，前端经 `/__pb` 代理访问）。
模块：方案工作室 / 标书工作台 / PPT 报价 / 知识库 / 情报竞品 / 大模型通道 / 助手。
**核心价值只有一条：产出可对外交付的标书 / 方案 / PPT。**

### 本地三个端口（2026-11-04 补全；此前只写了 7000/8000，7001 长期无文档）

| 端口 | 服务 | 启动方式 | 停掉会怎样 | 备注 |
|---|---|---|---|---|
| **8000** | 前端 Vite dev server | `start-local.cmd`（用 `vibex-local/vite.local.config.ts`，带 `/__pb` 代理） | 页面打不开 | `npm run dev` 用的是根配置、**没有代理**，界面能开但数据全空；两者都声明 `port 8000 + strictPort`，不能同时起 |
| **7000** | PocketBase（数据库 + 全部自定义 API） | `start-local.cmd` 一并拉起 | 全站数据为空、所有 `/api/*` 404 | **JSVM hooks（`pb_hooks/*.pb.js`）不热加载**，改 hook 必须重启本端口才生效 |
| **7001** | Node sidecar（AI 生图 / 渲染等重活） | `vibex-local/sidecar/server.mjs` 独立进程 | 「AI 插画」「PPT 渲染」类功能报错，其它功能不受影响 | 端口在前端 `src/lib/sidecarClient.ts` 硬编码 7001；服务端可用 `ZX_SIDECAR_PORT` 覆盖（两者必须一致） |

一键起停：`start-local.cmd` / `stop-local.cmd`（**stop 会同时停 7000 和 8000**，需要单独保留 one 时注意）。
只验证某一层是否活着：`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:8000/`（或 7000 的 `/api/health`）。

> 注意：`npm run dev`（裸 `vite`）用的是**根** `vite.config.ts`，**没有 `/__pb` 代理**，会表现为「界面能开但数据全空」；
> 且它与 `start-local.cmd` 都声明 `port 8000 + strictPort`，两者不能同时起。日常开发一律走 `start-local.cmd`。

## 门禁（任何改动后必须逐条实测，禁止凭想象结论）

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `npx tsc -b` | 0 error |
| 2 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | 构建成功 |
| 3 | `npx vitest run` | 全绿（基线 **301 files / 3513 passed / 7 skipped**，R63 分片实测） |
| 4 | `npx eslint .` | error ≤ **116** 且 warning ≤ **11**（存量债预算，见 `eslint-budget.json`） |

> 第 3、4 条基线随轮次下降，**以 `eslint-budget.json` 与 `docs/evolution/_loop_state.json` 的 `gatesBaseline` 为准**（两者必须同源，
> `pnpm verify:eslint-budget` 会校验；不同源直接 exit 1）。改基线必须**同时**改这三处，否则会重演历史上「151 / 160 / 163 三个数字并存」的口径分裂。
>
> 第 3 条（vitest）的真源是账本 `baseline.r{最新轮次}`，每轮加/减用例后**必须同步本行**：R55 收尾时实测此处仍是 R52 期的
> 273 files / 3244 passed（R54 自己已记 3248，即本行落后 4 例、无人复算），已按 R55 实测值更正；R56 收尾时按当场实跑同步为
> 279 files / 3290 passed（+4 文件 / +26 例）；**R57 收尾时按当场实跑同步为 282 files / 3308 passed**（+3 文件 / +18 例：
> `hookSources.test.ts` 8 + `hookSourcesConvergence.test.ts` 5 + `useBidWorkspace.behavior.test.tsx` 5）；R58 收修（B28/B29）时
> 按当场实跑同步为 283 files / 3324 passed（+1 文件 / +16 例：`parseDegradation.test.ts` 11 例 + `parseCoverage.test.ts` +3 例 +
> `useBidWorkspace.behavior.test.tsx` +2 例）；R58（B32 项目 CRUD 行为网）时同步为 296 files / 3486 passed（+1 文件 / +6 例：
> `useBidWorkspace.projectCrud.test.tsx`）；R59（B32 正文精修）时同步为 **297 files / 3491 passed**（+1 文件 / +5 例：
> `useBidWorkspace.chapterRefine.test.tsx`）。R58 的 296 / 3486 与 R62 的 300 / 3509 只写进过轮报与账本、**本行当时没跟着改**（R63 对账时
> 才发现）；R63 按分片实测同步为 **301 files / 3513 passed / 7 skipped**（+1 文件 `bidVisibilityCorpus2.test.ts` 5 例、
> `bidVisibility.test.ts` +6 例；另有 5 例因「本机夹具 / 盘符路径缺失」转 skip）。**R63 的分片口径照实理解**：沙盒 2 核、单次调用约 175 秒上限，
> 整包一次跑不完，是把 301 个文件按 jsdom/node 分 15 片跑完、再用文件清单做集合校验「已跑 301 / 全部 301、未覆盖为空」得到的总数；
> 宿主上单命令复跑如有 ±数例差异，以复跑为准。数字与账本不一致时以**当场实跑**为准。

**第 2 条的前缀是必需的**：本机沙箱通过 `NODE_OPTIONS` 注入了 safe-delete 守卫，
`vite build` 清空 `dist/` 时会触发批量删除拦截（阈值 50，`dist/assets` 有 260+ 文件）。

**行尾纪律（R52 新增）**：仓库根有 `.gitattributes`（`* text=auto eol=lf`）保证文本文件统一以 LF 存储与检出。
本仓曾因 `.gitattributes` 为空 + `core.autocrlf=true` 导致工作区行尾混乱（实测 351 CRLF / 394 LF / 21 混合），
并因此让「读源码做正则断言」的守卫测试**假红**——`proseFallbackWiring.test.ts` 的 `/\n\s*"bid-outline",\n/`
在 CRLF 下静默匹配 0 处，把「接线完好」误判成「接线缺失」。
**新增此类扫描型守卫时，行锚一律写 `\r?\n`（或先 `split(/\r?\n/)`），不要依赖文件行尾。**

## 自主迭代机制（v2）

- 提示词：`Qoder自主迭代提示词-v2.md`
- 驱动器：`scripts/autoloop.mjs`（`--check` / `--gate-only` / `--dry-run` / `--rounds N`）
- 状态：`docs/evolution/_loop_state.json`　轮报：`docs/evolution/R{轮次}_{YYYYMMDD}.md`
- 一键启动：`qoder-auto.cmd run N`（睡前多轮用）

## 红线（触犯即停）

- 不改 `.qoder/settings.json`、`.qoder/hooks/**`
- 不执行 `git push` / `reset` / `clean` / `rebase`；不删 `pocketbase/pb_data`
- 不动 `.env` 等凭据文件；密钥不得进代码或日志
- **不删用户既有产物**（已生成的标书正文、方案、PPT 数据）

## 源码来源

本项目源码由 VibeX 导出。改动或准备回传文件前，请先读
`.vibex/skills/vibex-app-source-roundtrip/SKILL.md`，保持 VibeX app id 与平台集成不变。
