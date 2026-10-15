import { describe, expect, it } from "vitest"
import {
  KB_CATEGORIES,
  KB_CATEGORY_POLICY,
  AI_CONTEXT_MODE_LABELS,
  categoryOf,
  effectivePolicy,
  contextSnippetOf,
  guessCategoryFromFileName,
  classifyKbDoc,
} from "./kbPolicy"
import type { KbDocRow } from "./kbCore"

// ---------------------------------------------------------------------------
// 知识库分类与 AI 上下文策略（kbPolicy）：kbCore 检索 / useKnowledge 问答 /
// assistantCore 注入三处共用的唯一真相源。锁死点：
//   1) 敏感档（合同商务 / 资质证书）默认 sanitized_summary，进 AI 只给脱敏摘要，
//      原文（hit.snippet）绝不外泄——AGENTS.md #7 医院资料敏感硬约束；
//   2) effectivePolicy 显式覆盖口径（mode 三值校验、weight>0 才生效、is_sensitive 需显式 true）；
//   3) 分类猜测与内容打分的优先级 / 文件名加权 / ISBN 出版物守卫。
// ---------------------------------------------------------------------------

const mkDoc = (over: Partial<KbDocRow>): KbDocRow => ({
  id: "d1",
  rh_user_id: "u1",
  title: "某医院采购合同",
  folder_path: "/",
  content: "正文原文",
  doc_format: "docx",
  visibility: "private",
  summary: "",
  keywords: [],
  source_file_name: "a.docx",
  uploader_name: "张三",
  created: "2026-01-01 00:00:00",
  updated: "2026-01-01 00:00:00",
  ...over,
})

describe("kbPolicy 词表与默认策略", () => {
  it("七档分类齐全", () => {
    expect(KB_CATEGORIES).toHaveLength(7)
    expect(KB_CATEGORIES).toContain("合同商务")
    expect(KB_CATEGORIES).toContain("资质证书")
  })

  it("敏感档默认脱敏摘要、权重 0.5、标记敏感", () => {
    expect(KB_CATEGORY_POLICY["合同商务"]).toEqual({
      ai_context_mode: "sanitized_summary",
      retrieval_weight: 0.5,
      is_sensitive: true,
    })
    expect(KB_CATEGORY_POLICY["资质证书"].is_sensitive).toBe(true)
  })

  it("产品资料 / 技术方案默认可进原文、权重 1.2、非敏感", () => {
    expect(KB_CATEGORY_POLICY["产品资料"].ai_context_mode).toBe("original")
    expect(KB_CATEGORY_POLICY["产品资料"].retrieval_weight).toBe(1.2)
    expect(KB_CATEGORY_POLICY["技术方案"].is_sensitive).toBe(false)
  })

  it("三档进 AI 模式中文标签", () => {
    expect(AI_CONTEXT_MODE_LABELS.original).toBe("原文")
    expect(AI_CONTEXT_MODE_LABELS.sanitized_summary).toBe("脱敏摘要")
    expect(AI_CONTEXT_MODE_LABELS.blocked).toBe("禁止进 AI")
  })
})

describe("categoryOf", () => {
  it("合法分类原样返回", () => {
    expect(categoryOf({ doc_category: "技术方案" })).toBe("技术方案")
  })
  it("非法 / 空 / 缺省一律归「其他」", () => {
    expect(categoryOf({ doc_category: "不存在的档" })).toBe("其他")
    expect(categoryOf({ doc_category: "" })).toBe("其他")
    expect(categoryOf({})).toBe("其他")
    expect(categoryOf(null)).toBe("其他")
    expect(categoryOf(undefined)).toBe("其他")
  })
})

describe("effectivePolicy", () => {
  it("无显式 mode 时取分类默认", () => {
    const p = effectivePolicy(mkDoc({ doc_category: "合同商务" }))
    expect(p).toEqual({ ai_context_mode: "sanitized_summary", retrieval_weight: 0.5, is_sensitive: true })
  })
  it("显式覆盖：mode / weight / is_sensitive 三项各自以显式值为准", () => {
    const p = effectivePolicy(
      mkDoc({ doc_category: "合同商务", ai_context_mode: "original", retrieval_weight: 2.0, is_sensitive: true }),
    )
    expect(p.ai_context_mode).toBe("original")
    expect(p.retrieval_weight).toBe(2.0)
    expect(p.is_sensitive).toBe(true)
  })
  it("显式 mode 但 weight 为 0 时落到最低权重（R56 契约变更：0 = 压低，不是忽略）", () => {
    const p = effectivePolicy(mkDoc({ doc_category: "资质证书", ai_context_mode: "original", retrieval_weight: 0 }))
    expect(p.ai_context_mode).toBe("original")
    // 旧口径把 0 挡掉后回退分类档 0.5；实测 1293 篇「产品资料」标 0 想压低，
    // 回退分类档反而拿 1.2（比默认更重）——现统一落最低权重：排到最后，但语料不消失
    expect(p.retrieval_weight).toBe(0.1)
  })
  it("权重字段独立生效：mode 写错不为它连坐（R56 契约变更）", () => {
    const p = effectivePolicy(mkDoc({ doc_category: "合同商务", ai_context_mode: "weird", retrieval_weight: 3 }))
    expect(p.ai_context_mode).toBe("sanitized_summary") // 非法 mode 不作显式覆盖
    expect(p.is_sensitive).toBe(true)
    // 实测 184 篇空 mode 文档的权重曾被整体忽略；权重是独立可信的数字字段
    expect(p.retrieval_weight).toBe(3)
  })
  it("未知分类兜底「其他」默认（original / 1.0 / false）", () => {
    const p = effectivePolicy(mkDoc({ doc_category: "乱填的" }))
    expect(p).toEqual({ ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false })
  })
  it("is_sensitive 需显式 true，否则覆盖分支下恒为 false", () => {
    const p = effectivePolicy(mkDoc({ doc_category: "合同商务", ai_context_mode: "original", is_sensitive: false }))
    expect(p.is_sensitive).toBe(false)
  })
})

describe("contextSnippetOf 隐私不变量", () => {
  it("sanitized_summary 且有摘要：只返回脱敏摘要，绝不泄露原文 snippet", () => {
    const doc = mkDoc({ doc_category: "合同商务", summary: "合同商务敏感资料（金额已脱敏）" })
    const hit = { snippet: "合同总金额 500 万元，付款账期 90 天" }
    const out = contextSnippetOf(doc, hit)
    expect(out).toContain("脱敏摘要，原文不进 AI 上下文")
    expect(out).toContain("合同商务敏感资料（金额已脱敏）")
    expect(out).not.toContain("500 万")
    expect(out).not.toContain("付款账期")
  })
  it("sanitized_summary 无摘要有关键词：用标题 + 关键词兜底，不含原文", () => {
    const doc = mkDoc({ doc_category: "资质证书", title: "ISO9001 证书", keywords: ["质量体系", "认证"] })
    const out = contextSnippetOf(doc, { snippet: "证书编号 NO.12345" })
    expect(out).toContain("ISO9001 证书")
    expect(out).toContain("质量体系、认证")
    expect(out).not.toContain("NO.12345")
  })
  it("sanitized_summary 无摘要无关键词：仅标题，不含原文", () => {
    const doc = mkDoc({ doc_category: "合同商务", title: "采购合同", summary: "", keywords: [] })
    const out = contextSnippetOf(doc, { snippet: "保密条款原文" })
    expect(out).toBe("（脱敏摘要，原文不进 AI 上下文）采购合同")
  })
  it("original 档：原样返回命中片段", () => {
    const doc = mkDoc({ doc_category: "产品资料" })
    expect(contextSnippetOf(doc, { snippet: "产品功能清单原文" })).toBe("产品功能清单原文")
  })
  it("显式覆盖为 original 的敏感档也返回原文", () => {
    const doc = mkDoc({ doc_category: "合同商务", ai_context_mode: "original" })
    expect(contextSnippetOf(doc, { snippet: "已获批公开的合同内容" })).toBe("已获批公开的合同内容")
  })
})

describe("guessCategoryFromFileName", () => {
  it("规则按优先级顺序命中，排前的合同商务胜过排后的技术方案", () => {
    expect(guessCategoryFromFileName("商务合同技术方案.docx")).toBe("合同商务")
  })
  it("资质 / 证书类命中资质证书", () => {
    expect(guessCategoryFromFileName("ISO9001资质证书.pdf")).toBe("资质证书")
  })
  it("产品 / 彩页类命中产品资料", () => {
    expect(guessCategoryFromFileName("某产品介绍彩页.pptx")).toBe("产品资料")
  })
  it("无关键词归「其他」", () => {
    expect(guessCategoryFromFileName("random.txt")).toBe("其他")
  })
})

describe("classifyKbDoc 内容感知分类", () => {
  it("ISBN 出版物守卫：文件名含 13 位 ISBN 直接归「其他」，即便正文命中资质证书词", () => {
    const r = classifyKbDoc("软件著作权登记_9787000000000.pdf", "本材料涉及软件著作权")
    expect(r).toEqual({ category: "其他", score: 0 })
  })
  it("文件名命中加权 ×3，压倒正文命中的技术方案", () => {
    const r = classifyKbDoc("产品彩页.pptx", "这里有很多建设方案技术方案的描述")
    expect(r.category).toBe("产品资料")
  })
  it("纯正文命中：政策语料判为政策法规", () => {
    const r = classifyKbDoc(
      "未命名文件.docx",
      "本项目严格按照国家卫生健康委电子病历系统应用水平分级评价标准与规范执行",
    )
    expect(r.category).toBe("政策法规")
    expect(r.score).toBeGreaterThan(0)
  })
  it("全 0 命中回退文件名猜测，且分数记 0", () => {
    const r = classifyKbDoc("报价单.xlsx", "普通说明文字")
    expect(r.category).toBe("合同商务")
    expect(r.score).toBe(0)
  })
})

describe("contextSnippetOf 敏感档 PII 逐字段脱敏（R186）", () => {
  it("摘要内手机号进 AI 前被掩码，原文绝不出现", () => {
    const doc = mkDoc({ doc_category: "合同商务", summary: "联系人 13812345678，账期 90 天" })
    const out = contextSnippetOf(doc, { snippet: "原文含身份证110101199003071234" })
    expect(out).toContain("脱敏摘要，原文不进 AI 上下文")
    expect(out).not.toContain("13812345678")
    expect(out).toContain("138****5678")
    expect(out).not.toContain("110101199003071234")
  })
  it("兜底标题 / 关键词内 PII 同样掩码", () => {
    const doc = mkDoc({
      doc_category: "资质证书",
      title: "法人110101199003071234",
      keywords: ["联系人13800138000"],
      summary: "",
    })
    const out = contextSnippetOf(doc, { snippet: "x" })
    expect(out).not.toContain("110101199003071234")
    expect(out).not.toContain("13800138000")
  })
  it("非敏感 original 档不做逐字段脱敏（行为逐字等价）", () => {
    const doc = mkDoc({ doc_category: "产品资料" })
    expect(contextSnippetOf(doc, { snippet: "热线400-1234567" })).toBe("热线400-1234567")
  })
})

describe("contextSnippetOf original 敏感档二次掩码（R188）", () => {
  it("original + is_sensitive=true：命中片段 PII 被掩码，不进 AI", () => {
    const doc = mkDoc({ doc_category: "合同商务", ai_context_mode: "original", is_sensitive: true })
    const out = contextSnippetOf(doc, { snippet: "联系人 李四 手机 13800138000，邮箱 lisi@hospital.cn" })
    expect(out).not.toContain("13800138000")
    expect(out).toContain("138")
    expect(out).toContain("****")
    expect(out).not.toContain("lisi@hospital.cn")
  })
  it("original 非敏感档：命中片段逐字原样返回（零行为变更回归锁）", () => {
    const doc = mkDoc({ doc_category: "技术方案" })
    expect(contextSnippetOf(doc, { snippet: "支持 13800138000 台终端" })).toBe("支持 13800138000 台终端")
  })
})
