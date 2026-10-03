import { describe, expect, it } from "vitest"
import {
  buildVerifiedExcerpt,
  findVerifiedTypoPosition,
  lineAt,
  sanitizeLogicFindings,
  sanitizeTypoFindings,
  splitAuditDoc,
} from "./textAudit"
import { buildLogicCheckMessages, buildTypoCheckMessages } from "./prompts/textAudit"
import { normalizeTextAudit } from "./bidTypes"

// T18 文本审计测试：分段偏移 / 错别字位置回填校验（幻觉丢弃）/ 净化去重 / 行号定位 / 报告容错

const doc = {
  id: "ch1",
  title: "实施方案",
  content: "第一行内容。\n本项目工期为九十天，双路供电。\n第三行：项目经理张三，PMP 认证。\n第四行收尾。",
}

describe("splitAuditDoc", () => {
  it("短文单段；长文切段且段偏移可还原全文", () => {
    expect(splitAuditDoc(doc, 1000)).toEqual([{ text: doc.content, start: 0 }])
    const parts = splitAuditDoc({ ...doc, content: doc.content.repeat(30) }, 200)
    expect(parts.length).toBeGreaterThan(1)
    // 各段按 start 拼接还原全文
    const rebuilt = parts.map((p) => p.text).join("")
    expect(rebuilt).toBe(doc.content.repeat(30))
    for (const p of parts) expect(p.start).toBeLessThan(p.text.length + p.start)
  })
})

describe("findVerifiedTypoPosition + 摘录/行号", () => {
  it("excerpt 含错字时按 excerpt 定位；excerpt 内不含错字时回退 wrongText 首次出现", () => {
    const content = "系统工期九十天。验收标准另述。工期九十天为承诺值。"
    const at = findVerifiedTypoPosition(content, "工期九十天", "验收标准另述")
    // excerpt「验收标准另述」在原文中存在但不含错字 → 回退 wrongText 首次命中（索引 2）
    expect(at).toBe(content.indexOf("工期九十天"))
    const exact = findVerifiedTypoPosition(content, "承诺值", "工期九十天为承诺值")
    expect(content.slice(exact, exact + 3)).toBe("承诺值")
    expect(findVerifiedTypoPosition(content, "不存在的词", "")).toBe(-1)
  })
  it("分段模式：优先段内定位并还原偏移", () => {
    const content = "AAAA。BBBB 工期九十天。CCCC。"
    const segText = "BBBB 工期九十天。CCCC。"
    const segStart = content.indexOf(segText)
    const at = findVerifiedTypoPosition(content, "工期九十天", "", segStart, segText)
    expect(at).toBe(content.indexOf("工期九十天"))
  })
  it("buildVerifiedExcerpt 截取 wrongText ± 60；lineAt 行号从 1 起", () => {
    const content = "前缀。".repeat(30) + "目标词" + "后缀。".repeat(30)
    const at = content.indexOf("目标词")
    const excerpt = buildVerifiedExcerpt(content, at, "目标词")
    expect(excerpt).toContain("目标词")
    expect(excerpt.length).toBeLessThanOrEqual(126)
    expect(lineAt("a\nb\nc", 4)).toBe(3)
  })
})

describe("sanitizeTypoFindings", () => {
  it("有效条目过位置校验保留；幻觉词丢弃；wrong==correct 丢弃；去重", () => {
    const raw = JSON.stringify({
      findings: [
        { chapterNo: 1, wrongText: "工期玖拾天", correctText: "工期九十天", originalExcerpt: "承诺工期玖拾天整", reason: "数字大写错字" },
        { chapterNo: 1, wrongText: "不存在的幻觉词", correctText: "x", originalExcerpt: "", reason: "" },
        { chapterNo: 1, wrongText: "同词", correctText: "同词", reason: "" },
        { chapterNo: 1, wrongText: "工期玖拾天", correctText: "工期九十天", originalExcerpt: "承诺工期玖拾天整", reason: "重复条目" },
      ],
    })
    const out = sanitizeTypoFindings(raw, { id: "ch1", title: "实施方案", content: "本项目承诺工期玖拾天整，请复核。" })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ docId: "ch1", wrongText: "工期玖拾天", correctText: "工期九十天" })
    expect(out[0].excerpt).toContain("玖拾天")
    expect(out[0].line).toBe(1)
  })
  it("坏 JSON 安全返回空数组", () => {
    expect(sanitizeTypoFindings("垃圾输出", doc)).toEqual([])
  })
})

describe("sanitizeLogicFindings", () => {
  it("净化字段 + 去重（同标题同理由）+ 缺理由丢弃", () => {
    const raw = JSON.stringify({
      findings: [
        { chapterNo: 1, title: "工期前后不一致", originalText: "工期九十天……工期一百二十天", locationHint: "第二章 vs 第四章", fallacyReason: "工期口径矛盾", suggestion: "统一为九十天" },
        { chapterNo: 1, title: "工期前后不一致", fallacyReason: "工期口径矛盾", suggestion: "x" },
        { chapterNo: 1, title: "无理由", fallacyReason: "" },
      ],
    })
    const out = sanitizeLogicFindings(raw, doc)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ docId: "ch1", title: "工期前后不一致", fallacyReason: "工期口径矛盾" })
  })
})

describe("提示词", () => {
  it("错别字契约含「程序会校验 wrongText」与 JSON 模板；逻辑契约含前后不一致范围", () => {
    const typo = buildTypoCheckMessages([{ no: 1, title: "实施方案", content: "正文……" }])
    expect(String(typo[0].content)).toContain("程序会校验")
    expect(String(typo[0].content)).toContain('"wrongText"')
    const logic = buildLogicCheckMessages([{ no: 1, title: "实施方案", content: "正文……" }])
    expect(String(logic[0].content)).toContain("前后不一致")
    expect(String(logic[0].content)).toContain("chapterNo")
  })
})

describe("normalizeTextAudit", () => {
  it("存量容错：null/损坏 → null；字段截断与坏条目过滤", () => {
    expect(normalizeTextAudit(null)).toBeNull()
    expect(normalizeTextAudit("x")).toBeNull()
    expect(normalizeTextAudit({ typos: [], logic: [] })).toBeNull()
    const rep = normalizeTextAudit({
      typos: [{ docId: "c1", docTitle: "章", wrongText: "错", correctText: "对", excerpt: "…", reason: "r", line: 3 }, { wrongText: "", correctText: "" }],
      logic: [{ docId: "c1", docTitle: "章", title: "t", originalText: "o", locationHint: "l", fallacyReason: "f", suggestion: "s" }],
      checked_at: "2026-09-30T00:00:00Z",
      source: "external",
    })
    expect(rep?.typos).toHaveLength(1)
    expect(rep?.logic).toHaveLength(1)
    expect(rep?.source).toBe("external")
  })
})
