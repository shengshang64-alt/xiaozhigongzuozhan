// ---------------------------------------------------------------------------
// R69 提示词搬迁第五批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { buildLotsScopeHint, BID_STYLE_RULES, FULLTEXT_GUARD_RULES, ORCHESTRATION_FIGURE_TYPE_LABEL, PARAM_RESPONSE_BOUNDARY_RULES, PRE_OUTPUT_SELFCHECK_RULES, basisStyleRule, complianceModeRule, scoringDetailLines, sectionText, truthPreamble } from "../bidTypes"
import type { CompilationBasisPrompt, ComplianceMode, MergedOrchestration, ParseReport, RequirementClause, ScoringItem } from "../bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"
// R167：素材库注入段的基线/检索拆分（单一真源在 materialLibrary，标记头由生成侧写入）
import { baselineLabelFromText, extractBaselineSegment, extractFragmentSegment } from "../materialLibrary"

// R167 v4：2026-10 易标对齐轮——素材融入不提及来源（kbMaterial/directedKnowledge/refMaterials 规则句与注入段头同步改写），PROMPT_VERSION 3→4
// r287 v5（bid-l2-verbatim-compare 切片2·预防）：新增引号照录纪律规则条（第 6 条，其后规则序号顺移），与 bidSection v6 同口径
// R47（B20）v5→v6：新增「商务模板要求」注入槽与规则条（templateRequirements 空数组时输出与 v5 逐字一致）
export const PROMPT_VERSION = 6

export type BidChapterPromptOpts = {
  wordBudget: number
  figures: boolean
  /** 本章须逐条响应的招标要求条款（按覆盖映射 + 标题相似度归章） */
  clauses?: RequirementClause[]
  /** 第五轮改造 4：全局事实表文本块（空串=无事实可注入） */
  globalFacts?: string
  /** 第七轮改造 1：分配到本章的评分细则（含评审标准原文），替换旧的全表评分项注入 */
  scoring?: ScoringItem[]
  /** 第七轮改造 1：相邻章上下文（第 N-2、N-1 章标题+前 300 字摘要） */
  prevSummaries?: { title: string; summary: string }[]
  /** 第七轮改造 3：招标隐式硬约束（本地抽取，零 AI） */
  implicitConstraints?: string[]
  /** 第八轮改造 2：招标原文相关段落（本地检索，零 AI；空串=不注入，静默降级） */
  tenderFragments?: string
  /** 第十三轮改造 3：逐条应答强化开关开启时注入的 ★/▲ 重点条款上下文段（空串/缺省=不注入） */
  starBlock?: string
  /** 第十三轮改造 3：素材优先注入开关开启时检索到的知识库素材段（注明来源文档；空串/缺省=不注入） */
  kbMaterial?: string
  /** T16：编排期定向挑选的知识库素材段（≤4 条，含来源标注；缺省=回退检索式注入口径） */
  directedKnowledge?: string[]
  /**
   * 第十六轮 B2 改造 2.2：本级（章/节）合并后的预编排结果（缺省=编排缺失或未覆盖本级，
   * 完全走现状 figures_enabled 逻辑；存在时 figure 选中→调用方强制 figures 开、未选中→强制关）
   */
  orchestration?: MergedOrchestration
  /**
   * 第十七轮 17B：编制依据注入——规则句全部章携带（style 决定列示样式）；
   * listText 仅目标章非空（标题匹配 /编制依据|标准|规范/，匹配不到回退首个技术章；
   * 章级判断在调用处做，节级继承章判断）；缺省=无编制依据，行为同现状
   */
  compilationBasis?: CompilationBasisPrompt
  /**
   * 第十七轮 17D：团队写作资料相关段（对 ref_materials_text 本地检索，≤3 段 ≤1200 字；
   * 空串/缺省=未导入资料或检索为空，静默不注入，老项目行为同现状）
   */
  refMaterials?: string
  /**
   * 循环 2 批 1-4：暗标身份脱敏规则条（sealedIdentityBlock 产出；空串/缺省=非暗标不注入，
   * 老项目行为同现状）
   */
  sealedIdentityRules?: string
  /**
   * 循环 2 批 2-1：编排定向事实块（buildDirectedFactsBlock 产出；非空时替代全量 globalFacts 注入，
   * 空串/缺省=保持全量注入，兼容未重编排的老项目）
   */
  directedFacts?: string
  /** 05 三模式：合规严格度（缺省/strict=逐字最小风险，与现状一致；moderate/full 放宽表达充分度但不新增可验收承诺） */
  complianceMode?: ComplianceMode
  /** R47（B20）：商务模板里明写的要求行（空数组/缺省=未上传模板，prompt 与现状逐字一致） */
  templateRequirements?: string[]
}

export function buildBidChapterMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  outline: OutlineNode[],
  chapters: Chapter[],
  chapterIndex: number,
  outlineToText: (nodes: OutlineNode[], prefix?: string) => string,
  opts: BidChapterPromptOpts,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const sectionLines = (ch.sections ?? []).map((s, j) => `${chapterNo}.${j + 1} ${s}`).join("\n")
  const scoringDetail = scoringDetailLines(opts.scoring ?? [])
  const techText = sectionText(report, "delivery_req")
  const reqStructBlock = reqStructureContext(report)
  const lotsBlock = lotsContext(report)
  // T20：项目背景画像（概述+项目信息，写作时「先分析后编写」的依据；非空才注入）
  const overviewBlock = [sectionText(report, "overview"), sectionText(report, "project_info")]
    .filter((s) => s.trim())
    .map((s) => s.trim())
    .join("\n")
    .split(/\n+/)
    .slice(0, 20)
    .join("\n")
  const prevSummaries = opts.prevSummaries ?? []
  const implicitList = opts.implicitConstraints ?? []
  // 循环 2 批 2-1：编排定向事实块非空时替代全量全局事实注入（规则句与素材块同步切换口径）
  const directedOn = Boolean((opts.directedFacts ?? "").trim())
  const factsBlock = directedOn ? (opts.directedFacts ?? "").trim() : (opts.globalFacts ?? "")
  const factsLabel = directedOn ? "本章必守事实" : "全局事实"
  // R167：公司素材库标准件基线——生成侧把「基线 + 自由资料检索段」拼在同一个注入串里（带标记头），
  // 这里拆成两个独立提示词槽：基线定结构与写法，检索段供事实引用；无标记时基线空串=与 17D 现状逐字一致。
  const libraryBaseline = extractBaselineSegment(opts.refMaterials ?? "")
  const libraryKindLabel = baselineLabelFromText(opts.refMaterials ?? "")
  const freeMaterialsText = libraryBaseline ? extractFragmentSegment(opts.refMaterials ?? "") : (opts.refMaterials ?? "")
  const rules = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在编写投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标的第${chapterNo}章「${ch.title}」。`,
    truthPreamble(),
    "写作铁律：",
    "1. 内容必须真实可落地、可直接用于正式投标文件：使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），杜绝空话套话；",
    "2. 紧扣招标文件的评分办法与技术需求做实质性响应，涉及指标处给出量化承诺（并发用户数、响应时间、驻场人数、到场时限等），取值以招标原文与全局事实为准并遵守最小值响应：满足招标要求档位即可，禁止自行加码承诺；",
    scoringDetail
      ? `3. 本章已映射到以下评分点（评标专家将逐条核对响应情况），正文必须对每个评分点给出明确的实质性响应段落（响应措施、量化承诺或证明材料，并标明对应评分项名），禁止只罗列功能清单而不响应评分要求。评分细则（项名 + 分值 + 评审标准原文）如下，对齐评审标准中的给分档位：\n${scoringDetail}`
      : "3. 本章未分配到具体评分细则，请结合项目背景与本章定位写出实质性响应内容；",
    `4. 严格按给定小节组织正文：每个小节标题单独一行，格式「${chapterNo}.1 小节名」，小节下写 2-5 段、每段 3-6 句；`,
    `5. 本章字数预算约 ${opts.wordBudget} 字（整份目标页数按章节权重折算），在该篇幅内围绕招标参数与评分办法扩展；禁止自造招标未给的具体参数数字，拿不准的用「按招标文件要求响应」等规范表述；`,
  ]
  const clauseList = opts.clauses ?? []
  const templateReqs = (opts.templateRequirements ?? []).map((t) => (t ?? "").trim()).filter(Boolean).slice(0, 20)
  let ruleNo = 6
  // r287（bid-l2-verbatim-compare 切片2·预防）：引号照录纪律——引号内只允许逐字原文，
  // 转述必须出引号（与体检 quote_rewrite 规则同源口径：改写＝引号内非原文）
  rules.push(`${ruleNo}. 正文引号只用于逐字照录招标原文：引用招标文件条款、评分标准、要求语句时，引号内文字必须与招标原文一字不差（仅允许把「要求/需/应」等要求类字眼改写为投标人自述人称），禁止在引号内改写、缩略、概括或插改字词；无法逐字照录时一律去掉引号改为间接转述；自拟的标题、口号与概念名称不用引号引用；`)
  ruleNo += 1
  // 合并稿 v1.0（R30 全量切换）：三档写作模式规则块均非空，strict/缺省也注入严格响应块
  const modeRule = complianceModeRule(opts.complianceMode)
  if (modeRule) {
    rules.push(`${ruleNo}. ${modeRule}`)
    ruleNo += 1
  }
  if (prevSummaries.length) {
    rules.push(
      `${ruleNo}. 本章首段必须自然承接上一章的收尾内容（见下面【相邻章上下文】），语气与口径保持连贯；相邻章内容仅供语气衔接与避免重复，禁止照抄、复述或改写其中任何具体表述；`,
    )
    ruleNo += 1
  }
  if (implicitList.length) {
    rules.push(
      `${ruleNo}. 下面【招标隐式硬约束】任何一条被违反都可能废标，本章正文涉及相关内容时必须逐条满足；`,
    )
    ruleNo += 1
  }
  if (clauseList.length) {
    rules.push(
      `${ruleNo}. 下面【本章须响应的招标要求条款清单】共 ${clauseList.length} 条，本章正文必须逐条实质性响应：每条条款至少有一段对应内容并给出量化承诺或落地措施，小节标题行可在标题后标注所响应的条款序号（如「${chapterNo}.2 性能保障方案（响应 c3、c7）」），方便评标专家逐条查询；禁止遗漏任何条款、禁止泛泛带过；`,
    )
    ruleNo += 1
  }
  // R47（B20）：商务模板明写要求——非空才注入规则条，缺省时 prompt 与现状字节一致
  if (templateReqs.length) {
    rules.push(
      `${ruleNo}. 下面【商务模板要求】共 ${templateReqs.length} 条，是商务同事提供的投标模板里明写的要求，本章内容涉及到的必须逐条满足（结构与内容口径以模板为准；排版类要求已写入导出排版设置，正文不必说明）；`,
    )
    ruleNo += 1
  }
  if (factsBlock) {
    rules.push(
      `${ruleNo}. 正文中出现项目名称、招标编号、采购人、预算金额、工期、质保期、地点、时间节点等事实信息时，必须与下面【${factsLabel}】一致，禁止编造不同数值；`,
    )
    ruleNo += 1
  }
  if (opts.tenderFragments) {
    rules.push(
      `${ruleNo}. 本章内容必须优先依据下面【招标原文相关段落】展开：技术参数、指标、配置与服务要求以原文为准，与原文冲突的表述一律以原文为准，禁止脱离原文空写套话；`,
      // T20：反罗列——需求/功能清单类内容必须消化为分析性表述（用户实测反馈：原文功能清单被整段照抄）
      `${ruleNo + 1}. 使用【招标原文相关段落】时禁止整段照抄或逐条罗列原文的功能清单、系统列表与参数表：此类内容必须先归纳为「需求要点 → 本项目响应思路」的分析性表述（如按业务域归类、指出对本项目的作用与建设考虑），原文细节只在支撑论述时引用；章节标题含「需求分析」「现状分析」「背景」时，正文必须体现分析与论证过程，不得变成功能清单的复述；`,
    )
    ruleNo += 2
  }
  // 第十三轮改造 3：逐条应答强化（开关开启才注入，零新增 LLM 调用）
  if (opts.starBlock) {
    rules.push(
      `${ruleNo}. 本章内容须对所涉下面【★/▲ 重点条款】逐条正面应答：涉及到的每一条重点条款都要有明确应答结论（满足/优于），给出落地措施或量化承诺，禁止回避、禁止只写通用套话；与本章无关的条款不必展开；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：素材优先注入（知识库块级检索命中才注入，注明来源文档）
  // 2026-10 易标对齐轮：融入口径升级——素材整理为本项目表述，正文不出现来源字样（正式投标文件不暴露素材痕迹）
  if (opts.kbMaterial) {
    rules.push(
      `${ruleNo}. 下面【知识库参考素材】是团队沉淀的方案素材（已注明来源文档），可作为本章案例、数据与实施细节的支撑材料融入正文：融入时把素材内容整理为本项目的方案表述，不在正文中出现「知识库」「素材」「来源文档」等来源字样；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄；`,
    )
    ruleNo += 1
  }
  // T16：编排期定向挑选的知识库素材（优先级高于检索式注入——编排为本章选定的素材必须优先吸收）
  if (opts.directedKnowledge?.length) {
    rules.push(
      `${ruleNo}. 下面【定向参考素材】是编排阶段为本章挑选的知识库素材（已注明来源文档），本章写作应优先吸收其中与本节主题相关的案例、数据与实施细节，整理为本项目的方案表述，不在正文中提及素材与来源名称；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄，禁止编造素材里没有的内容；`,
    )
    ruleNo += 1
  }
  // 第十七轮 17D：团队写作资料注入（检索命中才注入；可引用事实与口径，禁止整段照抄）
  // 2026-10 易标对齐轮：「引用处注明来自自有资料」升级为「整理为本项目表述、不出现来源字样」——
  // 投标正文是正式对外文件，任何素材来源痕迹都应留在注入块与工作台，不进正文
  if (opts.refMaterials) {
    rules.push(
      `${ruleNo}. 下面【团队写作资料】是自有的人员、案例、资质与制度材料：本章写到团队配置、同类业绩、资质能力、管理制度等内容时优先引用其中的事实与口径，融入时整理为本项目的方案表述，不在正文中出现「自有资料」「内部资料」等来源字样；禁止整段照抄，禁止编造资料里没有的人员与业绩；`,
    )
    ruleNo += 1
  }
  // R167：公司素材库标准件基线注入（先取公司较优范式定结构，再按招标要求与全局事实定向调整）
  if (libraryBaseline) {
    rules.push(
      libraryKindLabel
        ? `${ruleNo}. 下面【公司优质素材库·${libraryKindLabel}标准件】是公司较优标书中该主题的写法范式，不是本项目事实：本章以它的结构与写法要求为基线，再按招标文件的条款、评分办法与【${factsLabel}】逐项定向调整（篇幅与取舍服从招标要求）；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`
        : `${ruleNo}. 下面【公司优质素材库标准件】是公司较优标书的写法范式，不是本项目事实：本章以它的结构与写法要求为基线，再按招标文件与【${factsLabel}】逐项定向调整；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`,
    )
    ruleNo += 1
  }
  // 循环 2 批 1-4：暗标身份脱敏规则条（sealed=true 时注入，零新增 LLM 调用）
  if (opts.sealedIdentityRules) {
    rules.push(`${ruleNo}. ${opts.sealedIdentityRules}`)
    ruleNo += 1
  }
  // 第十七轮 17B：编制依据列示——规则句注入全部章；清单文本仅目标章携带（章级判断在调用处做）
  if (opts.compilationBasis) {
    rules.push(
      `${ruleNo}. 本章涉及编制依据（标准规范/技术依据）时按约定样式列示：${basisStyleRule(opts.compilationBasis.style)}${
        opts.compilationBasis.listText
          ? "；完整依据清单见下面【编制依据与规范清单】，列示时名称与编号必须以清单为准，禁止编造编号"
          : ""
      }；`,
    )
    ruleNo += 1
  }
  rules.push(`${ruleNo}. 写作风格硬条款（每条必须遵守）：`)
  for (const t of BID_STYLE_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  rules.push(`${ruleNo}. 全文一致性与合规底线（每条必须遵守）：`)
  for (const t of FULLTEXT_GUARD_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  // docs/05 §2 落地（第 14 轮）：技术参数响应边界与实质性变更禁令——防废标，所有生成模式均不放宽
  rules.push(`${ruleNo}. 技术参数响应边界与实质性变更禁令（每条必须遵守）：`)
  for (const t of PARAM_RESPONSE_BOUNDARY_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  // docs/07 §5.3/§5.4 落地（第 18 轮）：输出前自检 + 历史缺陷反例——事后检查器规则前移为事前约束（只加约束、不改语义）
  rules.push(`${ruleNo}. 输出前自检与历史缺陷反例（每条必须遵守）：`)
  for (const t of PRE_OUTPUT_SELFCHECK_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  // 第十六轮 B2 改造 2.2：预编排结果注入写作规则（figure 选中时调用方已把 figures 开关强制打开，这里只注入内容约束）
  // 循环 2 批 2-1：写作焦点进规则句；编排图带图注时要求图元素支撑图注
  if (opts.orchestration?.writing_focus) {
    rules.push(
      `${ruleNo}. 本章写作焦点：${opts.orchestration.writing_focus}；正文须围绕该焦点组织重点内容，并对其中点名的评分点给出实质性响应；`,
    )
    ruleNo += 1
  }
  if (opts.orchestration?.figure) {
    const figCaption = (opts.orchestration.figure.caption ?? "").trim()
    rules.push(
      `${ruleNo}. 本章已编排一张${ORCHESTRATION_FIGURE_TYPE_LABEL[opts.orchestration.figure.type]}：《${opts.orchestration.figure.title}》${
        figCaption ? `，图注「${figCaption}」` : ""
      }，figures 数组必须输出该图且内容全部取自本章正文，图名与编排一致${figCaption ? "，图元素必须能支撑图注所述内容" : ""}；`,
    )
    ruleNo += 1
  }
  // T16：编排选中 mermaid 关系图时，figures 契约切换为 mermaid 源码图（其余图型结构化 spec 契约不变）
  if (opts.orchestration?.figure?.type === "mermaid") {
    rules.push(
      `${ruleNo}. 该图为 mermaid 源码图，输出格式 {"type":"mermaid","title":"图名","code":"flowchart TD\\n A[\\"节点\\"] --> B[\\"节点\\"]"}；code 只允许 flowchart/graph 声明开头、节点总数 ≤12、每个节点标签 ≤16 字、中文与含特殊字符的标签必须用双引号包裹；code 内容必须对应本章正文描述的流程/关系，禁止编造正文没有的环节；`,
    )
    ruleNo += 1
  }
  // 2026-10 配图需求轮：编排选中甘特图时，figures 以 mermaid gantt 源码输出（本地渲染与导出与 mermaid 同链路）
  if (opts.orchestration?.figure?.type === "gantt") {
    rules.push(
      `${ruleNo}. 该图为项目实施甘特图，figures 输出 {"type":"mermaid","title":"图名","code":"<gantt 源码>"}；code 首行必须是 gantt、第二行 dateFormat YYYY-MM-DD，用 section 把实施阶段分为 2-5 期（如准备/实施/上线/保障），每期 1-5 条任务、任务名 ≤16 字、格式「任务名 :a1, 起始, 工期d」并用 after 承接上一任务；总工期必须与【全局事实】中的工期/实施周期一致——事实表或招标原文给出了日期依据时用真实日期，没有时以 2026-01-01 为示意起点并在图注末尾加「（进度为示意编排）」；禁止编造与事实冲突的日期与阶段；`,
    )
    ruleNo += 1
  }
  if (opts.orchestration?.table) {
    rules.push(
      `${ruleNo}. 本章宜含一个表格：${opts.orchestration.table.purpose}（用纯文本表格行表达，遵守排版惯例：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）；`,
    )
    ruleNo += 1
  }
  if (opts.figures) {
    rules.push(
      `${ruleNo}. 可为本章附 0-2 个结构化配图数据（figures 数组，没有合适图型就输出空数组，不要硬凑）：architecture（架构图）{"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；flow（流程图）{"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；demo（系统界面示意）{"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}；`,
      `${ruleNo + 1}. 配图内容必须直接取自本章将要撰写的实际内容：architecture 各层 modules 必须是本章正文提到的子系统/功能模块，flow 的 steps 必须是本章撰写的业务环节/操作步骤，demo 的 main 区块与 sidebar 菜单必须是正文出现的功能页面/界面区块，用词与正文一致；严禁「模块A」「步骤1」「系统模块」「功能模块二」等泛化占位词与纯序号命名；`,
      `${ruleNo + 2}. 输出严格 JSON，禁止解释文字、禁止代码围栏，格式：{"content":"本章纯文本正文（禁止 markdown 符号）","figures":[]}`,
    )
  } else {
    rules.push(`${ruleNo}. 直接输出纯文本正文：禁止 markdown 符号（#、*、-、反引号）、禁止输出本章以外内容、禁止开场白与总结语；`)
  }
  const system = rules.join("\n")
  // 第十六轮 A：多消息缓存序——稳定大块（同项目跨章 identical）作第一条 user，
  // 每章差异内容作第二条 user，便于模型服务端命中前缀缓存（稳定上下文前置、任务差异置后）
  const stableUser = [
    // T20：项目背景画像放稳定块最前——「先了解项目再动笔」的依据（概述+项目信息同项目跨章 identical，不破缓存）
    overviewBlock ? `【项目背景与概况（写作前先理解，正文须结合本项目实际情况组织内容）】\n${overviewBlock}` : "",
    `【技术需求与交货服务要求】\n${techText || "（未解析）"}`,
    opts.starBlock ?? "",
    // R47（B20）：商务模板要求行（项目级稳定块，跨章 identical 不破前缀缓存；未上传模板时为空串被滤掉）
    templateReqs.length
      ? `【商务模板要求（商务同事提供模板里明写的要求，涉及即须满足）】\n${templateReqs.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
    // 循环 2 批 2-1：定向事实启用时全量全局事实不再进稳定块（定向块属章差异内容，进 taskUser 保前缀缓存）
    directedOn ? "" : (opts.globalFacts ?? ""),
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(outline ?? [])}`,
    implicitList.length
      ? `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  const taskUser = [
    factsBlock && directedOn ? factsBlock : "",
    lotsBlock,
    reqStructBlock,
    opts.tenderFragments
      ? `【招标原文相关段落（本章写作的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    opts.kbMaterial ? `【知识库参考素材（团队沉淀，融入时整理为本项目表述、不提及来源名称，可融入本章支撑细节）】\n${opts.kbMaterial}` : "",
    // T16：编排定向知识素材段（编排为本章挑选，优先于检索式素材吸收）
    opts.directedKnowledge?.length
      ? `【定向参考素材（编排阶段为本章挑选的知识库素材，优先吸收）】\n${opts.directedKnowledge.join("\n\n")}`
      : "",
    // R167：公司优质素材库标准件基线段（章差异内容进 taskUser，stableUser 跨章 identical 保前缀缓存）
    libraryBaseline
      ? `【公司优质素材库·${libraryKindLabel || "通用"}标准件（公司较优标书该主题的结构与写法基线，须按招标要求与全局事实改写，禁止照抄、禁止沿用占位）】\n${libraryBaseline}`
      : "",
    // 第十七轮 17D：团队写作资料段（章差异内容进 taskUser，stableUser 跨章 identical 保前缀缓存）
    // R167：有基线时只渲染基线之外的自由资料检索段（freeMaterialsText），避免重复
    freeMaterialsText
      ? `【团队写作资料（自有人员/案例/资质/制度，融入时整理为本项目表述、不出现来源字样，禁止整段照抄）】\n${freeMaterialsText}`
      : "",
    // 第十七轮 17B：清单文本仅目标章注入（stableUser 跨章 identical 保前缀缓存，章差异内容一律进 taskUser）
    opts.compilationBasis?.listText
      ? `【编制依据与规范清单（本章列示编制依据时以此为准，禁止编造编号）】\n${opts.compilationBasis.listText}`
      : "",
    prevSummaries.length
      ? `【相邻章上下文（仅供语气衔接与避免重复，禁止照抄其内容）】\n${prevSummaries.map((s) => `${s.title}\n${s.summary}`).join("\n\n")}`
      : "",
    `【当前要编写的章节】第${chapterNo}章 ${ch.title}`,
    sectionLines ? `本章小节：\n${sectionLines}` : "本章无预设小节，请按内容逻辑自行组织 2-4 个小节。",
    clauseList.length
      ? `【本章须响应的招标要求条款清单（逐条成段响应）】\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    opts.figures ? "请编写本章完整正文并按约定格式输出 JSON（content 正文 + 可选 figures）。" : "请编写本章完整正文。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: stableUser },
    { role: "user", content: taskUser },
  ]
}

export type BidSectionPromptOpts = BidChapterPromptOpts & {
  /** 当前小节名（不含编号的纯标题） */
  sectionName: string
  /** 小节编号前缀，如「3.2」 */
  sectionNo: string
  /** 当前小节在本章内的序号（0 起） */
  sectionIndex: number
  /** 本章小节总数 */
  sectionCount: number
  /** 归到本小节的招标要求条款（章级条款的子集） */
  sectionClauses?: RequirementClause[]
  /** 本章已写小节标题清单（防重复主题） */
  writtenTitles?: string[]
  /** 已写小节内容末尾（≤600 字，仅供衔接） */
  writtenTail?: string
}

/** R74/C-lot-splitting：多包件上下文——解析报告含「标包划分」分区时注入（用户可编辑该分区确认投标所投包件） */
function lotsContext(report: Parameters<typeof sectionText>[0]): string {
  const lots = sectionText(report, "lots").trim()
  if (!lots) return ""
  const scope = report?.lots_scope
  const hint = buildLotsScopeHint(scope?.selected, scope?.all?.length ?? 0)
  return `

【标包划分（多包件招标）】
${lots.slice(0, 1200)}${hint ? "\n\n" + hint : ""}
（本项目划分多个标包：正文必须只针对上述标包中招标文件指定/用户确认的包件范围撰写，禁止混入其他包件的货物、参数与报价。）`
}

/** Q26/切片B：采购需求结构上下文——解析报告含「采购需求结构」分区时注入子系统清单，约束正文只落在所投系统范围内 */
function reqStructureContext(report: Parameters<typeof sectionText>[0]): string {
  const sys = sectionText(report, "req_structure").trim()
  if (!sys) return ""
  const scope = report?.lots_scope
  const hint = buildLotsScopeHint(scope?.selected, scope?.all?.length ?? 0)
  return `

【采购需求子系统清单（本项目所投系统范围${hint ? "，已按所投包件范围约束" : ""}）】
${sys.slice(0, 1600)}${hint ? "\n\n" + hint : ""}
（正文须覆盖并限定于上述子系统：逐系统对应展开、不遗漏，也不得混入清单之外的系统；与标包划分同时存在时以所投保包内系统为准。）`
}
