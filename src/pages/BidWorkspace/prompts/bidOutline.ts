// ---------------------------------------------------------------------------
// R69 提示词搬迁第五批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { buildLotsScopeHint, BID_OUTLINE_REQ_KEY, STAR_CLAUSE_SECTION, clipText, combinedScoringText, complianceOutlineRule, numberScoringItems, numberedScoringDetailLines, sectionText, sectionTextAny, truthPreamble } from "../bidTypes"
import type { BidScope, ComplianceMode, ParseReport, RequirementClause } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// R47（B20）v4→v5：新增「商务模板要求」注入槽（templateRequirements 非空才注入；空数组时输出与 v4 逐字一致）
// REQ-054 v5→v6：目录固定两级（level=0 原「最多五级」、level=3 原「恰好三级」均改为两级），
//   深层功能层次改由正文行内编号承载；依据 15 个存量项目实测 929 个三级节点仅 5 个成为小节。
export const PROMPT_VERSION = 6

/** 大纲生成：注入评分办法 / 响应要求 / 商务条款 + 招标要求条款清单 + 全局事实表；级数与叶子规模（leafTarget ±20%）作硬约束 */
export function buildBidOutlineMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  fromDraft: boolean,
  level: 0 | 1 | 2 | 3,
  clauses?: RequirementClause[],
  opts?: {
    leafTarget?: number
    sectionWords?: number
    globalFacts?: string
    implicitConstraints?: string[]
    /** 第十七轮 17D：历史范本目录结构标题行（本地抽取产物；空数组/缺省=不注入，行为同现状） */
    refTemplateOutline?: string[]
    /** R47（B20）：商务模板里明写的要求行（TemplateProfile.requirements 已滤掉排版类；空数组/缺省=未上传模板，行为同现状） */
    templateRequirements?: string[]
    /** 用户反馈轮项 3：是否输出商务标骨架章（缺省 true；false 时商务段整体替换为「不输出任何商务章节」） */
    includeBiz?: boolean
    /** R206 切片 1（R-002）：内容范围三模式；缺省时由 includeBiz 派生（true→both / false→tech），存量零变化 */
    scope?: BidScope
    /** 05 三模式（§5.4）：合规严格度驱动技术章骨架宽度（缺省/strict=现状零改动；full 允许增设支撑性技术章） */
    complianceMode?: ComplianceMode
    /** R-017 必备技术内容清单（可配置下限，凡技术/交付/服务即必写）：非空才注入硬约束，缺省=现状字节不变 */
    requiredTechContents?: string[]
  },
): LlmMessage[] {
  const scope: BidScope = opts?.scope ?? (opts?.includeBiz === false ? "tech" : "both")
  const includeBiz = scope !== "tech"
  const includeTech = scope !== "biz"
  const scoringText = combinedScoringText(report)
  // R31：编号评分项列表，为大纲承接标注提供稳定 R-id 链
  const numberedItems = numberScoringItems(report)
  const numberedScoringText = numberedItems.length ? numberedScoringDetailLines(numberedItems) : scoringText
  const bizText = sectionText(report, "biz_score")
  const respText = sectionText(report, "response_req")
  const techText = sectionText(report, "delivery_req")
  const qualText = sectionText(report, "qualification")
  const lotsBlock = lotsContext(report)
  const reqStructBlock = reqStructureContext(report)
  // 第十二轮遗留清偿：大纲编制接入 ★/▲ 重点条款（本地扫描产物，零新增 AI 调用）
  const starText = sectionText(report, STAR_CLAUSE_SECTION.key).trim()
  // 第十七轮 17A：招标规定的投标文件目录（既有解析项产物，零新增 AI 调用）
  const outlineReqText = sectionText(report, BID_OUTLINE_REQ_KEY).trim()
  // 循环 2 批 2-3：商务骨架章编排依据三段（解析项产物本地注入，零新增 AI 调用；旧 key 报告经别名兜底）
  const keyNodesText = sectionTextAny(report, ["bid_nodes", "key_nodes"]).trim()
  const depositText = sectionTextAny(report, ["bid_deposit", "bid_bond"]).trim()
  const contractText = [
    sectionTextAny(report, ["contract_terms"]),
    sectionTextAny(report, ["contract_award"]),
    sectionTextAny(report, ["contract_end"]),
  ]
    .filter((s) => s.trim())
    .join("\n")
    .trim()
  const clauseList = clauses ?? []
  const leafTarget = Math.max(0, Math.round(opts?.leafTarget ?? 0))
  const sectionWords = Math.min(2000, Math.max(400, Math.round(opts?.sectionWords ?? 800)))
  const leafLo = Math.max(1, Math.ceil(leafTarget * 0.8))
  const leafHi = Math.max(leafLo, Math.floor(leafTarget * 1.2))
  const implicitList = opts?.implicitConstraints ?? []
  const requiredList = (opts?.requiredTechContents ?? []).map((k) => k.trim()).filter(Boolean)
  const templateReqs = (opts?.templateRequirements ?? []).map((t) => (t ?? "").trim()).filter(Boolean).slice(0, 20)
  // REQ-046（2026-10-18）：level===0 从「最多三级」放开到「最多五级」。
  //
  // 依据金标准实测（池州【主】1129上午修订，用户 2026-10-18 指定）：
  //   该件标题 765 个、最深 7 级，形态是 `12.9.8.1.1.1门急诊挂号收费系统` 这种纯数字多级编号；
  //   而工作站产物最深只有 2-3 级（三明 3 级、海沧/安庆/芜湖/福安 2 级）。
  //   层级不够就装不下「一个功能点一条」——功能条目要挂在具体系统/模块下，目录不细分，
  //   条目只能挤在上一级里写成散文（这正是三明 10 条/万字、其余 0 条/万字的成因之一）。
  //
  // 只放开 level===0（用户没指定级数、由 AI 自定）这一档：
  //   level 1/2/3 是用户在界面里**明确选的**硬约束，擅自改会破坏「我选了三级」的语义。
  //   而 level===0 的原文就是「由你自行决定合理级数」，把上限从三提到五不改变语义，
  //   只是把天花板抬高——金标准是 7 级，但大纲层给到 5 级已够承载功能条目，
  //   再深会让用户在目录面板里翻不动（金标准是 Word 文档，界面树形控件体验不同）。
  // REQ-054（2026-10-18）：大纲固定两级。此前 level=0 允许「最多五级」、level=3 要求「恰好三级」，
  // 但入库端 Chapter.sections 是 string[]（只装一层小节标题），alignChaptersWithOutline 与
  // useBidWorkspace:4992 都只取 n.children 一层 —— 第 3 级及以下节点生成后即被静默丢弃。
  // 实测 15 个存量项目：929 个三级节点里只有 5 个（0.5%）成为章节小节，924 个从未参与正文生成。
  // 所以不是「三级暂时没用上」，是「三级在本产品里根本没有落点」。
  // 深层功能层次改由正文行内编号承载（REQ-052/053 已验证 （一）→H3 /（1）→H4 / ①→H5 全链路通），
  // 大纲层靠「节的数量与命名」覆盖评分点，不靠加深目录。
  const depthRule =
    level === 0
      ? "目录固定两级：技术章恰好两级（章—节），每个技术章下必须有节，**节节点的 children 一律为空数组**，禁止出现三级及更深的节点——更深的功能层次不靠目录表达，由正文用（一）/（1）/① 行内编号承载（见正文写作规则）。功能密集的技术章靠「节的数量与命名」覆盖评分点，不靠加深目录层级；每个技术章建议 4~12 个节，节名要能对上评分办法的评分点或需求书的功能域；保证评分办法每一档都有章节落点（级数约束只针对技术章，商务骨架章固定为章+一级小节两级）。"
      : level === 1
        ? "级数硬约束（只按技术章计算）：技术章只有一级（章），技术章 children 一律为空数组，禁止出现二级或三级节点；商务骨架章可保留其一级小节。"
        : level === 2
          ? "级数硬约束（只按技术章计算）：技术章恰好两级（章—节），每个技术章下必须有节，节节点的 children 一律为空数组，禁止出现三级节点；商务骨架章固定为章+一级小节。"
          : "级数硬约束（只按技术章计算）：技术章恰好两级（章—节），每个技术章下必须有节，节节点的 children 一律为空数组；**用户选的「三级」在本产品中等价于两级**——第三层由正文行内编号（一）/（1）/① 承载，不生成大纲节点；每个技术章建议 4~12 个节，节名要能对上评分办法的评分点；商务骨架章仍只列一级小节、不展开三级。"
  const numbered: string[] = scope === "both"
    ? [
        "大纲顶层章分「商务部分」与「技术部分」两组：商务章在前、技术章在后，每个顶层章对象必须带 part 字段标明归属（\"biz\"=商务章、\"tech\"=技术章），深层节点不带 part；",
        "商务部分输出 6-10 个骨架章（part=\"biz\"）：投标函及报价、法定代表人授权、资质与证照证明、财务审计报告、同类项目业绩、商务条款响应/偏离表、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删，下面给出【投标保证金】【合同关键条款】时商务部分还须有对应骨架章落点（保证金缴纳与退还、合同条款响应、质保衔接等）；商务章 children 只列一级小节名即可（不展开三级），这些章的正文由投标人线下填写、不生成正文；",
      ]
    : scope === "tech"
      ? [
          "大纲顶层章全部为技术部分：每个顶层章对象必须带 part 字段（一律 \"tech\"），深层节点不带 part；",
          "本次不输出任何商务部分章节（part=\"biz\"），大纲仅含技术标章节；投标函、资质证照、商务偏离表等商务内容由投标人线下自行处理，禁止为其安排任何章节；",
        ]
      : [
          "大纲顶层章全部为商务部分：每个顶层章对象必须带 part 字段（一律 \"biz\"），深层节点不带 part；",
          "本次仅编制商务标，输出 8-12 个商务章（part=\"biz\"）：投标函、法定代表人身份证明、授权委托书、报价一览表、分项报价表、商务条款响应偏离表、资格证明文件、财务审计报告、同类项目业绩、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删；每章 children 展开到二级小节（本章正文将由系统按招标商务要求逐条生成，需具体小节承载，不得只列一级骨架）；",
          "本次不输出任何技术部分章节（part=\"tech\"），技术方案、实施组织、售后技术内容等全部由技术标单独编制，禁止为其安排任何章节；",
        ]
  if (includeTech)
    numbered.push(
    "技术部分（part=\"tech\"）为详细响应骨架，必须以评分办法为纲：逐条覆盖下面技术评分的评分点，每个重要评分项都要落到具体章或节标题；",
    "事实来源排他（防幻觉，2026-09-23 用户反馈轮：目录不一致/编造招标要求）：大纲中的章节主题、顺序与评分承接只能以下面【技术评分办法】【商务评分办法】【技术方案与响应要求】【招标文件规定的投标文件目录】【★/▲ 重点条款】等注入内容与常规骨架为依据；禁止编造注入内容中不存在的评分项、分值、条款编号或目录要求，禁止把行业常识写成「响应招标文件第X条」式标题；某方面无注入依据时用常规骨架命名，不得假称招标要求；",
    "承接标注（R31）：每个技术章下的叶子节点（末级节/条）必须在 description 字段中标注其承接的评分编号，格式 `[响应:R1]` 或 `[响应:R1,R3]`（多个逗号分隔）；一个叶子只标注其直接相关的 1-3 个编号；商务骨架章不标注；不承接任何评分项的叶子节点可省略 description；",
    "响应文件要求须逐条落实（组成、格式、签字盖章与装订要求对应专门章节或节）；",
    "技术部分常规骨架参考：项目理解与需求分析、总体建设方案、详细技术方案（按系统分章）、项目实施组织与进度计划、质量保障与测试验收、培训方案、售后服务与运维保障、应急预案；再按本招标文件增删；",
    // REQ-046（2026-10-18）：层级命名规范从「一级/二级/三级」放开到五级。
    // 原句「一级=部分/章，二级=节，三级=条」把可用的层数写死在三条——
    // depthRule 里已经允许到五级，这里却又只定义三级命名，模型按命名规范只出三级。
    // 实测（buildBidOutlineMessages level=0）：层级分布 1级×11 / 2级×34 / 3级×62 / 4级×0 / 5级×0。
    // 金标准（池州主-1129上午修订）的形态是 `12.9.8.1.1.1门急诊挂号收费系统`，最深 7 段编号，
    // 即「系统 → 子系统 → 功能域 → 功能点」这类逐级细分。五级命名给足承载位即可。
    // REQ-054（2026-10-18）：这两条原本要求「三级=条/四级=目/五级=子目」与「必须细分到四级以上」，
    // 与 depthRule 的两级约束直接冲突——模型按命名规范走，加多少「不要三级」都拉不回来。
    // 实测（改 depthRule 但未改这两条）：level=0 输出 137 节点 / 最深 3 级，结构判据 false；
    // level=3 输出 280 节点 / 最深 4 级，结构判据 false。两条规则把它们拉回去了。
    // 现改为两级命名规范 + 用「节的数量与命名」承载功能点，不再靠加深目录。
    "标题只写名称（编号由导出器的多级编号样式自动生成，大纲里不写）；层级命名规范：一级=部分/章，二级=节；**只有两级，不设三级及更深层级**；",
    "功能密集的技术章（含「功能/模块/系统/技术方案/建设内容」的章）靠「节的数量与命名」承载功能点：把招标要求的功能域、子系统、评分点逐一落成独立的节（如「门诊挂号与预约」「门急诊收费结算」「医保接口对接」），每节名直接是一个具体功能域或评分点，让每个功能点都有节承载；**禁止把功能点写进第三级节点**——更细的功能分解（一个功能点一条）由正文用（一）/（1）/① 行内编号表达，不占目录层级；技术章建议 4~12 个节（不设总节点数下限，节点少但节名准优于节点多米散）。",
    "节/条标题必须用具体响应式命名：主题词+落点词（设计/范围/保障/机制/流程等），形如「设备兼容性设计」「多模态数据处理范围」「知识更新机制」；禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
  )
  else
    numbered.push(
    "事实来源排他（防幻觉）：商务章的主题、顺序只能以下面【商务评分办法】【技术方案与响应要求】【招标文件规定的投标文件目录】等注入内容与常规商务骨架为依据；禁止编造注入内容中不存在的要求、分值或条款编号；某方面无注入依据时用常规商务骨架命名，不得假称招标要求；",
    "响应文件要求须逐条落实（组成、格式、签字盖章与装订要求对应专门商务章节或节）；",
    "标题只写名称、不带编号、不以标点结尾；层级命名规范：一级=章，二级=节；",
    "节标题必须用具体响应式命名：主题词+落点词（承诺/响应/声明/证明/报价等），禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
  )
  // R47（B20）：商务模板明写的要求——非空才追加硬约束条，缺省时 prompt 与现状字节一致
  if (templateReqs.length) {
    numbered.push(
      `下面【商务模板要求】共 ${templateReqs.length} 条，全部来自商务同事提供的投标模板、是模板里明写的要求：大纲必须为每一条安排明确的章节落点（内容与结构口径以模板为准），禁止遗漏；`,
    )
  }
  // R207 切片 2（R-003）：无底稿兜底——解析到「响应文件组成」时强制顶层章逐项映射其顺序与命名（缺组成时不注入，走运行时告警）
  if (respText) {
    numbered.push(
      "响应文件组成硬约束：下面【技术方案与响应要求】中「响应文件组成」列出的每个组成部分（如报价文件、商务文件、技术文件、资格证明、承诺函、授权委托书、响应表、偏离表等），必须逐项映射为目录中对应的顶层章或专门小节，顺序与命名保持一致，不允许合并或改名；组成未列出但编制必需的常规章可在末尾补充；",
    )
  }
  // 05 三模式（§5.4）：骨架宽度随模式追加（strict/缺省 不追加，大纲 prompt 与现状字节级一致）
  const outlineModeRule = complianceOutlineRule(opts?.complianceMode)
  if (outlineModeRule) {
    numbered.push(outlineModeRule)
  }
  // 第十七轮 17A：招标已规定响应目录时，章结构遵循其顺序与层级（置于硬性要求前列）
  if (outlineReqText) {
    numbered.splice(
      1,
      0,
      `招标已规定响应目录（见下面【招标文件规定的投标文件目录】）：大纲章结构必须遵循其顺序与层级，禁止另起炉灶；标题文字可润色补全，规定目录未覆盖的内容可在末尾补充章节${
        includeBiz ? "，商务骨架章（part=\"biz\"）仍置于最前" : ""
      }；`,
    )
  }
  if (leafTarget > 0) {
    numbered.push(
      level > 0
        ? `规模硬要求（只按技术章计算，商务章叶子不计入）：技术部分叶子节点（无子节点的末端节点）总数必须落在 ${leafLo}-${leafHi} 个区间（目标 ${leafTarget} 个），每个叶子节点将承载约 ${sectionWords} 字正文，技术章的数量要与该规模匹配（不再局限 8-12 章）；不足时按系统/模块/阶段/保障维度拆章节拆小节补足叶子，超出时合并相近叶子；`
        // REQ-054：原句结尾是「级数仍由你按招标要求自定」——与 depthRule 的两级约束直接冲突，
        // 模型读到这句就自己加深层级。现明确：靠「节的数量」满足叶子规模，不靠加深层级。
        : `规模参考（只按技术章计算）：整份文档体量反推的技术部分目标叶子节点数约 ${leafTarget} 个（每叶子承载约 ${sectionWords} 字），技术章**节**（叶子）总数尽量落在 ${leafLo}-${leafHi} 个区间；**通过增加「节」的数量来满足该规模，不要通过加深层级（三级/四级）来凑叶子数**——叶子就是节，节下不再有节点；`,
    )
  }
  if (implicitList.length) {
    numbered.push(
      `下面【招标隐式硬约束】共 ${implicitList.length} 条（如页数 / 份数 / 装订 / 格式等刚性要求），任何一条被违反都可能废标，大纲必须保证每条约束都有对应章节落点；`,
    )
  }
  if (starText) {
    numbered.push(
      "下面【★/▲ 重点条款】为招标文件带标记的实质性响应条款，任何一条未响应都可能直接废标：大纲必须让每条重点条款都有明确章节落点（如资质与证照证明、项目经理资历、售后服务承诺、技术需求逐条应答、原厂授权等对应专门章节或节），禁止只靠通用章节笼统带过；",
    )
  }
  if (includeTech && requiredList.length) {
    numbered.push(
      `必备技术内容清单（R-017，可配置下限：凡技术/交付/服务即必写）：以下主题凡在本项目出现即必须有独立技术章或节承载，禁止并入「其他/概述」式通用章或整体省略：${requiredList.slice(0, 30).join('、')}；`,
    )
  }
  if (clauseList.length) {
    numbered.push(
      `下面【招标要求条款清单】共 ${clauseList.length} 条，每条条款必须至少对应一个技术章（part="tech"）下的大纲叶子节点（无子节点的章/节/条），对应叶子节点的标题须包含该条款的核心词，禁止遗漏任何条款；商务骨架章不承担条款覆盖，coverage 的落点一律填技术章的叶子标题；`,
      '输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（顶层章必须带 part 字段；技术叶子节点带 description 承接标注；coverage 逐条给出条款在技术章里的落点叶子标题，clause_id 与清单一致）：{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[],"description":"[响应:R1,R3]"}]}]}],"coverage":[{"clause_id":"c1","node_title":"对应叶子节点标题"}]}',
    )
  } else {
    numbered.push(
      '输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（顶层章必须带 part 字段；技术叶子节点带 description 承接标注）：{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[],"description":"[响应:R1,R3]"}]}]}]}',
    )
  }
  const rules = [
    "你是一位深耕医疗信息化行业十余年的资深投标顾问，擅长按评分办法组织技术标结构，确保每一分都有对应响应章节。",
    truthPreamble(),
    `当前任务：为投标项目「${projectName}」（采购人：${hospital || "未填写"}）生成投标文件响应大纲${
      scope === "biz"
        ? "（仅商务部分详细大纲，不含任何技术章节）"
        : includeBiz
          ? "（商务部分骨架 + 技术部分详细大纲）"
          : "（仅技术部分详细大纲，不含任何商务章节）"
    }，${depthRule}`,
    fromDraft ? "本次在已有方案底稿基础上按招标文件要求调整结构，保留底稿中仍然适用的章节。" : "",
    "硬性要求：",
    ...numbered.map((t, i) => `${i + 1}. ${t}`),
  ]
  const system = rules.filter((x) => x !== "").join("\n")
  // 第十六轮 A：多消息缓存序——项目级稳定块前置（同项目多次重生成 identical），任务差异置后
  const stableParts = [
    `【技术评分办法（逐项分值，编号用于大纲承接标注）】\n${numberedScoringText || "（未解析到技术评分）"}`,
    // 用户反馈轮项 3：不含商务章时商务评分办法与三段商务编排依据不再注入（避免误导模型输出商务章）
    ...(includeBiz ? [`【商务评分办法】\n${bizText || "（未解析到商务评分）"}`] : []),
    `【技术方案与响应要求】\n${[respText, techText].filter((s) => s.trim()).join("\n") || "（未解析到响应要求）"}`,
    `【资质要求】\n${qualText || "（无）"}`,
  ]
  // 循环 2 批 2-3：投标关键节点 / 投标保证金 / 合同关键条款三段（非空才注入，商务骨架章编排依据）
  if (includeBiz && keyNodesText) {
    stableParts.push(`【投标关键节点（商务骨架章编排依据，全文时间口径必须与之一致）】\n${clipText(keyNodesText, 2000)}`)
  }
  if (includeBiz && depositText) {
    stableParts.push(`【投标保证金（商务骨架章编排依据）】\n${clipText(depositText, 1500)}`)
  }
  if (includeBiz && contractText) {
    stableParts.push(`【合同关键条款（商务骨架章编排依据）】\n${clipText(contractText, 3000)}`)
  }
  if (opts?.globalFacts) stableParts.push(opts.globalFacts)
  if (lotsBlock) stableParts.push(lotsBlock)
  if (reqStructBlock) stableParts.push(reqStructBlock)
  if (implicitList.length) {
    stableParts.push(
      `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  if (starText) {
    stableParts.push(`【★/▲ 重点条款（实质性响应条款，大纲每条必须有章节落点）】\n${clipText(starText, 6000)}`)
  }
  // 第十七轮 17A：招标规定的投标文件目录（截断 4000 字，项目级稳定块，缓存序不变）
  if (outlineReqText) {
    stableParts.push(`【招标文件规定的投标文件目录（章结构必须遵循其顺序与层级）】\n${clipText(outlineReqText, 4000)}`)
  }
  // R-017 必备技术内容清单（项目级稳定块，缓存序不变；非空才注入）
  if (includeTech && requiredList.length) {
    stableParts.push(
      `【必备技术内容清单（每项必须有独立章节落点，凡技术/交付/服务即必写）】\n${requiredList.map((k, i) => `${i + 1}. ${k}`).join('\n')}`,
    )
  }
  // 第十七轮 17D：历史范本目录结构（本地抽取标题行，零 AI）——只参考章法与章节粒度，不照抄标题
  const refOutlineLines = (opts?.refTemplateOutline ?? []).slice(0, 80)
  if (refOutlineLines.length) {
    stableParts.push(
      `【历史范本目录结构（参考其章法与章节粒度，不照抄标题）】\n${refOutlineLines.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  // R47（B20）：商务模板要求行（项目级稳定块，同项目多次重生成 identical、不破前缀缓存；非空才注入）
  if (templateReqs.length) {
    stableParts.push(
      `【商务模板要求（商务同事提供模板里明写的要求，大纲逐条须有章节落点）】\n${templateReqs.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  const taskParts: string[] = []
  if (clauseList.length) {
    taskParts.push(
      `【招标要求条款清单（每条必须落到叶子节点并写进 coverage）】\n${clauseList.map((c) => `${c.id}. [${c.source}] ${c.text}`).join("\n")}`,
    )
  }
  taskParts.push(
    level === 0
      ? "请生成这份投标文件的响应大纲 JSON（商务部分骨架章在前、技术部分详细章在后，顶层章带 part 字段；技术部分为**章—节两级**，节节点 children 一律为空数组，功能点由正文行内编号承载，不得再生成第三级节点）。"
      : `请生成这份投标文件的 ${level} 级响应大纲 JSON（商务部分骨架章在前、技术部分详细章在后，顶层章带 part 字段；技术部分级数与叶子规模必须同时满足上述硬约束）。`,
  )
  return [
    { role: "system", content: system },
    { role: "user", content: stableParts.join("\n\n") },
    { role: "user", content: taskParts.join("\n\n") },
  ]
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
