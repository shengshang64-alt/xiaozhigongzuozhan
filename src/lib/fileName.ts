/**
 * R116 全站导出/下载文件名的非法字符清洗单一来源。
 *
 * 此前 3 处各抄一遍同一条清洗规则（intelExports.safeExportFileName、
 * deckExports.safeFileName、quoteExports.safeFileName）：正则 /[\\/:*?"<>|]/g
 * 命中即替换为下划线，再截断至 60 字符。三者仅差"空名兜底串"与"是否拼接扩展名"，
 * 核心完全一致。收敛到本模块后，各调用点保留原本地函数名薄委托，行为逐字节等价
 * （含 60 字符上限、空名兜底、扩展名拼接方式），仅删除重复的正则与截断。
 */

// Windows / Linux / macOS 跨平台文件名非法字符集。
const UNSAFE_CHARS_RE = /[\\/:*?"<>|]/g

/**
 * 清洗文件名基底：非法字符→下划线，截断至 60 字符。
 * name 为空串（falsy）时用 emptyBase 兜底；默认空兜底保持"空进空出"。
 */
export function sanitizeFileBase(name: string, emptyBase = ""): string {
  return (name || emptyBase).replace(UNSAFE_CHARS_RE, "_").slice(0, 60)
}

/** 清洗基底并拼接扩展名，返回 `${base}.${ext}`（ext 不含前导点）。 */
export function buildSafeFileName(name: string, ext: string, emptyBase = ""): string {
  return `${sanitizeFileBase(name, emptyBase)}.${ext}`
}
