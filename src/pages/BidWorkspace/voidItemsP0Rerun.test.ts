// P0 解析根因复跑验证（2026-11-01）：void_items 收录三条铁律上真实文档后的对照读数
//
// 默认跳过（耗模型费用）；设 E2E=1 触发：
//   E2E=1 npx vitest run src/pages/BidWorkspace/voidItemsP0Rerun.test.ts
//
// 链路与应用整文通道完全同构（useBidWorkspace 8180 行起）：
//   库内 tender_text（只读副本）→ splitTenderText(45,000) → buildWholeParseMessages 逐段
//   → 本地网关 → buildSegmentMergeMessages 合并 → 计量（行数/条款前缀率/语义占比/标题行）。
//
// 修前基线（三模型真实数据审计 2026-10-28 + voidItemsNoise 实测）：
//   安中医 void_items 原始 800 行，含废标语义仅 35 行（4%），仅 2 行带「条款：」前缀。
const e2e = process.env.E2E === "1" ? it : it.skip

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
import { dropParsePageNoise, rejoinVoidItemLines, verifyVoidItemCitations, dedupeVoidItemLines } from "./bidTypes"

const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:7000/api/model-gw/chat"
const GATEWAY_USER = process.env.E2E_GATEWAY_USER ?? "local-user"
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "mfl6howomsw5i0l" // 安中医 2026BFAFZ50845

// 与 bidTypes.ts VOID_SEMANTIC_RE 同源（不导出，此处仅计量用副本；漂移时以源文件为准）
const VOID_SEMANTIC_RE =
  /无效|废标|否决|不予受理|不合格|不予接受|拒绝其投标|视为(?:未|放弃|拒绝|无效|撤回)|串通|重大偏差|实质性偏离|实质性响应|作无效|按无效|取消(?:其)?(?:投标|中标)资格|不得参加|不能参加/

function snapshotDb(): { dbPath: string; tmpDir: string } {
  const dir = "pocketbase/pb_data"
  const tmpDir = mkdtempSync(join(tmpdir(), "p0rerun-"))
  for (const suffix of ["data.db", "data.db-wal", "data.db-shm"]) {
    const src = join(dir, suffix)
    if (existsSync(src)) copyFileSync(src, join(tmpDir, suffix))
  }
  return { dbPath: join(tmpDir, "data.db"), tmpDir }
}

async function gatewayChat(messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  // 429 退避重试：真实网关按服务商限流，最多 4 次（10s/30s/90s）
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

function measure(label: string, content: string) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean)
  const prefixHits = lines.filter((l) => /^(?:条款|重点补充)[:：]/.test(l)).length
  const headingLines = lines.filter((l) => /^#{1,6}\s/.test(l)).length
  const halfSentence = lines.filter((l) => !/[。；;！？!?]$/.test(l) && !/^(?:条款|重点补充)[:：]/.test(l)).length
  const semanticHits = lines.filter((l) => VOID_SEMANTIC_RE.test(l)).length
  const citedLines = lines.filter((l) => /（第?[^）]{0,20}(?:条|章|部分|表|项|注)[^）]{0,12}）/.test(l)).length
  const report = {
    label,
    总行数: lines.length,
    条款前缀行: prefixHits,
    标题行: headingLines,
    无句末标点行: halfSentence,
    含废标语义行: semanticHits,
    语义占比: lines.length ? Math.round((semanticHits / lines.length) * 100) + "%" : "—",
    带原文出处行: citedLines,
    出处占比: lines.length ? Math.round((citedLines / lines.length) * 100) + "%" : "—",
  }
  console.log("=== " + label + " ===")
  console.log(JSON.stringify(report, null, 2))
  return { lines, report }
}

e2e("void_items P0 复跑：安中医整文通道全链路（修前 800 行基线对照）", async () => {
  // 1. 取安中医招标文件原文（活库只读快照，不动线上数据）
  const { dbPath, tmpDir } = snapshotDb()
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = db.prepare("SELECT tender_text FROM bid_projects WHERE id = ?").get(PROJECT_ID) as {
    tender_text: string
  }
  db.close()
  const text = (row?.tender_text ?? "").trim()
  expect(text.length).toBeGreaterThan(100000) // 安中医原文约 15.2 万字

  // 2. 整文通道：按线上同款切段
  const segments = splitTenderText(text, PARSE_SEGMENT_CHARS)
  expect(segments.length).toBeGreaterThan(1) // 15.2 万字 → 约 4 段
  console.log(`原文 ${text.length} 字 → ${segments.length} 段`)

  // 3. 逐段解析（同 buildWholeParseMessages + 网关）
  const results: { index: number; total: number; content: string }[] = []
  for (let i = 0; i < segments.length; i++) {
    const msgs = buildWholeParseMessages("void_items", segments[i], { index: i + 1, total: segments.length })
    const out = await gatewayChat(msgs as never, 8192)
    expect(out.trim().length).toBeGreaterThan(50)
    results.push({ index: i + 1, total: segments.length, content: out })
    console.log(`第 ${i + 1}/${segments.length} 段完成，${out.trim().split("\n").length} 行`)
  }

  // 4. 合并段（同 buildSegmentMergeMessages）
  const merged =
    results.length === 1
      ? results[0].content
      : await gatewayChat(buildSegmentMergeMessages("void_items", results, "markdown") as never, 8192)

  // 5. 计量：模型原始输出（不经清洗层）
  const raw = measure("模型原始输出（未经清洗）", merged)
  // 6. 计量：线上一致管线 = 页眉页脚清洗 → 断句重接（结构修复） → 出处核验（杀编造编号/贴牌）
  //    → 内容去重（杀合并残留重复） → 再过一次语义过滤（关键顺序：核验后再算语义占比，
  //    否则编造的「…投标无效（第4.1.N条）」假行会虚抬语义占比让过滤器不触发——实测 49% 虚高）
  const cleaned = measure(
    "线上管线（清洗+重接+出处核验+去重+语义过滤）",
    rejoinVoidItemLines(dedupeVoidItemLines(verifyVoidItemCitations(rejoinVoidItemLines(dropParsePageNoise(merged)), text))),
  )

  const cleanedText = rejoinVoidItemLines(
    dedupeVoidItemLines(verifyVoidItemCitations(rejoinVoidItemLines(dropParsePageNoise(merged)), text)),
  )
  console.log("=== 模型合并原文（未经管线） ===\n" + merged.trim() + "\n====================")
  console.log("=== 清洗后全文（线上管线产物，覆盖矩阵实际消费） ===\n" + cleanedText + "\n====================")

  // 7. P0 硬断言：与修前基线（800 行 / 4% 语义 / 2 行前缀 / 出处全靠编）拉开数量级差距。
  // 修后真条款规模：须知正文废标条款(~22) + 审查表硬要求(~6) + 格式注(~4) + 异常低价(~2) + 重点补充(≤3)
  // ≈ 30-40 条；对接/参数/合同条款虽有出处但无废标后果，被语义过滤剔除。
  expect(raw.report.总行数).toBeLessThanOrEqual(280) // 修前 800 → 修后 ≤280（结构性噪音已绝迹）
  expect(raw.report.标题行).toBe(0) // markdown 小节标题绝迹
  expect(raw.report.无句末标点行).toBeLessThanOrEqual(5) // 物理断行残句绝迹
  expect(cleaned.report.总行数).toBeLessThanOrEqual(60) // 核验+去重+语义后收敛到真条款规模
  expect(cleaned.report.总行数).toBeGreaterThanOrEqual(12) // 但不许把真条款也杀掉（voidClauseFloor 下限）
  expect(cleaned.report.语义占比).not.toBe("—") // 计量正常产出

  // 清理临时库快照
  rmSync(tmpDir, { recursive: true, force: true })
}, 1500000)
