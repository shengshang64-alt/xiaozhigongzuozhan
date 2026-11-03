// ---------------------------------------------------------------------------
// 失单原因结构化共享模块（R012 起于投标侧，Round 28 接入商机侧）
// 存储约定：「【类别】明细」整体存入既有 lost_reason 字符串字段，零 schema 变更
// ---------------------------------------------------------------------------

export const LOST_REASON_CODES = ["价格因素", "技术方案", "资质业绩", "商务条款", "客户关系", "其他"] as const

/** 拆「【类别】明细」；无前缀的旧数据回退为未分类 + 原文进明细 */
export function splitLostReason(raw: string): { code: string; detail: string } {
  const m = (raw ?? "").trim().match(/^【([^】]+)】([\s\S]*)$/)
  if (!m) return { code: "", detail: (raw ?? "").trim() }
  return { code: m[1], detail: m[2].trim() }
}

/** 组装存储串：有类别→「【类别】明细」；无类别仅明细→原文；都空→空串 */
export function formatLostReason(code: string, detail: string): string {
  const d = (detail ?? "").trim()
  if (!code) return d
  return d ? `【${code}】${d}` : `【${code}】`
}

/** 聚合口径的类别提取（与首页复盘卡 coded 正则对齐）：命中前缀取类别，否则回退 fallback */
export function lostReasonCategory(raw: string, fallback = "未填写原因"): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return fallback
  const coded = trimmed.match(/^【([^】]+)】/)
  return coded ? coded[1] : trimmed
}
