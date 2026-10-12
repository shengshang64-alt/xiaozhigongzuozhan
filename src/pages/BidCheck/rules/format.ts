// ---------------------------------------------------------------------------
// format.ts —— L1 格式层。零 AI。正文类规则复用 BidWorkspace 现成的 formatCheckReport，
// 结构类（字体/字号/行距/边距/页码/编号/页数）从 DocContext.meta 判定；标准依赖配置，未配置标 unconfigured。
//
// ⚠️ 只读检测，不改正文、不改格式（改格式是 FormatTool/refreshDocx 的职责，二者逻辑分离）。
// ---------------------------------------------------------------------------

import {
  formatCheckReport,
  FORMAT_RULE_LABEL,
  type FormatCheckHit,
  type FormatCheckKey,
  type FormatSettings,
} from "@/pages/BidWorkspace/bidTypes"
import { DOCX_SIZE_HALFPT } from "@/pages/BidWorkspace/bidFormatConstants"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { CheckHit, CheckItem, DocContext, Severity } from "../bidCheckTypes"
import type { CheckConfig } from "../config/checkConfig"
import type { AnbidCheckConfig } from "../config/anbidCheckConfig"

const MAX_HITS = 6

function clip(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ")
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

/** 正文禁则 key / 交叉核对 rule → 严重度（identity_leak 交由 L5，不在此列）；导出供规则清单页复用（单一真源） */
export const KEY_SEVERITY: Record<string, Severity> = {
  no_color_content: "high",
  no_color_image: "medium",
  no_table_shading: "medium",
  no_color_border: "medium",
  no_hyperlink: "medium",
  no_watermark: "medium",
  no_bold: "medium",
  no_underline: "medium",
  no_empty_line_consecutive: "info",
  no_half_width_punct: "info",
  no_blank_page: "medium",
  wording_scan: "medium",
  decoration_leftover: "medium",
  // 交叉核对类（formatCheckReport 在 enabled keys 之外自动产出）
  number_conflict: "high",
  param_escalation: "medium",
  metric_conflict: "medium",
  meta_leftover: "medium",
  deviation_undercommit: "high",
  over_price_ceiling: "critical",
  amount_case_mismatch: "critical",
  sealed_pages_cross: "medium",
}

/** 交叉核对 rule 的类别标注（区别于勾选禁则） */
const CROSS_CATEGORY: Record<string, string> = {
  number_conflict: "口径核对",
  param_escalation: "口径核对",
  metric_conflict: "口径核对",
  meta_leftover: "口径核对",
  deviation_undercommit: "响应核对",
  over_price_ceiling: "废标核对",
  amount_case_mismatch: "废标核对",
  sealed_pages_cross: "暗标核对",
}

function textItem(code: string, key: string, hits: FormatCheckHit[], severity: Severity, category: string): CheckItem {
  const title = FORMAT_RULE_LABEL[key as keyof typeof FORMAT_RULE_LABEL] || key
  return {
    code,
    level: "L1",
    category,
    title,
    severity,
    status: hits.length ? (severity === "info" || severity === "medium" ? "warn" : "fail") : "pass",
    basis: `L1 本地禁则「${title}」（复用交卷体检同一规则表，零 AI）`,
    suggestion: "命中处回编制环节人工修改正文；本工具不改内容",
    hits: hits.slice(0, MAX_HITS).map((h) => ({ location: h.chapter || "（正文）", text: clip(h.quote), rule: h.rule, basis: h.level === "info" ? "提示级" : "" })),
    confidence: null,
  }
}

function structItem(code: string, title: string, severity: Severity, status: CheckItem["status"], basis: string, suggestion: string, hits: CheckHit[]): CheckItem {
  return { code, level: "L1", category: "版式结构", title, severity, status, basis, suggestion, hits, confidence: null }
}

/**
 * L1 主入口。
 * @param mode sealed=暗标严格（未达配置要求升级 critical）
 */
export function runFormatChecks(ctx: DocContext, cfg: CheckConfig, anbid: AnbidCheckConfig, mode: "normal" | "sealed"): CheckItem[] {
  const items: CheckItem[] = []
  const sealed = mode === "sealed"

  // ---- 正文类：复用 formatCheckReport（去掉 identity_leak，交由 L5 处理避免重复）----
  const keys = (cfg.formatKeys.filter((k) => k !== "identity_leak") as FormatCheckKey[])
  if (keys.length && ctx.chapters.length) {
    const chapters = ctx.chapters.map((c) => ({ node_id: c.title, title: c.title, content: c.content })) as unknown as Chapter[]
    const formatSettings = { sealed } as unknown as FormatSettings
    const report = formatCheckReport(chapters, keys, formatSettings, "")
    const byRule = new Map<string, FormatCheckHit[]>()
    for (const h of report.hits) {
      const arr = byRule.get(h.rule) ?? []
      arr.push(h)
      byRule.set(h.rule, arr)
    }
    // 汇总勾选禁则 + formatCheckReport 自动产出的交叉核对规则（数字口径/超限价/金额大小写等）
    const allRules: string[] = [...keys]
    for (const r of byRule.keys()) if (!allRules.includes(r)) allRules.push(r)
    allRules.forEach((k, i) => {
      const hits = byRule.get(k) ?? []
      let sev = KEY_SEVERITY[k] ?? "medium"
      // 暗标严格模式：废标类交叉核对命中升 critical（与 §四 门禁口径一致）
      if (sealed && (k === "over_price_ceiling" || k === "amount_case_mismatch" || k === "number_conflict")) sev = "critical"
      const category = CROSS_CATEGORY[k] ?? "正文格式"
      items.push(textItem(`L1-T${i + 1}`, k, hits, sev, category))
    })
  }

  // ---- 结构类：字体 / 字号 / 行距（需 docx 包）----
  if (ctx.meta.available) {
    const fonts = ctx.meta.fontsUsed
    items.push(
      fonts.length > 1
        ? structItem("L1-1", "正文字体不一致", sealed ? "high" : "medium", "warn", "L1-1 同一层级出现 ≥2 种中文字体", "统一字体（由人工/格式刷新处理）", [{ location: "document.xml", text: `出现字体：${fonts.join("、")}`, rule: "font_variety", basis: "" }])
        : structItem("L1-1", "正文字体一致性", "medium", "pass", "L1-1 中文字体种类", "—", []),
    )
    const sizes = ctx.meta.sizesUsed
    items.push(
      sizes.length > 1
        ? structItem("L1-2", "正文字号不一致", sealed ? "high" : "medium", "warn", "L1-2 同层级正文字号不统一（半磅值种类）", "统一字号", [{ location: "document.xml", text: `字号值（半点）：${sizes.join("、")}`, rule: "size_variety", basis: "" }])
        : structItem("L1-2", "正文字号一致性", "medium", "pass", "L1-2 字号种类", "—", []),
    )
    const lines = ctx.meta.lineSpacings
    items.push(
      lines.length > 1
        ? structItem("L1-3", "行距/段间距不统一", "medium", "warn", "L1-3 全文行距种类 > 1", "统一行距", [{ location: "document.xml", text: `行距值种类：${lines.length} 种`, rule: "line_variety", basis: "" }])
        : structItem("L1-3", "行距一致性", "info", "pass", "L1-3 行距种类", "—", []),
    )
    // L1-4 编号断裂：标题层级缺父级（保守：仅在标题点号编号上判定）
    items.push(numberingItem(ctx))
    // L1-6 页码
    items.push(structItem("L1-6", "页码检测", "info", ctx.meta.hasPageNumber ? "pass" : "warn", "L1-6 是否检测到页码域/页码设置", "如招标要求页码请补充；暗标口径以 L5-C6 为准", ctx.meta.hasPageNumber ? [] : [{ location: "document/footer", text: "未检测到页码域", rule: "no_pagenum", basis: "" }]))
    // L1-9 空白页 / L1-12 页数超限（依赖配置 maxPages）
    if (anbid.formatStandard.maxPages != null) {
      const over = ctx.meta.pageEstimate > anbid.formatStandard.maxPages
      items.push(structItem("L1-12", "页数超限", sealed ? "critical" : "high", over ? "fail" : "pass", `L1-12 页数上限=${anbid.formatStandard.maxPages}，字数粗估=${ctx.meta.pageEstimate}`, "压缩至上限内", over ? [{ location: "全文", text: `估算 ${ctx.meta.pageEstimate} 页 > 上限 ${anbid.formatStandard.maxPages} 页`, rule: "max_pages", basis: "" }] : []))
    } else {
      items.push(structItem("L1-12", "页数超限", "high", "unconfigured", "L1-12 页数上限（招标文件条款）", "请在暗标/检查配置填入页数上限", []))
    }
    // L1-10 页边距（依赖配置 margins）
    if (anbid.formatStandard.margins && ctx.meta.margins) {
      const want = anbid.formatStandard.margins
      const got = ctx.meta.margins
      const off = (["top", "right", "bottom", "left"] as const).filter((k) => Math.abs(want[k] - got[k]) > 0.11)
      items.push(structItem("L1-10", "页边距不符", sealed ? "critical" : "high", off.length ? "fail" : "pass", `L1-10 要求 上${want.top}/右${want.right}/下${want.bottom}/左${want.left}cm，实际 上${got.top}/右${got.right}/下${got.bottom}/左${got.left}cm`, "调整为要求边距", off.length ? [{ location: "document.xml → pgMar", text: `偏差边：${off.join("、")}`, rule: "margin", basis: "" }] : []))
    } else {
      items.push(structItem("L1-10", "页边距合规", "high", "unconfigured", "L1-10 页面四边距要求（招标文件条款）", "请在配置填入要求边距（且上传 docx）", []))
    }
    // L1-11 字体/字号达标（依赖配置 bodyFont）
    if (anbid.formatStandard.bodyFont) {
      const wantFont = anbid.formatStandard.bodyFont
      const off = ctx.meta.fontsUsed.filter((f) => !f.includes(wantFont) && !wantFont.includes(f))
      items.push(structItem("L1-11", "字体/字号不符要求", sealed ? "critical" : "high", off.length ? "fail" : "pass", `L1-11 要求字体「${wantFont}」`, "统一为要求字体", off.length ? [{ location: "document.xml", text: `非要求字体：${off.join("、")}`, rule: "font_std", basis: "" }] : []))
    } else {
      items.push(structItem("L1-11", "字体/字号达标", "high", "unconfigured", "L1-11 招标规定字体字号（招标文件条款）", "请在配置填入要求字体", []))
    }
    // L1-13 字号达标 / L1-14 行距达标（R269 接入预留配置项 bodySize/lineSpacing，与 L1-11 bodyFont 同构；标题字号/各级行距天然可异，故只 warn 不拦）
    items.push(sizeStandardItem(ctx, anbid, sealed))
    items.push(lineStandardItem(ctx, anbid, sealed))
  } else {
    const why = "结构类格式检查需上传 .docx 文件（当前输入无版式信息）"
    for (const [code, title] of [
      ["L1-1", "正文字体一致性"],
      ["L1-2", "正文字号一致性"],
      ["L1-3", "行距一致性"],
      ["L1-10", "页边距合规"],
      ["L1-11", "字体/字号达标"],
      ["L1-13", "字号达标"],
      ["L1-14", "行距达标"],
    ] as [string, string][]) {
      items.push(structItem(code, title, "medium", "skipped", why, "上传 .docx 文件后自动检查", []))
    }
  }

  return items
}

/** L1-4 编号断裂：子级点号编号缺直接父级（保守，只在带点号标题上判定） */
function numberingItem(ctx: DocContext): CheckItem {
  const nums: { level: number; path: string; title: string }[] = []
  for (const ch of ctx.chapters) {
    const m = /^(\d+(?:\.\d+)+)/.exec((ch.title || "").trim())
    if (!m) continue
    const path = m[1]
    nums.push({ level: path.split(".").length, path, title: ch.title })
  }
  const present = new Set(nums.map((n) => n.path))
  const breaks = nums.filter((n) => {
    if (n.level <= 1) return false
    const parent = n.path.split(".").slice(0, -1).join(".")
    return parent && !present.has(parent)
  })
  return structItem("L1-4", "标题层级编号断裂", "high", breaks.length ? "warn" : (nums.length ? "pass" : "skipped"), "L1-4 点号编号缺直接父级（如出现 1.1.1 而无 1.1）", "补齐父级编号或修正层级", breaks.slice(0, MAX_HITS).map((b) => ({ location: b.title, text: `编号 ${b.path} 缺父级`, rule: "numbering_break", basis: "" })))
}


/** 解析所填字号要求 → docx 半点值；识别不了返回 null（不瞎判）。支持 小四 / 四号 / 12 / 12pt */
export function resolveSizeHalfPt(raw: string): number | null {
  const s = (raw || "").trim()
  if (!s) return null
  const named = DOCX_SIZE_HALFPT[s]
  if (named != null) return named
  const m = /^(\d+(?:\.\d+)?)\s*(?:pt|磅)?$/i.exec(s)
  if (m) {
    const pt = Number(m[1])
    if (Number.isFinite(pt) && pt > 0 && pt <= 100) return Math.round(pt * 2)
  }
  return null
}

/** 解析所填行距要求 → {type,line}；识别不了返回 null（不瞎判）。支持 单倍 / 1.5倍 / 2倍 / 固定28磅 */
export function resolveLineSpacingReq(raw: string): { type: "auto" | "exact"; line: number } | null {
  const s = (raw || "").trim()
  if (!s) return null
  if (/单倍|一行|\bsingle\b/i.test(s)) return { type: "auto", line: 240 }
  const mult = /^(\d+(?:\.\d+)?)\s*(?:倍|x|×)/i.exec(s)
  if (mult) {
    const n = Number(mult[1])
    if (Number.isFinite(n) && n > 0 && n <= 10) return { type: "auto", line: Math.round(n * 240) }
  }
  const fix = /固定\D*(\d+(?:\.\d+)?)\s*(?:磅|pt)/i.exec(s)
  if (fix) {
    const pt = Number(fix[1])
    if (Number.isFinite(pt) && pt > 0 && pt <= 200) return { type: "exact", line: Math.round(pt * 20) }
  }
  return null
}

/** L1-13 字号达标（依赖配置 bodySize；标题字号大于正文属正常，故命中只 warn 不 fail） */
function sizeStandardItem(ctx: DocContext, anbid: AnbidCheckConfig, sealed: boolean): CheckItem {
  const want = anbid.formatStandard.bodySize
  if (!want) return structItem("L1-13", "字号达标", "medium", "unconfigured", "L1-13 招标规定正文字号（如 小四 / 12pt）", "请在检查配置「要求字号」填入招标规定字号", [])
  const expect = resolveSizeHalfPt(want)
  if (expect == null) return structItem("L1-13", "字号达标", "medium", "unconfigured", `L1-13 无法识别所填字号要求「${want}」`, "请用小四 / 四号 / 12pt 等规范写法", [])
  const got = ctx.meta.sizesUsed
  if (!got.length) return structItem("L1-13", "字号达标", "medium", "skipped", "L1-13 文档未检测到显式字号设置", "—", [])
  const off = got.filter((v) => Number(v) !== expect)
  const desc = `${expect / 2}pt（半点 ${expect}）`
  return off.length
    ? structItem("L1-13", "字号存疑", sealed ? "high" : "medium", "warn", `L1-13 要求正文字号「${want}」=${desc}，检测到非该值字号（标题字号大于正文属正常，请人工确认正文是否统一）`, "确认正文统一为要求字号", [{ location: "document.xml", text: `非要求字号（半点）：${off.join("、")}`, rule: "size_std", basis: `要求 ${desc}` }])
    : structItem("L1-13", "字号达标", "medium", "pass", `L1-13 字号统一为「${want}」（${desc}）`, "—", [])
}

/** L1-14 行距达标（依赖配置 lineSpacing + meta.lineSpacingsDetail；各级行距可不同，故未匹配只 warn 不 fail） */
function lineStandardItem(ctx: DocContext, anbid: AnbidCheckConfig, sealed: boolean): CheckItem {
  const req = anbid.formatStandard.lineSpacing
  if (!req) return structItem("L1-14", "行距达标", "medium", "unconfigured", "L1-14 招标规定行距（如 1.5倍 / 固定28磅）", "请在检查配置「要求行距」填入招标规定行距", [])
  const resolved = resolveLineSpacingReq(req)
  if (!resolved) return structItem("L1-14", "行距达标", "medium", "unconfigured", `L1-14 无法识别所填行距要求「${req}」`, "请用 1.5倍 / 单倍 / 固定28磅 等规范写法", [])
  const detail = ctx.meta.lineSpacingsDetail
  if (!detail.length) return structItem("L1-14", "行距达标", "medium", "skipped", "L1-14 文档未检测到行距设置", "—", [])
  const ok = (d: { line: string; rule: string }): boolean => {
    const dl = Number(d.line)
    return resolved.type === "auto"
      ? d.rule === "auto" && Math.abs(dl - resolved.line) <= 12
      : (d.rule === "exact" || d.rule === "atLeast") && Math.abs(dl - resolved.line) <= 12
  }
  const desc = resolved.type === "auto" ? `${Math.round((resolved.line / 240) * 100) / 100}倍` : `固定${resolved.line / 20}磅`
  if (detail.some(ok)) return structItem("L1-14", "行距达标", "medium", "pass", `L1-14 文档存在所要求行距「${desc}」`, "—", [])
  const off = detail.filter((d) => !ok(d))
  return structItem(
    "L1-14",
    "行距存疑",
    sealed ? "high" : "medium",
    "warn",
    `L1-14 要求行距「${desc}」（配置「${req}」），未检测到匹配（各级行距可不同，请人工确认正文行距）`,
    "确认正文行距统一为要求值",
    off.slice(0, MAX_HITS).map((d) => ({ location: "document.xml", text: `w:line=${d.line} w:lineRule=${d.rule}`, rule: "line_std", basis: `要求 ${desc}` })),
  )
}
