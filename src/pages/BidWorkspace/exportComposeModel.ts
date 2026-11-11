/**
 * UX-v2 ⑦ 组卷导出：左「组卷顺序」/ 中「版式设置」/ 右「导出清单」三块的**数据整形**
 * （纯函数、零 AI、零 DOM）。
 *
 * 原型 prototype/bid/export.html 三块要的都是「导出这一下会产出什么、按什么顺序、什么版式」。
 * 这里只从项目档案派生，不编任何数：
 *
 *   组卷顺序    导出实际会写进 docx 的章顺序（= bid_chapters 顺序，与 bidFiles 导出同一真源），
 *               页数用既有 estimatePagesFromChars 折算（与编制页「正文实际 ≈N 页」同口径）。
 *               前置件（封面/目录/目录对照表）按 format_settings 与大纲真实有无判定是否生成。
 *   版式设置    FormatSettings 里的真字段（页眉页脚/页码/目录/纸张/字体/字号/行距），
 *               改动直接落 format_settings，导出即生效。
 *   导出清单    七个交付物各自的就绪条件与真实规模（章数/页数/条数/项数）；
 *               **不显示文件体积**——未生成前没有任何真值，原型那几个 MB 是演示数据。
 */
import {
  DEFAULT_CHARS_PER_PAGE,
  estimatePagesFromChars,
  isBizPart,
  type BidProjectRecord,
  type FormatSettings,
} from "./bidTypes"
import type { Chapter } from "../SolutionStudio/solutionTypes"
import { summarizeTenderTables, type TenderTableRecord } from "./tenderTables"

/** 组卷顺序里的一行 */
export type VolumeRow = {
  id: string
  title: string
  /** 正文页数估算；前置件无字数时给 null（UI 显示「—」而不是编一个 1 页） */
  pages: number | null
  kind: "front" | "tech" | "biz"
  /** 必选=招标要求缺即无效；可选=按开关生成 */
  required: boolean
  /** 副说明（如「导出时自动生成」「目录未启用」） */
  note: string
}

export type ExportFileKey = "bid" | "techparam" | "deviation" | "purchase" | "parse" | "check" | "eval"

export type ExportFileRow = {
  key: ExportFileKey
  /** 交付物文件名（不含项目名与日期前缀，真实文件名由 buildExportFileName 生成） */
  name: string
  desc: string
  ready: boolean
}

export type ExportComposeModel = {
  volumes: VolumeRow[]
  /** 正文章数（不含前置件） */
  chapterCount: number
  /** 正文页数合计（不含前置件） */
  bodyPages: number
  /** 实际会产出的交付物数量 */
  readyFiles: number
  totalFiles: number
}

const nonWs = (s: string | null | undefined): number => (s ?? "").replace(/\s+/g, "").length

/** 组卷顺序：封面 / 目录 / 目录对照表 + 每一章（导出实际写入的章序） */
export function buildVolumeRows(input: {
  chapters: Chapter[]
  format: FormatSettings
  /** 有招标目录要求且能对上章节时才插「目录对照表」 */
  hasCatalogIndex: boolean
}): VolumeRow[] {
  const { chapters, format } = input
  const rows: VolumeRow[] = [
    { id: "front-cover", title: "封面", pages: null, kind: "front", required: true, note: "导出时自动生成" },
    {
      id: "front-toc",
      title: "目录",
      pages: null,
      kind: "front",
      required: format.toc,
      note: format.toc ? "导出时自动生成（含书签与页码域）" : "版式设置里已关闭目录",
    },
  ]
  if (input.hasCatalogIndex) {
    rows.push({
      id: "front-catalog",
      title: "目录对照表",
      pages: null,
      kind: "front",
      required: true,
      note: "招标目录项 ↔ 本册章节对照，导出时自动生成",
    })
  }
  for (const c of chapters) {
    const chars = nonWs(c.content)
    rows.push({
      id: `ch-${c.node_id}`,
      title: c.title,
      pages: chars > 0 ? estimatePagesFromChars(chars) : 1,
      kind: isBizPart(c) ? "biz" : "tech",
      required: true,
      note:
        chars > 0
          ? `${chars.toLocaleString("zh-CN")} 字`
          : isBizPart(c)
            ? "商务格式文件，导出小节占位待线下填写"
            : "本章还没有正文，导出只有章标题",
    })
  }
  return rows
}

/** 导出清单：七个交付物的就绪条件与真实规模 */
export function buildExportFiles(input: {
  project: BidProjectRecord
  chapters: Chapter[]
  bodyPages: number
  techParamTotal: number
  techParamCovered: number
  deviationRows: number
}): ExportFileRow[] {
  const { project, chapters } = input
  const hasBody = chapters.some((c) => (c.content ?? "").trim().length > 0)
  const tables = summarizeTenderTables((project as { tender_tables?: TenderTableRecord[] | null }).tender_tables)
  const purchaseFromParse = (project.parse_report?.sections ?? []).some(
    (s) => s.key === "purchase_list" && (s.content ?? "").trim().length > 0,
  )
  const purchaseReady = tables.purchaseList > 0 || purchaseFromParse
  const sections = project.parse_report?.sections?.length ?? 0

  return [
    {
      key: "bid",
      name: "投标文件.docx",
      desc: hasBody ? `${chapters.length} 章合订 · 正文约 ${input.bodyPages} 页` : "还没有任何章节正文",
      ready: hasBody,
    },
    {
      key: "techparam",
      name: "技术参数响应表.docx",
      desc:
        input.techParamTotal > 0
          ? `共 ${input.techParamTotal} 条参数 · 偏离表已覆盖 ${input.techParamCovered} 条`
          : "未从招标原文定位到技术参数",
      ready: input.techParamTotal > 0,
    },
    {
      key: "deviation",
      name: "技术偏离表.docx",
      desc: input.deviationRows > 0 ? `${input.deviationRows} 条逐条响应` : "还没有生成偏离表",
      ready: input.deviationRows > 0,
    },
    {
      key: "purchase",
      name: "采购清单.docx",
      desc: purchaseReady
        ? tables.purchaseList > 0
          ? `按上传 docx 原表导出（${tables.purchaseList} 张清单表）`
          : "按解析报告「采购清单」分区还原"
        : "未上传含清单表的 docx，解析也未出采购清单",
      ready: purchaseReady,
    },
    {
      key: "parse",
      name: "解析报告.docx",
      desc: sections > 0 ? `${sections} 项解析结果` : "还没有解析报告",
      ready: sections > 0,
    },
    {
      key: "check",
      name: "检查报告.docx",
      desc: project.dup_report || project.void_check ? "查重结果 + 废标条款逐条判定" : "查重与废标检查都还没跑",
      ready: Boolean(project.dup_report || project.void_check),
    },
    {
      key: "eval",
      name: "评标报告.docx",
      desc: project.ai_review ? `${project.ai_review.items?.length ?? 0} 个评分项 AI 打分` : "还没有模拟评标报告",
      ready: Boolean(project.ai_review),
    },
  ]
}

export function buildExportComposeModel(input: {
  project: BidProjectRecord
  chapters: Chapter[]
  format: FormatSettings
  hasCatalogIndex: boolean
  techParamTotal: number
  techParamCovered: number
  deviationRows: number
}): ExportComposeModel {
  const volumes = buildVolumeRows({
    chapters: input.chapters,
    format: input.format,
    hasCatalogIndex: input.hasCatalogIndex,
  })
  const bodyChapters = volumes.filter((v) => v.kind !== "front")
  const bodyPages = bodyChapters.reduce((a, v) => a + (v.pages ?? 0), 0)
  const files = buildExportFiles({
    project: input.project,
    chapters: input.chapters,
    bodyPages,
    techParamTotal: input.techParamTotal,
    techParamCovered: input.techParamCovered,
    deviationRows: input.deviationRows,
  })
  return {
    volumes,
    chapterCount: bodyChapters.length,
    bodyPages,
    readyFiles: files.filter((f) => f.ready).length,
    totalFiles: files.length,
  }
}

/** 版式摘要（页头 meta 用）：一句话说清这次导出按什么纸/字体/行距出件 */
export function formatSummary(fmt: FormatSettings): string {
  return `${fmt.paper} · ${fmt.body.font}${fmt.body.size} · ${fmt.body.lineSpacing}${fmt.toc ? " · 含目录" : ""}${
    fmt.pageNumber ? " · 有页码" : " · 无页码"
  }`
}

/** 预计页数的口径说明（页头 meta 悬停），避免把估算读成精确值 */
export const PAGE_ESTIMATE_HINT = `按每页 ${DEFAULT_CHARS_PER_PAGE} 字折算，与实际排版有出入`
