// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { CHECKLIST_QUOTE_FROM, checklistQuotePath, consumeChecklistQuote, stashChecklistQuote } from "./checklistQuoteHandoff"

describe("checklistQuoteHandoff", () => {
  it("stash/consume 保留清单 id 与合成标题，不带真实客户数据", () => {
    stashChecklistQuote({ checklistId: "chk_synth_1", quoteName: "t149联调-合成" })
    expect(checklistQuotePath()).toContain(CHECKLIST_QUOTE_FROM)
    const got = consumeChecklistQuote()
    expect(got).toEqual({ checklistId: "chk_synth_1", quoteName: "t149联调-合成" })
    expect(consumeChecklistQuote()).toBeNull()
  })
})
