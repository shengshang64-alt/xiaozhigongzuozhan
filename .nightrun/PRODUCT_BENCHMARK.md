# 产品对标分析 · 售前工作台 vs 开源/商业同类产品（2026-09-18）

> 方法：按模块对标 GitHub 开源项目与商业产品，只列**本产品确实没有**的能力（已核对代码/文档：弹药库 QA 对、废标检查、模拟评标、FigureSpec 架构图、KB 七档脱敏、暗标、成本门禁、15 技能注入均已存在，不重复建议）。
> 优先级：高 = 直接提升交付物质量或复用现有数据；中 = 有价值但依赖外部条件；低/观望 = 跟风项，不建议现在做。

## 一、对标对象

| 类别 | 项目/产品 | 定位 |
|---|---|---|
| AI 标书（开源） | [run-llama/auto_rfp](https://github.com/run-llama/auto_rfp)、[BidMaster-Pro](https://github.com/guangshu100/BidMaster-Pro)、[OpenBidKit_Yibiao](https://github.com/FB208/OpenBidKit_Yibiao)、[good-autobid](https://github.com/ImGoodBai/good-autobid)、[ProposalLLM](https://github.com/William-GuoWei/ProposalLLM) | 招标解析→标书生成全流程，RAG+技能引擎 |
| RFP 响应管理（商业） | Responsive(原RFPIO)、Loopio、AutogenAI | 合规矩阵、内容库、需求抽取、分析看板 |
| 知识库/RAG（开源） | MaxKB、FastGPT、RAGFlow、Dify | 引用溯源、深度文档解析、知识运营 |
| AI PPT（开源/商业） | [PPTist](https://github.com/pipipi-pikachu/PPTist)、Ai-to-PPTX、Gamma | 模板式/Schema 式 AI 生成、可编辑导出 |
| 招采情报 | [剑鱼标讯](https://www.jianyu360.cn/)（[GitHub 组织](https://github.com/jianyu360)） | 订阅推送、竞对监测、中标预测 |
| CRM（开源） | Twenty、EspoCRM | 跟进提醒、流水线管理 |

## 二、差距清单（按优先级）

### 高优先级（建议进 backlog）

| # | 能力 | 对标来源 | 本产品现状 | 建议落点 |
|---|---|---|---|---|
| 1 | **条款-响应合规矩阵**（★/▲条款/评分项 → 章节 → 完全/部分/未响应 → 状态追踪） | Loopio/AutogenAI 核心卖点；AutoRFP 同思路 | 有废标检查、模拟评标，但没有「评分项→章节→响应状态」的可视化矩阵，漏响应靠人肉发现 | 在 AI 解析报告后自动生成矩阵；编制时逐条回填状态；导出对照表。直接呼应「评审专家」审查靶区的评分表映射 |
| 2 | **评分表/表格化条款的结构化解析** | RAGFlow 深度文档理解 | pdfjs 提文本为主，扫描件与评分表格易丢结构 | 解析环节加表格感知抽取，评分办法表 → 结构化评分项（矩阵 #1 的数据源） |
| 3 | **投标复盘与胜率分析** | 剑鱼大会员的中标预测/企业情报；Responsive analytics | bid_projects 已有 bid_result(won/lost/pending) 字段，但没有复盘页：落标原因结构化、胜率/报价命中率看板 | 零 AI 成本：已有数据直接出看板 + 落标原因结构化表单，反哺报价与方案策略 |
| 4 | **公司模板中心**（标书样式/封面/页眉页脚/盖章页；PPT 公司 VI 模板） | OpenBidKit 套模板；PPTist 模板式 AIPPT（AI_PPT_SCHEMA）；Ai-to-PPTX | Word 导出仅有页面格式（纸张/边距/页码），样式两级标题；PPT 从零生成 | 上传公司模板 → 导出按模板映射样式；PPT 按模板占位填充。对「直接对外」标准价值最大 |

### 中优先级

| # | 能力 | 对标来源 | 现状与建议 |
|---|---|---|---|
| 5 | 引用块级溯源（回答→原文段落锚点，点击跳转） | FastGPT/RAGFlow 的引用粒度 | KB 问答已有引用与 snippet；建议升级到段落锚点 + 小智回答/方案生成内容标注来源（「界面透镜」早已要求解析报告标原文位置） |
| 6 | 双模型互审（生成模型 vs 评委模型分离打分） | 多代理评审思路（autonomous-rfp-agent），但不必上完整多代理 | 已有多模型网关；模拟评标换一个模型当评委，可校正「AI 打分虚高」（评审专家角色明确提过 95 vs 70 偏差）；成本低 |
| 7 | 跟进到期提醒（next_follow_date → 首页待办聚合 + 到期红点） | Twenty/EspoCRM/剑鱼订阅 | 字段已存在，缺提醒闭环；零 AI 成本 |
| 8 | 案例结构化库（案例名/合同额/年限/佐证页码 → 响应引用） | Western 工具的 Past Performance 库 | 评委「无支撑的声称不给分」；KB 存文档但案例不结构化；生成响应时自动带佐证 |

### 低优先级 / 观望

| # | 能力 | 为什么降级 |
|---|---|---|
| 9 | 招标公告订阅推送/自动抓取 | 数据源是硬瓶颈（单机+合规），可先做半自动：邮件转发/RSS 解析入情报池 |
| 10 | 知识运营统计（引用次数/过期提醒/重复检测） | 有价值但不痛 |
| 11 | 完整多 Agent 流水线 | BidMaster-Pro 式架构噱头大于收益；本产品七步流水线+单 Agent 已覆盖，不建议跟风重写 |

## 三、明确不建议做的

- 换/加 UI 框架、重写状态管理（红线 4.5 伪优化）。
- 通用 IM/邮件集成（超出单机售前工具边界）。
- 为「更智能」把暗标/脱敏/成本门禁自动化掉——这些是人工确认闸门（红线 4.2/流程透镜禁止项）。

## 四、落地路径建议

1. #1+#2 合并为一个专项：「解析 → 合规矩阵」是同一条数据链（表格抽取产出矩阵输入）。
2. #3 一个修复轮即可出 MVP（纯统计+表单）。
3. #4 分两步：先标书 Word 样式模板（docx 库已具备能力），再 PPT 模板（pptxgenjs 支持 defineSlideMaster）。
