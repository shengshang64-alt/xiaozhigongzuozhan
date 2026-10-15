import { describe, expect, it } from "vitest"
import {
  COMPANY_REDLINE_RULES,
  OUTDATED_TERMS,
  checkScoringCompliance,
  checkSubBidScore,
  findCompanyRedlineHits,
  findOutdatedTerms,
  findProjectResidue,
} from "./bidComplianceRules"

// 部门基础要求的本地判定网（来源：三份检查清单 + 售前工作规范，2026-10-15 精读后落地）。
// 断的都是"机械可判"的项：公司红线措辞、评分合规阈值、术语旧称、其他项目残留。

const LINES = (...ls: string[]) => ls.join("\n")

describe("公司红线条款库（招标书检查清单原文口径）", () => {
  it("无首款 / 首款不足 30% 命中", () => {
    const hits = findCompanyRedlineHits(LINES("付款方式：无首款，验收后支付", "首款 20%，其余按进度支付"))
    expect(hits.filter((h) => h.rule.includes("首款")).length).toBe(2)
    expect(hits[0].severity).toBe("redline")
  })

  it("售后/质保超过 1 年命中，1 年以内不误报", () => {
    expect(findCompanyRedlineHits("免费质保期 3 年").some((h) => h.rule.includes("售后"))).toBe(true)
    expect(findCompanyRedlineHits("免费质保期 1 年").some((h) => h.rule.includes("售后"))).toBe(false)
  })

  it("源代码 / 知识产权归业主命中", () => {
    const hits = findCompanyRedlineHits(LINES("中标人须提供全部源代码", "项目知识产权归采购人所有"))
    expect(hits.filter((h) => h.rule.includes("源代码")).length).toBe(2)
  })

  it("免费升级只给警告并要求核对「同版本内」", () => {
    const hits = findCompanyRedlineHits("承诺免费升级")
    const h = hits.find((x) => x.rule.includes("免费升级"))
    expect(h?.severity).toBe("warn")
    expect(h?.note).toContain("同版本内")
  })

  it("验收绑评级 / 履约保证金 / 工期矛盾各按清单口径命中", () => {
    expect(findCompanyRedlineHits("验收结果与评级挂钩后方可付款").some((h) => h.rule.includes("评级"))).toBe(true)
    expect(findCompanyRedlineHits("须提交履约保函").some((h) => h.rule.includes("保函"))).toBe(true)
    expect(findCompanyRedlineHits("交货期 30 天，交货条件：验收后交货").some((h) => h.rule.includes("工期"))).toBe(true)
  })

  it("干净文本零命中（不制造噪声）", () => {
    expect(findCompanyRedlineHits("首款 30%，质保 1 年，按季度支付")).toEqual([])
  })

  it("规则表自身自洽：每条都有 key/标签/处置说明", () => {
    for (const r of COMPANY_REDLINE_RULES) {
      expect(r.key.length).toBeGreaterThan(0)
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.note.length).toBeGreaterThan(6)
    }
  })
})

describe("评分合规校验（清单「其他项」原文口径）", () => {
  it("单项超 3 分、证书超 1 分、测试报告超 3 分分别命中", () => {
    const issues = checkScoringCompliance([
      { item: "总体技术方案", score: 5, category: "tech" },
      { item: "ISO27001 认证证书", score: 2, category: "tech" },
      { item: "第三方测试报告", score: 4, category: "tech" },
    ])
    const keys = issues.map((i) => i.key)
    expect(keys).toContain("cap_single")
    expect(keys).toContain("cap_cert")
    expect(keys).toContain("cap_report")
    // R56 分级：3~5 分超限属行业常见设置，按「提示」报（该组数据最高 5 分，故无红线）
    expect(issues.filter((i) => i.key.startsWith("cap_")).every((i) => i.level === "warn")).toBe(true)
  })

  it("R56 分级：超过上限但未到 8 分按提示报，≥8 分才判红线且必须写明「须销售确认」", () => {
    const warn = checkScoringCompliance([{ item: "总体技术方案", score: 7, category: "tech" }])
    expect(warn.find((i) => i.key === "cap_single")?.level).toBe("warn")
    const red = checkScoringCompliance([{ item: "总体技术方案", score: 8, category: "tech" }])
    const hit = red.find((i) => i.key === "cap_single")
    expect(hit?.level).toBe("redline")
    expect(hit?.message).toContain("销售确认")
  })

  it("刚好卡在上限时不报（3/1/3 分）", () => {
    expect(
      checkScoringCompliance([
        { item: "单项", score: 3, category: "tech" },
        { item: "资质证书", score: 1, category: "tech" },
        { item: "检测报告", score: 3, category: "tech" },
      ]).filter((i) => i.key.startsWith("cap_")),
    ).toEqual([])
  })

  it("技术分占比超 50% 给警告", () => {
    const issues = checkScoringCompliance([
      { item: "技术一", score: 60, category: "tech" },
      { item: "商务一", score: 30, category: "biz" },
      { item: "报价", score: 10, category: "biz" },
    ])
    expect(issues.some((i) => i.key === "tech_share")).toBe(true)
  })

  it("副标得分率低于 50% 判红线（清单口径：防止废标）", () => {
    expect(checkSubBidScore({ subBidScorePercent: 42 })?.level).toBe("redline")
    expect(checkSubBidScore({ subBidScorePercent: 60 })).toBeNull()
    expect(checkSubBidScore({})).toBeNull()
  })
})

describe("术语旧称库（解决方案/投标文件检查清单原文举例）", () => {
  it("卫生计生委 / 人口健康信息平台 / 3G、4G 都给出替换建议", () => {
    const hits = findOutdatedTerms(LINES("对接卫生计生委平台", "人口健康信息平台已建成", "支持 3G、4G 网络"))
    const terms = hits.map((h) => h.term)
    expect(terms).toContain("卫生计生委")
    expect(terms).toContain("人口健康信息平台")
    expect(hits.find((h) => h.term.includes("3G"))?.suggestion).toContain("5G")
  })

  it("现称不误报", () => {
    expect(findOutdatedTerms("对接卫生健康委员会平台，采用 5G 网络")).toEqual([])
    expect(OUTDATED_TERMS.length).toBeGreaterThanOrEqual(4)
  })
})

describe("其他项目残留扫描（跨项目低级错误）", () => {
  it("别的医院名与别的项目编号都能抓到，并排除本项目自有名称", () => {
    const text = LINES("本项目采购人：XX市第一人民医院（编号 HXZB2026-0912）", "参见 YY市人民医院项目 的实施方案（编号 ZZ2025-0007）")
    const hits = findProjectResidue(text, {
      hospitals: ["XX市第一人民医院"],
      tenderNos: ["HXZB2026-0912"],
    })
    const values = hits.map((h) => h.value)
    expect(values).toContain("YY市人民医院")
    expect(values).toContain("ZZ2025-0007")
    expect(values).not.toContain("XX市第一人民医院")
    expect(values).not.toContain("HXZB2026-0912")
  })

  it("同一项目内引用自己的编号与医院名不报（避免噪声）", () => {
    expect(
      findProjectResidue("XX市第一人民医院（HXZB2026-0912）技术方案", {
        hospitals: ["XX市第一人民医院"],
        tenderNos: ["HXZB2026-0912"],
      }),
    ).toEqual([])
  })
})
