// 从 manifest.js 生成「屏 → 目标路由 → 原型文件」对照表（供任务书引用）
import { readFileSync } from "node:fs"
const src = readFileSync(new URL("../prototype/assets/manifest.js", import.meta.url), "utf8")
const modRe = /(\w+):\s*\{\s*\n\s*label:\s*"([^"]+)"[\s\S]*?screens:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/g
const routePrefix = {
  home: "",
  customer: "/customer-management",
  intel: "/intel-center",
  solution: "/solution-studio",
  mapping: "/product-mapping",
  ppt: "/ppt-quote",
  material: "/materials",
  bid: "/bid-workspace",
  check: "/bid-check",
  format: "/format-tool",
  kb: "/knowledge",
  qual: "/qual-certs",
  competitor: "/competitors",
  assistant: "/assistant",
  model: "/model-config",
  team: "/team",
}
let m
const out = []
while ((m = modRe.exec(src))) {
  const key = m[1]
  const screenRe = /\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)",\s*tab:\s*"([^"]+)"/g
  let s
  let i = 0
  while ((s = screenRe.exec(m[3]))) {
    i++
    const prefix = routePrefix[key]
    // 子路由规则：第一屏 = 父路径，其余 = 父路径/子段
    const slug = s[2].split("/").pop().replace(".html", "")
    const route =
      i === 1
        ? prefix || "/"
        : `${prefix}/${slug === "index" ? "" : slug}`
    out.push({ mod: key, modLabel: m[2], tab: s[3], screenId: s[1], file: s[2], route })
  }
}
console.log("| 屏 | 目标路由 | 原型文件 | screen id |")
console.log("|---|---|---|---|")
for (const r of out) console.log(`| ${r.modLabel} · ${r.tab} | \`${r.route}\` | \`${r.file}\` | \`${r.screenId}\` |`)
console.log(`\n合计 ${out.length} 屏`)
