// P1 评分条数门禁（2026-11-01）：tech_score / biz_score 在真实文档上必须解析出非零条数。
//
// 默认跳过（耗模型费用）；设 E2E=1 触发：
//   E2E=1 npx vitest run src/pages/BidWorkspace/scoringGate.test.ts
//
// 对应审计发现「评分项解析不到」——评分表跨段断裂/窗口内无完整表是主因（R48b 修复说明）。
// 链路与线上 tech_score 通道同构：tender_text → buildScoringMaterial（评分章定向素材）
// → buildSectionParseMessages（retrieval 模式）→ 网关 → extractScoringFromText 读条数。
const gate = process.env.E2E === "1" ? it : it.skip

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { it, expect } from "vitest"

import { buildSectionParseMessages } from "./prompts/sectionParse"
import { buildScoringMaterial } from "./prompts/tenderStructure"
import { extractScoringFromText } from "./bidTypes"

const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:7000/api/model-gw/chat"
const GATEWAY_USER = process.env.E2E_GATEWAY_USER ?? "local-user"

const FIXTURES = [
  // 2026-11-01 首轮门禁实测校准：安中医 tech 0 条是「（0-5分）区间分值不被 extractScoringFromText
  // 识别」的解析器缺陷（已修），修复后应 ≥8；安庆 tech 2 条是模型抽取不足的真基线，门禁锁住不许再降。
  { id: "mfl6howomsw5i0l", name: "安中医", minTech: 5, minBiz: 1 },
  { id: "b3h7w7nw9ap6gxs", name: "安庆二院", minTech: 2, minBiz: 1 },
  { id: "n6l21cok5x688tg", name: "建阳", minTech: 5, minBiz: 1 },
]

function snapshotDb(): { dbPath: string; tmpDir: string } {
  const dir = "pocketbase/pb_data"
  const tmpDir = mkdtempSync(join(tmpdir(), "scoregate-"))
  for (const suffix of ["data.db", "data.db-wal", "data.db-shm"]) {
    const src = join(dir, suffix)
    if (existsSync(src)) copyFileSync(src, join(tmpDir, suffix))
  }
  return { dbPath: join(tmpDir, "data.db"), tmpDir }
}

async function gatewayChat(messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  // 429 退避：与 voidItemsGate 同款（真实网关按服务商限流，最多 4 次、最长 90s）
  const delays = [0, 10_000, 30_000, 90_000]
  let lastErr: Error | null = null
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
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
  }
  throw lastErr ?? new Error("网关失败: 未知错误")
}

for (const fx of FIXTURES) {
  gate(`评分条数门禁 · ${fx.name}`, async () => {
    const { dbPath, tmpDir } = snapshotDb()
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare("SELECT tender_text FROM bid_projects WHERE id = ?").get(fx.id) as { tender_text: string }
    db.close()
    const text = (row?.tender_text ?? "").trim()
    expect(text.length).toBeGreaterThan(30000)

    const material = buildScoringMaterial(text)
    expect(material).not.toBe("") // 评分章必须能本地定位

    // tech_score
    const techMsgs = buildSectionParseMessages("tech_score", material, { sourceMode: "retrieval" })
    const techOut = await gatewayChat(techMsgs as never, 8192)
    const techItems = extractScoringFromText(techOut)
    console.log(`=== ${fx.name} tech_score ${techItems.length} 条 ===`)
    console.log(techOut.slice(0, 1200))

    // biz_score
    const bizMsgs = buildSectionParseMessages("biz_score", material, { sourceMode: "retrieval" })
    const bizOut = await gatewayChat(bizMsgs as never, 8192)
    const bizItems = extractScoringFromText(bizOut)
    console.log(`=== ${fx.name} biz_score ${bizItems.length} 条 ===`)
    console.log(bizOut.slice(0, 800))

    // 门禁：真实文档评分项不许为零（修前「评分解析不到」的回归锁）
    expect(techItems.length).toBeGreaterThanOrEqual(fx.minTech)
    expect(bizItems.length).toBeGreaterThanOrEqual(fx.minBiz)

    rmSync(tmpDir, { recursive: true, force: true })
  }, 900000) // 429 退避预算（10+30+90s ×2 次评分调用）+ 单次生成，上限对齐 voidItemsGate
}
