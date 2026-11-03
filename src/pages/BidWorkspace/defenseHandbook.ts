// ---------------------------------------------------------------------------
// R137 讲标答辩手册导出：把「专家问题池 / 讲标大纲 / 讲标稿要点」三块内容
// 汇总为一份可打印带进评标现场的 Word 手册。纯本地拼装，零 AI 调用、零网络请求。
// 中间块结构（HandbookBlock）与 docx 渲染分离：块组装是纯函数可直接单测，
// 渲染层只做 block→Paragraph 的机械转换。
// ---------------------------------------------------------------------------

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx"
import { DOCX_DEFAULT_STYLES } from "@/lib/exportFont"
import { triggerBlobDownload } from "@/lib/download"
import { buildSafeFileName, buildVersionedFileName } from "@/lib/fileName"
import { localDateStamp } from "@/lib/dateStamp"
import type { BidDefense } from "./bidTypes"

/** 手册内容中间块（纯数据，组装逻辑全部收敛在 buildDefenseHandbookBlocks） */
export type HandbookBlock =
  | { kind: "title"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }

const CN_NUMS = ["一", "二", "三", "四"]

/** 组装手册块：章节动态编号（只给有内容的块编号），空内容整节静默跳过 */
export function buildDefenseHandbookBlocks(projectName: string, defense: BidDefense): HandbookBlock[] {
  const questions = defense.questions
  const outline = defense.defense_outline
  const speech = defense.speech_notes
  const hasSpeech = !!speech && !!(speech.opening.trim() || speech.closing.trim() || speech.sections.length)
  if (!questions.length && !outline.length && !hasSpeech) {
    throw new Error("尚未生成讲标答辩内容，请先生成问题池 / 大纲 / 讲标稿")
  }
  const unansweredNos = questions.map((q, i) => (q.full_answer.trim() ? 0 : i + 1)).filter(Boolean)

  const metaBits = [`生成日期：${localDateStamp()}`]
  if (questions.length) metaBits.push(`问题 ${questions.length} 个（已备答案 ${questions.length - unansweredNos.length}）`)
  if (outline.length) metaBits.push(`讲标大纲 ${outline.length} 页`)
  const blocks: HandbookBlock[] = [
    { kind: "title", text: `${projectName.trim() || "投标项目"} · 讲标答辩手册` },
    { kind: "meta", text: metaBits.join(" | ") },
  ]

  let sec = 0
  if (questions.length) {
    blocks.push({ kind: "heading", text: `${CN_NUMS[sec++]}、专家问题池` })
    questions.forEach((q, i) => {
      blocks.push({ kind: "subheading", text: `问题 ${i + 1} · ${q.question}` })
      if (q.intent.trim()) blocks.push({ kind: "text", text: `考察点：${q.intent.trim()}` })
      if (q.ref_chapters.length) blocks.push({ kind: "text", text: `可引用章节：${q.ref_chapters.join("、")}` })
      if (q.answer_points.length) {
        blocks.push({ kind: "text", text: "答辩要点：" })
        q.answer_points.forEach((pt) => blocks.push({ kind: "bullet", text: pt }))
      }
      const answer = q.full_answer.trim()
      if (answer) {
        blocks.push({ kind: "text", text: "完整答案：" })
        answer
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((line) => blocks.push({ kind: "text", text: line }))
      } else {
        blocks.push({ kind: "text", text: "（尚未准备完整答案，现场请结合答辩要点谨慎应答）" })
      }
    })
  }
  if (outline.length) {
    blocks.push({ kind: "heading", text: `${CN_NUMS[sec++]}、讲标大纲` })
    outline.forEach((pg, i) => {
      blocks.push({ kind: "subheading", text: `第 ${i + 1} 页 · ${pg.page_title.trim() || `第 ${i + 1} 页`}` })
      pg.bullets.forEach((b) => blocks.push({ kind: "bullet", text: b }))
    })
  }
  if (hasSpeech && speech) {
    blocks.push({ kind: "heading", text: `${CN_NUMS[sec++]}、讲标稿要点` })
    if (speech.opening.trim()) {
      blocks.push({ kind: "subheading", text: "开场白" })
      blocks.push({ kind: "text", text: speech.opening.trim() })
    }
    speech.sections.forEach((s, i) => {
      blocks.push({ kind: "subheading", text: s.title.trim() || `第 ${i + 1} 页` })
      s.points.forEach((pt) => blocks.push({ kind: "bullet", text: pt }))
    })
    if (speech.closing.trim()) {
      blocks.push({ kind: "subheading", text: "收尾" })
      blocks.push({ kind: "text", text: speech.closing.trim() })
    }
  }
  if (unansweredNos.length) {
    blocks.push({ kind: "heading", text: `${CN_NUMS[sec]}、待备答案自查` })
    blocks.push({
      kind: "text",
      text: `以下问题尚未准备完整答案：问题 ${unansweredNos.join("、")}。建议进场前逐一过口径。`,
    })
  }
  return blocks
}

/**
 * 导出文件名：统一走「日期-项目名-类型-V版本号」口径。
 *
 * 2026-10-26（验收官复核 A/B 中的 B）：原来用
 * `buildSafeFileName(\`${项目名}-讲标答辩手册-${localDateStamp()}\`)`，
 * 与投标文件 / 方案的「日期-名称-类型-V版本号」口径不一致——同一项目下几份产物
 * 命名规则各不相同，用户没法按名字判断归属与新旧。现统一到 buildVersionedFileName。
 *
 * `stamp` 参数保留：既有调用与单测传了就用（兼容老行为），没传就用当前时刻。
 */
export function handbookFileName(projectName: string, stamp?: string): string {
  const name = projectName.trim() || "投标项目"
  if (stamp) return buildSafeFileName(`${name}-讲标答辩手册-${stamp}`, "docx", "讲标答辩手册")
  return buildVersionedFileName(name, "讲标答辩手册")
}

function blocksToParagraphs(blocks: HandbookBlock[]): Paragraph[] {
  return blocks.map((b) => {
    if (b.kind === "title") {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: b.text, bold: true, size: 36 })],
      })
    }
    if (b.kind === "meta") {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320 },
        children: [new TextRun({ text: b.text, size: 20, color: "666666" })],
      })
    }
    if (b.kind === "heading") {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 140 },
        children: [new TextRun({ text: b.text, bold: true, size: 30 })],
      })
    }
    if (b.kind === "subheading") {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 100 },
        children: [new TextRun({ text: b.text, bold: true, size: 26 })],
      })
    }
    if (b.kind === "bullet") {
      return new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text: b.text, size: 22 })],
      })
    }
    return new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: b.text, size: 22 })],
    })
  })
}

/** 生成并触发下载（调用方负责 try/catch 兜提示；空内容时本函数也会抛同款友好错误） */
export async function exportDefenseHandbook(projectName: string, defense: BidDefense): Promise<void> {
  const blocks = buildDefenseHandbookBlocks(projectName, defense)
  const doc = new Document({ styles: DOCX_DEFAULT_STYLES, sections: [{ children: blocksToParagraphs(blocks) }] })
  const blob = await Packer.toBlob(doc)
  triggerBlobDownload(blob, handbookFileName(projectName))
}
