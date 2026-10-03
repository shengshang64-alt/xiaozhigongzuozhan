import type { Paragraph, TableOfContents } from "docx"
import { typeLabel, type SolutionRecord } from "./solutionTypes.ts"
import { localDateStamp } from "@/lib/dateStamp"

// ---------------------------------------------------------------------------
// R007（B-4 阶段一）：方案 Word 导出模板——封面 / 自动目录 / 页眉。
// 纯函数构建（可在 node 下直接验证），进度按方案存 localStorage（ssFmt 同模式）。
// 目录为 Word 域：downloadDocx 已开 updateFields，Word 打开时提示更新即得页码。
// ---------------------------------------------------------------------------

export type SolutionExportTemplate = {
  cover: boolean
  /** 封面单位名称（空则封面不显示该行） */
  company: string
  toc: boolean
  /** 页眉文字（空则不加页眉） */
  headerText: string
}

export const DEFAULT_EXPORT_TEMPLATE: SolutionExportTemplate = {
  cover: true,
  company: "",
  toc: true,
  headerText: "",
}

const KEY_PREFIX = "ss_tpl_"

export function normalizeExportTemplate(raw: unknown): SolutionExportTemplate {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    cover: r.cover !== false,
    company: String(r.company ?? ""),
    toc: r.toc !== false,
    headerText: String(r.headerText ?? ""),
  }
}

export function readSolutionExportTemplate(id: string): SolutionExportTemplate {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + id)
    if (!raw) return { ...DEFAULT_EXPORT_TEMPLATE }
    return normalizeExportTemplate(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_EXPORT_TEMPLATE }
  }
}

export function writeSolutionExportTemplate(id: string, tpl: SolutionExportTemplate): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + id, JSON.stringify(tpl))
  } catch {
    /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
  }
}

/** 封面 + 目录（按模板开关）→ 前置 children；正文由调用方追加。
 *  R147（解除 r124-solutionstudio-docx-defer）：docx 在本函数内动态导入——
 *  模块级只剩编译期类型引用，SolutionStudio 路由 chunk 不再静态打包 docx。 */
export async function buildExportFrontMatter(
  sol: SolutionRecord,
  tpl: SolutionExportTemplate,
): Promise<(Paragraph | TableOfContents)[]> {
  const { AlignmentType, HeadingLevel, PageBreak, Paragraph: DocxParagraph, TableOfContents: DocxToc, TextRun } =
    await import("docx")
  const centered = (text: string, size: number, opts?: { bold?: boolean; before?: number }) =>
    new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: opts?.before ?? 0 },
      children: [new TextRun({ text, size, bold: opts?.bold })],
    })
  const children: (Paragraph | TableOfContents)[] = []
  if (tpl.cover) {
    if (tpl.company) children.push(centered(tpl.company, 32, { bold: true, before: 2400 }))
    children.push(centered(sol.solution_name, 56, { bold: true, before: tpl.company ? 1200 : 3600 }))
    children.push(centered(`${sol.hospital || "未填客户医院"} · ${typeLabel(sol.solution_type)}`, 28, { before: 600 }))
    children.push(centered(`编制日期：${localDateStamp()}`, 24, { before: 200 }))
    children.push(new DocxParagraph({ children: [new PageBreak()] }))
  }
  if (tpl.toc) {
    children.push(
      new DocxParagraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "目  录", bold: true, size: 32 })],
      }),
    )
    children.push(new DocxToc("目录", { hyperlink: true, headingStyleRange: "1-2" }))
    children.push(new DocxParagraph({ children: [new PageBreak()] }))
  }
  return children
}
