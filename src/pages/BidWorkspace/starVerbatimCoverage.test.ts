import { describe, expect, it } from "vitest"
import { auditComplianceCoverage } from "./complianceCoverage"
import type { ComplianceRow } from "./complianceMatrix"
import type { Chapter } from "../SolutionStudio/solutionTypes"

// 问题1（2026-10-12）：▲★ 须「原文响应」，本地确定性核对逐条回对招标原文（零容忍·只报不拦）。
const ch = (over: Partial<Chapter>): Chapter =>
  ({ node_id: "n", title: "章", sections: [], content: "", gen_status: "done", ...over }) as Chapter
const star = (id: string, text: string): ComplianceRow => ({ id, kind: "star", text, mandatory: true })

describe("原文逐字响应度（verbatimRatio / originalHit）", () => {
  it("照录原文、仅换人称并加结论 → originalHit=true", () => {
    const rows = [star("s1", "★ 系统须支持日均门诊15000人次的数据处理能力")]
    const body = "我方系统支持日均门诊15000人次的数据处理能力，完全满足招标文件要求。"
    const r = auditComplianceCoverage(rows, [ch({ content: body })])
    expect(r.byRow["s1"].originalHit).toBe(true)
    expect(r.byRow["s1"].verbatimRatio).toBeGreaterThanOrEqual(0.7)
  })

  it("同义改写、打散原文用词 → originalHit=false", () => {
    const rows = [star("s1", "★ 系统须支持日均门诊15000人次的数据处理能力")]
    const body = "本平台性能卓越，可从容应对海量就诊高峰，处理能力业内领先。"
    const r = auditComplianceCoverage(rows, [ch({ content: body })])
    expect(r.byRow["s1"].originalHit).toBe(false)
    expect(r.byRow["s1"].verbatimRatio).toBeLessThan(0.7)
  })

  it("行首标记与紧随序号被剥离后再比对（▲2、…）", () => {
    const rows = [star("s1", "▲2、提供7×24小时驻场运维服务")]
    const body = "我方提供7×24小时驻场运维服务，完全满足招标文件要求。"
    const r = auditComplianceCoverage(rows, [ch({ content: body })])
    expect(r.byRow["s1"].originalHit).toBe(true)
  })

  it("verbatimResponded 逐字命中条数", () => {
    const rows = [
      star("s1", "★ 提供7×24小时驻场运维服务"),
      star("s2", "★ 接口对接HL7 FHIR标准"),
    ]
    const body = "我方提供7×24小时驻场运维服务，完全满足招标文件要求。接口对接要求说明另说。"
    const r = auditComplianceCoverage(rows, [ch({ content: body })])
    expect(r.verbatimResponded).toBe(1)
    expect(r.byRow["s1"].originalHit).toBe(true)
    expect(r.byRow["s2"].originalHit).toBe(false)
  })
})
