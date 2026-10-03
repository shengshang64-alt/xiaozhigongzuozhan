// ---------------------------------------------------------------------------
// T17（2026-09-29）AI 位图生成（易标 illustration 管线 AI 分支移植）：
//  - 生图 prompt 由编排元数据（图题/图注/风格/画面场景）+ 所在小节正文摘录构建；
//  - 铁律移植易标 buildAiImagePrompt：围绕图题组织画面、不得编造正文没有的对象、少文字；
//  - 风格两档移植 normalizeImagePrompt：engineering_diagram=工程图示 / realistic_photo=实景照片；
//  - 生成走 web 现成 aigc 通道（RunningHub，PptQuote 同款 nano-banana-pro），成功后 persistMediaUrl
//    落 PocketBase 再回填 FigureSpec {type:"image", url}——外链时效由 PB 落地兜底。
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { AiImageStyle } from "../bidTypes"

export const PROMPT_VERSION = 1

/** 风格提示语（对齐易标 normalizeImagePrompt 两档口径） */
export function aiImageStyleHint(style: AiImageStyle): string {
  return style === "realistic_photo" ? "专业实景照片风格" : "专业工程图示风格（扁平插画/示意图，克制配色）"
}

/**
 * AI 位图 prompt：图题/图注/场景来自编排，正文摘录给画面兜底素材（防编造正文没有的对象）。
 * 输出给文生图模型的单段提示词（含水印/文字规避与横构图约束）。
 */
export function buildAiImagePrompt(input: {
  title: string
  caption?: string
  scene?: string
  style: AiImageStyle
  sectionText?: string
}): string {
  const scene = (input.scene ?? "").trim()
  const caption = (input.caption ?? "").trim()
  const excerpt = clipText((input.sectionText ?? "").replace(/\s+/g, " ").trim(), 300)
  const lines = [
    `为投标文件生成一张「${input.title}」配图，${aiImageStyleHint(input.style)}。`,
    scene ? `画面主题：${scene}。` : "",
    caption ? `画面须能支撑图注所述内容：${caption}。` : "",
    excerpt ? `画面素材以本节正文为准：${excerpt}` : "",
    "铁律：只呈现上述主题明确涉及的场景与对象，禁止编造正文/主题里没有的设备、建筑、人物或文字；画面中尽量不出现文字、数字与水印；构图专业克制、横构图 16:9，色调干净，适合正式商务文档。",
  ]
  return lines.filter(Boolean).join("")
}

/** 生图模型与页面标记（与 PptQuote 同款 nano-banana-pro 文生图通道） */
export const AI_IMAGE_MODEL = "nano-banana-pro"
export const AI_IMAGE_PAGE = "bid-figure"
