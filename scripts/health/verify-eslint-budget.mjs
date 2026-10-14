#!/usr/bin/env node
/**
 * R44 · eslint 债务预算验收（对标 OHIF 的 .react-compiler-lint-budget.json）
 *
 * 目的：把「lint 存量债」从一句「基线 151」变成**具名、按规则分档、可机检、只许下降**的预算，
 *      并强制预算总额与 docs/evolution/_loop_state.json 的门禁基线**同源**（口径分裂是本项目
 *      反复踩过的坑：历史上同时存在 151 / 160 / 163 三个数字）。
 *
 * 做法：跑 `eslint . -f json`（与门禁同口径：仓库根、不加参数）→ 汇总 total 与 byRule →
 *      逐项与 eslint-budget.json 对照；出现「预算里没有的规则」（默认上限 0）也判失败。
 *
 * 用法：node scripts/health/verify-eslint-budget.mjs   （或 pnpm verify:eslint-budget）
 * 退出码：0 = 未超预算；1 = 超预算 / 口径不同源 / 无法解析
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const BUDGET_FILE = path.join(ROOT, "eslint-budget.json")
const STATE_FILE = path.join(ROOT, "docs", "evolution", "_loop_state.json")
const ESLINT_BIN = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js")

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
function fail(msg) { console.error(`\n${red("✗ " + msg)}`); process.exit(1) }

console.log("=== eslint 债务预算验收（OHIF 式具名预算）===")

if (!fs.existsSync(BUDGET_FILE)) fail(`找不到预算文件：${BUDGET_FILE}`)
if (!fs.existsSync(ESLINT_BIN)) fail(`找不到 eslint：${ESLINT_BIN}（先 pnpm install）`)
const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"))
console.log(`预算快照：${budget.round} / ${budget.capturedAt} —— error ≤ ${budget.totals.errors}，warning ≤ ${budget.totals.warnings}`)

// 1) 跑 eslint（与门禁同口径：仓库根、不加任何参数）
const res = spawnSync(process.execPath, [ESLINT_BIN, ".", "-f", "json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
const out = res.stdout || ""
const start = out.indexOf("[")
const end = out.lastIndexOf("]")
if (start < 0 || end <= start) fail(`无法解析 eslint JSON 输出（exit=${res.status}）：${(res.stderr || "").slice(0, 400)}`)
let report
try { report = JSON.parse(out.slice(start, end + 1)) } catch (e) { fail(`eslint JSON 解析失败：${e.message}`) }

const errorsByRule = {}
const warningsByRule = {}
let errTotal = 0
let warnTotal = 0
for (const f of report) {
  for (const m of f.messages || []) {
    const key = m.ruleId || "(无规则号：僵尸 eslint-disable / 其他)"
    if (m.severity === 2) { errorsByRule[key] = (errorsByRule[key] || 0) + 1; errTotal++ } else { warningsByRule[key] = (warningsByRule[key] || 0) + 1; warnTotal++ }
  }
}
console.log(`实测：${errTotal} error / ${warnTotal} warning（eslint 退出码 ${res.status}，非 0 属正常：本仓存量债不为零）`)

// 2) 逐规则对照（预算里没有的规则默认上限 0）
const problems = []
const hints = []
function compare(title, actual, cap) {
  console.log(`\n【${title}】实测 / 预算上限`)
  const rules = [...new Set([...Object.keys(actual), ...Object.keys(cap)])]
    .sort((a, b) => (actual[b] || 0) - (actual[a] || 0) || a.localeCompare(b))
  for (const r of rules) {
    const a = actual[r] || 0
    const c = cap[r] || 0
    const verdict = a > c ? red("✗ 超预算") : a === c ? green("✓ 用满") : yellow("↓ 可下调")
    console.log(`  ${verdict}  ${String(a).padStart(4)} / ${String(c).padStart(4)}  ${r}`)
    if (a > c) problems.push(`${title}：${r} 实测 ${a} 超预算 ${c}（差 +${a - c}）`)
    if (a < c && r !== "(无规则号：僵尸 eslint-disable / 其他)") hints.push(`${title}：${r} 可下调 ${c} → ${a}（-${c - a}）`)
  }
}
compare("error", errorsByRule, budget.errorsByRule || {})
compare("warning", warningsByRule, budget.warningsByRule || {})

if (errTotal > budget.totals.errors) problems.push(`error 总数 ${errTotal} 超预算 ${budget.totals.errors}（差 +${errTotal - budget.totals.errors}）`)
if (warnTotal > budget.totals.warnings) problems.push(`warning 总数 ${warnTotal} 超预算 ${budget.totals.warnings}`)

// 3) 与门禁基线同源（口径分裂检测）
try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const gb = state.gatesBaseline || {}
  const chain = [["eslint-budget.json totals.errors", budget.totals.errors], ["_loop_state.eslintBaseline", state.eslintBaseline], ["_loop_state.gatesBaseline.eslint", gb.eslint]]
  const bad = chain.filter(([, v]) => v !== budget.totals.errors)
  if (bad.length) {
    problems.push(`口径不同源：${chain.map(([k, v]) => `${k}=${v}`).join(" / ")} —— 预算、账本、门禁基线必须是同一个数字`)
  } else {
    console.log(`\n${green("✓")} 口径同源：预算 ${budget.totals.errors} = eslintBaseline ${state.eslintBaseline} = gatesBaseline.eslint ${gb.eslint}`)
  }
} catch (e) {
  fail(`读取状态文件失败：${STATE_FILE}（${e.message}）`)
}

// 4) 结论
if (hints.length) {
  console.log(`\n${yellow("预算可下调（债务在下降，记得收预算，别让它变成新的天花板）：")}`)
  hints.forEach((h) => console.log(`  · ${h}`))
}
if (problems.length) {
  problems.forEach((p) => console.error(`${red("✗")} ${p}`))
  fail(`${problems.length} 项超预算/不同源`)
}
console.log(`\n${green("PASS：lint 债务未超预算（error " + errTotal + " ≤ " + budget.totals.errors + "，warning " + warnTotal + " ≤ " + budget.totals.warnings + "），且与账本基线同源")}`)
