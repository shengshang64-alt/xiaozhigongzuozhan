/**
 * 标书全流程生成实测（2026-10-31）
 *
 * 走**真实代码路径**，不是模拟：
 *   检索（retrieveTenderFragments，含同义词扩展）
 *   → 全局事实（effectiveGlobalFacts）
 *   → 提示词组装（buildBidChapterMessages）
 *   → 真实模型（网关 /api/model-gw/chat，用路由选出的 minimax-m3）
 *
 * 用法：
 *   npx tsx scripts/bid-gen-e2e.mjs 3 1000    # 跑前 3 章，章预算 1000 字
 *   npx tsx scripts/bid-gen-e2e.mjs 0 2000    # 0=全部技术章，章预算 2000 字
 */
import { DatabaseSync } from "node:sqlite"
import { writeFileSync, appendFileSync } from "node:fs"
import {
  buildBidChapterMessages,
  effectiveGlobalFacts,
  retrieveTenderFragments,
} from "../src/pages/BidWorkspace/bidTypes.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }

const limit = Number(process.argv[2] ?? 3)
const budget = Number(process.argv[3] ?? 1000)
const OUT = "_bid_gen_result.json"
const LOG = "_bid_gen_log.txt"

function log(line) {
  console.log(line)
  appendFileSync(LOG, line + "\n", "utf8")
}

function loadContext() {
  const db = new DatabaseSync(DB, { readOnly: true })
  const p = db.prepare("SELECT * FROM bid_projects WHERE stage='evaluated' AND LENGTH(parse_report)>100 LIMIT 1").get()
  const mc = db.prepare("SELECT id, config_name FROM model_configs WHERE config_name='Intern'").get()
  db.close()
  const report = JSON.parse(p.parse_report)
  const chapters = JSON.parse(p.bid_chapters)
  const outline = JSON.parse(p.bid_outline ?? "[]")
  const facts = effectiveGlobalFacts({ global_facts: p.global_facts, parse_report: report, tender_no: p.tender_no })
  return { p, report, chapters, outline, facts, configId: mc.id }
}

async function callModel(configId, model, messages, maxTokens, disableThinking = true) {
  // 2026-10-31：必须传 disable_thinking。
  // 实测踩坑：minimax-m3 是推理模型，不关思考时长文任务会把预算全耗在思考链上，
  // 输出变成 "Let me plan content for each section: 11.1 ..." 这种英文草稿，
  // 而不是正文（实测生成 6485 字全是思考过程）。
  // 真实代码路径 generateInChunks 也是按 shouldDisableThinking(chunkChars) 关掉的。
  const body = JSON.stringify({
    config_id: configId,
    model,
    messages,
    max_tokens: maxTokens,
    ...(disableThinking ? { disable_thinking: true } : {}),
  })
  const t0 = Date.now()
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  return {
    ok: Boolean(d.ok),
    ms: Date.now() - t0,
    text: String(d.text ?? ""),
    err: String(d.message ?? d.error ?? d.code ?? ""),
  }
}

/** 质量自检：返回问题清单（空数组=通过） */
function auditContent(text, title) {
  const issues = []
  if (text.length < 300) issues.push(`字数过少(${text.length})`)
  const placeholders = (text.match(/XX|xxx|待补充|TBD|\[.*?待填.*?\]/g) ?? []).length
  if (placeholders > 0) issues.push(`占位符残留(${placeholders})`)
  const paragraphs = text.split(/\n+/).filter((l) => l.trim().length > 10)
  if (paragraphs.length < 3) issues.push(`段落过少(${paragraphs.length})`)
  // 重复句检测
  const sents = text.split(/[。；\n]/).map((s) => s.trim()).filter((s) => s.length > 20)
  const seen = new Map()
  for (const s of sents) seen.set(s, (seen.get(s) ?? 0) + 1)
  const dup = [...seen.entries()].filter(([, n]) => n >= 3)
  if (dup.length) issues.push(`重复句(${dup.length}条)`)
  // 空话检测
  const fluff = ["赋能", "抓手", "闭环生态", "全面提升", "全方位打造"].filter((w) => text.includes(w))
  if (fluff.length >= 2) issues.push(`空话词(${fluff.join("/")})`)
  return issues
}

async function main() {
  const ctx = loadContext()
  const { p, report, chapters, outline, facts, configId } = ctx
  const targets = chapters.filter((c) => c.part !== "biz")

  log(`=== 标书生成实测 ===`)
  log(`项目: ${p.project_name}`)
  log(`采购人: ${p.hospital}`)
  log(`章节: ${chapters.length} 总 / ${targets.length} 技术章`)
  log(`全局事实: ${facts.split("\n").length - 1} 条`)
  log(`章预算: ${budget} 字 | 本次跑: ${limit === 0 ? "全部" : limit + " 章"}\n`)

  const run = limit === 0 ? targets : targets.slice(0, limit)
  const results = []
  let totalMs = 0

  for (let i = 0; i < run.length; i += 1) {
    const ch = run[i]
    const idx = chapters.indexOf(ch)
    log(`[${i + 1}/${run.length}] ${ch.title}`)

    // ① 真实检索
    const frag = retrieveTenderFragments(p.tender_text, { title: ch.title, sections: ch.sections ?? [], clauses: [] }, 8000, 24)
    // ② 真实提示词组装
    const msgs = buildBidChapterMessages(
      p.project_name,
      p.hospital,
      report,
      outline,
      chapters,
      idx,
      (o) => (o ?? []).map((n) => n.title).join("\n"),
      { tenderFragments: frag, wordBudget: budget },
    )
    const promptChars = msgs.reduce((n, m) => n + String(m.content).length, 0)

    // ③ 真实模型调用（单次输出封顶 4096 token，与 longformBudget 一致）
    const r = await callModel(configId, "minimax-m3", msgs, Math.min(4096, Math.max(2048, budget * 2)), true)
    totalMs += r.ms

    if (!r.ok) {
      log(`  ✗ 调用失败 ${r.ms}ms: ${r.err.slice(0, 80)}\n`)
      results.push({ title: ch.title, ok: false, err: r.err, ms: r.ms, fragLen: frag.length, promptChars })
      continue
    }

    const issues = auditContent(r.text, ch.title)
    const mark = issues.length === 0 ? "✓" : "△"
    log(`  ${mark} 生成 ${r.text.length} 字 / ${(r.ms / 1000).toFixed(1)}s | 上下文 ${frag.length} 字 + 提示词 ${promptChars.toLocaleString()} 字`)
    if (issues.length) log(`     问题: ${issues.join(", ")}`)

    results.push({
      title: ch.title,
      ok: true,
      ms: r.ms,
      chars: r.text.length,
      fragLen: frag.length,
      promptChars,
      issues,
      content: r.text,
    })
    log("")
  }

  // 汇总
  const okOnes = results.filter((r) => r.ok)
  const totalChars = okOnes.reduce((n, r) => n + r.chars, 0)
  log("=".repeat(70))
  log(`=== 汇总 ===`)
  log(`成功: ${okOnes.length}/${results.length} 章`)
  log(`总字数: ${totalChars.toLocaleString()} 字`)
  log(`总耗时: ${(totalMs / 1000).toFixed(1)}s（平均 ${(totalMs / Math.max(1, results.length) / 1000).toFixed(1)}s/章）`)
  const withIssues = okOnes.filter((r) => r.issues.length > 0)
  log(`质量自检: ${okOnes.length - withIssues.length}/${okOnes.length} 章无问题`)
  if (withIssues.length) {
    log(`有问题的章:`)
    for (const r of withIssues) log(`  · ${r.title}: ${r.issues.join(", ")}`)
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1), "utf8")
  log(`\n结果已存 ${OUT}，日志 ${LOG}`)
}

main().catch((e) => {
  console.error("失败:", e)
  process.exit(1)
})
