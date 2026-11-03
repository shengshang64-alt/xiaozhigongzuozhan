// scripts/backfill-kb-section.mjs — 2026-10-07 用户需求：kb_docs 章节用途（kb_section）回填
//
// 把全部 kb_docs 按「标书实战章节体系」重新分级分类（设计方案/项目建设背景/项目建设要求/
// 需求分析/实施方案/售后方案/培训方案/安全保障/架构图/流程图/项目案例/其他）。
// 规则与 src/lib/kbTaxonomy.ts deriveSection 同步维护；零 AI，纯关键词判定。
//
// 用法（PocketBase 需 127.0.0.1:7000 在线）：
//   node scripts/backfill-kb-section.mjs --dry     # 只看分布，不写
//   node scripts/backfill-kb-section.mjs           # 正式执行（已带值的跳过）
//   node scripts/backfill-kb-section.mjs --force   # 覆盖已有值
//
// 鉴权：走 X-Rh-User-Id: local-user（与 backfill-kb-taxonomy.mjs 同口径）。

import fs from "node:fs"

const BASE = "http://127.0.0.1:7000"
const LOCAL_USER = "local-user"
const DRY = process.argv.includes("--dry")
const FORCE = process.argv.includes("--force")

// --- 章节用途词表（与 src/lib/kbTaxonomy.ts KB_SECTIONS 同步；改词表两处一起改）---
const SECTION_RULES = [
  ["架构图", /架构图|拓扑图|系统架构|总体架构|网络架构|应用架构|架构设计/],
  ["流程图", /流程图|泳道图|业务流程图|业务流程/],
  ["需求分析", /需求分析|需求调研|需求理解|业务需求|功能需求|用户需求|需求规格|需求响应/],
  ["建设要求", /建设要求|建设内容|采购需求|技术要求|招标要求|采购要求|考核要求|建设标准|响应要求/],
  ["售后方案", /售后服务|售后方案|运维方案|运维服务|维保|质保|驻场|巡检|服务承诺/],
  ["培训方案", /培训/],
  ["安全保障", /安全保障|安全方案|等级保护|等保|应急预案|应急响应|备份|容灾|数据安全|网络安全/],
  ["建设背景", /建设背景|项目背景|政策背景|背景分析|现状分析|政策依据|发展现状/],
  ["实施方案", /实施方案|项目实施|实施部署|部署方案|上线方案|割接|数据迁移|进度计划|项目组织|人员配备|项目管理|施工组织/],
  ["设计方案", /设计方案|总体设计|功能设计|数据库设计|技术方案|建设方案|总体建设|方案设计|技术架构|应用架构|技术路线/],
  ["项目案例", /项目案例|同类案例|业绩案例|成功案例|典型案例/],
]

function deriveSection(text) {
  const hay = String(text ?? "")
  for (const [section, re] of SECTION_RULES) if (re.test(hay)) return section
  return "其他"
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": LOCAL_USER, ...(options.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

async function main() {
  const dist = new Map()
  let page = 1
  let patched = 0
  let skipped = 0
  let total = 0
  for (;;) {
    const d = await api(`/api/kb_docs?perPage=200&page=${page}&sort=created&skipTotal=1`)
    const items = d.items ?? []
    if (!items.length) break
    for (const it of items) {
      total++
      const hay = `${it.title ?? ""}\n${String(it.summary ?? "").slice(0, 400)}\n${String(it.content ?? "").slice(0, 2000)}`
      const section = deriveSection(hay)
      dist.set(section, (dist.get(section) ?? 0) + 1)
      if (!FORCE && (it.kb_section ?? "").trim()) { skipped++; continue }
      if (DRY) continue
      await api(`/api/kb_docs/${it.id}`, {
        method: "PATCH",
        body: JSON.stringify({ kb_section: section }),
      })
      patched++
    }
    if (items.length < 200) break
    page++
  }
  console.log(`total=${total} patched=${patched} skipped(has value)=${skipped}${DRY ? " (DRY)" : ""}`)
  console.log("分布：")
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
  if (!DRY && !fs.statSync(import.meta.url.replace("file:///", "")).size) console.log("")
}

main().catch((e) => {
  console.error("回填失败：", e.message)
  process.exit(1)
})
