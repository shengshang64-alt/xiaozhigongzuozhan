// ---------------------------------------------------------------------------
// T14（2026-09-29）解析通道重构：整文直读（易标客户端 bid-analysis 方式移植）
//
// 与 T12 检索通道（sectionParse + tenderRetrieval）的本质差异：
//  - 整份招标文件作为共享上下文一次进 Prompt（system 稳定 → user 文件 → user 任务），
//    各解析项之间逐字节同前缀，吃提供商侧提示词缓存——首项全价、其余项缓存价；
//  - 结构化项输出 JSON 契约（数组字段防评分表错位），落库前摊平为既有行式文本，
//    下游 extractScoringFromText / 大纲 / 覆盖矩阵 / 评标零改动；
//  - 文件超限走切段（tenderSplit）+ AI 合并（buildSegmentMergeMessages），
//    切段块对各项一致，缓存同样跨项复用；段数超上限回退检索通道。
// 注意：system 提示词与文件 message 必须逐字节稳定（任何一项之间不能差一个字符），
// 否则缓存全灭；技能块经 injectSkillBlock 追加在 system 末尾不影响前缀稳定性。
// 2026-10 易标提示词对齐轮：tech_score/biz_score 任务注入「评分项 vs 评分要求」语义区分
// （易标 v2.17.2 修复「评分要求误识别为评分项」+ 最新 techRequirements 分类原则）——
// 只有需在技术/商务标中展开编写的具体评分内容才进 items，约束/扣分/判定规则禁止入 items，
// 防止通用评审规则被当成评分项建章、进评标映射。
// ---------------------------------------------------------------------------

import type { LlmMessage } from "@/lib/llm"
import { parseSectionTitle } from "../bidTypes"
import { PARSE_FIELD_LABELS } from "../parseSchemas"

/** 整文通道文件字数上限：≤ 该值走整文直读（约 4 万 token 输入，主流 128k 模型安全） */
export const WHOLE_FILE_LIMIT = 60000
/** 切段通道单段字数上限（对齐整文上限的 3/4，留足 system + 任务 + 输出余量） */
export const PARSE_SEGMENT_CHARS = 45000
/**
 * 切段通道段数上限：超过说明文件过于超长，回退检索通道（防 单项 × N 段 费用爆炸）。
 *
 * R288+（2026-10-13 真实场景实测，主导者修复）：原值 6 使 38 万字的真实招标文件
 * （381,609 字 / PARSE_SEGMENT_CHARS 45,000 = 9 段）的 17/22 个通用项**全部回落「关键词检索」**——
 * 实测解析产出仅约 3 万字、覆盖率 8%，其中「响应文件要求」「投标文件目录要求」直接解析为空，
 * 而这两项正是大纲硬依赖（OUTLINE_DEPEND_KEYS）→ 覆盖率门禁阻断生成 → 大标书根本走不完链路。
 * 提到 20（20 × 45,000 ≈ 90 万字，覆盖已知最大标书 76 万字 = 17 段）让通用项同样走
 * 「整文全量覆盖 + 跨段合并」；仍保留 < CRITICAL 的分层语义（关键项另有放宽）。
 * 费用随段数线性增长，已获用户明确授权（「标书不能打折扣，不用担心费用」）。
 */
export const PARSE_MAX_SEGMENTS = 20
/**
 * R-038 Slice B（R260）：废标/评分关键项的切段上限——这些项漏一条即废标/丢分，必须整文全量覆盖。
 * 放宽段数上限让它们走「切段 + 跨段 AI 合并」（全量覆盖，且评分项/废标项跨块汇总），
 * 而非回落检索通道（仅 1 个关键词窗口，长文档实测覆盖 4%~10%，漏掉的正是散落各章的评分表/否决条款）。
 * 24 段 × 45000 字 ≈ 108 万字，覆盖已知超长标书（天坛 41.7 万字 = 10 段）；仍超限才回落检索兜底。
 * 代价：关键项调用数随段数线性增长（并发经限流闸门错峰、跨项同段吃提示词缓存，成本有界）——已就 R-038 授权。
 */
export const PARSE_MAX_SEGMENTS_CRITICAL = 24
/** R-038② 「评分项/废标项必须跨块汇总」的落点：涉及废标/丢分的解析项需整文全量覆盖 + 跨段合并。 */
const FULL_COVERAGE_PARSE_KEYS: ReadonlySet<string> = new Set([
  "tech_score",
  "biz_score",
  "void_items",
  "qualification",
  "compliance",
])
/** 判定解析项是否需要整文全量覆盖（废标/评分关键项）。 */
export function isFullCoverageParseItem(key: string): boolean {
  return FULL_COVERAGE_PARSE_KEYS.has(key)
}
/**
 * R-038 Slice B：按解析项返回切段段数上限——废标/评分关键项放宽到 CRITICAL（整文全量覆盖 + 跨块汇总），
 * 其余项沿用通用上限（超限回落检索，控成本）。超限一律回落检索兜底，绝不无界放大调用数。
 */
export function parseSegmentCap(key: string): number {
  return isFullCoverageParseItem(key) ? PARSE_MAX_SEGMENTS_CRITICAL : PARSE_MAX_SEGMENTS
}
/** 缓存预热等待：首项成功后停顿，等提供商登记提示词缓存再并发剩余项（易标同款经验值） */
export const PARSE_WARMUP_DELAY_MS = 5000

/**
 * 稳定系统提示词：所有解析项共享、逐字不变（缓存前缀的第一段）。
 * 第 5/6 条吸收 T-DOCX/T-PDF 表格感知提取与 T13 附表定位的口径，整文通道同样适用。
 */
export const PARSE_WHOLE_SYSTEM_PROMPT = [
  "你是专业的投标资料分析助手。请严格基于用户提供的上下文完成提取和总结。",
  "",
  "通用要求：",
  "1. 保持信息全面、准确，优先使用用户提供上下文中的内容；除非具体任务明确要求或允许根据经验补充，否则不要自行编造。",
  "2. 如果上下文没有提及，明确写“没有提及”，禁止推测补写。",
  "3. 只输出最终结果，不输出过程、提示语或客套话。",
  "4. 始终使用简体中文。",
  "5. 招标文件中的表格已转写为「列1 | 列2 | 列3」竖线分隔格式，一行即表格一行；提取表格信息时按竖线拆列对应字段，不得忽略竖线后的列。",
  "6. 评分表可能不在正文而在「评标办法前附表」「附件：评分细则」等附表里，请逐处定位后合并提取。",
].join("\n")

/** 结构化项走 JSON 契约；叙述项（原文摘录+经验补充类）markdown 直出更稳，不硬上 JSON */
const JSON_PARSE_KEYS = new Set([
  "overview",
  "tech_score",
  "biz_score",
  "project_info",
  "purchaser_info",
  "agency_info",
  "delivery_req",
  "response_req",
  "bid_nodes",
  "bid_deposit",
  "bid_open_req",
  "eval_req",
  "contract_terms",
  "compilation_basis",
  "purchase_list",
  "lots",
  "bid_outline_req",
])

export function isJsonParseItem(key: string): boolean {
  return JSON_PARSE_KEYS.has(key)
}

/** JSON 契约约束三条（移植易标 jsonTask，一字不改——「只改 value」是防结构漂移的关键） */
function jsonTask(title: string, goals: string, outputJson: string): string {
  return `任务：${title}

目标：${goals}

约束：
1. 输出格式必须为 JSON。
2. 严格按照以下 JSON 格式输出，只修改 value，禁止修改 key 和结构。
3. 招标文件中没有的字段填充“没有提及”。

JSON 格式：
${outputJson}

仅输出 JSON，不要输出其他内容。`
}

const TECH_SCORE_TASK = jsonTask(
  "提取招标文件中的「技术评分要求」，供技术方案 1 对 1 应答式编写",
  [
    "重点识别与「技术评分」「评标办法」「评标方法」「评分标准」「评审因素」「打分表」相关的章节与附表（含投标人须知前附表的评标方法行、附件中的评分细则表）；忽略商务、价格、资质等非技术评分项。",
    "语义区分（防止把约束规则误当成评分项）：",
    "① 技术评分项：投标人需要在技术方案中一一响应、展开编写，并可对应形成技术方案章节的具体评分内容（方案类、措施类、团队类、实施类、服务类、保障类、运维类、应急类、检查类等）——只有这类内容才填入 items；",
    "② 技术评分要求：仅用于约束评分、解释评分、定义扣分或判定规则的通用规则或说明（符合性要求、偏离扣分规则、判定口径、适用范围说明、表后说明、通用评审规则等）——这类内容禁止填入 items，禁止为其虚构名称与分值；判断依据是该内容是否要求投标人在技术方案中展开具体方案内容。",
    "填写要求：",
    "1. score_composition：原文声明了总分构成时抄录「总分 N 分（技术 N 分、商务 N 分、价格 N 分）」，只抄原文声明的数字，禁止自行计算或汇总；未声明写“没有提及”。",
    "2. items 数组逐项填写每个技术评分项：name=评分项名称；score=分值数字（只填数字，如 3）；criteria=评分标准（详细档位与给分条件，如「≥95%得满分，每低1%扣0.5分」）；source=出处（章节/条款/页码）。",
    "3. 评分表有四种排布，都必须逐条提取，不得因排布形态不同而漏项：①竖线表格行——按列拆分对应「评分项 | 分值 | 评审标准」，禁止忽略竖线后的列；②展平行（Word 表格被展平成文本段落后的形态）——行首是评分项名称（2～24 字、不含标点），紧跟一个分值数字（可带「分」），数字之后是评分标准正文，三者挤在同一行，如「综合实力 3 息安全服务资质认证，认证覆盖的业务范围包含软件安全开发服务。」；这种行本身就是评分项，name 取行首名称、score 取紧随其后的数字、criteria 取该数字之后的全部文字；③名称被拆成多行、分值单独成行——如「高质量软」「件产品或服务交付 | 4 |」「能力」三行，须跨行拼回完整名称后取分值；④**首列是编号**——行首是 B1/B2/T1/T8/1-1/3-2 这类编号（含「1、」「2、」阿拉伯序号），编号所在列不是评分项名称，此时 name 从该行描述正文里提炼主题（如「B1 | 3 | 根据投标人提供的同类项目服务单位出具的…」→ name 取「同类项目服务单位满意度」并保留编号前缀「B1 」），score 取编号列之后的分值列，criteria 取分值之后的全部文字；**禁止仅因首列是编号、不是称谓就跳过整行**；宽表逐行提取，一个评分项的名称、分值、标准三者不得因拆列或换行而丢失。",
    "4. 展平行与编号列的两个陷阱，必须避开：①原文换页会把一句评分标准截成两行，于是本行的评分标准常从句中开始（上一行以「⑥信」结尾、本行以「息安全…」开头即是如此）——这种断句是原文排版本来的样子，不构成「无法确定是否为评分项」的理由，仍须按第 3 条②提取；②**这条只约束展平行，不约束竖线表格行**——对展平行，行首必须是评分项称谓（如「综合实力」「运维管理」「参数响应」「总体设计方案」）才是评分项；若行首是「上述资质每满足」「每满足」「有一份业绩合同加」这类评分标准正文的句中片段，或该行本身就在描述给分/扣分条件，则它不是评分项；但对带竖线、列数≥2 且首列是编号的行，一律按第 3 条④提取，不得套用本条跳过。",
    "5. **第 4 条②的例外（必须遵守）**：「XX的响应方案（除“▲”标识的技术条款外）进行评价：完全满足招标要求的得 N 分；每负偏离 1 项技术参数要求扣 0.1 分」这种行虽然通篇在讲给分/扣分条件，但它是**整体响应方案评分项**，与「XX相关技术参数的响应情况进行评价」是并列的两类，必须提取。判据（三条同时满足即提取）：①该行有独立编号（如 1-27）；②该行有独立分值列且分值 > 0；③该行是评分表的独立一行，不是上一行的续行。缺任意一条才按第 4 条②跳过。",
    "6. 首列是编号的宽表，一个评分项只出一次：同一编号在素材里可能因换页重复出现，按编号去重，不要拆成多条；编号写在 name 前缀或 source 里，便于回溯原文。",
    "7. 分值必须与原文一致；存在二级子项时在 name 中用编号体现层级；尽量覆盖全部技术评分项不遗漏；某条内容无法确定是评分项还是约束规则时，宁可不填入 items，也不得编造。",
  ].join("\n"),
  `{"score_composition":"总分 N 分（技术 N 分、商务 N 分、价格 N 分）或没有提及","items":[{"name":"","score":"","criteria":"","source":""}]}`,
)

const BIZ_SCORE_TASK = jsonTask(
  "提取招标文件中的「商务评分要求」（含价格分），供商务标应答与得分策略制定",
  [
    "重点识别评分办法（评标办法）中的商务部分与价格部分：商务/信誉/业绩/服务类评分表、价格评分公式、技术-商务-价格分值划分说明；忽略技术评分项（另有专门解析项承担）。",
    "语义区分（与技术评分同口径）：需要投标人在商务标中展开响应、对应形成商务章节的具体评分内容才填入 items；仅用于约束评分、定义扣分或判定规则的通用规则（符合性要求、偏离扣分总则等）禁止填入 items。",
    "填写要求：",
    "1. score_composition：只抄原文声明的总分构成，禁止自行计算汇总；未声明写“没有提及”。",
    "2. items 数组逐项填写：name=评分项名称；score=分值数字；criteria=评分标准或计算公式（价格评分只给公式时公式完整抄录，如「投标基准价/投标价×30」）；source=出处。",
    "3. 商业与技术的边界按原文分值表归属判断，无法判断的按商务处理并在 criteria 末尾注明「（边界存疑）」。",
    "4. 首列是编号的评分行必须提取：行首为 B1/B2/T1/1-1/3-2 或「1、」「2、」这类编号时，编号列不是名称，name 从该行描述正文提炼主题并保留编号前缀，score 取其后分值列，criteria 取分值之后的全部文字；禁止仅因首列是编号就跳过整行。同一编号重复出现（换页所致）按编号去重，一个评分项只出一次。",
    "5. **表头行禁止输出**：「1 价格因素」「2 商务因素」「3 价格因素」「3、价格因素」这类只标明评分大类、不带层级编号（如 2-1 / 3-1）、也没有独立分值的行，是**评分表的表头**，不是评分项，一律不得填入 items。价格项只输出带编号的具体项（如「3-1 价格评分」）。判据：name 里没有「数字-数字」形态的层级编号、且原文该行没有独立分值列 → 是表头，跳过。",
  ].join("\n"),
  `{"score_composition":"总分 N 分（技术 N 分、商务 N 分、价格 N 分）或没有提及","items":[{"name":"","score":"","criteria":"","source":""}]}`,
)

const OVERVIEW_TASK = jsonTask(
  "提取并总结项目概述",
  [
    "按六个维度提取，只提与项目实施有关的内容，不提取商务信息（报价、保证金、资质、废标条款）：",
    "1. 项目基本信息：project_name/tender_no/project_type/purchaser/budget/project_address，逐项保留原文表述；",
    "2. 背景目的（background）：建设背景与采购目的一句话；",
    "3. 规模预算（scale）：建设规模/投资/预算金额，保留原文金额与单位；",
    "4. 时间安排（schedule 数组）：工期、投标截止、开标等关键节点，node=节点名、time=时间，逐条保留时间原文表述；",
    "5. 建设内容（scope_of_work）：实施内容与范围要点；",
    "6. 技术特点（tech_features）与其他关键要求（other）。",
  ].join("\n"),
  `{"project_name":"","tender_no":"","project_type":"","purchaser":"","budget":"","project_address":"","background":"","scale":"","schedule":[{"node":"","time":""}],"scope_of_work":"","tech_features":"","other":""}`,
)

const PROJECT_INFO_TASK = jsonTask(
  "提取项目基础信息",
  "提取项目背景、建设内容概况、工期要求、资金来源与落实情况。项目名称/编号/采购人/预算金额等基本信息字段不重复输出（已由项目概述项承担），技术需求明细不归本项（属交货和服务要求）。",
  `{"project_background":"","construction_content":"","duration":"","funding":""}`,
)

const PURCHASER_INFO_TASK = jsonTask(
  "提取甲方（采购人）信息",
  "提取采购人名称、联系人与联系方式、地址。",
  `{"purchaser_name":"","contact_person":"","contact_phone":"","address":""}`,
)

const AGENCY_INFO_TASK = jsonTask(
  "提取采购代理机构信息",
  "提取代理机构名称、联系人、联系电话、邮箱、地址。",
  `{"agency_name":"","contact_person":"","contact_phone":"","email":"","address":""}`,
)

const DELIVERY_REQ_TASK = jsonTask(
  "提取交货和服务要求",
  [
    "提取技术需求与交货/服务要求：实施周期/工期（implementation_period）、交付范围（delivery_scope）、交付地点（delivery_location）、验收要求（acceptance）、质保期（warranty）、售后服务（after_sales）、响应时限（response_time）、培训要求（training）、技术需求要点（tech_requirements，功能要求/性能指标逐条换行填写）。",
  ].join("\n"),
  `{"implementation_period":"","delivery_scope":"","delivery_location":"","acceptance":"","warranty":"","after_sales":"","response_time":"","training":"","tech_requirements":""}`,
)

const RESPONSE_REQ_TASK = jsonTask(
  "提取响应文件（投标文件）编制与递交要求",
  [
    "composition 数组：响应文件的组成部分（报价文件/商务文件/技术文件/资格证明/承诺函/授权委托书/响应表/偏离表等），逐项一条；",
    "format_requirements 数组：格式、签字盖章、命名、密封上传等实质性要求，逐条一条；",
    "binding_copies=装订份数；deadline=递交截止时间（保留时间原文）；submission_method=递交方式；signature_seal=签字盖章要求。",
  ].join("\n"),
  `{"composition":[""],"format_requirements":[""],"signature_seal":"","binding_copies":"","deadline":"","submission_method":""}`,
)

const BID_NODES_TASK = jsonTask(
  "提取投标关键时间节点",
  "提取报名、答疑、保证金缴纳、投标文件递交截止、开标、质疑/异议截止、公示等关键时间节点；node=节点名、time=时间，逐条保留招标文件的时间原文表述。",
  `{"nodes":[{"node":"","time":""}]}`,
)

const BID_DEPOSIT_TASK = jsonTask(
  "提取投标保证金要求",
  "提取保证金金额（amount）、缴纳形式（payment_method，转账/支票/保函等）、收款账户（account）、缴纳截止时间（deadline）、退还条件与时限（refund_conditions）。",
  `{"amount":"","payment_method":"","account":"","deadline":"","refund_conditions":""}`,
)

const BID_OPEN_REQ_TASK = jsonTask(
  "提取开标要求",
  "提取开标时间地点（time_place）、参与要求（requirements）、无效标认定（invalid_bid_rules）、开标流程与解密要求（process）。",
  `{"time_place":"","requirements":"","invalid_bid_rules":"","process":""}`,
)

const EVAL_REQ_TASK = jsonTask(
  "提取评标要求",
  "提取评标委员会组成与职责（committee）、评标方法类型（method）、评标程序与原则（principles）、其他评标相关说明（others）。",
  `{"committee":"","method":"","principles":"","others":""}`,
)

const CONTRACT_TERMS_TASK = jsonTask(
  "提取合同关键条款",
  "提取中标公示（award_notice）、合同签订时限（signing_deadline）、履约保证金（performance_bond）、合同解除与终止条款（termination）、质保期与缺陷责任期衔接（warranty_linkage）、争议解决（disputes）。",
  `{"award_notice":"","signing_deadline":"","performance_bond":"","termination":"","warranty_linkage":"","disputes":""}`,
)

const COMPILATION_BASIS_TASK = jsonTask(
  "提取编制依据与规范",
  "提取招标文件中要求或提及的编制依据、标准规范清单（国家标准/行业标准/技术文件/法律法规）。standards 数组每条一条「编号 名称」，保留原文编号格式，如「GB/T 22239-2019 信息安全技术 网络安全等级保护基本要求」。",
  `{"standards":[""]}`,
)

const PURCHASE_LIST_TASK = jsonTask(
  "提取采购清单",
  "提取采购货物/服务清单：name=名称、spec=规格型号/关键参数、qty=数量、note=备注（预算/限价/交付要求等）。未划分清单时 items 为空数组。",
  `{"items":[{"name":"","spec":"","qty":"","note":""}]}`,
)

const LOTS_TASK = jsonTask(
  "提取标包划分",
  "提取招标文件划分的标包/标段/包件清单：no=包号、title=包名称、budget=预算金额或最高限价、summary=主要内容摘要，逐条保留原文表述；未划分标包时 lots 为空数组。",
  `{"lots":[{"no":"","title":"","budget":"","summary":""}]}`,
)

const BID_OUTLINE_REQ_TASK = jsonTask(
  "提取投标文件目录要求",
  [
    "提取招标文件中对投标文件/技术标目录结构的规定（「投标文件格式」章的目录/组成名录）：no=原编号、title=条目名、level=层级（1=一级，2=二级，以此类推）。",
    "逐条录出、保留原编号与层级，禁止自造目录项；招标文件未规定目录结构时 outline 为空数组。",
  ].join("\n"),
  `{"outline":[{"no":"","title":"","level":1}]}`,
)

/** 叙述项 markdown 口径（不套 JSON）：void_items 沿用 T12 两层口径（条款/重点补充），经验补充克制可溯源 */
const VOID_ITEMS_TASK = [
  "任务：提取并分析招标文件中的「无效标与废标项」。",
  "",
  "概念边界：「无效投标」指投标人、投标文件、签章密封、递交时间、报价、保证金、资格条件、实质性响应等原因导致投标被认定为无效、否决、不予受理或按无效响应处理的情形；「废标项」指可能导致项目废标、采购失败、重新招标、终止评审、有效投标人不足或实质性响应不足的条款或风险项。原文使用「否决投标」「投标无效」「不予受理」「无效响应」「重大偏差」「实质性偏离」等同义表达的，一并归类提取。",
  "",
  "输出分两层、每行一条：先列原文明确出现的条款，尽量保留原文关键句，行首加「条款：」；再补原文未明确提及、但结合本项目类型与招投标经验判断非常重要的高风险遗漏项，行首加「重点补充：」并用一句话说明为何需要关注，经验补充最多 3 条，没有明显高风险遗漏则不输出补充行。",
  "禁止罗列泛泛的通用清单、禁止把与本项目无关的常见废标项硬凑进来；电子标项目须覆盖 CA 有效期、电子签章、加密上传、解密时限等电子投标废标风险。",
].join("\n")

const QUALIFICATION_TASK = [
  "任务：提取招标文件中的资格性审查要求。",
  "输出投标人资格要求（营业执照、行业资质、业绩、认证证书、信用等），每行一条；强制（不满足即无效投标）的条目加「[强制]」前缀，加分项加「[加分]」前缀；尽量保留原文关键表述，禁止罗列与本项目无关的通用资质清单。",
].join("\n")

const COMPLIANCE_TASK = [
  "任务：总结招标文件中的符合性检查要求。",
  "输出符合性审查要点（资格与格式之外的无效投标审查项，如实质性响应、偏差处理、文件有效性），每行一条，直接给硬指标或结论；找不到的内容直接省略，禁止臆造。",
].join("\n")

/** 整文通道任务 prompt（user 第 2 条消息，唯一逐项变化的部分——缓存前缀止于此） */
export function buildWholeParseTask(key: string): string {
  switch (key) {
    case "overview":
      return OVERVIEW_TASK
    case "tech_score":
      return TECH_SCORE_TASK
    case "biz_score":
      return BIZ_SCORE_TASK
    case "project_info":
      return PROJECT_INFO_TASK
    case "purchaser_info":
      return PURCHASER_INFO_TASK
    case "agency_info":
      return AGENCY_INFO_TASK
    case "delivery_req":
      return DELIVERY_REQ_TASK
    case "response_req":
      return RESPONSE_REQ_TASK
    case "bid_nodes":
      return BID_NODES_TASK
    case "bid_deposit":
      return BID_DEPOSIT_TASK
    case "bid_open_req":
      return BID_OPEN_REQ_TASK
    case "eval_req":
      return EVAL_REQ_TASK
    case "contract_terms":
      return CONTRACT_TERMS_TASK
    case "compilation_basis":
      return COMPILATION_BASIS_TASK
    case "purchase_list":
      return PURCHASE_LIST_TASK
    case "lots":
      return LOTS_TASK
    case "bid_outline_req":
      return BID_OUTLINE_REQ_TASK
    case "void_items":
      return VOID_ITEMS_TASK
    case "qualification":
      return QUALIFICATION_TASK
    case "compliance":
      return COMPLIANCE_TASK
    default:
      return [
        `任务：从招标文件中提取「${parseSectionTitle(key)}」。`,
        "要点化：一行一条要点，直接给硬指标或结论，尽量用原文关键表述；找不到则省略对应行，禁止臆造；同一信息不与其他任务重复提取。",
      ].join("\n")
  }
}

/**
 * 整文通道消息结构：[system 稳定] → [user 文件] → [user 任务]。
 * 文件 message 对所有解析项逐字节一致（含分段序号时对同段各项一致）——这是跨项缓存的前提。
 *
 * REQ-029：`scoringMaterial` 非空时，文件 message 换成**评分表素材**（见
 * buildScoringMaterialFileContent）。此时只有 tech_score/biz_score 两份共用这段前缀，
 * 与其余项不再逐字节一致——这是本条明知并如实暴露的代价：这两项失去跨项缓存，
 * 换来的是模型不必在 4.5 万字/段里自己找评分表。不传该参数时行为与改前**逐字节一致**。
 */
export function buildWholeParseMessages(
  key: string,
  fileText: string,
  seg?: { index: number; total: number },
  scoringMaterial?: string,
): LlmMessage[] {
  const material = (scoringMaterial ?? "").trim()
  const fileContent = material
    ? buildScoringMaterialFileContent(material, seg)
    : buildWholeFileContent(fileText, seg)
  return [
    { role: "system", content: PARSE_WHOLE_SYSTEM_PROMPT },
    { role: "user", content: fileContent },
    { role: "user", content: buildWholeParseTask(key) },
  ]
}

export function buildWholeFileContent(fileText: string, seg?: { index: number; total: number }): string {
  const head = seg
    ? `以下是招标文件的第 ${seg.index}/${seg.total} 段原文（文件超长被按段解析，各段解析结果之后会统一合并；本段可能不含任务所需信息，没有就写“没有提及”）：`
    : "以下是完整招标文件。后续任务需要基于这份招标文件完成："
  return `${head}\n\n${fileText}`
}

/**
 * REQ-029（2026-10-17）：**评分项专用文件消息**——「换输入、不换输出」。
 *
 * 缺陷（史矛革实测用户库 17 个有原文项目）：`buildScoringMaterial` 全库只有一个生产调用点，
 * 在 `parseSectionViaRetrieval` 内；而真实项目 **15 个走 whole、只有 2 个走 retrieval**。
 * 于是 REQ-018 的表锚定与 REQ-020 的整章取材+整行取舍，在用户日常路径上一分收益都拿不到：
 *  - REQ-020 的 #46（评分章 56,523）与 #60（33,759）在 whole 下根本不经过；
 *  - REQ-018 那 9 份里 6 份原文 4.0–5.7 万字 → 整文直读，也不经过。
 *
 * 修法：**只替换 user 文件消息**，system 与任务（含 JSON 契约）逐字不动——
 * 输出契约 `{score_composition, items[{name,score,criteria,source}]}` 不变，
 * 下游 `flattenParseItemJson` / `extractScoringFromText` 零改动。
 *
 * 为什么是「替换成素材」而不是「原文 + 素材」：
 * 天坛原文 41.3 万字要切 10 段，每段 4.5 万字里评分表只占几百字——模型在每段里都要自己
 * 判断「这 4.5 万字里有没有评分项」，这正是 REQ-016「综合实力 3」3/3 次全丢的机制。
 * 而素材只有 9,493 字、一次调用装得下，评分表整章连续可见。追加原文会让输入更大、
 * 注意力更散，等于把病加重。
 *
 * 素材为空时回退原文（16 份「原文无评分表」的文件行为完全不变）。
 */
export function buildScoringMaterialFileContent(
  scoringMaterial: string,
  seg?: { index: number; total: number },
): string {
  const base = seg
    ? `以下是系统从招标文件中定位出的评分表素材第 ${seg.index}/${seg.total} 段（原文的评分办法/评标办法章节与评分表，其余章节已省略；本段可能不含任务所需信息，没有就写“没有提及”）：`
    : "以下是系统从招标文件中定位出的评分表素材（原文的评分办法/评标办法章节与评分表，其余章节已省略）。后续任务需要基于这份素材完成："
  return `${base}${multiPackNotice(scoringMaterial)}\n\n${normalizeFlattenedScoreRows(scoringMaterial)}`
}

/**
 * REQ-029：多合同包（多包）评分表提示。
 *
 * 缺陷：一份招标文件含「合同包01/02/03」时，各包的评分表**结构相同、编号都从 2-1 起、
 * 正文常逐字节相同**（实测新建46：`2-1 管理体系认证证书…` 一行 273 字，在原文出现 3 次，
 * 分别在合同包1/2/3 名下）。模型按段解析，每段各出一份 2-1…2-17，产出里没有任何包标识——
 * 用户在界面上就看到「2-1 管理体系认证」重复三遍，看着像重复抽取，实际是三个包各自的评分项。
 *
 * 修法：段内有包标记时，在文件消息头上点名本段涉及的包，并要求同一编号跨包重复时
 * 在 name 前加「包NN 」前缀。这样合并后的项能区分归属，不必也不该按编号粗暴去重
 *（去重会丢掉另外两个包真实的评分项）。
 */
function multiPackNotice(material: string): string {
  const packs = [...new Set([...material.matchAll(/合同包\s*(0?\d+)/g)].map((m) => m[1].padStart(2, "0")))]
  const lotPacks = [...new Set([...material.matchAll(/采购包\s*(0?\d+)/g)].map((m) => m[1].padStart(2, "0")))]
  const all = [...new Set([...packs, ...lotPacks])].sort()
  if (!all.length) return ""
  return `\n本次素材涉及合同包：${all.map((p) => `包${p}`).join("、")}。各包的评分项相互独立（编号可能重复、正文可能雷同，但属于不同包、都必须提取）：请在每个评分项的 name 前加「包NN 」前缀标明归属（如「包01 2-1 管理体系认证证书」）；同一包内同编号只出一条。`
}

/** 展平行识别：行首短名称 + 分值 + 描述（三者以空白分隔、无竖线） */
const FLATTENED_ROW = /^([^\s|｜。；，、：:（）()]{2,24})\s+(\d{1,3}(?:\.\d+)?)\s*分?\s+(\S.{7,})$/

/**
 * 行首片段是否**不可能是评分项名称**（而是评分标准正文的句中片段）。
 * 用于挡住「上述资质每满足 1 项得 0.5 分，本项满分 3 分。」这类给分条件行被误认成新评分项。
 */
const NOT_A_NAME = /满足|不少于|满分|缺漏|要点|上述|有一份|及以上|不低于|中任|每项|该项|本项|得分|扣分/

/**
 * REQ-029：把「展平行」还原成块级标注三行（【评分项】/【分值】/【评审标准】）。
 *
 * 为什需要：天坛那张技术评分表在 docx 里**不是 Word 表格**，mammoth 展平成段落，
 * 单元格按列内联进段落里，于是「综合实力」与「3」被插进了评分标准正文中间——
 * 素材原文是 `<p>综合实力 3 息安全服务资质认证，认证覆盖的业务范围包含软件安全开发服务。</p>`
 * （「息安全…」是上一行「⑥信」被换页截断后的下半句）。模型按「竖线表格行」的纪律读，
 * 视这种行为散文，`TECH_SCORE_TASK` 第 4 条「无法确定是评分项还是约束规则时宁可不填」直接跳过它。
 *
 * 实测（真网关 Ling-3.1-flash，temperature 0，disable_thinking）：
 *  - 原素材：16 项，「综合实力」缺（3/3 次全缺）；
 *  - 只改提示词、要求模型自己认展平行：仍 16 项，缺（3/3 次）；
 *  - 把这 3 行改写成块级标注：**17 项，「综合实力」在、score=3**（探针 G 变体 C）。
 *  - 对照：靠挪动行位置也能凑出 18 项，但会多出 2 个假项（「高质量软件产品…（1）/（2）」拆项），
 *    所以选块级标注而不是挪位置。
 *
 * 只作用于 whole 通道的评分项文件消息；`buildScoringMaterial` 的产出**一个字节都不改**，
 * 因此海沧 12,437 字等素材层锚点逐字节不变。
 */
export function normalizeFlattenedScoreRows(src: string): string {
  if (!src) return src
  const out: string[] = []
  for (const line of src.split("\n")) {
    const t = line.trim()
    // 已带竖线的行是 tableRowsToLines 的正常产物，不动它
    if (t && !/[|｜]/.test(t)) {
      const m = FLATTENED_ROW.exec(t)
      if (m && !NOT_A_NAME.test(m[1])) {
        const score = Number(m[2])
        if (score > 0 && score <= 100) {
          // 原文换页会把评分标准截成两行，「综合实力」这一行承接的正是上一行的下半句
          //（上一行以「⑥信」结尾、本行以「息安全…」开头）。若不接回，criteria 会以半句开头，
          //模型仍会判成「无法确定」而跳过——实测：不接回时 3/3 次仍缺，接回后 17 项且在。
          let lead = ""
          const prev = out.length ? out[out.length - 1] : ""
          const prevPlain = prev && !/[|｜]/.test(prev) && !/^【/.test(prev.trim()) && prev.trim().length > 0
          if (prevPlain && !/[。；：:!！?？]$/.test(prev.trim())) {
            lead = prev.trim()
            out.pop()
          }
          out.push(`【评分项】${m[1]}`, `【分值】${m[2]}`, `【评审标准】${lead}${m[3]}`)
          continue
        }
      }
    }
    out.push(line)
  }
  return out.join("\n")
}

/**
 * REQ-029：按**合同包边界**切分评分表素材（优先于按字数机械切）。
 *
 * 缺陷（实测新建46）：素材 56,596 字按 12,000 字机械切成 5 段，而文件是「合同包01/02/03」
 * 三个独立包的结构（包边界行「合同包NN评标方法：」）。机械切导致**同一个包被劈进两段**：
 *   段3 = 包01 尾部（1-45~1-48）+ 包02 开头（1-1~1-23）
 * 模型在段3只出了包02 那一批 23 项，包01 的 1-45~1-48 一条不出——
 * 这正是「段3 覆盖率 52%」的真实成因，不是模型漏抽，也不是 clipText 裁剪。
 *
 * 修法：只要素材里出现 ≥2 个包标记，就以每个包的起点为边界切段，一个包一段；
 * 单包超长时再按整行二次切分（仍不切在句中），包内编号唯一。
 * 没有包标记的素材（天坛/金山60 等）走原整行切分，行为不变。
 */
export function splitScoringMaterialByPack(
  material: string,
  maxChars: number,
): ScoringSegment[] {
  const src = material ?? ""
  if (!src) return []
  const lines = src.split("\n")
  const packStarts: { line: number; pack: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const no = matchPackBoundary(lines[i])
    if (no) packStarts.push({ line: i, pack: `包${no.padStart(2, "0")}` })
  }
  // 单包或无包标记：按评分行数切（同样不能用大字数阈值——金山60 素材 33,777 字整份投喂时
  // 实测只出 50 项就中断，T10~T13 全丢；按行数切后能完整覆盖）。
  // REQ-039：单包标书**同样**要做首行标注——福安 T1(39分)/海沧 1-1(2分)/安庆价格分 30
  // 都紧贴表头，是权重最大的项。此处原先直接返回、不经 withSegmentHeader，导致标注漏掉
  // 单包这一整类（实测福安/海沧标注 0 段）。前缀仍不加（pack 为空）。
  if (packStarts.length < 2) {
    return sliceByScoreRowBudget(src, maxChars, SCORING_PACK_MAX_ROWS).map((s) => {
      const text = markFirstScoreRow(s.text)
      return { ...s, text, kind: segmentKind(text) }
    })
  }
  const out: ScoringSegment[] = []
  // 第一个包标记之前的内容（须知/资格条件）单独成段——这类段没有编号评分行，模型应出 0 项。
  if (packStarts[0].line > 0) {
    const head = lines.slice(0, packStarts[0].line).join("\n").trim()
    if (head) out.push({ text: head, kind: segmentKind(head) })
  }
  for (let k = 0; k < packStarts.length; k++) {
    const start = packStarts[k].line
    const end = k + 1 < packStarts.length ? packStarts[k + 1].line : lines.length
    const body = lines.slice(start, end).join("\n").trim()
    if (!body) continue
    // 有「②技术项 / ③商务项 / ④加分项」分组标题时，按**分组标题**切段并用它定类型。
    // 这类表的编号列是「行号」（金山60：`2、总体方案设计 | 1 | 2-1根据…` 里 2-1 是第二行，
    // 不是商务项），拿编号判类型会把技术项整段误判成商务项、切成碎片。
    const groups = splitByScoreGroup(body)
    if (groups.length > 1) {
      for (const g of groups) {
        for (const piece of sliceByScoreRowBudget(g.text, maxChars, SCORING_PACK_MAX_ROWS, g.kind)) {
          out.push({
            text: withSegmentHeader(piece.text, packStarts[k].pack, g.kind ?? segmentKind(piece.text)),
            pack: packStarts[k].pack,
            kind: g.kind ?? segmentKind(piece.text),
          })
        }
      }
      continue
    }
    for (const piece of sliceByScoreRowBudget(body, maxChars, SCORING_PACK_MAX_ROWS)) {
      const kind = segmentKind(piece.text)
      // REQ-029：每段头部显式带上包与类型标记——
      //  ① 切碎后片段里若没有「合同包NN评标方法」那行，模型就忘了加「包NN 」前缀
      //     （实测 9 段方案下前缀率从 100% 掉到 93%，碎片段更是 0%）；
      //  ② 段类型写进段头，配合 dispatchKeysForSegment 避免商务段被 tech_score 抽走。
      out.push({ text: withSegmentHeader(piece.text, packStarts[k].pack, kind), pack: packStarts[k].pack, kind })
    }
  }
  return out
}

/**
 * 按「②技术项 / ③商务项 / ④加分项 / ①价格项」分组标题把一段包正文切开，并直接给出类型。
 *
 * 为什么必须按标题而不是按编号：金山60 的评分表是 `名称 | 分值 | 编号+描述`，
 * 第三列的 1-1/2-1/3-1 是**表内行号**而非评分类型——`2、总体方案设计 | 1 | 2-1…` 明明在
 * 「②技术项」组内，按编号会误判成商务项，把技术段切碎、还让 biz_score 去抽技术内容。
 * 只有含 ≥2 个分组标题时才按标题切；没有分组标题的表（新建46）走编号切，行为不变。
 */
function splitByScoreGroup(body: string): { text: string; kind: ScoringSegmentKind }[] {
  const lines = (body ?? "").split("\n")
  const marks: { line: number; kind: ScoringSegmentKind }[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    // 顺序要紧：先判「商务项/加分项/价格项」，再判「技术项」——
    // 「④加分项」的正文里常出现「技术项（F2×A2）」字样（节能减排加分说明），
    // 若先匹配技术项，整个加分段会被误归为 tech，biz_score 就看不到它了。
    if (/[①②③④⑤⑥]?\s*价格项\s*[（(]/.test(t)) marks.push({ line: i, kind: "price" })
    else if (/[①②③④⑤⑥]?\s*(加分项|商务项)\s*[（(]|^[①②③④⑤⑥]?\s*(加分项|商务评分)/.test(t)) marks.push({ line: i, kind: "biz" })
    else if (/^[①②③④⑤⑥]?\s*技术项\s*[（(]|^[①②③④⑤⑥]?\s*技术评分/.test(t)) marks.push({ line: i, kind: "tech" })
  }
  if (marks.length < 2) return []
  const out: { text: string; kind: ScoringSegmentKind }[] = []
  // 第一个分组标题之前的内容（评标办法总则等）单独成段，保持原文顺序，避免整包顺序错乱
  if (marks[0].line > 0) {
    const head = lines.slice(0, marks[0].line).join("\n").trim()
    if (head) out.push({ text: head, kind: "none" })
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].line
    const end = i + 1 < marks.length ? marks[i + 1].line : lines.length
    const text = lines.slice(start, end).join("\n").trim()
    if (text) out.push({ text, kind: marks[i].kind })
  }
  // 同一 kind 相邻合并，减少无意义碎片（标题前后常有换页碎行）
  const merged: { text: string; kind: ScoringSegmentKind }[] = []
  for (const g of out) {
    const last = merged[merged.length - 1]
    if (last && last.kind === g.kind) last.text = `${last.text}\n${g.text}`
    else merged.push({ ...g })
  }
  return merged
}

/** 评分段类型：tech=1-x/T-x 技术项，biz=2-x/B-x 商务项，price=3-x 价格项，none=无编号行 */
export type ScoringSegmentKind = "tech" | "biz" | "price" | "none"

export type ScoringSegment = { text: string; pack?: string; kind?: ScoringSegmentKind }

/** 按段内编号行的前缀判定段类型（一段只含一种类型，这是 sliceByScoreRowBudget 的保证） */
export function segmentKind(text: string): ScoringSegmentKind {
  const t = text ?? ""
  // ① 段首标记优先：splitScoringMaterialByPack 会在每段加「【本段属于 包NN · X评分项】」
  const mark = /【本段属于\s*包\d+\s*·\s*(技术|商务|价格)评分项】/.exec(t)
  if (mark) return mark[1] === "技术" ? "tech" : mark[1] === "商务" ? "biz" : "price"
  // ② 分组标题次之（不再藏在「无编号行」条件里）：单包 + 分组标题的标书靠这条才判得对。
  //    「④加分项」正文里常含「技术项（F2×A2）」字样，所以先看商务项是否存在。
  const hasTech = /^[①②③④⑤⑥]?\s*技术项\s*[（(]/m.test(t) || /^[①②③④⑤⑥]?\s*技术评分/m.test(t)
  const hasBiz = /[①②③④⑤⑥]?\s*(商务项|加分项)\s*[（(]/m.test(t)
  const hasPrice = /[①②③④⑤⑥]?\s*价格项\s*[（(]/m.test(t)
  if (hasBiz && !hasTech) return "biz"
  if (hasPrice && !hasTech && !hasBiz) return "price"
  if (hasTech && !hasBiz) return "tech"
  // ③ 编号首段兜底
  const kinds = new Set<string>()
  for (const l of t.split("\n")) {
    const id = rowIdOf(l)
    if (!id) continue
    const n = /^(\d+)-\d+$/.exec(id)
    if (n) kinds.add(n[1])
    // `#N` 是安庆四列表的序号锚点（`1 | 投 标 价 格 分 | 30 分 | …`）。
    // 直接 replace(/\d+$/,"") 会剥成只剩 "#"，kinds 变成 ["#"]，整段判成 none——
    // 实测这是 REQ-041，只在「多段 + 混合表无分组标题」时触发（安庆单段走 wholeFile 绕过）。
    else if (id.startsWith("#")) kinds.add(id.slice(1))
    else kinds.add(id.replace(/\d+$/, ""))
  }
  if (!kinds.size) return "none"
  if (kinds.has("1") || kinds.has("T")) return "tech"
  if (kinds.has("3")) return "price"
  if (kinds.has("2") || kinds.has("B")) return "biz"
  return "none"
}

/**
 * 取一行里的评分项编号（1-1 / T1 / B2），取不到返回 null。
 *
 * 两种实测形态（缺一种就会把整张表判成「无编号」）：
 *   ① 编号在行首：`1-1 | 投标人提供…`（新建46）
 *   ② 编号在**第三列开头**：`1、投标响应情况 | 29 | 1-1根据各投标人…`（金山60）
 * 只看行首会把金山60 的包01/包02 整张评分表判成 none，进而两个 key 都跑、污染重现。
 */
export function rowIdOf(line: string): string | null {
  const l = line ?? ""
  // ① 编号在行首、后接竖线：`1-1 | 投标人提供…`（新建46）
  const head = /^\s*(\d+-\d+|[A-Z]\d{1,2})\s*[|｜]/.exec(l)
  if (head) return head[1]
  // ② 编号在行首、后接顿号/句点：`T1、技术服务响应程度 | 39 | …`（福安）
  const headCn = /^\s*(\d+-\d+|[A-Z]\d{1,2})\s*[、.．,，]\s*\S/.exec(l)
  if (headCn && /[|｜]/.test(l)) return headCn[1]
  // ③ 编号在**第三列**开头：`1、投标响应情况 | 29 | 1-1根据各投标人…`（金山60）
  //    编号后紧跟中文/字母，无需空格
  const third = /^[^|｜]*[|｜][^|｜]*[|｜]\s*(\d+-\d+|[A-Z]\d{1,2})(?=[\u4e00-\u9fa5A-Za-z（(《]|\s|$)/.exec(l)
  if (third) return third[1]
  // ④ 纯数字序号 + 竖线：`1 | 投标价格分 | 30 分 | 评分标准说明`（安庆四列）
  //    必须**恰好四列**（序号|评审因素|分值|说明）才认——三列的 `21 | 评标方法 | 综合评分方法`、
  //    `8 | 第三章9.5 | 本项目是否…` 这类须知行会被误判成评分行，实测让安庆首条错成 #21。
  //    序号是「第几个评审因素」，同一序号可对应多条子项（安庆的 2/2/2、12/12/12），
  //    所以只作为「这是评分行」的标记，不当作唯一编号参与去重。
  const plain = /^\s*(\d{1,3})\s*[|｜]\s*\S/.exec(l)
  if (plain && (l.match(/[|｜]/g) ?? []).length === 3) return `#${plain[1]}`
  return null
}

/**
 * 从一行素材取「分值」：兼容四种真实列位（2026-10-18 四锚点实测）。
 *   ① 金山60/福安/海沧：`主编号 | 分值 | 细则编号+描述` → 第 2 列
 *   ② 新建46：`1-1 | 描述 | 2`                        → 最后一列
 *   ③ 安庆（四列）：`序号 | 评审因素 | 30 分 | 评分标准说明` → 第 3 列（带「分」字）
 *   ④ 展平行：`综合实力 3 描述…`                       → 「名称 数字 描述」
 * 注意：安庆的分值写「30 分」（数字与分之间有空格），num() 已用 \s* 兼容。
 */
export function scoreOfRow(line: string): number | null {
  const t = (line ?? "").trim()
  if (!t) return null
  const cells = t.split(/\s*[|｜]\s*/).map((s) => s.trim())
  const num = (s: string): number | null => {
    const m = /^(\d+(?:\.\d+)?)\s*分?$/.exec((s ?? "").trim())
    return m ? Number(m[1]) : null
  }
  if (cells.length >= 4) {
    // 四列：优先第 3 列（安庆 `序号|评审因素|30 分|说明`），再第 2 列，最后最后一列
    const c3 = num(cells[2])
    if (c3 !== null) return c3
    const c2 = num(cells[1])
    if (c2 !== null) return c2
    return num(cells[cells.length - 1])
  }
  if (cells.length === 3) {
    const c2 = num(cells[1])
    if (c2 !== null) return c2
    return num(cells[cells.length - 1])
  }
  if (cells.length === 2) return num(cells[1])
  const m = /^([^\s|｜。；，、：:（）()]{2,24})\s+(\d{1,3}(?:\.\d+)?)\s*分?\s+\S.{7,}$/.exec(t)
  return m ? Number(m[2]) : null
}

/**
 * 段内「应有评分项数与分值合计」——用于校验模型是否漏抽（REQ-039 确定性判据）。
 *
 * 为什么需要（实测 2026-10-18，金山60 段5 同一输入三轮不同产出）：
 *   run1 出 16 项含「1、投标响应情况 29 分」；run2 出 15 项缺它；run3 又出 15 项缺它。
 *   29 分是包01 技术项满分 58 分的一半，是最大单项——**表头后第一行**最容易被跳过。
 *   靠模型自觉不可靠，所以用素材侧的分值合计作为确定性对照。
 */
export function segmentScoreExpectation(text: string): { rows: number; sum: number } {
  let rows = 0
  let sum = 0
  for (const line of (text ?? "").split("\n")) {
    if (!rowIdOf(line)) continue
    const sc = scoreOfRow(line)
    if (sc === null) continue
    rows++
    sum += sc
  }
  // 浮点累加误差归一（保留两位）
  return { rows, sum: Math.round(sum * 100) / 100 }
}

/**
 * 按段类型分派解析 key：技术段只发 tech_score，商务/价格段只发 biz_score。
 *
 * 为什么必须分派（实测 2026-10-18）：段切对了但每段同时发给两个 key 时，
 * 商务段（只含 2-x）发给 tech_score，模型没技术项可抽就把商务项硬抽出来——
 * #46 三个包的商务段各被 tech_score 抽走 6 条，共 18 条跨口径污染。
 * 分派后 tech 116/116、biz 52/52、污染 0。
 */
export function dispatchKeysForSegment(kind: ScoringSegmentKind | undefined, keys: string[]): string[] {
  if (kind === "tech") return keys.filter((k) => k === "tech_score")
  if (kind === "biz" || kind === "price") return keys.filter((k) => k === "biz_score")
  // none（前置须知段）：没有编号评分行，两个 key 都不必跑，省一次调用
  return []
}

/**
 * 识别「合同包/采购包/项目包」的**起点行**，返回包号（无则为 null）。
 *
 * 两种实测形态（都来自真实语料，缺一种就会漏掉整份文件的按包切分）：
 *   - 新建46：`合同包01评标方法： 综合评分法`
 *   - 金山60：`采购包1采用综合评分法：`      ← 词序不同，必须单独匹配
 *
 * 同时挡住汇总行：`7.1评标方法： 项目包1,项目包2,项目包3采用综合评分法。`
 * 该行一次性罗列三个包，若按「项目包N」匹配会凭空多出 3 个假起点，
 * 把整份素材切成碎片。判据：包号之后**紧跟**包级谓语、且行内不再出现第二个包号。
 */
function matchPackBoundary(line: string): string | null {
  const t = (line ?? "").trim()
  if (!t || t.length > 60) return null
  const m = /^(?:合同包|采购包|项目包)\s*(0?\d+)\s*(?:评标方法|评分方法|采用综合评分法)/.exec(t)
  if (!m) return null
  // 汇总行（同一行出现第二个包号）不是起点
  const rest = t.slice(m[0].length)
  if (/(?:合同包|采购包|项目包)\s*0?\d+/.test(rest)) return null
  return m[1]
}

/** 每段最多装多少条编号评分行（实测：>30 条时模型开始丢尾部） */
export const SCORING_PACK_MAX_ROWS = 25

/**
 * 包内切分：**按编号评分行数**切，而不是按字数切。
 *
 * 为什么不能按字数（史矛革 2026-10-18 实测，我复核一致）：
 *   包01 19,984 字含 65 条评分行，按 45,000 字阈值整包一次投喂，模型只出 38 条（58%），
 *   尾部 1-45~1-48 全丢；包02 49 条出 31 条（63%）；包03 54 条出 37 条（69%）。
 *   规律是**输入越长产出率越低**，丢的总是尾部——这是单次输出预算问题，不是素材缺失
 *  （同批数据里 1-45~1-48 在 prompt 层实测可见，见 productionRoutes.txt，丢失 0）。
 *
 * 所以按「评分行条数」切：每段 ≤ SCORING_PACK_MAX_ROWS 条，保证单次输出装得下；
 * 同时保留字数上限兜底（避免单条评分行超长时输入爆掉）。切点仍落在整行边界。
 */
export function sliceByScoreRowBudget(
  body: string,
  maxChars: number,
  maxRows: number,
  fixedKind?: ScoringSegmentKind,
): { text: string }[] {
  const lines = body.split("\n")
  const segs: string[] = []
  let cur: string[] = []
  let curRows = 0
  let curLen = 0
  let curKind: string | null = null
  const isRow = (l: string) => rowIdOf(l) !== null
  // 评分项类型 = 编号前缀（1-x 技术 / 2-x 商务 / 3-x 价格）。
  // 同一段内混放不同类型会让模型跨口径误抽：实测 tech_score 在「只含 2-x 商务项」的段里
  // 抽出 6 条商务项（2-8/2-9/2-10/2-11/2-15/2-16），违反 TECH_SCORE_TASK「忽略商务、价格项」；
  // biz_score 在纯技术段里也反向出了 0-2 条。所以类型一换就强制断段。
  const kindOf = (l: string) => {
    const no = rowIdOf(l)
    if (!no) return null
    const t = /^(\d+)-\d+$/.exec(no)
    if (t) return `${t[1]}-x`
    const alpha = /^([A-Z])/.exec(no)
    if (alpha) return `${alpha[1]}-x`
    return "other-x"
  }
  for (const l of lines) {
    const row = isRow(l)
    const kind = row ? kindOf(l) : null
    // 分组标题已锁定类型时（fixedKind），不做类型切分——否则会按「表内行号」把同组切碎
    const kindChanged = !fixedKind && kind !== null && curKind !== null && kind !== curKind
    const wouldExceedRows = row && curRows + 1 > maxRows
    const wouldExceedChars = curLen + l.length + 1 > maxChars
    // 类型切换是硬边界：先按 1-x / 2-x / 3-x 分段，再在同类内按行数切。
    // 若让 25 行的上限先触发，切点会落在类型切换点之前，一段里就混着 1-x 与 2-x
    //（实测 #46 段3 曾是 [1-x,2-x] 混合，正是 tech_score 抽出商务项的来源）。
    if (cur.length && (kindChanged || wouldExceedRows || wouldExceedChars)) {
      segs.push(cur.join("\n"))
      cur = []
      curRows = 0
      curLen = 0
      curKind = null
    }
    cur.push(l)
    curLen += l.length + 1
    if (row) {
      curRows++
      curKind = kind
    }
  }
  if (cur.length) segs.push(cur.join("\n"))
  return segs.map((text) => ({ text }))
}

/** 给切出来的片段补一行「包 + 类型」标记，保证模型知道本段归属（否则「包NN 」前缀会丢） */
function withSegmentHeader(text: string, pack: string, kind: ScoringSegmentKind): string {
  const t = (text ?? "").trim()
  if (!t) return t
  const kindLabel = kind === "tech" ? "技术评分项" : kind === "biz" ? "商务评分项" : kind === "price" ? "价格评分项" : "须知/前置内容"
  const head = `【本段属于 ${pack} · ${kindLabel}】`
  if (t.startsWith(head)) return t
  return `${head}\n${markFirstScoreRow(t)}`
}

/**
 * REQ-039：在「表头后第一条评分项」前插一行显式标注。
 *
 * 缺陷（实测金山60 段5，三轮输入完全相同）：模型把「表头 + 紧邻的首条评分项」一起当成表格头部跳过——
 *   run1 出 16 项含「1、投标响应情况 29 分」；run2/run3 只出 15 项缺它。
 * 29 分是包01 技术项满分 58 分的一半，是最大单项。
 * 天坛那次用块级标注（【评分项】/【分值】/【评审标准】）把「综合实力 3」救回过 3/3，
 * 同一手法在此复用于表格型行：只标注**第一条**，不动其余行，避免把整段改写成另一种形态
 * （改成块级会丢「名称|分值|描述」的列信息，反而更容易漏）。
 */
export function markFirstScoreRow(text: string): string {
  const lines = (text ?? "").split("\n")
  // 幂等：已标注过就不再插（withSegmentHeader 可能对同一段调用多次）
  if (lines.some((l) => l.includes("【注意：下面这一行是评分项"))) return text
  // 找第一行「像表头」的行：含两个以上竖线且列名带「项目/分值/标准/因素/序号」且不是评分行。
  // 不能只看前几行——福安/海沧的表头前面还隔着「【评分章节：…】」与若干须知行，
  // 实测段首前 8 行内找不到表头（这导致单包标书一直没被标注）。
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if ((t.match(/[|｜]/g) ?? []).length >= 2 && /(评标项目|评审因素|评分项目|评审内容|评分界定|序号)/.test(t) && !rowIdOf(t)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return text
  // 表头之后第一条评分行
  for (let j = headerIdx + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue
    if (!rowIdOf(lines[j])) continue
    const note = "【注意：下面这一行是评分项（不是表头），必须提取】"
    return [...lines.slice(0, j), note, ...lines.slice(j)].join("\n")
  }
  return text
}

/**
 * REQ-029：剔除「无编号的表头行」被当成评分项的情况（价格分翻倍的直接原因）。
 *
 * 缺陷（史矛革 2026-10-18 实测）：商务段末尾常有一行「3 价格因素」「3、价格因素」（包03 是顿号形态），
 * 它只标明评分大类、不带层级编号，却被模型当评分项输出，且 score 抄成了整类分值 10 分。
 * 三个包各多出一条 → 用户看到的价格分从 30 分变 60 分，**直接导致投标人按错误分值分配价格策略**。
 *
 * 判据（两条同时满足才剔除，避免误伤真评分项）：
 *   ① name 形如「1/2/3 [、,空格] XX因素」且**没有** x-y 层级编号；
 *   ② 该 name 不含具体评分内容（长度短，只是大类名）。
 * 真评分项如「3-1 价格评分」「2-1 管理体系认证证书」带层级编号或有具体内容，不会被误伤。
 */
export function stripSyntheticHeaderItems<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.filter((it) => !isSyntheticHeaderName(asStr(it?.name)))
}

/** 是否是「无编号表头行」的评分项名称（「3 价格因素」/「3、价格因素（满分10分）」/「包01 2 商务因素」等） */
export function isSyntheticHeaderName(rawName: string): boolean {
  const raw = asStr(rawName).trim()
  if (!raw) return false
  // 先剥掉可能已加的「包NN 」前缀，再判表头形态（否则「包01 3 价格因素」会漏网）
  const name = raw.replace(/^包\d+\s*/, "")
  if (!name) return false
  if (/(?:^|\s)\d+-\d+(?:\s|$)/.test(name)) return false
  // 覆盖两种实测形态：
  //   ① 素材原样「1、技术因素（满分65分）」「2、商务因素（满分25分）」「3、价格因素（满分10分）」
  //      —— 带「（满分N分）」后缀，必须允许尾部括号，否则整个形态都漏掉；
  //   ② 模型改写后的「3 价格因素」「3、价格因素」「3．价格因素」「2 商务因素」。
  // 不能误伤公式行「投标人的评标总得分＝技术因素得分＋商务因素得分」——它不以「数字+分隔符」开头，
  // 也不以「因素」或「因素（…）」结尾，天然不匹配。
  return /^[123]\s*[、,．.，\s]\s*\S{1,12}因素(?:\s*[（(][^）)]*[）)])?$/.test(name)
}

/**
 * 评分项去重：按「解析项类型 + 包号 + 层级编号」为键，保留第一条。
 *
 * 为什么需要：商务段末尾常紧接「3-1 价格评分」，模型会在商务段顺手抽出，价格段又抽一次
 * → 同一 (类型|包|编号) 出现两次（实测 #46 包02 的 3-1 就是这样重复的）。
 *
 * REQ-038（2026-10-18，真实丢内容）：key 原本只有「包号|编号」，缺「项类型」这一维。
 * 一份标书里技术项与商务项是**两套独立编号**，都从 1-1 起，于是撞号被误当重复删掉：
 *   金山60 包01 技术「1-1 投标响应情况」先合并 → 商务「1-1 项目负责人资质」后合并被 continue
 * 实测 88 → 85，丢 3 条包01 商务项（1-1/2-1/3-1），且只在模型吐出重复时才触发（隐性）。
 * 修法：key 增加「项类型」一维；同类型+同包+同编号才算重复。
 *
 * 无层级编号的项**默认**保留、不参与去重（REQ-029 已修，勿回退）。
 * 但有一种例外必须剔除（2026-10-18 实测 #46）：同一包内已存在「带编号」的同名项时，
 * 那条无编号的是模型对**同一项**的重复抽取（`包03 3-1 价格评分` 与 `包03 价格评分` 并存，
 * 各 10 分 → 价格分合计 40 分而非 30，用户会按错误分值分配报价策略）。
 * 判据收紧到「去编号后的名称完全相同且同包」，避免误伤福安 T/B 那类真正无编号的项。
 */
export function dedupeScoringItems<T extends Record<string, unknown>>(
  items: T[],
  fallbackPack?: string,
  keyOf?: (it: T) => string,
): T[] {
  const seen = new Set<string>()
  // 先收集「同包内带编号项」的归一名称，供无编号项比对
  const normalizedOfNumbered = new Set<string>()
  const normName = (raw: string) =>
    raw
      .replace(/^包\d+\s*/, "")
      .replace(/(?:^|\s)\d+-\d+(?=\s|$)/g, " ")
      .replace(/\s+/g, "")
      .trim()
  for (const it of items) {
    const raw = asStr(it?.name).trim()
    const pack = /^包\d+/.exec(raw)?.[0] ?? fallbackPack ?? "_"
    if (!/(?:^|\s)\d+-\d+(?:\s|$)/.test(raw)) continue
    const nm = normName(raw)
    if (nm) normalizedOfNumbered.add(`${pack}|${nm}`)
  }
  const out: T[] = []
  for (const it of items) {
    const raw = asStr(it?.name).trim()
    const pack = /^包\d+/.exec(raw)?.[0] ?? fallbackPack ?? "_"
    const no = /(?:^|\s)(\d+-\d+)(?:\s|$)/.exec(raw)?.[1] ?? ""
    // 无层级编号：默认保留；但若同包已有同名带编号项 → 这条是重复抽取，剔除
    if (!no) {
      const nm = normName(raw)
      if (nm && normalizedOfNumbered.has(`${pack}|${nm}`)) continue
      out.push(it)
      continue
    }
    // 不传 keyOf 时退化为旧行为（"_"），保持纯函数可单测
    const kind = keyOf ? keyOf(it) : "_"
    const key = `${kind}|${pack}|${no}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/**
 * 切段合并提示词（移植易标 segmentedAiResultMerger 语义）：
 * 「没有提及」只代表该段缺失；去重保完整；不得新增信息；最终输出符合原任务契约。
 */
export function buildSegmentMergeMessages(
  key: string,
  results: { index: number; total: number; content: string }[],
  output: "json" | "markdown",
): LlmMessage[] {
  const outputRequirement =
    output === "json"
      ? "最终只返回一个 JSON 对象，不要输出 Markdown、代码块、解释或额外文字。"
      : "最终只返回整理后的 Markdown 内容，不要输出解释、过程或额外提示语。"
  const segments = results
    .map((r) => `## 第 ${r.index}/${r.total} 段解析结果\n${r.content.trim()}`)
    .join("\n\n")
  return [
    { role: "system", content: PARSE_WHOLE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `以下内容来自同一份招标文件按段分别解析后的结果。每段结果只代表该片段内的信息，不代表整份文件的完整结论。

当前合并任务：${parseSectionTitle(key)}

合并要求：
1. 如果某段写“没有提及”，只表示该片段没有相关信息；如果其他片段提供了有效信息，应以有效信息为准。
2. 删除重复、空泛、冲突的片段性表述，保留更完整、更具体的信息。
3. 保留所有有价值、可用于最终结果的信息，不要遗漏分段结果中的明确内容。
4. 不要新增分段结果中没有的信息，不要自行编造。
5. **评分项的跨段去重口径**（仅 tech_score / biz_score 适用）：同一评分项可能出现在多个分段结果里
   （例如「3-1 价格评分」既落在商务段又被价格段重复抽到）。去重键是「合同包 + 层级编号」：
   包号相同且编号相同才是同一项，只保留一条、取 criteria 更完整的那条；
   **包号不同或编号不同的，一律视为不同评分项，禁止合并**（多合同包的各包评分项相互独立）。
   若分段结果里的 name 没写包号，按它所在分段的段头包号补齐。
6. 最终输出必须符合原始任务要求。
7. ${outputRequirement}

原始任务要求：
${buildWholeParseTask(key)}

分段解析结果：
${segments}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// JSON → 行式文本摊平（落库格式与 T12 检索通道一致，下游零改动）
// ---------------------------------------------------------------------------

function asStr(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** 「没有提及」类占位值与空值等价——摊平时跳过该行，与「找不到则省略」契约一致 */
function missingText(v: unknown): boolean {
  const s = asStr(v).trim()
  return !s || s === "没有提及" || s === "未提及" || s === "无"
}

function scoreNumber(v: unknown): string {
  const m = asStr(v).match(/\d+(?:\.\d+)?/)
  return m ? m[0] : ""
}

/** tech_score/biz_score 摊平：首行「评分构成：…」+ 每项「名称（N 分）：标准（出处：…）」——extractScoringFromText 的原生行格式 */
function flattenScoring(rec: Record<string, unknown>): string {
  const lines: string[] = []
  const comp = asStr(rec.score_composition).trim()
  if (!missingText(comp)) lines.push(`评分构成：${comp}`)
  for (const it of asArr(rec.items)) {
    const r = (it ?? {}) as Record<string, unknown>
    const name = asStr(r.name).trim()
    if (missingText(name)) continue
    // REQ-029：无 x-y 编号且形如「N 因素」→ 表头行，丢弃（防价格分翻倍）。
    // 这是**确定性**过滤：不论模型是否遵守提示词，落库前一定拦住。
    // 必须放在 flattenScoring（真正逐项落库的地方），不能只靠上游清洗——
    // 合并阶段的 dedupeAcrossSections 归一化会把「3、价格因素」变成「3,价格因素」，
    // 与「3 价格因素」（→「3价格因素」）不相等，三条表头谁也去不掉。
    if (isSyntheticHeaderName(name)) continue
    const criteria = [asStr(r.criteria), asStr(r.criteria_or_formula)]
      .map((s) => s.trim())
      .filter((s) => s && !missingText(s))
      .join("；")
    const source = asStr(r.source).trim()
    const crit = `${criteria}${source && !missingText(source) ? `（出处：${source}）` : ""}`
    const score = scoreNumber(r.score)
    lines.push(score ? `${name}（${score} 分）：${crit}` : `${name}：${crit}`)
  }
  return lines.join("\n")
}

function flattenOverview(rec: Record<string, unknown>): string {
  const fields: [string, string][] = [
    ["project_name", "项目名称"],
    ["tender_no", "招标编号"],
    ["project_type", "项目类型"],
    ["purchaser", "采购人"],
    ["budget", "预算金额"],
    ["project_address", "项目地址"],
    ["background", "背景目的"],
    ["scale", "规模预算"],
    ["scope_of_work", "建设内容"],
    ["tech_features", "技术特点"],
    ["other", "其他关键要求"],
  ]
  const lines: string[] = []
  for (const [k, label] of fields) {
    const v = asStr(rec[k]).trim()
    if (!missingText(v)) lines.push(`${label}：${v}`)
  }
  for (const it of asArr(rec.schedule)) {
    const r = (it ?? {}) as Record<string, unknown>
    const node = asStr(r.node ?? r.name).trim()
    const time = asStr(r.time).trim()
    if (node && !missingText(time)) lines.push(`时间安排：${node}：${time}`)
  }
  return lines.join("\n")
}

function flattenNodeTime(rec: Record<string, unknown>, label: string): string {
  const lines: string[] = []
  for (const it of asArr(rec.nodes)) {
    const r = (it ?? {}) as Record<string, unknown>
    const node = asStr(r.node ?? r.name).trim()
    const time = asStr(r.time).trim()
    if (node && !missingText(time)) lines.push(`${label}：${node}：${time}`)
  }
  return lines.join("\n")
}

function flattenPurchaseList(rec: Record<string, unknown>): string {
  const lines: string[] = []
  for (const it of asArr(rec.items)) {
    const r = (it ?? {}) as Record<string, unknown>
    const name = asStr(r.name).trim()
    if (missingText(name)) continue
    const spec = asStr(r.spec).trim()
    const qty = asStr(r.qty).trim()
    const note = asStr(r.note).trim()
    const parts = [
      spec && !missingText(spec) ? `规格型号：${spec}` : "",
      qty && !missingText(qty) ? `数量：${qty}` : "",
      note && !missingText(note) ? `备注：${note}` : "",
    ].filter(Boolean)
    lines.push(`名称：${name}${parts.length ? `｜${parts.join("｜")}` : ""}`)
  }
  return lines.join("\n")
}

function flattenLots(rec: Record<string, unknown>): string {
  const lines: string[] = []
  for (const it of asArr(rec.lots)) {
    const r = (it ?? {}) as Record<string, unknown>
    const no = asStr(r.no).trim()
    const title = asStr(r.title).trim()
    if (!no && !title) continue
    const budget = asStr(r.budget).trim()
    const summary = asStr(r.summary).trim()
    const tail = [
      budget && !missingText(budget) ? `（预算：${budget}）` : "",
      summary && !missingText(summary) ? `：${summary}` : "",
    ].join("")
    lines.push(`${no ? `${no} ` : ""}${title}${tail}`)
  }
  return lines.join("\n")
}

function flattenOutline(rec: Record<string, unknown>): string {
  const lines: string[] = []
  for (const it of asArr(rec.outline)) {
    const r = (it ?? {}) as Record<string, unknown>
    const no = asStr(r.no).trim()
    const title = asStr(r.title).trim()
    if (missingText(title)) continue
    const level = Math.max(1, Math.min(6, Number(r.level) || 1))
    lines.push(`${"  ".repeat(level - 1)}${no ? `${no} ` : ""}${title}`)
  }
  return lines.join("\n")
}

/**
 * 扁平字段落 摊平（数组字段取首个元素当行首标签，其余续行）。
 * 标签表已收到 parseSchemas.PARSE_FIELD_LABELS（单一真源）：同时驱动这里的摊平文本与
 * ParseSection.structured 的结构化字段，两边标签永不漂移。
 */
const FIELD_LABELS = PARSE_FIELD_LABELS

function flattenFieldMap(key: string, rec: Record<string, unknown>): string {
  const labels = FIELD_LABELS[key]
  if (!labels) return ""
  const lines: string[] = []
  for (const [field, label] of Object.entries(labels)) {
    const v = rec[field]
    if (Array.isArray(v)) {
      const items = v.map((x) => asStr(x).trim()).filter((s) => s && !missingText(s))
      items.forEach((s, i) => lines.push(i === 0 ? `${label}：${s}` : s))
      continue
    }
    const s = asStr(v).trim()
    if (!missingText(s)) lines.push(`${label}：${s}`)
  }
  return lines.join("\n")
}

/**
 * 整文 JSON 输出 → 行式文本落库（parse_report.sections[].content 的既有消费格式）。
 * 全部字段缺失/「没有提及」时返回空串，由调用方落「原文未提及」走 miss 态自动重跑。
 */
export function flattenParseItemJson(key: string, raw: unknown): string {
  if (raw === null || raw === undefined) return ""
  const rec = (typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  switch (key) {
    case "tech_score":
    case "biz_score":
      return flattenScoring(rec)
    case "overview":
      return flattenOverview(rec)
    case "bid_nodes":
      return flattenNodeTime(rec, "投标关键节点")
    case "purchase_list":
      return flattenPurchaseList(rec)
    case "lots":
      return flattenLots(rec)
    case "bid_outline_req":
      return flattenOutline(rec)
    default:
      return flattenFieldMap(key, rec)
  }
}
