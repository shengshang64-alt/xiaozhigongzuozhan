import { describe, expect, it } from "vitest"
import { assessDocQuality, summarizeQuality, THRESHOLDS } from "./kbDocQuality"

// ---------------------------------------------------------------------------
// 文档质量评估验收测试（2026-10-30 知识库优化）
//
// 为什么这层必须有：真实数据预演发现 7005 篇里有 918 篇"抽了也是垃圾"——
// 884 篇是 48 字的图片型 PPT 页碎片，1 篇 50 万字的 dict 字典文件。
// 不筛掉它们，抽取会产出大量垃圾原子，把审核变成不可能完成的任务。
//
// 本测试锁住两个关键行为：
//   ① 明确的垃圾必须跳过（不能浪费 token）
//   ② 正常业务文档不能误杀（宁可多抽，不可错杀）
// ---------------------------------------------------------------------------

function doc(title: string, content: string) {
  return { title, content }
}

/**
 * 造一段像真实业务文档的正文（不能简单重复同一句——那会被正确判为乱码）。
 * 用多句轮换 + 编号变化，模拟真实方案的行文。
 */
function businessText(chars = 800): string {
  const sentences = [
    "六安市中医院信息化建设需对标电子病历应用水平分级5级要求。",
    "互联互通标准化成熟度测评目标为四级甲等，覆盖门诊住院全流程。",
    "现有HIS、EMR、LIS三套系统字典不统一，药名与科室名称无法互通。",
    "建设周期12个月，分四个阶段推进，投资预算1800万元。",
    "重点打通门诊药房与住院药房的数据链路，消除信息孤岛。",
    "项目组配置实施顾问4人、开发工程师6人、测试工程师2人。",
    "验收标准包括核心业务响应时间不超过2秒，并发在线用户支持600人。",
    "培训覆盖临床科室26个、医技科室8个，累计培训人次约400人。",
  ]
  const parts: string[] = []
  let total = 0
  let i = 0
  while (total < chars) {
    const s = `第${Math.floor(i / sentences.length) + 1}节 ${sentences[i % sentences.length]}`
    parts.push(s)
    total += s.length
    i += 1
  }
  return parts.join("").slice(0, chars)
}

describe("assessDocQuality：垃圾文档必须跳过", () => {
  it("极短碎片（图片型 PPT 页）→ skip", () => {
    const q = assessDocQuality(doc("PPT素材/版式/封面·00-PPT模板·P11", "封面 公司名称 汇报人 日期"))
    expect(q.extractable).toBe(false)
    expect(q.action).toBe("skip")
    expect(q.reasons[0]).toContain("不足")
  })

  it("空内容 → skip", () => {
    const q = assessDocQuality(doc("空文档", ""))
    expect(q.extractable).toBe(false)
    expect(q.score).toBe(0)
  })

  it("50 万字 dict 字典文件 → 命中非业务特征", () => {
    const q = assessDocQuality(doc("dict", "a".repeat(500_000)))
    expect(q.extractable).toBe(false)
    expect(q.reasons.some((r) => r.includes("非业务文档") || r.includes("字典"))).toBe(true)
  })

  it("纯数字标题的临时文件 → 命中非业务特征", () => {
    const q = assessDocQuality(doc("12345", businessText(500)))
    expect(q.extractable).toBe(false)
    expect(q.reasons.some((r) => r.includes("非业务文档"))).toBe(true)
  })

  it("平均行长极短的表格碎片 → skip/人工确认", () => {
    // 1000 行，每行 3 个字 → 平均行长 < 8
    const tableLike = Array.from({ length: 1000 }, (_, i) => `项${i}`).join("\n")
    const q = assessDocQuality(doc("指标清单", tableLike))
    expect(q.extractable).toBe(false)
    expect(q.reasons.some((r) => r.includes("表格") || r.includes("清单"))).toBe(true)
  })

  it("字符种类极少的乱码 → skip", () => {
    const garbage = "ab".repeat(3000) // 只有 2 种字符
    const q = assessDocQuality(doc("乱码文件", garbage))
    expect(q.extractable).toBe(false)
    expect(q.reasons.some((r) => r.includes("乱码") || r.includes("占位"))).toBe(true)
  })
})

describe("assessDocQuality：正常文档不能误杀", () => {
  it("标准业务文档 → 可抽取", () => {
    const q = assessDocQuality(doc("三明市中西医结合医院信息化建设方案", businessText(2000)))
    expect(q.extractable).toBe(true)
    expect(q.action).toBe("extract")
    expect(q.score).toBeGreaterThan(0.4)
  })

  it("中等长度（500 字）也可抽取", () => {
    const q = assessDocQuality(doc("技术参数要求", businessText(500)))
    expect(q.extractable).toBe(true)
  })

  it("长文档可抽取，但提示只抽前面部分", () => {
    const long = businessText(100_000)
    const q = assessDocQuality(doc("超长方案", long))
    expect(q.extractable).toBe(true)
    expect(q.reasons.some((r) => r.includes("超过单次抽取上限"))).toBe(true)
  })

  it("标题为空的正常文档不因标题被误杀", () => {
    const q = assessDocQuality(doc("", businessText(1000)))
    expect(q.extractable).toBe(true)
  })
})

describe("评分：内容越丰富分越高", () => {
  it("200 字 < 2000 字 < 6000 字", () => {
    const s200 = assessDocQuality(doc("a", businessText(200))).score
    const s2000 = assessDocQuality(doc("b", businessText(2000))).score
    const s6000 = assessDocQuality(doc("c", businessText(6000))).score
    expect(s200).toBeLessThan(s2000)
    expect(s2000).toBeLessThan(s6000)
  })

  it("评分上限为 1", () => {
    expect(assessDocQuality(doc("d", businessText(200_000))).score).toBeLessThanOrEqual(1)
  })
})

describe("summarizeQuality：批量汇总", () => {
  it("正确分类并统计跳过原因", () => {
    const docs = [
      { id: "1", title: "正常方案", content: businessText(2000) },
      { id: "2", title: "正常方案2", content: businessText(1500) },
      { id: "3", title: "PPT素材/封面·P1", content: "封面 标题" },
      { id: "4", title: "PPT素材/目录·P2", content: "目录 一 二 三" },
      { id: "5", title: "dict", content: "x".repeat(400_000) },
    ]
    const s = summarizeQuality(docs)
    expect(s.extractable).toBe(2)
    expect(s.skipped).toBe(3)
    expect(s.skipReasons.get("短碎片")).toBe(2)
    expect(s.details).toHaveLength(5)
  })

  it("空数组不崩", () => {
    const s = summarizeQuality([])
    expect(s.extractable).toBe(0)
    expect(s.details).toHaveLength(0)
  })
})

describe("阈值可配置且合理", () => {
  it("minChars 与原子内容规模匹配", () => {
    // 原子 body 上限 300 字，标题要陈述句；文档不足 200 字撑不起一条合格原子
    expect(THRESHOLDS.minChars).toBeGreaterThanOrEqual(150)
    expect(THRESHOLDS.minChars).toBeLessThanOrEqual(300)
  })

  it("maxCharsForExtract 控制单篇成本", () => {
    expect(THRESHOLDS.maxCharsForExtract).toBeLessThanOrEqual(100_000)
  })
})
