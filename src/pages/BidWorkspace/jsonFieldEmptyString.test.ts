// JSON 列「空字符串」事故的回归测试（2026-10-27）
//
// 事故现场：用户打开**已归档**的标书项目，整页白屏，报
//   `proj.bid_chapters.filter is not a function`
//
// 成因：PocketBase 的 JSON 列正常返回已解析的数组；但如果库里存的是**空字符串**
// （本例由批量清空解析产物时写入 `''` 造成），它不是合法 JSON，
// PocketBase 会原样返回字符串。于是 `rec.bid_chapters ?? []` 的兜底**不生效**——
// `??` 只挡 null/undefined，挡不住 `''`——下游 `.filter/.map/.length` 全部抛错。
//
// 为什么归档项目必现：归档页要遍历章节清单做完整性核对，直接对 `bid_chapters`
// 调数组方法，没有中间兜底。
//
// 修法两层：
//   ① 数据层：把库里的 `''` 归一为 `'[]'`（已执行，全库 0 残留）
//   ② 代码层：normalizeRecord 用 asArrayField 统一收口，非数组一律给 []
//
// 本文件只测 ② 的语义（直接导入生产实现）。
// 注意：这里**不能**写死源码路径去读 useBidWorkspace.ts——本仓有源码哨兵
// （hookSourcesConvergence.test.ts）禁止散落硬编码 hook 路径，搬簇会漏。
import { describe, expect, it } from "vitest"
import { asArrayField } from "./useBidWorkspace"

describe("asArrayField · JSON 列空串兜底（2026-10-27 归档页白屏事故）", () => {
  it("空字符串归一为 []（这就是事故值，?? 挡不住它）", () => {
    expect(asArrayField<number>("")).toEqual([])
    expect(asArrayField<number>("   ")).toEqual([])
  })

  it("null / undefined / 脏值 / 非数组一律归一为 []", () => {
    expect(asArrayField<number>(null)).toEqual([])
    expect(asArrayField<number>(undefined)).toEqual([])
    expect(asArrayField<number>("not json")).toEqual([])
    expect(asArrayField<number>({})).toEqual([])
    expect(asArrayField<number>(0)).toEqual([])
    expect(asArrayField<number>(false)).toEqual([])
  })

  it("字符串形式的数组能正确解析", () => {
    expect(asArrayField<number>("[]")).toEqual([])
    expect(asArrayField<{ a: number }>('[{"a":1}]')).toEqual([{ a: 1 }])
  })

  it("已是数组时原样返回（不复制、不改引用）", () => {
    const arr = [{ a: 1 }]
    expect(asArrayField(arr)).toBe(arr)
    expect(asArrayField([])).toEqual([])
  })
})
