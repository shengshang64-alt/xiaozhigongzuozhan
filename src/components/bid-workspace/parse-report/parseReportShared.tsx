import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import type { ParseSectionStatus } from "@/pages/BidWorkspace/bidTypes"
import { lineHasMarkerLoss } from "@/pages/BidWorkspace/materialIntegrity"

/** 四档徽标走设计令牌（badge-*），不再写死琥珀色。 */
export const STATUS_BADGE: Record<ParseSectionStatus, string> = {
  ok: "badge-success",
  failed: "badge-danger",
  pending: "badge-neutral",
  miss: "badge-warning",
}

const STAR_LINE_HEAD_RE = /^(\s*(?:\d+[.、)）]\s*)?[★☆▲△]+)/

export function renderStarLine(line: string): ReactNode {
  const m = line.match(STAR_LINE_HEAD_RE)
  if (!m) return line
  return (
    <>
      <span className="font-semibold text-primary">{m[1]}</span>
      {line.slice(m[1].length)}
    </>
  )
}

/** 命中符号丢失签名的行尾挂「疑符号丢失」。悬停看说明，零 AI。 */
export function renderDetailLine(line: string, isStar: boolean): ReactNode {
  const body = isStar ? renderStarLine(line) : line
  if (!lineHasMarkerLoss(line)) return body
  return (
    <>
      {body}
      <span
        title={
          "该行疑似丢失 ★/▲ 等标注符号（原招标文件制作或转换时符号已损坏，文本只留下空引号）\n" +
          "摘录：" + line.trim().slice(0, 60) + "\n" +
          "重点条款扫描可能不全，请对照招标原件核实。"
        }
        className="badge-warning ml-1.5 inline-flex shrink-0 cursor-help items-center gap-0.5 align-middle"
      >
        <ShieldAlert className="h-3 w-3" />
        疑符号丢失
      </span>
    </>
  )
}
