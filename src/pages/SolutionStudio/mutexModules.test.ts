import { describe, expect, it } from "vitest"
import { findMutexConflicts, mutexWarningText, parseMutexPartners } from "./mutexModules"

describe("互斥模块提示", () => {
  it("能从说明原文解析互斥对象", () => {
    expect(parseMutexPartners("床位归属于病区，不支持跨病区收治（与全院一张床模块互斥）", "住院床位预约")).toEqual([
      "全院一张床",
    ])
    expect(parseMutexPartners("与”住院床位预约”模块互斥", "全院一张床")).toEqual(["住院床位预约"])
  })

  it("两个都勾选时给出提示，不自动删除", () => {
    const conflicts = findMutexConflicts(["住院床位预约", "全院一张床", "门急诊挂号收费系统"])
    expect(conflicts).toHaveLength(1)
    expect(mutexWarningText(conflicts)).toContain("住院床位预约")
    expect(mutexWarningText(conflicts)).toContain("全院一张床")
    expect(findMutexConflicts(["住院床位预约"])).toEqual([])
  })
})
