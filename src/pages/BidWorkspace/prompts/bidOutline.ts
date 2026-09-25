// ---------------------------------------------------------------------------
// R69 提示词搬迁第五批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { BID_OUTLINE_REQ_KEY, STAR_CLAUSE_SECTION, clipText, combinedScoringText, complianceOutlineRule, numberScoringItems, numberedScoringDetailLines, sectionText, sectionTextAny, truthPreamble } from "../bidTypes"
import type { ComplianceMode, ParseReport, RequirementClause } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

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
    /** 用户反馈轮项 3：是否输出商务标骨架章（缺省 true；false 时商务段整体替换为「不输出任何商务章节」） */
    includeBiz?: boolean
    /** 05 三模式（§5.4）：合规严格度驱动技术章骨架宽度（缺省/strict=现状零改动；full 允许增设支撑性技术章） */
    complianceMode?: ComplianceMode
  },
): LlmMessage[] {
  const includeBiz = opts?.includeBiz !== false
  const scoringText = combinedScoringText(report)
  // R31：编号评分项列表，为大纲承接标注提供稳定 R-id 链
  const numberedItems = numberScoringItems(report)
  const numberedScoringText = numberedItems.length ? numberedScoringDetailLines(numberedItems) : scoringText
  const bizText = sectionText(report, "biz_score")
  const respText = sectionText(report, "response_req")
  const techText = sectionText(report, "delivery_req")
  const qualText = sectionText(report, "qualification")
  const lotsBlock = lotsContext(report)
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
  const depthRule =
    level === 0
      ? "不预设目录级数：由你按招标文件评分办法与章节要求自行决定技术部分合理级数（最多三级），保证评分办法每一档都有章节落点（级数约束只针对技术章，商务骨架章固定为章+一级小节两级）。"
      : level === 1
        ? "级数硬约束（只按技术章计算）：技术章只有一级（章），技术章 children 一律为空数组，禁止出现二级或三级节点；商务骨架章可保留其一级小节。"
        : level === 2
          ? "级数硬约束（只按技术章计算）：技术章恰好两级（章—节），每个技术章下必须有节，节节点的 children 一律为空数组，禁止出现三级节点；商务骨架章固定为章+一级小节。"
          : "级数硬约束（只按技术章计算）：技术章恰好三级（章—节—条），每个技术章下必须有节，每节下必须至少有 1 个条级节点，条节点的 children 为空数组；商务骨架章仍只列一级小节、不展开三级。"
  const numbered: string[] = includeBiz
    ? [
        "大纲顶层章分「商务部分」与「技术部分」两组：商务章在前、技术章在后，每个顶层章对象必须带 part 字段标明归属（\"biz\"=商务章、\"tech\"=技术章），深层节点不带 part；",
        "商务部分输出 6-10 个骨架章（part=\"biz\"）：投标函及报价、法定代表人授权、资质与证照证明、财务审计报告、同类项目业绩、商务条款响应/偏离表、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删，下面给出【投标保证金】【合同关键条款】时商务部分还须有对应骨架章落点（保证金缴纳与退还、合同条款响应、质保衔接等）；商务章 children 只列一级小节名即可（不展开三级），这些章的正文由投标人线下填写、不生成正文；",
      ]
    : [
        "大纲顶层章全部为技术部分：每个顶层章对象必须带 part 字段（一律 \"tech\"），深层节点不带 part；",
        "本次不输出任何商务部分章节（part=\"biz\"），大纲仅含技术标章节；投标函、资质证照、商务偏离表等商务内容由投标人线下自行处理，禁止为其安排任何章节；",
      ]
  numbered.push(
    "技术部分（part=\"tech\"）为详细响应骨架，必须以评分办法为纲：逐条覆盖下面技术评分的评分点，每个重要评分项都要落到具体章或节标题；",
    "事实来源排他（防幻觉，2026-09-23 用户反馈轮：目录不一致/编造招标要求）：大纲中的章节主题、顺序与评分承接只能以下面【技术评分办法】【商务评分办法】【技术方案与响应要求】【招标文件规定的投标文件目录】【★/▲ 重点条款】等注入内容与常规骨架为依据；禁止编造注入内容中不存在的评分项、分值、条款编号或目录要求，禁止把行业常识写成「响应招标文件第X条」式标题；某方面无注入依据时用常规骨架命名，不得假称招标要求；",
    "承接标注（R31）：每个技术章下的叶子节点（末级节/条）必须在 description 字段中标注其承接的评分编号，格式 `[响应:R1]` 或 `[响应:R1,R3]`（多个逗号分隔）；一个叶子只标注其直接相关的 1-3 个编号；商务骨架章不标注；不承接任何评分项的叶子节点可省略 description；",
    "响应文件要求须逐条落实（组成、格式、签字盖章与装订要求对应专门章节或节）；",
    "技术部分常规骨架参考：项目理解与需求分析、总体建设方案、详细技术方案（按系统分章）、项目实施组织与进度计划、质量保障与测试验收、培训方案、售后服务与运维保障、应急预案；再按本招标文件增删；",
    "标题只写名称、不带编号、不以标点结尾；层级命名规范：一级=部分/章，二级=节，三级=条；",
    "节/条标题必须用具体响应式命名：主题词+落点词（设计/范围/保障/机制/流程等），形如「设备兼容性设计」「多模态数据处理范围」「知识更新机制」；禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
  )
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
        : `规模参考（只按技术章计算）：整份文档体量反推的技术部分目标叶子节点数约 ${leafTarget} 个（每叶子承载约 ${sectionWords} 字），技术章叶子总数尽量落在 ${leafLo}-${leafHi} 个区间，级数仍由你按招标要求自定；`,
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
      includeBiz ? "（商务部分骨架 + 技术部分详细大纲）" : "（仅技术部分详细大纲，不含任何商务章节）"
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
  // 第十七轮 17D：历史范本目录结构（本地抽取标题行，零 AI）——只参考章法与章节粒度，不照抄标题
  const refOutlineLines = (opts?.refTemplateOutline ?? []).slice(0, 80)
  if (refOutlineLines.length) {
    stableParts.push(
      `【历史范本目录结构（参考其章法与章节粒度，不照抄标题）】\n${refOutlineLines.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
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
      ? "请生成这份投标文件的响应大纲 JSON（商务部分骨架章在前、技术部分详细章在后，顶层章带 part 字段；技术部分级数按上述要求自行决定）。"
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
  return `

【标包划分（多包件招标）】
${lots.slice(0, 1200)}
（本项目划分多个标包：正文必须只针对上述标包中招标文件指定/用户确认的包件范围撰写，禁止混入其他包件的货物、参数与报价。）`
}
