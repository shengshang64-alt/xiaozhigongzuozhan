// T13 真实招标文件 × 真实模型 验收测试（2026-09-28 解析重构）
//
// 默认跳过（不消耗模型费用、不依赖本机文件）；设 E2E=1 触发：
//   E2E=1 npx vitest run src/pages/BidWorkspace/e2eRealParse.test.ts
//
// 链路与应用 parseSectionViaRetrieval 完全同构：
//   提取（docx 表格感知 → 竖线行）→ buildScoringMaterial（评分章定向素材）/ selectRelevantChunks（检索）
//   → buildSectionParseMessages → 本地网关（disable_thinking）→ normalizeSectionRawText。
// 验收口径（人工核对输出与原文）：评分项分值/档位与原文一致、出处可回指、评分构成行只抄原文声明。
//
// 文件路径可用环境变量覆盖：TENDER_FILE / TENDER_FILE_ALT。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import mammoth from "mammoth"
import { buildSectionParseMessages, PROMPT_VERSION } from "./prompts/sectionParse"
import { buildScoringMaterial } from "./prompts/tenderStructure"
import { normalizeSectionRawText } from "./bidTypes"

const TENDER_FILE = process.env.TENDER_FILE ?? "C:/Users/Administrator/Desktop/新建文件夹/中西医结合第四批招标文件.docx"
const TENDER_FILE_ALT =
  process.env.TENDER_FILE_ALT ??
  "D:/重要文件/A重要客户情况/友商公司产品/招标材料及方案/（东华656-2021）安庆市第二人民医院智慧医院信息化系统招标文件正文.docx"
const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:7000/api/model-gw/chat"
const GATEWAY_USER = process.env.E2E_GATEWAY_USER ?? "local-user"
const CONFIG_ID = process.env.E2E_CONFIG_ID ?? ""
const MODEL = process.env.E2E_MODEL ?? ""

// node 环境无 DOMParser：按 extractDocxText（bidFiles.ts）的表格感知口径用正则等价复刻
function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}
function stripTags(s: string): string {
  return decode(s.replace(/<[^>]+>/g, "\n"))
}
function cellText(html: string): string {
  const raw = stripTags(html)
  const rows = raw.split(/\n+/).map((x) => x.trim()).filter(Boolean)
  if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("")
  return raw.replace(/\s+/g, " ").trim()
}
function docxToLines(html: string): string[] {
  const lines: string[] = []
  const re = /<table[\s\S]*?<\/table>|<p[\s\S]*?<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const block = m[0]
    if (/^<table/i.test(block)) {
      const rowRe = /<tr[\s\S]*?<\/tr>/gi
      let rm: RegExpExecArray | null
      while ((rm = rowRe.exec(block))) {
        const cells: string[] = []
        const cellRe = /<t[dh][\s\S]*?<\/t[dh]>/gi
        let cm: RegExpExecArray | null
        while ((cm = cellRe.exec(rm[0]))) cells.push(cellText(cm[0]))
        const cleaned = cells.filter((c, i) => c !== "" || (cells[i - 1] ?? "") !== "")
        if (cleaned.some((c) => c)) lines.push(cleaned.join(" | "))
      }
      lines.push("")
    } else {
      const text = stripTags(block).replace(/[ \t]+/g, " ").trim()
      if (text) lines.push(text)
    }
  }
  return lines
}

async function tenderText(path: string): Promise<string> {
  const buf = readFileSync(path)
  const res = await mammoth.convertToHtml({ buffer: buf } as never)
  return docxToLines(res.value ?? "").join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

async function gatewayChat(messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": GATEWAY_USER },
    body: JSON.stringify({
      ...(CONFIG_ID ? { config_id: CONFIG_ID } : {}),
      ...(MODEL ? { model: MODEL } : {}),
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      disable_thinking: true,
    }),
    signal: AbortSignal.timeout(180000),
  })
  const j = (await res.json()) as { ok?: boolean; text?: string; message?: string }
  if (!j.ok) throw new Error(`网关失败: ${j.message}`)
  return j.text ?? ""
}

const e2e = process.env.E2E === "1" ? it : it.skip

e2e(
  "tech_score 全链路：评分章定向素材（中西医结合第四批）",
  async () => {
    const text = await tenderText(TENDER_FILE)
    expect(text.length).toBeGreaterThan(10000)
    const material = buildScoringMaterial(text)
    expect(material).not.toBe("") // 评分章必须能本地定位（T13 主修复）
    const msgs = buildSectionParseMessages("tech_score", material, { sourceMode: "retrieval" })
    const out = normalizeSectionRawText("tech_score", await gatewayChat(msgs as never, 8192))
    console.log("=== tech_score 输出 ================\n" + out + "\n===================================")
    expect(out.length).toBeGreaterThan(400)
    expect(out).toContain("分") // 有分值行
    expect(out).not.toContain("原文未提及") // 评分章内不允许整项缺失
  },
  240000,
)

e2e(
  "biz_score 全链路：节级内嵌评分表（安庆二院）",
  async () => {
    const text = await tenderText(TENDER_FILE_ALT)
    const material = buildScoringMaterial(text)
    expect(material).not.toBe("")
    const msgs = buildSectionParseMessages("biz_score", material, { sourceMode: "retrieval" })
    const out = normalizeSectionRawText("biz_score", await gatewayChat(msgs as never, 8192))
    console.log("=== biz_score 输出 ================\n" + out + "\n===================================")
    expect(out.length).toBeGreaterThan(400)
    // T13 硬校验：分部之和 ≠ 总分的「评分构成」行必须已被剥除（安庆原文只声明满分 100）
    expect(out).not.toMatch(/评分构成[：:].*(?:技术|商务|价格).*\d+\s*分/)
  },
  240000,
)

// PROMPT_VERSION 指纹（防止静默改字后验收基线漂移）
describe("e2eRealParse 契约", () => {
  it("sectionParse PROMPT_VERSION", () => {
    // v6（R54 2026-10-16）：mode=full 的素材不再被 clip 到 14,000 —— 修「标称『招标文件全文』却静默截断」的契约不一致
    // 上一版 v5（2026-10 易标对齐）：tech_score/biz_score 注入「评分项 vs 评分要求」语义区分
    expect(PROMPT_VERSION).toBe(6)
  })
})
