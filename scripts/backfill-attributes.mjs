/**
 * attributes 回填（2026-11-01）
 *
 * 背景：extract-atoms-bulk.mjs 的 INSERT 曾漏了 attributes 列，
 * 导致 99% 原子（2549 条里 2527 条）没有属性，影响：
 *   · metric 类原子的 value/unit 缺失 → 数值冲突检测失效（§8.2）
 *   · 极性（polarity）缺失 → 极性冲突检测失效
 *
 * 本脚本从 title/body 里**规则化回填**（不是臆造，只提取正文已有的信息）：
 *   · value/unit：匹配 "数字 + 单位"（不少于 27 个 / 99.9% / 2500 万元 / 5 级）
 *   · polarity：按正文的支持/否定词判定
 *   · year：匹配 "20XX 年"
 *
 * 用法：npx tsx scripts/backfill-attributes.mjs [--apply]
 */
import { DatabaseSync } from "node:sqlite"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const APPLY = process.argv.includes("--apply")

/** 单位词表（按长度降序匹配，避免 "万元" 被 "元" 抢先） */
const UNITS = ["万元", "亿元", "万人次", "万张", "人次", "小时", "分钟", "个月", "级", "%", "个", "张", "家", "项", "年", "天"]



/**
 * 从文本提取 attributes。只提取**正文明确写了**的信息，不推断。
 */
export function extractAttributes(title, body) {
  const text = `${title ?? ""} ${body ?? ""}`
  const attrs = {}

  // ---- value + unit：优先匹配「数字 + 单位」----
  // 排除年份被当成 value（"2019 年" 里的 2019 是年份不是指标）
  let best = null
  for (const unit of UNITS) {
    // 数值前不能是"第""基础""字典"等（避免把"基础字典1"的序号当指标）
    const re = new RegExp(`(?<![第基础字典章节条款项])(\\d+(?:\\.\\d+)?)\\s*${unit.replace("%", "\\%")}`, "g")
    let m
    while ((m = re.exec(text)) !== null) {
      const val = Number(m[1])
      // 年份形态（1900-2100 的纯整数 + 单位"年"）当 year 而非 value
      if (unit === "年" && val >= 1900 && val <= 2100) continue
      // 优先取"不少于/以上/达到"附近的数（更像指标）
      const around = text.slice(Math.max(0, m.index - 8), m.index + m[0].length + 8)
      const strong = /(不少于|不低于|不超过|以上|以下|达到|达|≥|≤|超过)/.test(around)
      if (!best || (strong && !best.strong) || (strong === best.strong && unit.length > best.unit.length)) {
        best = { value: val, unit, strong }
      }
    }
  }
  if (best) {
    attrs.value = best.value
    attrs.unit = best.unit
  }

  // ---- year：正文里的 20XX 年 ----
  const ym = text.match(/(20\d{2})\s*年/)
  if (ym) attrs.year = Number(ym[1])

  // ---- polarity：**不做自动回填** ----
  //
  // 2026-11-01 实测教训：基于关键词的极性判定误判率太高，放弃自动填写。
  // 复现过的反例：
  //   「集成平台支持按 WS 445 标准完善数据集与数据元」
  //     正文「…数据元项目缺失的，在平台数据库结构中进行完善」→ 含"缺失"被判 negative，
  //     但这句是**问题描述 + 解决动作**，根本不是"未达标"。
  //   「投标人未通过资格审查」→ 否定词"未通过"同时包含肯定词"通过"，顺序不当会判 neutral。
  //   「要求投标人具备资质」→ 这是招标方的要求，不是我方状态。
  //
  // polarity 的语义是「达标/支持/有 vs 未达标/不支持/无」（§4.2），
  // 属于**评价性结论**，只能靠模型语义判断或人工标注，规则判不准。
  // 留空比填错好——极性冲突检测（kbConflict）会跳过没有 polarity 的原子。

  return Object.keys(attrs).length ? attrs : null
}

const db = new DatabaseSync(DB, { readOnly: !APPLY })
const rows = db
  .prepare("SELECT id, atom_type, title, body, attributes FROM kb_atoms WHERE attributes IS NULL OR attributes='' OR attributes='{}'")
  .all()
db.close()

console.log(`=== attributes 回填 ${APPLY ? "(写库)" : "(体检)"} ===`)
console.log(`当前 attributes 为空: ${rows.length} 条\n`)

const updates = []
let withValue = 0
let withPolarity = 0
let withYear = 0
const samples = []

for (const r of rows) {
  const attrs = extractAttributes(r.title, r.body)
  if (!attrs) continue
  updates.push({ id: String(r.id), attrs })
  if (attrs.value !== undefined) withValue += 1
  if (attrs.polarity) withPolarity += 1
  if (attrs.year !== undefined) withYear += 1
  if (samples.length < 5) samples.push({ title: String(r.title).slice(0, 50), attrs })
}

console.log("=== 可回填统计 ===")
console.log(`  有 value+unit: ${withValue} 条 (${(withValue / Math.max(1, rows.length) * 100).toFixed(0)}%)`)
console.log(`  有 polarity:   ${withPolarity} 条 (${(withPolarity / Math.max(1, rows.length) * 100).toFixed(0)}%)`)
console.log(`  有 year:       ${withYear} 条 (${(withYear / Math.max(1, rows.length) * 100).toFixed(0)}%)`)
console.log(`  合计可回填:    ${updates.length} 条`)

console.log("\n=== 样例 ===")
for (const s of samples) {
  console.log(`  ${s.title}`)
  console.log(`    → ${JSON.stringify(s.attrs)}`)
}

if (APPLY) {
  const wdb = new DatabaseSync(DB)
  const stmt = wdb.prepare("UPDATE kb_atoms SET attributes=? WHERE id=?")
  let ok = 0
  for (const u of updates) {
    try {
      stmt.run(JSON.stringify(u.attrs), u.id)
      ok += 1
    } catch {
      /* 单条失败继续 */
    }
  }
  wdb.close()
  console.log(`\n=== 已回填: ${ok} 条 ===`)
} else {
  console.log("\n※ 未写库。加 --apply 执行。")
}
