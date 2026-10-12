# R234 · G5 参数匹配四类研判（验收报告）

## 背景
《医疗信息化投标全流程规范（整合版）V1.0》4.1 将技术参数与自有产品的匹配度分为四类，并给出逐类应对策略与 ★ 实质性条款红线口径。经与用户确认，G5 载体为「标书工作台·第2步 AI 解析报告内扩展」，口径「模板为主 + AI 兜底」，与 G1-G4 一致。

## 交付物
### 1. 纯模块 `paramMatchTypes.ts`（零 AI、可测）
- `PARAM_MATCH`：四类元数据（定义 + 应对策略），严格取自规范 4.1：
  - 01 full 完全满足（强调原生功能）
  - 02 partial 部分不满足（差异不能为 ★）
  - 03 alternative 替代方案（★ 不接受替代）
  - 04 none 完全不满足（★ 建议放弃投标）
- `judgeParam(row)`：按 ★/▲ 实质性标记与所选类型自动推导研判级别（ok/caution/danger）+ guidance + conflict 红线文案
- `summarizeParams(rows)`：聚合投/不投决策（starReject>0→reject、starOpen>0→caution、untyped>0→pending、else bid）+ message
- `extractParamCandidates(text)`：仅收含 ★/▲ 标注行，key=`L{行号}`，零误报
- `applyChoices(rows, choices)`：把持久化的合法 choice 回填 matchType
- 单测 `paramMatchTypes.test.ts`：14 例全绿

### 2. UI `ParseReportPanel.tsx`「参数匹配四类研判」视图
- overall 徽标（可正常投标/谨慎投标/待研判/建议放弃投标）+ 已研判 N/M
- 「AI 兜底研判」：`runWithCostConfirm` 费用门禁 → `chatViaGateway`（AI_PARAM_SYSTEM + 产品能力概述 + 待研判参数列表）→ 容错 JSON → **仅对未研判行给建议**（人工确认，不覆盖已选）
- 规范 4.1 说明 + 决策横幅 + 四类分布 chips + 产品能力概述 Textarea
- 逐条参数行：★/▲ 标记 + 原文 + 级别徽标 + 四选一按钮（带定义 tooltip）+ guidance 策略要点 + conflict ★红线提示

### 3. 数据 `bidTypes.ts`
- `ParseReport` 新增 `param_match_choices?: Record<string, string>`（key=L{行号}，value=full|partial|alternative|none），PocketBase JSON 字段零 schema 迁移

## 门禁
| 门禁 | 结果 |
|---|---|
| tsc --noEmit | 0 错误 |
| vitest run | 1703 passed / 2 skipped（+14 参数研判单测，无回归）|
| eslint | paramMatchTypes.ts/test 0；ParseReportPanel:165、bidTypes:3635/3637 均 baseline（零新增）|
| npm run build | 成功 3.37s |

## 实机回归（建阳区项目·第2步解析报告）
1. 打开建阳区项目 → 第2步 AI 解析报告 → 「参数匹配四类研判」渲染：待研判徽标 + 已研判0/9 + AI兜底研判 + 决策横幅「尚有9项待研判」+ 四类 chips + 能力 textarea + 9 条 ★ 参数行（每行四选一按钮带定义 tooltip）✓
2. 点 ★（二）接口对接行「04 完全不满足」→ 顶部徽标「建议放弃投标」、决策横幅「存在1项★实质性条款完全不满足…建议放弃投标或移交公司层面决策」、行徽标「★红线冲突」、策略要点、冲突文本「★红线：★实质性条款完全不满足：依据规范4.1，建议放弃投标」、chips 04=1、已研判1/9 ✓
3. 无 console error；截图存 .qoder/r233_param_match_view.png ✓

## 架构决策
四类研判本质是「自有产品 vs 招标参数」的人工决策，故 UI 提供每条参数四选一 + 按 ★/▲ 自动推导策略与红线冲突 + 聚合投/不投决策；AI 兜底仅对未研判行给建议（须人工确认、仅填空不覆盖）；选择持久化到 report.param_match_choices，沿用 risk_ai_findings 零迁移范式。
