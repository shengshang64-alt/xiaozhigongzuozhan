import { describe, expect, it } from "vitest"
import { paginate, shouldReserveFabClearance, sortRows } from "./dataTableLogic"

interface Row {
  name: string
  beds: number
  region: string | null
}

const rows: Row[] = [
  { name: "丙", beds: 300, region: "华东" },
  { name: "甲", beds: 100, region: null },
  { name: "乙", beds: 200, region: "华北" },
]

describe("sortRows", () => {
  it("无 accessor 返回原顺序的新副本", () => {
    const out = sortRows(rows, undefined, "asc")
    expect(out.map((r) => r.name)).toEqual(["丙", "甲", "乙"])
    expect(out).not.toBe(rows)
  })

  it("数值升序", () => {
    const out = sortRows(rows, (r) => r.beds, "asc")
    expect(out.map((r) => r.beds)).toEqual([100, 200, 300])
  })

  it("数值降序", () => {
    const out = sortRows(rows, (r) => r.beds, "desc")
    expect(out.map((r) => r.beds)).toEqual([300, 200, 100])
  })

  it("字符串升/降序（locale 比较）", () => {
    const src: Row[] = [
      { name: "beta", beds: 1, region: "B" },
      { name: "alpha", beds: 2, region: "A" },
      { name: "gamma", beds: 3, region: "C" },
    ]
    const asc = sortRows(src, (r) => r.name, "asc")
    expect(asc.map((r) => r.name)).toEqual(["alpha", "beta", "gamma"])
    const desc = sortRows(src, (r) => r.name, "desc")
    expect(desc.map((r) => r.name)).toEqual(["gamma", "beta", "alpha"])
  })

  it("空值恒排最后（升/降皆然）", () => {
    const asc = sortRows(rows, (r) => r.region, "asc")
    const desc = sortRows(rows, (r) => r.region, "desc")
    expect(asc[asc.length - 1].region).toBeNull()
    expect(desc[desc.length - 1].region).toBeNull()
  })

  it("相等键保持稳定（原索引兜底）", () => {
    const dup: Row[] = [
      { name: "a", beds: 1, region: "x" },
      { name: "b", beds: 1, region: "y" },
      { name: "c", beds: 1, region: "z" },
    ]
    const out = sortRows(dup, (r) => r.beds, "asc")
    expect(out.map((r) => r.name)).toEqual(["a", "b", "c"])
  })

  it("不修改入参数组", () => {
    const before = rows.map((r) => r.name)
    sortRows(rows, (r) => r.beds, "desc")
    expect(rows.map((r) => r.name)).toEqual(before)
  })
})

describe("paginate", () => {
  const data = Array.from({ length: 25 }, (_, i) => i)

  it("第一页返回前 pageSize 条", () => {
    expect(paginate(data, 1, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("末页返回剩余条", () => {
    expect(paginate(data, 3, 10)).toEqual([20, 21, 22, 23, 24])
  })

  it("越界大页码收敛到最后页", () => {
    expect(paginate(data, 99, 10)).toEqual([20, 21, 22, 23, 24])
  })

  it("页码 <1 收敛到第一页", () => {
    expect(paginate(data, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("pageSize<=0 返回全部", () => {
    expect(paginate(data, 1, 0)).toHaveLength(25)
  })

  it("空数组安全返回空", () => {
    expect(paginate<number>([], 1, 10)).toEqual([])
  })
})

describe("shouldReserveFabClearance", () => {
  it("行数超过 pageSize 时需要避让（触发分页）", () => {
    expect(shouldReserveFabClearance(21, 20)).toBe(true)
  })

  it("行数等于 pageSize 不触发分页、无需避让", () => {
    expect(shouldReserveFabClearance(20, 20)).toBe(false)
  })

  it("pageSize<=0 全量展示、无需避让", () => {
    expect(shouldReserveFabClearance(100, 0)).toBe(false)
  })

  it("空表无需避让", () => {
    expect(shouldReserveFabClearance(0, 20)).toBe(false)
  })
})
