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
})
