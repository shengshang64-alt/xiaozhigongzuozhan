import { describe, expect, it } from "vitest"
import {
  ATOM_TYPES,
  checkAtomQuality,
  isLowConfidence,
  isValidSubjectKey,
  normalizeSubjectKey,
  sanitizeExtraction,
  LOW_CONFIDENCE,
  CONFIDENTIALITY_RANK,
  type AtomType,
  type ExtractedAtom,
} from "./kbAtoms"

// ---------------------------------------------------------------------------
// P0-1b 验收测试：原子 Schema / subject_key 校验 / 归一化 / 质量门禁
//
// 对应《知识库改造需求文档 v1.0》：
//   §4.4 subject_key 归一化规则（AI 输出 + 正则强校验）
//   §5   八种知识原子抽取口径 + 明确不抽的内容
//   附录 A 硬约束（title 陈述句 / source_quote 逐字 / 单篇 ≤40 条）
//
// 为什么这些测试重要：subject_key 是去重与冲突分组的唯一依据。
// 归一化一旦失效，同一指标会被拆成多个组，治理体系直接失效。
// ---------------------------------------------------------------------------

describe("subject_key 格式校验（§4.4 正则）", () => {
  it("八种类型的合法格式都能通过", () => {
    const cases: [string, string][] = [
      ["metric", "metric:电子病历应用水平分级|国家卫健委评测"],
      ["case", "case:六安市中医院"],
      ["qualification", "qual:CMMI5级"],
      ["policy", "policy:国卫办医函〔2018〕894号|4.2"],
      ["product_capability", "prod:集成平台|主数据管理"],
      ["play", "play:县域二级医院|新建集成平台"],
      ["fact", "fact:公司|实施团队规模"],
      ["script", "script:价格高于友商"],
    ]
    // 类型别名映射（qualification→qual 前缀）
    for (const [type, key] of cases) {
      expect(isValidSubjectKey(type as AtomType, key)).toBe(true)
    }
  })

  it("缺限定段的 metric/fact/play 等被判不合格", () => {
    expect(isValidSubjectKey("metric", "metric:电子病历")).toBe(false)
    expect(isValidSubjectKey("fact", "fact:公司")).toBe(false)
    expect(isValidSubjectKey("play", "play:县域医院")).toBe(false)
  })

  it("前缀写错被判不合格", () => {
    expect(isValidSubjectKey("metric", "case:某个医院")).toBe(false)
    expect(isValidSubjectKey("case", "metric:某指标|口径")).toBe(false)
  })

  it("空值与超长值被判不合格", () => {
    expect(isValidSubjectKey("case", "")).toBe(false)
    expect(isValidSubjectKey("case", "case:" + "很长的名字".repeat(20))).toBe(false)
  })
})

describe("subject_key 归一化（§4.4 同义写法必须归到同一 key）", () => {
  it("指标同义写法归到规范名（这是去重的前提）", () => {
    const variants = [
      "metric:EMR分级|国家卫健委评测",
      "metric:电子病历分级|国家卫健委评测",
      "metric:电子病历应用水平|国家卫健委评测",
      "metric:电子病历应用水平分级评价|国家卫健委评测",
    ]
    const normalized = variants.map((v) => normalizeSubjectKey("metric", v))
    // 全部归一后必须完全一致
    expect(new Set(normalized).size).toBe(1)
    expect(normalized[0]).toBe("metric:电子病历应用水平分级|国家卫健委评测")
  })

  it("全角转半角、去空格、去书名号", () => {
    expect(normalizeSubjectKey("case", "case:六安市中医院")).toBe("case:六安市中医院")
    expect(normalizeSubjectKey("case", " case: 六安市中医院 ")).toBe("case:六安市中医院")
    expect(normalizeSubjectKey("qualification", "qual:《CMMI5级》")).toBe("qual:CMMI5级")
  })

  it("客户名只剥企业冗余后缀，不破坏机构主体名", () => {
    // 关键回归：曾经把「医院」当后缀导致 六安市中医院 → 六安市中
    expect(normalizeSubjectKey("case", "case:六安市中医院")).toBe("case:六安市中医院")
    // 分院归到主院
    expect(normalizeSubjectKey("case", "case:六安市中医院分院")).toBe("case:六安市中医院")
    // 企业后缀剥离
    expect(normalizeSubjectKey("case", "case:某某医疗集团有限公司")).toBe("case:某某医疗集团")
    expect(normalizeSubjectKey("case", "case:某某科技股份有限公司")).toBe("case:某某科技")
  })

  it("前缀写错时自动纠正到正确前缀", () => {
    expect(normalizeSubjectKey("metric", "case:电子病历应用水平分级|国家卫健委评测")).toBe(
      "metric:电子病历应用水平分级|国家卫健委评测",
    )
  })

  it("缺少前缀时补上", () => {
    expect(normalizeSubjectKey("case", "六安市中医院")).toBe("case:六安市中医院")
  })
})

describe("checkAtomQuality：业务质量门禁", () => {
  function atom(p: Partial<ExtractedAtom>): ExtractedAtom {
    return {
      atom_type: "metric",
      title: "电子病历应用水平达 5 级",
      body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
      subject_key: "metric:电子病历应用水平分级|国家卫健委评测",
      attributes: { value: 5, unit: "级", year: 2021, scope: "国家卫健委评测", polarity: "positive" },
      source_quote: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
      confidence: 0.92,
      ...p,
    }
  }

  it("合格原子无 error", () => {
    expect(checkAtomQuality(atom({})).filter((i) => i.severity === "error")).toHaveLength(0)
  })

  it("subject_key 格式错误 → error", () => {
    const issues = checkAtomQuality(atom({ subject_key: "metric:电子病历" }))
    expect(issues.some((i) => i.field === "subject_key" && i.severity === "error")).toBe(true)
  })

  it("正文含套话（随着…的发展）→ error", () => {
    const issues = checkAtomQuality(atom({ body: "随着医疗信息化的发展，我院不断提升服务能力。" }))
    expect(issues.some((i) => i.field === "body" && i.severity === "error")).toBe(true)
  })

  it("正文含模板残留（待补充/XXX）→ error", () => {
    expect(checkAtomQuality(atom({ body: "具体数值待补充。" })).some((i) => i.field === "body")).toBe(true)
    expect(checkAtomQuality(atom({ body: "为XXX医院部署平台。" })).some((i) => i.field === "body")).toBe(true)
  })

  it("名词短语标题 → warn（不拦，但审核时提示）", () => {
    const issues = checkAtomQuality(atom({ title: "电子病历分级情况" }))
    const hit = issues.find((i) => i.field === "title")
    expect(hit?.severity).toBe("warn")
  })

  it("metric 缺数值 → error", () => {
    const issues = checkAtomQuality(atom({ attributes: { unit: "级", year: 2021 } }))
    expect(issues.some((i) => i.field === "attributes.value" && i.severity === "error")).toBe(true)
  })

  it("metric 缺年份/口径 → warn（建议补，不拦）", () => {
    const issues = checkAtomQuality(atom({ attributes: { value: 5 } }))
    expect(issues.filter((i) => i.severity === "warn").length).toBeGreaterThan(0)
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0)
  })

  it("政策/资质缺有效期 → warn", () => {
    const policy = atom({ atom_type: "policy", subject_key: "policy:国卫办医函〔2018〕894号|4.2", valid_until: null })
    const issues = checkAtomQuality(policy)
    expect(issues.some((i) => i.field === "valid_until" && i.severity === "warn")).toBe(true)
  })
})

describe("sanitizeExtraction：抽取结果清洗", () => {
  const sourceText = `第一章 现状
六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。
医院编制床位 300 张，年门诊量 42 万人次。`

  function atom(p: Partial<ExtractedAtom>): ExtractedAtom {
    return {
      atom_type: "case",
      title: "六安市中医院 2021 年通过电子病历 5 级评审",
      body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
      subject_key: "case:六安市中医院",
      source_quote: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
      confidence: 0.9,
      ...p,
    }
  }

  it("合格原子保留，subject_key 被归一化", () => {
    const r = sanitizeExtraction({ atoms: [atom({ subject_key: "case:六安市中医院分院" })] }, sourceText)
    expect(r.atoms).toHaveLength(1)
    expect(r.atoms[0].subject_key).toBe("case:六安市中医院")
  })

  it("source_quote 不来自原文 → 丢弃（防改写/拼接）", () => {
    const r = sanitizeExtraction({ atoms: [atom({ source_quote: "这是一段原文里根本不存在的摘录内容。" })] }, sourceText)
    expect(r.atoms).toHaveLength(0)
    expect(r.dropped[0].reasons[0]).toContain("未能在源文档中找到")
  })

  it("含套话的原子被丢弃", () => {
    const r = sanitizeExtraction({ atoms: [atom({ body: "随着医疗信息化的发展，医院不断进步。" })] }, sourceText)
    expect(r.atoms).toHaveLength(0)
  })

  it("批内重复只保留一条", () => {
    const r = sanitizeExtraction({ atoms: [atom({}), atom({})] }, sourceText)
    expect(r.atoms).toHaveLength(1)
    expect(r.dropped).toHaveLength(1)
  })

  it("空结果正常返回（不硬凑）", () => {
    const r = sanitizeExtraction({ atoms: [] }, sourceText)
    expect(r.atoms).toHaveLength(0)
    expect(r.dropped).toHaveLength(0)
  })
})

describe("辅助：低置信与密级", () => {
  it("低置信阈值 0.55", () => {
    expect(LOW_CONFIDENCE).toBe(0.55)
    expect(isLowConfidence({ confidence: 0.4 })).toBe(true)
    expect(isLowConfidence({ confidence: 0.55 })).toBe(false)
    expect(isLowConfidence({ confidence: 0.9 })).toBe(false)
  })

  it("密级高低排序正确（取最高密级用）", () => {
    expect(CONFIDENTIALITY_RANK.public).toBeLessThan(CONFIDENTIALITY_RANK.internal)
    expect(CONFIDENTIALITY_RANK.internal).toBeLessThan(CONFIDENTIALITY_RANK.client_only)
    expect(CONFIDENTIALITY_RANK.client_only).toBeLessThan(CONFIDENTIALITY_RANK.secret)
  })

  it("八种原子类型齐全", () => {
    expect(ATOM_TYPES).toHaveLength(8)
  })
})
