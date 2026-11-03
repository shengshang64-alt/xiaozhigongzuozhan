#!/usr/bin/env node
/**
 * R44 · 每轮人工检查清单（可机检版）
 *
 * 背景：项目里有两项验收**刻意不进 loop 四门**（一项依赖 pocketbase 二进制，一项耗时且属
 *      周期性核对），此前只写在账本 backlog 里靠人记。本脚本把「人工检查清单」变成一条命令。
 *
 *   1) verify-pb-migrations —— pb_migrations 能否从**空目录**完整重建 schema（对标 dify 的 db-migration-test.yml）
 *   2) verify-eslint-budget —— lint 债务是否仍在 eslint-budget.json 预算内，且与账本基线**同源**
 *
 * 用法：node scripts/health/manual-checks.mjs   （或 pnpm health:manual）
 * 退出码：0 = 两项全过；1 = 有失败（明细见上方各自输出）
 */
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CHECKS = [
  { name: "pb_migrations 空目录重建", script: "scripts/health/verify-pb-migrations.mjs" },
  { name: "eslint 债务预算（含账本同源）", script: "scripts/health/verify-eslint-budget.mjs" },
]

console.log("=== 每轮人工检查清单（health:manual）===")
const results = []
for (const c of CHECKS) {
  console.log(`\n──────── ${c.name} ────────`)
  const r = spawnSync(process.execPath, [path.join(ROOT, c.script)], { cwd: ROOT, stdio: "inherit" })
  results.push({ ...c, ok: r.status === 0, status: r.status })
}

console.log("\n=== 汇总 ===")
for (const r of results) console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.name}（exit ${r.status}）`)
const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.error(`\n\x1b[31m✗ 人工检查清单未全过：${failed.length}/${results.length} 项失败\x1b[0m`)
  process.exit(1)
}
console.log(`\n\x1b[32m✓ 人工检查清单全过（${results.length}/${results.length}）\x1b[0m`)
