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
    "3. 评分表为竖线表格行时按列拆分对应「评分项 | 分值 | 评审标准」，禁止忽略竖线后的列；宽表逐行提取，一个评分项的名称、分值、标准三者不得因拆列而丢失。",
    "4. 分值必须与原文一致；存在二级子项时在 name 中用编号体现层级；尽量覆盖全部技术评分项不遗漏；某条内容无法确定是评分项还是约束规则时，宁可不填入 items，也不得编造。",
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
    "3. 商务与技术的边界按原文分值表归属判断，无法判断的按商务处理并在 criteria 末尾注明「（边界存疑）」。",
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
 */
export function buildWholeParseMessages(
  key: string,
  fileText: string,
  seg?: { index: number; total: number },
): LlmMessage[] {
  return [
    { role: "system", content: PARSE_WHOLE_SYSTEM_PROMPT },
    { role: "user", content: buildWholeFileContent(fileText, seg) },
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
5. 最终输出必须符合原始任务要求。
6. ${outputRequirement}

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
