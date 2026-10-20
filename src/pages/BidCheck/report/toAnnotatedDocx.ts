// ---------------------------------------------------------------------------
// toAnnotatedDocx.ts —— 标书检查 · 标注版 Word（OOXML comments）导出。R270 五期。
//
// 设计要点：
//   - 正文重建自 result.paragraphs（三栏中栏同源，逐段呈现，标题段用 Heading2）；
//   - 每条 CheckItem.hits 分配一条 Word 批注：批注锚在该 hit.paragraphIndex 对应段落；
//     批注正文五要素齐全（编号/严重度/状态/原文/依据/建议），复用 bidCheckTypes 的标签真源；
//   - 无正文定位（元数据 / 节点痕迹 / 整篇级）命中归入尾章「无正文定位命中」清单，
//     避免丢条；正文命中 0 条时也不阻塞导出（批注数=0，Word 里可正常打开）；
//   - 只标不改：产出的是独立 .docx 报告文件，绝不改动用户上传的原文件；同 Excel/HTML 三件套定位。
//   - 与既有门禁一致：hardFatal 时按钮置灰、blocked 时二次确认；本模块只管生成。
// ---------------------------------------------------------------------------

import {
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx"
import { DOCX_DEFAULT_STYLES } from "@/lib/exportFont"
import { buildSafeFileName } from "@/lib/fileName"
import { triggerBlobDownload } from "@/lib/download"
import {
  CHECK_LEVEL_LABEL,
  ITEM_STATUS_LABEL,
  SEVERITY_LABEL,
  formatHitLocation,
  type BidCheckResult,
  type CheckHit,
  type CheckItem,
} from "../bidCheckTypes"

/** 一条待生成的批注条目（一命中一条；无正文定位也保留 id，锚入尾章清单）。 */
export type CommentEntry = {
  id: number
  /** 正文锚点段落 index；null=元数据 / 包级 / 无锚点，归入尾章清单 */
  anchorParagraphIndex: number | null
  item: CheckItem
  hit: CheckHit
}

/**
 * 收集全部 fail/warn 项的命中为批注条目（保持原顺序，命中序号即 id）。
 * pass / unconfigured / skipped 项不入批注（与 Excel 清单口径一致）。
 */
export function collectCommentEntries(result: BidCheckResult): CommentEntry[] {
  const out: CommentEntry[] = []
  let id = 0
  for (const it of result.items) {
    if (it.status !== "fail" && it.status !== "warn") continue
    for (const h of it.hits) {
      out.push({ id: id++, anchorParagraphIndex: h.paragraphIndex ?? null, item: it, hit: h })
    }
  }
  return out
}

/** 单条批注的正文段落（Word 右侧批注气泡里呈现的多行文本）。 */
function commentBody(entry: CommentEntry): Paragraph[] {
  const { item: it, hit: h } = entry
  const lines: Paragraph[] = []
  lines.push(
    new Paragraph({
      children: [new TextRun({ text: `[${it.code}] ${it.title}`, bold: true })],
    }),
  )
  lines.push(
    new Paragraph({
      children: [
        new TextRun(
          `级别：${CHECK_LEVEL_LABEL[it.level]} · 严重度：${SEVERITY_LABEL[it.severity]} · 状态：${ITEM_STATUS_LABEL[it.status]}`,
        ),
      ],
    }),
  )
  if (h.text) {
    lines.push(
      new Paragraph({
        children: [new TextRun({ text: `原文：${h.text}`, italics: true })],
      }),
    )
  }
  if (it.basis) {
    lines.push(
      new Paragraph({
        children: [new TextRun(`依据：${it.basis}`)],
      }),
    )
  }
  if (h.basis && h.basis !== it.basis) {
    lines.push(
      new Paragraph({
        children: [new TextRun(`命中依据：${h.basis}`)],
      }),
    )
  }
  if (it.suggestion) {
    lines.push(
      new Paragraph({
        children: [new TextRun({ text: `建议：${it.suggestion}`, color: "2A7D5A" })],
      }),
    )
  }
  return lines
}

/** 生成 Word 批注 Document（不 Packer，供单测与 Blob 复用）。 */
export function buildAnnotatedDocx(result: BidCheckResult): Document {
  const entries = collectCommentEntries(result)
  const anchored = entries.filter((e) => e.anchorParagraphIndex != null)
  const unanchored = entries.filter((e) => e.anchorParagraphIndex == null)

  const byPara = new Map<number, CommentEntry[]>()
  for (const e of anchored) {
    const k = e.anchorParagraphIndex as number
    const arr = byPara.get(k)
    if (arr) arr.push(e)
    else byPara.set(k, [e])
  }

  const children: Paragraph[] = []

  // 封面（4 行元信息 + 一条说明段）
  children.push(
    new Paragraph({ text: "标书检查 · 标注版", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun(`对象：${result.sourceName}`)] }),
    new Paragraph({
      children: [new TextRun(`模式：${result.mode === "sealed" ? "暗标严格模式" : "普通模式"}`)],
    }),
    new Paragraph({ children: [new TextRun(`生成时间：${result.generatedAt}`)] }),
    new Paragraph({
      children: [
        new TextRun(
          `命中统计：必改 ${result.summary.fail} · 建议 ${result.summary.warn} · 批注共 ${entries.length} 条（正文锚定 ${anchored.length} / 无正文定位 ${unanchored.length}）`,
        ),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "本文件为标书检查中枢（BidCheck）产出的只读批注版：正文段落来自被检文件的段落序列，每条命中挂一条 Word 批注；未对原文件做任何修改。请在 Word「审阅」面板逐条查看，人工在原稿中落地整改。",
          italics: true,
          color: "666666",
        }),
      ],
    }),
  )

  // 正文（段落序列 + 批注锚）
  result.paragraphs.forEach((p, idx) => {
    const list = byPara.get(idx)
    if (!list || list.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun(p.text || "")],
          heading: p.heading ? HeadingLevel.HEADING_2 : undefined,
        }),
      )
      return
    }
    const kids: (CommentRangeStart | CommentRangeEnd | CommentReference | TextRun)[] = []
    for (const e of list) kids.push(new CommentRangeStart(e.id))
    kids.push(new TextRun(p.text || ""))
    for (const e of list) {
      kids.push(new CommentRangeEnd(e.id))
      kids.push(new TextRun({ children: [new CommentReference(e.id)] }))
    }
    children.push(
      new Paragraph({
        children: kids as never,
        heading: p.heading ? HeadingLevel.HEADING_2 : undefined,
      }),
    )
  })

  // 尾章：无正文定位命中（元数据 / 节点痕迹 / 整篇级）
  if (unanchored.length) {
    children.push(
      new Paragraph({
        text: "无正文定位命中（元数据 / 节点痕迹 / 整篇级）",
        heading: HeadingLevel.HEADING_1,
      }),
    )
    for (const e of unanchored) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${e.item.code}] ${e.item.title}`, bold: true }),
            new TextRun(` — ${formatHitLocation(e.hit)}`),
            new TextRun(e.hit.text ? ` · 摘录：${e.hit.text}` : ""),
          ],
        }),
      )
    }
  }

  const date = new Date()
  const doc = new Document({
    styles: DOCX_DEFAULT_STYLES,
    creator: "BidCheck",
    title: `标书检查标注版 - ${result.sourceName}`,
    subject: "标书检查中枢五期：Word 批注引擎导出",
    description:
      "由标书检查中枢（BidCheck）产出的 Word 批注版报告；每条命中一条批注，只标不改。",
    lastModifiedBy: "BidCheck",
    comments: {
      children: entries.map((e) => ({
        id: e.id,
        author: "BidCheck",
        initials: "BC",
        date,
        children: commentBody(e),
      })),
    },
    sections: [{ properties: {}, children }],
  })
  return doc
}

/** 生成 Blob（走 Packer.toBuffer）。 */
export async function buildAnnotatedDocxBlob(result: BidCheckResult): Promise<Blob> {
  const buf = await Packer.toBuffer(buildAnnotatedDocx(result))
  // Node Buffer.buffer 是 ArrayBufferLike（可能 SharedArrayBuffer），Blob 需 ArrayBuffer 视图；
  // 走 new Uint8Array(len) + set(buf) 让 TS 推 Uint8Array<ArrayBuffer>（新分配、非共享）。
  const bytes = new Uint8Array(buf.byteLength)
  bytes.set(buf)
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })
}

/** 导出并触发下载。 */
export async function exportAnnotatedDocx(result: BidCheckResult): Promise<void> {
  const blob = await buildAnnotatedDocxBlob(result)
  const name = buildSafeFileName(`${result.sourceName}-标注版`, "docx", "标书检查标注版")
  triggerBlobDownload(blob, name)
}
