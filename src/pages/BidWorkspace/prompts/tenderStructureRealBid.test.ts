// REQ-015 真实库回归（三份真招标 docx 真链路）：锁定「合写评分章」修复不再回退。
//
// 为什么要单独一个文件：tenderStructure.test.ts 用的是合成文本（快、稳，但只能证明函数行为）；
// 本文件用**用户机器上的真招标文件**、走**项目真实提取链路**（mammoth → bidFiles.extractDocxText 口径），
// 直接断言修复后三份语料的评分素材字数——这是派单的验收标准本身。
//
// 语料不存在时整组跳过（CI/他机不该红）；跳过会在输出里写明 SKIP 原因，不冒充"已实测"。
// 运行：node node_modules/vitest/vitest.mjs run src/pages/BidWorkspace/prompts/tenderStructureRealBid.test.ts
/** @vitest-environment jsdom */
// ↑ 本文件需要 DOMParser（extractDocxText 口径依赖它）；与 bidFocusJump.test.ts 同款单文件环境声明，
//   不污染全局 node 环境。曾用 node 环境跑过一次 → ReferenceError: DOMParser is not defined 整组失败。
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { beforeAll, describe, expect, it } from "vitest"
import { buildScoringMaterial, detectTenderChapters } from "./tenderStructure"

const req = createRequire(import.meta.url)
const mammoth = req("mammoth") as { convertToHtml: (o: { buffer: Buffer }) => Promise<{ value?: string }> }

const ROOT = "D:/重要文件/A重要客户情况"
const CASES = [
  {
    label: "海沧",
    path: `${ROOT}/B标书/2022年标书/2022年标书/厦门市海沧医院互联互通测评（四级甲等）/招标文件——厦门市海沧医院互联互通测评（四级甲等）项目.docx`,
    minChars: 12000, // 修复前 0；修复后 12437
    scoringChapter: "资格审查与评标",
  },
  {
    label: "福安",
    path: `${ROOT}/B标书/2022年标书/2022年标书/信息化智能化采购项目/信息化智能化采购项目招标文件－发售稿.docx`,
    minChars: 12000, // 修复前 0；修复后 13051
    scoringChapter: "资格审查与评标",
  },
  {
    label: "安庆（对照：必须不变）",
    path: `${ROOT}/友商公司产品/招标材料及方案/（东华656-2021）安庆市第二人民医院智慧医院信息化系统招标文件正文.docx`,
    exactChars: 5037, // 修复前后均为 5037（该文件评分办法内嵌在须知章，走节级路径）
    scoringChapter: null,
  },
] as const

/** 逐字对齐 bidFiles.extractDocxText 的 DOM walk（唯一差异：从 buffer 读，因为测试无 File） */
function decode(s: string) {
  return s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
}
function htmlToText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html")
  const cellText = (td: Element) => {
    const raw = decode(td.textContent ?? "")
    const rows = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("")
    return raw.replace(/\s+/g, " ").trim()
  }
  const lines: string[] = []
  const walk = (el: Element) => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase()
      if (tag === "table") {
        for (const tr of Array.from(node.querySelectorAll("tr"))) {
          const cells = Array.from(tr.children).map((td) => cellText(td)).filter(Boolean)
          if (cells.some((c) => c)) lines.push(cells.join(" | "))
        }
        lines.push("")
      } else if (tag === "br") lines.push("")
      else if (node.children.length > 0 && node.querySelector("table, p")) walk(node)
      else {
        const t = decode(node.textContent ?? "").replace(/[ \t]+/g, " ").trim()
        if (t) lines.push(t)
      }
    }
  }
  walk(parsed.body)
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

const available = CASES.filter((c) => existsSync(c.path))
const missing = CASES.filter((c) => !existsSync(c.path))
if (missing.length) console.warn(`[REQ-015 真实库回归] 语料缺失，跳过 ${missing.length} 份：${missing.map((m) => m.label).join("、")}`)

describe.skipIf(available.length === 0)("REQ-015 真实库回归：合写评分章（真 docx 真链路）", () => {
  const extracted = new Map<string, string>()
  beforeAll(async () => {
    for (const c of available) {
      const res = await mammoth.convertToHtml({ buffer: readFileSync(c.path) })
      extracted.set(c.path, htmlToText(res.value ?? ""))
    }
  }, 120_000)

  for (const c of available) {
    it(`${c.label}：评分素材不得为 0${"minChars" in c ? `（≥${c.minChars} 字）` : `（锁定 ${"exactChars" in c ? c.exactChars : ""} 字）`}`, () => {
      const text = extracted.get(c.path)!
      expect(text.length).toBeGreaterThan(1000)
      const mat = buildScoringMaterial(text)
      const chars = mat.replace(/\s+/g, "").length
      // 派单验收 1：三份都不得为 0
      expect(chars).toBeGreaterThan(0)
      if ("minChars" in c) expect(chars).toBeGreaterThanOrEqual(c.minChars)
      if ("exactChars" in c) expect(chars).toBe(c.exactChars)
      if (c.scoringChapter) {
        // 派单验收 2：根因 A 真修掉——章级分类必须认到「资格审查与评标」
        const scoring = detectTenderChapters(text).filter((s) => s.category === "scoring")
        expect(scoring.length).toBeGreaterThan(0)
        expect(scoring.some((s) => s.title.replace(/\s+/g, "").includes(c.scoringChapter!))).toBe(true)
      }
    })
  }
})
