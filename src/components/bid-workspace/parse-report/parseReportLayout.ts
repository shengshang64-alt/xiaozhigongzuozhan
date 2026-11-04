/**
 * 解析报告首屏的纯展示决策：该打开哪一组、健康概览怎么说、提示怎么收成一条。
 * 不读网络、不改报告结构。文案给售前看，不出现「段 / chunk」这类内部词。
 */
import { formatCount } from "@/lib/money"
import { starClauseCount } from "@/pages/BidWorkspace/bidTypes"
import type { TenderParseQuality } from "@/pages/BidWorkspace/bidTypes"

/** 内置四组。外部面板（如条款覆盖矩阵、评分项核对）经 extraTabs 追加任意分组 id。 */
export type BuiltinParseGroupId = "items" | "clauses" | "risk" | "lists"

/** 呈现层的分组 id：内置四组，或 extraTabs 追加的任意字符串 id。不落库。 */
export type ParseGroupId = string

/** 默认只展开最需要处理的一组。必选项失败优先，因为它会挡住进入编制。 */
export function pickParseGroup(input: {
  requiredFailureCount: number
  riskRed: number
  implicitVoid: number
  /** 参数研判已出现「建议放弃」或「谨慎投标」。未研判的常态不抢首屏。 */
  paramNeedsAttention: boolean
}): BuiltinParseGroupId {
  if (input.requiredFailureCount > 0) return "items"
  if (input.riskRed > 0) return "risk"
  if (input.implicitVoid > 0) return "clauses"
  if (input.paramNeedsAttention) return "lists"
  return "items"
}

export type ParsePanelView = "summary" | "detail"

export type ParsePanelUi = {
  stamp: string
  group: ParseGroupId
  selectedKey: string | null
  view: ParsePanelView
}

/**
 * 换了一份招标文件才重置「当前打开哪一组」。
 * 用原文长度和开头几个字，不用解析项正文——人工改某一项时不要把人从当前分组弹走。
 */
export function reportUiStamp(
  scope: string | undefined,
  sectionKeys: string[],
  tenderText: string | undefined,
): string {
  const tender = tenderText ?? ""
  return `${scope ?? ""}|${sectionKeys.join(",")}|${tender.length}|${tender.slice(0, 32)}`
}

export function defaultParsePanelUi(input: {
  stamp: string
  requiredFailureKey: string | null
  requiredFailureCount: number
  riskRed: number
  implicitVoid: number
  paramNeedsAttention: boolean
}): ParsePanelUi {
  return {
    stamp: input.stamp,
    group: pickParseGroup(input),
    selectedKey: input.requiredFailureKey,
    view: input.requiredFailureCount > 0 ? "detail" : "summary",
  }
}

export type ParseNotice = {
  id: string
  tone: "danger" | "warning"
  title: string
  detail: string
}

/** 原来五条横幅里、除「必选项失败」以外的提示。必选项失败改由健康概览承担，这里不再重复。 */
export function buildParseNotices(input: {
  warningHeadline: string | null
  truncation: { keptChars: number; droppedChars: number; fromLine: number } | null
  quality: TenderParseQuality | undefined
  coveragePct: number | null
  coverageLow: boolean
}): ParseNotice[] {
  const out: ParseNotice[] = []
  if (input.warningHeadline) {
    out.push({
      id: "warnings",
      tone: "warning",
      title: input.warningHeadline,
      detail: "若某一项内容明显缺了，打开「解析项明细」，对该项点「重新解析此项」。",
    })
  }
  if (input.truncation) {
    const t = input.truncation
    out.push({
      id: "truncation",
      tone: "warning",
      title: `评分章素材已按整行截断：已收录 ${formatCount(t.keptChars)} 字，另有 ${formatCount(t.droppedChars)} 字未纳入`,
      detail: `截断从第 ${formatCount(t.fromLine)} 行起，尾部评分项可能缺失。请对照原件核对，或把完整招标文件分段上传后再解析。`,
    })
  }
  if (input.quality && input.quality !== "ok") {
    const scanned = input.quality === "suspect_scanned"
    out.push({
      id: "quality",
      tone: scanned ? "danger" : "warning",
      title: scanned
        ? "疑似扫描版或图片型文档，文字层可能缺失，解析结果可能不完整"
        : "招标文件提取到的文字偏少，可能有表格、图片或加密部分没读到",
      detail: "建议用文字识别转成可复制文本，或在「招标文件」里粘贴文本后重新解析，并对照原件核对关键项。",
    })
  }
  if (input.coverageLow && input.coveragePct != null) {
    out.push({
      id: "coverage",
      tone: "warning",
      title: `解析覆盖率 ${input.coveragePct}%（偏低，仅供参考）`,
      detail: "解析产出是要点摘要，字数少于招标原文是常态，不阻断生成。能不能进入下一步，只看必选项是否通过。",
    })
  }
  return out
}

/** ★/▲ 重点条款条数。末行「…另有」是扫描器的截断说明，不另算一条。 */
export function countStarClauseLines(content: string | undefined): number {
  const lines = (content ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return 0
  return starClauseCount(lines)
}

export function parseHealthVerdict(input: {
  requiredTitles: string[]
  pendingCount: number
}): { title: string; detail: string } {
  const n = input.requiredTitles.length
  if (n > 0) {
    return {
      title: `必选项还没通过，先处理 ${n} 项`,
      detail: `${input.requiredTitles.join("、")}。这些项会带动后面的大纲和评分，请逐项重新解析后再进入编制。`,
    }
  }
  if (input.pendingCount > 0) {
    return {
      title: "必选项已通过，还有内容需要核对",
      detail: `失败或未提取 ${input.pendingCount} 项。不挡住进入下一步，建议在「解析项明细」里看一眼。`,
    }
  }
  return {
    title: "这份招标文件已经解析通过",
    detail: "必选项齐全。可以进入投标文件编制；重点条款、风险和清单收在下面的分组里。",
  }
}
