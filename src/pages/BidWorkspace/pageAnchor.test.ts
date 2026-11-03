// Q28 切片A（天好 Skill 移植）：页码锚点纯函数 + 外部标书审查统一取数单测
import { describe, expect, it } from "vitest"
import { PAGE_TAG_RE, tagPageLine, stripPageTag, pageOfLine, renderPageRefs } from "./bidFiles"
import { normalizeBidSourceMode, chaptersToText } from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------- 1) tagPageLine ----------
describe("tagPageLine", () => {
  it("adds prefix with page number", () => {
    expect(tagPageLine("第一章 项目背景", 1)).toBe("\u3014P1\u3015 第一章 项目背景")
  })
  it("is idempotent – already tagged lines pass through", () => {
    const tagged = "\u3014P3\u3015 已带前缀"
    expect(tagPageLine(tagged, 99)).toBe(tagged)
  })
  it("handles page 0 edge case", () => {
    expect(tagPageLine("", 0)).toBe("\u3014P0\u3015 ")
  })
})

// ---------- 2) stripPageTag ----------
describe("stripPageTag", () => {
  it("removes page prefix", () => {
    expect(stripPageTag("\u3014P5\u3015 正文行")).toBe("正文行")
  })
  it("removes prefix without trailing space", () => {
    expect(stripPageTag("\u3014P5\u3015正文行")).toBe("正文行")
  })
  it("leaves untagged lines untouched", () => {
    expect(stripPageTag("无锚点行")).toBe("无锚点行")
  })
  it("handles docx placeholder tag", () => {
    expect(stripPageTag("\u3014P?\u3015 文档行")).toBe("文档行")
  })
})

// ---------- 3) pageOfLine ----------
describe("pageOfLine", () => {
  it("extracts numeric page", () => {
    expect(pageOfLine("\u3014P12\u3015 标题")).toBe(12)
  })
  it("returns null for docx placeholder", () => {
    expect(pageOfLine("\u3014P?\u3015 标题")).toBeNull()
  })
  it("returns null for untagged line", () => {
    expect(pageOfLine("普通文本")).toBeNull()
  })
})

// ---------- 4) renderPageRefs ----------
describe("renderPageRefs", () => {
  it("renders numeric tag to Chinese", () => {
    expect(renderPageRefs("\u3014P12\u3015")).toBe("第 12 页")
  })
  it("renders placeholder to section hint", () => {
    expect(renderPageRefs("\u3014P?\u3015")).toBe("见章节")
  })
  it("renders multiple occurrences", () => {
    const input = "位置：\u3014P3\u3015 第4段及\u3014P7\u3015 第1段"
    expect(renderPageRefs(input)).toBe("位置：第 3 页 第4段及第 7 页 第1段")
  })
  it("leaves plain text unchanged", () => {
    expect(renderPageRefs("无页码引用")).toBe("无页码引用")
  })
})

// ---------- 5) PAGE_TAG_RE consistency ----------
describe("PAGE_TAG_RE", () => {
  it("matches standard tag", () => {
    expect(PAGE_TAG_RE.test("\u3014P1\u3015 content")).toBe(true)
  })
  it("matches placeholder tag", () => {
    expect(PAGE_TAG_RE.test("\u3014P?\u3015 content")).toBe(true)
  })
  it("does not match without brackets", () => {
    expect(PAGE_TAG_RE.test("P15 content")).toBe(false)
  })
})

// ---------- 6) normalizeBidSourceMode ----------
describe("normalizeBidSourceMode", () => {
  it("returns external for \"external\"", () => {
    expect(normalizeBidSourceMode("external")).toBe("external")
  })
  it("returns internal for \"internal\"", () => {
    expect(normalizeBidSourceMode("internal")).toBe("internal")
  })
  it("returns internal for undefined/null/empty", () => {
    expect(normalizeBidSourceMode(undefined)).toBe("internal")
    expect(normalizeBidSourceMode(null)).toBe("internal")
    expect(normalizeBidSourceMode("")).toBe("internal")
  })
  it("returns internal for unknown values", () => {
    expect(normalizeBidSourceMode("weird")).toBe("internal")
  })
})

// ---------- 7) resolveBidText pattern (mirrors useBidWorkspace export) ----------
function resolveBidTextFor(cur: {
  bid_source_mode?: unknown
  bid_external_text?: string
  bid_chapters: Chapter[]
}): string {
  if (normalizeBidSourceMode(cur.bid_source_mode) === "external") {
    const text = cur.bid_external_text ?? ""
    return chaptersToText([{ node_id: "", title: "", sections: [], content: text, gen_status: "done" }])
  }
  return chaptersToText(cur.bid_chapters)
}

describe("resolveBidText (dual-mode pattern)", () => {
  const internalChapters: Chapter[] = [
    { node_id: "n1", title: "第一章", sections: ["1.1"], content: "内部编制正文内容", gen_status: "done" },
  ]

  it("internal mode returns chaptersToText(bid_chapters)", () => {
    const result = resolveBidTextFor({ bid_source_mode: "internal", bid_chapters: internalChapters })
    expect(result).toContain("内部编制正文内容")
  })

  it("external mode returns chaptersToTextStub(bid_external_text)", () => {
    const result = resolveBidTextFor({
      bid_source_mode: "external",
      bid_external_text: "外部标书全文\u3014P1\u3015 第一页",
      bid_chapters: [],
    })
    expect(result).toContain("外部标书全文")
    expect(result).toContain("\u3014P1\u3015")
  })

  it("external mode with empty text returns empty (or stub header only)", () => {
    const result = resolveBidTextFor({ bid_source_mode: "external", bid_external_text: "", bid_chapters: [] })
    // chaptersToText of a single empty-content chapter yields minimal output (title + newlines)
    expect(result.trim().length).toBeLessThan(5)
  })

  it("legacy data without bid_source_mode defaults to internal behavior", () => {
    const result = resolveBidTextFor({ bid_chapters: internalChapters })
    expect(result).toContain("内部编制正文内容")
  })
})

// ---------- 8) bidChaptersFor pattern ----------
function bidChaptersForTest(cur: {
  bid_source_mode?: unknown
  bid_external_text?: string
  bid_chapters: Chapter[]
}): Chapter[] {
  if (normalizeBidSourceMode(cur.bid_source_mode) === "external") {
    const text = (cur.bid_external_text ?? "").trim()
    if (!text) return []
    return [{ node_id: "", title: "外部投标文件全文", sections: [], content: text, gen_status: "done" }]
  }
  return cur.bid_chapters
}

describe("bidChaptersFor (dual-mode pattern)", () => {
  const chapters: Chapter[] = [
    { node_id: "n1", title: "章A", sections: [], content: "A正文", gen_status: "done" },
    { node_id: "n2", title: "章B", sections: [], content: "B正文", gen_status: "done" },
  ]

  it("internal mode passes through bid_chapters unchanged", () => {
    expect(bidChaptersForTest({ bid_source_mode: "internal", bid_chapters: chapters })).toEqual(chapters)
  })

  it("external mode synthesizes single chapter stub", () => {
    const result = bidChaptersForTest({ bid_source_mode: "external", bid_external_text: "外部全文", bid_chapters: [] })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("外部投标文件全文")
    expect(result[0].content).toBe("外部全文")
  })

  it("external mode with empty text returns empty array", () => {
    expect(bidChaptersForTest({ bid_source_mode: "external", bid_external_text: "  ", bid_chapters: [] })).toEqual([])
  })
})
