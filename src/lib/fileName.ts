/**
 * R116 全站导出/下载文件名的非法字符清洗单一来源。
 *
 * 此前 3 处各抄一遍同一条清洗规则（intelExports.safeExportFileName、
 * deckExports.safeFileName、quoteExports.safeFileName）：正则 /[\\/:*?"<>|]/g
 * 命中即替换为下划线，再截断至 60 字符。三者仅差"空名兜底串"与"是否拼接扩展名"，
 * 核心完全一致。收敛到本模块后，各调用点保留原本地函数名薄委托，行为逐字节等价
 * （含 60 字符上限、空名兜底、扩展名拼接方式），仅删除重复的正则与截断。
 */

// Windows / Linux / macOS 跨平台文件名非法字符集 + ASCII 控制字符（含制表/换行，
// 防粘贴进标题的裸控制字符进入 Content-Disposition 头致下载异常）。
// eslint-disable-next-line no-control-regex -- 文件名基底须剔除裸控制字符（标题常粘贴带入制表/换行/NUL），此为清洗而非匹配的正当场景
const UNSAFE_CHARS_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
// Windows 保留设备名（大小写不敏感，可带扩展名）：CON/PRN/AUX/NUL/COM1-9/LPT1-9。
// 这类基底即便字符合法，Windows 也拒绝建名 → 导出/下载静默失败，故加前导下划线中和。
const RESERVED_BASE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * 清洗文件名基底：非法字符/控制字符→下划线，去除 Windows 会静默剥离的结尾点与空格，
 * 中和保留设备名，再截断至 60 字符。name 为空串（falsy）时用 emptyBase 兜底（保持"空进空出"）。
 * 对常规名与 R116 收敛前的三处旧实现逐字节等价；仅在旧实现本就产出坏名字的保留设备名 /
 * 控制字符 / 结尾点空格场景额外加固——这些正是 Windows 下载失败的成因。
 */
export function sanitizeFileBase(name: string, emptyBase = ""): string {
  let s = (name || emptyBase).replace(UNSAFE_CHARS_RE, "_").replace(/[.\s]+$/, "")
  if (RESERVED_BASE_RE.test(s)) s = "_" + s
  return s.slice(0, 60)
}

/** 清洗基底并拼接扩展名，返回 `${base}.${ext}`（ext 不含前导点）。 */
export function buildSafeFileName(name: string, ext: string, emptyBase = ""): string {
  return `${sanitizeFileBase(name, emptyBase)}.${ext}`
}
