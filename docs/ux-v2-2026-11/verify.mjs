// 原型批量自检脚本（Node，无依赖）
// 用法：node docs/ux-v2-2026-11/verify.mjs
// 检查项：
//  1. manifest 声明的每个 file 都存在
//  2. 每个 HTML 的 data-mod / data-screen 与 manifest 一致
//  3. 无行内色值（style 里出现 color / background / border-color 十六进制或 rgb）
//  4. 无模板语法残留（${ 、{{ 、[object Object]）
//  5. 无 emoji 当图标（粗略：常见 emoji 码段）
//  6. 文件里必须有 data-subtabs / data-pager 挂点
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "prototype")

// ---- 从 manifest.js 里粗暴解析（不执行浏览器代码） ----
const manifestSrc = readFileSync(join(ROOT, "assets", "manifest.js"), "utf8")
const screens = []
const modRe = /(\w+):\s*\{\s*\n\s*label:\s*"([^"]+)"[\s\S]*?screens:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/g
let m
while ((m = modRe.exec(manifestSrc))) {
  const mod = m[1]
  const screenRe = /\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)",\s*tab:\s*"([^"]+)"/g
  let s
  while ((s = screenRe.exec(m[3]))) screens.push({ mod, id: s[1], file: s[2], tab: s[3] })
}

const errors = []
const warns = []

// ---- 1&2 文件存在 + data 属性 ----
for (const sc of screens) {
  const p = join(ROOT, sc.file)
  if (!existsSync(p)) { errors.push(`[缺失] ${sc.file}（manifest: ${sc.mod}/${sc.id}）`); continue }
  const html = readFileSync(p, "utf8")
  const modAttr = (html.match(/data-mod="([^"]*)"/) || [])[1]
  const scrAttr = (html.match(/data-screen="([^"]*)"/) || [])[1]
  if (modAttr !== sc.mod) errors.push(`[data-mod 不符] ${sc.file}：实际 ${modAttr}，应为 ${sc.mod}`)
  if (scrAttr !== sc.id) errors.push(`[data-screen 不符] ${sc.file}：实际 ${scrAttr}，应为 ${sc.id}`)
  if (!html.includes("data-subtabs")) errors.push(`[缺挂点] ${sc.file} 缺 data-subtabs`)
  if (!html.includes("data-pager")) errors.push(`[缺挂点] ${sc.file} 缺 data-pager`)
  if (!html.includes("../assets/design.css")) errors.push(`[缺样式] ${sc.file} 未引入 design.css`)
  if (!html.includes("../assets/manifest.js") || !html.includes("../assets/shell.js"))
    errors.push(`[缺脚本] ${sc.file} 未引入 manifest.js / shell.js`)

  // ---- 3 行内色值（允许 var(--token) 与 token 组成的渐变，只禁止硬编码色）----
  const styleAttrs = [...html.matchAll(/style="([^"]*)"/g)].map((x) => x[1])
  const ALLOW_NAME = /^(transparent|inherit|currentColor|none)$/i
  for (const st of styleAttrs) {
    // 剥掉所有 var(--…) 再检查，避免把 token 误判为硬编码
    const stripped = st.replace(/var\(--[\w-]+\)/g, "TOKEN")
    if (/#[0-9a-fA-F]{3,8}\b/.test(stripped)) {
      errors.push(`[硬编码色] ${sc.file}：style="${st.slice(0, 90)}"`)
      continue
    }
    if (/\brgba?\(/.test(stripped)) {
      errors.push(`[硬编码色] ${sc.file}：style="${st.slice(0, 90)}"`)
      continue
    }
    // 找 color / background 声明，允许 TOKEN、transparent、以及只含 TOKEN 的渐变
    const decls = stripped.match(/(?:^|;)\s*(?:color|background|background-color)\s*:\s*([^;]+)/gi) || []
    for (const d of decls) {
      const val = d.split(":").slice(1).join(":").trim()
      if (/TOKEN/.test(val)) continue                 // 含 token 的都放行（渐变色标也用 token）
      if (ALLOW_NAME.test(val)) continue
      errors.push(`[行内颜色名] ${sc.file}：${d.trim().slice(0, 80)}`)
    }
  }

  // ---- 3b 组件类是否都用 token：检查页面里是否有 <style> 覆盖（禁止）----
  if (/<style[\s>]/i.test(html)) warns.push(`[页面内嵌 style 块] ${sc.file}（应只在 design.css 定义）`)

  // ---- 4 模板语法残留 ----
  if (/\$\{/.test(html)) errors.push(`[模板残留] ${sc.file} 含 \${`)
  if (/\{\{/.test(html)) errors.push(`[模板残留] ${sc.file} 含 {{`)
  if (/\[object Object\]/.test(html)) errors.push(`[渲染残留] ${sc.file} 含 [object Object]`)

  // ---- 5 emoji 当图标（只查图形符号与彩符号，不查 ✓ ✕ ★ ⚠ 这类状态字符）----
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu
  const emojiHits = html.match(emojiRe)
  if (emojiHits) warns.push(`[疑似 emoji] ${sc.file}：${[...new Set(emojiHits)].join(" ")}`)

  // ---- 6 一屏一个主 CTA ----
  const primaryCount = (html.match(/btn--primary/g) || []).length
  if (primaryCount > 2) warns.push(`[主 CTA 偏多] ${sc.file}：btn--primary 出现 ${primaryCount} 次（含弹窗内则忽略）`)

  // ---- 7 结构提示 ----
  if (!html.includes('class="ph"')) errors.push(`[缺页头] ${sc.file} 无 .ph`)
}

// ---- 8 页面文件是否都在 manifest 里（孤儿文件）----
function walk(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (f.endsWith(".html")) out.push(p)
  }
  return out
}
const declared = new Set(screens.map((s) => s.file.replace(/\\/g, "/")))
for (const p of walk(ROOT)) {
  const rel = relative(ROOT, p).replace(/\\/g, "/")
  if (rel === "index.html") continue
  if (!declared.has(rel)) warns.push(`[孤儿文件] ${rel} 未在 manifest 声明`)
}

// ---- 输出 ----
const total = screens.length
const ok = total - new Set(errors.filter((e) => /缺失/.test(e)).map((e) => e)).size
console.log(`\n=== 小智工作站 · 原型自检 ===`)
console.log(`manifest 声明屏数：${total}`)
console.log(`错误：${errors.length}　警告：${warns.length}\n`)
if (errors.length) { console.log("--- 错误 ---"); errors.forEach((e) => console.log("  ✗ " + e)) }
if (warns.length) { console.log("--- 警告 ---"); warns.forEach((w) => console.log("  ! " + w)) }
if (!errors.length && !warns.length) console.log("✅ 全部通过")
process.exit(errors.length ? 1 : 0)
