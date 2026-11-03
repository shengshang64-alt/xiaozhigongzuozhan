import { describe, expect, it } from "vitest"
import { pickB0, scoreDocForB0, sha256Hex, splitWithAnchor } from "./kbParse"

// ---------------------------------------------------------------------------
// P0-3 验收测试：段落切分 / source_anchor / B0 选批 / file_hash
//
// 对应《知识库改造需求文档 v1.0》：
//   §4.2 source_anchor 格式 `p{段落号}-c{起}-{止}`，用于 3 次点击回原文并高亮
//   §10.3 B0 优先级打分（recency/outcome/completeness/size 四项加权）
//   §4.1 file_hash 识别同一文件重复导入
// ---------------------------------------------------------------------------

describe("splitWithAnchor：段落切分与锚点", () => {
  it("按空行切段，anchor 格式正确", () => {
    // 两段各 > 40 字，才能通过 MIN_PARA_LEN 过滤进入抽取
    const text =
      "第一段内容是六安市中医院 2021 年通过电子病历应用水平分级 5 级评审的具体事实描述。\n\n" +
      "第二段内容是医院编制床位 300 张、年门诊量 42 万人次、建筑面积 2 万平方米的规模指标描述。"
    const ps = splitWithAnchor(text)
    expect(ps).toHaveLength(2)
    expect(ps[0].anchor).toMatch(/^p1-c\d+-\d+$/)
    expect(ps[1].anchor).toMatch(/^p2-c\d+-\d+$/)
  })

  it("anchor 的字符区间能精确回原文（这是高亮的前提）", () => {
    const text = "开头。\n\n这是需要被高亮的段落，它包含了足够多的中文字符用于通过最小长度过滤条件，确保能够被切分出来。\n\n结尾。"
    const ps = splitWithAnchor(text)
    expect(ps.length).toBeGreaterThan(0)
    for (const p of ps) {
      expect(text.slice(p.start, p.end)).toBe(p.text)
    }
  })

  it("短段落被过滤（<40 字不参与抽取）", () => {
    const text = "太短。\n\n这是一个足够长的段落，包含了很多有信息量的内容与具体事实，可以通过最小长度过滤条件并进入抽取队列。"
    const ps = splitWithAnchor(text)
    expect(ps).toHaveLength(1)
    expect(ps[0].text).toContain("足够长")
  })

  it("无空行的中文长文档按行/句切分（不返回巨型段落）", () => {
    // 50 句 × 约 30 字 = 1500 字 > MAX_PARA_LEN(1200)，必然触发按句切分
    const long = Array.from({ length: 50 }, (_, i) => `第${i}句内容说明了一个具体的业务事实与指标口径。`).join("")
    const ps = splitWithAnchor(long)
    expect(ps.length).toBeGreaterThan(1)
    for (const p of ps) expect(p.text.length).toBeLessThanOrEqual(1200)
  })

  it("空文档返回空数组", () => {
    expect(splitWithAnchor("")).toHaveLength(0)
    expect(splitWithAnchor("   \n\n  ")).toHaveLength(0)
  })

  it("锚点段落号连续递增（便于人读「段落 12」）", () => {
    const text = Array.from({ length: 5 }, (_, i) => `第${i}段的内容需要足够长才能通过过滤条件，这里补足字数要求。`).join("\n\n")
    const ps = splitWithAnchor(text)
    ps.forEach((p, i) => {
      expect(p.anchor.startsWith(`p${i + 1}-c`)).toBe(true)
    })
  })
})

describe("scoreDocForB0：B0 选批打分（§10.3）", () => {
  const now = Date.parse("2026-10-30T00:00:00Z")

  it("近期 + 中标 + 适中篇幅 + 适中大小 → 高分", () => {
    const good = scoreDocForB0(
      {
        title: "某某医院中标方案.docx",
        folder_path: "/方案/中标",
        content: "x".repeat(40_000), // 约 50 页
        updated: "2026-08-01",
        file_bytes: 1_000_000,
      },
      now,
    )
    expect(good).toBeGreaterThan(0.85)
  })

  it("久远 + 初稿 + 太短 → 低分", () => {
    const bad = scoreDocForB0(
      {
        title: "初稿草稿.docx",
        folder_path: "/临时",
        content: "x".repeat(2_000), // 约 2.5 页
        updated: "2022-01-01",
        file_bytes: 10_000,
      },
      now,
    )
    expect(bad).toBeLessThan(0.4)
  })

  it("recency 分段正确：12 月内 1.0 / 24 月内 0.6 / 更早 0.2", () => {
    const base = { content: "x".repeat(40_000), file_bytes: 1_000_000, folder_path: "/方案" }
    const r1 = scoreDocForB0({ ...base, title: "a", updated: "2026-06-01" }, now)
    const r2 = scoreDocForB0({ ...base, title: "a", updated: "2024-12-01" }, now)
    const r3 = scoreDocForB0({ ...base, title: "a", updated: "2022-01-01" }, now)
    expect(r1).toBeGreaterThan(r2)
    expect(r2).toBeGreaterThan(r3)
  })

  it("pickB0 按分数降序取前 N", () => {
    const docs = [
      { title: "旧初稿", updated: "2021-01-01", content: "x".repeat(1000) },
      { title: "新中标方案", updated: "2026-09-01", content: "x".repeat(40_000), file_bytes: 1_000_000 },
      { title: "中等方案", updated: "2025-01-01", content: "x".repeat(20_000) },
    ]
    const picked = pickB0(docs, 2)
    expect(picked).toHaveLength(2)
    expect(picked[0].title).toBe("新中标方案")
  })
})

describe("sha256Hex：文件指纹（§4.1 识别重复导入）", () => {
  it("同一内容产生同样指纹", async () => {
    const a = await sha256Hex("同一份文档内容")
    const b = await sha256Hex("同一份文档内容")
    expect(a).toBe(b)
  })

  it("不同内容产生不同指纹", async () => {
    const a = await sha256Hex("文档内容 A")
    const b = await sha256Hex("文档内容 B")
    expect(a).not.toBe(b)
  })

  it("返回非空字符串（失败时也有降级指纹）", async () => {
    const h = await sha256Hex("任意内容")
    expect(h.length).toBeGreaterThan(8)
  })

  it("支持 Uint8Array 输入", async () => {
    const bytes = new TextEncoder().encode("二进制内容")
    const h = await sha256Hex(bytes)
    expect(h.length).toBeGreaterThan(8)
  })
})
