# R229 验收报告 · G1/G2 招标文件合规风险与红线扫描

## 背景
用户以《医疗信息化投标全流程规范（整合版）V1.0》（并整合两份 PDF 附件）为标尺，要求对现有标书工作系统优化升级。
经 AskUserQuestion 确认本轮范围：优先 G1+G2（合规红线扫描）、实现方式「规则为主 + AI 兜底」、落地载体「第 2 步 AI 解析报告内扩展」。

## 设计取舍
- **复用本地扫描分区范式**：与 star_clauses/req_structure/lots 同属「本地产出、零 AI、即时、不计入 requestedKeys」，规则命中对 tenderText 实时扫描，不落库、不污染解析项计数。
- **规则为主**：确定性条款（规模门槛、地域/品牌/授权歧视、版权/源代码、模糊验收、付款/维护费阈值）用可配置正则 + REDLINE 常量命中，阈值集中一处便于售前调整（呼应规则配置化精神；前端无 YAML 体系，故用 TS 常量）。
- **AI 兜底**：语义级隐性倾向/前后矛盾走 chatViaGateway（平台内置模型），经 runWithCostConfirm 费用门禁；结果 origin=ai、UI 标注「AI · 待人工确认」，绝不自动处置。
- **持久化**：AI 发现存 ParseReport 新增独立字段 risk_ai_findings（type-only 引入 RiskFinding，无运行时环），不进 PARSE_* 分区枚举、不影响项计数与既有 parse 合并。
- **载体**：ParseReportPanel 派生分区（照「隐式硬约束」先例），项目流水线与快捷工具两处共用；不新建独立页面。

## 落点
| 文件 | 改动 |
|---|---|
| src/pages/BidWorkspace/tenderComplianceRisk.ts | 新建规则引擎（330 行，12 规则 + 阈值 + 汇总/合并/排序/AI 归一） |
| src/pages/BidWorkspace/tenderComplianceRisk.test.ts | 新建 27 例单测 |
| src/pages/BidWorkspace/bidTypes.ts | ParseReport 增 risk_ai_findings 字段 + type-only import |
| src/components/bid-workspace/ParseReportPanel.tsx | 合规风险派生分区 + 规则 memo + AI 深度体检（chatViaGateway/费用门禁） |
| src/pages/BidWorkspace/BidWorkspacePage.tsx | 两处调用透传 runWithCostConfirm/archived/costConfirm |
| src/components/bid-workspace/QuickToolsPanel.tsx | Pick 增 costConfirm + 透传 |

## 检测口径（规范映射）
- 八大禁止情形：注册资本/资产/营收/纳税规模门槛、本省本市业绩或注册地、指定品牌/专利/型号、厂家授权作资格、所有制/所在地限定等
- 六类隐形陷阱：验收以甲方满意为准（模糊验收）、★▲+独家/唯一/排他（疑似排他参数）等
- 七条量化红线：首付款<30%、维护费率<8%严拒/<10%底线、知识产权归甲方/共有、交付核心源代码、范围「包括但不限于」、接口免费/不限调用、电子病历/互联互通过级目标

## 实机回归（建阳区三甲医院集成平台项目，只读）
- 分区正常渲染，规则命中 红 5 / 黄 31（全部 36），分类 chips 正确
- 卡片含原文摘录 + 法规/规范依据 + 质疑/处置建议 + 行号（L1790 知识产权归甲方·红线03；L1124 规模条件·87号令第十七条）
- 隐式硬约束（40 条）等既有分区不受影响，解析项计数不变
- 截图：.qoder/r228_risk_panel.png

## 四门
- tsc 0 / vitest 1667 passed+2 skipped（+27 无回归）/ eslint 零新增 / build 3.25s

## 遗留
- DIS-scale 对投标格式模板占位行存在首过宽命中，交人工确认 + AI 复核；后置可加模板行降噪（backlog）。
- AI 深度体检实际 LLM 返回归一/合并待联网授权抽查。
- G3/G4/G5 后续独立轮次。
