// 问题1 配套:正文分析态批注清洗单测
import { describe, expect, it } from "vitest"
import { sanitizeChapterText, stripAuditAnnotations, clauseToNodeTitle } from "./bidTypes"

describe("stripAuditAnnotations（正文分析态批注清洗）", () => {
  it("剥（原文事实，出自招标文件…）", () => {
    expect(
      stripAuditAnnotations("费用由中标人包干承担（原文事实，出自招标文件交付范围条款）。"),
    ).toBe("费用由中标人包干承担。")
  })
  it("剥（响应 c14、c15）内部编号", () => {
    expect(stripAuditAnnotations("22.3 测试配合、整改机制与符合性判定（响应 c14、c15）")).toBe(
      "22.3 测试配合、整改机制与符合性判定",
    )
  })
  it("整理归纳/原文未提及 也剥", () => {
    expect(stripAuditAnnotations("该机制可复用（整理归纳）于其他院区")).toBe("该机制可复用于其他院区")
    expect(stripAuditAnnotations("具体品牌型号（原文未提及）待确认")).toBe("具体品牌型号待确认")
  })
  it("不误伤普通圆括号正文与【待填写】占位", () => {
    const s = "至少包含17类数据集,证书编号为【待填写】（含脱敏维护）。"
    expect(stripAuditAnnotations(s)).toBe(s)
  })
  it("剥含一层嵌套括号的出处引用", () => {
    expect(
      stripAuditAnnotations("针对评审要点（出处：第四章评标标准 技术项（F2×A2）），本节展开。"),
    ).toBe("针对评审要点，本节展开。")
  })
  it("无 marker 的普通嵌套括号不误伤", () => {
    const s = "系统支持多种协议（如 http、webservice（含 websocket）等）。"
    expect(stripAuditAnnotations(s)).toBe(s)
  })
  it("sanitizeChapterText 落库前即净（集成）", () => {
    const r = sanitizeChapterText(
      "接口联调经采购人确认（原文事实，出自招标文件验收要求期次1）后方可申请初验。",
    )
    expect(r).not.toContain("原文事实")
    expect(r).toContain("后方可申请初验")
  })
})

describe("clauseToNodeTitle（R285 大纲落点标题去截断）", () => {
  // 悬空虚词收尾判定：修好的标题绝不该以这些虚词结束
  const dangling = /[的地得在之与及和等或将要应须需为把被但从该其此由于并且]$/
  const samples = [
    "质保期满后系统的维修保养服务内容投标人在投标文件中应明确",
    "所有系统均需通过信创符合性测试，并提供第三方检测报告",
    "故障响应方式、响应时间须满足招标文件要求",
    "根据当地网络安全主管部门规定完成等保测评",
    "培训对象分为普通业务操作员、系统管理员与运维人员",
  ]
  it("样本标题均 ≤18 字且不以悬空虚词收尾", () => {
    for (const s of samples) {
      const r = clauseToNodeTitle(s)
      expect(r.length).toBeLessThanOrEqual(18)
      expect(dangling.test(r)).toBe(false)
    }
  })
  it("顿号并列取首项即达意", () => {
    expect(clauseToNodeTitle("故障响应方式、响应时间")).toBe("故障响应方式")
  })
  it("句首引导词剥离且保留核心语义", () => {
    expect(clauseToNodeTitle("必须提供7×24小时运维保障")).toContain("提供")
    expect(clauseToNodeTitle("保证系统安全稳定运行")).toContain("系统")
  })
  it("超长无标点句回缩到连接词边界而非硬切句中", () => {
    expect(clauseToNodeTitle("质保期满后系统的维修保养服务内容投标人在投标文件中应明确")).toBe("质保期满后系统")
  })
})
