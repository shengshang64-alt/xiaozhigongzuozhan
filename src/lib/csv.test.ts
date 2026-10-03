import { describe, expect, it } from "vitest"
import { buildCsv } from "./csv"

describe("buildCsv · 共享 CSV 拼装口径", () => {
  it("含逗号/引号/换行的单元格被双引号包裹并转义内部引号", () => {
    const csv = buildCsv(["名称", "备注"], [["智业软件,有限公司", '他说"好"'], ["含\n换行", "普通"]])
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n")
    expect(lines[0]).toBe("名称,备注")
    expect(lines[1]).toBe('"智业软件,有限公司","他说""好"""')
    expect(csv).toContain('"含\n换行"')
  })
  it("数字/空值/null/undefined 归一无误，纯值不加引号", () => {
    const csv = buildCsv(["a", "b"], [[1, null], [undefined, 0]])
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n")
    expect(lines).toEqual(["a,b", "1,", ",0"])
  })
  it("输出以 UTF-8 BOM 起始、行间 CRLF", () => {
    const csv = buildCsv(["x"], [["y"]])
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv).toBe("\uFEFFx\r\ny")
  })
  it("全角逗号等中文标点不触发转义（仅 ASCII 逗号/引号/换行）", () => {
    const csv = buildCsv(["标题"], [["北京，海淀"]])
    expect(csv).toBe("\uFEFF标题\r\n北京，海淀")
  })
})
describe("buildCsv · 公式注入防护（CWE-1236）", () => {
  it("以 = + - @ 开头的文本单元格加前导单引号，阻断 Excel 公式/DDE 执行", () => {
    const csv = buildCsv(["名称"], [["=1+1"], ["+2"], ["-3"], ["@SUM(A1)"]])
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n")
    expect(lines.slice(1)).toEqual(["'=1+1", "'+2", "'-3", "'@SUM(A1)"])
  })
  it("典型 DDE 载荷 =cmd|' /C calc'!A0 被加前缀，不逃出血格", () => {
    const csv = buildCsv(["备注"], [["=cmd|' /C calc'!A0"]])
    expect(csv).toBe("\uFEFF备注\r\n'=cmd|' /C calc'!A0")
  })
  it("含逗号的注入载荷：既加前导单引号又整体双引号包裹（转义与防注入叠加）", () => {
    const csv = buildCsv(["a"], [["=x,y"]])
    expect(csv).toContain("\"'=x,y\"")
  })
  it("数字类型（含负数）属合法数值，不被前缀劫持", () => {
    const csv = buildCsv(["n"], [[-5], [3.2]])
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n")
    expect(lines.slice(1)).toEqual(["-5", "3.2"])
  })
  it("普通文本与以字母/中文开头的值零改写（无回归）", () => {
    const csv = buildCsv(["名称"], [["智业软件"], ["汇总"]])
    expect(csv).toBe("\uFEFF名称\r\n智业软件\r\n汇总")
  })
})
