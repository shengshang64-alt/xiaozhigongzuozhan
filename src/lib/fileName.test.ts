// Author: loop-R116
// Oracle test: the migrated helpers must reproduce the three prior inline
// sanitizers byte-for-byte. Each prior body is replicated verbatim here and
// asserted equal across illegal chars, truncation, empty-base and ext-join.
import { describe, expect, it } from "vitest"

import { buildSafeFileName, buildVersionedFileName, sanitizeFileBase } from "./fileName"

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


// ---------------------------------------------------------------------------
// 2026-10-26 新增：buildVersionedFileName（公司规范「日期-标题-版本号」三要素）
//
// 起因：投标文件与方案两个导出模块**各犯了一次同一个毛病**——文件名不带日期与版本号，
// 用户下载多个版本后在自己电脑上分不清新旧。本函数是两处唯一真源。
// 与 bidWritingRules.checkFileName 互相咬合：生成的名字必须过得了那个校验。
// ---------------------------------------------------------------------------
describe("buildVersionedFileName：公司规范三要素", () => {
  const AT = new Date(2026, 8, 17, 14, 30) // 2026-09-17 14:30

  it("日期-名称-文档类型-版本号 四段齐全，扩展名在最后", () => {
    const n = buildVersionedFileName("安庆二院智慧医院项目", "投标文件", AT)
    expect(n).toBe("2026.09.17-安庆二院智慧医院项目-投标文件-V20260917.1430.docx")
  })

  it("生成的名字必须能通过 checkFileName 校验（否则改了等于白改）", async () => {
    const { checkFileName } = await import("@/pages/BidWorkspace/bidWritingRules")
    for (const name of ["某某医院", "厦门市海沧医院互联互通测评（四级甲等）项目", ""]) {
      const f = buildVersionedFileName(name, "投标文件", AT)
      const r = checkFileName(f)
      expect(r.ok, `「${name}」生成的文件名未过规范：${r.reason}（${f}）`).toBe(true)
    }
  })

  it("Windows 保留设备名被中和（CON 会让下载静默失败，这是 sanitizeFileBase 的既有能力）", () => {
    const n = buildVersionedFileName("CON", "投标文件", AT)
    expect(n).toContain("_CON")
  })

  it("ASCII 控制字符被清掉（项目名里粘贴进制表符的常见事故）", () => {
    const n = buildVersionedFileName("某某\u0009医院\u0000项目", "投标文件", AT)
    // 用 codePoint 判定而不是控制字符正则字面量：eslint no-control-regex 会拦后者。
    // 被测源文件 fileName.ts 那处是有 disable 注释的正当清洗场景，测试这边不该再引一条新债。
    const hasControl = [...n].some((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
    expect(hasControl).toBe(false)
  })

  it("名称与类型都为空时仍产出合法名字（兜底不崩）", () => {
    const n = buildVersionedFileName("", "", AT)
    expect(n).toBe("2026.09.17-文档-V20260917.1430.docx")
  })

  it("月份/日期/时分补零", () => {
    const n = buildVersionedFileName("某院", "方案", new Date(2026, 0, 1, 3, 5))
    expect(n).toBe("2026.01.01-某院-方案-V20260101.0305.docx")
  })

  it("不同时刻导出必得不同版本号（用户能按名排序分新旧）", () => {
    const a = buildVersionedFileName("某院", "投标文件", new Date(2026, 8, 17, 14, 30))
    const b = buildVersionedFileName("某院", "投标文件", new Date(2026, 8, 17, 15, 5))
    expect(a).not.toBe(b)
  })

  it("扩展名可换（同一套口径给非 docx 产物用）", () => {
    const n = buildVersionedFileName("某院", "偏离表", AT, "xlsx")
    expect(n.endsWith(".xlsx")).toBe(true)
  })
})
