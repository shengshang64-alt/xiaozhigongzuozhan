#!/usr/bin/env node
// 全站 68 屏实现截图 + 三态/CTA 自查（UX-v2 B10 §5.4）
//
// 用法：
//   node scripts/health/shoot-ux-v2.mjs                  # 截全部屏 → docs/ux-v2-2026-11/shots-impl/
//   node scripts/health/shoot-ux-v2.mjs --only home-tasks
//   node scripts/health/shoot-ux-v2.mjs --base http://127.0.0.1:8000
//
// 与 docs/ux-v2-2026-11/shoot.mjs 的区别：
//   那个脚本截的是**原型**（静态 HTML），本脚本截的是**实现后的真实应用**（Vite dev server）。
//
// 每屏做四项自查（对应任务书 §5.4 的「不允许的差异」）：
//   · 主 CTA 数量：数 variant="default" 的按钮 → 一屏出现 2 个主 CTA 记为问题
//   · 三态：屏内是否出现 LoadingState / EmptyState / 错误提示（缺哪态记哪态）
//   · 信息量：正文文本字数（与原型对比时作为下限参考）
//   · 崩溃：ErrorBoundary 是否接管（页面出现「出错了」）
//
// 登录：脚本用本地管理员账号走真实登录流程（与人工验收同一条路），凭据从环境变量读，
// 不写死也不进日志。默认 admin@team.local / Admin#12345（仓库文档已公开的本地测试账号）。
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, "..", "..")

const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const BASE = argOf("--base", "http://127.0.0.1:8000")
const OUT = join(REPO, "docs", "ux-v2-2026-11", "shots-impl")
const ONLY = argOf("--only", "")
const EMAIL = process.env.UX_V2_EMAIL || "admin@team.local"
const PASSWORD = process.env.UX_V2_PASSWORD || "Admin#12345"

// 复用全局 @playwright/cli 里的 playwright-core（与 shoot.mjs 同一来源）
const PW_PATHS = [
  "D:/AppDataOnD/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core",
  "playwright-core",
]
function loadPW() {
  for (const p of PW_PATHS) {
    try {
      return require(p)
    } catch {
      // 换下一个候选路径
    }
  }
  throw new Error("找不到 playwright-core")
}
const { chromium } = loadPW()

// ---------- 从 routeRegistry.ts 解析全部屏（与 verify-ux-v2-routes.mjs 同一套正则） ----------
const registrySrc = readFileSync(join(REPO, "src", "lib", "routeRegistry.ts"), "utf8")
const defStarts = [...registrySrc.matchAll(/def\(\s*"([^"]+)",\s*"([^"]+)",\s*\w+,\s*\[/g)]
// 最后一个 def 的切片必须停在 ROUTE_DEFS 收尾的 `]`：文件下方 ROUTES = ROUTE_DEFS.map(...)
// 里有 `...(d.deprecated ? { deprecated: true } : {})`，吃到文件尾会把 /team 误判成 deprecated。
const lastDef = defStarts[defStarts.length - 1]
const defsEnd = lastDef
  ? lastDef.index + registrySrc.slice(lastDef.index).search(/\n\]/)
  : registrySrc.length
const screens = []
for (let i = 0; i < defStarts.length; i += 1) {
  const cur = defStarts[i]
  const nextIdx = i + 1 < defStarts.length ? defStarts[i + 1].index : defsEnd
  const body = registrySrc.slice(cur.index, nextIdx)
  // deprecated（/ai-hot）是重定向屏，不算「一屏」，跳过（69 = 68 + 1）
  if (/deprecated:\s*true/.test(body)) continue
  const modulePath = cur[1]
  const moduleLabel = cur[2]
  const screenRe = /\{\s*id:\s*"([^"]+)",\s*tab:\s*"([^"]+)",\s*slug:\s*"([^"]*)"/g
  let s
  while ((s = screenRe.exec(body))) {
    const slug = s[3]
    const path = slug === "" ? modulePath : modulePath === "/" ? `/${slug}` : `${modulePath}/${slug}`
    screens.push({ id: s[1], tab: s[2], moduleLabel, path })
  }
}

const target = ONLY ? screens.filter((s) => s.id === ONLY || s.path === ONLY) : screens
if (target.length === 0) {
  console.error(`没有匹配的屏：${ONLY}`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })

// ---------- 登录（本地域 TeamAuthGate 拦在前面） ----------
async function login() {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)
  const loginBox = await page.locator('input[type="password"]').count()
  if (loginBox === 0) return "已登录（无登录表单）"
  await page.locator('input[type="email"], input[placeholder*="邮箱"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  const btn = page.getByRole("button", { name: "登录" })
  await btn.click()
  await page.waitForTimeout(2500)
  const still = await page.locator('input[type="password"]').count()
  return still === 0 ? "登录成功" : "登录失败（表单仍在）"
}

const loginState = await login()
console.log(`登录：${loginState}`)
if (loginState.startsWith("登录失败")) {
  await browser.close()
  process.exit(1)
}

// ---------- 逐屏截图 + 自查 ----------
const rows = []
for (const sc of target) {
  await page.goto(`${BASE}${sc.path}`, { waitUntil: "domcontentloaded" })
  // UX-v2 收口：列表屏必须等加载态消失再截，避免「正在加载投标项目…」进验收图
  try {
    if (sc.id === "bid-list" || sc.path === "/bid-workspace") {
      await page.waitForFunction(() => {
        const t = document.body?.innerText || ""
        return !/正在加载投标项目/.test(t) && /新建投标项目|投标项目/.test(t)
      }, { timeout: 45000 })
    } else if (sc.id === "solution-checklist" || sc.path.includes("/solution-studio/checklist")) {
      await page.waitForFunction(() => {
        const t = document.body?.innerText || ""
        return t.includes("建设清单") && (t.includes("录入需求") || t.includes("系统清单") || t.includes("导入需求原文"))
      }, { timeout: 45000 })
    } else {
      await page.waitForTimeout(1600)
    }
    try { await page.waitForLoadState("networkidle", { timeout: 12000 }) } catch { /* 长轮询页可忽略 */ }
    await page.waitForTimeout(600)
  } catch {
    await page.waitForTimeout(2000)
  }

  const info = await page.evaluate(() => {
    // keep-alive：只看未隐藏（无 hidden/inert 祖先且有布局盒）的面板
    const vis = (el) => !el.closest("[hidden],[inert]") && el.getClientRects().length > 0
    const panels = Array.from(document.querySelectorAll("[data-tab-panel]")).filter(vis)
    const root = panels[panels.length - 1] ?? document.querySelector("main")
    const buttons = root ? Array.from(root.querySelectorAll("button")) : []
    // 主 CTA：shadcn Button 默认 variant（bg-primary 实底，且不是 outline/ghost/次级）。
    //
    // 两个已知误判要排除（B10 实测）：
    //  · ScreenTabs 的激活标签类名含 `after:bg-primary`（下划线装饰）——不是 CTA
    //  · 分组过滤按钮（如「全部」）用 bg-primary 但属于 seg 控件——靠文案/位置难以区分，
    //    这里只排除伪元素与 badge，seg 类误报在报告里人工复核
    const tabEls = new Set(Array.from(document.querySelectorAll("[role=tablist] button")))
    const solid = buttons.filter((b) => {
      if (tabEls.has(b)) return false
      const c = b.className || ""
      if (c.includes("after:bg-primary")) return false // 伪元素装饰
      // 只认实底：bg-primary 或 bg-primary/xx，但排除 hover:/focus: 前缀
      return /(^|\s)bg-primary(\/\d+)?(\s|$)/.test(c)
    })
    // seg 单选组（「全部 / 进行中 / 已完成」这类）：同一个父容器里 ≥2 个按钮共用一个
    // 带 bg-primary 的类名，且互斥选中——它们是一个筛选控件，不是两个主 CTA。
    // 判定：某按钮的父节点里存在另一个也命中实底的按钮，且两者类名骨架相同（去掉颜色后一致）。
    const skeleton = (c) => c.replace(/bg-primary(\/\d+)?/g, "bg-*").replace(/\s+/g, " ")
    const primaryCta = solid.filter((b) => {
      const sib = solid.filter((o) => o !== b && o.parentElement === b.parentElement)
      if (sib.length === 0) return true
      return !sib.some((o) => skeleton(o.className) === skeleton(b.className))
    })
    const text = (root?.innerText ?? "").trim()
    const h1 = Array.from(document.querySelectorAll("h1")).filter(vis).map((h) => h.textContent?.trim())
    const tablist = Array.from(document.querySelectorAll("[role=tablist][aria-label='模块内界面']")).filter(vis)[0]
    return {
      path: location.pathname,
      h1: h1[h1.length - 1] ?? null,
      h1Count: h1.length,
      primaryCtaCount: primaryCta.length,
      primaryCtaTexts: primaryCta.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 4),
      innerTabs: tablist ? Array.from(tablist.querySelectorAll("[role=tab]")).map((t) => t.textContent?.trim()) : [],
      chars: text.length,
      scrollH: (root?.scrollHeight ?? 0) + 0,
      hasError: /出错了|页面渲染失败|Something went wrong/.test(text),
      hasEmpty: /还没有|暂无|没有.*记录|空空如也/.test(text),
      hasLoading: /正在加载|加载中|页面加载中/.test(text),
      bodyText: text.slice(0, 400),
    }
  })

  const file = join(OUT, `${sc.id}.png`)
  await page.screenshot({ path: file, fullPage: true })
  rows.push({ ...sc, ...info })

  const flags = []
  // 只报「可确证」的缺陷（B10 实拍复核后的口径）：
  //  · 双主 CTA：脚本会误判 seg 单选组与筛选页签，这里降级为提示，人工看 _report.md
  //  · 多 h1：确定是「包装旧页 + 自加 PageHeader」导致的一屏两标题，可确证
  //  · 崩溃：ErrorBoundary 接管，可确证
  if (info.h1Count > 1) flags.push(`多h1(${info.h1Count})`)
  if (info.hasError) flags.push("崩溃")
  if (info.primaryCtaCount > 1) flags.push(`疑双主CTA(${info.primaryCtaCount})`)
  console.log(
    `${sc.id.padEnd(22)} ${String(info.chars).padStart(5)}字 cta=${info.primaryCtaCount} tabs=${info.innerTabs.length} ${flags.join(" ") || "ok"}`,
  )
}

await browser.close()

// ---------- 汇总 ----------
const doubleCta = rows.filter((r) => r.primaryCtaCount > 1)
const crashed = rows.filter((r) => r.hasError)
const multiH1 = rows.filter((r) => r.h1Count > 1)
const noTabs = rows.filter((r) => r.innerTabs.length === 0)
const thin = rows.filter((r) => r.chars < 120)

writeFileSync(join(OUT, "_report.json"), JSON.stringify({ base: BASE, login: loginState, rows }, null, 2))
writeFileSync(
  join(OUT, "_report.md"),
  [
    `# 全站实现截图自查（${rows.length} 屏）`,
    "",
    `- base：${BASE}`,
    `- 登录：${loginState}`,
    "",
    `## 汇总`,
    `- 多 h1（包装旧页 + 自加 PageHeader，一屏两标题）：${multiH1.length}`,
    `- 渲染崩溃：${crashed.length}`,
    `- 疑似双主 CTA（含 seg 单选组误判，需人工复核）：${doubleCta.length}`,
    `- 无模块内标签：${noTabs.length}`,
    `- 正文 < 120 字（详情屏未带 ?id= 时的空态，属正常）：${thin.length}`,
    "",
    "## 明细",
    "| 屏 | 路径 | 字数 | 主CTA | 内标签 | 备注 |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.path} | ${r.chars} | ${r.primaryCtaCount} | ${r.innerTabs.length} | ${
          [r.primaryCtaCount > 1 ? "双主CTA" : "", r.hasError ? "崩溃" : "", r.h1Count > 1 ? `多h1(${r.h1Count})` : ""]
            .filter(Boolean)
            .join(" ") || ""
        } |`,
    ),
    "",
  ].join("\n"),
)

console.log(`\n截图完成：${rows.length} 屏 → ${OUT}`)
console.log(`多 h1 ${multiH1.length} · 崩溃 ${crashed.length} · 疑似双主 CTA ${doubleCta.length} · 无内标签 ${noTabs.length} · 空态过薄 ${thin.length}`)
for (const r of multiH1) console.log(`  ✗ 多h1 ${r.id}（${r.h1Count}）：${r.path}`)
for (const r of crashed) console.log(`  ✗ 崩溃 ${r.id}：${r.path}`)
for (const r of noTabs) console.log(`  ✗ 无内标签 ${r.id}：${r.path}`)
// 只有崩溃与多 h1 算失败（可确证）；疑似双主 CTA 只提示，人工复核
process.exit(multiH1.length + crashed.length > 0 ? 1 : 0)
