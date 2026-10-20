import type { IStylesOptions } from "docx"

/**
 * 导出 Word 的默认中文字体（单一真源，R62）。
 *
 * 背景（R46 实测根因）：docx 库的 TextRun 不显式写 font 时，产出的 .docx 里不会有任何
 * <w:rFonts>，Word 会落到主题默认字体（本机常是西文 Calibri / 中文等线），导致
 * 「导出的文档不是仿宋/黑体」且格式识别 / 暗标检查读不到字体。
 * R46 只修了投标文件导出这一条路径（bidFiles.ts 逐 run 写 font）；R62 把其余导出
 * （体检报告 / 讲标手册 / 报价 / 讲稿 / 周报 / 方案封面目录）统一收口到这里。
 */
export type ExportRunFont = { ascii: string; hAnsi: string; eastAsia: string }

/** 标题黑体 / 正文仿宋（与招标文件常用排版一致）。 */
export const DEFAULT_RUN_FONT: Record<"heading" | "body", ExportRunFont> = {
  heading: { ascii: "SimHei", hAnsi: "SimHei", eastAsia: "黑体" },
  body: { ascii: "FangSong", hAnsi: "FangSong", eastAsia: "仿宋" },
}

/**
 * 整篇文档的默认正文字体（docx 的 styles.default.document.run.font → w:rPrDefault/w:rFonts）。
 * 凡「整篇一个默认正文」的导出，把它挂到 Document 的 styles 上，即可让所有 run
 * （含 `new Paragraph({ text })` 简写与字符串形式的 `new TextRun("…")`）都带上中文字体，
 * 不再裸奔到主题默认字体。标题若需黑体，由调用处逐 run 用 DEFAULT_RUN_FONT.heading 覆盖。
 */
export const DOCX_DEFAULT_STYLES: IStylesOptions = {
  default: {
    document: {
      run: {
        font: DEFAULT_RUN_FONT.body,
      },
    },
  },
}
