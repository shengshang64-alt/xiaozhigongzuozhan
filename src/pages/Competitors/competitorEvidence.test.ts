import { describe, expect, it } from "vitest"
import type { CopyrightRow } from "./copyrightCore"
import {
  buildCompetitorAliases,
  buildCopyrightFactsFromRows,
  buildCustomerShareFromRows,
  matchVendor,
} from "./competitorEvidence"
import { parseAnalysisResponse } from "./useCompetitorAnalysis"

// ---------------------------------------------------------------------------
// 批次 X1 · 严格内部事实模式回归
// 覆盖：别名匹配 / 软著事实聚合 / CRM 客户占用聚合 / AI 响应 evidence_refs 校验
// ---------------------------------------------------------------------------

function cr(over: Partial<CopyrightRow>): CopyrightRow {
  return {
    company: "",
    name: "",
    short: "",
    version: "",
    swClass: "",
    indClass: "",
    regNo: "",
    regDate: "",
    pubDate: "",
    owner: "",
    ...over,
  }
}

describe("buildCompetitorAliases · 别名生成", () => {
  it("卫宁健康：包含硬编码中英文别名 + legal_name 前缀（去壳后）", () => {
    const aliases = buildCompetitorAliases(
      "卫宁健康",
      "卫宁健康科技集团股份有限公司",
      ["winning", "WiNEX"],
    )
    // 硬编码 5 项至少都在
    for (const a of ["卫宁健康", "卫宁", "winning", "南京卫宁"]) {
      expect(aliases).toContain(a)
    }
    // 用户填的 keywords 被吸收
    expect(aliases).toContain("WiNEX")
    // name 与 legal_name 也在（用于严格匹配）
    expect(aliases).toContain("卫宁健康")
  })

  it("未列入硬编码表的厂商：name + legal_name + 去壳前缀 + keywords 都在", () => {
    const aliases = buildCompetitorAliases("某某新厂", "某某新厂信息技术有限公司", ["ABC"])
    expect(aliases).toContain("某某新厂")
    expect(aliases).toContain("某某新厂信息技术有限公司")
    expect(aliases).toContain("ABC")
    // "信息技术有限公司" 被剥掉后应产生 "某某新厂"（已存在，去重）
    expect(aliases.filter((a) => a === "某某新厂")).toHaveLength(1)
  })
})

describe("matchVendor · 大小写不敏感子串匹配", () => {
  it("英文别名大小写不敏感", () => {
    expect(matchVendor("Winning Health Technology", ["winning"])).toBe(true)
    expect(matchVendor("WINNING", ["winning"])).toBe(true)
  })
  it("中文字面包含", () => {
    expect(matchVendor("南京卫宁软件", ["卫宁"])).toBe(true)
    expect(matchVendor("东华软件", ["卫宁"])).toBe(false)
  })
  it("空 vendor 或短别名（<2 字）不匹配", () => {
    expect(matchVendor("", ["卫宁"])).toBe(false)
    expect(matchVendor("卫宁", [""])).toBe(false)
    expect(matchVendor("卫宁", ["卫"])).toBe(false) // 长度 1 被忽略
  })
})

describe("buildCopyrightFactsFromRows · 别名过滤 + 分类聚合 + 近 2 年", () => {
  const rows: CopyrightRow[] = [
    cr({ company: "卫宁健康", owner: "卫宁健康科技集团股份有限公司", name: "WiNEX 住院系统", swClass: "医疗软件", regNo: "2024SR001", regDate: "2024-05-01" }),
    cr({ company: "卫宁健康", owner: "卫宁健康科技集团股份有限公司", name: "互联网医院", swClass: "医疗软件", regNo: "2026SR100", regDate: "2026-06-15" }),
    cr({ company: "卫宁", owner: "南京卫宁科技", name: "电子病历", swClass: "EMR", regNo: "2020SR999", regDate: "2020-01-01" }),
    cr({ company: "东华医为", owner: "东华医为科技有限公司", name: "其他家", swClass: "医疗软件", regNo: "2026SR500", regDate: "2026-07-01" }),
  ]
  it("按别名过滤命中 3 条（不含东华）", () => {
    const aliases = buildCompetitorAliases("卫宁健康", "卫宁健康科技集团股份有限公司", [])
    const facts = buildCopyrightFactsFromRows(rows, aliases)
    expect(facts.total).toBe(3)
    expect(facts.byClass["医疗软件"]).toBe(2)
    expect(facts.byClass["EMR"]).toBe(1)
    expect(facts.earliest).toBe("2020-01-01")
    expect(facts.latest).toBe("2026-06-15")
  })
  it("近 2 年新增按 regDate 倒序，且只含 ≥ 阈值日期", () => {
    const aliases = buildCompetitorAliases("卫宁健康", "卫宁健康科技集团股份有限公司", [])
    const facts = buildCopyrightFactsFromRows(rows, aliases)
    // 2020-01-01 应该在近 2 年窗口外（今天是 2026 之后）
    const dates = facts.recent2y.map((r) => r.regDate)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(dates.every((d) => d >= "2024-09")).toBe(true) // 相对当前 2026-09 前 2 年
    expect(dates).toContain("2026-06-15")
    expect(dates).not.toContain("2020-01-01")
  })
  it("total=0 时给出降级信息（attemptedAliases 保留）", () => {
    const facts = buildCopyrightFactsFromRows(rows, ["不存在"])
    expect(facts.total).toBe(0)
    expect(facts.attemptedAliases).toEqual(["不存在"])
  })
})

describe("buildCustomerShareFromRows · system_vendors 遍历 + 去重 + 聚合", () => {
  const rows = [
    {
      id: "h1",
      hospital_name: "南京鼓楼医院",
      level: "三甲",
      region: "江苏省南京市",
      system_vendors: [
        { system: "HIS", vendor: "卫宁健康" },
        { system: "EMR", vendor: "卫宁健康电子病历" },
      ],
    },
    {
      id: "h2",
      hospital_name: "苏州大学附属第一医院",
      level: "三甲",
      region: "江苏省苏州市",
      system_vendors: [{ system: "HIS", vendor: "东华医为" }],
    },
    {
      id: "h3",
      hospital_name: "东部战区总医院",
      level: "三甲",
      region: "江苏省南京市",
      system_vendors: [
        { system: "HIS", vendor: "南京卫宁" }, // 应通过别名 "南京卫宁" 命中
        { system: "HRP", vendor: "万达信息" },
      ],
    },
    {
      id: "h1", // 同 hospitalId + 同 system 应被去重
      hospital_name: "南京鼓楼医院",
      level: "三甲",
      region: "江苏省南京市",
      system_vendors: [{ system: "HIS", vendor: "卫宁" }],
    },
  ]
  const aliases = buildCompetitorAliases("卫宁健康", "卫宁健康科技集团股份有限公司", [])
  const share = buildCustomerShareFromRows(rows, aliases)
  it("命中 3 条（h1 HIS, h1 EMR, h3 HIS），东华/万达不计", () => {
    expect(share.occupiedCount).toBe(3)
    expect(share.bySystem["HIS"]).toBe(2)
    expect(share.bySystem["EMR"]).toBe(1)
  })
  it("按区域前 3 字聚合", () => {
    expect(share.byRegion["江苏省"]).toBe(3)
  })
  it("evidenceId 格式：cust:<hospitalId>:<system-slug>", () => {
    const ids = share.occupied.map((o) => o.evidenceId)
    expect(ids).toContain("cust:h1:his")
    expect(ids).toContain("cust:h1:emr")
    expect(ids).toContain("cust:h3:his")
  })
  it("totalHospitalsTracked 反映原始行数", () => {
    expect(share.totalHospitalsTracked).toBe(4)
  })
})

describe("parseAnalysisResponse · evidence_refs 校验与降级", () => {
  it("evidence_refs 缺失 → 降级为 low", () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        updates: [{ field: "products", suggested: "x", reason: "y", confidence: "high" /* 无 evidence_refs */ }],
        threat_level_change: "stable",
        action_items: [],
      }),
    )
    expect(r?.updates[0].confidence).toBe("low")
    expect(r?.updates[0].evidence_refs).toEqual([])
  })
  it("evidence_refs 只 1 条 + high → 降为 medium", () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        updates: [{ field: "products", suggested: "x", reason: "y", confidence: "high", evidence_refs: ["cr:2026SR001"] }],
        threat_level_change: "stable",
        action_items: [],
      }),
    )
    expect(r?.updates[0].confidence).toBe("medium")
  })
  it("evidence_refs 3 条 + high → 保持 high", () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        updates: [
          {
            field: "products",
            suggested: "x",
            reason: "y",
            confidence: "high",
            evidence_refs: ["cr:2026SR001", "cust:h1:his", "intel:abc"],
          },
        ],
        threat_level_change: "stable",
        action_items: [],
      }),
    )
    expect(r?.updates[0].confidence).toBe("high")
  })
  it("空 updates 通过（AI 诚实表达无新事实）", () => {
    const r = parseAnalysisResponse(
      JSON.stringify({ updates: [], threat_level_change: "stable", action_items: [] }),
    )
    expect(r).not.toBeNull()
    expect(r?.updates).toEqual([])
  })
  it("malformed JSON → null", () => {
    expect(parseAnalysisResponse("not a json")).toBeNull()
  })
  it("markdown code block 包裹的 JSON 也能解析", () => {
    const body = JSON.stringify({ updates: [], threat_level_change: "up", action_items: ["a"] })
    const r = parseAnalysisResponse("```json\n" + body + "\n```")
    expect(r?.threat_level_change).toBe("up")
    expect(r?.action_items).toEqual(["a"])
  })
  it("非字符串 field/suggested/reason 会被过滤掉", () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        updates: [
          { field: "products", suggested: "x", reason: "y", confidence: "medium", evidence_refs: ["intel:1"] },
          { field: 123, suggested: "x", reason: "y" }, // field 非 string
          { field: "regions" /* 缺 suggested */ , reason: "y" },
        ],
        threat_level_change: "invalid-value", // 非法值 → 归为 stable
        action_items: "not-array", // 非数组 → 归为 []
      }),
    )
    expect(r?.updates).toHaveLength(1)
    expect(r?.threat_level_change).toBe("stable")
    expect(r?.action_items).toEqual([])
  })
})
