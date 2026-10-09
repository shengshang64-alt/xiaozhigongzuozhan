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

// ---------------------------------------------------------------------------
// R183 加固：保留设备名 / 控制字符 / 结尾点空格。常规名逐字节等价由上方 oracle 用例守护，
// 此处仅覆盖新逻辑触发路径，确认加固不误伤普通名。
// ---------------------------------------------------------------------------
describe("R183 sanitizeFileBase 加固", () => {
  it("中和 Windows 保留设备名 CON/PRN/AUX/NUL/COM1-9/LPT1-9（大小写不敏感）", () => {
    for (const n of ["CON", "con", "PrN", "auX", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
      expect(sanitizeFileBase(n)).toBe("_" + n)
    }
  })

  it("非保留设备名不误伤（console/com0/aux1/cool/nullish 保持原样）", () => {
    for (const n of ["console", "com0", "aux1", "cool", "nullish", "printer"]) {
      expect(sanitizeFileBase(n)).toBe(n)
    }
  })

  it("带扩展名的保留基底同样中和；buildSafeFileName 拼扩展名后仍安全", () => {
    expect(sanitizeFileBase("con.txt")).toBe("_con.txt")
    expect(buildSafeFileName("COM1", "docx")).toBe("_COM1.docx")
  })

  it("清洗裸控制字符（制表/换行/NUL）为下划线", () => {
    expect(sanitizeFileBase("a\tb\nc")).toBe("a_b_c")
    expect(sanitizeFileBase("报价\u0000单")).toBe("报价_单")
  })

  it("去除 Windows 会静默剥离的结尾点与空格", () => {
    expect(sanitizeFileBase("方案  ")).toBe("方案")
    expect(sanitizeFileBase("方案...")).toBe("方案")
    expect(sanitizeFileBase("方案 .  ")).toBe("方案")
  })

  it("普通名逐字节等价不回归（R116 契约守护的补充断言）", () => {
    expect(sanitizeFileBase("医院-三甲-信息化项目_2026")).toBe("医院-三甲-信息化项目_2026")
    expect(buildSafeFileName("季度报价  ", "xlsx", "报价单")).toBe("季度报价.xlsx")
  })
})
