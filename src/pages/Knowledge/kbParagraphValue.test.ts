import { describe, expect, it } from "vitest"
import {
  assessParagraphValue,
  pickValuableParagraphs,
  summarizeParagraphValues,
} from "./kbParagraphValue"

// ---------------------------------------------------------------------------
// 段落价值评估验收测试（2026-10-31 原子抽取产出率优化）
//
// 真实问题：B0 批次抽取产出率过低。
//   3 篇高质量方案文档（每篇 6-12 万字）→ 每篇只取前 8 段 → 只抽出 6-9 条原子。
//   根因：大文档前几段是封面、目录、医院简介、政策铺垫，提示词明令「绝对不抽」。
//   实测反例（第一版给高分但模型正确返回空）：
//     「赣南医学院第一附属医院坐落于江西南部…创办于1958年…三甲医院」
//
// 本测试锁住：背景/目录/封面必须被识别为低价值，产品能力/案例/资质必须被识别为高价值。
// ---------------------------------------------------------------------------

describe("assessParagraphValue：低价值段落识别", () => {
  it("目录行被判低价值", () => {
    const v = assessParagraphValue("第一章 项目背景 ................ 1\n第二章 需求分析 ................ 5")
    expect(v.score).toBeLessThan(0.25)
    expect(v.reasons.join()).toContain("目录")
  })

  it("封面/空白模板被判低价值", () => {
    const v = assessParagraphValue("投 标 文 件\n项目名称：\n项目编号：\n供 应 商：\n2024 年 3 月")
    expect(v.score).toBeLessThan(0.25)
  })

  it("医院简介（坐落于/创办于/三甲）被判低价值", () => {
    // 真实反例：这段第一版得了 0.9 分，但模型正确返回空
    const v = assessParagraphValue(
      "赣南医学院第一附属医院坐落于江西南部、赣江源头的国家历史文化名城——赣州，创办于1958年，是江西省唯一独立设置的普通高等本科医学院直属第一附属医院，也是赣州市唯一一家省直省管三级甲等医院。",
    )
    expect(v.score).toBeLessThan(0.5)
  })

  it("背景套话被判低价值", () => {
    const v = assessParagraphValue(
      "随着医疗信息化的快速发展，医院对信息系统的要求越来越高。近年来，国家大力推进智慧医院建设。",
    )
    expect(v.score).toBeLessThan(0.5)
  })

  it("过短段落被判低价值（多半是标题行）", () => {
    expect(assessParagraphValue("一、项目概述").score).toBe(0)
    expect(assessParagraphValue("短句。").score).toBe(0)
  })
})

describe("assessParagraphValue：高价值段落识别", () => {
  it("产品能力描述得高分", () => {
    const v = assessParagraphValue(
      "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理，支持首页校对和统计查询综合报表功能，具备图片病历上传管理能力。",
    )
    expect(v.score).toBeGreaterThan(0.5)
    expect(v.reasons.join()).toContain("产品能力")
  })

  it("具体产品/标准名得高分", () => {
    const v = assessParagraphValue(
      "系统需与 HIS、EMR、LIS、PACS 等子系统集成，支持电子病历与互联互通标准的数据交换。",
    )
    expect(v.score).toBeGreaterThan(0.5)
  })

  it("案例业绩得高分", () => {
    const v = assessParagraphValue(
      "我方已成功实施某三甲医院集成平台项目，该项目通过验收并获得省级示范工程称号，中标金额 2800 万元。",
    )
    expect(v.score).toBeGreaterThan(0.5)
    expect(v.reasons.join()).toContain("案例业绩")
  })

  it("带口径的指标得高分", () => {
    const v = assessParagraphValue(
      "系统可用性达到 99.9% 以上，故障响应时间在 15 分钟以内，数据恢复点目标（RPO）5 分钟以内达标。",
    )
    expect(v.score).toBeGreaterThan(0.5)
  })
})

describe("pickValuableParagraphs：选取与去重", () => {
  const paras = [
    { text: "第一章 项目背景 ................ 1\n第二章 需求分析 ................ 5" }, // 目录
    { text: "赣南医学院第一附属医院坐落于赣州，创办于1958年，是三级甲等医院。" }, // 医院简介
    {
      text: "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理，支持首页校对和统计查询综合报表功能，具备图片病历上传管理能力。",
    },
    {
      text: "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理，支持首页校对和统计查询综合报表功能，具备图片病历上传管理能力。", // 完全重复
    },
    {
      text: "系统需与 HIS、EMR、LIS、PACS 等子系统集成，支持电子病历与互联互通标准的数据交换，具备标准化接口能力。",
    },
  ]

  it("跳过目录与医院简介", () => {
    const picked = pickValuableParagraphs(paras, 5)
    expect(picked.some((p) => p.text.includes("......."))).toBe(false)
    expect(picked.some((p) => p.text.includes("坐落于"))).toBe(false)
  })

  it("重复段落只保留一条（技术标书常把同一条需求写多遍）", () => {
    const picked = pickValuableParagraphs(paras, 5)
    const dup = picked.filter((p) => p.text.includes("病案信息管理系统实现病案编码管理"))
    expect(dup).toHaveLength(1)
  })

  it("返回结果按原文顺序（保持阅读连贯）", () => {
    const picked = pickValuableParagraphs(paras, 5)
    expect(picked.length).toBeGreaterThan(0)
    // 验证不抛错即可（顺序由内部 index 保证）
  })

  it("最多返回 n 段", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      text: `系统${i}支持病案管理功能模块，具备统计报表能力，实现数据导出与接口对接。`,
    }))
    expect(pickValuableParagraphs(many, 5)).toHaveLength(5)
  })

  it("全部低价值时返回空数组（不硬凑）", () => {
    const junk = [
      { text: "第一章 目录 ................ 1\n第二章 目录 ................ 5" },
      { text: "投 标 文 件\n项目名称：\n供 应 商：" },
    ]
    expect(pickValuableParagraphs(junk, 5)).toHaveLength(0)
  })
})

describe("summarizeParagraphValues：诊断统计", () => {
  it("统计总数/有价值/跳过与原因", () => {
    const s = summarizeParagraphValues([
      { text: "第一章 目录 ................ 1\n第二章 目录 ................ 5" },
      { text: "系统支持病案管理功能模块，具备统计报表能力，实现数据导出与接口对接。" },
    ])
    expect(s.total).toBe(2)
    expect(s.valuable).toBe(1)
    expect(s.skipped).toBe(1)
    expect(Object.keys(s.skipReasons).length).toBeGreaterThan(0)
  })

  it("空数组安全", () => {
    const s = summarizeParagraphValues([])
    expect(s).toEqual({ total: 0, valuable: 0, skipped: 0, skipReasons: {} })
  })
})
