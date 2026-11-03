import { describe, expect, it } from "vitest"
import { qaAnswerToText } from "./qaCopyText"
import type { QaCitation } from "@/pages/Knowledge/useKnowledge"

const cites = [
  { docId: "d1", title: "电子病历评级标准", snippet: "…" },
  { docId: "d2", title: "互联互通测评方案", snippet: "…" },
] as QaCitation[]

describe("qaAnswerToText · 回答可带走文本（R59）", () => {
  it("剥掉 [资料N] 内联标记，引用折为文末来源列表", () => {
    const out = qaAnswerToText("电子病历评级分为[资料1]五级，需通过互联互通测评[资料2]方可申报。", cites)
    expect(out).not.toContain("[资料")
    expect(out).toContain("来源：")
    expect(out).toContain("[1] 《电子病历评级标准》")
    expect(out).toContain("[2] 《互联互通测评方案》")
    expect(out.startsWith("电子病历评级分为五级")).toBe(true)
  })

  it("无引用时只返回正文", () => {
    expect(qaAnswerToText("纯文本回答。")).toBe("纯文本回答。")
  })

  it("空内容安全", () => {
    expect(qaAnswerToText("", undefined)).toBe("")
  })

  it("P1（2026-10-24）：旧回答回显的证件号/手机号在复制出口被掩码，标书数字不受影响", () => {
    const out = qaAnswerToText(
      "授权代表身份证号 350782198510193025，手机 18859201019，预算 23,480,000.00 元，编制时间 2026年10月。",
      undefined,
    )
    expect(out).not.toContain("350782198510193025")
    expect(out).not.toContain("18859201019")
    expect(out).toContain("350782********3025")
    expect(out).toContain("188****1019")
    // 金额与日期（非连续 11+ 位数字）逐字保留
    expect(out).toContain("23,480,000.00")
    expect(out).toContain("2026年10月")
  })

  it("P1：掩码幂等——已掩码文本再过一遍不变", () => {
    const once = qaAnswerToText("手机 18859201019", undefined)
    expect(qaAnswerToText(once, undefined)).toBe(once)
  })
})
