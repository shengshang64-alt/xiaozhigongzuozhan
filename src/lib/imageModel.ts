/**
 * R56：生图模型的**单一默认设置**（用户的"帮我做个默认设置"）。
 *
 * 现状（改造前）：生图模型在两处硬编码——标书侧 `prompts/aiImage.ts` 的 `AI_IMAGE_MODEL = "nano-banana-pro"`，
 * PPT 侧只在注释里写着同一个名字（实际无调用点）。改一处忘一处，也没法按账号切换。
 *
 * 本模块把它收敛成一条链：**账号级可覆盖 → 全局默认**，并在 `IMAGE_MODEL_CANDIDATES` 里列出候选与
 * 各自走哪条通道，供设置面板与后续切换使用。
 *
 * 通道说明（2026-10-15 实测）：
 * - 现有生图走 **RunningHub**（`lib/aigc.ts`），需要 RH 登录与余额；
 * - 用户自己的 `model_configs` 里另有三个真·生图模型（`agnes-image-2.1-flash` / `2.0-flash` / `2.5-flash`），
 *   但**接口形态未确认**：实测同一把 key 在 `GET /models` 有效、在 `POST /images/generations` 被判
 *   「Invalid token」——需要确认图像权限是否单独开通后才能切过去（切换时只需改本模块的适配层）。
 */
export type ImageModelChannel = "runninghub" | "agnes"

export type ImageModelOption = {
  /** 传给通道的模型名 */
  model: string
  /** 走哪条通道（决定用 aigc.ts 还是 model_configs 网关） */
  channel: ImageModelChannel
  /** 面板展示名 */
  label: string
  /** 备注（能力/状态） */
  note?: string
}

/** 全局默认（保持既有行为：RunningHub 的 nano-banana-pro） */
export const DEFAULT_IMAGE_MODEL = "nano-banana-pro"
export const DEFAULT_IMAGE_CHANNEL: ImageModelChannel = "runninghub"

/**
 * 候选生图模型。agnes 三个标注为「待开通」——接口形态确认后把默认切过去即可（适配层在本模块）。
 */
export const IMAGE_MODEL_CANDIDATES: ImageModelOption[] = [
  { model: "nano-banana-pro", channel: "runninghub", label: "nano-banana-pro（RunningHub）", note: "现用默认；需 RH 登录与余额" },
  { model: "agnes-image-2.1-flash", channel: "agnes", label: "agnes-image-2.1-flash（自带配置）", note: "待确认图像权限（实测 401 Invalid token）" },
  { model: "agnes-image-2.5-flash", channel: "agnes", label: "agnes-image-2.5-flash（自带配置）", note: "待确认图像权限" },
  { model: "agnes-image-2.0-flash", channel: "agnes", label: "agnes-image-2.0-flash（自带配置）", note: "待确认图像权限" },
]

const KEY_PREFIX = "xz_image_model:"

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

function keyFor(userId: string | null): string {
  return `${KEY_PREFIX}${(userId ?? "").trim() || "anon"}`
}

/** 账号级覆盖（未设置返回 null）；只接受候选清单里的模型名，防脏值传进通道 */
export function readImageModel(userId: string | null): string | null {
  const st = safeStorage()
  if (!st) return null
  try {
    const raw = (st.getItem(keyFor(userId)) ?? "").trim()
    if (!raw) return null
    return IMAGE_MODEL_CANDIDATES.some((c) => c.model === raw) ? raw : null
  } catch {
    return null
  }
}

export function saveImageModel(userId: string | null, model: string): void {
  const clean = (model ?? "").trim()
  if (!IMAGE_MODEL_CANDIDATES.some((c) => c.model === clean)) return
  const st = safeStorage()
  if (!st) return
  try {
    st.setItem(keyFor(userId), clean)
  } catch {
    /* 隐私模式等写入失败：静默，读侧会回退默认 */
  }
}

export function clearImageModel(userId: string | null): void {
  const st = safeStorage()
  if (!st) return
  try {
    st.removeItem(keyFor(userId))
  } catch {
    /* 同上 */
  }
}

/** 生图模型解析（唯一入口）：账号覆盖 → 全局默认 */
export function resolveImageModel(userId: string | null): { model: string; channel: ImageModelChannel } {
  const picked = readImageModel(userId)
  const model = picked ?? DEFAULT_IMAGE_MODEL
  const opt = IMAGE_MODEL_CANDIDATES.find((c) => c.model === model)
  return { model, channel: opt?.channel ?? DEFAULT_IMAGE_CHANNEL }
}
