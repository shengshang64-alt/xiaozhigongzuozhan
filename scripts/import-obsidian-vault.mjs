// R-206 第一批：Obsidian 知识层（Markdown 笔记）批量入系统知识库 kb_docs
//
// 素材：D:\重要文件\A重要客户情况（Obsidian vault 的 Markdown 知识层，~107 篇）
// 规则：
//   - 排除 .obsidian / _MOC/文件索引（自动生成的全量文件清单，噪声）与 >200KB 巨型文件
//   - front-matter 的 tags 抽成关键词；清洗 [[wiki 链接]] / ![[图片嵌入]]
//   - 敏感口径（用户拍板）：客户名单/商机业绩类 → visibility=personal 仅本人（local-user）可见
//   - doc_category 按目录+文件名映射七档；其余走 kbPolicy「其他」默认策略（原文可进 AI）
//   - 幂等：按 title 去重，已存在跳过；可反复重跑
// 用法：PocketBase 需在 127.0.0.1:7000 运行，node scripts/import-obsidian-vault.mjs
import fs from "node:fs"
import path from "node:path"

const BASE = "http://127.0.0.1:7000"
const VAULT = "D:\\重要文件\\A重要客户情况"
const MAX_BYTES = 200 * 1024
const LOCAL_USER = "local-user" // 本地部署共享池身份（rhLogin.ts LOCAL_DEPLOY_USER_ID）

/** 命中即 visibility=personal（含真实客户名单/商机数据的具体笔记） */
const SENSITIVE_PATH_RE = /客户画像|拜访记录|安徽省客户情况|ONELINK|商机池|成单复盘|商机漏斗/

/** 目录前缀 → doc_category（七档，见 src/lib/kbPolicy.ts） */
const CATEGORY_BY_DIR = [
  [/^03-政策法规/, "政策法规"],
  [/^02-解决方案/, "技术方案"],
  [/^04-竞品分析/, "产品资料"],
  [/^05-产品知识/, "产品资料"],
  [/^_Templates/, "技术方案"],
]
const CATEGORY_BY_NAME = [
  [/摘要-\d*竞争对手|竞品|攻防/, "产品资料"],
  [/政策|标准|规范/, "政策法规"],
  [/方案|模板|偏离表|POC|调研报告/, "技术方案"],
  [/标杆案例|案例/, "项目案例"],
]

function guessCategory(relPath) {
  for (const [re, cat] of CATEGORY_BY_DIR) if (re.test(relPath)) return cat
  const name = path.basename(relPath, ".md")
  for (const [re, cat] of CATEGORY_BY_NAME) if (re.test(name)) return cat
  return "" // 空 → kbPolicy 按「其他」默认策略走
}

/** 拆 YAML front-matter（只处理 tags 数组与标量，够用） */
function splitFrontMatter(raw) {
  const text = raw.replace(/^\uFEFF/, "")
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { body: text, tags: [] }
  const tags = []
  let inTags = false
  for (const line of m[1].split(/\r?\n/)) {
    if (/^tags:/.test(line)) { inTags = true; continue }
    if (inTags) {
      const t = line.match(/^\s+-\s+(.+)/)
      if (t) { tags.push(t[1].trim()); continue }
      const inline = line.match(/^tags:\s*\[(.*)\]/)
      if (inline) tags.push(...inline[1].split(",").map((s) => s.trim()).filter(Boolean))
      inTags = false
    }
  }
  return { body: text.slice(m[0].length), tags }
}

/** wiki 链接/图片嵌入清洗：![[x]] 删除，[[a|b]] → b，[[a]] → a */
function cleanWiki(body) {
  return body
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
}

function pickTitle(body, fallback) {
  const h1 = body.match(/^#\s+(.+)$/m)
  const raw = (h1 ? h1[1] : fallback).replace(/\{\{[^}]*\}\}/g, "").replace(/[#*>`|]/g, " ")
  const cleaned = raw.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").replace(/[\s\u00B7.\u2014\u2013\-_/\\,，;；:：]+$/u, "").trim()
  return cleaned || fallback
}

function pickSummary(body) {
  const lines = body.split(/\r?\n/).map((l) => l.trim())
  const cand = lines.find((l) => l.startsWith(">")) || lines.find((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("```"))
  return (cand || "").replace(/^>\s*/, "").slice(0, 180)
}

function collectMdFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectMdFiles(p, out)
    else if (e.name.endsWith(".md")) out.push(p)
  }
  return out
}

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  })
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

// 全部现有记录：source_file_name 为幂等键（title 可含展示性重复，文件名全局唯一）
async function fetchAllByKey() {
  const keys = new Set()
  for (let page = 1; page <= 20; page++) {
    const o = await api(`/api/kb_docs?perPage=200&page=${page}`)
    for (const it of o.items || []) keys.add(String(it.source_file_name || "") + "\u0000" + String(it.title || ""))
    if (!o.items || o.items.length < 200) break
  }
  return keys
}

const existing = await fetchAllByKey()
console.log(`现有 kb_docs: ${existing.size} 条`)

const skipDirs = [path.join(VAULT, "_MOC", "文件索引")]
const files = collectMdFiles(VAULT, []).filter((p) => !skipDirs.some((d) => p.startsWith(d)))
console.log(`扫描到 md: ${files.length} 篇（已排除 .obsidian 与 _MOC/文件索引）`)

let ok = 0, skipped = 0, tooBig = 0, bad = 0
for (const p of files) {
  const rel = path.relative(VAULT, p).replace(/\\/g, "/")
  const nameNoExt = path.basename(p, ".md")
  const stat = fs.statSync(p)
  if (stat.size > MAX_BYTES) { tooBig++; console.log(`[big-skip] ${rel} (${(stat.size / 1024).toFixed(0)}KB)`); continue }
  let body, tags
  try {
    ;({ body, tags } = splitFrontMatter(fs.readFileSync(p, "utf8")))
    body = cleanWiki(body).trim()
  } catch (e) { bad++; console.log(`[read-fail] ${rel}: ${e.message}`); continue }
  if (body.length < 20) { bad++; console.log(`[empty-skip] ${rel}`); continue }

  const sensitive = SENSITIVE_PATH_RE.test(rel)
  const dirLabel = rel.includes("/") ? path.dirname(rel).split("/").join("·") : "_MOC"
  const title = `售前知识库/${dirLabel}/${pickTitle(body, nameNoExt)}`
  // 幂等：source_file_name 精确等于 rel（后端 q 为 LIKE 匹配，这里本地精确判定）
  if (existing.has(`${rel}\u0000${title}`)) { skipped++; continue }
  const keywords = [...new Set([...tags, ...(title.match(/[\u4e00-\u9fa5A-Za-z]{2,10}/g) || []).slice(0, 6)])].slice(0, 12)

  await api("/api/kb_docs", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: LOCAL_USER,
      title,
      folder_path: `售前知识库/${dirLabel}`,
      content: body,
      doc_format: "md",
      visibility: sensitive ? "personal" : "team",
      summary: pickSummary(body) || `来自 Obsidian 知识库笔记「${title}」（${rel}）`,
      keywords,
      source_file_name: rel,
      uploader_name: "知识库导入",
      doc_category: guessCategory(rel),
      ai_context_mode: "",
      retrieval_weight: 1.0,
      is_sensitive: sensitive,
    }),
  })
  ok++
  if (sensitive) console.log(`[personal] ${rel} → 仅本人可见`)
}

console.log(`\n完成：入库 ${ok}，已存在跳过 ${skipped}，超大跳过 ${tooBig}，空/读失败 ${bad}`)
const after = await api(`/api/kb_docs?perPage=1&visibility=team`)
console.log(`团队库现有 ${after.totalItems} 条（含 R-203 的 5 条口径注意：totalItems 返回的是当页条数语义）`)
