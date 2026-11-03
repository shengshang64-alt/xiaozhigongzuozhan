// ---------------------------------------------------------------------------
// content.ts —— L3 内容层（四期 r261-bidcheck-followons）。零 AI、零费用、零 collection schema。
//
// 只做两件事，全部读现成的确定性信号（语义类 AI 判定仍挂账后续）：
//  · L3-C1 章节正文单薄/空缺 —— 阈值取预留配置项 thinChapterMinChars，逐章去空白计字，
//    低于阈值（含 0 字空缺）即提示补写；商务骨架章（part=biz）不生成 AI 正文，不参与判定。
//  · L3-C2 成稿偏短章节 —— 复用标书工作台生成时写入并随 chapters json 持久化的
//    Chapter.underlength 标记（成稿字数低于预算 60%），把它汇入检查中枢，交卷前看得见哪几章写短了。
//
// ⚠️ 只标不改：只读已生成正文推导，绝不改正文、绝不写回。
// ⚠️ 只报不拦：正文单薄/偏短属完整性风险，一律 severity=medium / status=warn，
//    不标 fail、不触发暗标导出门禁 —— 与「疑似编造未清零禁止导出」维持「只报告不拦截」同口径。
// 未选择项目 / 尚无章节 / 仅商务骨架章 / 阈值=0 → 标 skipped 并诚实说明，绝不瞎判。
// ---------------------------------------------------------------------------

import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { CheckHit, CheckItem, ItemStatus, Severity } from "../bidCheckTypes"
import type { CheckConfig } from "../config/checkConfig"

/** 单项最多列出的章节数（防超长清单淹没右栏，超出仅在依据里给总数） */
const MAX_HITS = 30

function clip(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ")
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

/** 技术章（part!==biz 才生成 AI 正文；商务骨架章无正文属正常，不参与单薄/偏短判定） */
function techChapters(chs: Chapter[]): Chapter[] {
  return chs.filter((c) => (c.part ?? "tech") !== "biz")
}

function mkItem(
  code: string,
  title: string,
  status: ItemStatus,
  severity: Severity,
  basis: string,
  suggestion: string,
  hits: CheckHit[],
): CheckItem {
  return {
    code,
    level: "L3",
    category: "正文完整性",
    title,
    severity,
    status,
    basis,
    suggestion,
    hits,
    confidence: null,
  }
}

/** L3-C1 章节正文单薄 / 空缺（阈值取预留配置项 thinChapterMinChars） */
function checkThin(rec: BidProjectRecord | null, cfg: CheckConfig): CheckItem {
  const code = "L3-C1"
  const title = "章节正文单薄 / 空缺"
  const suggestion =
    "为过短或空缺的技术章补足实质内容：正文低于配置阈值（thinChapterMinChars）时，交付前易被判「响应不充分」，请对照招标要求扩写。"
  const all = rec?.bid_chapters ?? []
  if (!all.length) {
    return mkItem(code, title, "skipped", "info", "项目尚未生成任何章节正文，无法判定单薄与否（上传文件形态同理）。", suggestion, [])
  }
  const minChars = Math.max(0, Math.floor(cfg.thinChapterMinChars ?? 0))
  if (minChars <= 0) {
    return mkItem(code, title, "skipped", "info", "章节单薄阈值 thinChapterMinChars=0，L3-C1 未启用字数下限判定。", suggestion, [])
  }
  const tech = techChapters(all)
  if (!tech.length) {
    return mkItem(code, title, "skipped", "info", "所选项目仅含商务骨架章（无 AI 生成正文），L3 单薄判定不适用。", suggestion, [])
  }
  const thin = tech
    .map((c) => ({ c, len: (c.content ?? "").replace(/\s+/g, "").length }))
    .filter((x) => x.len < minChars)
    .sort((a, b) => a.len - b.len)
  if (!thin.length) {
    return mkItem(code, title, "pass", "medium", `已核对 ${tech.length} 个技术章，正文均不少于 ${minChars} 字。`, suggestion, [])
  }
  const hits: CheckHit[] = thin.slice(0, MAX_HITS).map((x) => ({
    location: (x.c.title ?? "").trim() || "（无题）",
    text: x.len === 0 ? "（正文空缺）" : clip(x.c.content ?? ""),
    rule: "thin_chapter",
    basis: x.len === 0 ? "正文空缺（0 字）" : `正文 ${x.len} 字，低于阈值 ${minChars} 字`,
  }))
  const more = thin.length > MAX_HITS ? `（仅列前 ${MAX_HITS} 章）` : ""
  return mkItem(
    code,
    title,
    "warn",
    "medium",
    `已核对 ${tech.length} 个技术章，${thin.length} 章正文单薄/空缺${more}（阈值 ${minChars} 字）。`,
    suggestion,
    hits,
  )
}

/** L3-C2 成稿偏短章节（复用工作台持久化的 Chapter.underlength 标记） */
function checkUnderlength(rec: BidProjectRecord | null): CheckItem {
  const code = "L3-C2"
  const title = "成稿偏短章节"
  const suggestion =
    "偏短章通常经续写/扩写达标后由工作台自动清除标记：逐章对照字数预算补足内容后再导出，避免篇幅单薄影响评审观感。"
  const all = rec?.bid_chapters ?? []
  if (!all.length) {
    return mkItem(code, title, "skipped", "info", "项目尚未生成任何章节正文，无从判定成稿偏短。", suggestion, [])
  }
  const tech = techChapters(all)
  if (!tech.length) {
    return mkItem(code, title, "skipped", "info", "所选项目仅含商务骨架章（无 AI 生成正文），无从判定成稿偏短。", suggestion, [])
  }
  const under = tech.filter((c) => c.underlength === true)
  if (!under.length) {
    return mkItem(code, title, "pass", "medium", `已扫描 ${tech.length} 个技术章，无成稿偏短（underlength）标记。`, suggestion, [])
  }
  const hits: CheckHit[] = under.slice(0, MAX_HITS).map((c) => ({
    location: (c.title ?? "").trim() || "（无题）",
    text: clip(c.content ?? ""),
    rule: "underlength",
    basis: "生成时标记：成稿字数低于预算 60%",
  }))
  const more = under.length > MAX_HITS ? `（仅列前 ${MAX_HITS} 章）` : ""
  return mkItem(
    code,
    title,
    "warn",
    "medium",
    `${under.length} 章被标记成稿偏短${more}，交付前建议扩写复核。`,
    suggestion,
    hits,
  )
}

/**
 * L3 内容层主入口：返回本层检查项数组（正文单薄/空缺 + 成稿偏短）。
 * 仅当层级开关含 L3 时由 runCheck 调用；上传文件（rec=null）会得到两条诚实的 skipped。
 */
export function runContentChecks(rec: BidProjectRecord | null, cfg: CheckConfig): CheckItem[] {
  return [checkThin(rec, cfg), checkUnderlength(rec)]
}
