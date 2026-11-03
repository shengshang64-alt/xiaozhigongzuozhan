// Author: loop-R184
// 人民币大写三件套单测：生成 / 解析（含与生成的往返恒等）/ 金额大小写一致性扫描。
import { describe, expect, it } from "vitest"

import { cnyToUpper, parseCnyUpper, scanAmountMismatches } from "./currencyCn"

describe("cnyToUpper 大写生成", () => {
  it("整数含万/亿分节与整", () => {
    expect(cnyToUpper(40000000)).toBe("肆仟万元整")
    expect(cnyToUpper(100000000)).toBe("壹亿元整")
    expect(cnyToUpper(2000000000000)).toBe("贰万亿元整")
    expect(cnyToUpper(1)).toBe("壹元整")
    expect(cnyToUpper(10)).toBe("壹拾元整")
  })
  it("内部零与跨节零", () => {
    expect(cnyToUpper(105)).toBe("壹佰零伍元整")
    expect(cnyToUpper(1005)).toBe("壹仟零伍元整")
    expect(cnyToUpper(1050)).toBe("壹仟零伍拾元整")
    expect(cnyToUpper(100000100)).toBe("壹亿零壹佰元整")
    expect(cnyToUpper(101000000)).toBe("壹亿零壹佰万元整")
  })
  it("角分与不足一元", () => {
    expect(cnyToUpper(1234.56)).toBe("壹仟贰佰叁拾肆元伍角陆分")
    expect(cnyToUpper(100.05)).toBe("壹佰元零伍分")
    expect(cnyToUpper(1.1)).toBe("壹元壹角")
    expect(cnyToUpper(0.5)).toBe("伍角")
    expect(cnyToUpper(0.05)).toBe("伍分")
    expect(cnyToUpper(0.56)).toBe("伍角陆分")
  })
  it("零、负、四舍五入、非法", () => {
    expect(cnyToUpper(0)).toBe("零元整")
    expect(cnyToUpper(-8.8)).toBe("负捌元捌角")
    expect(cnyToUpper(1.01)).toBe("壹元零壹分")
    expect(cnyToUpper(2.5)).toBe("贰元伍角")
    expect(cnyToUpper(Number.NaN)).toBe("")
    expect(cnyToUpper(Number.POSITIVE_INFINITY)).toBe("")
  })
  it("prefixRmb 口径（负号在前）", () => {
    expect(cnyToUpper(1000, { prefixRmb: true })).toBe("人民币壹仟元整")
    expect(cnyToUpper(-1000, { prefixRmb: true })).toBe("负人民币壹仟元整")
  })
})

describe("parseCnyUpper 大写解析", () => {
  it("标准串解析", () => {
    expect(parseCnyUpper("肆仟万元整")).toBe(40000000)
    expect(parseCnyUpper("壹仟贰佰叁拾肆元伍角陆分")).toBe(1234.56)
    expect(parseCnyUpper("人民币壹佰元零伍分")).toBe(100.05)
    expect(parseCnyUpper("贰万亿元整")).toBe(2000000000000)
    expect(parseCnyUpper("壹亿零壹佰万元整")).toBe(101000000)
    expect(parseCnyUpper("负捌元捌角")).toBe(-8.8)
    expect(parseCnyUpper("拾伍元")).toBe(15)
  })
  it("往返恒等：parse(cnyToUpper(v)) === round2(v)", () => {
    const vals = [0, 1, 10, 105, 1005, 1050, 1234.56, 40000000, 100000100, 101000000, 0.05, 0.5, 100.05, 1.1, 999999999.99, 2000000000000]
    for (const v of vals) {
      expect(parseCnyUpper(cnyToUpper(v))).toBeCloseTo(v, 2)
    }
  })
  it("非法/碎片返回 null", () => {
    expect(parseCnyUpper("")).toBeNull()
    expect(parseCnyUpper("万元")).toBeNull()
    expect(parseCnyUpper("拾")).toBeNull()
    expect(parseCnyUpper("ABC元")).toBeNull()
    expect(parseCnyUpper("壹佰块钱")).toBeNull()
    expect(parseCnyUpper(null)).toBeNull()
  })
})

describe("scanAmountMismatches 金额大小写一致性", () => {
  // R187 真实标书语料复验暴露的两处精度问题：小写前缀分支吞掉单位、间隔串可见
  it("R187 回归锁：「人民币1万元」不被拆成小写「人民币1」+ 大写碎片「万元」", () => {
    expect(scanAmountMismatches("合同金额为人民币1万元，含税交付")).toEqual([])
    expect(scanAmountMismatches("服务费人民币3.5万元整")).toEqual([])
    expect(scanAmountMismatches("人民币壹万元整（人民币1万元）")).toEqual([])
  })

  it("R187 sep：相邻重述的间隔串被记录，跨行相邻可在上层甄别", () => {
    const same = scanAmountMismatches("总价：人民币壹佰万元整（¥40,000,000）")
    expect(same[0].sep).not.toContain("\n")
    const cross = scanAmountMismatches("金额（单位：万元）\n¥670.00")
    expect(cross[0]?.sep).toContain("\n")
  })

  it("一致：无问题", () => {
    expect(scanAmountMismatches("预算金额：人民币肆仟万元整（¥40,000,000）")).toEqual([])
    expect(scanAmountMismatches("投标报价 4000万元（人民币肆仟万元整）")).toEqual([])
  })
  it("不一致：命中一条 mismatch 并给偏差", () => {
    const r = scanAmountMismatches("总价：人民币壹佰万元整（¥40,000,000）")
    expect(r.length).toBe(1)
    expect(r[0].kind).toBe("mismatch")
    expect(r[0].upperValue).toBe(1000000)
    expect(r[0].arabicValue).toBe(40000000)
    expect(r[0].diffRatio).toBeGreaterThan(0)
  })
  it("角分不一致也命中", () => {
    const r = scanAmountMismatches("金额壹仟贰佰叁拾肆元伍角陆分（¥1234.50）")
    expect(r.length).toBe(1)
    expect(r[0].kind).toBe("mismatch")
  })
  it("语义不同的相邻金额不误配（间隔含被排除汉字）", () => {
    expect(scanAmountMismatches("总投资1亿元（含贰仟万元不可预见费）")).toEqual([])
  })
  it("小写带万/亿单位不产生幻影大写", () => {
    expect(scanAmountMismatches("报价 3亿元（人民币叁亿元整）")).toEqual([])
  })
  it("未填写金额占位（大写碎片）：命中 malformed", () => {
    const r = scanAmountMismatches("金额为万元整，请补全")
    expect(r.length).toBe(1)
    expect(r[0].kind).toBe("malformed")
  })
  it("无金额/无相邻小写：空", () => {
    expect(scanAmountMismatches("")).toEqual([])
    expect(scanAmountMismatches("本章描述系统架构与功能模块。")).toEqual([])
    expect(scanAmountMismatches("仅需大写壹仟万元整，无对应小写重述。")).toEqual([])
  })
  it("多处命中按出现顺序返回", () => {
    const r = scanAmountMismatches("甲：贰佰万元（¥200,000）；乙：叁佰万元（¥300,000,000）")
    expect(r.length).toBe(2)
    expect(r[0].upperRaw).toContain("贰佰万")
  })
})
