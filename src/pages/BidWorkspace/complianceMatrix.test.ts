import { describe, expect, it } from "vitest"
import {
  buildComplianceRows,
  countMarkerLossRows,
  isCriticalComplianceRow,
  summarizeCompliance,
  type ComplianceProgressMap,
} from "./complianceMatrix"
import type { ParseReport } from "./bidTypes"

const report = (starContent: string): ParseReport =>
  ({
    scope: "key",
    sections: [{ key: "star_clauses", title: "★/▲ 重点条款", content: starContent, status: "ok", snippet: "" }],
  }) as ParseReport

describe("buildComplianceRows · ★条款按条归行（R50/F2）", () => {
  it("多行条款（标记行+正文+注）归为一条，不再逐行拆分", () => {
    const content = [
      "★1",
      "软件性能支持处理日均门诊患者人次达15000以上、住院患者人次5000以上。",
      "注:投标文件中须提供承诺函并盖公章承诺满足此项条件。",
      "",
      "★2",
      "数据处理能力：为保障新信息系统上线后，医院历史诊疗与运营数据的完整性。",
    ].join("\n")
    const rows = buildComplianceRows(report(content)).filter((r) => r.kind === "star")
    expect(rows).toHaveLength(2)
    expect(rows[0].text).toContain("★1")
    expect(rows[0].text).toContain("软件性能")
    expect(rows[0].text).toContain("承诺函")
    expect(rows[1].text).toContain("★2")
    expect(rows[1].text).toContain("数据处理能力")
  })

  it("旧格式单行『★N』每行各自成条，行为与旧版一致", () => {
    const rows = buildComplianceRows(report(["★1", "★2", "★3"].join("\n"))).filter(
      (r) => r.kind === "star",
    )
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.text)).toEqual(["★1", "★2", "★3"])
  })

  it("评分规则行（正文内含★）起条后，吸收的表格碎片行并入本条而非散落", () => {
    const content = [
      "评标委员会根据响应情况评分，针对标注“★”的技术参数及要求，每满足一项得2分，满分20分。",
      "注:以“技术参数及要求”中要求提供的证明材料作为评审依据。",
      "0-20分",
      "履约",
    ].join("\n")
    const rows = buildComplianceRows(report(content)).filter((r) => r.kind === "star")
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toContain("0-20分")
    expect(rows[0].text).toContain("履约")
  })

  it("无标记的孤立行（非条款区残留）不生成行", () => {
    const rows = buildComplianceRows(report(["", "普通正文一行", ""].join("\n"))).filter(
      (r) => r.kind === "star",
    )
    expect(rows).toHaveLength(0)
  })

  // R144：AI 补扫通道未经 normalize，目录行/标注含义句直接进矩阵——此处按同一真源口径丢弃
  it("目录行与标注含义句不生成矩阵行，真实条款保留", () => {
    const content = [
      "1.▲门急诊挂号系统 123",
      "▲条款为实质性要求，任何一项负偏离按无效投标处理",
      "★1",
      "软件性能支持日均门诊15000人次",
    ].join("\n")
    const rows = buildComplianceRows(report(content)).filter((r) => r.kind === "star")
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toContain("日均门诊15000")
  })
})

describe("summarizeCompliance / isCriticalComplianceRow · 按类覆盖汇总（R133）", () => {
  const rowsOf = (content: string, kind: "star" | "void" = "star") =>
    buildComplianceRows(
      kind === "star"
        ? report(content)
        : ({ sections: [{ key: "void_items", title: "无效标与废标项", content, status: "ok", snippet: "" }] } as ParseReport),
    )

  it("关键判定：废标项或强制条款为关键，普通符合性检查非关键", () => {
    expect(isCriticalComplianceRow({ kind: "void", mandatory: false })).toBe(true)
    expect(isCriticalComplianceRow({ kind: "star", mandatory: true })).toBe(true)
    expect(isCriticalComplianceRow({ kind: "qual", mandatory: true })).toBe(true)
    expect(isCriticalComplianceRow({ kind: "comp", mandatory: false })).toBe(false)
  })

  it("未标注的行默认按 open 计入未覆盖，且与全局合计一致", () => {
    const rows = rowsOf(["★1 要求A", "★2 要求B"].join("\n"))
    const s = summarizeCompliance(rows, {})
    expect(s.total).toBe(2)
    expect(s.uncovered).toBe(2)
    expect(s.uncoveredCritical).toBe(2)
    expect(s.kinds.star.total).toBe(2)
    expect(s.kinds.star.uncoveredCritical).toBe(2)
  })

  it("标注 covered / na 后退出未覆盖，仅 open 保持计数", () => {
    const rows = rowsOf(["★1 要求A", "★2 要求B", "★3 要求C"].join("\n"))
    const progress: ComplianceProgressMap = {
      [rows[0].id]: { status: "covered", ref: "3.1", note: "" },
      [rows[1].id]: { status: "na", ref: "", note: "本项目不适用" },
    }
    const s = summarizeCompliance(rows, progress)
    expect(s.total).toBe(3)
    expect(s.uncovered).toBe(1)
    expect(s.uncoveredCritical).toBe(1)
    expect(s.kinds.star.uncovered).toBe(1)
  })

  it("混合类型：非关键（符合性检查）未覆盖不计入关键未覆盖", () => {
    const star = rowsOf("★1 硬件要求")
    const voidRows = rowsOf("报价超过预算的作废标处理", "void")
    const comp = buildComplianceRows({
      sections: [{ key: "compliance", title: "符合性检查", content: "须提供授权书原件", status: "ok", snippet: "" }],
    } as ParseReport)
    const rows = [...star, ...voidRows, ...comp]
    const s = summarizeCompliance(rows, {})
    expect(s.total).toBe(3)
    expect(s.uncovered).toBe(3)
    // star(强制)+void 为关键，comp 非关键
    expect(s.uncoveredCritical).toBe(2)
    expect(s.kinds.void.uncoveredCritical).toBe(1)
    expect(s.kinds.comp.uncoveredCritical).toBe(0)
    expect(s.kinds.comp.uncovered).toBe(1)
  })

  it("空行/空进度：全零且不抛错", () => {
    const s = summarizeCompliance([], {})
    expect(s.total).toBe(0)
    expect(s.uncovered).toBe(0)
    expect(s.uncoveredCritical).toBe(0)
    expect(s.kinds.qual.total).toBe(0)
  })
})

describe("countMarkerLossRows · 矩阵行符号丢失签名计数（R163 闭环 r159-marker-badge-ui 挂账）", () => {
  it("「标注 + 空引号对」与私用区字符计入，正常条款不计", () => {
    const rows = [
      { text: '针对标注“”的技术参数及要求，每满足一项得2分。' },
      { text: "数据处理能力：保障历史诊疗数据完整性。" },
      { text: "★1 软件性能支持日均门诊15000人次" },
    ]
    expect(countMarkerLossRows(rows)).toBe(2)
  })

  it("空行集与空文本返回 0，不抛错", () => {
    expect(countMarkerLossRows([])).toBe(0)
    expect(countMarkerLossRows([{ text: "" }, { text: "   " }])).toBe(0)
  })

  it("同一文本重复只计一次（先去重再判定）", () => {
    const text = '注：“”的条款为实质性要求'
    expect(countMarkerLossRows([{ text }, { text }, { text }])).toBe(1)
  })

  it("真实矩阵行（已去列表符号）仍按原文命中判定", () => {
    const content = [
      "★1",
      '评标委员会针对标注“”的技术参数及要求，每满足一项得2分。',
    ].join("\n")
    const rows = buildComplianceRows(report(content)).filter((r) => r.kind === "star")
    expect(rows).toHaveLength(1)
    expect(countMarkerLossRows(rows)).toBe(1)
  })
})
