// B4 落库层单测：合并 / 体积截断 / 表格归类
import { describe, expect, it } from "vitest"
import {
  TENDER_TABLES_MAX_BYTES,
  capTenderTables,
  classifyTenderTable,
  mergeTenderTables,
  summarizeTenderTables,
  tenderTablesBytes,
  type TenderTableRecord,
} from "./tenderTables"

const rec = (file: string, index: number, rows: string[][]): TenderTableRecord => ({ file, index, rows })

describe("mergeTenderTables：同名文件整体替换", () => {
  it("① 重传同名文件时只替换该文件的表，别的文件不动", () => {
    const prev = [rec("a.docx", 0, [["旧A1"], ["x"]]), rec("b.docx", 0, [["B1"], ["y"]])]
    const next = mergeTenderTables(prev, "a.docx", [{ index: 0, rows: [["新A1"], ["z"]] }])
    expect(next.filter((t) => t.file === "a.docx").map((t) => t.rows[0][0])).toEqual(["新A1"])
    expect(next.some((t) => t.file === "b.docx")).toBe(true)
  })

  it("② 只有表头的空壳表不入库", () => {
    const next = mergeTenderTables([], "a.docx", [{ index: 0, rows: [["只有表头"]] }])
    expect(next).toEqual([])
  })
})

describe("capTenderTables：json 列 1MB 上限前的体积闸", () => {
  it("③ 超限时后续表不再收，但第一张一定保留", () => {
    const big = "很长的一格内容".repeat(200)
    const t1 = rec("a.docx", 0, [["h"], [big]])
    const t2 = rec("a.docx", 1, [["h"], [big]])
    const capped = capTenderTables([t1, t2], 1000)
    expect(capped).toHaveLength(1)
    expect(tenderTablesBytes(capped)).toBeGreaterThan(0)
  })

  it("④ 单张表本身超限时截到 200 行，不丢整张表", () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`第${i}行`, "内容内容内容内容内容内容"])
    const capped = capTenderTables([rec("a.docx", 0, rows)], 100)
    expect(capped).toHaveLength(1)
    expect(capped[0].rows).toHaveLength(200)
  })

  it("⑤ 未超限时原样保留", () => {
    const list = [rec("a.docx", 0, [["序号", "名称", "数量"], ["1", "患者主索引", "1"]])]
    expect(capTenderTables(list)).toEqual(list)
    expect(TENDER_TABLES_MAX_BYTES).toBeGreaterThan(100_000)
  })
})

describe("classifyTenderTable：清单表 / 参数表 / 其他", () => {
  it("⑥ 序号+名称+数量 表头 → 采购清单", () => {
    expect(classifyTenderTable([["序号", "子系统名称", "数量", "单位"], ["1", "患者主索引", "1", "套"]])).toBe("purchase_list")
  })

  it("⑦ 技术参数表头 → 技术参数表", () => {
    expect(classifyTenderTable([["技术参数及要求"], ["★1、支持国产数据库"]])).toBe("tech_params")
  })

  it("⑧ 普通表格 → other，且统计只数清单/参数两类", () => {
    expect(classifyTenderTable([["评分项", "分值"], ["总体方案", "5"]])).toBe("other")
    const sum = summarizeTenderTables([
      rec("a.docx", 0, [["序号", "名称", "数量"], ["1", "x", "1"]]),
      rec("a.docx", 1, [["技术参数及要求"], ["y"]]),
      rec("a.docx", 2, [["无关"], ["z"]]),
    ])
    expect(sum).toEqual({ total: 3, purchaseList: 1, techParams: 1 })
  })
})

// ---------------------------------------------------------------------------
// B4 回填（2026-10-22）：原表 → 采购清单/技术参数
// ---------------------------------------------------------------------------
import { pickTableOfKind, tableToParamItems } from "./tenderTables"

describe("pickTableOfKind：选最完整的那张同类表", () => {
  it("⑨ 多张清单表取行数最多的；没有同类返回 null", () => {
    const small = rec("a.docx", 0, [["序号", "名称", "数量"], ["1", "x", "1"]])
    const big = rec("b.docx", 1, [
      ["序号", "名称", "数量"],
      ["1", "x", "1"],
      ["2", "y", "1"],
      ["3", "z", "1"],
    ])
    const other = rec("c.docx", 0, [["评分项", "分值"], ["总体方案", "5"]])
    expect(pickTableOfKind([small, big, other], "purchase_list")?.file).toBe("b.docx")
    expect(pickTableOfKind([other], "tech_params")).toBeNull()
  })
})

describe("tableToParamItems：原表 → 逐条参数", () => {
  it("⑩ 有「序号 + 技术参数」列时按列取；行序与表内编号保留", () => {
    const items = tableToParamItems([
      ["序号", "技术参数及要求"],
      ["1", "支持国产数据库"],
      ["2", "并发不少于 5000"],
    ])
    expect(items).toEqual([
      { no: "1", text: "支持国产数据库" },
      { no: "2", text: "并发不少于 5000" },
    ])
  })

  it("⑪ 没有参数列时整行照录（用；连接），不丢列", () => {
    const items = tableToParamItems([
      ["序号", "功能", "指标"],
      ["3", "门诊挂号", "≤3 秒"],
    ])
    expect(items[0]).toEqual({ no: "3", text: "门诊挂号；≤3 秒" })
  })

  it("⑫ 只有表头 / 空行不产出", () => {
    expect(tableToParamItems([["序号", "技术参数"]])).toEqual([])
    expect(tableToParamItems([["序号", "技术参数"], ["", ""]])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// B4 导出（2026-10-22）：采购清单按投标文件格式输出
// ---------------------------------------------------------------------------
import { purchaseListExportRows } from "./tenderTables"

describe("purchaseListExportRows：原表优先，末尾补「投标响应」列", () => {
  it("⑬ 有原表时列与单元格一字不改，只追加响应列", () => {
    const restored = rec("招标.docx", 1, [
      ["序号", "子系统名称", "数量", "单位", "备注"],
      ["1", "患者主索引", "1", "套", "经营要素平台"],
    ])
    const rows = purchaseListExportRows(restored, null)
    expect(rows[0]).toEqual(["序号", "子系统名称", "数量", "单位", "备注", "投标响应"])
    expect(rows[1]).toEqual(["1", "患者主索引", "1", "套", "经营要素平台", "完全响应"])
  })

  it("⑭ 没有原表时用解析行还原的表；都没有返回空数组", () => {
    const parsed = { columns: ["序号", "名称", "数量"], rows: [["1", "x", "1"]] }
    expect(purchaseListExportRows(null, parsed)[1]).toEqual(["1", "x", "1", "完全响应"])
    expect(purchaseListExportRows(null, null)).toEqual([])
  })
})
