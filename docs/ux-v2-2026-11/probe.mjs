// 抽查若干屏的组件渲染尺寸（Node + playwright-core）
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const PW_PATHS = [
  "D:/AppDataOnD/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core",
  "playwright-core",
]
function loadPW() {
  for (const p of PW_PATHS) { try { return require(p) } catch {} }
  throw new Error("找不到 playwright-core")
}
const { chromium } = loadPW()

const BASE = process.argv[2] || "http://127.0.0.1:8099/"
const checks = [
  {
    url: "check/report.html",
    name: "检查报告 · 按规则包分布（chart-bars）",
    js: () => {
      const t = document.querySelector(".cbar .track")
      const f = document.querySelector(".cbar .fill")
      return { cbars: document.querySelectorAll(".cbar").length, trackH: t ? t.offsetHeight : null, fillH: f ? f.offsetHeight : null }
    },
  },
  {
    url: "kb/search.html",
    name: "全文检索 · 命中高亮",
    js: () => ({ hl: document.querySelectorAll(".hl").length, badge: document.querySelectorAll(".badge").length }),
  },
  { url: "format/preview.html", name: "格式刷新 · 纸张块", js: () => ({ papers: document.querySelectorAll(".paper").length, diff: document.querySelectorAll(".paper .diff").length }) },
  { url: "ppt/quote-editor.html", name: "报价编辑 · 参数卡", js: () => ({ spec: document.querySelectorAll(".spec-card").length }) },
  { url: "material/list.html", name: "素材总览 · 缩略块", js: () => ({ thumbs: document.querySelectorAll(".thumb").length }) },
  { url: "customer/detail.html", name: "客户详情 · 三栏", js: () => ({ split: !!document.querySelector(".split"), pager: document.querySelector("[data-pager]")?.children.length }) },
  { url: "bid/draft.html", name: "标书正文 · 三栏一屏", js: () => ({ h: document.documentElement.scrollHeight }) },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
for (const c of checks) {
  await page.goto(BASE + c.url, { waitUntil: "networkidle" })
  await page.waitForTimeout(100)
  const r = await page.evaluate(c.js)
  console.log(`${c.name.padEnd(30)} ${JSON.stringify(r)}`)
}
await browser.close()
