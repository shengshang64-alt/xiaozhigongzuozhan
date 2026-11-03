// P1 真实文档验收门禁（2026-11-01）：解析链路改动的「真实标书跑通」硬门槛。
//
// 默认跳过（耗模型费用）；设 E2E=1 触发：
//   E2E=1 npx vitest run src/pages/BidWorkspace/voidItemsGate.test.ts
//
// 设计原则（对应《三模型真实数据审计 2026-10-28》「玩具数据自洽 ≠ 真实文档验收」）：
// - 输入 = 库内三份真实招标文件原文（安中医/安庆二院/建阳），不是手工小样；
// - 管线 = 与线上完全同构（splitTenderText → buildWholeParseMessages → 网关 →
//   buildSegmentMergeMessages → rejoinVoidItemLines → verifyVoidItemCitations →
//   dedupeVoidItemLines → 再过语义过滤）；
// - 断言 = 阈值固化（修前 800 行/语义 4% 的基线对照），任何让结果恶化的改动在此现形。
//
// 基线读数（2026-11-01 安中医复跑）：模型原始 263 行 → 管线后 28 条真条款（语义占比 96%）。
const gate = process.env.E2E === "1" ? it : it.skip

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { it, expect } from "vitest"

import {
  PARSE_SEGMENT_CHARS,
  buildSegmentMergeMessages,
  buildWholeParseMessages,
} from "./prompts/wholeParse"
import { splitTenderText } from "./prompts/tenderSplit"
import {
  dropParsePageNoise,
  rejoinVoidItemLines,
  verifyVoidItemCitations,
  dedupeVoidItemLines,
} from "./bidTypes"

const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:7000/api/model-gw/chat"
const GATEWAY_USER = process.env.E2E_GATEWAY_USER ?? "local-user"

const VOID_SEMANTIC_RE =
  /无效|废标|否决|不予受理|不合格|不予接受|拒绝其投标|不通过|拒收|拒不|视为(?:未|放弃|拒绝|无效|撤回)|串通|重大偏差|实质性偏离|实质性响应|作无效|按无效|取消(?:其)?(?:投标|中标)资格|不得参加|不能参加/

type Fixture = { id: string; name: string; expect: { maxLines: number; minLines: number } }

const FIXTURES: Fixture[] = [
  { id: "mfl6howomsw5i0l", name: "安中医（2026BFAFZ50845）", expect: { maxLines: 60, minLines: 12 } },
  // 2026-11-01 首轮门禁实测校准：安庆 212 行里 ~145 行是「（第X条）/未提及具体条款号」占位编造
  // （已被 PLACEHOLDER_CITE_RE 拦截），真条款 ~65 行；建阳 87 行全是带真出处的实条款（含合同违约）。
  { id: "b3h7w7nw9ap6gxs", name: "安庆二院（智慧医院信息化）", expect: { maxLines: 100, minLines: 8 } },
  { id: "n6l21cok5x688tg", name: "建阳区总医院（集成平台）", expect: { maxLines: 120, minLines: 8 } },
]

function snapshotDb(): { dbPath: string; tmpDir: string } {
  const dir = "pocketbase/pb_data"
  const tmpDir = mkdtempSync(join(tmpdir(), "voidgate-"))
  for (const suffix of ["data.db", "data.db-wal", "data.db-shm"]) {
    const src = join(dir, suffix)
    if (existsSync(src)) copyFileSync(src, join(tmpDir, suffix))
  }
  return { dbPath: join(tmpDir, "data.db"), tmpDir }
}

async function gatewayChat(messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  const delays = [0, 10_000, 30_000, 90_000]
  let lastErr: Error | null = null
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Rh-User-Id": GATEWAY_USER },
        body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0, disable_thinking: true }),
        signal: AbortSignal.timeout(300000),
      })
      const j = (await res.json()) as { ok?: boolean; text?: string; message?: string }
      if (!j.ok) {
        if (/(429|频率超限)/.test(j.message ?? "")) {
          lastErr = new Error(`网关失败: ${j.message}`)
          continue
        }
        throw new Error(`网关失败: ${j.message}`)
      }
      return j.text ?? ""
    } catch (e) {
      lastErr = e as Error
      if (!/(429|频率超限)/.test(lastErr.message)) throw lastErr
    }
  }
  throw lastErr ?? new Error("网关失败: 未知错误")
}

async function parseVoidItems(tenderText: string): Promise<string> {
  const segments = splitTenderText(tenderText, PARSE_SEGMENT_CHARS)
  const results: { index: number; total: number; content: string }[] = []
  for (let i = 0; i < segments.length; i++) {
    const msgs = buildWholeParseMessages("void_items", segments[i], { index: i + 1, total: segments.length })
    const out = await gatewayChat(msgs as never, 8192)
    results.push({ index: i + 1, total: segments.length, content: out })
  }
  const merged =
    results.length === 1
      ? results[0].content
      : await gatewayChat(buildSegmentMergeMessages("void_items", results, "markdown") as never, 8192)
  // 线上管线（与 useBidWorkspace 4290 行一致）：清洗 → 重接 → 出处核验 → 去重 → 语义过滤
  return rejoinVoidItemLines(
    dedupeVoidItemLines(verifyVoidItemCitations(rejoinVoidItemLines(dropParsePageNoise(merged)), tenderText)),
  )
}

function gateReport(lines: string[]) {
  const semantic = lines.filter((l) => VOID_SEMANTIC_RE.test(l)).length
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).length
  const halfSentence = lines.filter((l) => !/[。；;！？!?]$/.test(l) && !/^(?:条款|重点补充)[:：]/.test(l)).length
  return {
    总行数: lines.length,
    语义占比: lines.length ? Math.round((semantic / lines.length) * 100) + "%" : "—",
    标题行: headings,
    无句末标点行: halfSentence,
  }
}

for (const fx of FIXTURES) {
  gate(`void_items 门禁 · ${fx.name}`, async () => {
    const { dbPath, tmpDir } = snapshotDb()
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare("SELECT tender_text FROM bid_projects WHERE id = ?").get(fx.id) as { tender_text: string }
    db.close()
    const text = (row?.tender_text ?? "").trim()
    expect(text.length).toBeGreaterThan(30000)

    const out = await parseVoidItems(text)
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean)
    const rep = gateReport(lines)
    console.log(`=== ${fx.name} 门禁读数 ===`)
    console.log(JSON.stringify(rep, null, 2))
    console.log("=== 门禁输出全文 ===\n" + out + "\n====================")

    // 硬性门禁：结构性噪音绝迹 + 收敛到真条款规模 + 不杀真条款
    expect(rep.标题行).toBe(0) // markdown 标题绝迹
    expect(rep.无句末标点行).toBeLessThanOrEqual(5) // 物理断行残句绝迹
    expect(rep.总行数).toBeLessThanOrEqual(fx.expect.maxLines) // 修前 800 → 收敛上限
    expect(rep.总行数).toBeGreaterThanOrEqual(fx.expect.minLines) // 不许把真条款杀掉

    rmSync(tmpDir, { recursive: true, force: true })
  }, 900000)
}
