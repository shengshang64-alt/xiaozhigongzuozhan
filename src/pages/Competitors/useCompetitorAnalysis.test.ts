import { describe, expect, it } from "vitest"
import type { EvidenceBundle } from "./competitorEvidence"
import type { CompetitorRow } from "./competitorsCore"
import {
  ANALYSIS_SYSTEM_PROMPT,
  ANALYZABLE_FIELDS,
  buildUserMessage,
  formatExternalBlock,
  parseAnalysisResponse,
  suggestionsNeedingConfirm,
  type ExternalEvidenceResult,
  type FieldSuggestion,
} from "./useCompetitorAnalysis"

// R145：竞品 AI 深度分析「可写字段白名单」单一真源 + 解析/写回双拦截回归。
// 修复：此前 parseAnalysisResponse 仅校验 field 是字符串，applyUpdates 运行时
// `patch[field]=suggested` 绕过 CompetitorPatch 类型层 Omit——模型返回 name /
// rh_user_id / software_copyrights 等即可覆盖竞品身份、越权改归属、污染数值/数组列。

function upd(field: unknown, extra: Record<string, unknown> = {}) {
  return {
    field,
    suggested: "s",
    reason: "r",
    confidence: "high",
    evidence_refs: ["cr:1", "cust:h:his", "intel:i"],
    ...extra,
  }
}

function json(updates: unknown[], threat = "stable") {
  return JSON.stringify({ updates, threat_level_change: threat, action_items: [] })
}

describe("parseAnalysisResponse · 可写字段白名单拦截", () => {
  it("白名单内 field 正常保留", () => {
    const r = parseAnalysisResponse(json([upd("products")]))
    expect(r?.updates.map((u) => u.field)).toEqual(["products"])
  })

  it("身份/归属/数值/数组/未知 field 一律丢弃", () => {
    const illegal = [
      "name", "legal_name", "website", "wechat", "software_copyrights", "keywords",
      "source", "visibility", "id", "rh_user_id", "created", "updated", "bid_amount_5y", "不存在的字段",
    ]
    const r = parseAnalysisResponse(json(illegal.map((f) => upd(f))))
    expect(r?.updates).toHaveLength(0)
  })

  it("混合输入：仅白名单内字段进入 updates", () => {
    const r = parseAnalysisResponse(json([upd("products"), upd("name"), upd("summary"), upd("rh_user_id")]))
    expect(r?.updates.map((u) => u.field)).toEqual(["products", "summary"])
  })

  it("field 非字符串仍被过滤（回归既有行为）", () => {
    const r = parseAnalysisResponse(json([{ field: 123, suggested: "x", reason: "y" }]))
    expect(r?.updates).toHaveLength(0)
  })
})

describe("ANALYZABLE_FIELDS 与系统提示词同口径（防漂移哨兵）", () => {
  it("提示词『可选 field 值』列表与代码白名单逐项一致", () => {
    const m = ANALYSIS_SYSTEM_PROMPT.match(/可选 field 值：([^\n]+)/)
    expect(m).not.toBeNull()
    const fromPrompt = (m?.[1] ?? "")
      .split(/[,，]\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    expect([...fromPrompt].sort()).toEqual([...ANALYZABLE_FIELDS].sort())
  })
})

describe("formatExternalBlock · 外部源缺省口径", () => {
  const empty: ExternalEvidenceResult = { bid: [], ann: [], copyrightLive: { available: false }, errors: [] }
  it("招投标为空输出占位句；上市公告为空不生成该段", () => {
    const t = formatExternalBlock(empty)
    expect(t).toContain("未检索到近期公告")
    expect(t).not.toContain("上市公司公告")
  })
  it("有招投标/公告数据时逐条带 evidenceId", () => {
    const t = formatExternalBlock({
      ...empty,
      bid: [{ evidenceId: "bid:1", title: "某院HIS采购", url: "u", publishedAt: "2026-01-02T00:00:00Z", buyer: "某三甲医院", amountRaw: "350万元" }],
      ann: [{ evidenceId: "ann:9", title: "年报", url: "u", publishedAt: "2026-03-01T00:00:00Z", exchange: "深交所" }],
    })
    expect(t).toContain("[bid:1]")
    expect(t).toContain("某院HIS采购")
    expect(t).toContain("[ann:9]")
    expect(t).toContain("深交所")
  })
})

describe("buildUserMessage · 事实片段与外部块拼装", () => {
  const bundle = { contextString: "【软著事实】cr:2026SR001 某系统", materialSummary: [] } as unknown as EvidenceBundle
  const row = { name: "卫宁健康", legal_name: "卫宁健康科技集团股份有限公司" } as unknown as CompetitorRow
  it("含档案名 + 事实上下文；空外部块不追加", () => {
    const msg = buildUserMessage(row, bundle, "")
    expect(msg).toContain("卫宁健康")
    expect(msg).toContain("【软著事实】")
    expect(msg).toContain("只输出 JSON")
  })
  it("非空外部块被拼接进消息", () => {
    const msg = buildUserMessage(row, bundle, "【招投标中标】bid:1")
    expect(msg).toContain("【招投标中标】bid:1")
  })
})

// R158：采纳二次确认判据（原 window.confirm 的过滤逻辑抽纯函数后回归）——
// 无事实依据且非 low 才需确认；low 在解析阶段已降级不再二次打扰；字段缺失按空处理。
describe("suggestionsNeedingConfirm · 采纳二次确认口径", () => {
  const sg = (confidence: FieldSuggestion["confidence"], refs?: string[]): FieldSuggestion => ({
    field: "products",
    suggested: "s",
    reason: "r",
    confidence,
    evidence_refs: refs,
  })
  it("无事实依据且非 low → 需二次确认", () => {
    expect(suggestionsNeedingConfirm([sg("high", []), sg("medium", [])])).toHaveLength(2)
  })
  it("low 置信度（解析时已降级）不再触发确认", () => {
    expect(suggestionsNeedingConfirm([sg("low", [])])).toHaveLength(0)
  })
  it("带 evidence_refs 不触发；字段缺失按空处理仍触发", () => {
    expect(suggestionsNeedingConfirm([sg("high", ["cr:1"])])).toHaveLength(0)
    expect(suggestionsNeedingConfirm([sg("high")])).toHaveLength(1)
  })
  it("空输入得空数组", () => {
    expect(suggestionsNeedingConfirm([])).toHaveLength(0)
  })
})
