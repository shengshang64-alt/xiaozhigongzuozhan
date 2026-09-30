// R88/F18：模型模态识别——「设为默认（生成模型）」只应给文本模型；
// 平台/个人配置的模型条目只有 {id, enabled}，无 modality 字段，这里按模型名启发式判定。
// 判定优先级：embedding > image > video > tts > stt > text（命中越具体越靠前，text 兜底）。

export type ModelModality = "text" | "embedding" | "image" | "video" | "tts" | "stt"

const MODALITY_LABELS: Record<ModelModality, string> = {
  text: "文本",
  embedding: "向量",
  image: "图像",
  video: "视频",
  tts: "语音合成",
  stt: "语音识别",
}

/** 模糊命中的单字母词（tts/asr 等）必须处于名称边界，防止误伤含子串的文本模型 */
function tokenHit(modelId: string, token: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`, "i").test(modelId)
}

export function detectModelModality(modelId: string): ModelModality {
  const id = (modelId ?? "").toLowerCase()
  if (/embedding|embed|bge-|m3e-|rerank/.test(id)) return "embedding"
  if (/image|dall-e|dalle|flux|stable-diffusion|sdxl|midjourney|seedream|jimeng|即梦|文生图|图生图|kolors|imagen/.test(id)) return "image"
  if (/video|sora|kling|可灵|veo(?!l-)|runway|hailuo-video|wan2|cogvideo|pika/.test(id)) return "video"
  if (/speech-synthesis|voice-design|voice-generation|cosyvoice|fish-speech|配音|语音合成/.test(id)) return "tts"
  if (tokenHit(id, "tts")) return "tts"
  if (/whisper|transcribe|speech-recognition|语音识别|转写/.test(id)) return "stt"
  if (tokenHit(id, "asr")) return "stt"
  return "text"
}

export function modalityLabel(modality: ModelModality): string {
  return MODALITY_LABELS[modality] ?? modality
}

/** 仅文本（生成）模型可作为系统默认生成模型 */
export function isTextGenerationModel(modelId: string): boolean {
  return detectModelModality(modelId) === "text"
}

/** 徽章配色：文本模态返回空串（不渲染徽章，避免噪声） */
export function modalityBadgeClass(modality: ModelModality): string {
  switch (modality) {
    case "text":
      return ""
    case "embedding":
      return "border-border bg-secondary text-muted-foreground"
    case "image":
      return "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
    case "video":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
    case "tts":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "stt":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  }
}
