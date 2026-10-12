# 场景自测 — 必选解析项分级 required + 失败阻断（R256 / 易标 R-030 Slice4）

日期：2026-10-10 ｜ 轮次：R256 ｜ 记录人：自动迭代（分级 + 失败判定 + 报告红幅 + 左栏徽标）

## 场景口径（AGENTS 强制）
模拟一所三甲医院信息化招标项目「批量解析 → 部分必选项失败 → 报告红幅聚合 + 左栏徽标 → 逐项重解析补齐 → 红幅消失 →
合理缺项(原文未提及)不误报 → 老报告兼容」全流程，验证 R-030 分级的真实行为，不破坏正常解析与既有项目。

## 操作步骤
1. 建医院 → 建项目 → 调研 → 招标文件步批量解析。
2. 构造 8 关键项中若干失败（如技术评分/商务评分接口降级返回〔系统降级…〕、某项 status=failed）：
   `requiredParseFailures` 聚合失败标题 → 报告顶部红幅「必选项解析失败：技术评分要求、商务评分要求…」+ warnings 通道 toast；
   左栏对应项显示红色「必选」徽标。
3. 逐项「重新解析此项」补齐成功后 → requiredParseFailures 为空 → 红幅消失、徽标回到 primary「必选」。
4. 必选项内容为「原文未提及」（源文件确无该维度）：不判失败、不出现红幅（避免对合理缺项误报阻断）。
5. 其他可选项（void_items/qualification/lots 等）：左栏显示 secondary「可选」徽标；★条款/需求结构（other）不显示徽标。
6. 老项目兼容：本轮之前落库的报告 → parseSectionTier 由 sections 实时派生，无 required 字段的老 ParseSectionDef 不受影响，
   行为与升级前一致（无红幅 = 无必选失败时）。

## 自动化验证（零模型，纯函数）
`src/pages/BidWorkspace/parseRequired.test.ts`（4 例）：parseSectionTier 三级分类（overview/tech_score=required、
void_items/lots=optional、star_clauses/req_structure=other）；8 关键项全部 required=true；缺席/空/〔系统降级/failed 判失败而
「原文未提及」不判；整项缺席判失败。

## 预期 / 实际结果
- 预期：必选关键项失败被聚合显式暴露并引导补齐；合理缺项不误报；正常项零变化；老数据兼容。
- 实际：四门全绿（tsc0 / eslint 新 1 文件 0 problem + 触及 3 文件前后 8 errors·13 warnings 计数一致 /
  vitest 159/1854+2skip（+1 文件 +4 用例）/ build exit0 3.90s）。

## 发现问题
- 「失败阻断」采用持久化强提示红幅（与交卷闸门「不拦导航只拦导出」一致），未硬锁步骤流转；若后续需更强约束（导出前必清必选失败），
  留待与 Slice5 废标条数下限报警统一在交卷闸门处复核。
- 建阳区样例真实招标件端到端（含 needs_reparse/parse_quality/required 三提示同屏 UI 复核）留 Slice5。
