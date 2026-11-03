// @r211 R-004 标书 Word 分页预览的纯逻辑助手（与组件分离，满足 react-refresh 单导出约束）
import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import { isRealSectionHeading } from "@/pages/BidWorkspace/bidTypes"
import { SIZE_PT } from "@/pages/FormatTool/formatSpec"

const FONT_FAMILY: Record<string, string> = {
  仿宋: '"FangSong", "仿宋", "STFangsong", serif',
  黑体: '"SimHei", "黑体", sans-serif',
  宋体: '"SimSun", "宋体", serif',
  楷体: '"KaiTi", "楷体", serif',
}
const DEFAULT_FAMILY = '"SimSun", "宋体", serif'

export function ff(font: string | undefined): string {
  return (font && FONT_FAMILY[font]) || DEFAULT_FAMILY
}

export function pt(size: string | undefined, fallback: number): number {
  const v = SIZE_PT[(size ?? "") as keyof typeof SIZE_PT]
  return typeof v === "number" && v > 0 ? v : fallback
}

export function lineHeight(ls: string | undefined): number | string {
  if (!ls) return 1.5
  if (ls === "1.5倍") return 1.5
  if (ls === "2倍") return 2
  const m = /固定值\s*([\d.]+)/.exec(ls)
  if (m) return `${m[1]}pt`
  return 1.5
}

export function paperDims(paper: FormatSettings["paper"]): { w: number; h: number } {
  if (paper === "A3") return { w: 29.7, h: 42 }
  if (paper === "16K") return { w: 18.5, h: 26 }
  return { w: 21, h: 29.7 }
}

/** 章级编号：按 titleNumbering 输出前缀（1 / 第N章 / 无） */
export function chapterNumber(i: number, mode: FormatSettings["titleNumbering"]): string {
  if (mode === "chapter") return `第${i + 1}章 `
  if (mode === "none") return ""
  return `${i + 1} `
}

export type Kind = "h2" | "h3" | "caption" | "p"

export function classify(line: string, sections: string[], chapterNo: number): Kind {
  const t = line.trim()
  // 问题3 对齐导出：真小节标题统一走 isRealSectionHeading（整行精确匹配本章小节 / 编号-章号一致），
  // 不再用 startsWith 或裸 \d+\.\d+ 把正文句误升为标题,预览与成稿一致
  if (isRealSectionHeading(t, sections, chapterNo)) return /^\d+\.\d+\.\d+/.test(t) ? "h3" : "h2"
  if (/^（[一二三四五六七八九十]+）/.test(t) && t.length <= 30 && !/[。！？；，、]$/.test(t)) return "h3"
  if (/^(图|表)\s*[0-9０-９一二三四五六七八九十]/.test(t)) return "caption"
  return "p"
}
