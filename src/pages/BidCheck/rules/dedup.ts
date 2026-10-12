// ---------------------------------------------------------------------------
// dedup.ts —— L4 查重层（三期 r261-bidcheck-followons）。零 AI、零费用、零 collection schema。
//
// 复用 BidWorkspace 现成、已单测的本地跨章互查 findIntraDupPairs（shingles + Jaccard 段落级），
// 把「同一标书各章之间重复/高度相似的段落」汇入检查中枢，作为交卷前的自查提示。
// ⚠️ 只标不改：只读已生成正文推导，绝不改正文、绝不写回。
// ⚠️ 只报不拦：跨章重复属质量/查重风险，一律 severity=medium / status=warn，不标 fail、不触导出门禁。
// 配置开关 dupCrossChapterEnabled 关闭 / 正文不足两章 → 标 skipped 并诚实说明，绝不瞎判。
// dupMinRun（最小连续字数）在此映射为「参与互查的段落最小长度」，滤除短句套话的误报。
// ---------------------------------------------------------------------------

import {
  findIntraDupPairs,
  INTRA_DUP_THRESHOLD_DEFAULT,
  type BidProjectRecord,
  type DupTarget,
} from "@/pages/BidWorkspace/bidTypes"
import type { CheckHit, CheckItem, ItemStatus, Severity } from "../bidCheckTypes"
import type { CheckConfig } from "../config/checkConfig"

/** 最多列出的重复段落对（防超长清单淹没右栏，超出仅在依据里给总数） */
const MAX_HITS = 20

function clip(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ")
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

function mkItem(
  status: ItemStatus,
  severity: Severity,
  basis: string,
  hits: CheckHit[],
): CheckItem {
  return {
    code: "L4-D1",
    level: "L4",
    category: "查重",
    title: "跨章节重复段落",
    severity,
    status,
    basis,
    suggestion:
      "同一表述在多章重复出现：保留最贴切的一处，其余改写为承接引用或删减，避免评标查重疲劳与串标嫌疑。",
    hits,
    confidence: null,
  }
}

/**
 * L4 查重层主入口：返回本层检查项数组（当前一项：跨章重复段落）。
 * 仅当层级开关含 L4 时由 runCheck 调用；关闭开关或正文不足两章 → 诚实 skipped。
 */
export function runDedupChecks(rec: BidProjectRecord | null, cfg: CheckConfig): CheckItem[] {
  if (!cfg.dupCrossChapterEnabled) {
    return [mkItem("skipped", "info", "L4 查重已在配置中关闭（dupCrossChapterEnabled=false），不参与本次判定。", [])]
  }
  const chapters = (rec?.bid_chapters ?? []).filter((c) => (c.content ?? "").trim())
  if (chapters.length < 2) {
    return [mkItem("skipped", "info", "已生成正文不足两章，无跨章可互查（上传文件或未生成正文的项目同理）。", [])]
  }
  const targets: DupTarget[] = chapters.map((c, i) => ({
    nodeId: String(c.node_id ?? `c${i}`),
    chapter: (c.title ?? "").trim() || `第 ${i + 1} 章`,
    text: c.content ?? "",
  }))
  const minLen = Math.max(10, Math.floor(cfg.dupMinRun || 40))
  const pairs = findIntraDupPairs(targets, INTRA_DUP_THRESHOLD_DEFAULT, MAX_HITS * 2)
    .filter((p) => p.a_text.length >= minLen && p.b_text.length >= minLen)
  if (!pairs.length) {
    return [mkItem("pass", "medium", `已互查 ${chapters.length} 章正文，未发现长度≥${minLen}字的跨章重复段落。`, [])]
  }
  const hits: CheckHit[] = pairs.slice(0, MAX_HITS).map((p) => ({
    location: `${p.a_chapter} ↔ ${p.b_chapter}`,
    text: clip(p.a_text),
    rule: "intra_dup",
    basis: `相似度 ${Math.round(p.similarity * 100)}%｜另一段：${clip(p.b_text)}`,
  }))
  const more = pairs.length > MAX_HITS ? `（仅列前 ${MAX_HITS} 对）` : ""
  return [mkItem(
    "warn",
    "medium",
    `已互查 ${chapters.length} 章正文，检出 ${pairs.length} 对跨章重复段落${more}（段落≥${minLen}字，Jaccard≥${INTRA_DUP_THRESHOLD_DEFAULT}）。`,
    hits,
  )]
}
