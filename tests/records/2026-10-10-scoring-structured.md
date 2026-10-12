# 场景自测 — 评分项 JSON 结构化存储（R253 / 易标 R-026 Slice1）

日期：2026-10-10 ｜ 轮次：R253 ｜ 记录人：自动迭代（数据层）

## 场景口径（AGENTS 强制）
模拟一所三甲医院信息化招标项目「整文解析 → 评分项结构化落库 → 编号体系消费 → 自检报警 → 老数据兼容」全流程，
验证 R-026 结构化存储的真实行为，不破坏既有 17 个存量项目与下游大纲/覆盖矩阵/评标。

## 操作步骤
1. 建医院 → 建项目 → 上传招标文件（整文 ≤60000 字，走 T14 整文通道）。
2. 勾选 tech_score / biz_score 整文解析：模型按 JSON 契约输出 `{score_composition, items:[{name,score,criteria,source}]}`。
3. 观察落库：`parse_report.sections[tech_score].content` 仍为行式文本（下游零改动）；
   新增 `.structured` 携带同一 JSON 原对象（kind=scoring、declared_total、items）。
4. 进入大纲/覆盖矩阵：`numberScoringItems(report)` 从 `.structured` 读评分项（分值/出处不经行正则）。
5. 触发 schema 自检：某评分表漏行致「合计 60 ≠ 声明总分 100」→ warnings 出现一条
   「技术评分要求：评分项合计 60 分 ≠ 招标文件声明总分 100 分，请复核…」，报告顶部横幅可恢复。
6. 老数据兼容：打开本轮之前落库、无 `.structured` 的报告 → numberScoringItems 回退行文本、
   `reportNeedsReparse=true`（needs_reparse 标记），行为与升级前完全一致。

## 自动化验证（数据层等价复刻，零模型费用）
`src/pages/BidWorkspace/parseSchemas.test.ts` 用真实评分表 JSON 形态端到端复刻步骤 2~6：
- buildScoringStructured：items 抽取 + 声明总分 100 + 丢弃「没有提及」缺名项 → 2 项；
- selfCheckScoringTotal：合计 60≠100 报警；合计=声明 返回 null；
- numberScoringItems：有 structured 读「结构化项甲」、无则回退行文本读「旧文本项」；
- reportNeedsReparse：无结构老数据 → true；有结构 → false。

## 预期 / 实际结果
- 预期：新报告评分项带结构化 + 自检标记；老报告与下游消费零变化；四门全绿。
- 实际：vitest 156/1839+2skip 全绿（+1 文件 +5 用例均为本轮）；tsc0；build0；eslint 前后计数一致零新增。
  判定：**通过**。

## 发现问题 / 遗留
- 本轮为数据层落地，ParseReportPanel 尚未显式渲染 needs_reparse「建议整文重解析」提示与结构化评分表视图
  —— 归入 Slice5（R-026③）同批 UI 收口；建阳区样例真实招标文件端到端回归亦留 Slice5。
- 检索通道（retrieval）产物无 JSON 原对象，评分项不落 structured、由 needs_reparse 提示整文重解析获取结构，
  与「纯结构化 + 老数据重解」用户决策一致。
