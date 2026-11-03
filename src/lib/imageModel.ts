/**
 * R56：生图模型的候选清单与「账号级覆盖」（用户的"默认设置"）。
 *
 * 2026-10-15 变更：RunningHub 生图链已整体下线（`lib/aigc.ts` 删除了 callAigcAndPoll / previewAigcPrice
 * 等全部生图调用，标书侧与 PPT 侧的生图入口一并移除）。因此本模块**不再有可用的全局默认模型**：
 * 未配置时 resolveImageModel 返回 null 表示"未配置"，调用方必须显式处理，不允许再回落到
 * nano-banana-pro 之类的 RunningHub 模型。
 *
 * 候选只剩用户自己 `model_configs` 里的三个 agnes 图像模型，但**接口形态未确认**：实测同一把 key 在
 * `GET /models` 有效、在 `POST /images/generations` 被判「Invalid token」——确认图像权限开通后
 * 才可接入（接入时只需改本模块的适配层并给出默认值）。
 */
export type ImageModelChannel = "agnes"

export type ImageModelOption = {
  /** 传给通道的模型名 */
  model: string
  /** 走哪条通道（决定用 model_configs 网关） */
  channel: ImageModelChannel
  /** 面板展示名 */
  label: string
  /** 备注（能力/状态） */
  note?: string
}

/**
 * 候选生图模型（全部走用户自带配置的 agnes 通道）。
 * 三个都标注「待确认」——图像权限确认前不设默认，resolveImageModel 一律返回 null。
 */
export const IMAGE_MODEL_CANDIDATES: ImageModelOption[] = [
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
    /* 隐私模式等写入失败：静默，读侧会回退"未配置" */
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

/**
 * 生图模型解析（唯一入口）：账号覆盖 → **没有全局默认**。
 * 返回 null = 未配置（RunningHub 生图链已下线，不再回落到任何模型）；通道由候选清单决定。
 */
export function resolveImageModel(userId: string | null): { model: string; channel: ImageModelChannel } | null {
  const picked = readImageModel(userId)
  if (!picked) return null
  const opt = IMAGE_MODEL_CANDIDATES.find((c) => c.model === picked)
  if (!opt) return null
  return { model: opt.model, channel: opt.channel }
}
