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

/**
 * 按公司《投标文件编写规范》生成「日期-标题-文档类型-V版本号.ext」形式的文件名。
 *
 * 规范原文要求文件名含**日期、文档标题、版本号**三要素，
 * 形如 `2026.09.17-某医院投标文件-V2.1.docx`（校验见 bidWritingRules.checkFileName）。
 *
 * 为什么版本号用导出时刻而不是人工版本号：项目/方案表上都没有版本字段，
 * 硬造一个「V1.0」是假的；用 `V<年月日>.<时分>` 至少诚实——多次导出必得不同版本号，
 * 用户能按文件名排序分出哪份最新。要人工版本号，得先在数据模型上加字段。
 *
 * 2026-10-26：从 bidFiles.buildExportFileName 下沉到这里，让**投标文件与方案**共用一套口径。
 * 下沉前方案导出还是 `${solution_name}.docx`（连日期都没有），同一个毛病犯在两个模块。
 *
 * @param name 项目名 / 方案名（经 sanitizeFileBase 清洗非法字符、控制字符、保留设备名）
 * @param docTitle 文档类型，如「投标文件」「技术偏离表」「方案」
 * @param now 导出时刻（测试可注入）
 * @param ext 扩展名，不含前导点
 */
export function buildVersionedFileName(name: string, docTitle: string, now: Date = new Date(), ext = "docx"): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`
  const version = `V${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.${pad(now.getHours())}${pad(now.getMinutes())}`
  // 日期与版本号都是纯数字+点，天然安全；只有「名称-文档类型」需要清洗
  const safeName = sanitizeFileBase(String(name ?? "").trim())
  const safeTitle = sanitizeFileBase(String(docTitle ?? "").trim(), "文档")
  const base = safeName ? `${safeName}-${safeTitle}` : safeTitle
  return `${date}-${base}-${version}.${ext}`
}
