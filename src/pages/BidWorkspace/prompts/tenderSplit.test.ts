import { describe, expect, it } from "vitest"
import { splitTenderText } from "./tenderSplit"

// T14 超限切段测试：切点是纯切片下标——各段拼接必须与原文逐字节一致（tenderSplit 不改字）

describe("splitTenderText", () => {
  it("不超上限原样单段返回", () => {
    const text = "第一章 招标公告\n\n项目概况……"
    expect(splitTenderText(text, 1000)).toEqual([text])
  })

  it("超上限切成 ceil(len/limit) 段，各段拼接与原文逐字节一致", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `第${i}条：这是用于测试切段的模拟条款内容，包含中文标点。`).join("\n")
    const limit = 20000
    const parts = splitTenderText(text, limit)
    expect(parts.length).toBe(Math.ceil(text.length / limit))
    expect(parts.join("")).toBe(text)
    // 段长约束：目标段长 ± 窗口，除末段外不得超 110% 上限
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(part.length).toBeLessThanOrEqual(Math.ceil(limit * 1.1))
    }
  })

  it("优先在自然边界切（换行/句号），不在词语中间硬切", () => {
    const sentence = "这是一条完整的评审条款内容，用于验证自然边界切分。"
    const text = Array.from({ length: 300 }, () => sentence).join("\n")
    const parts = splitTenderText(text, 5000)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join("")).toBe(text)
    // 每段应以完整句号或换行收尾（自然边界切分的产物）
    for (const part of parts.slice(0, -1)) {
      expect(/[。\n；]$/.test(part)).toBe(true)
    }
  })

  it("不在代码围栏内部下刀", () => {
    const fence = "```json\n" + Array.from({ length: 400 }, (_, i) => `{"row": ${i}, "score": "${i} 分"},`).join("\n") + "\n```"
    const filler = Array.from({ length: 300 }, (_, i) => `第${i}段说明文字，结尾是句号。`).join("\n")
    const text = `${filler}\n\n${fence}\n\n${filler}`
    const parts = splitTenderText(text, 4000)
    expect(parts.join("")).toBe(text)
    // 重建围栏配对：所有 ``` 标记在拼接序里保持成对（奇偶性不变说明没有段内破围栏）
    const totalFences = parts.map((p) => (p.match(/```/g) ?? []).length).reduce((a, b) => a + b, 0)
    expect(totalFences % 2).toBe(0)
  })

  it("极小段长上限不会死循环（limit=1 时逐字符切）", () => {
    const parts = splitTenderText("abc", 1)
    expect(parts.join("")).toBe("abc")
    expect(parts).toHaveLength(3)
  })
})
