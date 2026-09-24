import { describe, expect, it } from "vitest"
import { explainIntelRelevance, isIntelIrrelevant, isIntelRelevant } from "./intelRelevance"

// ---------------------------------------------------------------------------
// 情报相关性镜像词表锈死网（批次 A · 2026-09-23）
//
// pb_hook 里 4 份 medicalRelevant / isIrrelevant 拷贝共用同一份口径，Goja 不能跨文件
// 共享 helper，只能靠前端镜像 + 单测防止未来误伤。本文件的用例锁定：
//   1) 批次 A 新补的厂商品牌 / 评级关键词都能通过强词命中
//   2) 批次 A 从黑名单里摘掉「媒体」二字后，「医疗媒体报道」不再被误杀
//   3) 保留原有跨行业拦截（机械加工 / 航空 / 遥感等）
// ---------------------------------------------------------------------------

describe("isIntelRelevant · 强词命中（批次 A 扩词回归）", () => {
  it("厂商品牌：新增的和仁/麦迪/万达/久远银海/华为医疗都能命中", () => {
    expect(isIntelRelevant("和仁科技发布新一代临床决策系统")).toBe(true)
    expect(isIntelRelevant("麦迪科技智慧手术部解决方案")).toBe(true)
    expect(isIntelRelevant("万达信息助力上海公立医院数字化转型")).toBe(true)
    expect(isIntelRelevant("久远银海医保信息平台省级项目")).toBe(true)
    expect(isIntelRelevant("华为医疗物联网创新实验室成立")).toBe(true)
  })

  it("评级 / 测评关键词：电子病历评级、互联互通测评、智慧服务分级都能命中", () => {
    expect(isIntelRelevant("2026 年第五批电子病历评级通过医院名单公示")).toBe(true)
    expect(isIntelRelevant("国家医疗健康信息互联互通标准化成熟度测评结果")).toBe(true)
    expect(isIntelRelevant("智慧服务分级评估 3 级医院名单")).toBe(true)
    expect(isIntelRelevant("医院智慧管理分级评估标准发布")).toBe(true)
  })

  it("原有强词不受扩词影响：DRG / 电子病历 / 智慧医院仍然命中", () => {
    expect(isIntelRelevant("DRG 2.0 分组方案调整")).toBe(true)
    expect(isIntelRelevant("电子病历系统应用水平分级评价")).toBe(true)
    expect(isIntelRelevant("智慧医院建设试点公布")).toBe(true)
  })
})

describe("isIntelRelevant · 批次 A 修正：媒体不再误杀", () => {
  it("医疗媒体报道 · 保留（批次 A 前会被黑名单误杀）", () => {
    expect(isIntelRelevant("医疗媒体报道：某三甲医院通过互联互通测评")).toBe(true)
  })

  it("健康类传媒 / 自媒体仍被拦截（新黑名单更精确）", () => {
    // 「传媒」+ 非医疗语境 → 黑名单剔除
    expect(isIntelRelevant("某传媒集团的数字化转型")).toBe(false)
    expect(isIntelRelevant("自媒体行业规范出台")).toBe(false)
  })
})

describe("isIntelRelevant · 跨行业噪声仍拦得住", () => {
  it("机械加工 / 航空 / 遥感 等具体行业黑名单不变", () => {
    expect(isIntelRelevant("机械加工行业数字化转型白皮书")).toBe(false)
    expect(isIntelRelevant("航空公司信息系统建设")).toBe(false)
    expect(isIntelRelevant("遥感技术农业应用")).toBe(false)
  })

  it("以院结尾的非医机构（学院 / 研究院）被拦截", () => {
    // 「学院」在黑名单里，且不含强词/核心医疗词时会被剔除
    expect(isIntelRelevant("某学院信息化建设招标公告")).toBe(false)
  })
})

describe("isIntelRelevant · 边界", () => {
  it("空标题返回 false", () => {
    expect(isIntelRelevant("")).toBe(false)
  })

  it("版权噪声行返回 false", () => {
    expect(isIntelRelevant("版权所有 All Rights Reserved")).toBe(false)
    expect(isIntelRelevant("备案号 xxx 友情链接")).toBe(false)
  })

  it("既非医疗也非跨行业的通用词：走弱信号兜底", () => {
    // 「医院」+「信息化」触发弱信号；单独「数据」不触发
    expect(isIntelRelevant("某医院数据治理项目")).toBe(true) // 医院是核心医疗词，直接 true
    expect(isIntelRelevant("数据要素市场化配置"))
      .toBe(false)
  })
})

describe("isIntelIrrelevant", () => {
  it("与 isIntelRelevant 反向一致", () => {
    const titles = ["电子病历评级名单", "机械加工行业", "医院信息化建设", "某传媒集团"]
    for (const t of titles) {
      expect(isIntelIrrelevant(t)).toBe(!isIntelRelevant(t))
    }
  })
})

describe("explainIntelRelevance", () => {
  it("能定位每条命中的具体理由，供 UI 反馈「为什么被过滤」", () => {
    expect(explainIntelRelevance("和仁科技新品发布")).toEqual({ verdict: "relevant", reason: "strong" })
    expect(explainIntelRelevance("医疗媒体报道")).toEqual({ verdict: "relevant", reason: "core-medical" })
    expect(explainIntelRelevance("航空公司信息系统")).toEqual({ verdict: "irrelevant", reason: "other-industry" })
    expect(explainIntelRelevance("版权所有")).toEqual({ verdict: "irrelevant", reason: "noise" })
    expect(explainIntelRelevance("")).toEqual({ verdict: "irrelevant", reason: "empty" })
    expect(explainIntelRelevance("某医院数据治理")).toEqual({ verdict: "relevant", reason: "core-medical" })
    expect(explainIntelRelevance("完全无关的话题")).toEqual({ verdict: "irrelevant", reason: "no-signal" })
  })
})
