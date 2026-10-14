#!/usr/bin/env node
/**
 * R44 · eslint 存量债快照（按规则分档）——可重跑
 *
 * 用途：把「基线 151 / 119」这类数字落到**可复算的按规则明细**上，避免下次再用「感觉」讨论债务。
 *      输出 docs/evolution/_r44_eslint_byrule.json（小文件，入库）。
 * 用法：node docs/evolution/_r44_eslint_snapshot.cjs
 * 注：与门禁同口径（仓库根、`eslint . -f json`）。
 */
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..", "..")
const ESLINT_BIN = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js")

function breakdown(jsonPath) {
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  const errorsByRule = {}, warningsByRule = {}
  let errors = 0, warnings = 0
  for (const f of report) for (const m of f.messages || []) {
    const k = m.ruleId || "(no-rule：僵尸 eslint-disable / 其他)"
    if (m.severity === 2) { errorsByRule[k] = (errorsByRule[k] || 0) + 1; errors++ }
    else { warningsByRule[k] = (warningsByRule[k] || 0) + 1; warnings++ }
  }
  const sort = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  return { filesLinted: report.length, errors, warnings, errorsByRule: sort(errorsByRule), warningsByRule: sort(warningsByRule) }
}

const res = spawnSync(process.execPath, [ESLINT_BIN, ".", "-f", "json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
const out = res.stdout || ""
const now = breakdown(JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)) && writeTmp(out))

function writeTmp(text) {
  const tmp = path.join(ROOT, ".probe", "eslint-r44-snapshot.raw.json")
  fs.writeFileSync(tmp, text)
  return tmp
}

// 上一版快照（R41，工作区既有），用于展示「非 react-hooks 类债务已清零」
const priorTmp = path.join(ROOT, ".probe", "eslint_r41.json")
const prior = fs.existsSync(priorTmp) ? { source: ".probe/eslint_r41.json（R41 实测存档）", ...breakdown(priorTmp) } : null

const payload = {
  _note: "eslint 存量债按规则分档快照。与门禁同口径：仓库根 `eslint . -f json`。totals 必须与 eslint-budget.json / _loop_state.json 同源。",
  capturedAt: new Date().toISOString().slice(0, 10),
  round: "R44",
  command: "npx eslint . -f json",
  ...now,
  priorSnapshot: prior,
}
const dest = path.join(ROOT, "docs", "evolution", "_r44_eslint_byrule.json")
fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + "\n", "utf8")

console.log(`实测：${now.filesLinted} 文件 / ${now.errors} error / ${now.warnings} warning`)
console.log("errorsByRule: " + JSON.stringify(now.errorsByRule))
console.log("warningsByRule: " + JSON.stringify(now.warningsByRule))
if (prior) console.log(`对照 ${prior.source}：${prior.errors} error / ${prior.warnings} warning → 非 react-hooks 类错误明细见 priorSnapshot`)
console.log("已写出：" + dest)