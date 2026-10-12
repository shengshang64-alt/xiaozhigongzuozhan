// ---------------------------------------------------------------------------
// R274 编制依据「标准版本时效体检」（易标 R-027 解析项质量补强 · 零 AI）
//
// 背景：parseBasisLines 用整串编号（含年份）对照 MEDICAL_STANDARDS 库，同编号才取库内
// 现行条目；当招标文件/正文引用了同一标准的【旧年份版本】（如 GB/T 22239-2008，而规范库
// 现行为 GB/T 22239-2019），编号整串不匹配 → 该条被当作「库外条目」原样并入合并清单，
// 悄悄注入正文生成的「编制依据」，用户无从知晓标准已被替代——交卷后被质疑引用废止版本，
// 是医疗信息化标书的常见失分点。
//
// 本模块以 MEDICAL_STANDARDS（37 条，编号均可公开核验、禁止编造）作为「现行版本」事实源，
// 对任意规范条目/自由文本做确定性比对：同编号（去空格大写、剥离尾随年份后的编号主干一致）
// 且引用年份 < 库内现行年份 → 判定「疑似引用了旧版」，给出建议现行编号。
//
// 边界（与全程「只报不拦」红线一致，宁可漏报不误伤）：
//  - 库外编号（规范库未收录）无法判时效 → 不报；
//  - 引用未带年份（如「GB/T 22239」）→ 不报；
//  - 引用年份 ≥ 库内年份 → 不报（库本身可能滞后，反向判定会误伤）；
//  纯函数、零依赖 AI/网络，仅读取 bidTypes 的规范库常量（只读，不改）。
// ---------------------------------------------------------------------------

import { MEDICAL_STANDARDS, type StandardItem } from "./bidTypes"

/** 编号拆解结果：base 为去空格大写、剥离尾随年份后的编号主干；year 为四位数年份（无则 null） */
export type StdCodeParts = { base: string; year: number | null }

/** 一条「疑似旧版」命中：引用条目 + 引用年份 + 库内现行编号/年份/名称 */
export type StaleStdRef = {
  item: StandardItem
  citedYear: number
  currentCode: string
  currentYear: number
  currentName: string
}

const NORM = (s: string): string => (s ?? "").toUpperCase().replace(/\s+/g, "")

/**
 * 拆分编号主干与尾随年份：先去空格转大写，再匹配结尾的「[-|—]?(19xx|20xx)」四位年份。
 * 「GB/T 22239-2019」→ { base: "GB/T22239", year: 2019 }
 * 「GB/T 25000.51-2016」→ { base: "GB/T25000.51", year: 2016 }（点分序号不误判为年份）
 * 「GB/T 22239」（无年份）→ { base: "GB/T22239", year: null }
 */
export function splitCodeYear(code: string): StdCodeParts {
  const c = NORM(code)
  const m = c.match(/^(.*?)[-\u2014]?((?:19|20)\d{2})$/)
  if (m && m[1]) return { base: m[1], year: Number(m[2]) }
  return { base: c, year: null }
}

/** 以规范库为事实源构建「编号主干 → 现行最高年份条目」映射；无年份/空编号条目跳过 */
export function buildCurrentVersionMap(
  curated: StandardItem[] = MEDICAL_STANDARDS,
): Map<string, { code: string; name: string; year: number }> {
  const map = new Map<string, { code: string; name: string; year: number }>()
  for (const it of curated) {
    if (!it.code) continue
    const { base, year } = splitCodeYear(it.code)
    if (!base || year == null) continue
    const prev = map.get(base)
    if (!prev || year > prev.year) map.set(base, { code: it.code, name: it.name, year })
  }
  return map
}

/**
 * 检出规范条目清单中的「疑似旧版」引用：同编号主干命中规范库、且引用年份早于现行年份。
 * 同一条主干+年份去重；库外/无年份/不早于现行的一律不报（防误伤）。
 */
export function detectStaleVersionRefs(
  items: StandardItem[],
  curated: StandardItem[] = MEDICAL_STANDARDS,
): StaleStdRef[] {
  const map = buildCurrentVersionMap(curated)
  const out: StaleStdRef[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (!it.code) continue
    const { base, year } = splitCodeYear(it.code)
    if (!base || year == null) continue
    const cur = map.get(base)
    if (!cur) continue
    if (year < cur.year) {
      const key = `${base}-${year}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ item: it, citedYear: year, currentCode: cur.code, currentYear: cur.year, currentName: cur.name })
    }
  }
  return out
}

/** 命中项的用户可见提示语（不暴露内部字段名；只提示核实、不断言一定废止） */
export function staleRefHint(r: StaleStdRef): string {
  const label = r.item.name?.trim() || r.item.code
  return `「${label}」引用的是 ${r.citedYear} 版，规范库现行为 ${r.currentCode}，请核实是否已被替代`
}

// ---------------------------------------------------------------------------
// R275 正文级旧版检测（零 AI）：在生成正文/整本标书中扫描标准编号模式，
// 与规范库现行版本比对后检出引用了旧版年份的命中。
// 填补 R274 挂账：用户未打开规范库补选对话框时，交卷体检兜底暴露旧版引用。
// ---------------------------------------------------------------------------

/** 正文中常见标准编号正则（覆盖 GB/T xxx-YYYY、WS xxx-YYYY、YY/T xxx-YYYY 等） */
const STD_CODE_TEXT_RE = /\b([A-Z]{2,6}(?:\/[A-Z]{1,4})?[ \t]+\d+(?:\.\d+)*[-\u2014](?:19\d{2}|20\d{2}))\b/gi

/**
 * 在任意文本中扫描标准编号模式，检出「引用年份 < 规范库现行年份」的疑似旧版。
 * 去重（同主干+年份只报一次），不要求大小写/空格精确匹配（归一化后比对）。
 */
export function scanStaleVersionInText(
  text: string,
  curated: StandardItem[] = MEDICAL_STANDARDS,
): StaleStdRef[] {
  if (!text) return []
  const map = buildCurrentVersionMap(curated)
  const seen = new Set<string>()
  const out: StaleStdRef[] = []
  let m: RegExpExecArray | null
  STD_CODE_TEXT_RE.lastIndex = 0
  while ((m = STD_CODE_TEXT_RE.exec(text)) !== null) {
    const raw = m[1].trim()
    const { base, year } = splitCodeYear(raw)
    if (!base || year == null) continue
    const cur = map.get(base)
    if (!cur) continue
    if (year < cur.year) {
      const key = `${base}-${year}`
      if (seen.has(key)) continue
      seen.add(key)
      const curItem = curated.find((s2) => s2.code === cur.code)
      out.push({
        item: {
          code: raw,
          name: curItem?.name ?? cur.name,
          category: curItem?.category ?? "推荐性国家标准",
        },
        citedYear: year,
        currentCode: cur.code,
        currentYear: cur.year,
        currentName: cur.name,
      })
    }
  }
  return out
}
