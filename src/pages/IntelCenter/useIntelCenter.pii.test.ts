/**
 * 情报 AI 打标的「进模型前脱敏」回归网（2026-11-04，审计 P1）。
 *
 * 全站口径：原文发往第三方云模型前一律 redactPii（kbPolicy / competitorEvidence / 知识库问答）。
 * 情报打标这一处当年漏了——buildTagMessages 把 content_snippet 前 1500 字原样发出去。
 * 而情报来源是政府采购网/行业资讯站，**真实样本**（_r69_intel.json）里就带
 * 「供应商联系电话：13330076038」「联系方式：0832-22561202」，会跟着请求一起发到云端。
 *
 * 本文件直接断言最终 messages（= 实际发出去的 payload），不做中间变量断言——
 * 只有这样才证明「真的没发出去」。
 */
import { describe, expect, it } from "vitest"
import { buildTagMessages } from "./useIntelCenter"
import type { IntelItemRow } from "./useIntelCenter"
import type { LlmMessage } from "@/lib/llm"

function item(over: Partial<IntelItemRow> = {}): IntelItemRow {
  return {
    id: "i1",
    title: "某医院信息化采购公告",
    content_snippet: "",
    summary: "",
    item_type: "bid",
    item_status: "pending",
    my_status: "pending",
    region: "四川",
    source_id: "s1",
    source_name: "中国政府采购网",
    url: "https://example.com/1",
    published_at: "2026-10-31",
    created: "2026-10-31 00:00:00.000Z",
    updated: "2026-10-31 00:00:00.000Z",
    tags: [],
    visibility: "public",
    added_by: "crawl",
    ...over,
  } as IntelItemRow
}

const payload = (m: LlmMessage[]) =>
  m.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n")

describe("情报 AI 打标：进模型前必须脱敏", () => {
  it("片段里的联系电话/邮箱/身份证不许明文发往模型", () => {
    const text = payload(
      buildTagMessages(
        item({
          content_snippet:
            "采购人信息 名称：内江市第一人民医院 联系方式：0832-22561202 供应商联系电话：13330076038 邮箱 caigou@hospital.cn",
        }),
      ),
    )
    expect(text).not.toContain("13330076038")
    expect(text).not.toContain("0832-22561202")
    expect(text).not.toContain("caigou@hospital.cn")
  })

  it("脱敏不误伤打标判断所需的信息：医院名、地区、采购类型照常保留", () => {
    const text = payload(
      buildTagMessages(
        item({
          content_snippet: "内江市第一人民医院 2026 年医氧系统设备及配套维保项目招标公告，联系方式：0832-22561202",
        }),
      ),
    )
    expect(text).toContain("内江市第一人民医院")
    expect(text).toContain("医氧系统")
    // 掩码保留头尾
    expect(text).toContain("0832-******02")
  })

  it("标题/来源/链接照常带给模型（脱敏只作用于正文片段）", () => {
    const text = payload(buildTagMessages(item({ title: "标题A", source_name: "来源B", url: "https://x.cn/y" })))
    expect(text).toContain("标题A")
    expect(text).toContain("来源B")
    expect(text).toContain("https://x.cn/y")
  })

  it("无 PII 的纯文本片段原样透传（不做多余改写）", () => {
    const plain = "某医院发布 DRG 付费改革实施方案，涉及病案首页质控。"
    expect(payload(buildTagMessages(item({ content_snippet: plain })))).toContain(plain)
  })
})
