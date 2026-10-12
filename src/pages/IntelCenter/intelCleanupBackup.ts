// ---------------------------------------------------------------------------
// R-033 数据安全：不相关情报「清理不相关」的可离线留存备份（清理前触发）
//
// 背景：pb_hook POST /api/intel/cleanup-irrelevant 的删除分支用 $app.delete 批量
// 物理删除采集条目，命中即不可恢复——与 AGENTS.md §7「任何删除先移入回收，禁止物理
// 删除」及标书项目侧既有「软删 + 回收站」范式相悖。本模块提供删除前的纯逻辑：
//   1) 把服务端回传的全量命中记录序列化为可离线查阅 / 再导入的 JSON 文本
//   2) 生成人类可读的备份文件名
//   3) 删除前安全闸——只有备份成功且条数与预览命中数一致才放行删除
// 全部为纯函数（零网络、零 DOM、零时间源），Node 环境可直接单测；调用方把时间戳传入。
// ---------------------------------------------------------------------------

/** 备份条目结构：字段与 pb_hook 序列化及 IntelItemRow 对齐（snake_case）。 */
export interface CleanupBackupItem {
  id: string
  title: string
  url: string
  source_name: string
  content_snippet: string
  summary: string
  tags: string[]
  item_type: string
  region: string
  added_by: string
  owner_id: string
  visibility: string
  published_at: string
  created: string
  updated: string
}

export interface CleanupBackupMeta {
  /** 本地时间戳 ISO，由调用方注入以保持本模块纯函数可测 */
  generatedAt: string
  /** 备份口径说明，写进文件头供人工查阅 */
  reason: string
}

/** 备份文件负载：版本 + 元信息 + 全量记录；count 恒等于 items 长度。 */
export interface CleanupBackupPayload {
  kind: "intel-irrelevant-cleanup-backup"
  version: 1
  generatedAt: string
  reason: string
  count: number
  items: CleanupBackupItem[]
}

/** 备份文件名：情报清理备份-YYYYMMDD_HHMMSS.json。 */
export function cleanupBackupFileName(stamp: string): string {
  return "情报清理备份-" + stamp + ".json"
}

/** 本地时间戳 YYYYMMDD_HHMMSS（导出文件名用；默认取当前时刻，测试传入固定 Date）。 */
export function formatBackupStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 序列化备份为 JSON 文本（两空格缩进，中文原样不转义）。
 * 非数组入参按空集处理，count 始终以实际条数计，保证 round-trip 无损。
 */
export function serializeCleanupBackup(
  items: CleanupBackupItem[],
  meta: CleanupBackupMeta,
): string {
  const list = Array.isArray(items) ? items : []
  const payload: CleanupBackupPayload = {
    kind: "intel-irrelevant-cleanup-backup",
    version: 1,
    generatedAt: meta.generatedAt,
    reason: meta.reason,
    count: list.length,
    items: list,
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * 删除前安全闸：仅当备份成功取得且条数与预览命中数一致时，才放行物理删除。
 * 数量不一致=服务端命中集与备份集漂移，宁可拒绝删除也不删掉没备份到的条目。
 */
export function canProceedToDelete(args: {
  backupOk: boolean
  backupCount: number
  expectedCount: number
}): { proceed: boolean; reason: string } {
  if (!args.backupOk) return { proceed: false, reason: "未取得备份" }
  if (args.expectedCount <= 0) return { proceed: false, reason: "无可清理条目" }
  if (args.backupCount !== args.expectedCount) {
    return {
      proceed: false,
      reason: "备份 " + args.backupCount + " 条与命中 " + args.expectedCount + " 条不一致",
    }
  }
  return { proceed: true, reason: "" }
}
