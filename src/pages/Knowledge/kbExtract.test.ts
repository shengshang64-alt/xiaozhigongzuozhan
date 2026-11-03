import { describe, expect, it, vi } from "vitest"
import {
  buildExtractionMessages,
  extractAtomsFromDoc,
  extractSummary,
  parseSegmentExtraction,
  prepareAtomsForInsert,
  EXTRACT_VERSION,
} from "./kbExtract"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// P0-4 验收测试：原子抽取服务
//
// 需求（§6 流水线 + 附录 A）：
//   · 六阶段状态机：raw → parsed → extracted → pending
//   · 单篇最多 40 条（附录 A 硬约束 6）
//   · 抽不出内容时返回空，**不要硬凑**（附录 A 硬约束 5）
//   · source_quote 必须逐字来自原文（附录 A 硬约束 3）
//
// 本测试用假 LLM 验证编排逻辑，不消耗真实 token。
// ---------------------------------------------------------------------------

const DOC = `第一章 项目概况
六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。医院编制床位 300 张，年门诊量 42 万人次，建筑面积 2 万平方米。

第二章 现状分析
医院现有 HIS、EMR、LIS 三套系统，三套字典不统一，药名与科室名称无法互通，导致门诊药房与住院药房数据对不上。

第三章 建设目标
对标电子病历应用水平 5 级与互联互通四级甲等，建设周期 12 个月，投资预算 1800 万元。`

function llmReturning(atomsPerCall: (callIndex: number) => unknown) {
  let call = 0
  return vi.fn(async (msgs: LlmMessage[]) => {
    // 参数确实不用，但保留签名便于断言调用次数
    void msgs.length
    const payload = atomsPerCall(call)
    call += 1
    return JSON.stringify({ atoms: payload })
  })
}

const GOOD_ATOM = {
  atom_type: "metric",
  title: "电子病历应用水平达 5 级",
  body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
  subject_key: "metric:电子病历应用水平分级|国家卫健委评测",
  attributes: { value: 5, unit: "级", year: 2021, scope: "国家卫健委评测", polarity: "positive" },
  source_quote: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
  confidence: 0.92,
}

describe("buildExtractionMessages：提示词构造", () => {
  it("带文档标题与段落序号（模型知道这是片段）", () => {
    const msgs = buildExtractionMessages({ text: "段落内容", docTitle: "可研报告.docx", index: 2, total: 5 })
    expect(msgs[0].content).toContain("第 2/5 个片段")
    expect(msgs[0].content).toContain("可研报告.docx")
    expect(msgs[1].content).toContain("段落内容")
  })

  it("提示词含完整抽取口径（附录 A）", () => {
    const msgs = buildExtractionMessages({ text: "x", docTitle: "t", index: 1, total: 1 })
    const sys = String(msgs[0].content)
    expect(sys).toContain("知识抽取器")
    expect(sys).toContain("绝对不抽")
    expect(sys).toContain("不要硬凑")
    expect(sys).toContain("subject_key")
  })
})

describe("parseSegmentExtraction：三段式校验", () => {
  it("合格原子通过", () => {
    const r = parseSegmentExtraction(JSON.stringify({ atoms: [GOOD_ATOM] }), DOC)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.atoms).toHaveLength(1)
      expect(r.atoms[0].subject_key).toBe("metric:电子病历应用水平分级|国家卫健委评测")
    }
  })

  it("容忍 ```json 包裹", () => {
    const r = parseSegmentExtraction("```json\n" + JSON.stringify({ atoms: [GOOD_ATOM] }) + "\n```", DOC)
    expect(r.ok).toBe(true)
  })

  it("容忍前后解释文字", () => {
    const r = parseSegmentExtraction("好的，以下是抽取结果：\n" + JSON.stringify({ atoms: [GOOD_ATOM] }) + "\n希望有帮助", DOC)
    expect(r.ok).toBe(true)
  })

  it("空结果 → ok 且 0 条（不硬凑，这是正确行为）", () => {
    const r = parseSegmentExtraction(JSON.stringify({ atoms: [] }), DOC)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.atoms).toHaveLength(0)
  })

  it("非 JSON → 明确失败原因", () => {
    const r = parseSegmentExtraction("这不是 JSON", DOC)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("JSON")
  })

  it("结构不合法 → 返回字段路径", () => {
    const bad = { ...GOOD_ATOM, atom_type: "unknown_type" }
    const r = parseSegmentExtraction(JSON.stringify({ atoms: [bad] }), DOC)
    expect(r.ok).toBe(false)
  })

  it("source_quote 不来自原文 → 该条被丢弃（防改写/拼接）", () => {
    const fake = { ...GOOD_ATOM, source_quote: "这段原文里完全不存在的内容用于测试校验机制。" }
    const r = parseSegmentExtraction(JSON.stringify({ atoms: [fake] }), DOC)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.atoms).toHaveLength(0)
      expect(r.dropped[0].reasons[0]).toContain("未能在源文档中找到")
    }
  })

  it("含套话的原子被丢弃", () => {
    const junky = { ...GOOD_ATOM, body: "随着医疗信息化的发展，我院不断提升服务能力与水平。" }
    const r = parseSegmentExtraction(JSON.stringify({ atoms: [junky] }), DOC)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.atoms).toHaveLength(0)
  })
})

describe("extractAtomsFromDoc：整篇编排", () => {
  it("逐段抽取并汇总", async () => {
    // 第一段出 1 条，其余段空
    const callLlm = llmReturning((i) => (i === 0 ? [GOOD_ATOM] : []))
    const r = await extractAtomsFromDoc(DOC, { docTitle: "可研.docx", callLlm })
    expect(r.segments.total).toBeGreaterThan(1)
    expect(r.atoms.length).toBeGreaterThan(0)
    expect(r.segments.failed).toBe(0)
  })

  it("全部段落空结果 → 不算失败（很多文档确实没可抽知识）", async () => {
    const callLlm = llmReturning(() => [])
    const r = await extractAtomsFromDoc(DOC, { docTitle: "空.docx", callLlm })
    expect(r.atoms).toHaveLength(0)
    expect(r.segments.failed).toBe(0)
    expect(r.segments.empty).toBeGreaterThan(0)
  })

  it("某段失败只跳过该段，不影响其他段（容错核心）", async () => {
    let call = 0
    const callLlm = vi.fn(async () => {
      call += 1
      // 第 1 段成功，第 2 段永远返回垃圾，第 3 段起成功
      if (call === 2 || call === 3) return "这不是 JSON" // 第2段两次尝试都失败
      return JSON.stringify({ atoms: [GOOD_ATOM] })
    })
    const r = await extractAtomsFromDoc(DOC, { docTitle: "d", callLlm, maxAttempts: 2 })
    expect(r.segments.failed).toBeGreaterThan(0) // 有失败段
    expect(r.atoms.length).toBeGreaterThan(0) // 但其他段仍抽到
  })

  it("全部段失败且无原子 → 整篇失败并带错误", async () => {
    const callLlm = vi.fn(async () => "垃圾内容")
    const r = await extractAtomsFromDoc(DOC, { docTitle: "d", callLlm, maxAttempts: 1 })
    expect(r.atoms).toHaveLength(0)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.segments.failed).toBe(r.segments.total)
  })

  it("空文档返回明确原因", async () => {
    const r = await extractAtomsFromDoc("", { docTitle: "空", callLlm: vi.fn() })
    expect(r.atoms).toHaveLength(0)
    expect(r.errors[0]).toContain("没有可抽取的段落")
  })

  it("maxSegments 限制只跑前 N 段（试跑用）", async () => {
    const callLlm = llmReturning(() => [])
    const r = await extractAtomsFromDoc(DOC, { docTitle: "d", callLlm, maxSegments: 2 })
    expect(r.segments.total).toBe(2)
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it("有进度回调", async () => {
    const seen: number[] = []
    const callLlm = llmReturning(() => [])
    await extractAtomsFromDoc(DOC, {
      docTitle: "d",
      callLlm,
      maxSegments: 2,
      onProgress: (done, total) => seen.push(`${done}/${total}` as unknown as number),
    })
    expect(seen.length).toBe(2)
  })

  it("单篇原子数有上限（防超长标书出几千条）", async () => {
    // 每段都返回 40 条（附录 A 单段上限）
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...GOOD_ATOM,
      title: `第 ${i} 条指标达 ${i} 级`,
      subject_key: `metric:测试指标${i}|口径`,
    }))
    const callLlm = llmReturning(() => many)
    const r = await extractAtomsFromDoc(DOC, { docTitle: "d", callLlm })
    expect(r.atoms.length).toBeLessThanOrEqual(200)
  })
})

describe("prepareAtomsForInsert：anchor 定位", () => {
  it("按 source_quote 回找段落 anchor", () => {
    const atoms = [
      {
        atom_type: "metric" as const,
        title: "电子病历达 5 级",
        body: "六安市中医院通过 5 级评审。",
        subject_key: "metric:电子病历应用水平分级|国家卫健委评测",
        source_quote: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
        confidence: 0.9,
      },
    ]
    const out = prepareAtomsForInsert(atoms, DOC, "doc123")
    expect(out[0].source_doc_id).toBe("doc123")
    expect(out[0].source_anchor).toMatch(/^p\d+-c\d+-\d+$/)
  })

  it("低置信原子被标记（§4.2：<0.55 强制待审）", () => {
    const atoms = [
      {
        atom_type: "fact" as const,
        title: "公司规模",
        body: "团队 200 人。",
        subject_key: "fact:公司|规模",
        source_quote: "医院现有 HIS、EMR、LIS 三套系统",
        confidence: 0.4,
      },
    ]
    const out = prepareAtomsForInsert(atoms, DOC, "doc123")
    expect(out[0].lowConfidence).toBe(true)
  })
})

describe("extractSummary：给用户看的摘要", () => {
  it("说明段数与原子数", () => {
    const s = extractSummary({
      atoms: [],
      dropped: [],
      segments: { total: 5, succeeded: 2, failed: 1, empty: 2 },
      errors: [],
    })
    expect(s).toContain("5 段")
    expect(s).toContain("2 段抽出内容")
    expect(s).toContain("1 段失败")
  })
})

describe("版本号：支持按新提示词全量重跑（原则 P1）", () => {
  it("有明确的抽取版本号", () => {
    expect(EXTRACT_VERSION).toMatch(/^v\d+\.\d+/)
  })
})
