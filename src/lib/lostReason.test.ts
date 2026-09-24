import { describe, expect, it } from "vitest"
import { LOST_REASON_CODES, formatLostReason, lostReasonCategory, splitLostReason } from "./lostReason"

// R29（test-net-01）：失单原因结构化共享模块的行为锈死网
// 锁死点：与投标侧 R012 的「【类别】明细」存储契约、旧自由文本数据的兼容回退
describe("lostReason", () => {
  it("类别清单与投标侧约定一致（6 类）", () => {
    expect(LOST_REASON_CODES).toEqual(["价格因素", "技术方案", "资质业绩", "商务条款", "客户关系", "其他"])
  })

  describe("splitLostReason", () => {
    it("拆「【类别】明细」", () => {
      expect(splitLostReason("【价格因素】价格分落后 8%")).toEqual({ code: "价格因素", detail: "价格分落后 8%" })
    })
    it("仅类别无明细", () => {
      expect(splitLostReason("【其他】")).toEqual({ code: "其他", detail: "" })
    })
    it("无前缀旧数据：未分类 + 原文进明细", () => {
      expect(splitLostReason("预算取消")).toEqual({ code: "", detail: "预算取消" })
    })
    it("明细内含换行不丢失（跨行捕获语义）", () => {
      expect(splitLostReason("【价格因素】一线\n留二行")).toEqual({ code: "价格因素", detail: "一线\n留二行" })
    })
    it("空串/undefined 安全", () => {
      expect(splitLostReason("")).toEqual({ code: "", detail: "" })
      expect(splitLostReason(undefined as unknown as string)).toEqual({ code: "", detail: "" })
    })
    it("非前缀位置的【】不误拆", () => {
      expect(splitLostReason("友商【低价】冲击")).toEqual({ code: "", detail: "友商【低价】冲击" })
    })
  })

  describe("formatLostReason", () => {
    it("类别+明细 → 【类别】明细（与 split 互逆）", () => {
      const { code, detail } = splitLostReason(formatLostReason("技术方案", "参数响应差"))
      expect({ code, detail }).toEqual({ code: "技术方案", detail: "参数响应差" })
    })
    it("仅类别", () => {
      expect(formatLostReason("客户关系", "")).toBe("【客户关系】")
    })
    it("无类别时明细原样（trim 后）", () => {
      expect(formatLostReason("", "  预算取消  ")).toBe("预算取消")
    })
    it("双空 → 空串（可被选填守卫拦截）", () => {
      expect(formatLostReason("", "")).toBe("")
    })
  })

  describe("lostReasonCategory（聚合口径）", () => {
    it("命中前缀取类别", () => {
      expect(lostReasonCategory("【商务条款】保证金要求高")).toBe("商务条款")
    })
    it("无前缀回退原文（与首页复盘卡 coded 正则对齐）", () => {
      expect(lostReasonCategory("竞品低价中标")).toBe("竞品低价中标")
    })
    it("空值回退 fallback", () => {
      expect(lostReasonCategory("")).toBe("未填写原因")
      expect(lostReasonCategory("   ", "缺")).toBe("缺")
    })
  })
})
