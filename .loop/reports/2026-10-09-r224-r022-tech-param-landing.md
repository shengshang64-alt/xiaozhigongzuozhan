# R224 · R-022 技术参数落点（第 2 轮改造 · 标书链第五 slice）

## 选题依据与已有能力判断
第 2 轮 R-022 要求「按第五章技术和服务要求全部技术参数(样例 116 项)逐条建节点/进偏离表，
标【评审项】/▲/一般项并联动正负偏离(负偏离每项扣 0.5)，页面显示『已覆盖 N/116』未覆盖高亮；
『技术和服务要求响应表』必须生成正文不置空」。
代码侦查发现已有两条相关链路：
- 改造 3 `OutlineCoverage`（需求响应覆盖 N/M）：但 `extractRequirementClauses` 上限锁 60 条，
  样例 116 项会被截断，且不区分参数权重、不联动偏离扣分。
- 改造 4 `DeviationPanel`（技术偏离表）：AI 逐条判 full/partial/deviation 并按来源分组，
  `deviationStats` 只数级别条数、无分值扣减视图；负偏离仅由 `deviationCommitHits` 在体检里 warn。
真实差量 = 全量参数抽取 + 三态权重标注 + 落点(进偏离表/建节点)核对 + 负偏离扣分联动。本 slice 落地。

## 变更文件
- 新增 src/pages/BidWorkspace/techParamCoverage.ts（纯本地零 AI：l3 全量抽取技术参数(默认上限 240
  覆盖 116 项)、classifyKind 标【评审项】/▲实质性/一般项、逐条核对是否命中技术大纲叶子(建节点)或偏离表行
  (进偏离表)=已覆盖、负偏离(deviation)条数 × 每项扣分(默认 0.5) = 预计扣分、未覆盖明细）
- 新增 src/pages/BidWorkspace/techParamCoverage.test.ts（7 例：无报告不呈现、全量三类计数、
  命中技术叶子算覆盖(商务章不计)、进偏离表算覆盖+负偏离扣 0.5 联动、扣分单价可覆盖、
  uncoveredParamIds 去重、classifyKind 三态正确）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import buildTechParamCoverage；
  techParamCoverage=useMemo(coverageNodes, parse_report, deviationTable)；
  addUncoveredTechParamsToOutline 复用 insertClauseIntoOutline 把未覆盖参数逐条插入技术章；return 暴露）
- 改 src/components/bid-workspace/DeviationPanel.tsx（拆分维度下方插入「技术参数落点（R-022）」卡片：
  已覆盖 N/总数 + 【评审项】/▲/一般项计数 + 负偏离项数·预计扣分 + 补入按钮 + 未覆盖高亮清单(前20)；
  Pick 增两键；import PARAM_KIND_LABEL/Plus）
- 改 src/components/bid-workspace/ComposeStep.tsx（DeviationPanel 透传两 prop + Pick 增两键）
- 改 src/pages/BidWorkspace/BidWorkspacePage.tsx（ComposeStep 调用处补透传两 prop）

## 关键设计
- 覆盖口径「进偏离表 OR 建节点」任一即已覆盖：偏离表是权威响应表，参数已在表中判定即视为有落点；
  大纲技术叶子命中(clauseMatchesTitle 公共子串≥4)也计入，避免重复补入。商务章不计(clause 只对技术章要求)。
- 负偏离扣分：response_level==='deviation' 计 negativeCount，扣分 = negativeCount × perItemPenalty。
  perItemPenalty 默认 0.5（样例规则），经 opts 覆盖以适配不同招标评分细则（AGENTS §6 反硬编码：单价非写死在展示层，
  由调用方注入；本 slice 用默认，后续可从招标解析项取实际档位）。partial 只提示不计分。
- 「响应表不置空」：卡片在无偏离表行时 uncovered=total 并高亮全部参数 + 给出「补入未覆盖」入口，
  配合既有「生成偏离表」按钮形成闭环提示；空态仍由 DeviationPanel 原空状态文案兜底。
- 偏离表行匹配用 clause_id 同源 + 文本相似双保险，兼容拆分维度变更后的历史偏离表。

## 四门验证
- tsc --noEmit：0 error
- vitest run：1627 passed | 2 skipped（基线 1620，+7 全绿，0 回归）
- eslint：新文件+页面+组件 4 文件 0 issue；useBidWorkspace 改动行 0 新告警（18 项均为既有基线 set-state-in-effect）
- npm run build：success 3.11s

## 遗留 / 后续
- perItemPenalty 目前默认 0.5；真实档位应随招标文件解析（若评分细则非 0.5/项需接入）。
- 卡片落在 DeviationPanel（编制步）；若要把「已覆盖 N/116」同频显示到大纲步 Overview，后续接同一 memo 即可。
- 逐参数 origin 徽标（偏离表行内标注【评审项】/▲）留待 DeviationPanel 表格列重构时加入。
