# R132 标书评分项交叉核对「双向化」（P2 实质项，标书优先）

日期：2026-10-03　round：131 → 132　优先级：P2（实质性优化）

## 选题背景（响应用户新方向：优先标书/方案/PPT 的过程+结果综合质量）
- 用户裁定：后续 R 系列优先**标书**、次方案、末 PPT，报价降权。本轮据此从标书域择优。
- 现状缺陷：`ScoreCrossCheckPanel`（标书工作第 2 步「评分项交叉核对」，零 AI 费用）此前只做
  **单向**核对——列出「本地扫描到、但解析报告没有」的评分项（`missingInReport`，UI 徽标「报告漏抽」）。
  缺**反向**：解析报告(AI) 抽了、但本地原文逐行扫描匹配不到的评分项无法暴露。这类项要么原文表格被
  pdfjs 丢行、要么抽取依据存疑（编造嫌疑），是标书评分「结果综合核对」应有的另一半。

## 方案（纯函数补反向集合 + 面板双向呈现 + 回归测试）
1. `scoreItemsScan.ts`：`ScoreCrossCheck` 增 `extraInReport: ParsedScoreItem[]`；
   `crossCheckScores` 计算 `extraInReport = parsed.filter((p) => !scan.items.some((s) => nameSimilar(s.name, p.name)))`
   （与既有 `missingInReport` 严格对称，复用同一 `nameSimilar` 双向包含匹配），并纳入返回。
2. `ScoreCrossCheckPanel.tsx`：
   - 徽标区在「报告漏抽」与「分值不符」之间加 **待复核 {extraInReport.length}**（琥珀 warning 色，
     区别于红色硬错误——反向项多为原文丢行/需人工对照，非确定性错误，故用「待复核」而非「错报」口径）；
   - 明细区在漏抽列表后追加「解析报告抽到、但本地原文扫描未匹配的项（请对照原文复核）」列表，
     按 tech_score/biz_score 显示「技术/商务」标签 + 分值；底部既有诚实声明（真值以原文为准）天然覆盖其噪声属性。
3. `scoreItemsScan.test.ts`：新增 describe「双向交叉核对」2 用例——①原文有/报告无→missingInReport，
   报告有/原文无→extraInReport（含 section 断言）；②名称互相包含视为匹配，不重复计入双向差异。

## 边界与裁定
- 数据模型：零 collection、零 pb_hooks、零会话 state。提示词：零改动（不涉 B 类 / PROMPT_VERSION / 快照）。
- 维持既有裁定不动：编造嫌疑门禁只报不拦（本轮反向项仅「提示待复核」不拦截，正契合该口径）、
  lint-debt-01 不重构、五个 defer 项继续在途绕开。
- 未 git commit。

## 在途代码保护（改前核对）
- `scoreItemsScan.ts`、`ScoreCrossCheckPanel.tsx` 均 **git-CLEAN**（提交态原样，零用户 WIP 风险），补丁内置断言强制校验。
- `scoreItemsScan.test.ts` 为 git-M，但 `git diff` 唯一 hunk `@@ -27,8 +27,8 @@` 系先验轮 R61 name-trunc 用例修订
  （账本 r47-scan-name-trunc-06 closed 对应），非用户手写 WIP；本轮 import 改在行 4（该 hunk 之外）、
  新 describe 追加在 EOF（该 hunk 之后），逐处 `assert count==1`，安全。

## 四门验证（目标项目目录）
- `npx tsc -b`：0 错误。
- `npx vitest run`：**873 passed | 2 skipped**（基线 871 → **+2**，本轮两条新用例；scoreItemsScan.test.ts 单跑 7 = 旧 5 + 新 2）。
- `npx eslint` 触及文件：净新增 **0** error（scoreItemsScan.ts L50 `no-useless-escape` 为提交态既有、位于 cleanName，
  与本轮 crossCheckScores 改动无关；Panel/test 无告警）。
- `npx vite build`：成功（4.26s，dist 正常产出）。

## 涉及文件
- src/pages/BidWorkspace/scoreItemsScan.ts（ScoreCrossCheck.extraInReport + 计算 + 返回）
- src/components/bid-workspace/ScoreCrossCheckPanel.tsx（待复核徽标 + 反向明细列表）
- src/pages/BidWorkspace/scoreItemsScan.test.ts（+2 双向核对回归用例）
- scripts/r132_bid_score_crosscheck_bidirectional.py（补丁落地脚本）
