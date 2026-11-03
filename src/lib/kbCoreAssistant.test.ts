import { describe, expect, it } from "vitest"
import { formatKbHitsForAssistant, type KbDocRow, type KbSearchHit } from "./kbCore"

// R188（r186 PII 装配接线）：小智取数回填 formatKbHitsForAssistant 此前把
// doc.summary 原文塞进 AI（命中片段走 contextSnippetOf 已脱敏，但「摘要」字段绕过），
// 本轮对摘要统一二次掩码，锁死敏感档 PII 不进第三方云。

const mkDoc = (over: Partial<KbDocRow>): KbDocRow => ({
  id: "d1",
  rh_user_id: "u1",
  title: "某医院合同",
  folder_path: "/",
  content: "正文",
  doc_format: "docx",
  visibility: "team",
  summary: "",
  keywords: [],
  source_file_name: "a.docx",
  uploader_name: "张三",
  created: "2026-01-01 00:00:00",
  updated: "2026-01-01 00:00:00",
  ...over,
})

const mkHit = (over: Partial<KbSearchHit>): KbSearchHit => ({
  doc: mkDoc({}),
  score: 1,
  snippet: "",
  ...over,
})

describe("formatKbHitsForAssistant · 摘要 PII 二次掩码（R188）", () => {
  it("摘要含手机号：注入 AI 的摘要被掩码", () => {
    const out = formatKbHitsForAssistant(
      [mkHit({ doc: mkDoc({ doc_category: "合同商务", ai_context_mode: "original", is_sensitive: true, summary: "联系人手机 13800138000" }) })],
      "问题",
    )
    expect(out).not.toContain("13800138000")
    expect(out).toContain("138")
    expect(out).toContain("****")
  })
  it("摘要无 PII：原样保留（零行为变更）", () => {
    const out = formatKbHitsForAssistant(
      [mkHit({ doc: mkDoc({ doc_category: "技术方案", summary: "系统采用微服务架构" }) })],
      "问题",
    )
    expect(out).toContain("系统采用微服务架构")
  })
})
