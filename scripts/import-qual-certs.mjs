// 资质证书批量建账（2026-09-28 资质台账配套，仿 import-ammunition.mjs 模式）
//
// 扫描资质目录，从文件名解析有效期（多格式），POST /api/qual_certs 建账。
// 幂等：按证照名称去重，重复执行只补新增。
// 用法：PocketBase 运行在 127.0.0.1:7000
//   node scripts/import-qual-certs.mjs            # 实际导入
//   node scripts/import-qual-certs.mjs --dry-run  # 只看解析结果
import fs from "node:fs"
import path from "node:path"

const BASE = "http://127.0.0.1:7000"
const USER = "local-user"
const HEADERS = { "Content-Type": "application/json", "X-Rh-User-Id": USER }
const ROOTS = [
  "D:/重要文件/A重要客户情况/09-招投标培训学习库/05公司资质（证书、著作权等）/1、公司资质",
  "D:/重要文件/A重要客户情况/09-招投标培训学习库/05公司资质（证书、著作权等）/5、著作权",
]
const dryRun = process.argv.includes("--dry-run")

/** 归一日期：2024.10.20 / 2024-10-20 / 2024.10.2 → 2024-10-20 */
function normDate(s) {
  const m = s.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/)
  if (!m) return ""
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

/** 从文件名解析有效期起止（覆盖已见格式） */
function parseValidity(name) {
  const n = name.replace(/\s+/g, "")
  let m =
    n.match(/有效期(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})[-至~]{1,2}(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/) ||
    n.match(/(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})至(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/)
  if (m) return { valid_from: normDate(m[1]), valid_to: normDate(m[2]) }
  m = n.match(/有效期至[：:]?\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/)
  if (m) return { valid_from: "", valid_to: normDate(m[1]) }
  return { valid_from: "", valid_to: "" }
}

/** 分类推断 */
function inferCategory(name) {
  if (/软件著作权|著作权/.test(name)) return "软件著作权"
  if (/CMMI|ISO|ITSS|体系认证/.test(name)) return "体系认证"
  if (/工程师|项目经理|师证书|资格证/.test(name)) return "人员证书"
  if (/营业执照|许可证|高新|证书|资质|信用/.test(name)) return "硬资质"
  return "其他"
}

function* walk(dir, depth) {
  if (depth > 2) return
  let es
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(fp, depth + 1)
    else if (!/^(Thumbs\.db|desktop\.ini|~\$)/i.test(e.name)) yield fp
  }
}

// ---- 扫描与解析 ----
const found = []
for (const root of ROOTS) {
  for (const fp of walk(root, 0)) {
    const name = path.basename(fp)
    const ext = path.extname(name).toLowerCase()
    if (![".pdf", ".docx", ".png", ".jpg", ".jpeg", ".xlsx"].includes(ext)) continue
    // 去扩展名，去掉"正本/副本/扫描件"等修饰词前的连字符噪声
    const base = path.basename(name, ext)
    if (/变更证明/.test(base)) continue // 软著变更证明不是独立证书，跳过
    // ⚠️ 有效期解析必须用原始文件名（base 已剥离有效期后缀，会解析失败）
    const v = parseValidity(base)
    const cleanedName = base
      .replace(/（有效期[^）]*）|\【[^】]*\】|\[有效期[^\]]*\]/g, "")
      .replace(/[-_\s]*$/, "")
      .trim() || base
    found.push({
      cert_name: cleanedName,
      category: inferCategory(base),
      valid_from: v.valid_from,
      valid_to: v.valid_to,
      file_ref: fp,
      notes: "批量导入（来源：资质目录文件名解析）",
    })
  }
}

console.log(`扫描到 ${found.length} 个文件`)
for (const f of found) {
  console.log(`  [${f.category}] ${f.cert_name}  有效期: ${f.valid_from || "—"} ~ ${f.valid_to || "未登记"}`)
}

// ---- 幂等建账 ----
const existing = await (await fetch(`${BASE}/api/qual_certs?perPage=500`, { headers: HEADERS })).json()
const have = new Set((existing.items ?? []).map((r) => r.cert_name))
let created = 0, skipped = 0
for (const f of found) {
  if (have.has(f.cert_name)) { skipped++; continue }
  if (dryRun) { console.log(`[dry-run] 将登记: ${f.cert_name}`); created++; continue }
  const r = await fetch(`${BASE}/api/qual_certs`, { method: "POST", headers: HEADERS, body: JSON.stringify(f) })
  if (r.ok) created++
  else console.error(`  ✗ ${f.cert_name}: HTTP ${r.status}`)
}
console.log(`完成：新增 ${created} 条，跳过已存在 ${skipped} 条${dryRun ? "（dry-run 未实际写入）" : ""}`)
