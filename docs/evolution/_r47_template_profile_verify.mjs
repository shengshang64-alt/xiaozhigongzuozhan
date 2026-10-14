/**
 * R47（B20）· 商务模板自动识别 —— 在【真实 docx / 真实招标原文】上的端到端取证
 *
 * 用法：node docs/evolution/_r47_template_profile_verify.mjs
 * 素材（全部 gitignored，可从本机复原）：
 *   · 模板候选 3 份真实 docx：模板库文档 / 本系统产出的真实标书 / 真实场景交付样本
 *   · 招标原文 .diag/r47-scratch/az-tender.txt（= pb_data.bid_projects.tender_text，
 *     安徽中医药大学第一附属医院项目，152,212 字）
 *
 * 特点：零 AI、零网络、零写库。只跑产品自身的 extractTemplateProfileBundle /
 *       normalizeTemplateProfile / templateRequirementLines，并做「落库往返」与「空画像不覆盖」检查。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const win = new JSDOM("").window
globalThis.DOMParser = win.DOMParser

let failed = 0
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${extra ? "  " + extra : ""}`)
  if (!cond) failed++
}

const TEMPLATES = [
  ["模板库文档", ".probe/pb-smoke/data/template-library/solution-cover-example.docx"],
  ["本系统产出标书", ".diag/r45-reexport/安中医-投标文件.docx"],
  ["真实场景交付样本", "_eval/安庆二院投标文件-真实场景交付样本-2026-10-13.docx"],
]
const TENDER = ".diag/r47-scratch/az-tender.txt"

const server = await createServer({
  root: ROOT, configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
})
const tp = await server.ssrLoadModule("/src/pages/BidWorkspace/templateProfile.ts")
const bt = await server.ssrLoadModule("/src/pages/BidWorkspace/bidTypes.ts")

function toFile(rel) {
  const p = path.join(ROOT, rel)
  const buf = fs.readFileSync(p)
  return new File([new Uint8Array(buf)], path.basename(p), {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })
}

const tenderText = fs.existsSync(path.join(ROOT, TENDER)) ? fs.readFileSync(path.join(ROOT, TENDER), "utf8") : ""
console.log("=== 0. 素材 ===")
console.log(`招标原文：${tenderText ? `${tenderText.length} 字` : "缺失（将跳过对齐断言）"}`)
for (const [label, rel] of TEMPLATES) {
  const p = path.join(ROOT, rel)
  console.log(`模板「${label}」：${fs.existsSync(p) ? `${(fs.statSync(p).size / 1024).toFixed(0)} KB  ${rel}` : "缺失"}`)
}

const profiles = []
for (const [label, rel] of TEMPLATES) {
  if (!fs.existsSync(path.join(ROOT, rel))) continue
  console.log(`\n=== 1. 识别「${label}」 ===`)
  const bundle = await tp.extractTemplateProfileBundle(toFile(rel), { tenderText })
  const pf = bundle.profile
  profiles.push({ label, pf, bundle })

  console.log(`  页面：${pf.page.paper}  页边距(上下左右) ${Object.values(pf.page.margins).join(" / ")}`)
  console.log(`  正文：${pf.body.font || "(未识别)"} ${pf.body.sizePt || "?"}pt 行距 ${pf.body.lineSpacing} 首行缩进 ${pf.body.firstIndent}`)
  console.log("  标题级：")
  for (const h of pf.headings) {
    console.log(`    ${h.level} 级：${h.fontEastAsia || h.fontAscii || "(缺)"} ${h.sizePt || "?"}pt 来源=${h.source}${h.numbering ? ` 编号=${h.numbering}` : ""}`)
  }
  console.log(`  表格=${!!pf.table} 页眉=${pf.header ? `"${pf.header.slice(0, 20)}"` : "无"} 页脚=${pf.footer ? `"${pf.footer.slice(0, 20)}"` : "无"} 页码域=${pf.pageNumber} 目录=${pf.toc} 封面=${pf.cover} 标题编号=${pf.titleNumbering || "(无)"}`)
  const byKind = pf.requirements.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {})
  console.log(`  模板要求行 ${pf.requirements.length} 条：${JSON.stringify(byKind)}`)
  for (const r of pf.requirements.slice(0, 4)) console.log(`    [${r.kind}] ${r.text.slice(0, 60)}${r.matched.length ? `  ←对齐:${r.matched[0].slice(0, 24)}` : ""}`)
  console.log(`  与招标对齐：评分点 ${pf.alignment.scoreItemCount} 项 / ★▲ 条款 ${pf.alignment.starClauseCount} 条 → 命中 ${pf.alignment.matched} 条要求，未覆盖 ${pf.alignment.unmatched}`)
  console.log(`  可勾选格式项 ${bundle.fields.length} 个：${bundle.fields.slice(0, 8).map((f) => f.key).join(" / ")}`)
  console.log(`  notes ${pf.notes.length} 条：`)
  for (const n of pf.notes) console.log(`    - ${n}`)
}

console.log("\n=== 2. 逐条断言 ===")
const first = profiles[0]
ok(profiles.length === TEMPLATES.length, `${TEMPLATES.length} 份真实模板全部识别成功（无异常抛出）`, `实测 ${profiles.length}`)
ok(first.pf.headings.length >= 1, "至少识别出 1 级标题画像")
const levels = new Set(first.pf.headings.map((h) => h.level))
console.log(`  · 标题级覆盖：${[...levels].sort().join(",") || "无"}（1-6 级为识别能力上限）`)
ok(first.pf.headings.every((h) => [1, 2, 3, 4, 5, 6].includes(h.level)), "标题级只落在 1-6 级区间")
ok(first.pf.body.sizePt > 0 || first.pf.body.font, "正文画像非空（字体或字号至少识别到一项）")
ok(Object.values(first.pf.page.margins).some((v) => v > 0), "页面画像含真实页边距（非全零默认）")
ok(first.pf.notes.length > 0, "识别结论有 notes 如实说明（有/无页眉页脚、缺哪级标题等）")

// 2.1 落库往返：format_settings.templateProfile 零 schema 变更的证据
console.log("  · 落库往返（format_settings.templateProfile ↔ JSON）：")
for (const { label, pf } of profiles) {
  const settings = { ...bt.DEFAULT_FORMAT_SETTINGS, templateProfile: pf }
  const wire = JSON.parse(JSON.stringify(settings)) // PocketBase JSON 字段的真实序列化路径
  const back = tp.templateProfileOf(wire)
  const same = JSON.stringify(back) === JSON.stringify(pf)
  ok(same, `「${label}」画像 JSON 往返深等价`, `requirements ${back?.requirements.length} / headings ${back?.headings.length}`)
}

// 2.2 空 / 垃圾画像不覆盖旧画像
ok(tp.templateProfileOf(null) === null, "format_settings=null → 画像 null（存量项目行为不变）")
ok(tp.templateProfileOf({}) === null, "无 templateProfile 字段 → null")
const blank = bt.normalizeTemplateProfile({})
ok(blank?.headings.every((h) => h.source === "missing") && blank.requirements.length === 0, "空对象画像 → 全部回落缺省（六级 missing / 零要求）")
ok(bt.isMeaningfulTemplateProfile(blank) === false, "空画像 isMeaningful=false → 落库路径不覆盖既有画像（DraftMergePanel 两处守门）")
ok(bt.isMeaningfulTemplateProfile(null) === false, "null 画像 isMeaningful=false")
const dirty = bt.normalizeTemplateProfile({ version: 1, sourceFileName: "x", requirements: "not-an-array", headings: "nope" })
ok(dirty !== null && dirty.requirements.length === 0 && bt.isMeaningfulTemplateProfile(dirty) === false, "脏数据（requirements/headings 非数组）容错归一为空且不覆盖画像")
ok(bt.isMeaningfulTemplateProfile(profiles[1].pf) === true, "真实模板画像 isMeaningful=true → 可落库")

// 2.3 要求行消费：排版类不进正文提示词
const lines = tp.templateRequirementLines(first.pf)
const formatOnly = first.pf.requirements.filter((r) => r.kind === "format")
console.log(`  · 注入正文的要求行 ${lines.length} 条（模板共 ${first.pf.requirements.length} 条，其中排版类 ${formatOnly.length} 条已被滤掉）`)
ok(!lines.some((t) => formatOnly.some((r) => r.text === t)), "排版类（format）要求行不进正文提示词")
ok(tp.templateRequirementLines(null).length === 0, "无画像时注入行为空（提示词与旧版逐字一致）")
ok(lines.length <= 20, "注入条数不超过 20（提示词预算受控）")

// 2.4 与真实招标原文的对齐（本地规则，零 AI）
if (tenderText) {
  const scoreItems = (await server.ssrLoadModule("/src/pages/BidWorkspace/scoreItemsScan.ts")).scanScoreItems(tenderText)
  const starClauses = (await server.ssrLoadModule("/src/pages/BidWorkspace/starClauseFidelity.ts")).extractStarParagraphs(tenderText)
  console.log(`  · 真实招标原文（本地规则）抽出：评分点 ${scoreItems.items.length} 项、★▲ 条款 ${starClauses.length} 条`)
  ok(scoreItems.items.length > 0 && starClauses.length > 0, "真实招标原文可抽出评分点与 ★▲ 条款（对齐的分母非空）")
  for (const { label, pf } of profiles) {
    const a = pf.alignment
    ok(
      a.scoreItemCount > 0,
      `「${label}」与真实招标对齐跑通（评分点 ${a.scoreItemCount} 项被纳入比对）`,
    )
    ok(
      a.matched <= pf.requirements.length && a.unmatched <= a.scoreItemCount + a.starClauseCount,
      `「${label}」对齐计数自洽（命中 ${a.matched} ≤ 要求 ${pf.requirements.length}；未覆盖 ${a.unmatched} ≤ 评分点 ${a.scoreItemCount} + ★ ${a.starClauseCount}）`,
    )
  }
} else {
  console.log("  - 缺招标原文，跳过对齐断言")
}

await server.close()
console.log(`\n结论：${failed === 0 ? "全部通过" : failed + " 项未通过"}`)
process.exit(failed === 0 ? 0 : 1)
