/**
 * 案例结构化可行性评估（DS-R02）
 *
 * 背景：`.nightrun/PRODUCT_BENCHMARK.md` 的差距 #8「案例结构化库」——评委「无支撑的声称不给分」，
 * 而本产品知识库把案例存成普通文档（kb_docs 7002 条），没有「案例名 / 合同额 / 年限 / 佐证页码」结构化字段，
 * 生成响应时无法自动带佐证。
 *
 * 本轮不新建数据模型（那属于跨模块大改造，一轮做不完且需用户确认）。
 * 本轮只做**只读评估**：用真实库算清「若要做，原料够不够、能抽到什么程度」，
 * 为后续是否投产提供数据依据。
 *
 * 纯函数 + 零 AI 费用，可独立验证。
 */

export type CaseCandidate = {
  id: string
  title: string
  /** 抽到的合同金额（万元），取文中第一处「N 万元」 */
  amountWan: number | null
  /** 抽到的年份（2020-2030 之间） */
  years: number[]
  /** 抽到的医院名（含「医院」的片段） */
  hospitals: string[]
}

export type CaseStructurabilityReport = {
  /** 知识库里标记为「项目案例」的文档数 */
  caseDocCount: number
  /** 其中能抽出至少一项结构化字段的文档数 */
  extractable: number
  /** 抽取率 0~1 */
  extractableRate: number
  /** 各字段的命中文档数 */
  fieldHits: { amount: number; year: number; hospital: number }
  /** 样例（最多 5 条） */
  samples: CaseCandidate[]
}

/** 从一段正文抽合同金额（万元）；优先「N 万元」，退回「N 元」换算 */
export function extractAmountWan(text: string): number | null {
  const t = String(text ?? "")
  const wan = /(\d+(?:\.\d+)?)\s*万元/.exec(t)
  if (wan) {
    const v = Number(wan[1])
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const yuan = /(\d{4,})\s*元(?!整|气)/.exec(t)
  if (yuan) {
    const v = Number(yuan[1]) / 10000
    return Number.isFinite(v) && v > 0 ? Number(v.toFixed(2)) : null
  }
  return null
}

/** 从正文抽年份（2020-2030），去重升序 */
export function extractYears(text: string): number[] {
  const out = new Set<number>()
  const re = /\b(20[23]\d)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text ?? ""))) !== null) {
    const y = Number(m[1])
    if (y >= 2020 && y <= 2030) out.add(y)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * 医院名抽取：排除通用表述，只保留疑似真实机构名。
 *
 * 2026-10-28 实测踩到两个坑，都在这里修掉：
 *   ① 通用表述误报：「包含医院」「互联网医院」「安徽省评级过级医院」「三甲综合医院」——
 *      朴素正则会把这些当成机构名，进结构化字段后生成标书会写出「服务过包含医院」这种废句。
 *   ② **贪婪吞并前文**：`/([\u4e00-\u9fa5]{2,12}医院)/` 会把「服务过」吞进来变成
 *      「服务过蚌埠医学院第一附属医院」、把标题前缀吞成「某医院智慧医院」。
 *      修法：从左边界起锚，名字首字不许是常见动词/介词，且遇到「医院」后再出现
 *      「智慧/信息/项目/建设」等词说明已跨进下一个词组，应截断。
 */
const HOSPITAL_STOPWORDS = [
  "包含医院",
  "互联网医院",
  "综合医院",
  "专科医院",
  "评级过级医院",
  "及以上医院",
  "过级医院",
  "三甲医院",
  "三乙医院",
  "二甲医院",
  "各级医院",
  "各家医院",
  "该医院",
  "本医院",
  "兄弟医院",
  "其他医院",
  "相关医院",
  "附近医院",
  "定点医院",
  "公立医院",
  "民营医院",
  "目标医院",
  "客户医院",
  "新建医院",
  "中心医院以上",
]

/** 医院名前常见的动词/介词/助词，出现即说明是句子成分而非机构名起点 */
const HOSPITAL_BAD_PREFIX = /^(?:服务过|服务于|服务|承建|建设|覆盖|包含|包括|涉及|面向|针对|位于|坐落|详见|参见|其中|以及|和|与|及|在|为|是|有|某|各|该|本)/

/** 医院名后紧跟这些词说明已跨词，需截断（如「某医院智慧医院」→ 取「某医院」） */
const HOSPITAL_TRAIL_STOP = /(?:智慧|信息|数字|项目|建设|工程|平台|系统|集成|方案|业务)/

/** 医院名抽取：排除通用表述与贪婪吞并，只保留疑似真实机构名 */
export function extractHospitals(text: string): string[] {
  const out = new Set<string>()
  const re = /([\u4e00-\u9fa5]{2,12}医院)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text ?? ""))) !== null) {
    let name = m[1]
    if (name.length < 4 || name.length > 14) continue
    // ① 通用表述剔除（含任一黑名单词即跳过）
    if (HOSPITAL_STOPWORDS.some((w) => name.includes(w))) continue
    // ② 左边界：去掉句首动词/介词（「服务过蚌埠…」→「蚌埠…」）
    name = name.replace(HOSPITAL_BAD_PREFIX, "")
    if (name.length < 4) continue
    // ③ 右边界：遇到「智慧/信息/项目」等跨词标志则截断（「某医院智慧医院」→ 取首个「医院」为止）
    const trail = name.search(HOSPITAL_TRAIL_STOP)
    if (trail > 0) {
      const head = name.slice(0, trail)
      const firstHospital = head.indexOf("医院")
      name = firstHospital >= 0 ? head.slice(0, firstHospital + 2) : ""
    }
    if (name.length < 4 || name.length > 14) continue
    // ④ 以「及以上/以下/等/的」收尾的不是机构名
    if (/(?:及以上|及以下|以下|以上|等|的)$/.test(name)) continue
    // ⑤ 去掉左边界后仍需复查黑名单
    if (HOSPITAL_STOPWORDS.some((w) => name.includes(w))) continue
    out.add(name)
    if (out.size >= 3) break
  }
  return [...out]
}

/** 单条文档的可结构化评估 */
export function assessCaseDoc(doc: { id: string; title: string; content: string }): CaseCandidate {
  const text = `${doc.title ?? ""}\n${doc.content ?? ""}`
  return {
    id: doc.id,
    title: String(doc.title ?? "").slice(0, 40),
    amountWan: extractAmountWan(text),
    years: extractYears(text),
    hospitals: extractHospitals(text),
  }
}

/**
 * 汇总一批案例文档的可结构化程度（纯函数）。
 * 「可抽取」定义：金额 / 年份 / 医院名 至少命中一项。
 */
export function summarizeCaseStructurability(docs: { id: string; title: string; content: string }[]): CaseStructurabilityReport {
  const list = Array.isArray(docs) ? docs : []
  const fieldHits = { amount: 0, year: 0, hospital: 0 }
  let extractable = 0
  const samples: CaseCandidate[] = []
  for (const d of list) {
    const a = assessCaseDoc(d)
    const hasAmount = a.amountWan !== null
    const hasYear = a.years.length > 0
    const hasHospital = a.hospitals.length > 0
    if (hasAmount) fieldHits.amount++
    if (hasYear) fieldHits.year++
    if (hasHospital) fieldHits.hospital++
    if (hasAmount || hasYear || hasHospital) {
      extractable++
      if (samples.length < 5) samples.push(a)
    }
  }
  return {
    caseDocCount: list.length,
    extractable,
    extractableRate: list.length ? Number((extractable / list.length).toFixed(4)) : 0,
    fieldHits,
    samples,
  }
}
