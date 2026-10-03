import { describe, expect, it } from "vitest"

import { cleanParseSectionContent } from "./bidTypes"

// T11（2026-09-28）：PARSE_UNCLEAR_RE 子串误杀长评分行的回归防护
describe("cleanParseSectionContent 未明确归并·T11 防误杀", () => {
  it("含「未提供方案的，不得分」的长评分标准行整行保留，不进汇总", () => {
    const line =
      "总体技术解决方案（5分）：评分标准：1. 对项目现状、痛点、需求及难点理解精准透彻，应对思路科学可落地，得5分；2. 理解较到位，得3分；3. 一般，得1分；4.未提供方案的，不得分。（出处：2.4.2）"
    const out = cleanParseSectionContent(line)
    expect(out).toContain("总体技术解决方案（5分）")
    expect(out).toContain("4.未提供方案的，不得分")
    expect(out).not.toContain("原文未提及")
  })

  it("短占位行仍按缺失归并进「原文未提及」汇总（原设计意图保留）", () => {
    const out = cleanParseSectionContent("质保期：未明确\n预算金额：原文未提及\n项目名称：某医院HIS建设项目")
    expect(out).toContain("项目名称：某医院HIS建设项目")
    expect(out).not.toContain("质保期：未明确")
    expect(out).toContain("原文未提及：质保期、预算金额")
  })

  it("字段名侧说明行（值是顿号枚举清单）仍拆开归并", () => {
    const out = cleanParseSectionContent("未提及事项：培训方案、应急方案\n评标方法：综合评分法")
    expect(out).toContain("原文未提及：培训方案、应急方案")
    expect(out).toContain("评标方法：综合评分法")
  })

  it("清洗幂等：已收敛内容再过一次输出不变", () => {
    const src = "质保期：未明确\n技术方案：评分标准：1. 方案完整得5分；2.未提供方案的，不得分。\n预算：500万元"
    const once = cleanParseSectionContent(src)
    expect(cleanParseSectionContent(once)).toBe(once)
  })
})

// T13（2026-09-28 用户反馈轮）：评分构成行本地硬校验——分部之和 ≠ 总分的构成行整行删除
describe("cleanParseSectionContent 评分构成行校验·T13", () => {
  it("分部之和等于总分的构成行保留（中西医结合形态：70+30=100）", () => {
    const out = cleanParseSectionContent(
      "评分构成：总分 100 分（技术资信 70 分、价格 30 分）\n系统架构（10 分）：微服务架构得 8-10 分",
    )
    expect(out).toContain("评分构成：总分 100 分（技术资信 70 分、价格 30 分）")
  })

  it("分部之和与总分对不上的构成行删除（安庆实锤：53+47+30=130≠100）", () => {
    const out = cleanParseSectionContent(
      "评分构成：总分 100 分（技术 53 分、商务 47 分、价格 30 分）\n投标价格分（30 分）：（评标基准价/投标报价）×30",
    )
    expect(out).not.toContain("评分构成")
    expect(out).toContain("投标价格分（30 分）")
  })

  it("原文只声明总分无分部、或未声明总分的行无法机械判定，保留", () => {
    const onlyTotal = cleanParseSectionContent("评分构成：总分 100 分\n系统架构（10 分）：略")
    expect(onlyTotal).toContain("评分构成：总分 100 分")
    const noTotal = cleanParseSectionContent("评分构成：技术 53 分、商务 47 分\n系统架构（10 分）：略")
    expect(noTotal).toContain("评分构成：技术 53 分、商务 47 分")
  })
})
