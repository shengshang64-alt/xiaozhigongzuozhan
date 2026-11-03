// src/lib/piiRedact.ts
// 确定性 PII 逐字段识别与脱敏（R186）。
// 背景：AGENTS.md #7「医院资料敏感…AI 调用仅发送必要片段」。kbPolicy 的 sanitized_summary
// 此前只做文档级「只给摘要不给原文」，但摘要 / 标题 / 关键词本身可能内嵌联系人手机号、
// 法定代表人身份证、统一社会信用代码、银行账号、邮箱、座机等 PII，仍会逐字发往第三方云。
// 本模块提供零依赖、纯正则的识别 + 掩码，供敏感档进 AI 上下文前二次脱敏。
// 只处理高置信度、低误伤格式（宁缺勿滥）：纯数字串必须成串（≥11 位），带分隔符的座机需连字符。
// 掩码口径：保留可辨识头尾、隐藏身份中段——手机 3/4、身份证18 6/4、身份证15 6/3、
// 银行卡 4/4、统一社会信用代码 2/4、邮箱 首字母+完整域名、座机 区号+尾 2。

export type PiiKind =
  | "phone"
  | "idcard"
  | "uscc"
  | "bankcard"
  | "landline"
  | "email"

export interface PiiHit {
  kind: PiiKind
  raw: string
  masked: string
  start: number
  end: number
}

function maskKeep(s: string, head: number, tail: number): string {
  if (s.length <= head + tail) return "*".repeat(s.length)
  return s.slice(0, head) + "*".repeat(s.length - head - tail) + s.slice(s.length - tail)
}

// 长数字串（手机 / 身份证 / 银行卡）：先取「≥11 位」的极大数字串（可含末位校验 X），
// 用 (?:^|\D) 前导 + (?=\D|$) 前瞻界定，避免手机号在银行卡 / 身份证内部被误切。
const NUM_RUN_RE = /(?:^|\D)(\d{11,19}[Xx]?)(?=\D|$)/g

// 邮箱：局部保留首字母，域名完整保留（便于人工回查来源，域名本身非个人 PII）。
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// 统一社会信用代码：2 位登记 + 类别，6 位行政区划数字，10 位主体 + 校验（字母数字）。
const USCC_RE = /(?:^|[^0-9A-Za-z])([0-9A-Z]{2}\d{6}[0-9A-Z]{10})(?![0-9A-Za-z])/g

// 固定电话：区号-号码，要求连字符降误伤（纯号码串交给 NUM_RUN 分支处理）。
const LANDLINE_RE = /0\d{2,3}-\d{7,8}(?!\d)/g

function maskNumRun(run: string): { kind: PiiKind; masked: string } | null {
  const len = run.length
  if (len === 18) return { kind: "idcard", masked: maskKeep(run, 6, 4) }
  if (len === 15) return { kind: "idcard", masked: maskKeep(run, 6, 3) }
  if (len >= 16 && len <= 19) return { kind: "bankcard", masked: maskKeep(run, 4, 4) }
  if (len === 11 && /^1[3-9]/.test(run)) return { kind: "phone", masked: maskKeep(run, 3, 4) }
  return null
}

function maskEmail(s: string): string {
  const at = s.indexOf("@")
  if (at <= 0) return "*".repeat(s.length)
  const local = s.slice(0, at)
  const domain = s.slice(at) // 含 @
  return (local.slice(0, 1) || "*") + "***" + domain
}

function maskUscc(s: string): string {
  return maskKeep(s, 2, 4)
}

// 校验位以外仍无字母的「18 位」串实为身份证号（纯数字或 17 位数字 + X），不归统一社会信用代码。
function isLikelyUscc(run: string): boolean {
  return /[A-Z]/.test(run.slice(0, run.length - 1))
}

function maskLandline(s: string): string {
  const i = s.indexOf("-")
  if (i < 0) return s
  const area = s.slice(0, i + 1)
  const body = s.slice(i + 1)
  return area + "*".repeat(Math.max(0, body.length - 2)) + body.slice(-2)
}

/** 返回掩码后的文本：依次处理邮箱 / 统一社会信用代码 / 长数字串 / 座机，original 档调用方自行不接。 */
export function redactPii(text: string): string {
  if (!text) return text
  let s = text.replace(EMAIL_RE, (m) => maskEmail(m))
  s = s.replace(USCC_RE, (whole, run) => (isLikelyUscc(run) ? whole.slice(0, whole.length - run.length) + maskUscc(run) : whole))
  s = s.replace(NUM_RUN_RE, (whole, run) => {
    const r = maskNumRun(run)
    if (!r) return whole
    return whole.slice(0, whole.length - run.length) + r.masked
  })
  s = s.replace(LANDLINE_RE, (m) => maskLandline(m))
  return s
}

interface ScanSpec {
  re: RegExp
  classify: (raw: string) => { kind: PiiKind; masked: string } | null
}

function scan(text: string, spec: ScanSpec): PiiHit[] {
  const hits: PiiHit[] = []
  spec.re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = spec.re.exec(text))) {
    const raw = m[1] ?? m[0]
    if (!raw) continue
    const cls = spec.classify(raw)
    if (!cls) continue
    const at = m.index + m[0].lastIndexOf(raw)
    hits.push({ kind: cls.kind, raw, masked: cls.masked, start: at, end: at + raw.length })
    if (m.index === spec.re.lastIndex) spec.re.lastIndex++
  }
  return hits
}

/** 识别全部 PII 命中（按出现顺序，去重叠）：仅用于审计 / 计数；进 AI 前请直接用 redactPii。 */
export function findPii(text: string): PiiHit[] {
  if (!text) return []
  const specs: ScanSpec[] = [
    { re: EMAIL_RE, classify: (r) => ({ kind: "email", masked: maskEmail(r) }) },
    { re: USCC_RE, classify: (r) => (isLikelyUscc(r) ? { kind: "uscc", masked: maskUscc(r) } : null) },
    { re: NUM_RUN_RE, classify: (r) => maskNumRun(r) },
    { re: LANDLINE_RE, classify: (r) => ({ kind: "landline", masked: maskLandline(r) }) },
  ]
  const all: PiiHit[] = []
  for (const sp of specs) all.push(...scan(text, sp))
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const kept: PiiHit[] = []
  for (const h of all) {
    const last = kept[kept.length - 1]
    if (last && h.start < last.end) continue // 与已保留命中重叠，丢弃（长串优先）
    kept.push(h)
  }
  return kept
}

/** 是否含可识别 PII。 */
export function containsPii(text: string): boolean {
  return findPii(text).length > 0
}
