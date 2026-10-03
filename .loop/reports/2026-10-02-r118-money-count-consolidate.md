# R118 金额/计数数字显示单一真源收敛（money-bypass-sites-01 closed）

日期：2026-10-02 ｜ 优先级：P3 ｜ 类别：A 类口径收敛（零提示词、零 collection、未 commit）

## 背景
R113 确立 money.ts formatMoney（zh-CN 分组 + 固定 2 位小数）为金额显示单一真源；
R117 巡检登记 backlog money-bypass-sites-01：全站仍有 toLocaleString 裸调用绕过该
真源，其中金额类存在「默认最多 3 位小数 vs formatMoney 固定 2 位」的行为差异，
需先定口径。本轮完成口径裁定并全部收敛。

## 口径裁定（本轮拍板，符合"用户授权自主调整"）
1. **金额类**（语义带 ¥/元/万元）：一律走 formatMoney，固定 2 位小数。与 R113
   全站财务显示约定一致（表格数字垂直对齐）。
2. **计数类**（软著数/字数/命中行数/家数）：不属于 money 金额口径，但裸
   toLocaleString() 跟随**运行时默认 locale**（en-US 与 de-DE 浏览器同一数字渲染
   不同："1,234" vs "1.234"），是非确定性显示。新增 money.ts `formatCount(n)`
   （zh-CN 分组钉死、自然精度最多 3 位小数、非有限值归零）作为计数单一真源。
3. **时刻类**（QuoteListPanel/DeckListPanel/ChapterScoreCard/SolutionListPanel 的
   `M/D HH:MM` 列表紧凑格式）：维持 R117「有意保留 compact 维度」裁定，不动。

## 改动清单（25 处编辑 / 9 文件）
- src/lib/money.ts：新增 formatCount + 头注口径说明。
- src/lib/money.test.ts：新增 formatCount describe（3 it，+3 用例增量）。
- 金额 3 站点改道 formatMoney：
  - BidReviewSummary.tsx:88 中标金额合计（万，原 zh-CN 默认最多 3 位小数）。
  - ProductLibraryPanel.tsx:136 产品单价（元）。
  - CustomerProfileCard.tsx:254 年营业收入（万元）。
- 计数 10 站点改道 formatCount：
  - BidWarRoom.tsx:320 正文字数。
  - CompetitorCharts.tsx:71/97/129/148/149 软著 tooltip/轴标签/环心合计/KPI 合计/平均。
  - CompetitorsPage.tsx:485/875 软著计数。
  - CopyrightDialog.tsx:92/123 公司数/命中数（`rows?.length.toLocaleString() ?? "—"`
    等价改写为 `rows ? formatCount(rows.length) : "—"`，行为不变）。

## 在途代码保护
- 改前逐锚点跑 git diff -U0 hunk 区间核对（scripts/r118_precheck.py，报告留档
  .qoder/tmp/r118_overlap.txt）。
- **ComposeStep.tsx:496（已载外部文本字数）命中用户未提交 WIP hunk，本轮绕开**，
  登记 backlog 新条目 money-count-defer-composestep-01 待其在途改动提交后收敛。
- CustomerProfileCard / ProductLibraryPanel / BidWarRoom / CompetitorsPage 虽含
  在途改动，但锚点行均在 WIP hunk 之外（in_wip_hunk=False），仅动锚点行与 import。
- 打补丁前 9 文件全量字节备份：.qoder/tmp/r118_backup/。

## 四门验证
- npx tsc -b：exit 0。
- npx vitest run：723 passed / 2 skipped（基线 720，**+3 全为本轮 formatCount 用例**）。
- npx eslint 触及 9 文件：实新增 error 0。唯一 error（BidReviewSummary
  react-refresh/only-export-components）经补丁前备份对照确认为基线既有
  （20:17 → 21:17 仅因新增 import 行号偏移）。
- npx vite build：3.04s 成功。

## 维持裁定复核
- 编造嫌疑未清零禁导出硬门禁：维持「只报告不拦截」（R89 裁定），本轮未触碰。
- lint-debt-01 有意保留残余：未重构，本轮未触碰。
- 零提示词修改（无 B 类流程触发）、零 collection/pb_hooks 改动、未 git commit。
