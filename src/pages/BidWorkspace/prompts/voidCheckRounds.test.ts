// R-028（R254）废标三轮提示词 + 分类 场景自测（零模型）
import { describe, expect, it } from "vitest"
import {
  buildVoidScopeMessages,
  buildVoidInitialCheckMessages,
  buildVoidFinalizeMessages,
  VOID_ROUNDS_PROMPT_VERSION,
} from "./voidCheckRounds"
import { sanitizeVoidCheck } from "../bidTypes"
import { selectBidEvidence } from "../bidVisibility"
import type { LlmMessage } from "@/lib/llm"

describe("R-028 废标三轮提示词与分类（R254）", () => {
  const clauses = ["未按招标文件要求盖章的投标无效", "投标报价超出最高限价的投标无效"]
  // R50（P0-3）：三轮共用同一证据包（短文本→mode=full，逐字注入）
  const bid = selectBidEvidence("投标文件正文：本项目提供五星售后服务承诺。", clauses)
  const all = (m: LlmMessage[]) => m.map((x) => (typeof x.content === "string" ? x.content : "")).join("\n")

  it("第一轮·定位分类：system+user，含 invalidBid/rejectionItem 与 scope JSON 契约", () => {
    const s = buildVoidScopeMessages(clauses, bid, "【★实质性条款】★1 系统响应15分")
    expect(s[0].role).toBe("system")
    expect(s).toHaveLength(2)
    expect(all(s)).toContain("invalidBid")
    expect(all(s)).toContain("rejectionItem")
    expect(all(s)).toContain(`"scope"`)
    expect(s[1].content).toContain(clauses[0])
  })

  it("第二轮·逐条初检：携带第一阶段 plan，输出 items 契约", () => {
    const i = buildVoidInitialCheckMessages({ scope: [{ clause: clauses[0], kind: "invalidBid", where: "第三章", synonyms: ["签章"] }] }, bid)
    expect(i).toHaveLength(2)
    expect(all(i)).toContain(`"items"`)
    expect(i[1].content).toContain("第一阶段定位与分类")
  })

  it("第三轮·定稿：携带第二阶段初检，含「定稿复核」与 severity", () => {
    const f = buildVoidFinalizeMessages({ items: [{ clause: clauses[0], status: "non_compliant", kind: "invalidBid" }] }, bid)
    expect(f[0].content).toContain("定稿复核")
    expect(all(f)).toContain("severity")
  })

  it("VOID_ROUNDS_PROMPT_VERSION 正整数", () => {
    expect(VOID_ROUNDS_PROMPT_VERSION).toBeGreaterThanOrEqual(1)
  })

  it("sanitizeVoidCheck 保留 kind 分类 + 补漏条款默认 invalidBid", () => {
    const check = sanitizeVoidCheck(
      { items: [{ clause: clauses[0], status: "non_compliant", kind: "rejectionItem", evidence: "正文未见盖章说明" }] },
      clauses,
    )
    expect(check.items).toHaveLength(2)
    expect(check.items.find((x) => x.clause === clauses[0])?.kind).toBe("rejectionItem")
    expect(check.items.find((x) => x.clause === clauses[1])?.kind).toBe("invalidBid")
  })
})
