import { describe, expect, it } from "vitest"
import {
  buildParamResponseRows,
  checkParamResponseCoverage,
  extractTenderRequirementClauses,
  locateTenderSection,
  narrowToTechParamSubsection,
  resolveDeviationClauses,
  resolveTechParamSource,
  summarizeParamResponse,
} from "./techParamResponse"
import { extractRequirementClauses, parseSectionTitle, type ParseReport } from "./bidTypes"

/**
 * R53（2026-10-15 用户裁定）：技术参数响应表的素材层——
 * ① 来源不固定（采购需求/技术规格，偶尔附件），且使用者可以自己描述 → 先描述、再标题、最后解析分区兜底；
 * ② ★/▲ 重点条款先扫出来在表头汇总；
 * ③ 其余参数一一响应（原文响应 + 只调整要求类字眼，转换由 paramRewrite 负责）。
 */

const TENDER = [
  "第五章 采购需求",
  "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
  "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应",
  "5.3 【评审项】系统可用性不得低于 99.9%",
  "5.4 应提供不少于 3 场用户培训",
  "注：以“★”标示的为实质性条款，负偏离即废标。",
  "第六章 评标办法",
  "6.1 技术方案（20 分）：优（15-20 分）",
].join("\n")

describe("locateTenderSection：按标题定位，到下个同级/更高级标题为止", () => {
  it("第五章 采购需求 取到 第六章 之前，正文不含评标办法", () => {
    const hit = locateTenderSection(TENDER, "采购需求")
    expect(hit?.heading).toBe("第五章 采购需求")
    expect(hit?.body).toContain("5.1")
    expect(hit?.body).toContain("5.4")
    expect(hit?.body).not.toContain("6.1")
  })

  it("找不到就返回 null（绝不猜一段正文出来）", () => {
    expect(locateTenderSection(TENDER, "不存在的章节")).toBeNull()
  })

  it("R54 同一关键词多处命中时取正文最长的一处（目录行/正文引用句不能赢过真章节）", () => {
    const doc = [
      "第三章 采购需求 ......................... 24", // 目录行：下一个同级标题紧邻 → 正文为空
      "第四章 评标方法和标准",
      "7.3 投标人应认真阅读招标文件所有的事项、格式、条款和技术规范等。", // 正文引用句：只有两行页脚
      "第 11 页 共 256 页",
      "8.招标文件的澄清与修改",
      "第三章 采购需求", // 真章节：正文到下一个章级标题为止
      "1.本采购需求中提出的服务方案仅为参考，如无明确限制，投标人可以进行优化",
      "2.投标人所投产品须具有处于有效期内的节能产品认证证书",
      "六、技术参数及要求",
      "软件性能支持处理日均门诊患者人次达 15000 以上、住院患者人次 5000 以上",
      "第四章 评标方法和标准",
      "评标委员会根据投标人所投软件对采购需求中技术参数及要求的响应情况进行评分",
    ].join("\n")
    const hit = locateTenderSection(doc, "采购需求")
    expect(hit?.heading).toBe("第三章 采购需求")
    expect(hit?.body).toContain("软件性能支持处理日均门诊患者人次达 15000 以上")
    expect(hit?.body).not.toContain("评标委员会")
  })
})

describe("resolveTechParamSource：描述 → 标题 → 解析分区，三层兜底且来源可见", () => {
  it("按使用者描述定位时标明是描述命中的", () => {
    const s = resolveTechParamSource(TENDER, null, "采购需求")
    expect(s.how).toBe("custom")
    expect(s.label).toContain("按你的描述定位")
    expect(s.text).toContain("5.1")
  })

  it("描述没命中时不静默：label 写清「你的描述没找到 + 实际用了哪一处」", () => {
    const s = resolveTechParamSource(TENDER, null, "附件三 技术规格书")
    expect(s.how).toBe("heading")
    expect(s.label).toContain("未在招标原文里找到「附件三 技术规格书」")
    expect(s.label).toContain("第五章 采购需求")
  })

  it("招标原文里没有参数章节时回退解析报告分区，并说明是回退", () => {
    const report = {
      scope: "full",
      sections: [{ key: "delivery_req", title: "交货和服务要求", content: "系统须支持国产化数据库，兼容主流国产操作系统" }],
    } as ParseReport
    const s = resolveTechParamSource("第一章 招标公告\n本项目采用公开招标方式。", report)
    expect(s.how).toBe("parse")
    expect(s.label).toContain("已回退解析报告分区")
    expect(s.text).toContain("国产化数据库")
  })

  it("哪儿都没有时 how=none（面板据此提示先补解析或补描述）", () => {
    const s = resolveTechParamSource("", null)
    expect(s.how).toBe("none")
    expect(s.text).toBe("")
  })

  it("R54：设了正文下限时，只有页脚的短命中不算命中（宁可回退，也不把页脚当参数章节）", () => {
    const report = {
      scope: "full",
      sections: [{ key: "delivery_req", title: "交货和服务要求", content: "系统须支持国产化数据库，兼容主流国产操作系统" }],
    } as ParseReport
    const tender = [
      "7.3 投标人应认真阅读招标文件所有的事项、格式、条款和技术规范等。",
      "第 11 页 共 256 页",
      "8.招标文件的澄清与修改",
      "8.1 采购人可主动地或在解答投标人提出的问题时对招标文件进行澄清与修改。",
    ].join("\n")
    // 不设下限＝沿用旧行为（短命中照样用）；设了下限＝回退解析报告分区
    expect(resolveTechParamSource(tender, report).how).toBe("heading")
    const strict = resolveTechParamSource(tender, report, undefined, { minBodyChars: 200 })
    expect(strict.how).toBe("parse")
    expect(strict.text).toContain("国产化数据库")
  })
})

describe("buildParamResponseRows：逐条建行 + 字眼转换，行序保持招标原文顺序", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)

  it("只建参数行：标记说明行（注：以★标示…）不建行", () => {
    expect(rows.map((r) => r.no)).toEqual(["5.1", "5.2", "5.3", "5.4"])
    expect(rows.some((r) => r.original.includes("负偏离即废标"))).toBe(false)
  })

  it("招标要求列是原文逐字（含 ★/▲ 标记），响应列只调整要求类字眼", () => {
    expect(rows[0].original).toBe("5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓")
    expect(rows[0].response).toBe("5.1 ★ 系统支持国产化数据库，兼容达梦、人大金仓")
    expect(rows[1].response).toBe("5.2 ▲ 提供三年免费质保与 7×24 小时运维响应")
    expect(rows[3].response).toBe("5.4 提供不少于 3 场用户培训")
  })

  it("量化边界（不得低于 99.9%）原样保留，且不误报为需人工确认", () => {
    expect(rows[2].response).toBe("5.3 【评审项】系统可用性不得低于 99.9%")
    expect(rows[2].needs_review).toBe(false)
  })

  it("权重分类沿用既有口径：【评审项】/★▲/一般项", () => {
    expect(rows.map((r) => r.kind)).toEqual(["star", "star", "review", "general"])
  })
})

describe("summarizeParamResponse：★/▲ 先扫出来做表头汇总", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)
  const sum = summarizeParamResponse(rows)

  it("计数分类正确", () => {
    expect(sum.total).toBe(4)
    expect(sum.star).toBe(2)
    expect(sum.review).toBe(1)
    expect(sum.general).toBe(1)
  })

  it("表头汇总列出的重点条款带原编号、按原文顺序、逐字（便于按招标文件响应）", () => {
    expect(sum.starClauses.map((c) => c.no)).toEqual(["5.1", "5.2", "5.3"])
    expect(sum.starClauses[0].text).toContain("★")
  })

  it("改写条数与需人工确认条数分开报（禁止类/许可类不混进改写数）", () => {
    expect(sum.rewritten).toBe(3)
    expect(sum.needs_review).toBe(0)
  })
})

describe("checkParamResponseCoverage：抽到的条款 ↔ 参数表行，缺的要点名", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)

  it("条款都能对上时不点名", () => {
    const cov = checkParamResponseCoverage(["系统须支持国产化数据库", "应提供不少于 3 场用户培训"], rows)
    expect(cov.missing).toEqual([])
    expect(cov.clause_count).toBe(2)
    expect(cov.row_count).toBe(4)
  })

  it("抽到但表里没有的条款被点名（行数应等于条款数）", () => {
    const cov = checkParamResponseCoverage(["系统须支持国产化数据库", "须提供移动护理终端 30 台"], rows)
    expect(cov.missing).toEqual(["须提供移动护理终端 30 台"])
  })
})

/**
 * R54（2026-10-15 用户裁定）：偏离表条款必须取**招标原文的采购需求/技术规格章节**，
 * 不能再从解析报告 delivery_req 的 9 个扁平字段值里切句子（那样「培训资源保障有力的，得4分」这类评分细则、
 * 验收流程会混进偏离表）。但**切分口径必须与 extractRequirementClauses 完全一致**，否则「拆分维度」按钮失效。
 */
describe("extractTenderRequirementClauses：从招标原文抽条款，三档粒度与既有口径一致", () => {
  // 5.1 故意重复一次（验去重）；5.5「培训。」不足 8 字（验长度门槛）；5.3/5.4 含分号与句号（验 l2/l3）
  const SECTION = [
    "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
    "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应",
    "5.3 【评审项】系统可用性不得低于 99.9%；单点故障恢复时间不超过 30 分钟",
    "5.4 应提供不少于 3 场用户培训。培训须覆盖系统管理员与业务操作员",
    "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
    "5.5 培训。",
  ].join("\n")

  it("空文本返回空数组（绝不猜条款）", () => {
    expect(extractTenderRequirementClauses("")).toEqual([])
    expect(extractTenderRequirementClauses("   \n  \n")).toEqual([])
  })

  it("system=按行：一行一条（去重后），过短行丢弃", () => {
    const cs = extractTenderRequirementClauses(SECTION, { granularity: "system", label: "第五章 采购需求" })
    expect(cs.map((c) => c.text)).toEqual([
      "★ 系统须支持国产化数据库，兼容达梦、人大金仓",
      "▲ 要求提供三年免费质保与 7×24 小时运维响应",
      "【评审项】系统可用性不得低于 99.9%；单点故障恢复时间不超过 30 分钟",
      "应提供不少于 3 场用户培训。培训须覆盖系统管理员与业务操作员",
    ])
    // 行首编号取「行首原编号」，且分号/句号拆出的后续段不带编号（条款号↔行保持一对一）
    expect(cs.map((c) => c.no)).toEqual(["5.1", "5.2", "5.3", "5.4"])
    expect(cs.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"])
  })

  it("l2=再按分号拆（句号不拆），l3=分号+句号都拆到最小条款", () => {
    const l2 = extractTenderRequirementClauses(SECTION, { granularity: "l2", label: "第五章 采购需求" })
    expect(l2).toHaveLength(5)
    expect(l2.map((c) => c.text)).toContain("单点故障恢复时间不超过 30 分钟")
    expect(l2.map((c) => c.text)).toContain("应提供不少于 3 场用户培训。培训须覆盖系统管理员与业务操作员")
    expect(l2.find((c) => c.text === "单点故障恢复时间不超过 30 分钟")?.no).toBe("")

    const l3 = extractTenderRequirementClauses(SECTION, { granularity: "l3", label: "第五章 采购需求" })
    expect(l3).toHaveLength(6)
    expect(l3.map((c) => c.text)).toContain("培训须覆盖系统管理员与业务操作员")
    expect(l3.filter((c) => c.no === "5.3").map((c) => c.text)).toHaveLength(1)
  })

  it("source 用调用方传的章节标题（行内「系统名：要求」仍优先取系统名，与既有口径同）", () => {
    const cs = extractTenderRequirementClauses("核心数据库：须支持国产化替代；兼容达梦与人大金仓", {
      granularity: "l2",
      label: "第五章 采购需求",
    })
    expect(cs.map((c) => c.source)).toEqual(["核心数据库", "核心数据库"])
    const plain = extractTenderRequirementClauses("5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓", { label: "第五章 采购需求" })
    expect(plain[0].source).toBe("第五章 采购需求")
  })

  it("limit 生效（条数预告与生成都要能收口）", () => {
    expect(extractTenderRequirementClauses(SECTION, { granularity: "l3", limit: 2, label: "x" })).toHaveLength(2)
  })

  it("R54b：PDF 表格残留行（| 开头 / 竖线密集）与页码页脚行不进条款", () => {
    const noise = [
      "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
      "| 诊 | 中药房管理系统 | 1 | 套",
      "1 | 经 | 患者主索引 | 1 | 套",
      "第 215 页 共 256 页",
      "第 216 页",
      "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应",
      "5.3 支持上传纠纷相关附件材料，如图片、文档等；详见第 12 页的说明", // 行首带字＝不是页码行，照常保留
    ].join("\n")
    const cs = extractTenderRequirementClauses(noise, { granularity: "l3", label: "第五章 采购需求" })
    expect(cs.map((c) => c.text)).toEqual([
      "★ 系统须支持国产化数据库，兼容达梦、人大金仓",
      "▲ 要求提供三年免费质保与 7×24 小时运维响应",
      "支持上传纠纷相关附件材料，如图片、文档等",
      "详见第 12 页的说明",
    ])
  })

  it("R54b：噪声过滤在共享内核里——extractRequirementClauses 同口径同结果", () => {
    const text = ["5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓", "| 诊 | 中药房管理系统 | 1 | 套", "第 215 页 共 256 页"].join("\n")
    const report = { scope: "full", sections: [{ key: "delivery_req", title: "交货和服务要求", content: text }] } as ParseReport
    const fromReport = extractRequirementClauses(report, { granularity: "l3", sources: ["delivery_req"] })
    expect(fromReport.map((c) => c.text)).toEqual(["★ 系统须支持国产化数据库，兼容达梦、人大金仓"])
    expect(extractTenderRequirementClauses(text, { granularity: "l3", label: "交货和服务要求" })).toEqual(fromReport)
  })

  it("口径一致性守卫：同一段文本走新函数 vs extractRequirementClauses（等价 report）逐字一致", () => {
    const report = {
      scope: "full",
      sections: [{ key: "delivery_req", title: "交货和服务要求", content: SECTION }],
    } as ParseReport
    for (const granularity of ["system", "l2", "l3"] as const) {
      const fromTender = extractTenderRequirementClauses(SECTION, {
        granularity,
        label: parseSectionTitle("delivery_req"),
      })
      const fromReport = extractRequirementClauses(report, { granularity, sources: ["delivery_req"] })
      expect(fromTender).toEqual(fromReport)
      expect(fromTender.map((c) => c.text)).toEqual(fromReport.map((c) => c.text))
    }
  })
})

describe("narrowToTechParamSubsection：章内收窄到「技术参数/技术规格」子章节（只认行首标题形态）", () => {
  const CHAPTER = [
    "第三章 采购需求",
    "一、采购需求前附表",
    "服务期限：合同签订之日起 36 个月，含全部实施与验收周期",
    "二、总体要求",
    "系统采用模块化设计，具备良好的扩展性与可靠性，支持国产化替代",
    "六、技术参数及要求",
    "序号 | 技术参数及要求",
    "★1 软件性能支持处理日均门诊患者人次达 15000 以上、住院患者人次 5000 以上",
    "注：投标文件中须提供承诺函并盖公章（或电子签章），承诺函格式自拟，须体现上述内容",
    "★2 数据处理能力：为保障新信息系统上线后，医院历史诊疗与运营数据的完整性、可用性与延续性，承建方须制定并执行周密、可靠的历史数据迁移与归档整体方案",
    "★3 数据上报能力：要求按照国家、省、市的政策性的接口要求进行数据上报，包含但不限于公立中医医院绩效监测中医病案首页数据质量与接口标准上报相关数据",
    "第四章 评标方法和标准",
    "评标委员会根据投标人所投软件对采购需求中技术参数及要求的响应情况进行评分",
  ].join("\n")

  it("命中行首标题形态的子章节，正文到下一个同级/更高级标题为止", () => {
    const sub = narrowToTechParamSubsection(CHAPTER)
    expect(sub?.heading).toBe("六、技术参数及要求")
    expect(sub?.body).toContain("软件性能支持处理日均门诊患者人次达 15000 以上")
    expect(sub?.body).toContain("数据处理能力")
    expect(sub?.body).not.toContain("评分") // 第四章的评分句不在子章节正文里
  })

  it("正文里引用这些词的句子不算标题（不匹配就返回 null，调用方保持整章）", () => {
    const body = [
      "系统采用模块化设计，具备良好的扩展性与可靠性",
      "评标委员会根据投标人所投软件对采购需求中技术参数及要求的响应情况进行评分",
    ].join("\n")
    expect(narrowToTechParamSubsection(body)).toBeNull()
  })

  it("子章节正文过短（「技术规格：见附件。」）不收窄，避免把整章换成一句话", () => {
    expect(narrowToTechParamSubsection(["5. 技术规格", "见附件。"].join("\n"))).toBeNull()
  })

  it("resolveTechParamSource 命中整章后自动收窄，label 用「›」标出层级", () => {
    const s = resolveTechParamSource(CHAPTER, null)
    expect(s.how).toBe("heading")
    expect(s.label).toBe("按招标原文标题定位：第三章 采购需求 › 六、技术参数及要求")
    expect(s.text).toContain("数据处理能力")
    expect(s.text).not.toContain("服务期限")
  })
})

describe("resolveDeviationClauses：先招标原文、未命中才回退解析报告（回退行为与改动前逐字一致）", () => {
  // 解析报告 delivery_req 里混进一条评分细则——命中原文时它绝不能进偏离表
  const REPORT = {
    scope: "full",
    sections: [
      {
        key: "delivery_req",
        title: "交货和服务要求",
        content: ["5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓", "培训资源保障有力的，得4分"].join("\n"),
      },
    ],
  } as ParseReport

  it("招标原文命中采购需求章节时从原文抽条款，解析报告里的评分细则不进表", () => {
    const tender = [
      "第五章 采购需求",
      "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
      "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应",
      "5.3 【评审项】系统可用性不得低于 99.9%，单点故障恢复时间不超过 30 分钟",
      "5.4 应提供不少于 3 场用户培训，培训须覆盖系统管理员与业务操作员",
      "5.5 投标人须提供完整的项目实施方案与进度计划，明确各阶段交付物与责任人",
      "5.6 系统须提供开放接口，支持与院内现有业务系统完成数据对接与联调",
      "5.7 提供 7×24 小时故障响应，重大故障 2 小时内到场处理",
      "第六章 评标办法",
      "6.1 培训资源保障有力的，得4分",
    ].join("\n")
    const r = resolveDeviationClauses(tender, REPORT, { limit: 200, granularity: "l3" })
    expect(r.how).toBe("heading")
    expect(r.label).toBe("按招标原文标题定位：第五章 采购需求")
    expect(r.clauses[0].text).toBe("★ 系统须支持国产化数据库，兼容达梦、人大金仓")
    expect(r.clauses.length).toBeGreaterThanOrEqual(7)
    expect(r.clauses.some((c) => c.text.includes("得4分"))).toBe(false)
    expect(r.clauses.every((c) => tender.includes(c.text))).toBe(true)
  })

  it("招标原文里定位不到参数章节 → 回退 delivery_req，结果与改动前逐字一致", () => {
    const tender = "第一章 招标公告\n本项目采用公开招标方式，欢迎合格供应商参与。"
    const r = resolveDeviationClauses(tender, REPORT, { limit: 200, granularity: "l3" })
    const legacy = extractRequirementClauses(REPORT, { limit: 200, granularity: "l3", sources: ["delivery_req"] })
    expect(r.how).toBe("parse")
    expect(r.label).toContain("已回退解析报告分区")
    expect(r.clauses).toEqual(legacy)
  })

  it("原文命中章节但抽不到合格条款（正文够长、全是过短引用行）时，回退也要说清楚实际来源", () => {
    // 45 行「见附件。」＝正文 ≥200 字（过得了正文下限），但每段不足 8 字 → 抽不出条款
    const tender = ["第五章 采购需求", ...Array.from({ length: 45 }, () => "见附件。")].join("\n")
    const r = resolveDeviationClauses(tender, REPORT, { limit: 200, granularity: "l3" })
    expect(r.how).toBe("parse")
    expect(r.label).toContain("未抽到合格条款，已回退解析报告分区")
    expect(r.clauses).toEqual(extractRequirementClauses(REPORT, { limit: 200, granularity: "l3", sources: ["delivery_req"] }))
  })

  it("原文与报告都没有时条款为空且来源如实（面板据此提示先补原文/解析）", () => {
    const r = resolveDeviationClauses("", null)
    expect(r.clauses).toEqual([])
    expect(r.how).toBe("none")
    expect(r.label).toBe("未找到技术参数来源")
  })

  it("用户描述优先（命中即 custom，且标出实际章节）", () => {
    const tender = ["第五章 采购需求", "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓", "附件一 技术规格书", "1.1 终端须支持双频 Wi-Fi"].join("\n")
    const r = resolveDeviationClauses(tender, null, { customHint: "附件一 技术规格书" })
    expect(r.how).toBe("custom")
    expect(r.label).toBe("按你的描述定位：附件一 技术规格书")
    expect(r.clauses.map((c) => c.text)).toEqual(["终端须支持双频 Wi-Fi"])
  })
})

// ---------------------------------------------------------------------------
// 2026-10-22（用户实测：技术参数表抽出来是页脚/表头）
//   版式噪声行必须过滤：页脚、表头拼接行、纯编号/符号。
// ---------------------------------------------------------------------------
describe("技术参数行装配：版式噪声过滤（2026-10-22）", () => {
  it("页脚/表头/纯符号不建行，真参数保留且原文逐字", () => {
    const rows = buildParamResponseRows(
      [
        "第 215 页 共 256 页",
        "序号 技术参数及要求",
        "★1、系统应支持国产数据库，并兼容达梦、人大金仓等主流产品。",
        "— — —",
        "▲2、支持不少于 5000 并发用户，平均响应时间不超过 3 秒。",
      ].join("\n"),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].original).toContain("国产数据库")
    expect(rows[0].kind).toBe("star")
    expect(rows[1].original).toContain("5000 并发")
  })
})

describe("技术参数行装配：重复页眉过滤（2026-10-22）", () => {
  it("同一短句重复 ≥3 次视为版式页眉，不建行；真参数按原文保留", () => {
    const H = "政府采购项目公开招标文件示范文本（服务类）"
    const rows = buildParamResponseRows(
      [H, "★1、真实参数一，支持国产数据库。", H, "★2、真实参数二，支持不少于 5000 并发。", H].join("\n"),
    )
    expect(rows.map((r) => r.original)).toEqual([
      "★1、真实参数一，支持国产数据库。",
      "★2、真实参数二，支持不少于 5000 并发。",
    ])
  })
})

// ---------------------------------------------------------------------------
// B4 回填（2026-10-22）：原表逐行 → 响应行（行边界来自原表，不按行文本猜）
// ---------------------------------------------------------------------------
import { paramRowsFromTable } from "./techParamResponse"

describe("paramRowsFromTable：原表逐行响应", () => {
  it("原文逐字保留、表内编号保留、要求类字眼改为陈述式", () => {
    const rows = paramRowsFromTable([
      { no: "5.3.2", text: "系统应支持国产数据库，并兼容达梦、人大金仓。" },
      { no: "5.3.3", text: "▲并发用户数不少于 5000。" },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].no).toBe("5.3.2")
    expect(rows[0].original).toBe("系统应支持国产数据库，并兼容达梦、人大金仓。")
    expect(rows[0].response).not.toBe(rows[0].original)
    expect(rows[1].kind).toBe("star")
    // 数值与限定语不得被改写
    expect(rows[1].response).toContain("5000")
  })

  it("空文本不建行；cap 生效", () => {
    expect(paramRowsFromTable([{ no: "1", text: "  " }])).toEqual([])
    const many = Array.from({ length: 5 }, (_, i) => ({ no: String(i + 1), text: `参数${i}` }))
    expect(paramRowsFromTable(many, { cap: 3 })).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 2026-10-23（用户实测：「★8 系统集成、培训」被拆成碎片当参数打勾）
//   条款合并要两层：★ 头开后，其下（1）① 都属于同一条；不在 ★ 段内才按编号切。
//   作答类型：方案型不能用「完全响应」概括。
// ---------------------------------------------------------------------------
import { classifyParamClause, mergeClauseLines } from "./techParamResponse"

describe("条款合并与作答类型（2026-10-23）", () => {
  it("★ 条款吞掉其下的（1）（2）①～⑤，遇到下一个 ★ 才结束", () => {
    const clauses = mergeClauseLines([
      "★8. 系统集成、培训",
      "（1）系统集成实施服务",
      "①中标人须承担全部软件系统的系统集成工作。",
      "②部署与配置：负责所有系统的安装部署。",
      "（2）培训服务",
      "①提供系统化、分层次的培训服务。",
      "★9. 数据互通互联、数据质量提升",
      "（1）对标电子病历五级、互联互通五乙。",
    ])
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toContain("★8")
    expect(clauses[0]).toContain("培训服务")
    expect(clauses[0]).not.toContain("★9")
    expect(clauses[1]).toContain("★9")
  })

  it("不在 ★ 段内时，编号行才起新条", () => {
    const clauses = mergeClauseLines(["1. 支持国产数据库", "2. 支持达梦、人大金仓"])
    expect(clauses).toHaveLength(2)
  })

  it("作答类型：★ 长条款=方案型；功能参数=参数型（长也不行）", () => {
    expect(classifyParamClause("★8. 系统集成、培训 " + "①培训对象与内容 ".repeat(20))).toBe("proposal")
    expect(classifyParamClause("★9. 数据互通互联、数据质量提升 " + "（1）对标电子病历五级、互联互通五乙、智慧服务三级。".repeat(8))).toBe("proposal")
    // 200 多字的功能要求仍是参数——逐条满足即可，不需要成文
    expect(classifyParamClause("要求支持门急诊挂号、收费、住院医嘱、护理记录、检查检验申请与报告回传等全流程闭环管理，".repeat(5))).toBe("param")
    expect(classifyParamClause("支持国产数据库")).toBe("param")
  })

  it("buildParamResponseRows：★8 只产出一行且标为方案型，原文完整保留", () => {
    const rows = buildParamResponseRows(
      ["★8. 系统集成、培训", "（1）系统集成实施服务", "①承担全部系统集成工作，费用包干。", "②提供培训教材与操作手册。"].join("\n"),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].clauseKind).toBe("proposal")
    expect(rows[0].original).toContain("费用包干")
    expect(rows[0].original).toContain("培训教材")
  })
})
