// P2-8（2026-10-25）：上传历史（localStorage，按账号隔离）——弹窗关闭后成败仍可回溯。
// 条目以「一次上传动作中的单个文件」为粒度：文件名 / 入库篇数 / 失败原因 / 目标目录 / 时间。
// 上限 50 条 FIFO；读写全程 try/catch 静默降级（隐私模式/配额满不影响上传主流程）。

export interface KbUploadHistoryEntry {
  /** 上传时间（ISO） */
  at: string
  fileName: string
  /** 该文件成功入库的文档篇数（zip/文件夹内多文档时 >1） */
  okCount: number
  /** 解析/入库失败原因；成功为空 */
  failReason?: string
  targetFolder?: string
}

const HISTORY_KEY_PREFIX = "kb_upload_history_"
const HISTORY_MAX = 50

function historyKey(userId: string | null): string {
  return HISTORY_KEY_PREFIX + (userId && userId.trim() ? userId.trim() : "anonymous")
}

/** 读取上传历史（新→旧）；无记录/脏值返回 [] */
export function readKbUploadHistory(userId: string | null): KbUploadHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is KbUploadHistoryEntry =>
        !!e && typeof e === "object" && typeof (e as KbUploadHistoryEntry).at === "string" && typeof (e as KbUploadHistoryEntry).fileName === "string",
    )
  } catch {
    return []
  }
}

/** 追加一条上传记录（置顶，超 50 条丢最旧）；未登录也记录（anonymous 桶）便于回溯 */
export function pushKbUploadHistory(userId: string | null, entry: Omit<KbUploadHistoryEntry, "at">): void {
  try {
    const items = readKbUploadHistory(userId)
    items.unshift({ ...entry, at: new Date().toISOString() })
    localStorage.setItem(historyKey(userId), JSON.stringify(items.slice(0, HISTORY_MAX)))
  } catch {
    /* 配额满/隐私模式：放弃本次记录 */
  }
}

/** 清空上传历史 */
export function clearKbUploadHistory(userId: string | null): void {
  try {
    localStorage.removeItem(historyKey(userId))
  } catch {
    /* ignore */
  }
}
