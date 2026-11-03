// ---------------------------------------------------------------------------
// 2026-10-23（P0 整改·根因优先）：招标原文有效性与 ★/▲ 条款对账
//
// 起因（真实走查，项目 4c11hvz43c0u2am「三明市中西医结合医院」）：
// 该项目 tender_text 只有 52,631 字（原文件 66,699 字），开头就是
//   「项目编号：[350000]SMZC[GK]2026-XXX号」「采购代理机构：（按实际委托填写）」
//   「预算金额（最高限价）：人民币XXXX万元」
// ——这是一份**带占位符的模板稿**，不是招标原文。系统仍然照常解析、生成、检查，
// 于是「评分 10 分被算成 30 分」「★ 一条都没识别」等一连串问题全都被当成解析缺陷，
// 实际根因是**输入源本身失真**，而且产品没有任何一处提示这一点。
//
// 本模块做两件纯本地判定（零 AI，可脱离浏览器单测）：
//   ① scanTenderText：占位符 / 模板痕迹检测 → 告诉用户「这不是有效原文」；
//   ② reconcileStarClauses：原文声明的 ★/▲ 条数 vs 实际解析条数对账 → 不符即红。
// 两者都只产出结论，不阻断；阻断交给调用方（stepEntryMissing / 交卷清单）。
// ---------------------------------------------------------------------------

import { STAR_CLAUSE_SECTION, type ParseReport } from "./bidTypes"

/** 占位符/模板痕迹（命中即说明这份文本不是可直接使用的招标原文） */
const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /[XxＸ]{3,}/, label: "连续占位符 XXX" },
  { re: /[×xX]{3,}\s*号/, label: "编号占位「XXX号」" },
  { re: /[（(]\s*按实际[^）)]{0,12}填写\s*[)）]/, label: "「（按实际…填写）」" },
  { re: /[（(]\s*请[^）)]{0,10}填写\s*[)）]/, label: "「（请…填写）」" },
  { re: /【\s*待填写\s*】|【\s*待补充\s*】/, label: "「【待填写】」占位" },
  { re: /(人民币|金额|预算)[^。\n]{0,8}[XxＸ]{2,}/, label: "金额占位" },
  { re: /示\s*范\s*文\s*本/, label: "「示范文本」模板字样" },
  { re: /本(文件|招标文件)为(示例|模板|样例)/, label: "自称示例/模板" },
]

export type TenderTextQuality = {
  /** 文本非空白字符数 */
  chars: number
  /** 命中的占位符类别（去重） */
  hits: string[]
  /** 是否判定为"不是可直接使用的招标原文" */
  suspicious: boolean
  /** 给人看的一句话结论 */
  summary: string
}

export function scanTenderText(text: string | null | undefined): TenderTextQuality {
  const raw = String(text ?? "")
  const chars = raw.replace(/\s+/g, "").length
  if (!chars) {
    return { chars: 0, hits: [], suspicious: true, summary: "还没有招标文件文本" }
  }
  const hits: string[] = []
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    if (re.test(raw) && !hits.includes(label)) hits.push(label)
  }
  // 「示范文本」在真实政府采购文件里也会出现在页眉（如「政府采购项目公开招标文件示范文本（服务类）」），
  // 单独命中不算失真；只有同时命中**编号/金额类占位**才判可疑。
  const hardHits = hits.filter((h) => h !== "「示范文本」模板字样")
  const suspicious = hardHits.length > 0
  const summary = suspicious
    ? `招标文本含 ${hardHits.length} 类占位符（${hardHits.join("、")}）——这通常是模板稿而非真实招标文件，解析结果不可信`
    : `招标文本未发现占位符（${chars} 字）`
  return { chars, hits, suspicious, summary }
}

// ---------------------------------------------------------------------------
// ★/▲ 条款数量对账
// ---------------------------------------------------------------------------

export type StarReconciliation = {
  /** 原文声明的 ★ 项数（解析不到为 null） */
  declaredStar: number | null
  /** 原文声明的 ▲ 项数（解析不到为 null） */
  declaredTriangle: number | null
  /** 实际解析出的 ★ 条款数 */
  parsedStar: number
  /** 实际解析出的 ▲ 条款数 */
  parsedTriangle: number
  /** 是否有缺口（声明 > 解析，或声明存在但解析为 0） */
  missing: boolean
  /** 弱信号：原文没声明条数、但一条 ★ 都没解析出来而 ▲ 有 —— 值得人工看一眼，不定级为阻断 */
  warn: boolean
  summary: string
}

/** 从原文里读「★…共 N 项」「▲…N 项」这类声明；读不到返回 null（不臆断） */
export function declaredSymbolCount(text: string, symbol: "★" | "▲"): number | null {
  const raw = String(text ?? "")
  // 只在含该符号的短句里找「共 N 项 / N 项 / N 条」，避免整篇乱抓数字
  const re = new RegExp(`[^。\\n]{0,40}${symbol}[^。\\n]{0,40}`, "g")
  const hits = raw.match(re) ?? []
  for (const h of hits) {
    const m = h.match(/(?:共|计|合计)?\s*([1-9]\d?)\s*(?:项|条|个)/)
    if (m) return Number(m[1])
  }
  return null
}

/** 解析出的 ★/▲ 条款条数（按条款头计，不按物理行计） */
export function parsedSymbolCount(report: ParseReport | null, symbol: "★" | "▲"): number {
  const content = (report?.sections ?? []).find((s) => s.key === STAR_CLAUSE_SECTION.key)?.content ?? ""
  if (!content.trim()) return 0
  // 以「★」「▲」开头的条款头计一条；同一符号在条款内部重复出现在正文里不重复计
  const heads = content.split(/\r?\n/).filter((l) => new RegExp(`^\\s*(?:\\d+(?:\\.\\d+)*[.、)）]\\s*)?${symbol}`).test(l))
  return heads.length
}

export function reconcileStarClauses(report: ParseReport | null, tenderText: string | null | undefined): StarReconciliation {
  const text = String(tenderText ?? "")
  const declaredStar = declaredSymbolCount(text, "★")
  const declaredTriangle = declaredSymbolCount(text, "▲")
  const parsedStar = parsedSymbolCount(report, "★")
  const parsedTriangle = parsedSymbolCount(report, "▲")
  const gaps: string[] = []
  if (declaredStar != null && parsedStar < declaredStar) gaps.push(`★ 声明 ${declaredStar} 项、实际解析 ${parsedStar} 条`)
  if (declaredTriangle != null && parsedTriangle < declaredTriangle) gaps.push(`▲ 声明 ${declaredTriangle} 项、实际解析 ${parsedTriangle} 条`)
  const missing = gaps.length > 0
  const warn = !missing && declaredStar == null && parsedStar === 0 && parsedTriangle > 0
  const summary = missing
    ? `${gaps.join("；")}——★ 漏一条即可能废标，请对照原文补全后再生成`
    : warn
      ? `未识别到任何 ★ 条款（已识别 ▲ ${parsedTriangle} 条）——若原文带 ★ 标记，请对照原文人工核对`
      : declaredStar == null && declaredTriangle == null
        ? `原文未声明 ★/▲ 条数，无法对账（当前解析 ★ ${parsedStar} 条、▲ ${parsedTriangle} 条）`
        : `★/▲ 数量对账通过（★ ${parsedStar} 条、▲ ${parsedTriangle} 条）`
  return { declaredStar, declaredTriangle, parsedStar, parsedTriangle, missing, warn, summary }
}
