// ---------------------------------------------------------------------------
// R245 切片（bidkit-plan-slice3 底稿增量合并）：底稿文件的浏览器侧读取
// .docx 复用 package.json 已有的 mammoth（R235 复用检索结论，不新增依赖）转 HTML 后按 h1/h2 切章；
// .pdf 走招标文件既有抽取通道拿纯文本，.txt/.md 直接读文本——两者统一交 parseDraftPlainText 按编号标题切章。
// 只做 I/O 适配，匹配与落库口径全在纯逻辑层（bidDraftMerge.ts / bidDraftPlan.ts），便于脱离浏览器单测。
// Author: loop-R245
// ---------------------------------------------------------------------------
import type { DraftChapter } from "./bidDraftMerge"
import { parseDraftHtml } from "./bidDraftMerge"
import { parseDraftPlainText } from "./bidDraftPlan"

export type DraftVia = "docx" | "pdf" | "text"

/** 读一份底稿文件并切成结构化章节（标题 + 正文）；失败抛用户可读文案，由调用方兜 toast */
export async function importDraftChapters(file: File): Promise<{ chapters: DraftChapter[]; via: DraftVia }> {
  const lower = (file.name ?? "").toLowerCase()
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth")
    const buf = await file.arrayBuffer()
    const res = await mammoth.convertToHtml({ arrayBuffer: buf })
    const chapters = parseDraftHtml(res.value ?? "")
    if (!chapters.length) {
      throw new Error("底稿里没有可识别的章标题：Word 请用「标题 1 / 标题 2」样式排版章名，或改用 .txt / .md 上传")
    }
    return { chapters, via: "docx" }
  }
  try {
    // pdf 抽取通道按需动态导入：bidFiles 顶部静态依赖 docx，直接 import 会把重型库拉回标书路由壳静态图（R124 哨兵）
    const isPdf = lower.endsWith(".pdf")
    const text = isPdf ? await (await import("./bidFiles")).extractTenderFileText(file) : await file.text()
    const chapters = parseDraftPlainText(text ?? "")
    if (!chapters.length) {
      throw new Error("没有从文件中读到底稿正文（扫描版 PDF 无文字层），请改用可复制文本的版本")
    }
    return { chapters, via: isPdf ? ("pdf" as const) : ("text" as const) }
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "底稿读取失败，请改存为 .docx（带标题样式）或 .txt 后再上传", { cause: e })
  }
}
