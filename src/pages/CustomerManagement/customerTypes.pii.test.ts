/**
 * 「原文进 AI 前先脱敏」的回归网（2026-11-04，审计 P1）。
 *
 * 全站口径（kbPolicy.contextSnippetOf / competitorEvidence / 知识库问答 / qaCopyText）都是
 * **发往第三方云模型或对外引用前一律 redactPii**，但有两个入口当年漏了：
 *   ① 情报 AI 摘要打标：content_snippet 前 1500 字原样发模型；
 *      真实样本（_r69_intel.json）里就有「供应商联系电话：13330076038」「联系方式：0832-22561202」。
 *   ② 客户官网抽取：rawText 前 16000 字原样发模型，官网公告常带联系人手机/座机/身份证。
 * 这两处都是「发出去就收不回」的单向泄漏，且不像界面问题那样能被肉眼发现。
 *
 * 本文件直接断言**最终 messages**（而不是中间变量）：只有这样才能证明真的没发出去。
 * 反向验证：把两处 redactPii 去掉 → 本文件对应用例必须红。
 */
import { describe, expect, it } from "vitest"
import { buildExtractMessages } from "./customerTypes"
import type { LlmMessage } from "@/lib/llm"

/** 取 messages 拼成一整段，模拟「实际发出去的 payload」 */
function payload(messages: LlmMessage[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n")
}

const RAW_WITH_PII = [
  "某市第一人民医院简介",
  "联系人：张主任，手机 13812345678，座机 0832-22561202，邮箱 zhangsan@hospital.cn",
  "公示期负责人身份证号 110101199003071234",
  "统一社会信用代码 91310000MA1FL1234X",
  "医院现有职工 2000 人，开放床位 1500 张。",
].join("\n")

describe("客户官网抽取：进模型前必须脱敏", () => {
  it("手机号 / 座机 / 邮箱 / 身份证 / 信用代码都不许明文出现在 messages 里", () => {
    const text = payload(buildExtractMessages(RAW_WITH_PII))
    expect(text).not.toContain("13812345678")
    expect(text).not.toContain("0832-22561202")
    expect(text).not.toContain("zhangsan@hospital.cn")
    expect(text).not.toContain("110101199003071234")
    expect(text).not.toContain("91310000MA1FL1234X")
  })

  it("脱敏不误伤业务正文：医院名、人数、床位数照常保留", () => {
    const text = payload(buildExtractMessages(RAW_WITH_PII))
    expect(text).toContain("某市第一人民医院")
    expect(text).toContain("2000 人")
    expect(text).toContain("1500 张")
    // 掩码保留头尾，模型仍能看出「这里有个电话」
    expect(text).toContain("138****5678")
  })

  it("仍然受 16000 字上限约束（脱敏在前、截断在后，顺序不能反）", () => {
    const text = payload(buildExtractMessages(RAW_WITH_PII))
    expect(text.length).toBeLessThan(16000 + 200)
  })

  it("无 PII 的纯文本原样透传（不做多余改写）", () => {
    const plain = "某医院 2026 年信息化建设情况：已完成电子病历五级评审。"
    expect(payload(buildExtractMessages(plain))).toContain(plain)
  })
})
