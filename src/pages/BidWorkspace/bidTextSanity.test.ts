// 单元测试：标书正文丢字/孤字本地检测
// 覆盖端到端报告 BUG-101 列出的所有典型症状

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { detectLostChars } from "./bidTextSanity"

describe("detectLostChars（标书丢字/孤字本地检测）", () => {
  it("正常正文 → 0 命中", () => {
    const r = detectLostChars(
      "本项目总体技术在此基础上把门诊服务、急诊服务、住院服务统一规划。\n" +
        "医疗运营质量、药库管理、药房管理、智能用药管理均纳入同一技术底座。\n" +
        "整体采用 B/S（浏览器/服务器）架构开发建设，不依赖额外兼容 Windows、macOS 等主流操作系统。",
    )
    expect(r.hits.length).toBe(0)
    expect(r.summary).toBe("")
  })

  it("端到端报告 BUG-101 真实样本：安中医第 5 章典型断句", () => {
    const sample =
      "本项目总体技术此基础上把门诊服务、急诊服务、住院服务、临床辅助、医疗运\n" +
      "质量、药库管理、药房管理、智能用药管理、医疗辅助等功能模\n" +
      "入同一技术底座承载。\n" +
      "整体采用 B/S（浏览器/服务器）架构开发建设，不依赖额外容 Windows、macOS 等主流操作系统。"
    const r = detectLostChars(sample)
    expect(r.hits.length).toBeGreaterThan(0)
    const reasons = r.hits.map((h) => h.reason)
    expect(reasons.some((k) => k.includes("医疗运"))).toBe(true)
    expect(reasons.some((k) => k.includes("功能模"))).toBe(true)
    expect(reasons.some((k) => k.includes("'兼'"))).toBe(true)
  })

  it("短行（≤3 字）应被识别", () => {
    const text = "第一段正常正文。\n医\n第三段正常正文。足够长。"
    const r = detectLostChars(text)
    expect(r.hits.some((h) => h.kind === "short_line")).toBe(true)
  })

  it("空内容不报错", () => {
    expect(detectLostChars("").hits.length).toBe(0)
    expect(detectLostChars("ab").hits.length).toBe(0)
  })

  it("极长正文不卡顿", () => {
    const long = "正常标书正文。\n".repeat(2000) // ~16k 字
    const t0 = Date.now()
    const r = detectLostChars(long)
    const dt = Date.now() - t0
    // 长正文中"正常标书正文"无残缺搭配、无短行
    expect(r.hits.length).toBe(0)
    expect(dt).toBeLessThan(50)
  })

  it("命中上限 30 条", () => {
    const sample = "x ".repeat(200) + "功能模 入 ".repeat(50)
    const r = detectLostChars(sample)
    expect(r.hits.length).toBeLessThanOrEqual(30)
  })

  it("返回的 offset 真实可定位到原文", () => {
    const text = "AAAA这里是凑字数避免被early return掉。\n医\nBBBB这里是另一段比较长的文本继续凑够字符数。\n继续长"
    const r = detectLostChars(text)
    const shortLineHit = r.hits.find((h) => h.kind === "short_line")
    expect(shortLineHit).toBeDefined()
    if (shortLineHit) {
      expect(text.slice(shortLineHit.offset, shortLineHit.offset + 1)).toBe("医")
    }
  })

  it("short_line 文案带真实行号，不是占位符「第 N 行」", () => {
    const longLine = "正常正文第一行，需要足够长避免被跳过的内容。"
    // 短行故意放在第 3 行：行号若写死或漏替换，这个断言就会红
    const text = `${longLine}\n${longLine}\n医\n${longLine}`
    const r = detectLostChars(text)
    const hit = r.hits.find((h) => h.kind === "short_line")
    expect(hit).toBeDefined()
    expect(hit?.reason).toContain("第 3 行过短")
    expect(hit?.reason).not.toContain("第 N 行")
  })
})

// ---------------------------------------------------------------------------
// R55（2026-10-16）：源码注释 = 可执行契约
// ---------------------------------------------------------------------------
// 由来：模块头部逐条记录了 BUG-101 的 5 条真实样本，BROKEN_PAIRS 每条也带自己的样本注释，
//   但 R55 用真实语料逐条复算时发现——第 4 条「日均门诊患 15000 以上」**从来没有被命中过**
//   （旧模式 /门诊患\s+(人次|以上|数量)/ 要求缺字处紧跟量词，真实样本却是「门诊患 + 数字」）。
//   也就是说"注释里承诺能查出来的东西，代码其实查不出来"，而没有任何测试会发现。
// 本契约：注释里写明的每条样本，都必须（a）仍在源码中（防悄悄删文档）（b）真的能被查出来。
// ---------------------------------------------------------------------------
describe("R55：源码注释写明的样本必须真的能被查出来", () => {
  const SRC = readFileSync(new URL("./bidTextSanity.ts", import.meta.url), "utf-8")

  /** 模块头部「端到端测试发现 BUG-101」逐条列出的真实症状（注释原文片段 → 可执行样本） */
  const HEADER_SAMPLES: ReadonlyArray<{ anchor: string; text: string; reason: string }> = [
    {
      anchor: `本项目总体技术此基础上...`,
      text: "本项目总体技术此基础上，需要进一步说明系统的整体架构与部署方式。",
      reason: "缺连接字",
    },
    {
      anchor: `"医疗运 质量"`,
      text: "通过数据治理持续提升医疗运 质量与管理效率，形成数据闭环。",
      reason: "缺'营'字",
    },
    {
      anchor: `"功能模 入同一技术底座"`,
      text: "各个业务功能模 入同一技术底座，实现统一入口与统一权限。",
      reason: "缺'块'字",
    },
    {
      // R55 修复的那一条：数字形态（真实样本），旧模式不命中
      anchor: `"日均门诊患 15000 以上"`,
      text: "医院日均门诊患 15000 以上，峰值并发要求较高，需重点保障。",
      reason: "缺'者'字",
    },
    {
      anchor: `"整体采用 B/S...不依赖额外容 Windows"`,
      text: "系统整体采用 B/S 架构，客户端不依赖额外容 Windows 环境运行。",
      reason: "缺'兼'字",
    },
  ]

  /** BROKEN_PAIRS 每条模式自带的样本注释 */
  const PATTERN_SAMPLES: ReadonlyArray<{ anchor: string; text: string; reason: string }> = [
    {
      anchor: `"系统包 了"`,
      text: "本方案系统包 了从挂号到出院的全流程能力，覆盖全院业务。",
      reason: "缺'含'字",
    },
    {
      anchor: `"整体采 用"`,
      text: "平台整体采 用微服务架构进行建设，支持按需横向扩展。",
      reason: "缺'用'字",
    },
    {
      anchor: `"系统提 供"`,
      text: "系统提 供统一身份认证与单点登录能力，覆盖全部子系统。",
      reason: "缺'供'字",
    },
    {
      anchor: `"能够实 现"`,
      text: "平台能够实 现全院数据的统一汇聚与治理，支撑运营决策。",
      reason: "缺'现'字",
    },
    {
      anchor: `"系统支 持"`,
      text: "系统支 持多院区统一管理与独立核算，满足集团化要求。",
      reason: "缺'持'字",
    },
    {
      anchor: `"向用户提 给"`,
      text: "系统向用户提 给统一的访问入口与操作界面，降低使用门槛。",
      reason: "缺'供'字",
    },
    {
      anchor: `"管 理" 中间被空格切了`,
      text: "患者 管 理的完整闭环需要在本次建设中落地，并配套管理制度。",
      reason: "中间多空格",
    },
  ]

  const ALL = [...HEADER_SAMPLES, ...PATTERN_SAMPLES]

  it("每条样本注释都还在源码里（防止悄悄删掉文档而不删行为）", () => {
    for (const s of ALL) {
      expect(SRC, `源码里应仍记录样本：${s.anchor}`).toContain(s.anchor)
    }
  })

  it("每条样本都能被 detectLostChars 命中，且命中原因与其注释一致", () => {
    const missed: string[] = []
    for (const s of ALL) {
      const r = detectLostChars(s.text, 99)
      const ok = r.hits.some((h) => h.reason.includes(s.reason))
      if (!ok) missed.push(`${s.anchor} → 期望含「${s.reason}」，实得 ${JSON.stringify(r.hits.map((h) => h.reason))}`)
    }
    expect(missed, `注释承诺能查出来但实际查不出来的样本：\n${missed.join("\n")}`).toEqual([])
  })

  it("源码里每个丢字模式都必须有样本能命中它（新增模式却不配样本 → 变红）", () => {
    // 从源码抽出所有 reason（R55 实测 = 12 个模式），再要求每个 reason 都被某个样本命中。
    // 这条守的是「只加模式、不加验证」：新模式若无人能命中，等于又埋一个"注释说能查、代码查不出"。
    const sourceReasons = [...SRC.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1])
    expect(sourceReasons.length, "reason 字段数 = 模式数（R55 实测 12）").toBe(12)
    const hitReasons = ALL.flatMap((s) => detectLostChars(s.text, 99).hits.map((h) => h.reason))
    // 命中原因带「（期望：…）」后缀（pair.reason + expect），故按"包含"比对
    const uncovered = sourceReasons.filter((r) => !hitReasons.some((hr) => hr.includes(r)))
    expect(uncovered, `这些模式在源码里存在，但没有任何样本能命中它们：\n${uncovered.join("\n")}`).toEqual([])
  })

  it("正确写法与合法词不得误报（尤其 R55 新模式的边界）", () => {
    const negatives: ReadonlyArray<[string, string]> = [
      ["正确写法 门诊患者 + 数字", "医院日均门诊患者 15000 人以上，峰值并发要求较高，需重点保障。"],
      ["合法词 门诊患儿", "儿科门诊患儿 500 人次，需单独设置候诊区与分诊流程。"],
      ["门诊患者 + 无空白数字", "医院日均门诊患者15000人次以上，峰值并发要求较高。"],
      [
        "正确搭配全凑齐",
        "平台整体采用微服务架构；系统提供统一认证；系统能够实现数据汇聚；系统支持多院区；系统包含了全流程。",
      ],
    ]
    for (const [label, text] of negatives) {
      const r = detectLostChars(text, 99)
      expect(r.hits.map((h) => h.reason), `${label} 不应命中`).toEqual([])
    }
  })

  it("hits 按置信度排序：残缺搭配排在过短行之前（决定 summary 的「最严重」与徽标跳转锚点）", () => {
    // 第一行故意放一个 1 字短行（short_line），后面放残缺搭配（missing_modifier）
    const text = `正常的长正文第一段，用于凑够最低字数门槛。\n医\n各个业务功能模 入同一技术底座。\n医院日均门诊患 15000 以上，需重点保障。`
    const r = detectLostChars(text, 99)
    expect(r.hits.length).toBeGreaterThanOrEqual(2)
    expect(r.hits[0].kind).toBe("missing_modifier")
    expect(r.hits[r.hits.length - 1].kind).toBe("short_line")
    // summary 里的"最严重"必须就是 hits[0]
    expect(r.summary).toContain(r.hits[0].reason)
  })
})
