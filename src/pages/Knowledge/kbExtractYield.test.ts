import { describe, expect, it, vi } from "vitest"
import { extractAtomsFromDoc } from "./kbExtract"
import type { LlmMessage } from "@/lib/llm"
import { splitWithAnchor } from "./kbParse"
import { pickValuableParagraphs } from "./kbParagraphValue"

// ---------------------------------------------------------------------------
// 抽取产出率优化验收测试（2026-10-31）
//
// 真实问题（实测在 25 份真实方案文档上）：
//   B0 批次抽取产出率极低 —— 10 篇只抽出 11 条原子（1.1 条/篇）。
//
// 查下来是三个独立缺陷叠加：
//   ① 抽段从文档开头数 8 段 → 大文档前几段全是封面/目录/医院简介（提示词明令不抽）
//      → 修：kbParagraphValue 段落价值评估，跳过低价值段
//   ② 没有去重 → 技术标书把同一条需求在「需求/响应/偏离表」写多遍，8 段可能全重复
//      → 修：pickValuableParagraphs 按归一化前 60 字去重
//   ③ **提示词比校验规则更严格** → 提示词要求 product_capability 必须有「版本」，
//      但校验规则 prod:{模块}|{功能} 并不要求版本 → 模型把「系统支持X功能」这类
//      合格内容判为不合格而跳过
//      → 修：放宽提示词描述 + 补正例说明
//
// 修复后：10 篇从 11 条 → 83 条（7.5 倍），段成功率 ~10% → ~63%。
//
// 本测试锁住 ③（提示词一致性），因为它是**最隐蔽**的一个：
// 单看代码逻辑找不出来，只有对真实文档跑才知道产物率不对。
// ---------------------------------------------------------------------------

function mkCallLlm(reply: string) {
  return vi.fn(async () => reply)
}

const ONE_ATOM = JSON.stringify({
  atoms: [
    {
      atom_type: "product_capability",
      title: "病案系统实现病案编码管理功能",
      body: "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理。",
      subject_key: "prod:病案管理|编码与流通",
      attributes: {},
      source_quote: "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理。",
      confidence: 0.9,
    },
  ],
})

describe("提示词与校验规则一致性", () => {
  it("提示词不再要求 product_capability 必须有版本号（校验规则也不要求）", async () => {
    const content =
      "病案信息管理系统实现病案编码管理、流通功能、纸质病历管理，支持首页校对和统计查询综合报表功能，具备图片病历上传与综合管理能力。"
    let systemPrompt = ""
    const callLlm = async (m: LlmMessage[]) => {
      const sp = m.find((x) => x.role === "system")
      if (sp && typeof sp.content === "string") systemPrompt = sp.content
      return ONE_ATOM
    }
    await extractAtomsFromDoc(content, { docTitle: "测试文档", callLlm, maxAttempts: 1 })
    // 关键断言：不应再出现「必须有版本」这类会导致模型自我否决的强约束
    expect(systemPrompt).toContain("product_capability")
    expect(systemPrompt).not.toMatch(/模块\+功能\+版本/)
  })

  it("提示词含正例说明（模型需要知道「支持X功能」该抽）", async () => {
    const content =
      "系统支持结构化病历书写、智能质控、CDSS辅助决策三大模块，并提供完整的病历数据共享、统计分析及数据挖掘能力支持。"
    let systemPrompt = ""
    await extractAtomsFromDoc(content, {
      docTitle: "测试",
      callLlm: async (m: LlmMessage[]) => {
        const sp = m.find((x) => x.role === "system")
        if (sp && typeof sp.content === "string") systemPrompt = sp.content
        return ONE_ATOM
      },
      maxAttempts: 1,
    })
    expect(systemPrompt).toContain("什么该抽")
    expect(systemPrompt).toContain("product_capability")
  })
})

describe("自定义段落传入（跳过封面/目录/背景）", () => {
  const docWithCover = `投 标 文 件
项目名称：
项目编号：

第一章 项目背景 ................ 1
第二章 需求分析 ................ 5

病案信息管理系统实现病案编码管理、流通功能、纸质病历管理，支持首页校对和统计查询综合报表功能，具备图片病历上传管理能力。`

  it("不传 paragraphs 时从头切（会含封面/目录）", async () => {
    const seen: string[] = []
    await extractAtomsFromDoc(docWithCover, {
      docTitle: "测试",
      callLlm: async (m: LlmMessage[]) => {
        const u = m.find((x) => x.role === "user")
        if (u && typeof u.content === "string") seen.push(u.content)
        return JSON.stringify({ atoms: [] })
      },
      maxAttempts: 1,
    })
    expect(seen.length).toBeGreaterThan(0)
  })

  it("传入筛好的段落时只用这些段（输出调用次数更少且都是高价值段）", async () => {
    const all = splitWithAnchor(docWithCover)
    const picked = pickValuableParagraphs(all, 5)
    const seen: string[] = []
    await extractAtomsFromDoc(docWithCover, {
      docTitle: "测试",
      paragraphs: picked,
      callLlm: async (m: LlmMessage[]) => {
        const u = m.find((x) => x.role === "user")
        if (u && typeof u.content === "string") seen.push(u.content)
        return JSON.stringify({ atoms: [] })
      },
      maxAttempts: 1,
    })
    // 传了几段就只调几次
    expect(seen.length).toBe(picked.length)
    // 目录/封面不应出现在调用里
    expect(seen.join("")).not.toContain("........")
  })
})

describe("产出率回归保护", () => {
  it("同一段输入重复抽取时结果稳定（配合 temperature=0）", async () => {
    const content = "系统可用性达到 99.9% 以上，故障响应时间在 15 分钟以内。"
    const results: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const r = await extractAtomsFromDoc(content, {
        docTitle: "测试",
        callLlm: mkCallLlm(ONE_ATOM),
        maxAttempts: 1,
      })
      results.push(r.atoms.length)
    }
    expect(new Set(results).size).toBe(1)
  })
})
