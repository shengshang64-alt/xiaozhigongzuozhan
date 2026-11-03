// ---------------------------------------------------------------------------
// 商务章节模板骨架生成（2026-10-31 标书生成打磨）
//
// 实测问题（真实项目「安徽中医药大学第一附属医院一体化核心」）：
//   19 章里 10 章是商务章（part=biz），全部 content 为空、gen_status=pending。
//
// 这是**设计上正确的**——投标函、授权书、报价表属格式文件，不该让 AI 编正文
// （见 bidDraftPlan.ts 注释：「part=biz 不参与 AI 生成，随全套导出原样保留」）。
//
// 但用户视角是「10 个章节点进去是空白，不知道该怎么办」。缺的是**行动指引**。
//
// 本模块提供「模板骨架」：不编任何实质内容，只生成符合投标规范的**填写框架**
// （标题 + 必备字段占位 + 填写说明），让用户能直接在骨架上补。
//
// 严格边界（这是本模块的核心原则）：
//   · 不生成任何公司名称、金额、承诺、日期 —— 一律留【待填】
//   · 不编造业绩、资质、人员 —— 这些只能来自真实材料
//   · 只提供「这个文件该有什么字段」的结构知识（这部分是公开规范，可安全生成）
// ---------------------------------------------------------------------------

/** 商务章节类型（决定骨架形态） */
export type BizChapterKind =
  | "bid_letter" // 投标函
  | "open_summary" // 开标一览表
  | "qualification" // 资格声明/营业执照
  | "authorization" // 授权书/法人证明
  | "price_sheet" // 分项报价表
  | "response_sheet" // 商务响应表/偏离表
  | "team" // 人员配备
  | "commitment" // 服务承诺函
  | "performance" // 业绩承诺函
  | "policy_declaration" // 政策性声明
  | "generic" // 其他商务材料

export type BizSkeletonSection = {
  /** 小节标题 */
  heading: string
  /** 该小节应有的字段/占位（【待填】形式） */
  placeholders: string[]
  /** 填写说明（告诉用户这里放什么） */
  note?: string
}

export type BizSkeleton = {
  kind: BizChapterKind
  /** 骨架正文（markdown 风格，含【待填】占位） */
  content: string
  /** 需要用户准备的附件/材料清单 */
  requiredAttachments: string[]
  /** 一句话说明为什么这类章系统不代写 */
  why: string
}

/** 按章节标题识别商务章节类型 */
export function classifyBizChapter(title: string): BizChapterKind {
  const t = String(title ?? "")
  if (/投标函|投标书|报价函/.test(t)) return "bid_letter"
  if (/开标一览|开标报价/.test(t)) return "open_summary"
  if (/资格声明|营业执照|资格审查/.test(t)) return "qualification"
  if (/授权书|法定代表人|身份证明|授权委托/.test(t)) return "authorization"
  if (/分项报价|报价表|价格表|报价清单/.test(t)) return "price_sheet"
  if (/响应表|偏离表|商务响应/.test(t)) return "response_sheet"
  if (/人员|团队|项目组|配备/.test(t)) return "team"
  // 2026-10-31：业绩类必须先判——标题常写成「投标业绩承诺函及类似项目业绩」，
  // 含"承诺函"字样，放在 commitment 之后会被误判为服务承诺。
  if (/业绩|类似项目|案例/.test(t)) return "performance"
  if (/服务承诺|售后承诺|承诺函|售后服务/.test(t)) return "commitment"
  if (/政策性|诚信|廉洁|声明|证明材料/.test(t)) return "policy_declaration"
  return "generic"
}

/** 各类型骨架定义（只列结构，不含任何实质内容） */
const SKELETONS: Record<BizChapterKind, { sections: BizSkeletonSection[]; attachments: string[]; why: string }> = {
  bid_letter: {
    why: "投标函是法律承诺文件，措辞与金额直接影响投标有效性，必须由投标人按招标文件范本如实填写并盖章。",
    sections: [
      { heading: "致（招标人名称）", placeholders: ["【待填：招标人全称】"], note: "按招标文件「投标人须知」里的采购人名称填写" },
      { heading: "我方自愿参加投标", placeholders: ["【待填：项目名称】", "【待填：招标编号】"] },
      {
        heading: "投标总报价",
        placeholders: ["【待填：人民币小写金额】", "【待填：大写金额】"],
        note: "金额须与开标一览表、分项报价表完全一致，大小写一致",
      },
      { heading: "投标有效期", placeholders: ["【待填：XX 日历天】"], note: "不得短于招标文件要求的天数" },
      { heading: "投标保证金", placeholders: ["【待填：缴纳方式与金额，或注明「不收取」】"] },
      {
        heading: "我方承诺",
        placeholders: [
          "【待填：承诺 1（按招标文件要求的承诺条款逐条列）】",
          "【待填：承诺 2】",
        ],
        note: "招标文件「投标函格式」里通常会列出必须承诺的事项，逐条照抄并响应",
      },
      { heading: "投标人（盖章）", placeholders: ["【待填：单位全称】", "【待填：法定代表人或授权代表签字】", "【待填：日期】"] },
    ],
    attachments: ["营业执照副本复印件（加盖公章）", "法定代表人身份证明", "授权委托书（非法人签署时）"],
  },
  open_summary: {
    why: "开标一览表是唱标依据，报价必须与投标函、分项报价表三处一致，任何不一致都可能被判无效标。",
    sections: [
      { heading: "项目基本信息", placeholders: ["【待填：项目名称】", "【待填：招标编号】", "【待填：投标人名称】"] },
      {
        heading: "报价汇总",
        placeholders: ["【待填：投标总价（小写）】", "【待填：投标总价（大写）】", "【待填：交付期/工期】"],
        note: "三处金额必须一致：本表 / 投标函 / 分项报价表合计",
      },
      { heading: "其他说明", placeholders: ["【待填：如有优惠条件、备选方案在此说明，无则填「无」】"] },
    ],
    attachments: [],
  },
  qualification: {
    why: "资格性审查材料是废标红线，必须按招标文件「资格审查表」逐项提供真实证明文件，不得任何虚构。",
    sections: [
      { heading: "资格声明", placeholders: ["【待填：投标人全称】", "【待填：统一社会信用代码】"] },
      {
        heading: "资格条件响应",
        placeholders: [
          "【待填：资格条件 1 → 响应说明 + 证明材料索引】",
          "【待填：资格条件 2 → 响应说明 + 证明材料索引】",
        ],
        note: "逐条对照招标文件「资格审查表」，每条都要有对应证明文件页码",
      },
      { heading: "承诺", placeholders: ["【待填：无重大违法记录声明】", "【待填：未被列入失信名单声明】"] },
    ],
    attachments: ["营业执照", "资质证书", "财务审计报告", "社保缴纳证明", "无违法记录声明"],
  },
  authorization: {
    why: "授权书涉及签署权，格式与签字盖章不合规会直接导致投标无效。必须用招标文件规定的格式。",
    sections: [
      { heading: "授权人信息", placeholders: ["【待填：法定代表人姓名】", "【待填：职务】", "【待填：身份证号】"] },
      { heading: "被授权人信息", placeholders: ["【待填：姓名】", "【待填：职务】", "【待填：身份证号】"] },
      { heading: "授权事项", placeholders: ["【待填：授权范围（参加 XX 项目投标及签署相关文件）】", "【待填：授权期限】"] },
      { heading: "签署", placeholders: ["【待填：法定代表人签字】", "【待填：单位盖章】", "【待填：日期】"] },
    ],
    attachments: ["法定代表人身份证复印件", "被授权人身份证复印件", "社保关系证明（证明被授权人为本单位员工）"],
  },
  price_sheet: {
    why: "分项报价是商务评分核心，且必须与开标一览表合计一致。价格由你方商务决策，系统不能代填。",
    sections: [
      {
        heading: "报价明细表",
        placeholders: [
          "【待填：序号 | 名称 | 规格型号 | 品牌 | 单位 | 数量 | 单价 | 合价 | 备注】",
          "【逐行填写，最后一行填合计】",
        ],
        note: "合计金额必须等于开标一览表与投标函的投标总价",
      },
      { heading: "报价说明", placeholders: ["【待填：是否含税、含运费、含实施费等口径说明】"] },
    ],
    attachments: [],
  },
  response_sheet: {
    why: "商务偏离表用于声明对招标条款的响应情况。如实填写是诚信底线，虚报响应会被认定虚假投标。",
    sections: [
      {
        heading: "商务条款响应",
        placeholders: [
          "【待填：招标条款序号 | 招标要求 | 投标响应 | 偏离说明】",
          "【逐条填写；完全响应的填「完全响应，无偏离」】",
        ],
        note: "漏项会被认定为未响应；真的不满足要如实写偏离，不要虚报",
      },
    ],
    attachments: [],
  },
  team: {
    why: "人员配备需真实人员与真实证书，涉及社保、职称、业绩证明，只能由你方提供。",
    sections: [
      {
        heading: "项目团队配置",
        placeholders: [
          "【待填：姓名 | 拟任岗位 | 职称/资格 | 从业年限 | 类似项目经验】",
          "【逐人填写】",
        ],
      },
      { heading: "人员证明材料索引", placeholders: ["【待填：证书扫描件页码索引】", "【待填：社保证明】"] },
    ],
    attachments: ["项目负责人职称证书", "团队成员资格证书", "社保缴纳证明", "类似项目任命文件"],
  },
  commitment: {
    why: "服务承诺函是具有法律约束力的承诺，承诺内容会成为履约依据，必须由你方按实际服务能力填写。",
    sections: [
      { heading: "服务承诺", placeholders: ["【待填：响应时间承诺】", "【待填：质保期承诺】", "【待填：备件供应承诺】"], note: "承诺须与商务偏离表口径一致" },
      { heading: "签署", placeholders: ["【待填：单位盖章】", "【待填：日期】"] },
    ],
    attachments: [],
  },
  performance: {
    why: "业绩材料必须真实可查（附中标通知书/合同/验收单），虚构业绩属提供虚假材料谋取中标，法律风险极高。",
    sections: [
      {
        heading: "类似项目业绩",
        placeholders: [
          "【待填：序号 | 项目名称 | 采购人 | 合同金额 | 签订时间 | 联系人及电话 | 证明材料页码】",
          "【逐项填写】",
        ],
        note: "每个业绩都要能在证明材料里找到对应合同/中标通知书，且采购人可回访",
      },
    ],
    attachments: ["中标通知书", "合同关键页", "验收报告", "用户评价（如有）"],
  },
  policy_declaration: {
    why: "政策性声明涉及法律承诺（如无重大违法记录、廉洁投标），内容固定但必须真实，由法人签署。",
    sections: [
      {
        heading: "声明事项",
        placeholders: [
          "【待填：声明 1（按招标文件要求逐条列，如「参加本次采购活动前三年内无重大违法记录」）】",
          "【待填：声明 2】",
        ],
      },
      { heading: "签署", placeholders: ["【待填：法定代表人签字】", "【待填：单位盖章】", "【待填：日期】"] },
    ],
    attachments: ["信用中国查询截图", "无行贿犯罪记录声明（如需）"],
  },
  generic: {
    why: "该章属商务/证明类材料，内容涉及你方真实信息与法律承诺，系统不代写。",
    sections: [
      { heading: "内容框架", placeholders: ["【待填：按招标文件「投标文件组成」要求准备该章内容】"] },
      { heading: "附件索引", placeholders: ["【待填：本章涉及的证明材料清单与页码】"] },
    ],
    attachments: [],
  },
}

/** 生成某商务章节的骨架正文 */
export function buildBizSkeleton(chapterTitle: string): BizSkeleton {
  const kind = classifyBizChapter(chapterTitle)
  const def = SKELETONS[kind]
  const lines: string[] = []
  lines.push(`# ${chapterTitle}`)
  lines.push("")
  lines.push("> ⚠️ 本章为商务/证明类材料，需你方按招标文件要求填写真实信息并盖章。以下为填写框架，所有【待填】项请逐一替换。")
  lines.push("")
  for (const sec of def.sections) {
    lines.push(`## ${sec.heading}`)
    if (sec.note) lines.push(`*（${sec.note}）*`)
    lines.push("")
    for (const ph of sec.placeholders) lines.push(`- ${ph}`)
    lines.push("")
  }
  if (def.attachments.length) {
    lines.push("## 需准备的附件")
    lines.push("")
    for (const a of def.attachments) lines.push(`- [ ] ${a}`)
    lines.push("")
  }
  return {
    kind,
    content: lines.join("\n").trim(),
    requiredAttachments: def.attachments,
    why: def.why,
  }
}

/** 批量生成：把项目里所有空商务章补上骨架 */
export function buildSkeletonsForEmptyBizChapters(
  chapters: { node_id: string; title: string; part?: string; content?: string }[],
): { nodeId: string; title: string; kind: BizChapterKind; content: string }[] {
  const out: { nodeId: string; title: string; kind: BizChapterKind; content: string }[] = []
  for (const ch of chapters) {
    if (ch.part !== "biz") continue
    if ((ch.content ?? "").trim()) continue // 已有内容不动（用户可能已填）
    const sk = buildBizSkeleton(ch.title)
    out.push({ nodeId: ch.node_id, title: ch.title, kind: sk.kind, content: sk.content })
  }
  return out
}
