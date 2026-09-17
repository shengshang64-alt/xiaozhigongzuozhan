import PptxGenJS from "pptxgenjs"
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx"
import { deckTypeLabel, type DeckRecord, type Slide } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// PPT 导出（.pptx 商务简洁版式 + 讲稿 Word）。导出文件用中性商务配色，
// 与站内 UI token 无关。
// ---------------------------------------------------------------------------

const NAVY = "1F3864"
const ACCENT = "2E74B5"
const BODY = "333333"
const SUBTLE = "D6E4F0"
const MUTED = "9AA7B5"
const LIGHT_BG = "F5F7FA"

function todayText(): string {
  const d = new Date()
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

function safeFileName(name: string, ext: string): string {
  const base = (name || "汇报PPT").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
  return `${base}.${ext}`
}

function bulletFontSize(slides: Slide[]): number {
  const maxBullets = Math.max(...slides.map((s) => s.bullets?.length ?? 0), 1)
  const maxLen = Math.max(...slides.flatMap((s) => (s.bullets ?? []).map((b) => b.length)), 10)
  if (maxBullets <= 4 && maxLen <= 34) return 18
  if (maxBullets <= 6 && maxLen <= 48) return 16
  return 14
}

export async function exportDeckPptx(deck: DeckRecord): Promise<void> {
  const slides = deck.slides ?? []
  if (!slides.length) throw new Error("没有可导出的页面")
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.author = "医疗售前工作台"
  pptx.title = deck.deck_name
  pptx.subject = deckTypeLabel(deck.deck_type)

  const pageNumber = { x: 12.55, y: 7.02, w: 0.6, h: 0.35, color: MUTED, fontSize: 10 } as const

  // 封面页
  const cover = pptx.addSlide()
  cover.background = { color: NAVY }
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 5.9, w: 13.33, h: 0.06, fill: { color: ACCENT } })
  cover.addText(deck.deck_name || "汇报 PPT", {
    x: 0.9,
    y: 2.35,
    w: 11.53,
    h: 1.5,
    fontSize: 34,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fit: "shrink",
  })
  const metaBits = [deckTypeLabel(deck.deck_type)]
  if (deck.audience) metaBits.push(`汇报对象：${deck.audience}`)
  if (deck.duration_min) metaBits.push(`时长约 ${deck.duration_min} 分钟`)
  cover.addText(metaBits.join("  |  "), {
    x: 0.9,
    y: 4.05,
    w: 11.53,
    h: 0.5,
    fontSize: 14,
    color: SUBTLE,
    align: "center",
  })
  cover.addText(todayText(), { x: 0.9, y: 6.35, w: 11.53, h: 0.4, fontSize: 12, color: SUBTLE, align: "center" })

  // 目录页
  const toc = pptx.addSlide()
  toc.background = { color: "FFFFFF" }
  toc.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACCENT } })
  toc.addText("目录", { x: 0.7, y: 0.4, w: 6, h: 0.7, fontSize: 26, bold: true, color: NAVY })
  toc.addText(
    slides.map((s, i) => ({
      text: `${String(i + 1).padStart(2, "0")}   ${s.title || `第 ${i + 1} 页`}`,
      options: { breakLine: true, fontSize: slides.length > 14 ? 13 : 15, color: BODY, paraSpaceAfter: 6 },
    })),
    { x: 1.0, y: 1.45, w: 11.3, h: 5.6, valign: "top", fit: "shrink" },
  )
  toc.slideNumber = { ...pageNumber }

  // 内容页
  const bodyFontSize = bulletFontSize(slides)
  slides.forEach((s, i) => {
    const sl = pptx.addSlide()
    sl.background = { color: "FFFFFF" }
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACCENT } })
    sl.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.18, w: 1.6, h: 0.03, fill: { color: ACCENT } })
    sl.addText(s.title || `第 ${i + 1} 页`, {
      x: 0.65,
      y: 0.32,
      w: 12.0,
      h: 0.8,
      fontSize: 24,
      bold: true,
      color: NAVY,
      fit: "shrink",
    })
    const bullets = (s.bullets ?? []).length ? s.bullets : ["—"]
    sl.addText(
      bullets.map((b) => ({
        text: b,
        options: {
          bullet: { code: "2022", indent: 14 },
          breakLine: true,
          fontSize: bodyFontSize,
          color: BODY,
          paraSpaceAfter: 10,
        },
      })),
      { x: 0.85, y: 1.5, w: 11.7, h: 5.45, valign: "top", fit: "shrink" },
    )
    sl.addText(`${deck.deck_name}`, { x: 0.7, y: 7.02, w: 6, h: 0.35, fontSize: 9, color: MUTED })
    if (s.notes?.trim()) sl.addNotes(s.notes.trim())
    sl.slideNumber = { ...pageNumber }
  })

  // 结尾页
  const end = pptx.addSlide()
  end.background = { color: NAVY }
  end.addShape(pptx.ShapeType.rect, { x: 0, y: 5.9, w: 13.33, h: 0.06, fill: { color: ACCENT } })
  end.addText("谢谢聆听", { x: 0.9, y: 2.7, w: 11.53, h: 1.2, fontSize: 40, bold: true, color: "FFFFFF", align: "center" })
  end.addText("欢迎交流指正", { x: 0.9, y: 4.0, w: 11.53, h: 0.5, fontSize: 16, color: SUBTLE, align: "center" })

  await pptx.writeFile({ fileName: safeFileName(deck.deck_name, "pptx") })
}

// ---------------------------------------------------------------------------
// 讲稿 Word 导出
// ---------------------------------------------------------------------------

export async function saveDocx(fileName: string, children: Paragraph[]): Promise<void> {
  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export async function exportSpeechDocx(deck: DeckRecord): Promise<void> {
  const slides = deck.slides ?? []
  if (!slides.length) throw new Error("没有可导出的页面")
  const children: Paragraph[] = []
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: `${deck.deck_name} · 讲稿`, bold: true, size: 36 })],
    }),
  )
  const metaBits = [deckTypeLabel(deck.deck_type)]
  if (deck.audience) metaBits.push(`汇报对象：${deck.audience}`)
  if (deck.duration_min) metaBits.push(`时长约 ${deck.duration_min} 分钟`)
  metaBits.push(`共 ${slides.length} 页`)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: metaBits.join("　|　"), size: 20, color: "666666" })],
    }),
  )
  slides.forEach((s, i) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: `第 ${i + 1} 页 · ${s.title || "（未命名页）"}`, bold: true, size: 26 })],
      }),
    )
    ;(s.bullets ?? []).forEach((b) => {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: b, size: 22 })],
        }),
      )
    })
    children.push(
      new Paragraph({
        spacing: { before: 100, after: 60 },
        children: [
          new TextRun({ text: "讲稿备注：", bold: true, size: 22, color: "1F3864" }),
          new TextRun({ text: s.notes?.trim() || "（本页暂无讲稿，可在编辑器中补充）", size: 22, color: "444444" }),
        ],
      }),
    )
  })
  await saveDocx(safeFileName(`${deck.deck_name}-讲稿`, "docx"), children)
}

// 供 quoteExports 复用的浅色底纹常量（导出文件配色，不受站内 token 约束）
export const DOCX_TABLE_HEADER_FILL = LIGHT_BG
