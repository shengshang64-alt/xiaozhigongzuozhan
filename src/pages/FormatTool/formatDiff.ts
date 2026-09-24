import { SIZE_PT, type FormatSpec } from "./formatSpec"
import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// fmt6 刷新前后对比：把「上传文档识别出的原始格式（FormatSpec）」与「当前套用的
// 模板配置（FormatSettings）」逐项比对，产出异常清单（raw ≠ mapped）。
// 纯前端本地推导，零 AI 零后端；样张文字两侧完全一致 → 「文字 0 改动」承诺成立。
// ---------------------------------------------------------------------------

export type FormatScope = "font" | "heading" | "spacing" | "page"

export const SCOPE_OPTIONS: { key: FormatScope; label: string }[] = [
  { key: "font", label: "正文字体与字号" },
  { key: "heading", label: "标题层级" },
  { key: "spacing", label: "行距与段距" },
  { key: "page", label: "纸张与页边距" },
]

export type DiffItem = {
  scope: FormatScope
  label: string
  /** 原稿识别值（展示用） */
  raw: string
  /** 套用模板后的目标值（展示用） */
  mapped: string
  /** raw 与 mapped 是否一致（false = 格式异常，将被刷新修正） */
  same: boolean
}

function fmtPt(pt: number): string {
  return pt ? `${pt}pt` : "未设置"
}

function lineSpacingOf(s: string): string {
  return s || "未设置"
}

/** 逐类比对原稿与模板配置；scopes 为用户勾选的刷新范围，未勾选的类不参与比对 */
export function computeFormatDiff(
  spec: FormatSpec | null,
  settings: FormatSettings,
  scopes: FormatScope[],
): DiffItem[] {
  if (!spec) return []
  const on = (s: FormatScope) => scopes.includes(s)
  const out: DiffItem[] = []
  if (on("font")) {
    out.push({
      scope: "font",
      label: "正文字体",
      raw: spec.body.fontEastAsia || "未设置",
      mapped: settings.body.font,
      same: (spec.body.fontEastAsia || "") === settings.body.font,
    })
    const rawPt = spec.body.sizePt
    const mapPt = SIZE_PT[settings.body.size] ?? 0
    out.push({
      scope: "font",
      label: "正文字号",
      raw: fmtPt(rawPt),
      mapped: `${settings.body.size}（${mapPt}pt）`,
      same: !!rawPt && Math.abs(rawPt - mapPt) < 0.6,
    })
    out.push({
      scope: "font",
      label: "首行缩进",
      raw: spec.body.firstLineChars ? `${spec.body.firstLineChars} 字符` : "未设置",
      mapped: `${settings.body.firstIndent} 字符`,
      same: (spec.body.firstLineChars || 0) === settings.body.firstIndent,
    })
  }
  if (on("heading")) {
    for (let lvl = 1; lvl <= Math.min(3, settings.heading.length); lvl++) {
      const hs = spec.headings.find((h) => h.level === lvl)
      if (!hs) continue
      const cfg = settings.heading[lvl - 1]
      out.push({
        scope: "heading",
        label: `${["一", "二", "三"][lvl - 1]}级标题字体`,
        raw: hs.fontEastAsia || "未设置",
        mapped: cfg.font,
        same: (hs.fontEastAsia || "") === cfg.font,
      })
      const mapPt = SIZE_PT[cfg.size] ?? 0
      out.push({
        scope: "heading",
        label: `${["一", "二", "三"][lvl - 1]}级标题字号`,
        raw: fmtPt(hs.sizePt),
        mapped: `${cfg.size}（${mapPt}pt）`,
        same: !!hs.sizePt && Math.abs(hs.sizePt - mapPt) < 0.6,
      })
    }
  }
  if (on("spacing")) {
    out.push({
      scope: "spacing",
      label: "正文行距",
      raw: lineSpacingOf(spec.body.lineSpacing),
      mapped: settings.body.lineSpacing,
      same: (spec.body.lineSpacing || "") === settings.body.lineSpacing,
    })
    out.push({
      scope: "spacing",
      label: "正文对齐",
      raw: spec.body.align || "未设置",
      mapped: settings.body.align,
      same: (spec.body.align || "") === settings.body.align,
    })
  }
  if (on("page")) {
    out.push({
      scope: "page",
      label: "纸张",
      raw: spec.page.paperGuess,
      mapped: settings.paper,
      same: spec.page.paperGuess === settings.paper,
    })
    for (const m of [
      { key: "top", label: "上边距" },
      { key: "bottom", label: "下边距" },
      { key: "left", label: "左边距" },
      { key: "right", label: "右边距" },
    ] as const) {
      const rawV = spec.page.margin[m.key]
      const mapV = settings.margins[m.key]
      out.push({
        scope: "page",
        label: m.label,
        raw: `${rawV}cm`,
        mapped: `${mapV}cm`,
        same: Math.abs(rawV - mapV) < 0.1,
      })
    }
  }
  return out
}
