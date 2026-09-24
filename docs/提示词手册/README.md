# 小智工作站 AI 提示词手册（分模块 · 含调用链）

> 版本：merged-v1.0/R32-2026-09-23　｜　母文档（单文件逐字原文全集）：[`../系统提示词分类手册.md`](../系统提示词分类手册.md)
> 本目录按场景把全部提示词拆成独立文件，并为每条补齐「触发 → 入口函数 → 网关 → 模型路由」调用链。逐字原文取自母文档，未改动。

## 模块文件索引

| 文件 | 覆盖 | 条数 |
|---|---|---|
| [`00-公共底座.md`](./00-公共底座.md) | 第一部分 公共底座（跨模块复用） | 11 |
| [`01-标书工作台.md`](./01-标书工作台.md) | 第二部分 标书工作台 BidWorkspace | 27 |
| [`02-方案工作室.md`](./02-方案工作室.md) | 第三部分 方案工作室 SolutionStudio | 4 |
| [`03-PPT与报价.md`](./03-PPT与报价.md) | 第四部分 PPT 与报价 PptQuote | 7 |
| [`04-客户管理.md`](./04-客户管理.md) | 第五部分 客户管理 CustomerManagement | 2 |
| [`05-竞品分析.md`](./05-竞品分析.md) | 第六部分 竞品分析 Competitors | 2 |
| [`06-情报中心.md`](./06-情报中心.md) | 第七部分 情报中心 IntelCenter | 2 |
| [`07-知识库问答.md`](./07-知识库问答.md) | 第八部分 知识库问答 | 1 |
| [`08-站内助手.md`](./08-站内助手.md) | 第九部分 站内助手「小智」 | 3 |
| [`09-其他内联工具.md`](./09-其他内联工具.md) | 第十部分 其他内联 / 工具 Prompt | 3 |

## 网关与模型路由（全局）

- 所有生成调用统一走前端 `@/lib/modelGateway.ts` 的 `chatViaGateway({ modelRef, messages, page, max_tokens, temperature, signal?, cacheable? })`。
- **个人模型优先**：选了用户配置的模型时，经 PocketBase 代理 `POST /api/model-gw/chat` 出站（前端绝不直连第三方）；`fallback_to_platform` 或无个人配置 → **自动回退平台内置 `gpt-5.5`**（走 `callLlmWithFallback`，poll-first）。
- **page 标签**（网关侧计费/日志维度）：`bid-workspace` / `solution-studio` / `ppt-quote` / `customer-management` / `competitors` / `intel-center` / `knowledge` / `assistant` / `model-config`。
- **技能注入**：`injectSkillBlock(messages, skillBlockFor(scope))` 在 bid/solution/ppt/customer/kb 侧把「用户指定工作技能」(9.3) 拼进 system；scope 如 `bid-parse`/`bid-defense`/`ppt-deck`/`quote-draft`/`customer-profile`/`kb-qa`/`checklist-match`。
- **确定性任务 temperature=0**：解析(2.1)、事实设定(2.22)、JSON 修复(2.25)、清单匹配(10.2)。
- **精确响应缓存 cacheable=true**：仅知识库问答(8.1)，命中口径=同模型+同完整 messages+同参数。
- **强制平台模型**：合规矩阵 AI 补扫(10.1) `modelRef:null`，不依赖页面选择。

## 调用链速查总表（全 62 条）

### 第一部分 公共底座（跨模块复用）

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 1.1 | TRUTH_IRON_RULES | 共享块：被 truthPreamble() 拼进标书全链(2.1–2.27) system 固定前置 | — | — | —（共享文本块） |
| 1.2 | COMMON_OUTPUT_RULES | 共享块：被 truthPreamble() 拼进标书全链 system | — | — | —（共享文本块） |
| 1.3 | truthPreamble() | 共享块：组装 1.1+1.2 为文本块，注入 2.1/2.2–2.13/2.22–2.24 等 system | — | — | —（共享文本块） |
| 1.4 | BID_STYLE_RULES | 共享块：末尾拼接进 2.6/2.7/2.8/2.9/2.10 等正文生成器 system | — | — | —（共享文本块） |
| 1.5 | FULLTEXT_GUARD_RULES | 共享块：同 1.4，正文生成器 system | — | — | —（共享文本块） |
| 1.6 | PARAM_RESPONSE_BOUNDARY_RULES | 共享块：同 1.4，正文生成器 system（防废标不放宽） | — | — | —（共享文本块） |
| 1.7 | PRE_OUTPUT_SELFCHECK_RULES | 共享块：同 1.4，正文生成器 system | — | — | —（共享文本块） |
| 1.8 | complianceModeRule(mode) | 共享块：按 mode 注入 2.6/2.7/2.8/2.9 正文生成器；不注入下游校验器 | — | — | —（共享文本块） |
| 1.9 | complianceOutlineRule(mode) | 共享块：按 mode 注入 2.2/2.3/2.4 大纲生成器 | — | — | —（共享文本块） |
| 1.10 | SOL_STYLE_RULES | 共享块：注入 3.2/3.3 方案正文/改写器 system | — | — | —（共享文本块） |
| 1.11 | solComplianceModeRule / solRefineModeRule | 共享块：注入 3.2 正文 / 3.3 扩写器 system | — | — | —（共享文本块） |

### 第二部分 标书工作台 BidWorkspace

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 2.1 | buildTenderParseMessages | 上传招标文件点「解析」/ 单项「重解析」(分块逐段) | runParseWith() / runReparseSection() | chatViaGateway(page=bid-workspace · temperature=0 · scope=bid-parse · max=8192) | 个人优先→平台兜底 |
| 2.2 | buildBidOutlineMessages | 解析后点「生成大纲」(leafGoal≤40 单次) | runGenerateOutline() | chatViaGateway(page=bid-workspace · max=4096) | 个人优先→平台兜底 |
| 2.3 | buildOutlineLevel1Messages | 分步大纲 Call1(leafGoal>40 自动) | runGenerateOutline() | chatViaGateway(page=bid-workspace · max=4096) | 个人优先→平台兜底 |
| 2.4 | buildOutlineChildrenMessages | 分步大纲 Call2 逐技术章展开 | runGenerateOutline() | chatViaGateway(page=bid-workspace · max=4096) | 个人优先→平台兜底 |
| 2.5 | buildOutlineFixMessages | 大纲本地校验不通过后一次结构修复 | runGenerateOutline() | chatViaGateway(page=bid-workspace · max=4096) | 个人优先→平台兜底 |
| 2.6 | buildBidChapterMessages | 逐章「生成正文」(章模式) | generateChapterContent() / runGenerateChapter() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.7 | buildBidSectionMessages | 小节级「生成 / 重生成」正文 | generateChapterContent() / runRegenerateSection() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.8 | buildBidContinueMessages | 章正文未达预算自动补足 / 手动「续写」 | runSupplementLoop() / runContinueChapter() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.9 | buildBidRefineMessages | 章「改写 / 扩写 / 精简」 | runRefineChapter() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.10 | buildSectionResizeMessages | 小节切片局部「扩写 / 缩写」 | runResizeSection() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.11 | buildDeviationMapMessages | 点「生成技术偏离表」 | runDeviationTable() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.12 | buildDupJudgeMessages | 标书查重相似段对 AI 复判 | runDupJudge()（工具版共用） | chatViaGateway(page=bid-workspace · max=4096) | 个人优先→平台兜底 |
| 2.13 | buildVoidCheckMessages | 投标前「废标风险自查」 | runVoidCheck()（工具版共用） | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.14 | buildEvalMessages | 「模拟评标」·技术路 | runEvalAll() / runEvalSinglePath() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.15 | buildEvalFormatMessages | 「模拟评标」·格式路 | runEvalAll() / startEvalPathRerun() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.16 | buildEvalCommercialMessages | 「模拟评标」·商务路 | runEvalAll() / startEvalPathRerun() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.17 | buildSubmissionCheckMessages | 「交卷体检」覆盖审计 | runSubmissionCheck() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.18 | buildDefenseQuestionsMessages | 答辩「生成问题池」 | runGenerateDefenseQuestions() | chatViaGateway(page=bid-workspace · scope=bid-defense · max=8192) | 个人优先→平台兜底 |
| 2.19 | buildDefenseAnswerMessages | 单个专家问题「生成完整答案」 | runGenerateFullAnswer() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.20 | buildDefenseOutlineMessages | 「讲标 PPT 大纲」生成 | runGenerateDefenseOutline() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.21 | buildSpeechNotesMessages | 「讲标稿要点」生成 | runGenerateSpeechNotes() | chatViaGateway(page=bid-workspace · scope=bid-defense · max=8192) | 个人优先→平台兜底 |
| 2.22 | buildFactSettingsMessages | 「生成全局事实设定」 | runGenerateFactSettings() | chatViaGateway(page=bid-workspace · temperature=0 · max=8192) | 个人优先→平台兜底 |
| 2.23 | buildFactCheckMessages | 「事实一致性核对」 | runFactCheck() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.24 | buildFactPatchMessages | 矛盾项「一键修复」生成补丁 | runFactPatch() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.25 | buildJsonRepairMessages | 模型 JSON 解析失败后自动语法修复重试 | withJsonRepair()（被各解析入口共用） | chatViaGateway(page=bid-workspace · temperature=0 · max=8192) | 个人优先→平台兜底 |
| 2.26 | buildOrchestrationMessages | 动笔前「预编排」(表格/配图/定向事实/焦点) 分批 | runOrchestration() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |
| 2.27 | buildCoverageAuditMessages | 写作方案「落地覆盖审计」 | runCoverageAudit() | chatViaGateway(page=bid-workspace · max=8192) | 个人优先→平台兜底 |

### 第三部分 方案工作室 SolutionStudio

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 3.1 | buildOutlineMessages | 新建方案点「生成大纲」 | generateOutlineDraft() | llmGenerate→chatViaGateway(page=solution-studio) | 个人优先→平台兜底 |
| 3.2 | buildChapterMessages | 逐章「生成正文」/「批量生成」 | runGenerateChapter() / runBulkGenerate() | llmGenerate→chatViaGateway(page=solution-studio) | 个人优先→平台兜底 |
| 3.3 | buildRefineMessages | 章「改写 / 扩写 / 精简」 | runRefineChapter() | llmGenerate→chatViaGateway(page=solution-studio) | 个人优先→平台兜底 |
| 3.4 | buildChapterReviewMessages | 章「五维自检评分」 | runChapterReview() | llmGenerate→chatViaGateway(page=solution-studio · max=MAX_TOKENS_REVIEW) | 个人优先→平台兜底 |

### 第四部分 PPT 与报价 PptQuote

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 4.0 | deckSystem(ctx) | 共享块：公共人设块，拼进 4.1/4.2/4.3 PPT 生成器 system | — | — | —（共享文本块） |
| 4.0b | VISUAL_RULES | 共享块：图文并茂规则块，拼进 4.1/4.3 system | — | — | —（共享文本块） |
| 4.1 | buildDeckSingleMessages | ≤10 页「一次生成整套 PPT」 | generateDeck()@536 | llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=8192) | 个人优先→平台兜底 |
| 4.2 | buildDeckOutlineMessages | 分批第一步「生成页大纲」 | generateDeck()@540 | llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=4096) | 个人优先→平台兜底 |
| 4.3 | buildDeckBatchMessages | 分批第二步「逐批生成正文」 | generateDeck()@548 | llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck) | 个人优先→平台兜底 |
| 4.4 | buildSlideRefineMessages | 单页「改写 / 扩写 / 精简」 | refineSlide()@683 | llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=4096) | 个人优先→平台兜底 |
| 4.5 | buildQuoteDraftMessages | 「报价清单初稿」生成 | genQuoteDraft()@1454 | llmGenerate→chatViaGateway(page=ppt-quote · scope=quote-draft · max=8192) | 个人优先→平台兜底 |

### 第五部分 客户管理 CustomerManagement

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 5.1 | PROFILE_SYSTEM_PROMPT / buildProfileMessages / buildExtractMessages | 医院详情「AI 补全档案」(输入医院名) / 粘贴文字「从文本提取」 | doAiMatch()@887 / extractFromText()@1016 | chatViaGateway(page=customer-management · scope=customer-profile · max=2000) | 个人优先→平台兜底 |
| 5.2 | buildSuggestionMessages | 商机详情「AI 跟进建议」 | useCustomerManagement@1546 | chatViaGateway(page=customer-management) | 个人优先→平台兜底 |

### 第六部分 竞品分析 Competitors

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 6.1 | ANALYSIS_SYSTEM_PROMPT | 竞品详情「AI 分析」 | useCompetitorAnalysis@201 | chatViaGateway(page=competitors · temperature=0.3 · max=4096) | 个人优先→平台兜底 |
| 6.2 | TALK_SYSTEM_PROMPT | 「生成差异化竞争话术」 | useCompetitorTalks@105 | chatViaGateway(page=competitors · temperature=0.4 · max=3072) | 个人优先→平台兜底 |

### 第七部分 情报中心 IntelCenter

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 7.1 | buildTagMessages | 情报条目「AI 摘要打标」/ 批量增强 | runAiTag()@1155 | chatViaGateway(page=intel-center · max=1024) | 个人优先→平台兜底 |
| 7.2 | doWeeklyReport 内联 prompt | 「生成售前情报周报」(近 7 天) | doWeeklyReport()@1494 | chatViaGateway(page=intel-center · max=2048) | 个人优先→平台兜底 |

### 第八部分 知识库问答

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 8.1 | KB_QA_SYSTEM_PROMPT | 知识库问答输入问题 | ask()@1333 | chatViaGateway(page=knowledge · scope=kb-qa · cacheable=true · max=4096) | 个人优先→平台兜底 |

### 第九部分 站内助手「小智」

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 9.1 | buildSystemPrompt | 小智对话发送 | useAssistant send()@642 | chatViaGateway(page=assistant · signal 可中断 · max=4096) | 个人优先→平台兜底 |
| 9.2 | MEMORY_FACT_RULES | 共享块：拼进 9.1 记忆抽取协议（同 isOneOffFact 口径）；与助手 send() 的 [[MEMORY]] 解析同约束 | — | — | —（共享文本块） |
| 9.3 | skillPromptBlock | 共享块：经 injectSkillBlock() 注入标书/方案/PPT/客户/知识库调用（按 scope 取技能） | — | — | —（共享文本块） |

### 第十部分 其他内联 / 工具 Prompt

| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |
|---|---|---|---|---|---|
| 10.1 | 合规矩阵 AI 补扫(内联) | 合规矩阵「AI 补扫」(四类条款) | runAiScan()@98 | chatViaGateway(page=bid-workspace · max=4096) | 强制平台 gpt-5.5 |
| 10.2 | 建设清单语义匹配(内联) | 建设清单导入后「语义匹配」 | checklistLogic@642 | llmGenerate→chatViaGateway(page=solution-studio · scope=checklist-match · temperature=0) | 个人优先→平台兜底 |
| 10.3 | TEST_PROMPT | 模型配置页「测试」 | testGatewayModel()@306 | 平台→callLlmWithFallback(page=model-config) · 个人→POST /api/model-gw/test | 个人优先→平台兜底 |

---

# 附录：提示词工程设计模式

1. **多消息缓存序**：稳定大块上下文（同项目/同份方案跨章 identical）作首条 user 前置，任务差异内容置后，以命中模型服务端前缀缓存（代表：2.6/2.7/3.2）。
2. **公共底座复用**：标书全链固定前置 truthPreamble（铁律+通用输出）；正文类统一拼接 BID_STYLE/FULLTEXT_GUARD/PARAM_BOUNDARY/PRE_OUTPUT_SELFCHECK 四块（见 1.1–1.7）。
3. **三档合规模式**：strict/moderate/full 控制“对标响应 vs 场景扩展 vs 架构补充”的尺度，参数边界块在所有模式下均不放宽（防废标）。
4. **宁缺毋滥防幻觉**：所有判定/审计类 prompt（查重/废标/格式/商务/覆盖审计）均带“拿不准不输出、无问题给空数组、必须附 evidence”的防误报铁律。
5. **结构化输出约束**：需要回填的调用统一要求“严格 JSON、禁止解释文字、禁止 markdown 代码围栏”，配合 buildJsonRepairMessages（2.25）做解析失败后的一次语法修复重试。
6. **全量版本标记**：标书侧统一携 `BID_PROMPT_VERSION = "merged-v1.0/R32-2026-09-23"`，便于回溯提示词变更。
