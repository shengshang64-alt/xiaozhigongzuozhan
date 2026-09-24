import { describe, expect, it } from "vitest"
import { buildComplianceRows } from "./complianceMatrix"
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
})
