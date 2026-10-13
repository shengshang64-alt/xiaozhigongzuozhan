// ---------------------------------------------------------------------------
// R70 提示词搬迁第六批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { buildLotsScopeHint, BID_STYLE_RULES, FULLTEXT_GUARD_RULES, ORCHESTRATION_FIGURE_TYPE_LABEL, PARAM_RESPONSE_BOUNDARY_RULES, PRE_OUTPUT_SELFCHECK_RULES, basisStyleRule, complianceModeRule, scoringDetailLines, sectionText, truthPreamble } from "../bidTypes"
import type { ParseReport, BidSectionPromptOpts } from "../bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"
// R167：素材库注入段的基线/检索拆分（单一真源在 materialLibrary，标记头由生成侧写入）
import { baselineLabelFromText, extractBaselineSegment, extractFragmentSegment } from "../materialLibrary"

// R167 v3：小节级同步新增「公司优质素材库标准件基线」独立注入槽（无标记时与 v2 逐字一致）
// R167 v4：2026-10 易标对齐轮——素材融入不提及来源（与 bidChapter 同口径同步），PROMPT_VERSION 3→4
// r287 v6（bid-l2-verbatim-compare 切片2·预防）：新增引号照录纪律规则条（第 6 条，其后规则序号顺移），
// 源头抑制「照抄途中改写」——L2 摸底引文级改写 34 处均产自生成环节；对比报告 .loop/reports/2026-10-13-r287-*.md
export const PROMPT_VERSION = 6

export function buildBidSectionMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  outline: OutlineNode[],
  chapters: Chapter[],
  chapterIndex: number,
  outlineToText: (nodes: OutlineNode[], prefix?: string) => string,
  opts: BidSectionPromptOpts,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const scoringDetail = scoringDetailLines(opts.scoring ?? [])
  const techText = sectionText(report, "delivery_req")
  const reqStructBlock = reqStructureContext(report)
  const lotsBlock = lotsContext(report)
  // T20：项目背景画像（与章级同口径；同项目跨节 identical，放稳定块不破缓存）
  const overviewBlock = [sectionText(report, "overview"), sectionText(report, "project_info")]
    .filter((s) => s.trim())
    .map((s) => s.trim())
    .join("\n")
    .split(/\n+/)
    .slice(0, 20)
    .join("\n")
  const prevSummaries = opts.prevSummaries ?? []
  const implicitList = opts.implicitConstraints ?? []
  const clauseList = opts.clauses ?? []
  const sectionClauses = opts.sectionClauses ?? []
  const writtenTitles = opts.writtenTitles ?? []
  // 循环 2 批 2-1：编排定向事实块非空时替代全量全局事实注入（与章级 builder 同口径）
  const directedOn = Boolean((opts.directedFacts ?? "").trim())
  const factsBlock = directedOn ? (opts.directedFacts ?? "").trim() : (opts.globalFacts ?? "")
  const factsLabel = directedOn ? "本章必守事实" : "全局事实"
  // R167：公司素材库标准件基线（节级同口径：生成侧带标记头注入，这里拆成独立提示词槽）
  const libraryBaseline = extractBaselineSegment(opts.refMaterials ?? "")
  const libraryKindLabel = baselineLabelFromText(opts.refMaterials ?? "")
  const freeMaterialsText = libraryBaseline ? extractFragmentSegment(opts.refMaterials ?? "") : (opts.refMaterials ?? "")
  const sectionList = (ch.sections ?? [])
    .map((s, j) => `${chapterNo}.${j + 1} ${s}${j === opts.sectionIndex ? "（当前要写的小节）" : ""}`)
    .join("\n")
  const rules = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在编写投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标第${chapterNo}章「${ch.title}」的第 ${opts.sectionIndex + 1} 个小节「${opts.sectionNo} ${opts.sectionName}」（本章共 ${opts.sectionCount} 个小节，本次只写这一个小节）。`,
    truthPreamble(),
    "写作铁律：",
    `1. 只写本小节内容：输出第一行必须是小节标题行「${opts.sectionNo} ${opts.sectionName}」（纯文本行，不带任何编号外的符号），随后直接写正文段落（3-8 段、每段 3-6 句）；不要写本章其他小节、不要输出章标题、不要开场白与收尾总结；`,
    "2. 内容必须真实可落地、可直接用于正式投标文件：使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），杜绝空话套话；",
    "3. 紧扣招标文件的评分办法与技术需求做实质性响应，涉及指标处给出量化承诺（并发用户数、响应时间、驻场人数、到场时限等），取值以招标原文与全局事实为准并遵守最小值响应：满足招标要求档位即可，禁止自行加码承诺；",
    scoringDetail
      ? `4. 本章已映射到以下评分点（评标专家将逐条核对），本小节写到对应内容时必须给出明确的实质性响应（措施/承诺/证明材料并点明评分项名），禁止只罗列功能清单。评分细则（项名 + 分值 + 评审标准原文）如下，对齐评审标准中的给分档位：\n${scoringDetail}`
      : "4. 本章未分配到具体评分细则，请围绕招标技术需求写出实质性响应内容；",
    `5. 本小节字数预算约 ${opts.wordBudget} 字（整章预算按小节均分），在该篇幅内围绕招标参数与评分办法扩展；禁止自造招标未给的具体参数数字，拿不准的用「按招标文件要求响应」等规范表述；`,
  ]
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
  if (opts.writtenTail) {
    rules.push(
      `${ruleNo}. 本小节开头必须与已写小节的结尾（见下面【已写小节内容结尾】）自然衔接，禁止重复或改写已写内容；`,
    )
    ruleNo += 1
  } else if (prevSummaries.length) {
    rules.push(
      `${ruleNo}. 本小节是本章第一个小节，首段必须自然承接上一章的收尾内容（见下面【相邻章上下文】）；相邻章内容仅供语气衔接与避免重复，禁止照抄、复述或改写其中任何具体表述；`,
    )
    ruleNo += 1
  }
  if (writtenTitles.length) {
    rules.push(`${ruleNo}. 不得重复【已写小节标题清单】中小节的主题，围绕本小节自身范围展开；`)
    ruleNo += 1
  }
  if (implicitList.length) {
    rules.push(`${ruleNo}. 下面【招标隐式硬约束】任何一条被违反都可能废标，本小节正文涉及相关内容时必须逐条满足；`)
    ruleNo += 1
  }
  if (sectionClauses.length) {
    rules.push(
      `${ruleNo}. 下面【本小节须响应的招标要求条款】共 ${sectionClauses.length} 条，必须在本小节内逐条实质性响应：每条条款至少有一段对应内容并给出量化承诺或落地措施，禁止遗漏、禁止泛泛带过；`,
    )
    ruleNo += 1
  } else if (clauseList.length) {
    rules.push(
      `${ruleNo}. 下面【本章须响应的招标要求条款清单】中与本小节主题相关的条款，必须在本小节内实质性响应；其余条款由本章其他小节响应，不要在本小节展开；`,
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
      `${ruleNo}. 本小节内容必须优先依据下面【招标原文相关段落】展开：技术参数、指标、配置与服务要求以原文为准，与原文冲突的表述一律以原文为准，禁止脱离原文空写套话；`,
      // T20：反罗列（与章级同口径）
      `${ruleNo + 1}. 使用【招标原文相关段落】时禁止整段照抄或逐条罗列原文的功能清单、系统列表与参数表：此类内容必须归纳为分析性表述（按业务域归类、说明对本项目的作用与建设考虑），原文细节只在支撑论述时引用；本小节标题含「需求分析」「现状分析」「背景」时，必须体现分析与论证过程；`,
    )
    ruleNo += 2
  } else if (techText) {
    // 切片B：bigram 检索无命中时仍强制要求贴【技术需求与交货服务要求】展开，杜绝脱离招标空写
    rules.push(
      `${ruleNo}. 本小节内容必须紧扣上方【技术需求与交货服务要求】和【评分办法明细】展开实质性响应，禁止写与招标要求无关的通用内容；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：逐条应答强化（开关开启才注入，零新增 LLM 调用）
  if (opts.starBlock) {
    rules.push(
      `${ruleNo}. 硬约束——★/▲ 重点条款原文响应（无条件执行，优先于上面生成模式档与下面任何扩写授权）：下面【★/▲ 重点条款】中的每一条，只要与本小节相关，都必须在本小节逐条原文响应：逐条照录条款原文内容——数值、单位、限定语、功能描述一字不改，仅将「要求/需/应/投标人应」等要求类字眼改为投标人自述人称，句末给出「完全满足招标文件要求」或「优于招标文件要求（具体说明）」的应答结论；禁止改写句式、禁止扩写压缩或概括条款、禁止在条款应答处插入【待填写】占位；与本小节无关的条款不必展开；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：素材优先注入（知识库块级检索命中才注入，注明来源文档）
  // 2026-10 易标对齐轮：融入口径升级——素材整理为本项目表述，正文不出现来源字样
  if (opts.kbMaterial) {
    rules.push(
      `${ruleNo}. 下面【知识库参考素材】是团队沉淀的方案素材（已注明来源文档），可作为本小节案例、数据与实施细节的支撑材料融入正文：融入时把素材内容整理为本项目的方案表述，不在正文中出现「知识库」「素材」「来源文档」等来源字样；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄；`,
    )
    ruleNo += 1
  }
  // T16：编排期定向挑选的知识库素材（优先级高于检索式注入）
  if (opts.directedKnowledge?.length) {
    rules.push(
      `${ruleNo}. 下面【定向参考素材】是编排阶段为本小节挑选的知识库素材（已注明来源文档），本小节写作应优先吸收其中相关的案例、数据与实施细节，整理为本项目的方案表述，不在正文中提及素材与来源名称；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄，禁止编造素材里没有的内容；`,
    )
    ruleNo += 1
  }
  // 第十七轮 17D：团队写作资料注入（检索命中才注入；可引用事实与口径，禁止整段照抄）
  // 2026-10 易标对齐轮：「引用处注明来自自有资料」升级为「整理为本项目表述、不出现来源字样」
  if (opts.refMaterials) {
    rules.push(
      `${ruleNo}. 下面【团队写作资料】是自有的人员、案例、资质与制度材料：本小节写到团队配置、同类业绩、资质能力、管理制度等内容时优先引用其中的事实与口径，融入时整理为本项目的方案表述，不在正文中出现「自有资料」「内部资料」等来源字样；禁止整段照抄，禁止编造资料里没有的人员与业绩；`,
    )
    ruleNo += 1
  }
  // R167：公司素材库标准件基线注入（小节级同口径：先结构基线，再按招标要求与全局事实定向调整）
  if (libraryBaseline) {
    rules.push(
      libraryKindLabel
        ? `${ruleNo}. 下面【公司优质素材库·${libraryKindLabel}标准件】是公司较优标书中该主题的写法范式，不是本项目事实：本小节以它的结构与写法要求为基线，再按招标文件的条款、评分办法与【${factsLabel}】逐项定向调整（篇幅服从本小节预算）；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`
        : `${ruleNo}. 下面【公司优质素材库标准件】是公司较优标书的写法范式，不是本项目事实：本小节以它的结构与写法要求为基线，再按招标文件与【${factsLabel}】逐项定向调整；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`,
    )
    ruleNo += 1
  }
  // 循环 2 批 1-4：暗标身份脱敏规则条（sealed=true 时注入，零新增 LLM 调用）
  if (opts.sealedIdentityRules) {
    rules.push(`${ruleNo}. ${opts.sealedIdentityRules}`)
    ruleNo += 1
  }
  // 第十七轮 17B：编制依据列示——节级继承章判断（规则句全节携带；清单文本仅目标章的小节携带）
  if (opts.compilationBasis) {
    rules.push(
      `${ruleNo}. 本小节涉及编制依据（标准规范/技术依据）时按约定样式列示：${basisStyleRule(opts.compilationBasis.style)}${
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
  // 第十六轮 B2 改造 2.2：预编排注入——本小节被选中配图时输出契约改为 JSON（content+figures），否则维持纯文本
  // 循环 2 批 2-1：写作焦点进规则句；编排图带图注时要求图元素支撑图注
  if (opts.orchestration?.writing_focus) {
    rules.push(
      `${ruleNo}. 本小节写作焦点：${opts.orchestration.writing_focus}；正文须围绕该焦点组织重点内容，并对其中点名的评分点给出实质性响应；`,
    )
    ruleNo += 1
  }
  const orchFigure = opts.orchestration?.figure
  if (opts.orchestration?.table) {
    rules.push(
      `${ruleNo}. 本小节宜含一个表格：${opts.orchestration.table.purpose}（用纯文本表格行表达，遵守排版惯例：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）；`,
    )
    ruleNo += 1
  }
  if (orchFigure) {
    const figCaption = (orchFigure.caption ?? "").trim()
    // T16：编排选中 mermaid 关系图时，配图格式契约切换为 mermaid 源码图；2026-10 加 gantt（甘特图，同走 mermaid 渲染链）
    const figureFormatRule =
      orchFigure.type === "mermaid"
        ? `${ruleNo + 1}. 该图为 mermaid 源码图，输出格式 {"type":"mermaid","title":"图名","code":"flowchart TD\\n A[\\"节点\\"] --> B[\\"节点\\"]"}；code 只允许 flowchart/graph 声明开头、节点总数 ≤12、每个节点标签 ≤16 字、中文与含特殊字符的标签必须用双引号包裹；code 必须对应本小节正文描述的流程/关系，禁止编造正文没有的环节；`
        : orchFigure.type === "gantt"
          ? `${ruleNo + 1}. 该图为项目实施甘特图，figures 输出 {"type":"mermaid","title":"图名","code":"<gantt 源码>"}；code 首行必须是 gantt、第二行 dateFormat YYYY-MM-DD，用 section 把实施阶段分为 2-5 期，每期 1-5 条任务、任务名 ≤16 字、格式「任务名 :a1, 起始, 工期d」并用 after 承接上一任务；总工期必须与【全局事实】中的工期/实施周期一致——有日期依据时用真实日期，没有时以 2026-01-01 为示意起点并在图注末尾加「（进度为示意编排）」；禁止编造与事实冲突的日期与阶段；`
          : `${ruleNo + 1}. 配图元素格式：architecture（架构图）{"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；flow（流程图）{"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；demo（系统界面示意）{"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}；`
    rules.push(
      `${ruleNo}. 本小节已编排一张${ORCHESTRATION_FIGURE_TYPE_LABEL[orchFigure.type]}：《${orchFigure.title}》${
        figCaption ? `，图注「${figCaption}」` : ""
      }，figures 必须输出该图且内容全部取自本小节正文（模块/步骤/区块用词与正文一致，禁止泛化占位词${figCaption ? "，图元素必须能支撑图注所述内容" : ""}）；`,
      figureFormatRule,
      `${ruleNo + 2}. 输出严格 JSON，禁止解释文字、禁止代码围栏，格式：{"content":"本小节纯文本正文（第一行为「${opts.sectionNo} ${opts.sectionName}」标题行，禁止 markdown 符号）","figures":[该张配图]}`,
    )
  } else {
    rules.push(
      `${ruleNo}. 直接输出本小节纯文本：第一行为「${opts.sectionNo} ${opts.sectionName}」标题行，禁止 markdown 符号（#、*、-、反引号）、禁止 JSON、禁止本小节以外的内容；`,
    )
  }
  const system = rules.join("\n")
  // 第十六轮 A：多消息缓存序——稳定大块前置（同项目跨小节 identical），小节差异置后
  const stableUser = [
    // T20：项目背景画像放稳定块最前（同章级口径）
    overviewBlock ? `【项目背景与概况（写作前先理解，正文须结合本项目实际情况组织内容）】\n${overviewBlock}` : "",
    `【技术需求与交货服务要求】\n${techText || "（未解析）"}`,
    opts.starBlock ?? "",
    // 循环 2 批 2-1：定向事实启用时全量全局事实不再进稳定块（定向块属小节差异内容，进 taskUser 保前缀缓存）
    directedOn ? "" : (opts.globalFacts ?? ""),
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(outline ?? [])}`,
    implicitList.length
      ? `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  const taskUser = [

    lotsBlock,
    reqStructBlock,
    factsBlock && directedOn ? factsBlock : "",
    opts.tenderFragments
      ? `【招标原文相关段落（本小节写作的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    opts.kbMaterial ? `【知识库参考素材（团队沉淀，融入时整理为本项目表述、不提及来源名称，可融入本小节支撑细节）】\n${opts.kbMaterial}` : "",
    // T16：编排定向知识素材段（编排为本小节挑选，优先于检索式素材吸收）
    opts.directedKnowledge?.length
      ? `【定向参考素材（编排阶段为本小节挑选的知识库素材，优先吸收）】\n${opts.directedKnowledge.join("\n\n")}`
      : "",
    // 第十七轮 17D：团队写作资料段（小节差异内容进 taskUser）
    freeMaterialsText
      ? `【团队写作资料（自有人员/案例/资质/制度，融入时整理为本项目表述、不出现来源字样，禁止整段照抄）】\n${freeMaterialsText}`
      : "",
    // R167：公司优质素材库标准件基线段（节级继承章的类别判定）
    libraryBaseline
      ? `【公司优质素材库·${libraryKindLabel || "通用"}标准件（公司较优标书该主题的结构与写法基线，须按招标要求与全局事实改写，禁止照抄、禁止沿用占位）】\n${libraryBaseline}`
      : "",
    // 第十七轮 17B：清单文本仅目标章的小节注入（节级继承章判断）
    opts.compilationBasis?.listText
      ? `【编制依据与规范清单（本小节列示编制依据时以此为准，禁止编造编号）】\n${opts.compilationBasis.listText}`
      : "",
    prevSummaries.length
      ? `【相邻章上下文（仅供语气衔接与避免重复，禁止照抄其内容）】\n${prevSummaries.map((s) => `${s.title}\n${s.summary}`).join("\n\n")}`
      : "",
    `【本章小节清单（当前只写第 ${opts.sectionIndex + 1} 个，其余小节不要展开）】\n${sectionList}`,
    `【当前要编写的小节】${opts.sectionNo} ${opts.sectionName}`,
    writtenTitles.length ? `【已写小节标题清单（不得重复其主题）】\n${writtenTitles.join("\n")}` : "",
    opts.writtenTail ? `【已写小节内容结尾（仅供衔接，禁止重复或照抄）】\n${opts.writtenTail}` : "",
    sectionClauses.length
      ? `【本小节须响应的招标要求条款（逐条成段响应）】\n${sectionClauses.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    clauseList.length && !sectionClauses.length
      ? `【本章须响应的招标要求条款清单（与本小节相关的在本小节落实）】\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    `请编写本小节完整正文，第一行为「${opts.sectionNo} ${opts.sectionName}」标题行。`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: stableUser },
    { role: "user", content: taskUser },
  ]
}

/** 继续生成：把现有正文末尾作为上下文，要求 LLM 从断点续写补足本章篇幅预算；返回值追加到现有正文末尾 */

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
