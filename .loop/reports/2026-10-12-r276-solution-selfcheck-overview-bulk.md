# R276 方案整本「五维自检总览 + 一键批量自检」

- 轮次：round 275 → **276**
- 选题：自主择优（用户点名两项均判已关闭）· 优先级 方案（标书/BidCheck 全域为用户 live 编辑，本轮避让）
- 分类：功能补强（非 B 类提示词——**零提示词文本改动**，复用 `buildChapterReviewMessages`）
- 数据模型：**零 collection / 零 pb_hooks**，`selfCheck` 沿用 `chapters` json 透传

## 1. 问题与价值
方案侧此前只有「逐章手动五维自检」（coverage/logic/evidence/feasibility/writing），缺整本视角：
- 无法一眼看清全案强弱项（哪个维度整体偏弱、哪几章建议重写）；
- 无法把已生成正文的章节「批量」统一打一遍分，只能一章章点。

本轮补齐整本体检 + 批量自检两条链路。

## 2. 交付内容
### 新建
- `solSelfCheckOverview.ts`：纯函数 `buildSelfCheckOverview(chapters)` / `buildSelfCheckBriefText(ov)`。
  聚合：自检覆盖率、已检章均分、结论分布(direct/review/blocked)、各维度均分与最弱维度、
  待重写清单（verdict=blocked，按分数升序）、高频问题（按 dim 聚合降序、空维度归「综合」）。
  **verdict 一律按 `verdictFromTotal` 规则重算**，不信存量 LLM 自报（与单章链路一致，防陈旧数据误导）。
- `solSelfCheckOverview.test.ts`：8 条单测（空/无正文/pending/混合结论/陈旧 verdict 重算/问题聚合降序/待重写升序/文本导出）。
- `SolutionSelfCheckOverviewCard.tsx`：总览卡 + 「一键批量自检」。头部均分+结论 chips+待重写数；
  展开区各维度均分条形（标注短板）、高频问题、待重写跳章按钮；批量运行显示进度条与停止按钮。
  复用 shadcn token，与 `SolutionDeliveryCheckCard` 同构样式；`bodyChapters===0` 时不占版面。

### 改动
- `useSolutionStudio.ts`：新增 `runBulkReview` / `startBulkReview` / `cancelBulkReview` / `selfCheckOverview`（useMemo）
  及运行态 `bulkReviewBusy` / `reviewProgress` / `cancelReviewRef`。批量复用 `runBulkPool`（章间并发 2、
  dispatch-once、取消门、进度单调）与单章同一 prompt/解析/一次重试容错；起跑前 await `lastPersistRef` 防并发 PATCH 丢字段；
  成本走 `runWithCostConfirm`。大纲/医院上下文对整本恒定，起跑前算一次复用（避免逐章重复拼接）。
- `EditorWorkspace.tsx`：import + Props Pick 增 5 字段 + 挂载新卡（置于交付体检卡之后）。
- `SolutionStudioPage.tsx`：向 `EditorWorkspace` 转发 5 个新 props。

## 3. 裁定与约束遵守
- 只报不拦：评分为 AI 建议，不挡导出（维持既有裁定）。
- lint-debt-01：`useSolutionStudio.ts` 既有 12 处 React-Compiler/lint error 按裁定有意保留，本轮不重构。
- 未推翻任何维持裁定项；不碰 pb_hooks。

## 4. 在途避让与换行取证
- 真正的 live 编辑簇（mtime < 2.5h）全部集中在标书/BidCheck：`bidTypes.ts`(3min)、`stripAuditMarks.test.ts`(4min)、
  `BidWordPreview.tsx`(59min)、`complianceCoverage.ts`(114min)、`chapterCompletion.ts`(119min)、`useBidWorkspace.ts`(121min) 等。
  本轮零触碰上述文件。
- 方案域宿主均为既往轮次产物非 live：`EditorWorkspace.tsx` mtime 10-12 03:39（R271）、`useSolutionStudio.ts` 10-07、
  `SolutionStudioPage.tsx` 10-07。
- 换行污染：`solutionTypes.ts` 行尾被历史 Python 文本写污染成 CRCRLF（781 处，全仓仅此文件）。本轮所有补丁统一
  `read_bytes → \n 归一 → 改 → 按原行尾(CRLF/LF)回写`，未新增幽灵差异；CRCRLF 清理建议挂后续独立轮（涉 781 行大 diff，非本轮范围）。

## 5. 四门验证（目标项目目录实测）
| 门 | 结果 |
| --- | --- |
| `npx tsc -b` | **exit 0**，零错误 |
| `npx vitest run` | **181 文件 / 2033 passed · 2 skipped，exit 0**（本轮 +1 文件 / +8 用例，零回归） |
| `npx eslint`（触及 6 文件） | **零新增 error**：改前基线 useSolutionStudio.ts 与改后同为 14 problems（12 error·2 warn），行号仅因新增代码位移；其余 5 文件全净 |
| `npx vite build` | **exit 0**，6051 modules transformed，3.16s |

> 说明：用户流程给的 vitest 基线 630 passed 为历史值；账本 R275 实测口径为 176f/1982+2s。本轮以实时全绿数为准（181f/2033+2s，含标书侧在途新增测试文件）。

## 6. 未竟 / 后续
- 浏览器端对「一键批量自检」真实 AI 打分开箱路径未做 live E2E：需在线 PocketBase + 已生成正文的方案 + 真实 LLM 费用，
  且卡片在无正文数据时按设计隐藏；聚合逻辑已由单测覆盖、装配链路已由 tsc/build 证明。建议在有真实方案数据的环境点验一次。

## 7. 影响文件
新增 3 / 改动 3（见上）。产物快照：`useSolutionStudio.ts.bak-r276`、`EditorWorkspace.tsx.bak-r276`、`ledger.json.bak-r276`。
