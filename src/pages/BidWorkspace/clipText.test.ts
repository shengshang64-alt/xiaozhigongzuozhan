// R52（2026-10-16）`clipText` 保头+保尾 回归守卫。
//
// 背景（这是一个真出过事的口径）：原实现是纯「保头」——
//   text.length > max ? `${text.slice(0, max)}\n（后文因篇幅截断）` : text
// 即把 `max` 之后的内容**整段丢弃**。对中文招标文件这是系统性丢错内容：
// 评分办法、★/▲ 实质性条款、废标条款、合同条款、投标文件格式要求，
// 在真实文件里绝大多数落在靠后章节——正好被 head-only 丢掉，而且是静默丢。
//
// 真实库实测（2026-10-16，25 份真实 bid_projects）：
//   最大一份招标正文 762,209 字符，预算 14,000 → 只看到 1.8%。
//
// 本测试锁两件事：
//   ① 结尾内容必须在场（防「又退回只留开头」——这是本文件的唯一目的）；
//   ② 短文本必须逐字原样返回（调用方对「零改动」的既有预期不能破）。

import { describe, expect, it } from "vitest"
import { clipText } from "./bidTypes"

describe("clipText 保头 + 保尾", () => {
  it("短文本（≤ max）逐字原样返回，不加任何标记", () => {
    const short = "本项目采用 B/S 架构。"
    expect(clipText(short, 14000)).toBe(short)
    // 边界：正好等于 max 也必须原样返回
    const exact = "甲".repeat(100)
    expect(clipText(exact, 100)).toBe(exact)
    expect(clipText(exact, 100)).not.toContain("省略")
  })

  it("【核心】关键句只出现在结尾时，必须在截断结果里存活", () => {
    // 模拟真实招标文件：开头是目录/须知，真正的废标条款压在最后
    const critical = "★投标人未提供医疗器械经营许可证的，作废标处理。"
    const text = "第一章 投标须知\n".repeat(2000) + critical
    const out = clipText(text, 1000)
    expect(out.length).toBeLessThan(text.length)
    expect(out).toContain(critical) // ← 旧实现（head-only）在这里必红
  })

  it("结尾保留的原文片段与源文本尾部逐字一致（未被改写/未混入标记）", () => {
    const tail = "第十二章 投标文件格式\n投标函\n法定代表人授权书"
    const text = "前".repeat(5000) + tail
    const out = clipText(text, 800)
    expect(out.endsWith(tail)).toBe(true)
  })

  it("开头同样保留（保头没有被保尾挤掉）", () => {
    const head = "招标编号：XXYY-2026-001"
    const text = head + "中".repeat(5000) + "尾".repeat(200)
    const out = clipText(text, 600)
    expect(out.startsWith(head)).toBe(true)
  })

  it("中段省略处带可读标记且标注了省略字数", () => {
    const text = "头".repeat(400) + "中".repeat(2000) + "尾".repeat(400)
    const out = clipText(text, 1000)
    const m = out.match(/省略中间 (\d+) 字/)
    expect(m).not.toBeNull()
    const omitted = Number(m![1])
    expect(omitted).toBeGreaterThan(0)
    // 省略字数 = 原文 - 保留的头 - 保留的尾
    expect(omitted).toBe(2800 - 1000)
  })

  it("截断结果长度受控：不超过 max + 标记长度（不会因为保尾而膨胀）", () => {
    const text = "字".repeat(200000)
    const out = clipText(text, 14000)
    // 保留内容恰好 max，另有固定长标记
    expect(out.length).toBeLessThanOrEqual(14000 + 80)
  })

  it("真实量级：762,209 字符的招标文件，结尾条款不再丢失（R52 事故口径）", () => {
    const clause = "★未按招标文件要求密封的投标文件将被拒收。"
    const text = "正文".repeat(190000) + "\n" + clause // 380,009 字
    const out = clipText(text, 14000)
    expect(text.length).toBeGreaterThan(14000 * 20)
    expect(out).toContain(clause)
  })
})
