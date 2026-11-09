#!/usr/bin/env node
// UX-v2 全站路由可达性检查（B10 §5.1）
//
// 用法：
//   node scripts/health/verify-ux-v2-routes.mjs
//   node scripts/health/verify-ux-v2-routes.mjs --json
//
// 做什么：
//   1. 从 src/lib/routeRegistry.ts 解析「模块 → 屏」注册情况（id / tab / slug / path）
//   2. 从 docs/ux-v2-2026-11/prototype/assets/manifest.js 读 69 屏真源
//   3. 逐屏比对：已实现 / 缺失 / 多余
//   4. 检查 17 条旧路径是否仍注册（防外链失效）
//   5. 检查 /ai-hot 是否为 deprecated（不出现在侧栏但路由保留）
//
// 退出码：0 = 全通过；1 = 有缺失或旧路径失效
//
// 为什么用正则解析而不是 import TS：
//   本脚本是 .mjs，node 不能直接 import .ts。正则解析在 B1 建 routeRegistry 时就定了
//   固定写法（def(...) + { id, tab, slug }），改写法会让本脚本报错——这本身是一种保护。

import { readFileSync } from "node:fs"
import { join, dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, "..", "..")
const REGISTRY = join(REPO, "src", "lib", "routeRegistry.ts")
const MANIFEST = join(REPO, "docs", "ux-v2-2026-11", "prototype", "assets", "manifest.js")

const asJson = process.argv.includes("--json")

// ---------- 1. manifest（设计真源） ----------
function loadManifest() {
  const src = readFileSync(MANIFEST, "utf8")
  const window = {}
  // manifest.js 是仓库内的静态清单（`window.PROTO = {...}`），用 Function 求值即可
  new Function("window", src)(window)
  const proto = window.PROTO
  if (!proto?.mods) throw new Error("manifest.js 解析失败：没有 PROTO.mods")
  const out = []
  for (const [mod, v] of Object.entries(proto.mods)) {
    for (const s of v.screens) out.push({ mod, modLabel: v.label, id: s.id, file: s.file, tab: s.tab })
  }
  return out
}

// ---------- 2. registry（实现真源） ----------
function loadRegistry() {
  const src = readFileSync(REGISTRY, "utf8")
  const screens = []
  const modules = []

  // 匹配 def("/path", "label", Icon, [ ... ])  取其中的 { id, tab, slug }
  // def 的尾部形态有几种：`])` / `], true)` / `], undefined, { deprecated: true })`
  // 所以只锚 "def(...,[...]" 到「下一个 def( 或 ROUTE_DEFS 数组结束」。
  //
  // ⚠️ 最后一个 def 的切片必须停在 ROUTE_DEFS 的收尾 `]`，不能一路吃到文件尾：
  // 文件下方 `ROUTES = ROUTE_DEFS.map(...)` 里有一行
  //   `...(d.deprecated ? { deprecated: true } : {})`
  // 吃进最后一块就会把 /team 误判成 deprecated（B10 实测踩过：结果少截 3 屏，
  // 且 /team 被当成重定向屏跳过）。
  const defStarts = [...src.matchAll(/def\(\s*"([^"]+)",\s*"([^"]+)",\s*\w+,\s*\[/g)]
  const lastDef = defStarts[defStarts.length - 1]
  const defsEnd = lastDef ? lastDef.index + src.slice(lastDef.index).search(/\n\]/) : src.length
  for (let i = 0; i < defStarts.length; i += 1) {
    const cur = defStarts[i]
    const nextIdx = i + 1 < defStarts.length ? defStarts[i + 1].index : defsEnd
    const body = src.slice(cur.index, nextIdx)
    const modulePath = cur[1]
    const moduleLabel = cur[2]
    modules.push({ path: modulePath, label: moduleLabel })
    const screenRe = /\{\s*id:\s*"([^"]+)",\s*tab:\s*"([^"]+)",\s*slug:\s*"([^"]*)"/g
    let s2
    while ((s2 = screenRe.exec(body))) {
      const slug = s2[3]
      const fullPath =
        slug === "" ? modulePath : modulePath === "/" ? `/${slug}` : `${modulePath}/${slug}`
      screens.push({ id: s2[1], tab: s2[2], slug, modulePath, moduleLabel, path: fullPath })
    }
  }
  // deprecated 模块（如 /ai-hot）：在每个 def 块（到下一个 def 为止）里找 `deprecated: true`
  const deprecated = []
  for (let i = 0; i < defStarts.length; i += 1) {
    const cur = defStarts[i]
    const nextIdx = i + 1 < defStarts.length ? defStarts[i + 1].index : defsEnd
    const body = src.slice(cur.index, nextIdx)
    if (/deprecated:\s*true/.test(body)) deprecated.push(cur[1])
  }

  return { screens, modules, deprecated }
}

// ---------- 3. 旧路径（17 条，防外链失效） ----------
const OLD_PATHS = [
  "/", "/customer-management", "/intel-center", "/ai-hot", "/solution-studio", "/product-mapping",
  "/ppt-quote", "/materials", "/bid-workspace", "/bid-check", "/format-tool", "/knowledge",
  "/qual-certs", "/competitors", "/assistant", "/model-config", "/team",
]

// ---------- 4. 比对 ----------
const manifest = loadManifest()
const { screens, modules, deprecated } = loadRegistry()

const implementedIds = new Set(screens.map((s) => s.id))
const manifestIds = new Set(manifest.map((s) => s.id))

const missing = manifest.filter((m) => !implementedIds.has(m.id))
const extra = screens.filter((s) => !manifestIds.has(s.id))

const registeredModules = new Set(modules.map((m) => m.path))
const lostOldPaths = OLD_PATHS.filter((p) => !registeredModules.has(p))

// /ai-hot 必须 deprecated 且不在 NAV_GROUPS
const aiHotDeprecated = deprecated.includes("/ai-hot")
// 注意必须锚 export const：文件头注释里也出现过 NAV_GROUPS 字样，
// 只写 /NAV_GROUPS[^=]*=/ 会从注释一路吃到 ROUTE_DEFS 的 `= [`，解析出 0 项。
const navSection = readFileSync(REGISTRY, "utf8").match(/export const NAV_GROUPS[^=]*=\s*\[([\s\S]*?)\n\]/)
const navPaths = navSection
  ? [...navSection[1].matchAll(/paths:\s*\[([^\]]*)\]/g)].flatMap((mm) =>
      [...mm[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    )
  : []
const aiHotInNav = navPaths.includes("/ai-hot")

const report = {
  manifestScreens: manifest.length,
  registeredScreens: screens.length,
  implemented: manifest.length - missing.length,
  missing: missing.map((m) => ({ id: m.id, mod: m.mod, tab: m.tab, file: m.file })),
  extra: extra.map((e) => ({ id: e.id, path: e.path })),
  registeredModules: modules.length,
  oldPathsTotal: OLD_PATHS.length,
  lostOldPaths,
  aiHotDeprecated,
  aiHotInNav,
  navItemCount: navPaths.length,
}

const fail = missing.length > 0 || lostOldPaths.length > 0 || !aiHotDeprecated || aiHotInNav

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log("\n=== UX-v2 全站路由检查 ===")
  console.log(`manifest 屏数：${manifest.length}`)
  console.log(`registry 已注册屏：${screens.length}（模块 ${modules.length} 个）`)
  console.log(`已实现：${report.implemented} / ${manifest.length}`)

  if (missing.length) {
    console.log(`\n--- 缺失 ${missing.length} 屏 ---`)
    for (const m of missing) console.log(`  ✗ ${m.id}（${m.mod} / ${m.tab} / ${m.file}）`)
  }
  if (extra.length) {
    console.log(`\n--- manifest 里没有的额外屏 ${extra.length} 条（不算错，需说明）---`)
    for (const e of extra) console.log(`  ? ${e.id} → ${e.path}`)
  }

  console.log(`\n--- 旧路径兼容（${OLD_PATHS.length} 条）---`)
  if (lostOldPaths.length) {
    console.log(`  ✗ 丢失 ${lostOldPaths.length} 条：${lostOldPaths.join(", ")}`)
  } else {
    console.log(`  ✅ ${OLD_PATHS.length}/${OLD_PATHS.length} 全部仍注册`)
  }

  console.log("\n--- /ai-hot 收口 ---")
  console.log(`  ${aiHotDeprecated ? "✅" : "✗"} deprecated 标记：${aiHotDeprecated ? "有" : "缺失"}`)
  console.log(`  ${!aiHotInNav ? "✅" : "✗"} 不在侧栏 NAV_GROUPS：${!aiHotInNav ? "确认" : "仍在（应移除）"}`)

  console.log(`\n--- 侧栏导航项数 ---`)
  console.log(`  ${report.navItemCount} 项（目标 16：17 项减去 /ai-hot）`)

  console.log(fail ? "\n❌ 有未通过项" : "\n✅ 全部通过")
}

process.exit(fail ? 1 : 0)
