// 材料场景归位（2026-10-30）
//
// 目的：把本机 7005 篇材料按「**用在哪**」而不是「它是什么」来归类。
//
// 为什么需要：现有 kb_docs 的分类是「这是什么」（技术方案/政策法规/产品资料），
// 但售前真正的问题是「我要写标书的技术方案章，手头哪些材料能用？」
// 同一个「技术方案」目录里，有的能直接对客、有的只能内部参考、有的只是模板。
//
// 本模块按系统里已确立的分工（见 bidHistorySearch.ts 注释）建立场景映射：
//   · 可对客资产（可脱敏后直接用）→ 方案/PPT/标书正文
//   · 内部参考（须改写，含客户名/报价/失标信息）→ 只能内部看
//   · 模板骨架（只管格式）→ 给格式刷新/PPT 版式
//   · 弹药素材（段落级可复用）→ 标书弹药库
//   · 资质证明（对外必备）→ 投标资质章节
//
// 设计原则：
//   ① 规则确定性可解释（用户能复核为什么分到这）
//   ② 保守：拿不准归「内部参考」（不能误把内部材料当可对客发出去）
//   ③ 一条材料可以有多个场景（一份可研既是方案素材也是弹药来源）
// ---------------------------------------------------------------------------

/** 材料的**使用场景**（决定能被哪个环节消费） */
export const KB_SCENES = [
  "proposal", // 写方案/可研正文
  "ppt", // 做汇报 PPT
  "bid", // 编标书技术/商务标
  "quote", // 报价/清单
  "faq", // 答疑/异议应对
  "qual", // 资质证明材料
  "template", // 格式/版式模板
  "reference", // 仅内部参考（不可对客）
] as const
export type KbScene = (typeof KB_SCENES)[number]

export const KB_SCENE_LABEL: Record<KbScene, string> = {
  proposal: "方案素材",
  ppt: "PPT素材",
  bid: "标书弹药",
  quote: "报价参考",
  faq: "答疑话术",
  qual: "资质证明",
  template: "模板版式",
  reference: "内部参考",
}

/** 材料能否对外（决定是否可进生成链路） */
export type KbAudience = "client_facing" | "internal_only"

export const KB_AUDIENCE_LABEL: Record<KbAudience, string> = {
  client_facing: "可对客",
  internal_only: "仅内部",
}

/** 一条材料的场景归位结果 */
export type SceneAssignment = {
  scenes: KbScene[]
  audience: KbAudience
  /** 归位依据（用户可复核） */
  reason: string
  /** 硬风险（命中即不可对客） */
  risks: string[]
  /** 脱敏提示（改写后即可对客，不是禁止项） */
  desensitizeHints: string[]
}

// ===========================================================================
// 一、判定规则
// ===========================================================================

/**
 * 目录/标题特征 → 场景（**按优先级从上到下，命中即停**）
 *
 * 2026-10-30 实测修正：原实现遍历全部规则、命中都加入，
 * 导致「智业软件文档编辑使用规范」同时被归为 template/bid/faq/reference 四类，
 * 「方案素材 4510 + PPT 素材 5722」总和远超 7005 篇 —— 归位失去区分意义。
 *
 * 现改为：规则有优先级，**命中第一条就停**。
 * 优先级依据"材料的本质用途"：
 *   资质 > 报价 > 模板 > 答疑 > 标书 > 政策 > 案例 > 方案 > PPT > 产品 > 友商 > 内部
 */
const PATH_RULES: { re: RegExp; scenes: KbScene[]; reason: string }[] = [
  // 1) 资质证明（最明确，优先）
  { re: /资质|证书|著作权|软著|认证|获奖|荣誉/i, scenes: ["qual"], reason: "资质/证书类" },
  // 2) 报价（商务敏感，优先识别避免当方案用）
  { re: /报价|价格表|清单|预算|商务标|盘点表/i, scenes: ["quote"], reason: "报价/价格类" },
  // 3) 模板/格式（只管格式，不是内容素材）
  { re: /模板|模版|版式|格式|编辑使用规范|撰写指引|小技巧/i, scenes: ["template"], reason: "模板/格式类" },
  // 4) 答疑/话术
  { re: /答疑|问答|异议|话术|FAQ|常见问题/i, scenes: ["faq"], reason: "答疑/话术类" },
  // 5) 标书（正式投标文件）
  { re: /标书|投标文件|招标文件|应答文件|技术标|标书范本/i, scenes: ["bid"], reason: "标书/投标类" },
  // 6) 政策法规标准（用于应答引用与答疑）
  { re: /政策|法规|标准|评价标准|分级评价|指南|文件库/i, scenes: ["faq", "bid"], reason: "政策/标准类" },
  // 7) 案例/范本（可复用的项目经验）
  { re: /案例|样板|范本|经验分享|实践/i, scenes: ["proposal", "bid"], reason: "案例/范本类" },
  // 8) 方案/可研/规划（内容主体）
  { re: /方案|可研|规划|建设内容|需求分析|设计/i, scenes: ["proposal"], reason: "方案/可研类" },
  // 9) PPT/宣传
  { re: /PPT|演示|宣传手册|产品简介|汇报材料/i, scenes: ["ppt"], reason: "PPT/宣传类" },
  // 10) 产品资料（偏技术参数，可用于方案与标书）
  { re: /产品|模块|功能|系统简介|技术参数/i, scenes: ["proposal", "bid"], reason: "产品/功能类" },
  // 11) 友商/竞品（只能内部）
  { re: /友商|竞品|对手|第三方产品/i, scenes: ["reference"], reason: "友商/竞品类" },
  // 12) 内部制度/培训（只能内部）
  { re: /培训|制度|流程|宣导|内部|操作文档|公司流程|签名规范/i, scenes: ["reference"], reason: "内部制度/培训类" },
]

/** 内容风险特征 → 不可对客 */
const RISK_RULES: { re: RegExp; risk: string }[] = [
  { re: /中标价|报价明细|让利|折扣|成本价|底价/, risk: "含报价/成本信息" },
  { re: /失标|未中标|丢标|失败原因/, risk: "含失标复盘（对客敏感）" },
  { re: /内部|机密|仅内部|不得外传|保密/, risk: "标注内部/保密" },
  // 2026-10-30 收紧：只有专门的竞品分析材料才算硬风险，方案里顺带提竞品不算
  { re: /竞品分析|攻防话术|友商对比|竞对分析/, risk: "含友商评价" },
  { re: /(批评|投诉|问题|缺陷|不足).{0,20}(我方|公司|产品)/, risk: "含我方问题描述" },
]

/** 客户名特征 → 不能原文照搬（须脱敏或改写） */
const CLIENT_NAME_RE = /[\u4e00-\u9fa5]{2,10}(医院|卫生院|医疗集团|保健院|疾控中心)/

// ===========================================================================
// 二、主判定函数
// ===========================================================================

/**
 * 给一条材料归位到使用场景。
 *
 * @param doc 材料元信息（目录 + 标题 + 正文头部）
 */
export function assignScene(doc: {
  folderPath?: string
  title?: string
  content?: string
  docCategory?: string
  kbBucket?: string
}): SceneAssignment {
  const path = String(doc.folderPath ?? "")
  const title = String(doc.title ?? "")
  const head = String(doc.content ?? "").slice(0, 3000)
  const hay = `${path} ${title}`
  const scenes = new Set<KbScene>()
  const reasons: string[] = []
  const risks: string[] = []
  /** 脱敏提示（不同于风险：改写后即可对客） */
  const desensitizeHints: string[] = []

  // 1) 目录/标题规则：**命中优先级最高的规则即停**（避免一篇材料被归入 4-5 个场景）
  for (const r of PATH_RULES) {
    if (r.re.test(hay)) {
      for (const s of r.scenes) scenes.add(s)
      reasons.push(r.reason)
      break
    }
  }

  // 2) 场景为空时用现有 kb_bucket 兜底（不覆盖规则结果，避免污染）
  if (scenes.size === 0) {
    const bucket = String(doc.kbBucket ?? "")
    if (bucket === "标书弹药") { scenes.add("bid"); reasons.push("按 kb_bucket 兜底") }
    else if (bucket === "方案素材") { scenes.add("proposal"); reasons.push("按 kb_bucket 兜底") }
    else if (bucket === "PPT演示") { scenes.add("ppt"); reasons.push("按 kb_bucket 兜底") }
    else if (bucket === "政策法规标准") { scenes.add("faq"); reasons.push("按 kb_bucket 兜底") }
    else if (bucket === "公司内部") { scenes.add("reference"); reasons.push("按 kb_bucket 兜底") }
  }

  // 3) 内容风险检测（正文头部 + 标题）
  for (const r of RISK_RULES) {
    if (r.re.test(hay) || r.re.test(head)) risks.push(r.risk)
  }

  // 4) 客户名检测：**不算风险**，只标记"需脱敏"
  //
  // 2026-10-30 实测修正：原实现把"含客户名"当风险，导致 59% 材料被判不可对客。
  // 但实际上客户名是可以脱敏处理的（[客户A]），不是禁止对客的理由。
  // 真正的对客障碍是报价/失标/内部机密/友商评价。
  const hasClientName = CLIENT_NAME_RE.test(title) || CLIENT_NAME_RE.test(head)
  if (hasClientName) desensitizeHints.push("含具体客户名称，对客前需脱敏（替换为[客户A]）")

  // 5) 场景为空 → 归内部参考（保守）
  if (scenes.size === 0) {
    scenes.add("reference")
    reasons.push("未命中任何场景特征，保守归为内部参考")
  }

  // 6) 可对客判定
  //    hard risk（报价/失标/内部机密/友商）→ 仅内部
  const hardRisks = risks.filter((r) => r.includes("报价") || r.includes("失标") || r.includes("内部") || r.includes("友商"))
  const audience: KbAudience = hardRisks.length > 0 ? "internal_only" : "client_facing"

  // 7) 内部参考场景本身就不可对客
  if (scenes.has("reference") && scenes.size === 1) {
    return { scenes: ["reference"], audience: "internal_only", reason: reasons.join("；") || "仅内部参考", risks, desensitizeHints }
  }
  // 有可对客场景 + 无 hard risk → 可对客
  if (audience === "internal_only") {
    // 同时保留可用场景，但标记仅内部
    return { scenes: [...scenes], audience: "internal_only", reason: reasons.join("；"), risks, desensitizeHints }
  }

  return { scenes: [...scenes], audience: "client_facing", reason: reasons.join("；"), risks, desensitizeHints }
}

// ===========================================================================
// 三、场景 → 消费环节映射
// ===========================================================================

/** 各消费环节会读哪些场景的材料 */
export const SCENE_CONSUMERS: Record<KbScene, string[]> = {
  proposal: ["方案工作室 · 大纲/正文生成", "标书 · 技术方案章"],
  ppt: ["PPT · 内容生成", "方案工作室 · 汇报版"],
  bid: ["标书 · 技术标/商务标", "标书弹药库"],
  quote: ["报价 · 清单编制", "报价 · 折扣决策"],
  faq: ["标书 · 答疑章节", "小智助手 · 异议应对"],
  qual: ["标书 · 资质证明材料", "资质台账"],
  template: ["格式刷新", "PPT · 版式套用"],
  reference: ["（仅供人查阅，不进生成链路）"],
}

// ===========================================================================
// 四、批量归位与统计
// ===========================================================================

export type SceneStats = {
  byScene: Record<KbScene, number>
  byAudience: Record<KbAudience, number>
  /** 有风险的篇数 */
  riskyCount: number
  /** 每条材料的归位明细 */
  details: { id: string; title: string; folderPath: string; assignment: SceneAssignment }[]
}

export function assignScenesForDocs(
  docs: { id: string; title?: string; folderPath?: string; content?: string; kbBucket?: string }[],
): SceneStats {
  const byScene = {} as Record<KbScene, number>
  for (const s of KB_SCENES) byScene[s] = 0
  const byAudience: Record<KbAudience, number> = { client_facing: 0, internal_only: 0 }
  let riskyCount = 0
  const details: SceneStats["details"] = []

  for (const d of docs) {
    const a = assignScene(d)
    for (const s of a.scenes) byScene[s] += 1
    byAudience[a.audience] += 1
    if (a.risks.length) riskyCount += 1
    details.push({ id: d.id, title: String(d.title ?? ""), folderPath: String(d.folderPath ?? ""), assignment: a })
  }
  return { byScene, byAudience, riskyCount, details }
}
