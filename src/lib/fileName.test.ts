// Author: loop-R116
// Oracle test: the migrated helpers must reproduce the three prior inline
// sanitizers byte-for-byte. Each prior body is replicated verbatim here and
// asserted equal across illegal chars, truncation, empty-base and ext-join.
import { describe, expect, it } from "vitest"

import { buildSafeFileName, sanitizeFileBase } from "./fileName"

// verbatim clones of the three removed implementations
function prevIntel(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
}
function prevDeck(name: string, ext: string): string {
  const base = (name || "汇报PPT").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
  return `${base}.${ext}`
}
function prevQuote(name: string, ext: string): string {
  const base = (name || "报价单").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
  return `${base}.${ext}`
}

const SAMPLES = [
  "情报清单-20261001",
  'a\\b/c:d*e?f"g<h>i|j',
  "",
  "中文项目名",
  "x".repeat(120),
  "no-change_-.csv",
]

describe("sanitizeFileBase == prior intel body", () => {
  it("matches byte-for-byte for every sample", () => {
    for (const s of SAMPLES) {
      expect(sanitizeFileBase(s)).toBe(prevIntel(s))
    }
  })
})

describe("buildSafeFileName == prior deck/quote bodies", () => {
  it("deck: fallback 汇报PPT + ext join matches", () => {
    for (const s of SAMPLES) {
      expect(buildSafeFileName(s, "pptx", "汇报PPT")).toBe(prevDeck(s, "pptx"))
    }
  })
  it("quote: fallback 报价单 + ext join matches", () => {
    for (const s of SAMPLES) {
      expect(buildSafeFileName(s, "docx", "报价单")).toBe(prevQuote(s, "docx"))
    }
  })
})

describe("explicit behavior", () => {
  it("replaces every illegal char with an underscore", () => {
    expect(sanitizeFileBase('a\\b/c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j")
  })
  it("truncates to 60 chars", () => {
    expect(sanitizeFileBase("x".repeat(120))).toBe("x".repeat(60))
  })
  it("empty base with no fallback stays empty; with fallback uses it", () => {
    expect(sanitizeFileBase("")).toBe("")
    expect(sanitizeFileBase("", "报价单")).toBe("报价单")
  })
  it("appends the extension", () => {
    expect(buildSafeFileName("报价", "xlsx", "报价单")).toBe("报价.xlsx")
  })
})
