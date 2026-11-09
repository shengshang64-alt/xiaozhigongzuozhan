// UX-v2 拆屏验收脚本（Lead 用）
//
// 用法：
//   node docs/ux-v2-2026-11/acceptance/verify-ux-v2.mjs              # 全量体检
//   node docs/ux-v2-2026-11/acceptance/verify-ux-v2.mjs --batch B2   # 只验本批
//   node docs/ux-v2-2026-11/acceptance/verify-ux-v2.mjs --json       # 机器可读
//   node docs/ux-v2-2026-11/acceptance/verify-ux-v2.mjs --all        # 连存量一起查（默认只查本轮改动）
//
// 设计原则：
//   默认**只看本轮改动/新增的文件**（git status + git diff）。
//   存量（BidFigure.tsx 这种 SVG 生成器、历史大文件）不在本批责任范围，
//   拿存量的债去卡本批，只会逼执行者"顺手改"别的地方 —— 那正是要防的。
//
// 检查项：
//   A 路由注册覆盖（manifest 69 屏 vs routeRegistry）
//   B 行数纪律（本轮新增的页面 ≤400 / hook ≤800）
//   C 硬编码色值（仅本轮改动文件）
//   D 一屏一主 CTA（仅本轮改动的 *Page.tsx）
//   E 禁用按钮带原因（仅本轮改动文件）
//   F 三态齐全（仅本轮改动的模块）
//   G 写域越界（红线文件被改则报错）
//   H 旧路径兼容（17 条模块根路径是否仍注册）
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, "..", "..", "..")
const PROTO = join(REPO, "docs", "ux-v2-2026-11", "prototype")
const SRC = join(REPO, "src")

const args = process.argv.slice(2)
const batchArg = args.includes("--batch") ? args[args.indexOf("--batch") + 1] : null
const asJson = args.includes("--json")
const scanAll = args.includes("--all")

const rel = (p) => relative(REPO, p).replace(/\\/g, "/")

// ---------- 1. manifest ----------
const manifestSrc = readFileSync(join(PROTO, "assets", "manifest.js"), "utf8")
const modRe = /(\w+):\s*\{\s*\n\s*label:\s*"([^"]+)"[\s\S]*?screens:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/g
const screens = []
let mm
while ((mm = modRe.exec(manifestSrc))) {
  const mod = mm[1]
  const re = /\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)",\s*tab:\s*"([^"]+)"/g
  let s
  let i = 0
  while ((s = re.exec(mm[3]))) { i++; screens.push({ mod, modLabel: mm[2], id: s[1], file: s[2], tab: s[3], idx: i }) }
}

// ---------- 2. routeRegistry ----------
const registryPath = join(SRC, "lib", "routeRegistry.ts")
if (!existsSync(registryPath)) { console.error("✗ 找不到 src/lib/routeRegistry.ts"); process.exit(1) }
const registrySrc = readFileSync(registryPath, "utf8")

const registeredScreens = new Set()
const screenRe = /\{\s*id:\s*"([^"]+)",\s*tab:\s*"([^"]+)",\s*slug:\s*"([^"]*)"/g
let sm
while ((sm = screenRe.exec(registrySrc))) registeredScreens.add(sm[1])

// 模块根路径（兼容新旧两种 def 写法）
const modulePaths = []
let om
const newDefRe = /def\(\s*"([^"]+)",\s*"([^"]+)",\s*\w+,\s*\[/g
while ((om = newDefRe.exec(registrySrc))) modulePaths.push({ path: om[1], label: om[2] })
if (modulePaths.length === 0) {
  const oldDefRe = /def\(\s*"([^"]+)",\s*"([^"]+)",\s*\w+,\s*\(\)\s*=>/g
  while ((om = oldDefRe.exec(registrySrc))) modulePaths.push({ path: om[1], label: om[2] })
}

// ---------- 3. 本轮改动文件（git） ----------
function gitChanged() {
  try {
    const out = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" })
    return out.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.slice(2).trim().replace(/^"|"$/g, ""))
  } catch { return [] }
}
const changedFiles = gitChanged()
const changedSet = new Set(changedFiles.filter((f) => f.startsWith("src/")))

// ---------- 4. 工具 ----------
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const isCode = (p) => /\.(ts|tsx)$/.test(p) && !p.includes(".test.") && !p.includes("__tests__")
const inScope = (p) => {
  if (scanAll) return true
  if (changedSet.size === 0) return false
  return changedSet.has(rel(p))
}

// ---------- 5. 检查 ----------
const errors = []
const warns = []
const info = []

// G. 红线文件
const BANNED = [".qoder/", "eslint-budget.json", "pb_data", ".env"]
for (const f of changedFiles) {
  if (BANNED.some((b) => f.includes(b))) errors.push(`[红线] 本批改到了禁止文件：${f}`)
}

// A. 路由覆盖（只在 B1 之后有意义）
if (registeredScreens.size > 0) {
  const missing = screens.filter((s) => !registeredScreens.has(s.id))
  if (missing.length) {
    warns.push(`[路由未注册] ${missing.length}/${screens.length} 屏：${missing.slice(0, 10).map((s) => s.id).join(", ")}${missing.length > 10 ? " …" : ""}`)
  } else {
    info.push(`路由注册：全部 ${screens.length} 屏已注册 ✅`)
  }
} else {
  info.push("路由注册：0 屏已注册（B1 尚未执行，正常）")
}

// H. 旧路径兼容（17 个模块根）
const OLD_PATHS = [
  "/", "/customer-management", "/intel-center", "/ai-hot", "/solution-studio", "/product-mapping",
  "/ppt-quote", "/materials", "/bid-workspace", "/bid-check", "/format-tool", "/knowledge",
  "/qual-certs", "/competitors", "/assistant", "/model-config", "/team",
]
const registeredPathSet = new Set(modulePaths.map((m) => m.path))
const lostPaths = OLD_PATHS.filter((p) => !registeredPathSet.has(p))
if (registeredPathSet.size > 0) {
  if (lostPaths.length) errors.push(`[旧路径丢失] 这 ${lostPaths.length} 条路径不再注册：${lostPaths.join(", ")}`)
  else info.push(`旧路径兼容：17/17 全部仍注册 ✅`)
}

// B. 行数纪律（只查本轮改动 + 新增）
const scopeCode = walk(SRC).filter(isCode).filter(inScope)
const pageFiles = scopeCode.filter((p) => /Page\.tsx$/.test(p))
const hookFiles = scopeCode.filter((p) => /use[A-Z]\w*\.ts$/.test(p))
for (const p of pageFiles) {
  const n = readFileSync(p, "utf8").split("\n").length
  if (n > 400) errors.push(`[页面超 400 行] ${rel(p)} = ${n}`)
}
for (const p of hookFiles) {
  const n = readFileSync(p, "utf8").split("\n").length
  if (n > 800) errors.push(`[hook 超 800 行] ${rel(p)} = ${n}`)
}
if (pageFiles.length) info.push(`本轮改动页面 ${pageFiles.length} 个，最大 ${Math.max(...pageFiles.map((p) => readFileSync(p, "utf8").split("\n").length))} 行`)

// C. 硬编码色值（跳过 SVG 生成器 / 导出模板，它们必须写死色值）
const COLOR_EXEMPT = [
  /BidFigure\.tsx$/, /bidFigure/i, /SvgBuilder/i, /export/i, /Exports?\.tsx?$/, /mermaid/i,
  /chartTheme/i, /deckTheme\.ts$/, /deckChart\.ts$/, /formatSpec\.ts$/,
]
const HARD_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/
for (const p of scopeCode) {
  if (COLOR_EXEMPT.some((re) => re.test(p))) continue
  const lines = readFileSync(p, "utf8").split("\n")
  let hits = 0
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return          // 注释
    if (/url\(#|\bhref="#|xlinkHref|data:image/.test(line)) return
    if (HARD_COLOR.test(line)) {
      hits++
      if (hits <= 2) errors.push(`[硬编码色] ${rel(p)}:${i + 1} → ${line.trim().slice(0, 90)}`)
    }
  })
  if (hits > 2) errors.push(`[硬编码色] ${rel(p)} 共 ${hits} 处（已列前 2 处）`)
}

// D. 一屏一主 CTA（只查本轮改动的 Page 文件，弹窗内扣除）
for (const p of pageFiles) {
  const txt = readFileSync(p, "utf8")
  const total = (txt.match(/variant="default"/g) || []).length
  const dialogs = (txt.match(/<DialogContent[\s\S]*?<\/DialogContent>/g) || []).join("")
  const inDialog = (dialogs.match(/variant="default"/g) || []).length
  const effective = total - inDialog
  if (effective > 1) errors.push(`[多主 CTA] ${rel(p)}：弹窗外仍有 ${effective} 个 variant="default"（一屏只许 1 个）`)
  if (effective === 0 && total === 0) warns.push(`[无主 CTA] ${rel(p)}：找不到 variant="default"（确认是否该有）`)
}

// E. 禁用按钮带原因
for (const p of scopeCode.filter((x) => x.endsWith(".tsx"))) {
  const txt = readFileSync(p, "utf8")
  const re = /\bdisabled(=|\s|>)/g
  let m2
  let reported = false
  while ((m2 = re.exec(txt)) && !reported) {
    const around = txt.slice(Math.max(0, m2.index - 260), m2.index + 260)
    const hasHint = /text-muted-foreground|text-xs|只能|请先|后才|待确认|未|原因|title=/.test(around)
    if (!hasHint) {
      errors.push(`[禁用按钮无原因] ${rel(p)}:${txt.slice(0, m2.index).split("\n").length} → 附近 260 字符内没有解释文案`)
      reported = true
    }
  }
}

// F. 三态（只看本轮改动的模块目录）
const touchedDirs = [...new Set(pageFiles.map((p) => dirname(p)))]
for (const dir of touchedDirs) {
  const files = walk(dir).filter((f) => /\.tsx$/.test(f) && !f.includes(".test."))
  if (!files.length) continue
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n")
  const hasError = /ErrorState|isError|error\s*\?\s*</.test(all)
  const hasEmpty = /EmptyState|length === 0|\.length\s*===\s*0/.test(all)
  const hasLoading = /LoadingState|Skeleton|animate-spin|isLoading|loading\s*\?/.test(all)
  if (!hasLoading) warns.push(`[缺加载态] ${rel(dir)}`)
  if (!hasEmpty) warns.push(`[缺空态] ${rel(dir)}`)
  if (!hasError) warns.push(`[缺错误态] ${rel(dir)}`)
}

// ---------- 6. 输出 ----------
const report = { batch: batchArg || "all", screens: screens.length, registered: registeredScreens.size, changedFiles: changedFiles.length, errors, warns, info }
if (asJson) { console.log(JSON.stringify(report, null, 2)) }
else {
  console.log(`\n=== UX-v2 验收${batchArg ? " · " + batchArg : " · 全量"}${scanAll ? "（含存量）" : "（仅本轮改动）"} ===`)
  console.log(`manifest 屏数 ${screens.length} · registry 已注册 ${registeredScreens.size} · 本轮改动 ${changedFiles.length} 个文件`)
  info.forEach((i) => console.log(`  · ${i}`))
  console.log(`\n错误 ${errors.length}　警告 ${warns.length}`)
  if (errors.length) { console.log("\n--- 错误（必须修）---"); errors.slice(0, 30).forEach((e) => console.log("  ✗ " + e)); if (errors.length > 30) console.log(`  …还有 ${errors.length - 30} 条`) }
  if (warns.length) { console.log("\n--- 警告（需解释）---"); warns.slice(0, 25).forEach((w) => console.log("  ! " + w)); if (warns.length > 25) console.log(`  …还有 ${warns.length - 25} 条`) }
  if (!errors.length && !warns.length) console.log("\n✅ 全部通过")
  if (changedFiles.length === 0) console.log("\n提示：工作区无改动，本脚本默认只查本轮改动。要查存量请加 --all。")
}
process.exit(errors.length ? 1 : 0)
