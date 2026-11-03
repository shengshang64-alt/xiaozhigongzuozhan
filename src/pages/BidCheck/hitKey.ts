import type { CheckHit } from "@/pages/BidCheck/bidCheckTypes"

/**
 * R216 缺陷修复：命中项在列表中的唯一 key。
 *
 * 背景：同一规则（code）可在同一段落（paragraphIndex）多次命中——formatCheckReport
 * 对每类规则逐条扫描，一条规则命中同段多个疑点即产生多条同 (code, paragraphIndex) 的 hit。
 * 旧实现直接拼 `code#paragraphIndex`，React 必报 "Encountered two children with the same key"，
 * 命中项被静默复制/丢弃（实测三明市中西医结合医院 371 页真实招标文件触发 L1-T6#3672）。
 *
 * 该 key 同时充当 ReadingView 中 selectedKey / acked 的身份标识（右栏 entries 与段落定位
 * 两侧同源同值），故格式变更不影响选中与确认态，仅保证唯一性。
 *
 * @param code 规则编号，如 L1-T6
 * @param hit  单条命中，paragraphIndex 为 null 表示未定位到正文段落
 * @param i    该命中在所属规则 hits 数组中的序号（唯一性关键，必须进 key）
 */
export function hitKey(code: string, hit: CheckHit, i: number): string {
  return hit.paragraphIndex != null ? `${code}#${hit.paragraphIndex}#${i}` : `${code}@${i}`
}
