// ---------------------------------------------------------------------------
// r277 切片1 · 评审报告 A1 根修：★/▲ 实质性条款引文保真（对照招标原文逐字核对，本地零 AI）
// 条款库入库有体量上限（600 字 / 4 续行，见 bidTypes extractStarClauses），长条款落库即被
// 截断——承诺函/响应表照抄截断文本，评标即判「未实质性响应」（建阳项目 ★13 三处删节）。
// 本模块双保险：
//  ① 生成侧 upgradeClausesWithTender：承诺函生成前用招标原文找回被截断条款的完整逐字文本；
//  ② 检查侧 starQuoteFidelityHits：逐条核对引用面（各章正文 + 偏离表条款列）与原文，
//     删节/改述/漏引 → warn（并入交卷体检随 format_report 呈现，只报不拦）。
// ---------------------------------------------------------------------------
import type { Chapter, } from "@/pages/SolutionStudio/solutionTypes"
import type { DeviationTable, FormatCheckHit, ParseReport } from "./bidTypes"
import { clipText, sectionText, STAR_CLAUSE_SECTION } from "./bidTypes"
import { splitStarClauses } from "./commitmentLetter"
import { isStarClauseNoiseLine } from "./starClauseNoise"

/** 建条只认行首标记（可带数字/括号编号前缀）：行中出现 ★ 的说明行（如「以“★”标示…」标题）不建条 */
const STAR_HEAD_RE = /^(?:\d{1,3}[.、)）]?\s*)?[★☆▲△]/
/** 结构边界 = 本条结束（与条款库扫描同口径；区别是无字数/行数上限——原文才是完整基准） */
const BOUNDARY_RE = /^(第[一二三四五六七八九十百]+[章节部分篇]|附[件表]|评标办法|评分标准|技术参数及要求)/

/** 从招标原文提取完整 ★/▲ 条款段：标记行 → 下一标记行/结构边界，全程不截断；
 *  目录行/含义解释句（R143 噪声口径）与非响应性的表格引行（首行含「 | 」）跳过 */
export function extractStarParagraphs(text: string): string[] {
  const lines = (text ?? "").split(/\r?\n/)
  const out: string[] = []
  let buf: string[] = []
  const flush = () => {
    const t = buf.join("\n").trim()
    if (t) out.push(t)
    buf = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue // 空行只是分隔符，不结束本条
    if (STAR_HEAD_RE.test(line)) {
      if (isStarClauseNoiseLine(line)) { flush(); continue }
      flush()
      buf = [line]
      continue
    }
    if (!buf.length) continue
    if (BOUNDARY_RE.test(line)) { flush(); continue }
    buf.push(line)
  }
  flush()
  return out.filter((p) => !(p.split("\n")[0] ?? "").includes(" | "))
}

/** 保真比对归一化：去空白、半角标点转全角、剥括号/省略号/排版符号（两端同口径，幂等） */
export function normalizeFidelity(s: string): string {
  let t = (s ?? "").replace(/\s+/g, "")
  t = t.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：").replace(/\?/g, "？").replace(/!/g, "！")
  t = t.replace(/[（）()【】「」『』“”‘’"'·…\-—_*#|]/g, "")
  return t
}

/** 生成侧增强：以招标原文为基准，把条款库里被截断的条款找回逐字全文；
 *  原文缺失/未命中一律原样返回（幂等，绝不无中生有） */
export function upgradeClausesWithTender(clauses: string[], tenderText: string): string[] {
  const paras = extractStarParagraphs(tenderText)
  if (!paras.length) return clauses
  const normParas = paras.map((p) => ({ p, n: normalizeFidelity(p) }))
  return clauses.map((c) => {
    const cn = normalizeFidelity(c)
    const head = cn.slice(0, Math.min(24, cn.length))
    if (head.length < 8) return c
    let best: { p: string; n: string } | null = null
    for (const cand of normParas) {
      if (cand.n.includes(head) && (!best || cand.n.length > best.n.length)) best = cand
    }
    return best && best.n.length > cn.length ? best.p : c
  })
}

const MIN_PARA_CHARS = 30 // 超短条款（如仅标题行）不参与保真核对，避免噪声
const VARIANT_KEY = 16

/** 引用面保真核对：每条原文条款须在某章正文或偏离表条款列逐字出现；
 *  删节 → 报缺失尾段，漏引 → 报未见逐字引用。≤24 条，level=warn 只报不拦 */
export function starQuoteFidelityHits(
  baselineText: string,
  chapters: Chapter[],
  responseMap: DeviationTable | null,
): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const paras = extractStarParagraphs(baselineText)
  if (!paras.length) return hits
  const surfaces = chapters
    .map((c) => ({ title: (c.title ?? "").slice(0, 30) || "（未命名）", text: normalizeFidelity(c.content ?? "") }))
    .filter((s) => s.text.length > 0)
  const devSurface = normalizeFidelity(
    (responseMap?.rows ?? []).map((r) => `${r.clause_text} ${r.response_summary}`).join("\n"),
  )
  // 同一条款可能在原文出现多处且措辞略异：按起始 16 字归组，任一形态被逐字引用即视为已保真
  const groups = new Map<string, string[]>()
  for (const para of paras) {
    const n = normalizeFidelity(para)
    if (n.length < MIN_PARA_CHARS) continue
    const k = n.slice(0, VARIANT_KEY)
    const arr = groups.get(k)
    if (arr) arr.push(n)
    else groups.set(k, [n])
  }
  for (const [, variants] of groups) {
    if (hits.length >= 24) break
    variants.sort((a, b) => b.length - a.length)
    const longest = variants[0]
    const covered = (hay: string) => variants.some((v) => hay.includes(v))
    if (covered(devSurface) || surfaces.some((s) => covered(s.text))) continue
    // 未完整命中：找最长匹配前缀，区分「引了但被删节」与「压根没引」
    const probe = (hay: string) => {
      for (const v of variants) {
        const pos = hay.indexOf(v.slice(0, Math.min(24, v.length)))
        if (pos < 0) continue
        let l = 0
        while (pos + l < hay.length && l < v.length && hay[pos + l] === v[l]) l++
        return { l, v }
      }
      return null
    }
    let best: { l: number; v: string } | null = null
    for (const hay of [devSurface, ...surfaces.map((s) => s.text)]) {
      const r = probe(hay)
      if (r && (!best || r.l > best.l)) best = r
    }
    const brief = (paras.find((p) => normalizeFidelity(p).startsWith(longest.slice(0, VARIANT_KEY))) ?? longest)
      .split("\n")[0]
      .trim()
      .slice(0, 26)
    const quote = best && best.l > 0
      ? `「${brief}」引用被删节：与原文匹配 ${Math.round((best.l / best.v.length) * 100)}% 后缺失「${best.v.slice(best.l, best.l + 40)}…」，须逐字引用不得删改`
      : `「${brief}」未在正文/偏离表中找到逐字引用，实质性条款须逐字响应`
    hits.push({ chapter: "（全文）", rule: "star_quote_fidelity", quote: quote.slice(0, 130), level: "warn" })
  }
  return hits
}

// ---------------------------------------------------------------------------
// r277 切片3 · 逐项深度响应引擎（评审报告 C1/B 级根修）：
// 老注入段 starClausesPromptBlock 只透传条款库截断文本 + 一句「逐条原文响应」，
// LLM 面对 118 项条款以一句「完全满足」概括即可过关（C1 笼统响应），且截断条款照抄即删节（A1）。
// 新函数三升级：①招标原文找回逐字全文（upgradeClausesWithTender 复用）；②三要素硬约束
// （逐字复述→符合结论+偏离值→实现依据，响应篇幅与原文挂钩）；③证据挂载铁律（截图/证书/
// 案例以【待填写】占位等人工挂载，禁止复读评分标准充当响应）。bidChapter.ts 快照锁字不改，
// 强化全在注入段文本内（消费侧 `opts.starBlock ?? ""` 原样进稳定块，纯文本行即可）。
// ---------------------------------------------------------------------------

/** 单条注入上限：找回全文后仍需防极端超长条款挤爆上下文 */
const CLAUSE_PROMPT_ITEM_MAX = 900
const CLAUSE_PROMPT_TOTAL_MAX = 9000

/** 正文生成（gen_options.clause_response 开启）专用 ★/▲ 深度响应注入段；
 *  条款节缺失返回空串（调用方不注入）。老 starClausesPromptBlock（体检/废标检查用）保持不动 */
export function clauseResponsePromptBlock(report: ParseReport | null, tenderText: string): string {
  const sec = sectionText(report, STAR_CLAUSE_SECTION.key)
  if (!sec.trim()) return ""
  const raw = splitStarClauses(sec)
  const clauses = upgradeClausesWithTender(raw, (tenderText ?? "").trim() || sec)
  const list = clauses
    .map((c, i) => `${i + 1}. ${clipText((c ?? "").trim(), CLAUSE_PROMPT_ITEM_MAX)}`)
    .filter((s) => s.length > 3)
    .join("\n")
  return [
    "【★/▲ 实质性条款逐项深度响应（以下条款文本已对照招标原文找回逐字全文，引用与响应一律以此为准，禁止另行删改或改述）】",
    "本章涉及的每一条条款，响应必须完整包含三要素，缺一即为不合格响应：",
    "① 逐字复述该条参数/要求原文（带 ★/▲ 标记）；",
    "② 明确结论：完全满足／正偏离优于，涉及数值指标时写明偏离值（如「要求≥99.9%，我方承诺99.99%」）；",
    "③ 实现依据：写出具体的技术/服务措施、可核实的产品能力或佐证名称，禁止只写「完全满足」「没有问题」等笼统结论；",
    "响应篇幅须与条款原文相称：长条款逐句对应展开，不得以一句概括整条；确需引用的关键信息拿不准时输出【待填写】占位，严禁编造。",
    "证据挂载类条款（要求提供截图/证书/案例/报告等客观证据的评分项）：按「响应要求 → 佐证材料：【待填写：证据确切名称，由人工挂载】」组织，",
    "不得以复述评分标准或承诺语代替证据本身。",
    "条款清单：",
    clipText(list, CLAUSE_PROMPT_TOTAL_MAX),
  ].join("\n")
}
