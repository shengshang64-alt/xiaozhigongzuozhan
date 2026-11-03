// ---------------------------------------------------------------------------
// 2026-10-26 标书官复核提出的真实缺口：凭证类断言必须有出处
//
// 它的原话（针对真网关生成的那段示例正文）：
//   「最危险的一句不是 800，是「已通过等保三级测评并提供证书」：这张表没有证明材料列，
//     这句话无处可查。没有证书就是虚假应答，废标级，还可能进失信名单。」
//
// 我核实产品里原本没有这条校验（搜「已通过|已获得|已获证书」，生产代码零相关实现），
// 所以这是真缺口，不是它误报。
//
// 本测试锁三件事：
//   ① 有断言、无出处 → 报
//   ② 有断言、有出处（详见附件/第X页/证书号）→ 放行
//   ③ 不误伤：规划中的（将取得）、招标侧要求（投标人应通过）、泛能力描述（支持等保要求）都不报
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { findCredentialClaimsWithoutEvidence } from "./bidWritingRules"

const LINES = (...ls: string[]) => ls.join("\n")

describe("findCredentialClaimsWithoutEvidence：凭证断言必须有出处", () => {
  it("「已通过等保三级测评并提供证书」无出处 → 报（标书官点的原句）", () => {
    const claims = findCredentialClaimsWithoutEvidence(LINES("信息安全等级  满足等保三级要求  已通过等保三级测评并提供证书  无偏离"))
    expect(claims.length).toBe(1)
    expect(claims[0].hasPointer).toBe(false)
    expect(claims[0].excerpt).toContain("已通过等保三级测评")
  })

  it("同一段/后两行写了「详见附件3」→ 放行", () => {
    const claims = findCredentialClaimsWithoutEvidence(LINES("我公司已通过等保三级测评并提供证书（详见附件3）。"))
    expect(claims.length).toBe(1)
    expect(claims[0].hasPointer).toBe(true)
  })

  it("出处写在下一行也认（凭证断言句末，出处跟同一段下一行）", () => {
    const claims = findCredentialClaimsWithoutEvidence(LINES("我公司已通过 CMMI5 级评估。", "证明材料见附件 5，第 12 页。"))
    expect(claims.length).toBe(1)
    expect(claims[0].hasPointer).toBe(true)
  })

  it("证书编号也算出处", () => {
    const claims = findCredentialClaimsWithoutEvidence(LINES("持有 ISO27001 认证证书，证书编号：IS-2026-0012。"))
    expect(claims.length).toBe(1)
    expect(claims[0].hasPointer).toBe(true)
  })

  it("不误伤：规划中的「将取得」不报", () => {
    expect(findCredentialClaimsWithoutEvidence(LINES("计划于 2027 年取得等保三级认证。"))).toEqual([])
    expect(findCredentialClaimsWithoutEvidence(LINES("拟申请 CMMI4 评估。"))).toEqual([])
  })

  it("不误伤：招标侧要求「投标人应通过」不报（那是要求不是我们的断言）", () => {
    expect(findCredentialClaimsWithoutEvidence(LINES("投标人应通过等保三级测评并提供有效证书。"))).toEqual([])
    expect(findCredentialClaimsWithoutEvidence(LINES("供应商须取得 ISO9001 认证。"))).toEqual([])
  })

  it("不误伤：泛能力描述「支持等保三级要求」不报（能力≠持证）", () => {
    expect(findCredentialClaimsWithoutEvidence(LINES("系统支持等保三级要求，具备完善的安全审计能力。"))).toEqual([])
  })

  it("行号正确（1 起，便于用户定位）", () => {
    const claims = findCredentialClaimsWithoutEvidence(LINES("第一行正常。", "第二行正常。", "我公司已通过等保三级测评。"))
    expect(claims.length).toBe(1)
    expect(claims[0].line).toBe(3)
  })

  it("空输入不抛错", () => {
    expect(findCredentialClaimsWithoutEvidence("")).toEqual([])
  })
})
