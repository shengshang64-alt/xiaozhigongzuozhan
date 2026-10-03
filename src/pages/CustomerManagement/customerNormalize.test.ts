import { describe, expect, it } from "vitest"
import { normalizeRegion, normalizeHospitalLevel, isTestCustomer } from "./customerNormalize"

describe("normalizeRegion · 地区归一（R57/F13）", () => {
  it("库内真实垃圾值归一：市级组合剥到省、非地区值返回空", () => {
    expect(normalizeRegion("安徽省合肥市")).toBe("安徽")
    expect(normalizeRegion("福建省")).toBe("福建")
    expect(normalizeRegion("福建")).toBe("福建")
    expect(normalizeRegion("华东")).toBe("华东")
    expect(normalizeRegion("部门")).toBe("")
    expect(normalizeRegion("")).toBe("")
    expect(normalizeRegion(null)).toBe("")
  })

  it("防误命中：短名开头但余下不是行政后缀的值不归一", () => {
    expect(normalizeRegion("山东黄金集团")).toBe("")
  })

  it("自治区全称兜底", () => {
    expect(normalizeRegion("内蒙古自治区")).toBe("内蒙古")
    expect(normalizeRegion("广西壮族自治区")).toBe("广西")
  })
})

describe("normalizeHospitalLevel · 等级归一（R57/F14）", () => {
  it("库内混用简称归全称", () => {
    expect(normalizeHospitalLevel("三甲")).toBe("三级甲等")
    expect(normalizeHospitalLevel("三级甲等")).toBe("三级甲等")
    expect(normalizeHospitalLevel("二甲")).toBe("二级甲等")
    expect(normalizeHospitalLevel("三乙")).toBe("三级乙等")
    expect(normalizeHospitalLevel("二乙")).toBe("二级乙等")
  })

  it("识别不了的值原样保留（不造数据）", () => {
    expect(normalizeHospitalLevel("三级")).toBe("三级")
    expect(normalizeHospitalLevel("县区")).toBe("县区")
    expect(normalizeHospitalLevel("")).toBe("")
  })
})

describe("isTestCustomer · 演示模式清场判定（T7，2026-09-27）", () => {
  it("名称含「测试」判定为测试数据", () => {
    expect(isTestCustomer("测试市人民医院")).toBe(true)
    expect(isTestCustomer("ZZ临时验证客户0927（测试）")).toBe(true)
  })
  it("正常医院名不受影响（含「测」单字或「实验」不算）", () => {
    expect(isTestCustomer("三明市第一医院")).toBe(false)
    expect(isTestCustomer("福建医科大学附属第一医院滨海院区")).toBe(false)
  })
  it("空值安全", () => {
    expect(isTestCustomer("")).toBe(false)
    expect(isTestCustomer(null)).toBe(false)
    expect(isTestCustomer(undefined)).toBe(false)
  })
})
