# R267 · 标书检查中枢三期 L4 查重层接入（r261-bidcheck-followons）

## 选题依据
接续 R266（二期 L2）完成同一伞项 `r261-bidcheck-followons`（P2·标书检查域）的三期 L4 查重。
巡检坐实又一处「交互断链」：`checkConfig` 默认层级已含 L4、且预留了 `dupCrossChapterEnabled`
与 `dupMinRun` 两个配置旋钮，规则清单页把 L4 说明为「跨章节重复段落检测（配置项已预留）」，
但 `runCheck` 从不跑 L4——配置开关与规则说明都是空头承诺。本轮闭合 L4 断链。

## 复用优先（未自研新算法）
L4 直接复用 BidWorkspace 现成、已单测的本地跨章互查三件套（零 AI / 零费用 / 零 collection schema）：
- `bidTypes.findIntraDupPairs(targets, threshold, limit)` —— shingles+Jaccard 段落级跨章相似度互查（第七轮改造 4 已落）；
- `bidTypes.DupTarget` / `INTRA_DUP_THRESHOLD_DEFAULT(=0.35)` —— 与 solDeliveryCheck/useBidWorkspace 同一把尺子。
两个预留配置旋钮在此被真正接线：`dupCrossChapterEnabled` 作 L4 总开关（关→skipped）；
`dupMinRun` 映射为「参与互查的段落最小长度」，滤除短句套话误报。

## 变更文件
- 新增 `src/pages/BidCheck/rules/dedup.ts`：L4 入口 `runDedupChecks(rec, cfg)`，产 `L4-D1 跨章节重复段落`。
  - 只报不拦：一律 `severity=medium` / `status=warn`，不标 fail、不触暗标导出门禁（与既有裁定同口径）。
  - 诚实降级：`dupCrossChapterEnabled=false` / 已生成正文不足两章 → `skipped` 并说明，绝不瞎判。
  - 命中每条给「a章 ↔ b章」定位 + 相似度 + 对方段落摘录。
- 改 `src/pages/BidCheck/runCheck.ts`：导入 `runDedupChecks`，`levels` 含 L4 时接入；注释顺延为「L3 内容（四期）」。
- 改 `src/pages/BidCheck/RulesListPanel.tsx`：L4 从「配置项已预留」改为「已接入（三期）」，当前接入态改述为 L1+L2+L4+L5，闭合断链文案。
- 新增 `src/pages/BidCheck/rules/dedup.test.ts`：5 用例（开关关闭 skipped / 不足两章 skipped / 跨章重复 warn 带相似度 / 无重复 pass / 短段被 dupMinRun 过滤不误报）。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0（修 1 处测试 import 路径 rules/ 下应为 ../config/checkConfig）。
- `npx vitest run`：172 files 全过，**1931 passed + 2 skipped**（R266 基线 171 files/1926 passed+2 skipped，增量 +1 文件/+5 用例=dedup.test.ts）。
- `npx eslint`（触及 4 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.00s。

## 数据模型 / 提示词
零 collection schema、零 pb_hooks、零提示词改动（未触 B 类流程）。L4 结论为只读派生覆盖层。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：只报不拦——L4 同样 medium/warn，不加任何新硬门禁；
- `lint-debt-01` 有意保留残余未重构。

## 挂账
- 四期 L3 内容 + L5-D 语义 AI 类（标置信度）/ 五期 标注版 docx（Word 批注引擎）+ PB 集合 anbid_checks + 分工流转仍在 backlog。
- L4 真实数据端到端复核待有≥两章已生成正文的真项目补。
- 串标对比（L4-4 多文件对比）默认关，独立于本次单标书内部跨章互查，未纳入。
