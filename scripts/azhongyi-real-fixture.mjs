// ---------------------------------------------------------------------------
// R50b · 安中医真实标书回归夹具生成器（只读 PocketBase，不改任何库数据）
//
// 背景：R50 的「长文可见性」（src/pages/BidWorkspace/bidVisibility.ts）只在构造样本上测过，
// 轮报把「未用真实标书验证检索召回率」登记为未覆盖边界。本脚本把 2026-10-14 真实跑完的
// 安中医项目（bid_projects.id = mfl6howomsw5i0l，已归档）导出成两份夹具：
//
//   1) .probe/az-fixture/azhongyi.full.json                      全量真实数据（本机测量用）
//      —— .probe/ 已被 .gitignore 忽略，不会入库；含真实医院名，只能在本机用。
//   2) src/pages/BidWorkspace/__fixtures__/azhongyiRealBid.json  脱敏子集（入库，供常态回归）
//      —— 医院名/项目编号/供应商名/电话一律脱敏；投标正文保留全部 18 章但只留前若干字，
//         第 3 章（一体化核心业务系统详细功能与技术参数实质性响应）整章保留。
//
// 用法：node scripts/azhongyi-real-fixture.mjs
// ---------------------------------------------------------------------------
import { DatabaseSync } from "node:sqlite"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PROJECT_ID = "mfl6howomsw5i0l"

// 脱敏表：先长后短，避免「安徽中医药大学」把「安徽中医药大学第一附属医院」切碎
const REDACTIONS = [
  [/安徽中医药大学第一附属医院/g, "某省级三甲中医医院"],
  [/安徽中医药大学/g, "某中医药大学"],
  [/安徽省政府采购中心/g, "某省政府采购中心"],
  [/2026BFAFZ50845/g, "2026DEMO00001"],
  [/广州方信医疗技术有限公司/g, "某接口厂商甲"],
  [/厦门安盟网络股份有限公司/g, "某接口厂商乙"],
  [/北京调鼎科技有限公司/g, "某接口厂商丙"],
  [/蓝网科技/g, "某既有厂商甲"],
  [/医惠科技/g, "某既有厂商乙"],
  [/国医科技/g, "某既有厂商丙"],
  [/杏林软件/g, "某既有系统甲"],
  [/[\u4e00-\u9fa5]{2,6}(?:市|区|新区)[\u4e00-\u9fa5]{0,10}(?:路|街|大道)\s*\d{0,6}\s*号/g, "某市某路 000 号"],
  [/（[^）\n]{2,30}交口）/g, "（某路口）"],
  [/0(?:551|512)-\d{6,8}/g, "0000-00000000"],
]

const LABEL_LINE = [
  [/^\s*[\u4e00-\u9fa5]{0,4}地\s*址[\u4e00-\u9fa5]{0,8}[:：]/, "地 址：某市某路 000 号"],
  [/^\s*联\s*系\s*人[\u4e00-\u9fa5]{0,8}[:：]/, "联 系 人：某老师"],
  [/^\s*(?:[\u4e00-\u9fa5]{0,4})?电\s*话[\u4e00-\u9fa5]{0,8}[:：]/, "联系电话：0000-00000000"],
  [/^\s*邮\s*编[\u4e00-\u9fa5]{0,4}[:：]/, "邮 编：000000"],
  [/^\s*传\s*真[\u4e00-\u9fa5]{0,8}[:：]/, "传 真：0000-00000000"],
]

/** 行级脱敏：标签行只保留标签（空模板行不误伤） */
function scrubLabelLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      const rest = line.replace(/^[^:：]*[:：]/, "").replace(/[\s|｜]/g, "")
      if (!rest || rest === "邮编") return line
      for (const [re, to] of LABEL_LINE) if (re.test(line)) return to
      if (/交口）|^[^:：]{0,20}\d{1,4}\s*室\s*$|号楼/.test(line)) return ""
      return line
    })
    .join("\n")
}

function sanitize(text) {
  let out = String(text ?? "")
  for (const [re, to] of REDACTIONS) out = out.replace(re, to)
  return scrubLabelLines(out)
}

/** 章节清单 → 与 chaptersToText 同源的纯文本（「第N章 标题\n正文」，跳过空正文章） */
function chaptersToText(chapters, perChapterLimit) {
  const parts = []
  chapters.forEach((c, i) => {
    const body = String(c.content ?? "")
    if (!body.trim()) return
    const limited = perChapterLimit && body.length > perChapterLimit ? body.slice(0, perChapterLimit) : body
    parts.push("第" + (i + 1) + "章 " + sanitize(c.title ?? "") + "\n" + sanitize(limited))
  })
  return parts.join("\n\n")
}

const db = new DatabaseSync(path.join(ROOT, "pocketbase", "pb_data", "data.db"))
const row = db.prepare("select * from bid_projects where id = ?").get(PROJECT_ID)
if (!row) throw new Error("未找到 bid_projects.id = " + PROJECT_ID + "（安中医项目）")

const chapters = JSON.parse(row.bid_chapters)
const responseMap = JSON.parse(row.response_map)
const parseReport = JSON.parse(row.parse_report)

// 条款：真实 133 条偏离表条款 + R50 前它们被判的级别（用来量化「旧口径误判成偏离」的比例）
const clauses = (responseMap.rows ?? []).map((x, i) => ({
  id: String(x.clause_id || "c" + (i + 1)),
  text: sanitize(x.clause_text ?? ""),
  source: sanitize(x.source ?? ""),
  legacy_level: String(x.response_level ?? ""),
}))

const legacyLevels = clauses.reduce((acc, c) => {
  acc[c.legacy_level] = (acc[c.legacy_level] ?? 0) + 1
  return acc
}, {})

const fullBidText = chaptersToText(chapters)
const fullTenderText = sanitize(row.tender_text ?? "")

const meta = {
  project_id: PROJECT_ID,
  project_label: "安中医（已脱敏）",
  hospital: sanitize(row.hospital ?? ""),
  tender_no: sanitize(row.tender_no ?? ""),
  stage: row.stage,
  generated_at: row.updated,
  chapter_count: chapters.length,
  tender_chars: fullTenderText.length,
  bid_chars: fullBidText.length,
  clause_count: clauses.length,
  legacy_levels: legacyLevels,
  notes: "由 scripts/azhongyi-real-fixture.mjs 从本地 PocketBase 导出，只读、不改库",
}

// ---- 1) 全量夹具（本机测量用，.probe 不入库） ----
const fullDir = path.join(ROOT, ".probe", "az-fixture")
mkdirSync(fullDir, { recursive: true })
writeFileSync(
  path.join(fullDir, "azhongyi.full.json"),
  JSON.stringify({ meta: { ...meta, subset: false }, tender_text: fullTenderText, bid_text: fullBidText, clauses }, null, 0),
  "utf8",
)

// ---- 2) 脱敏子集（入库常态回归）：18 章全保留，第 3 章整章，其余截断 ----
const TECH_CHAPTER_INDEX = 2 // 第3章 一体化核心业务系统详细功能与技术参数实质性响应
const subsetChapters = chapters.map((c, i) => ({
  ...c,
  content: i === TECH_CHAPTER_INDEX ? String(c.content ?? "") : String(c.content ?? "").slice(0, 1900),
}))
const subsetBidText = chaptersToText(subsetChapters)
// 招标侧子集：招标文件头（项目/资格/须知）+ 实质性要求区 + 后段（技术参数与评标办法）
const tenderParts = [
  fullTenderText.slice(0, 5200),
  fullTenderText.slice(10500, 16200),
  fullTenderText.slice(130000, 152212),
]
const subsetTenderText = tenderParts.join("\n\n")

const subset = {
  meta: {
    ...meta,
    subset: true,
    tender_chars: subsetTenderText.length,
    bid_chars: subsetBidText.length,
    chapter_chars_limit: 1900,
    tech_chapter_kept_full: TECH_CHAPTER_INDEX + 1,
    notes:
      "脱敏子集：医院名/项目编号/供应商名/电话已替换；投标正文保留全部 18 章，第3章整章保留，其余每章截前 1900 字；招标正文只留头/实质性要求/后段技术参数三个区间",
  },
  tender_text: subsetTenderText,
  bid_text: subsetBidText,
  clauses,
}
const fixtureDir = path.join(ROOT, "src", "pages", "BidWorkspace", "__fixtures__")
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(path.join(fixtureDir, "azhongyiRealBid.json"), JSON.stringify(subset, null, 0), "utf8")

console.log("[azhongyi-fixture] 全量：tender=" + fullTenderText.length + " 字, bid=" + fullBidText.length + " 字, 条款=" + clauses.length)
console.log("[azhongyi-fixture] 子集：tender=" + subsetTenderText.length + " 字, bid=" + subsetBidText.length + " 字, 章节=" + chapters.length)
console.log("[azhongyi-fixture] 旧口径级别分布：" + JSON.stringify(legacyLevels))
console.log("[azhongyi-fixture] 章节标题：" + chapters.map((c, i) => (i + 1) + "." + c.title).join(" / "))
console.log("[azhongyi-fixture] 采购清单段字数=" + ((parseReport.sections.find((s) => s.title === "采购清单") || {}).content ?? "").length + " / 交货和服务要求段字数=" + ((parseReport.sections.find((s) => s.title === "交货和服务要求") || {}).content ?? "").length)
console.log("[azhongyi-fixture] 写出：" + path.join(fullDir, "azhongyi.full.json") + " | " + path.join(fixtureDir, "azhongyiRealBid.json"))
