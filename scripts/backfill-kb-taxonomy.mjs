// scripts/backfill-kb-taxonomy.mjs — 组装层第一期：kb_docs 赛道/用途桶回填 + .md/.txt 白捡补库
//
// 两个阶段（幂等，可反复重跑）：
//   Phase A 回填：分页拉全部 kb_docs，用与 src/lib/kbTaxonomy.ts 同规则派生 kb_track/kb_bucket，
//                 PATCH 写回（已带值的默认跳过，--force 覆盖）。
//   Phase B 补库：扫描 VAULT 下 .md/.txt，入库时直接带 track/bucket；按 source_file_name=相对路径
//                 去重，已入库的跳过（与 import-obsidian-vault.mjs 同幂等键）。
//
// 口径：doc_category/ai_context_mode/retrieval_weight 一律不动（敏感档维持 sanitized_summary）；
//       竞品目录（友商公司产品/竞品/攻防话术）强制 bucket=竞品情报，修正「响应/应答」误判标书桶。
//
// 用法：PocketBase 需 127.0.0.1:7000 在线。
//   node scripts/backfill-kb-taxonomy.mjs --dry      # 只看分布，不写
//   node scripts/backfill-kb-taxonomy.mjs            # 正式执行 A+B
//   node scripts/backfill-kb-taxonomy.mjs --only-a   # 仅回填
//   node scripts/backfill-kb-taxonomy.mjs --force     # A 覆盖已有标签
import fs from "node:fs"
import path from "node:path"

const BASE = "http://127.0.0.1:7000"
const VAULT = "D:\\重要文件\\A重要客户情况"
const LOCAL_USER = "local-user"
const DRY = process.argv.includes("--dry")
const FORCE = process.argv.includes("--force")
const ONLY_A = process.argv.includes("--only-a")
const MAX_BYTES = 200 * 1024

// --- 分类法（与 src/lib/kbTaxonomy.ts 同步；改词表两处一起改）---------------
const TRACK_RULES = [
  ["电子病历评级", /电子病历.{0,8}(评级|过级|升级|分级|五[级6]|六[级7]|七[级8])|病历评级|分级评价|EMR[4567]/gi],
  ["互联互通评级", /互联互通|标准化成熟度|信息互联互通|四甲|集成平台.{0,4}测评/g],
  ["医共体建设", /医共体|医联体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型|区域.{0,3}(医疗|卫生)中心|分级诊疗/g],
  ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查|支付方式/g],
  ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/g],
  ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全|态势感知|隐私/g],
  ["中医医院", /中医|中药|辨证|治未病|中医药|中西医结合/g],
  ["运营管理HRP", /HRP|绩效|国考|成本核算|运营管理|经济核算/g],
  ["互联网医院", /互联网医院|互联网诊疗|在线问诊|远程医疗|远程会诊|掌上医院/g],
  ["集成平台", /集成平台|信息集成|\bESB\b|\bHL7\b|数据中心|\bCDR\b|\bODR\b|数据治理|数据中台|健康大脑|全民健康/g],
  ["移动医疗", /移动医疗|移动护理|移动医生|床旁|移动医保/g],
  ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一院多区|一院两区/g],
  ["HIS系统", /\bHIS\b|医院信息系统|门诊住院|收费结算|电子病历系统|一体化.{0,4}(管理|系统)/g],
]
const BUCKET_RULES = [
  ["竞品情报", /竞品|竞对|友商|对手|攻防|话术|东软|卫宁|创业慧康|东华|曼荼罗|鼎新|和仁|易联众|麦迪思/],
  ["标书弹药", /标书|投标|招标|技术偏离|应答|响应文件|评标|开标|可研/],
  ["PPT演示", /PPT|演示|述标|宣传|彩页/],
  ["方案素材", /方案|规划|顶层设计|整体提升/],
  ["政策法规标准", /政策|法规|标准|规范|指南|办法|通知|意见|测评方案|评审标准/],
  ["产品资料", /产品|白皮书|功能清单|架构|接口|操作手册|说明书|技术文档/],
  ["客户与项目", /客户|画像|商机|拜访|台账|项目|合同|验收|复盘|评级清单/],
  ["行业洞察", /行业|趋势|洞察|标杆|案例/],
  ["公司内部", /制度|流程|考核|培训|报销|印章|人事|行政|报价体系/],
]
const COMPETITOR_DIR_RE = /友商公司产品|[\\/]竞品|竞对|攻防话术/

function deriveTrack(text) {
  const hay = text ?? ""
  let best = "通用", bestHits = 0
  for (const [track, re] of TRACK_RULES) {
    re.lastIndex = 0
    const hits = (hay.match(re) || []).length
    if (hits > bestHits) { bestHits = hits; best = track }
  }
  return best
}
function deriveBucket(pathName) {
  const hay = pathName ?? ""
  if (COMPETITOR_DIR_RE.test(hay)) return "竞品情报"
  for (const [bucket, re] of BUCKET_RULES) if (re.test(hay)) return bucket
  return "其他"
}

// --- 复用 import-obsidian-vault 的 .md 清洗（front-matter tags + wiki 链接）---
const SENSITIVE_PATH_RE = /客户画像|拜访记录|安徽省客户情况|ONELINK|商机池|成单复盘|商机漏斗|合同|报价/
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
function cleanWiki(body) {
  return body.replace(/!\[\[[^\]]*\]\]/g, "").replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
}
function pickTitle(body, fallback) {
  const h1 = body.match(/^#\s+(.+)$/m)
  const raw = (h1 ? h1[1] : fallback).replace(/\{\{[^}]*\}\}/g, "").replace(/[#*>`|]/g, " ")
  return raw.replace(/[\s\u00B7.\u2014\u2013\-_/\\,，;；:：]+$/u, "").trim() || fallback
}
function pickSummary(body) {
  const lines = body.split(/\r?\n/).map((l) => l.trim())
  const cand = lines.find((l) => l.startsWith(">")) || lines.find((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("```"))
  return (cand || "").replace(/^>\s*/, "").slice(0, 180)
}

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": LOCAL_USER, ...(options.headers || {}) },
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} → ${res.status}: ${txt.slice(0, 160)}`)
  return txt ? JSON.parse(txt) : null
}

async function fetchAllKb() {
  const all = []
  for (let page = 1; page <= 80; page++) {
    const o = await api(`/api/kb_docs?perPage=200&page=${page}`)
    const items = o.items || []
    all.push(...items)
    if (items.length < 200) break
  }
  return all
}

const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1)
const topOf = (m, n = 30) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

async function main() {
  const existing = await fetchAllKb()
  console.log(`现有 kb_docs: ${existing.length} 条`)

  // ---- Phase A：回填 track/bucket ----
  const trackDist = new Map(), bucketDist = new Map()
  let aUpdated = 0, aSkipped = 0, aFail = 0
  const srcRel = new Set()
  for (const d of existing) {
    const sfn = String(d.source_file_name || "")
    if (sfn && !sfn.includes(":")) srcRel.add(sfn) // .md 白捡去重用（rel 键）
    if (sfn) srcRel.add(path.basename(sfn.replace(/\\/g, "/")).toLowerCase())
    const hasTrack = String(d.kb_track || "").trim()
    const hasBucket = String(d.kb_bucket || "").trim()
    const track = hasTrack && !FORCE ? hasTrack : deriveTrack([d.title, (d.keywords || []).join(" "), String(d.content || "").slice(0, 4000)].join(" "))
    const bucket = hasBucket && !FORCE ? hasBucket : deriveBucket([d.title, d.folder_path, sfn].join("/"))
    inc(trackDist, track); inc(bucketDist, bucket)
    if (!FORCE && hasTrack && hasBucket) { aSkipped++; continue }
    if (DRY) { aUpdated++; continue }
    try {
      await api(`/api/kb_docs/${encodeURIComponent(d.id)}`, { method: "PATCH", body: JSON.stringify({ kb_track: track, kb_bucket: bucket }) })
      aUpdated++
      if (aUpdated % 50 === 0) console.log(`  …回填 ${aUpdated}`)
    } catch (e) { aFail++; if (aFail <= 5) console.log(`PATCHFAIL ${d.id} ${e.message}`) }
  }
  console.log(`\nPhase A ${DRY ? "(dry) " : ""}待写/已写=${aUpdated} 已有跳过=${aSkipped} 失败=${aFail}`)
  console.log("track 分布:", JSON.stringify(Object.fromEntries(topOf(trackDist))))
  console.log("bucket分布:", JSON.stringify(Object.fromEntries(topOf(bucketDist))))
  console.log(`通用占比: ${((trackDist.get("通用") || 0) / existing.length * 100).toFixed(1)}%  其他占比: ${((bucketDist.get("其他") || 0) / existing.length * 100).toFixed(1)}%`)

  if (ONLY_A) return

  // ---- Phase B：.md/.txt 白捡补库（VAULT 下未入库的文本） ----
  const files = []
  const skipDirs = [path.join(VAULT, "_MOC", "文件索引")]
  const walk = (dir) => {
    let es
    try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(md|txt)$/i.test(e.name) && !skipDirs.some((d) => p.startsWith(d))) files.push(p)
    }
  }
  walk(VAULT)
  const todo = []
  for (const p of files) {
    const rel = path.relative(VAULT, p).replace(/\\/g, "/")
    if (srcRel.has(rel) || srcRel.has(path.basename(p).toLowerCase())) continue
    let st; try { st = fs.statSync(p) } catch { continue }
    if (st.size < 40 || st.size > MAX_BYTES) continue
    todo.push({ p, rel })
  }
  console.log(`\nPhase B ${DRY ? "(dry) " : ""}扫描 ${files.length} 文本，未入库待补 ${todo.length}`)
  let bOk = 0, bEmpty = 0, bFail = 0
  for (const { p, rel } of todo) {
    let body, tags
    try {
      ;({ body, tags } = splitFrontMatter(fs.readFileSync(p, "utf8")))
      body = cleanWiki(body).trim()
    } catch { bFail++; continue }
    if (body.length < 20) { bEmpty++; continue }
    const nameNoExt = path.basename(p, path.extname(p))
    const dirLabel = rel.includes("/") ? path.dirname(rel).split("/").join("·") : "_MOC"
    const title = `售前知识库/${dirLabel}/${pickTitle(body, nameNoExt)}`
    const track = deriveTrack([title, body.slice(0, 4000)].join(" "))
    const bucket = deriveBucket(rel)
    const keywords = [...new Set([...tags, ...(title.match(/[\u4e00-\u9fa5A-Za-z]{2,10}/g) || []).slice(0, 6)])].slice(0, 12)
    inc(trackDist, track); inc(bucketDist, bucket)
    if (DRY) { bOk++; continue }
    try {
      await api("/api/kb_docs", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: LOCAL_USER, title,
          folder_path: `售前知识库/${dirLabel}`,
          content: body.slice(0, 200000), doc_format: path.extname(p).replace(".", "") || "md",
          visibility: SENSITIVE_PATH_RE.test(rel) ? "personal" : "team",
          summary: pickSummary(body) || `来自知识库笔记「${title}」（${rel}）`,
          keywords, source_file_name: rel, uploader_name: "组装层补库",
          kb_track: track, kb_bucket: bucket,
        }),
      })
      bOk++
      if (bOk % 50 === 0) console.log(`  …补库 ${bOk}`)
    } catch (e) { bFail++; if (bFail <= 5) console.log(`POSTFAIL ${rel} ${e.message}`) }
  }
  console.log(`Phase B ${DRY ? "(dry) " : ""}入库=${bOk} 空跳过=${bEmpty} 失败=${bFail}`)
  console.log("\n完成。")
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
