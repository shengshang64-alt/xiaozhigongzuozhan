import { describe, expect, it } from "vitest"
import { buildChecklistRows, summarizeChecklist } from "./submissionChecklist"
import type { ParseReport } from "./bidTypes"

// R29（test-net-01）：交卷前合规清单纯推导的行为锈死网
// 锁死点：R25 运行时坐实的两分区推导、强制判定、去重与稳定 id
const report = (responseReq: string, qualification: string): ParseReport =>
  ({
    sections: [
      { key: "response_req", content: responseReq },
      { key: "qualification", content: qualification },
    ],
  }) as unknown as ParseReport

describe("buildChecklistRows", () => {
  it("两分区生成清单行，份数/盖章类形式要件判为强制", () => {
    const rows = buildChecklistRows(
      report("正本一份，副本四份，密封装订\n电子档上传平台", "营业执照副本复印件\n[强制]医疗器械经营许可证"),
    )
    const format = rows.filter((r) => r.kind === "format")
    const qual = rows.filter((r) => r.kind === "qual")
    expect(format).toHaveLength(2)
    expect(format[0].mandatory).toBe(true)
    expect(format[1].mandatory).toBe(false)
    expect(qual).toHaveLength(2)
    expect(qual.find((r) => r.text.includes("许可证"))?.mandatory).toBe(true)
    expect(qual.find((r) => r.text.includes("营业执照"))?.mandatory).toBe(false)
  })

  it("[强制] 前缀剥离后文本不进清单行正文", () => {
    const rows = buildChecklistRows(report("", "[强制]：保密承诺书"))
    expect(rows[0].text).toBe("保密承诺书")
    expect(rows[0].mandatory).toBe(true)
  })

  it("列表符号与序号前缀清理、同文本去重、截断提示行不算要求", () => {
    const rows = buildChecklistRows(
      report("- 加盖公章\n• 加盖公章\n1、加盖公章\n…另有 5 条未列出", ""),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe("加盖公章")
  })

  it("稳定 id：报告重解析（文本不变）id 不变，进度可对上", () => {
    const a = buildChecklistRows(report("密封递交", ""))
    const b = buildChecklistRows(report("密封递交", ""))
    expect(a[0].id).toBe(b[0].id)
    expect(a[0].id.startsWith("format:")).toBe(true)
  })

  it("空报告安全", () => {
    expect(buildChecklistRows(null)).toEqual([])
    expect(buildChecklistRows(report("", ""))).toEqual([])
  })
})

describe("summarizeChecklist", () => {
  const rows = buildChecklistRows(report("正本一份密封\n自由上传即可", "[强制]许可证\n营业执照"))

  it("进度三态汇总：pending/mandatoryPending/done/na/分类计数", () => {
    const s = summarizeChecklist(rows, { [rows[0].id]: "done", [rows[3].id]: "na" })
    expect(s.total).toBe(4)
    expect(s.done).toBe(1)
    expect(s.na).toBe(1)
    expect(s.pending).toBe(2)
    expect(s.formatCount).toBe(2)
    expect(s.qualCount).toBe(2)
  })

  it("强制待确认只数未确认的强制项", () => {
    const mand = rows.filter((r) => r.mandatory)
    const s = summarizeChecklist(rows, { [mand[0].id]: "done" })
    expect(s.mandatoryPending).toBe(mand.length - 1)
  })
})
