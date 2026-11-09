// 逐屏实机走查：打开线上 dev server，检查每屏是否真的渲染出内容
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const PW = ["D:/AppDataOnD/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core", "playwright-core"]
const { chromium } = (() => { for (const p of PW) { try { return require(p) } catch {} } throw new Error("no playwright-core") })()

const BASE = process.argv[2] || "http://localhost:8000"
const routes = [
  ["/", "工作台总览"],
  ["/customer-management", "客户管理·列表"],
  ["/customer-management/detail", "客户管理·详情"],
  ["/customer-management/kanban", "客户管理·看板"],
  ["/customer-management/followup", "客户管理·跟进"],
  ["/customer-management/import", "客户管理·导入"],
  ["/intel-center", "情报·审阅"],
  ["/intel-center/browse", "情报·浏览"],
  ["/intel-center/detail", "情报·详情"],
  ["/intel-center/industry", "情报·行业前沿"],
  ["/intel-center/sources", "情报·数据源"],
  ["/solution-studio", "方案·列表"],
  ["/solution-studio/editor", "方案·编辑器"],
  ["/solution-studio/checklist", "方案·清单"],
  ["/solution-studio/delivery", "方案·体检"],
  ["/product-mapping", "映射·选清单"],
  ["/product-mapping/compare", "映射·对照"],
  ["/product-mapping/result", "映射·结果"],
  ["/product-mapping/library", "映射·产品库"],
  ["/ppt-quote", "PPT·列表"],
  ["/ppt-quote/editor", "PPT·编辑器"],
  ["/ppt-quote/quote-list", "报价·列表"],
  ["/ppt-quote/quote-editor", "报价·编辑"],
  ["/ppt-quote/quote-preview", "报价·预览"],
  ["/materials", "素材·总览"],
  ["/materials/import", "素材·导入"],
  ["/materials/web", "素材·抓取"],
  ["/materials/settings", "素材·设置"],
  ["/bid-workspace", "标书·列表"],
  ["/bid-workspace/import", "标书①导入"],
  ["/bid-workspace/parse", "标书②解析"],
  ["/bid-workspace/outline", "标书③大纲"],
  ["/bid-workspace/draft", "标书④正文"],
  ["/bid-workspace/deviation", "标书⑤偏离"],
  ["/bid-workspace/check", "标书⑥自查"],
  ["/bid-workspace/export", "标书⑦导出"],
  ["/bid-workspace/rehearse", "标书·答辩"],
  ["/bid-workspace/archive", "标书·归档"],
  ["/bid-check", "检查·新建"],
  ["/format-tool", "格式·上传"],
  ["/knowledge", "知识库·文档库"],
  ["/knowledge/search", "知识库·检索"],
  ["/knowledge/atoms", "知识库·原子"],
  ["/knowledge/review", "知识库·审核"],
  ["/knowledge/qa", "知识库·问答"],
  ["/knowledge/upload", "知识库·上传"],
  ["/qual-certs", "资质·台账"],
  ["/qual-certs/alerts", "资质·预警"],
  ["/qual-certs/bulk", "资质·批量"],
  ["/competitors", "竞品·应标"],
  ["/assistant", "助手·会话"],
  ["/model-config", "模型·通道"],
  ["/team", "团队·成员"],
  ["/ai-hot", "AI动态（重定向验证）"],
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
// 先登录
await page.goto(BASE + "/", { waitUntil: "networkidle" })
const needLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'))
if (needLogin) {
  await page.fill('input[type="email"], input[placeholder="邮箱"]', "admin@team.local")
  await page.fill('input[type="password"]', "Admin#12345")
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
}
const loggedIn = !(await page.evaluate(() => !!document.querySelector('input[type="password"]')))
console.log(`登录状态：${loggedIn ? "已登录" : "未登录（后面结果不可信）"}`)

const rows = []
for (const [path, name] of routes) {
  const errs = []
  const onConsole = (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)) }
  page.on("console", onConsole)
  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 15000 })
    await page.waitForTimeout(900)
    const r = await page.evaluate(() => {
      const panel = document.querySelector("[data-tab-panel]:not([hidden])") || document.body
      const h1 = panel.querySelector("h1")
      const tabs = document.querySelectorAll('[role="tab"],[data-screen-tab]').length
      const txt = document.body.innerText || ""
      return {
        url: location.pathname + location.search,
        title: document.title,
        h1: h1 ? h1.textContent.trim().slice(0, 40) : null,
        len: txt.trim().length,
        tabs,
        hasError: /页面加载中|出错了|Something went wrong|Cannot read/.test(txt.slice(0, 600)),
        emptyish: txt.trim().length < 200,
      }
    })
    rows.push({ name, path, ...r, errs: errs.slice(0, 2) })
  } catch (e) {
    rows.push({ name, path, url: path, title: "TIMEOUT/ERR", h1: null, len: 0, tabs: 0, hasError: true, emptyish: true, errs: [String(e).slice(0, 120)] })
  }
  page.off("console", onConsole)
}
await browser.close()

console.log(`\n${"屏".padEnd(16)} ${"长度".padStart(6)} tab  h1 / URL`)
console.log("-".repeat(100))
let bad = 0
for (const r of rows) {
  const flag = r.emptyish || r.hasError || !r.h1 ? "✗" : " "
  if (flag === "✗") bad++
  console.log(`${flag} ${r.name.padEnd(14)} ${String(r.len).padStart(6)} ${String(r.tabs).padStart(3)}  ${(r.h1 || "(无 h1)").slice(0, 30)}  ${r.url}`)
  if (r.errs.length) r.errs.forEach((e) => console.log(`      console: ${e}`))
}
console.log(`\n异常屏：${bad} / ${rows.length}`)
