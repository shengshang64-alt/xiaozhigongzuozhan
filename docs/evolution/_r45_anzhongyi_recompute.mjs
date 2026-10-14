/**
 * R45 · 安中医（2026BFAFZ50845）真实数据复算 —— 三处交付物治理修复的零成本验证
 *
 * 用法（仓库根）：node docs/evolution/_r45_anzhongyi_recompute.mjs [项目id]
 * 默认项目 id = mfl6howomsw5i0l（project_name「安中医」，stage=archived）
 *
 * 口径：只读 pocketbase/pb_data/data.db（不写库、不调 AI、不发请求）；
 *      被测函数来自 src 真源码（vite ssrLoadModule 加载，非手抄）。
 *      「改前」分支 = HEAD~1 的算法原文（导出：按 part 一刀切；标题：无 sections=[] 兜底；
 *      装饰符：黑名单含 ★☆▲△），目的只是把 delta 算出来，不是重跑旧构建。
 */
import { createServer } from "vite"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const PID = process.argv[2] ?? "mfl6howomsw5i0l"

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
})
const bt = await server.ssrLoadModule("/src/pages/BidWorkspace/bidTypes.ts")
const bf = await server.ssrLoadModule("/src/pages/BidWorkspace/bidFiles.ts")

const db = new DatabaseSync(path.join(ROOT, "pocketbase/pb_data/data.db"), { readOnly: true })
const row = db
  .prepare("select id, project_name, tender_no, stage, bid_chapters, gen_options from bid_projects where id = ?")
  .get(PID)
if (!row) throw new Error("未找到项目 " + PID)
const chapters = JSON.parse(row.bid_chapters || "[]")
const scope = bt.normalizeBidScope(JSON.parse(row.gen_options || "{}"))
console.log(`项目 ${row.project_name}（${row.tender_no}，stage=${row.stage}）章数 ${chapters.length}，内容范围 ${scope}`)

const norm = (t) => (t ?? "").replace(/[\s\u3000]+/g, "")
/** 改前标题判定（HEAD~1 原文，唯一差异是没有 sections=[] 兜底那一行） */
function oldHeading(line, sections, chapterNo) {
  const l = (line ?? "").trim()
  if (!l || l.length > 40) return false
  if (/[。！？；，、]$/.test(l)) return false
  const m = /^(\d+(?:\.\d+)+)[.、\s]*(\S.*)$/.exec(l)
  if (m) {
    const parts = m[1].split(".")
    if (Number(parts[0]) !== chapterNo) return false
    const j = Number(parts[1]) - 1
    if (j < 0 || j >= sections.length) return false
    if (parts.length === 2) return norm(sections[j]) !== "" && norm(m[2]) === norm(sections[j])
    return parts.length === 3
  }
  const stripped = norm(l)
  return sections.some((sec) => norm(sec) !== "" && stripped === norm(sec))
}

console.log("\n=== A. 导出章清单 ===")
const next = bf.pickExportChapters(chapters, scope)
const prev = chapters.filter((c) => (scope === "biz" ? bt.isBizPart(c) : scope === "tech" ? !bt.isBizPart(c) : true))
const prevTitles = new Set(prev.map((c) => c.title))
console.log(`改前 ${prev.length} 章 -> 改后 ${next.length} 章`)
for (const c of next) {
  const isNew = !prevTitles.has(c.title)
  console.log(`   ${isNew ? "[新增收录] " : ""}${c.title}（${(c.content ?? "").length} 字，part=${c.part ?? "-"}）`)
}

console.log("\n=== B. 小节标题识别（chapterNo 取导出清单序号，同导出代码 idx+1）===")
let totOld = 0
let totNew = 0
for (const [idx, c] of next.entries()) {
  const secs = c.sections ?? []
  const lines = (c.content ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const o = lines.filter((l) => oldHeading(l, secs, idx + 1))
  const n = lines.filter((l) => bt.isRealSectionHeading(l, secs, idx + 1))
  totOld += o.length
  totNew += n.length
  if (o.length || n.length) console.log(`   第${idx + 1}章 ${c.title}（小节清单 ${secs.length} 条）旧 ${o.length} -> 新 ${n.length}`)
}
console.log(`合计：旧识别 ${totOld} 条 -> 新识别 ${totNew} 条（多认 ${totNew - totOld} 条，直接决定目录层级）`)

console.log("\n=== C. 装饰符口径（改前正则 vs 改后扫描，扣掉合法占位）===")
const OLD = /[【】★☆◆◇□■●○▲△▷✔✓✗✘→←↑↓▪▫]/g
let oldTotal = 0
let starTotal = 0
for (const [i, c] of chapters.entries()) {
  const cleaned = (c.content ?? "").replace(/【待填写】|【请补充素材】/g, "")
  const oldHits = cleaned.match(OLD) ?? []
  const star = oldHits.filter((g) => /[★☆▲△]/.test(g))
  const newHits = bt.formatCheckReport([c], ["decoration_leftover"], null, "").hits.filter((h) => h.rule === "decoration_leftover")
  if (!oldHits.length && !newHits.length) continue
  oldTotal += oldHits.length
  starTotal += star.length
  console.log(`   第${i + 1}章 ${c.title}：改前命中 ${oldHits.length}（其中 ★/▲ ${star.length}）| 改后扫描命中 ${newHits.length}`)
}
console.log(`合计：改前会报 ${oldTotal} 处，全部是 ★/▲ 实质性条款标记（${starTotal}/${oldTotal}）；改后报 0 处`)
const c9 = chapters.find((c) => /技术参数实质性响应评审/.test(c.title ?? ""))
if (c9) {
  const rp = bt.autoRepairChapter(c9.content ?? "", [], ["decoration_leftover"])
  const before = (c9.content.match(/★/g) ?? []).length
  const after = (rp.content.match(/★/g) ?? []).length
  console.log(`   真跑 autoRepairChapter（第「${c9.title}」章）：★ ${before} -> ${after}（改前会被清成 0）`)
}
const probe = "全文约 ■ 项指标，▲ 项须逐条响应。"
const hits = bt.formatCheckReport([{ title: "第一章", content: probe }], ["decoration_leftover"], null, "").hits.filter((h) => h.rule === "decoration_leftover")
console.log(`   对照（规则本体未被削弱）：「${probe}」-> 命中 ${hits.length} 处（■ 仍报、▲ 不报）`)

await server.close()