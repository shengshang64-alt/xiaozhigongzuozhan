// ---------------------------------------------------------------------------
// 2026-10-26 真跑回归：拿真网关生成的 531 字正文，验证表格能被导出侧识别
//
// 这段正文不是自造样例——它是真网关（qodercn/qfmodel）在"要求两个全角空格分列"
// 的提示词下实际吐出来的东西，实测结果模型给了**两个半角空格**。
// 本测试锁住这次真跑暴露的问题：不归一的话，导出时整张表是散文。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { normalizeTableSeparators } from "./bidWritingRules"

/** 真网关实测正文（原样，未做任何清洗） */
const REAL_GENERATED = [
  "针对本次医院信息系统采购项目，我方逐条对照招标文件所列技术参数，进行了全面、细致的响应。",
  "",
  "表1-1 医院信息系统核心参数响应表",
  "",
  "参数项  招标要求  我方响应  偏离说明",
  "系统并发处理能力  支持不少于500用户同时在线  支持不少于800用户同时在线  无偏离，正偏离",
  "数据备份与恢复  RPO≤4小时，RTO≤2小时  RPO≤1小时，RTO≤30分钟  无偏离，正偏离",
  "HL7/FHIR接口兼容  支持HL7 v2.x及FHIR R4  完整支持，另兼容DICOM 3.0  无偏离",
  "信息安全等级  满足等保三级要求  已通过等保三级测评并提供证书  无偏离",
  "系统可用性  年度可用率≥99.9%  设计可用率≥99.95%，双活部署  无偏离，正偏离",
  "",
  "上述各项参数均已在我方技术方案中逐项落实。",
].join("\n")

/** 导出侧 splitTableRow 同口径 */
const isExportTableRow = (line: string): boolean => {
  if (!line.includes("\u3000")) return false
  return line.split(/\u3000+/).filter((c) => c.trim() !== "").length >= 2
}

describe("真跑回归：模型给半角空格时，归一后导出侧必须能认出表格", () => {
  it("归一前：这段真正文的表格行导出侧一行都认不出（这就是修复前的真实状态）", () => {
    // 注意用正则 [ ]{2,} 而不是 includes("   ")：实测这里正好是**两个**半角空格，
    // 写成三个空格的字面量会一行都匹配不到（本用例第一版就栽在这，已修正）。
    const tableLines = REAL_GENERATED.split("\n").filter((l) => / {2,}/.test(l))
    expect(tableLines.length).toBeGreaterThanOrEqual(6)
    for (const l of tableLines) expect(isExportTableRow(l), `不该被认出：${l}`).toBe(false)
  })

  it("归一后：表格行全部能被导出侧识别，且列数与列内容不变", () => {
    const { text, normalized } = normalizeTableSeparators(REAL_GENERATED)
    expect(normalized).toBe(6) // 表头 1 行 + 数据 5 行
    const lines = text.split("\n")
    const tableLines = lines.filter((l) => l.includes("\u3000"))
    expect(tableLines.length).toBe(6)
    for (const l of tableLines) {
      expect(isExportTableRow(l), `未被识别：${l}`).toBe(true)
      // 4 列必须还是 4 列
      expect(l.split(/\u3000+/).filter((c) => c.trim() !== "").length).toBe(4)
    }
    // 内容一字不改
    expect(tableLines[0]).toBe("参数项\u3000\u3000招标要求\u3000\u3000我方响应\u3000\u3000偏离说明")
    expect(tableLines[1]).toContain("支持不少于800用户同时在线")
    expect(tableLines[4]).toContain("已通过等保三级测评并提供证书")
  })

  it("表题行与正文段落不被误改（它们是单空格/无空格，不该被动）", () => {
    const { text } = normalizeTableSeparators(REAL_GENERATED)
    const lines = text.split("\n")
    expect(lines.find((l) => l.includes("表1-1"))).toBe("表1-1 医院信息系统核心参数响应表")
    expect(lines[0]).toBe("针对本次医院信息系统采购项目，我方逐条对照招标文件所列技术参数，进行了全面、细致的响应。")
  })

  it("单行只有两个半角空格时不动（表格块要 ≥2 行，避免误伤正文对齐）", () => {
    const src = "这一行只有一处  两个空格"
    const { text, normalized } = normalizeTableSeparators(src)
    expect(normalized).toBe(0)
    expect(text).toBe(src)
  })

  it("代码围栏内的内容不动", () => {
    const src = "```\na  b  c\nd  e  f\n```"
    const { normalized } = normalizeTableSeparators(src)
    expect(normalized).toBe(0)
  })

  it("已经是全角空格的行原样保留（幂等）", () => {
    const already = "参数项\u3000\u3000招标要求\u3000\u3000我方响应"
    const { text, normalized } = normalizeTableSeparators(already)
    expect(normalized).toBe(0)
    expect(text).toBe(already)
  })

  // -------------------------------------------------------------------------
  // 2026-10-26 标书官复核后补的两道护栏回归
  // 他指出的反向风险：本函数修好"表格变散文"，却可能把散文折成表格。
  // 下面两组用例把这两道护栏钉死。
  // -------------------------------------------------------------------------
  describe("护栏①：条目式正文不许被折成表格（标书官 P1）", () => {
    it("「（1）（2）」条目 + 双空格 → 不转", () => {
      const src = [
        "（1）支持门诊挂号  退号  换号功能",
        "（2）支持按科室  医生  午别检索",
      ].join("\n")
      const { text, normalized } = normalizeTableSeparators(src)
      expect(normalized, "条目式正文被误折成表格了").toBe(0)
      expect(text).toBe(src)
    })

    it("「1. 2.」与「一、二、」与「①②」条目起始都不转", () => {
      for (const [a, b] of [
        ["1. 门诊挂号  退号功能", "2. 按科室  医生检索"],
        ["一、门诊挂号  退号功能", "二、按科室  医生检索"],
        ["①支持挂号  退号功能", "②支持检索  分诊功能"],
      ]) {
        const src = `${a}\n${b}`
        const { normalized } = normalizeTableSeparators(src)
        expect(normalized, `「${a}」形态被误折`).toBe(0)
      }
    })

    it("真表格紧邻条目行时，表格仍能转、条目行不受影响", () => {
      const src = ["（1）下表列出参数：", "参数项  招标要求  我方响应", "并发数  500  800", "（2）以上均满足。"].join("\n")
      const { text, normalized } = normalizeTableSeparators(src)
      expect(normalized).toBe(2) // 只转表格那两行
      expect(text).toContain("（1）下表列出参数：")
      expect(text).toContain("（2）以上均满足。")
      expect(text).toContain("参数项\u3000\u3000招标要求\u3000\u3000我方响应")
    })
  })

  describe("护栏②：列数不稳定就不转（正文双空格是随机的，真表格列数固定）", () => {
    it("两行列数不一致 → 整块不转", () => {
      const src = ["第一节  概述  背景", "第二节  范围"].join("\n")
      const { normalized } = normalizeTableSeparators(src)
      // 第一行折 3 列、第二行折 2 列 → 不稳定，不转
      expect(normalized).toBe(0)
    })

    it("列数一致 → 正常转（真表格形态）", () => {
      const src = ["参数项  要求  响应", "并发数  500  800"].join("\n")
      const { normalized, text } = normalizeTableSeparators(src)
      expect(normalized).toBe(2)
      expect(text).toContain("\u3000\u3000")
    })
  })
})
