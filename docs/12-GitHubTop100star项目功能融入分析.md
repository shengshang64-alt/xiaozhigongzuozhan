# 12 · GitHub 全站 Star 前 100 项目 · 功能融入分析

> 数据来源：GitHub Search API 实时拉取（`stars:>10000, sort=stars`，2026-10-07），前 100 名 star 区间 116k–552k。
> 视角与 docs/10 互补：docs/10 回答"**用哪个库补领域能力**"（OCR/检索/解析），本篇回答"**全站最火的产品里，哪些功能形态值得抄进售前工作台**"。
> 方法：先分类（排除无功能可借鉴的清单/教程类）→ 对产品型项目逐个核 README → 对照本系统模块、roadmap 与"明确不做"清单 → 给出批次。
> 本文件只做分析，未改动任何生产代码。

---

## 一、结论先行

前 100 名里 **80 个左右是教程/awesome 清单/语言框架/agent 生态**，没有可直接融入的功能；真正值得借鉴的是约 **20 个产品型项目**。能落到本项目上的功能共 **10 项**，按性价比排序：

| 批次 | 可融入功能 | 来源项目 | 落点模块 | 落地形态 | 成本 |
|---|---|---|---|---|---|
| 一 | 多模型并排出稿对比 + 生成结果评分 | Open WebUI (154k) | Assistant / SolutionStudio | 纯前端，现有网关直连 | 低 |
| 一 | 生成审计与用量 trace（who/模型/token/耗时/引用） | Dify (158k) | 全局 + 质量台账 | PocketBase 加表，roadmap 已列 | 低 |
| 一 | 提示词中心产品化（分类/变量占位/收藏/版本） | prompts.chat (172k) + anthropics/skills (180k) | 新页面（存量手册已有内容） | 纯前端 | 低 |
| 一 | 命令面板升级：跨实体搜索 + AI 快捷动作 + 选中文本改写 | PowerToys (139k) | 已有 GlobalCommandPalette | 纯前端（cmdk 已装） | 低 |
| 二 | 情报流水线产品形态：逐源运行历史/失败原因/重试退避/手动触发 | n8n (207k) | IntelCenter（roadmap 三.1 已列） | UI 形态借鉴，抓取引擎仍走 crawlee | 中 |
| 二 | 知识库人工标注层：人工修正问答对优先命中 | Dify | Knowledge | PocketBase 加表 + 检索前置一层 | 中 |
| 二 | 本地模型档（脱敏摘要/嵌入兜底/离线演示） | Ollama (182k) | ModelConfig | Ollama 暴露 OpenAI 兼容 API，网关直接加一路 | 中 |
| 二 | 方案架构图可编辑画布（AI 生成元素 + 导出 png/svg） | Excalidraw (133k) | SolutionStudio | React 同栈 MIT，与 docs/10 的 X6 二选一 | 中 |
| 三 | "投标宪法" + 规格驱动生成链（需求→规格→章节→收敛检查） | spec-kit (140k) | 全局提示词规范 + BidWorkspace/SolutionStudio | 形态借鉴（模板+检查清单） | 中远期 |
| 三 | 消息渠道推送架构（待办/情报快报/投标日历推企微钉钉 bot） | openclaw (392k) | 不做 IM，只做出站推送 | Gateway 形态借鉴 | 中远期 |

**与 docs/10 的重叠说明**：firecrawl（AGPL 警示）、markitdown（入库统一转 Markdown）在 docs/10 已做过判断，本篇不重复展开；Ollama 与 docs/10 的 transformers.js 是互补关系（服务端兜底 vs 浏览器内嵌），不冲突。

---

## 二、Top 100 分类全景

| 类别 | 数量 | 代表 | 对本项目的意义 |
|---|---:|---|---|
| 教程 / awesome 清单 / 学习资源 | 33 | awesome、build-your-own-x、freeCodeCamp、hello-algo | 无产品功能可借鉴 |
| 语言 / 框架 / 运行时 / 基建 | 20 | react、next.js、electron、shadcn-ui、kubernetes | 技术底座：react/vite/shadcn/pocketbase 已在用 |
| AI 编码 Agent 与技能生态 | 16 | claude-code、codex、superpowers、ECC、deepseek-harness、anthropics/skills | 借鉴**思想**（技能沉淀/插件化/审计），非产品功能 |
| **产品型应用** | **20** | n8n、dify、open-webui、excalidraw、AutoGPT、Ollama、ComfyUI… | **本篇主角，逐项判断见第三节** |
| 与本产品无交集 | 11 | rustdesk、scrcpy、clash-verge、v2rayN、iptv、MAS | 排除 |

值得注意的格局：**约 1/4 席位被 2025–2026 年爆发的 AI agent/技能生态占据**（openclaw 以 392k 冲到第 6）。这印证了 roadmap 的判断：本项目的"人工确认环节 + 提示词资产"路线，与业界"agent + 可复用技能"趋势是一致的。

---

## 三、20 个产品型项目逐项判断

### 3.1 值得融入（第一批：低成本高确定性）

#### ① Open WebUI → 「多模型并排出稿」与「生成评分」
- **功能**：同一提示词多模型并排生成对比（arena 模式）、对话分支与重新生成、👍/👎 反馈收集、RAG 引用溯源 UI。
- **落点**：Assistant / SolutionStudio / BidWorkspace 的章节生成。售前文稿质量主观性强，"3 个模型各出一稿 → 人选一稿改"比"单模型重试"更省时间；评分数据顺手沉淀为**评测集**（docs/10 第三批第 12 项正缺数据来源）。
- **形态**：纯前端，modelConfig 网关已有路数；加一张 `gen_feedback` 表即可。
- **成本**：低（1–2 天量级）。

#### ② Dify → 「生成审计/用量 trace」+「知识库人工标注层」
- **功能**：每次 LLM 调用的完整 trace（输入/输出/模型/token/耗时/引用的检索片段）落库可查；知识库 Annotation（人工修正过的问答对在检索时优先命中）。
- **落点**：trace 直接对齐 roadmap 三.2「AI 成本与用量透明化」与三.5「审计日志」——一次落地吃掉两项。标注层解决真实痛点：模拟评标/废标自查里 AI 答错的口径，人工纠正一次后**全项目复用**。
- **形态**：PocketBase 加 `llm_trace`、`kb_annotation` 两表；检索层在 `searchKbDocs()` 前加一层标注精确匹配（与 docs/10 的两阶段混合检索改造点重合，可一并做）。
- **成本**：低–中。

#### ③ prompts.chat + anthropics/skills → 「提示词中心」产品化
- **功能**：提示词库的浏览/分类/变量占位符/收藏；SKILL.md 的"元数据 + 渐进披露"结构。
- **落点**：项目已有 `docs/提示词手册`、`系统提示词分类手册`、`05-标书与方案生成三模式提示词设计`——**内容资产已经在，只是躺在 markdown 里**。产品化成应用内页面后，售前同事不碰代码也能用上评审过的提示词；提示词加版本号后，审计日志（②）可追溯到"生成时用的提示词版本"。
- **形态**：新页面 + 现有提示词文档导入脚本。
- **成本**：低。

#### ④ PowerToys → 命令面板升级（全局效率入口）
- **功能**：Command Palette（全局 Ctrl+K 唤起任何动作）、Advanced Paste（剪贴板内容 AI 一键改写）。
- **落点**：`GlobalCommandPalette.tsx` 已有雏形（206 行，导航级）。升级三步：a) 跨实体搜索（客户/标书/知识条目）；b) 动作化（"生成报价初稿""查资质有效期""新建投标任务"直接从面板发起）；c) 选中文本 → AI 改写（脱敏/精简/转正式文风），接 FormatTool。
- **成本**：低，cmdk 组件已在依赖里。

### 3.2 值得融入（第二批：与 roadmap 服务化对齐）

#### ⑤ n8n → 情报流水线的「产品形态」
- **功能**：节点化流水线、逐节点运行状态与历史、失败重试与退避、schedule trigger、手动触发按钮。
- **落点**：IntelCenter。roadmap 三.1 的"情报采集服务化"要解决的"关页面就停 + 14 个失败源无法逐个定位"（roadmap 一.4），n8n 的**运行历史/逐源失败原因/行内重试**正是这套运维界面的标准答案。不引 n8n 本体（fair-code、太重、双系统），引擎仍按 docs/10 用 crawlee。
- **成本**：中。

#### ⑥ browser-use → 复杂情报源的浏览器自动化兜底
- **功能**：LLM 驱动的浏览器操作 agent，能处理 JS 渲染、多步跳转的页面。
- **落点**：情报侧车（Python）里作为 crawlee 的兜底通道：静态/API 页走 crawlee，渲染复杂页走 browser-use。**边界不变**：只访问公开挂网页面，不绕反爬（roadmap"明确不做"红线）。
- **成本**：中（依赖侧车进程，见 docs/10 约束）。

#### ⑦ Ollama → 本地模型档
- **功能**：本地一键跑 GLM/Qwen/DeepSeek/bge 等，暴露 OpenAI 兼容 API。
- **落点**：ModelConfig 里加"本地 Ollama"供应商档。三个用途：a) 暗标脱敏摘要等敏感任务**不出本机**；b) embedding 模型（bge 系列）给 docs/10 的混合检索当服务端方案——与 transformers.js 浏览器方案二选一或互补；c) 断网/低配环境演示兜底。
- **成本**：中（零代码改动即可接入，主要是部署与机器资源权衡；注意本机 C 盘爆满问题见 docs/10 第七节，模型必须装 D 盘）。

#### ⑧ Excalidraw → 方案架构图可编辑画布
- **功能**：手绘风白板、React 原生组件（`@excalidraw/excalidraw`）、可编程生成元素、导出 png/svg/embed。MIT 许可，商用干净。
- **落点**：SolutionStudio 的架构图环节。现状 mermaid 只能"渲染不能改"；excalidraw 与 docs/10 推荐的 antvis/X6 是同赛道二选一：**要快、要轻、要 AI 一键生成初稿选 excalidraw；要严谨拓扑/连线规则选 X6**。建议先用 excalidraw 的"AI 生成初稿 + 手动拖改"试水。
- **成本**：中。

### 3.3 观望 / 远期（第三批）

#### ⑨ spec-kit → 「投标宪法」+ 规格驱动交付链
spec-kit 的核心不是代码而是流程资产：**constitution（不可违背的原则）→ spec → plan → tasks → 每步一致性检查**。映射到售前：把公司级红线（资质引用规范、报价底线、话术口径、废标自查 21 项）做成"投标宪法"，注入所有生成链并在每次出稿后做收敛检查。**不建议直接套它的工具链**（面向编码 agent），但"宪法 → 模板 → 检查清单"三层结构对本项目的提示词治理有直接参考价值。中远期。

#### ⑩ openclaw → 消息出站推送架构
openclaw（392k，全站第 6）的形态是"本地 Gateway + 你已在用的聊天渠道"。roadmap 明确不做 IM，但**出站推送**不冲突：待办到期、投标日历、情报快报、资质到期（QualCerts 已有 90/30 天预警数据）推到企业微信/钉钉 bot，兜底"必须开着页面才知道事"的问题。借鉴其 Gateway/channel 抽象即可。中远期。

#### 其余观望项（不展开）
| 项目 | 功能点 | 观望理由 |
|---|---|---|
| MoneyPrinterTurbo (128k) | 一键生成讲标/产品短视频（脚本→素材→字幕→合成） | 有想象空间但需 ffmpeg/侧车 + 素材库，收益未验证 |
| AUTOMATIC1111/stable-diffusion-webui (165k) | 方案封面/PPT 配图生成 | 医疗标书对配图严谨性要求高，AI 配图收益存疑 |
| Langflow (156k) / ComfyUI (136k) | 节点式可视化编排 AI 流水线 | 对单团队本地场景是过度设计；等生成链稳定后再看 |
| Graphify-Labs/graphify (124k) | 文档/SQL/PDF → 可查询知识图谱（tree-sitter 确定性解析） | 思路可借鉴：用**确定性实体倒排**（医院/厂商/规范名）补语义盲区，不上图数据库；与 docs/10 对 LightRAG 的否决一致 |
| hermes-agent (252k) | 从经验沉淀技能、跨会话记忆、检索自己的历史对话 | 理念与③提示词中心相通：让"每次项目沉淀下来的有效话术"自动回流资产库，远期 |
| cc-switch (141k) | 多供应商一键切换 + 供应商健康检查 | ModelConfig 可加"供应商探活/一键切换默认链路"，锦上添花 |
| x1xhlol/system-prompts-and-models-of-ai-tools (144k) | 各家 AI 产品的系统提示词全文 | **仅参考结构与边界写法**（角色→工具→禁区→输出格式），用于打磨本项目系统提示词；注意内容版权，不照抄 |
| AutoGPT (188k) | agent 的三种触发方式（手动/定时/事件）+ 运行结果汇报卡 | UX 形态可抄给情报/生成任务；自主 agent 本体不做（"明确不做"全自动投标） |

### 3.4 明确不融入

| 项目 | 理由 |
|---|---|
| n8n / Dify / Open WebUI / AutoGPT / Langflow / ComfyUI **本体** | 完整平台，引入即"双系统双权限双数据源"，与 docs/10 第六节否决 RAGFlow/NocoDB 同理——**抄功能形态，不引系统** |
| firecrawl 本体 | AGPL-3.0，网络服务对外（含医院演示访问）会触发 §13 开源义务；docs/10 已判，用其思路或 MIT 替代 |
| PPTist | 未进前 100，但同赛道提醒：AGPL + Vue 双不适配（docs/10 已判） |
| rustdesk / scrcpy / clash-verge / v2rayN / MAS / iptv-org / yt-dlp / youtube-dl | 与售前业务无交集；其中 MAS（Windows 激活）与本项目无关且合规风险自负 |
| shadcn-ui / react / vite 生态 | 已在用（components.json 即 shadcn），无动作 |

---

## 四、落地建议（对齐 roadmap）

第一批四项（①–④）的共同特征：**纯前端 + PocketBase 加表、零新重依赖、不触碰 R124 懒加载红线**，且全部服务于"严谨性 > 自动化"的总原则——审计让生成可追溯，评分让质量可度量，提示词中心让资产可复用。建议在 roadmap「近期补强」收尾后插入。

第二批四项（⑤–⑧）均依赖侧车或新依赖，**与 docs/10 第一/二批存在共享基建**（情报服务化进程、Python 侧车、模型缓存 D 盘迁移），建议合并到同一批工程里做，避免两次动环境。

一个执行注意：docs/10 第七节实测的 **C 盘 0 可用**问题对第二批所有项（Ollama 模型、browser-use 环境、侧车）仍是前置阻塞，先清盘。

---

*报告完 · star 数据 2026-10-07 实时拉取；本项目现状核验基于 docs/06、docs/10、roadmap 及源码（GlobalCommandPalette/QualCerts 等）。*
