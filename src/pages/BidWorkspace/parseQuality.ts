// R-029（R255）招标文件解析质量评估——扫描件/图片型文档检测。
// 纯函数、零模型、零 DOM、不依赖网关与提示词，可脱离浏览器单测；pdfjs/mammoth 的读取在 bidFiles.ts，
// 本模块只负责「文本抽取出来之后」的质量判级：文字层几乎缺失 → 疑似扫描版；偏少 → 可能解析不全。
import type { TenderParseQuality } from "./bidTypes"

export type TenderQualityAssessment = {
  level: TenderParseQuality
  reason: string
  hint: string
}

const SCAN_HINT =
  "疑似扫描版/图片型文档：提取到的文字极少（文字层可能缺失），解析结果会严重缺失。" +
  "请先用 OCR 转成可复制文字后重新导入，或改用「粘贴文本」方式导入招标文件内容。"
const LOW_HINT =
  "提取到的文字偏少，可能存在解析不全（表格/图片/加密部分丢失）。" +
  "建议对照招标原件核对，必要时改用「粘贴文本」方式重新导入。"

// 判据阈值（集中此处，便于按经验调整口径）
const MIN_CONTENT_CHARS = 30 // 低于此视为几乎没提取到文字 → suspect_scanned
const LOW_CONTENT_CHARS = 200 // 偏少 → low（可能解析不全）
const SCAN_MIN_BYTES = 200_000 // 仅对「应有的大文件」启用密度判据，避免误判小段粘贴文本
const SCAN_DENSITY = 0.02 // 非空字符数 / 文件字节数 低于此 → 文字层几乎为空（图片型/扫描版）

const countContentChars = (s: string): number => (s ?? "").replace(/\s+/g, "").length

/** 评估招标文件抽取文本的解析质量；bytes 为原始文件字节数（导入时传 file.size，解析时可不传仅按文本口径判级） */
export function assessTenderParseQuality(text: string, opts?: { bytes?: number }): TenderQualityAssessment {
  const len = countContentChars(text)
  if (len === 0) return { level: "suspect_scanned", reason: "未提取到任何文字", hint: SCAN_HINT }
  if (len < MIN_CONTENT_CHARS) {
    return { level: "suspect_scanned", reason: `仅提取到 ${len} 个字符，远低于正常招标文件`, hint: SCAN_HINT }
  }
  const bytes = opts?.bytes ?? 0
  if (bytes >= SCAN_MIN_BYTES && len / bytes < SCAN_DENSITY) {
    return {
      level: "suspect_scanned",
      reason: `文件约 ${Math.round(bytes / 1024)}KB 却仅提取到 ${len} 个字符，疑似图片型/扫描版（文字层缺失）`,
      hint: SCAN_HINT,
    }
  }
  if (len < LOW_CONTENT_CHARS) {
    return { level: "low", reason: `提取到的文字偏少（${len} 个字符）`, hint: LOW_HINT }
  }
  return { level: "ok", reason: "", hint: "" }
}
