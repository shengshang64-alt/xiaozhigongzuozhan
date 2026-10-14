#!/usr/bin/env node
/**
 * R41b 收尾 · 迁移可重建验收（对标 dify 的 .github/workflows/db-migration-test.yml）
 *
 * 目的：把「pocketbase/pb_migrations 能从**空目录**重建完整 schema」变成一条
 *      可复跑、可机检的命令，防止未来某次集合改动只落在本机库文件、没进迁移。
 *
 * 做法：系统临时目录建一个空 data 目录 → 用项目自带 pocketbase 跑 `migrate up`
 *      （只读 pb_migrations，只写临时目录）→ 断言集合数 == 迁移文件声明的集合数 → 清理。
 *
 * 安全：**绝不触碰 pocketbase/pb_data**（对照读本机库的那条是 docs/20 §9.2 的一次性验证，
 *      本脚本只走空目录），也不动 pb_hooks。
 *
 * 用法：node scripts/health/verify-pb-migrations.mjs   （或 pnpm verify:migrations）
 * 退出码：0 = 通过；1 = 失败
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const PB = path.join(ROOT, "vibex-local", "bin", "windows", "pocketbase.exe")
const MIGRATIONS = path.join(ROOT, "pocketbase", "pb_migrations")

function fail(msg) {
  console.error(`\n\x1b[31m\u2717 ${msg}\x1b[0m`)
  process.exit(1)
}
function ok(msg) { console.log(`\x1b[32m\u2713\x1b[0m ${msg}`) }

console.log("=== pb_migrations 空目录重建验收 ===")

// 1) 前置检查
if (!fs.existsSync(PB)) fail(`找不到 pocketbase 可执行文件：${PB}`)
if (!fs.existsSync(MIGRATIONS)) fail(`找不到迁移目录：${MIGRATIONS}`)

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".js"))
if (!files.length) fail(`pb_migrations 为空（0 个 *.js）——schema 尚未入库，先跑 migrate collections`)

// 2) 迁移文件声明的集合数（顶层 "type": "base" | "auth" | "view"）
//    字段定义里的 type 是 text/number/... 不会命中，故计数即集合数。
let expected = 0
for (const f of files) {
  const src = fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
  expected += (src.match(/"type":\s*"(?:base|auth|view)"/g) || []).length
}
if (!expected) fail("迁移文件里没有解析到任何集合（快照格式异常？）")
ok(`迁移文件 ${files.length} 个，声明集合 ${expected} 个`)

// 3) 空目录 + migrate up
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-mig-verify-"))
const dataDir = path.join(tmp, "data")
const emptyHooks = path.join(tmp, "hooks")
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(emptyHooks, { recursive: true })

try {
  const res = spawnSync(
    PB,
    [
      "migrate", "up",
      `--dir=${dataDir}`,
      `--migrationsDir=${MIGRATIONS}`,
      `--hooksDir=${emptyHooks}`,
      "--automigrate=true",
    ],
    { encoding: "utf8", windowsHide: true },
  )
  if (res.status !== 0) {
    console.error(res.stdout || "")
    console.error(res.stderr || "")
    fail(`migrate up 退出码 ${res.status}（空目录应用迁移失败）`)
  }
  ok(`migrate up 成功（空目录）${(res.stdout || "").trim() ? "：" + (res.stdout || "").trim() : ""}`)

  // 4) 断言新库里的集合数
  const dbPath = path.join(dataDir, "data.db")
  if (!fs.existsSync(dbPath)) fail(`空目录 migrate up 后没有生成 data.db：${dbPath}`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const actual = db.prepare("select count(*) c from _collections").get().c
  db.close()

  if (actual !== expected) fail(`集合数不符：迁移声明 ${expected}，空目录重建后 ${actual}`)
  ok(`空目录重建后集合数 = ${actual}（与迁移声明一致）`)
  console.log("\n\x1b[32mPASS：pb_migrations 可从空目录完整重建 schema\x1b[0m")
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
