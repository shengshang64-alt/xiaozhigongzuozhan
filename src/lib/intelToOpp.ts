// 轮次 F 轨 2：情报 → 商机一键转化的本地抽取与深链协议
// 深链协议（customer-management 消费）：
//   /customer-management?new_opp=1
//     &prefill_hospital=<医院名，可空>      —— 用于匹配所属客户（hospital_name 模糊互含），匹配不到再按 region 兜底
//     &prefill_name=<商机名称>              —— 医院名 + 标题前 20 字，抽不到医院名则纯标题前 20 字
//     &prefill_amount=<元，纯数字，可空>    —— 从摘要/标题的「N 万元 / N 亿元」换算
//     &prefill_region=<地区，可空>          —— 客户匹配兜底
//     &prefill_notes=<备注>                 —— 来源标题 + 链接 + 地区

export type IntelToOppSource = {
  title: string
  summary?: string
  region?: string
  url?: string
}

const HOSPITAL_RE =
  /[一-龥A-Za-z0-9（）()·]{2,18}?(?:医院|卫生院|医疗中心|医学中心|妇幼保健院|疾控中心|卫生服务中心)/g

// T2.6：金额数字支持千分位（「1,000万元」→ 1000 万）；识别区间（「300-500万元」）——
// 保守取下限，原文区间由 buildIntelToOppQuery 写进 prefill_notes 备查
const AMOUNT_NUM_SRC = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`
const AMOUNT_RE = new RegExp(
  `(${AMOUNT_NUM_SRC})(?:\\s*[-~～—至到]\\s*(${AMOUNT_NUM_SRC}))?\\s*(万元|亿元)`,
)

type AmountExtract = { yuan: string; rangeText: string }

function parseAmountNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""))
}

/** 抽「N 万元 / N 亿元」（含千分位与区间）并换算成元；区间取下限保守值，rangeText 保留原文 */
function extractAmountDetail(...texts: (string | null | undefined)[]): AmountExtract | null {
  for (const text of texts) {
    if (!text) continue
    const m = text.match(AMOUNT_RE)
    if (!m) continue
    const low = parseAmountNumber(m[1])
    const high = m[2] ? parseAmountNumber(m[2]) : NaN
    const unitFactor = m[3] === "亿元" ? 100_000_000 : 10_000
    let chosen = low
    let rangeText = ""
    if (Number.isFinite(high) && high > 0) {
      chosen = Math.min(low, high)
      rangeText = `${m[1]}-${m[2]}${m[3]}`
    }
    if (!Number.isFinite(chosen) || chosen <= 0) continue
    return { yuan: String(Math.round(chosen * unitFactor)), rangeText }
  }
  return null
}

/** 从摘要/标题抽「N 万元 / N 亿元」并换算成元（字符串）；抽不到返回空串 */
export function extractAmountYuan(...texts: (string | null | undefined)[]): string {
  return extractAmountDetail(...texts)?.yuan ?? ""
}

/** 从标题/摘要里抽医疗机构名短语；抽不到返回空串（调用方用标题前 20 字兜底） */
export function extractHospitalName(...texts: (string | null | undefined)[]): string {
  for (const text of texts) {
    if (!text) continue
    const matches = text.match(HOSPITAL_RE)
    if (matches && matches.length > 0) {
      // 取最长匹配，避免「市第一人民医院」被截成「医院」前缀碎片
      return matches.reduce((longest, m) => (m.length > longest.length ? m : longest), matches[0])
    }
  }
  return ""
}

/** 构造「转为商机」深链 query（不含路径） */
export function buildIntelToOppQuery(item: IntelToOppSource): string {
  const title = (item.title ?? "").trim()
  const hospital = extractHospitalName(title, item.summary)
  const shortTitle = title.slice(0, 20)
  const oppName = hospital && !shortTitle.includes(hospital) ? `${hospital} · ${shortTitle}` : shortTitle
  const amountDetail = extractAmountDetail(item.summary, title)
  const notesLines = [
    `来源情报：${title}`,
    item.url ? `链接：${item.url}` : "",
    item.region ? `地区：${item.region}` : "",
    // T2.6：区间金额取下限入 prefill_amount，原文区间写进备注备查
    amountDetail?.rangeText ? `原文金额区间：${amountDetail.rangeText}` : "",
  ].filter(Boolean)
  const qs = new URLSearchParams({ new_opp: "1", prefill_name: oppName, prefill_notes: notesLines.join("\n") })
  if (hospital) qs.set("prefill_hospital", hospital)
  if (amountDetail?.yuan) qs.set("prefill_amount", amountDetail.yuan)
  if (item.region) qs.set("prefill_region", item.region)
  return qs.toString()
}
