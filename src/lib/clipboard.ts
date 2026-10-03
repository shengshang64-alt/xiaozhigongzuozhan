// R111 全站「复制文本」唯一入口（承接 R110 src/lib/download.ts 单一浏览器 API 封装主线）。
//
// 修复此前 10 处各写各的 navigator.clipboard.writeText 的两类真实缺陷：
// (1) 其中 2 处只写 .then(成功)、复制失败时静默无反馈；本入口统一在失败时给出可覆写的中文 Toast。
// (2) 所有站点都未防 navigator.clipboard 在非安全上下文/旧浏览器为 undefined 的情形——`.then` 形式下
//     navigator.clipboard.writeText 会同步抛 TypeError 且不被 .then 兜住而崩溃；本入口先探测能力，
//     缺失或抛错时回退隐藏 textarea + document.execCommand("copy")。
// 各站点成功/失败文案通过 successMessage/errorMessage 逐字保留，保持既有提示行为等价。
import { toast } from "sonner"

/** 复制结果反馈选项：成功/失败文案与成功回调（失败态不触发回调） */
export interface CopyToClipboardOptions {
  /** 成功提示文案；省略则成功后不弹 Toast（用于仅做视觉状态反馈的调用点） */
  successMessage?: string
  /** 失败提示文案；省略则用默认口径 */
  errorMessage?: string
  /** 复制成功后的副作用回调 */
  onSuccess?: () => void
}

const DEFAULT_ERROR_MESSAGE = "复制失败，请手动选择文本复制"

/**
 * 复制文本到剪贴板，返回是否成功。
 * 成功：可选弹 successMessage、触发 onSuccess；失败：弹 errorMessage（或默认）。
 */
export async function copyTextToClipboard(
  text: string,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const ok = await writeClipboardText(text)
  if (ok) {
    if (options.successMessage) toast.success(options.successMessage)
    options.onSuccess?.()
    return true
  }
  toast.error(options.errorMessage ?? DEFAULT_ERROR_MESSAGE)
  return false
}

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Clipboard API 被拒绝/抛错时继续走回退路径
  }
  try {
    if (typeof document === "undefined") return false
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-1000px"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch {
    return false
  }
}
