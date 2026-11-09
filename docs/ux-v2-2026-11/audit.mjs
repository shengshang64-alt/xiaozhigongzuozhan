// 全屏体检：横向溢出 / 超大 SVG / 图片缺失 / 控制台错误
// 用法：node docs/ux-v2-2026-11/audit.mjs [baseUrl]
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const PW = ["D:/AppDataOnD/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core", "playwright-core"]
const { chromium } = (() => { for (const p of PW) { try { return require(p) } catch {} } throw new Error("no playwright-core") })()

const BASE = process.argv[2] || "http://127.0.0.1:8099/"
const { readFileSync } = await import("node:fs")
const src = readFileSync(new URL("./prototype/assets/manifest.js", import.meta.url), "utf8")
const screens = []
const modRe = /(\w+):\s*\{\s*\n\s*label:\s*"[^"]+"[\s\S]*?screens:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/g
let m
while ((m = modRe.exec(src))) {
  const re = /\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)"/g
  let s
  while ((s = re.exec(m[2]))) screens.push({ id: s[1], file: s[2] })
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
const problems = []
page.on("console", (msg) => { if (msg.type() === "error" && !/favicon/.test(msg.text())) problems.push(`[console] ${page.url()} :: ${msg.text().slice(0, 120)}`) })

const rows = []
for (const sc of screens) {
  await page.goto(BASE + sc.file, { waitUntil: "networkidle" })
  await page.waitForTimeout(80)
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const over = []
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > vw + 2 && r.height > 0) over.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 40), w: Math.round(r.width) })
    })
    const bigSvg = []
    document.querySelectorAll("svg").forEach((s) => {
      const r = s.getBoundingClientRect()
      if (r.width > 120 || r.height > 120) bigSvg.push({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    const imgs = [...document.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0).length
    return {
      hOverflow: document.documentElement.scrollWidth > vw + 2,
      scrollW: document.documentElement.scrollWidth,
      over: over.slice(0, 3),
      bigSvg: bigSvg.slice(0, 3),
      badImgs: imgs,
      h: document.documentElement.scrollHeight,
    }
  })
  rows.push({ ...sc, ...r })
  if (r.hOverflow || r.badImgs || r.bigSvg.length) {
    problems.push(`${sc.id}: overflow=${r.hOverflow}(sw=${r.scrollW}) imgs=${r.badImgs} bigSvg=${JSON.stringify(r.bigSvg)} over=${JSON.stringify(r.over)}`)
  }
}
await browser.close()

console.log(`检查 ${rows.length} 屏`)
const tall = rows.filter((r) => r.h > 2000)
console.log(`横向溢出/坏图/超大 SVG/控制台错误：${problems.length}`)
problems.forEach((p) => console.log("  ✗ " + p))
console.log(`高度 >2000px：${tall.length}`)
tall.forEach((t) => console.log("  ! " + t.id + " h=" + t.h))
const max = rows.reduce((a, b) => (b.h > a.h ? b : a), rows[0])
console.log(`最高屏：${max.id} ${max.h}px`)
