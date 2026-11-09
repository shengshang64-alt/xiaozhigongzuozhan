// 批量截图脚本（Node + playwright-core，用已安装的 @playwright/cli 内置 playwright-core）
// 用法：node docs/ux-v2-2026-11/shoot.mjs [baseUrl] [outDir]
// 默认：http://127.0.0.1:8099/  →  docs/ux-v2-2026-11/shots/
import { readFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "prototype")
const BASE = process.argv[2] || "http://127.0.0.1:8099/"
const OUT = process.argv[3] || join(__dirname, "shots")

// 复用全局 @playwright/cli 里的 playwright-core
const PW_PATHS = [
  "D:/AppDataOnD/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core",
  "playwright-core",
]
function loadPW() {
  for (const p of PW_PATHS) {
    try { return require(p) } catch {}
  }
  throw new Error("找不到 playwright-core")
}
const { chromium } = loadPW()

// 读 manifest 得到全部屏
const src = readFileSync(join(ROOT, "assets", "manifest.js"), "utf8")
const screens = []
const modRe = /(\w+):\s*\{\s*\n\s*label:\s*"[^"]+"[\s\S]*?screens:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/g
let m
while ((m = modRe.exec(src))) {
  const screenRe = /\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)"/g
  let s
  while ((s = screenRe.exec(m[2]))) screens.push({ id: s[1], file: s[2] })
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 })

const rows = []
// 总览页
await page.goto(BASE + "index.html", { waitUntil: "networkidle" })
await page.screenshot({ path: join(OUT, "00-index.png"), fullPage: true })

for (const sc of screens) {
  const url = BASE + sc.file.replace(/\\/g, "/")
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForTimeout(120)
  const info = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    nav: document.querySelectorAll(".nav-item").length,
    sub: document.querySelectorAll(".subtab").length,
    ph: !!document.querySelector(".ph"),
    pager: !!document.querySelector("[data-pager]") && document.querySelector("[data-pager]").children.length > 0,
  }))
  await page.screenshot({ path: join(OUT, sc.id + ".png"), fullPage: true })
  rows.push({ id: sc.id, file: sc.file, ...info })
  console.log(`${sc.id.padEnd(22)} h=${String(info.h).padEnd(5)} nav=${info.nav} sub=${info.sub} ph=${info.ph} pager=${info.pager}`)
}

await browser.close()

const bad = rows.filter((r) => r.nav !== 16 || !r.ph || !r.pager || r.h > 2000)
console.log(`\n截图完成：${rows.length} 屏 → ${OUT}`)
console.log(`超线 / 壳异常：${bad.length}`)
bad.forEach((b) => console.log(`  ✗ ${b.id} h=${b.h} nav=${b.nav} ph=${b.ph} pager=${b.pager}`))
process.exit(bad.length ? 1 : 0)
