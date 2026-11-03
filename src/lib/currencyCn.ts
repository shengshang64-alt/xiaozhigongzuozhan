// ---------------------------------------------------------------------------
// R184 人民币金额「大写」确定性能力（纯函数，零 AI，零 schema）。
//
// 标书/报价的经典硬性核验项「金额大小写是否一致」此前无人覆盖：consistencyGuard 的
// ②量化依据 / ③量级自洽 / ④政策时效 三条 LLM 规则均不含此项；而该判定天然可确定性
// 完成（大写串 ↔ 阿拉伯数字为精确互逆），无需 LLM、零成本、零误判。本模块提供三件套：
//   - cnyToUpper      ：阿拉伯数字金额 → 中文大写（财会/GB 惯例：零规则、万/亿分节、元角分、整、负）
//   - parseCnyUpper   ：中文大写 → 阿拉伯数字金额（cnyToUpper 的逆运算；不规范串返回 null）
//   - scanAmountMismatches：在正文里定位「相邻重述」的大写/小写金额并报告不一致或畸形大写
// 结果供交卷体检消费（只报不拦，与既有护栏口径一致）：R184 交付确定性内核 + 全量单测，
// R187 经 bidTypes.amountCaseMismatchHits 接入本地格式路（交卷体检 / 章生成后回显同一路径）。
// ---------------------------------------------------------------------------

const NUMS = "零壹贰叁肆伍陆柒捌玖"
// 大写数字 + 兼容常见简体/异写（〇一二…九），解析用；生成统一走标准大写。
const CN_DIGIT: Record<string, number> = {
  零: 0, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
  〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const UNIT_IN: Record<string, number> = { 拾: 10, 佰: 100, 仟: 1000 }

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** 第 i 个万分节的单位：0="",1=万,2=亿,3=万亿,4=亿亿…… */
function secUnitAt(i: number): string {
  const yi = "亿".repeat(Math.floor(i / 2))
  const wan = i % 2 === 1 ? "万" : ""
  return wan + yi
}

/** 0..9999 分节 → 中文（不含分节单位、无前导零；正确处理内部零，如 105→壹佰零伍）。 */
function fourToChinese(sec: number): string {
  const str = String(sec).padStart(4, "0")
  const units = ["仟", "佰", "拾", ""]
  let res = ""
  let anyNonZero = false
  let pendingZero = false
  for (let i = 0; i < 4; i++) {
    const d = Number(str[i])
    if (d === 0) {
      if (anyNonZero) pendingZero = true
    } else {
      if (pendingZero) res += NUMS[0]
      pendingZero = false
      res += NUMS[d] + units[i]
      anyNonZero = true
    }
  }
  return res
}

/** 非负整数 → 中文（含万/亿分节，正确处理跨节零，如 100000100→壹亿零壹佰）。 */
function integerToChinese(num: number): string {
  if (num === 0) return NUMS[0]
  const secs: number[] = []
  let n = num
  while (n > 0) {
    secs.push(n % 10000)
    n = Math.floor(n / 10000)
  }
  let res = ""
  let needZero = false
  for (let i = secs.length - 1; i >= 0; i--) {
    const sec = secs[i]
    if (sec === 0) {
      if (res) needZero = true
      continue
    }
    if (res && (needZero || sec < 1000)) res += NUMS[0]
    res += fourToChinese(sec) + secUnitAt(i)
    needZero = false
  }
  return res
}

export type CnyUpperOptions = {
  /** 前缀「人民币」字样（票据常见口径）；负号始终在其前 */
  prefixRmb?: boolean
}

/**
 * 阿拉伯数字金额（元）→ 中文大写。四舍五入到分。
 * 例：40000000→肆仟万元整；1234.56→壹仟贰佰叁拾肆元伍角陆分；100.05→壹佰元零伍分；
 * 0.5→伍角；0→零元整；-8.8→负捌元捌角；非法（NaN/Infinity）→空串。
 */
export function cnyToUpper(amount: number, opts: CnyUpperOptions = {}): string {
  if (!Number.isFinite(amount)) return ""
  const neg = amount < 0
  const n = round2(Math.abs(amount))
  const integer = Math.floor(n)
  const frac = Math.round((n - integer) * 100) // 0..99 分
  const jiao = Math.floor(frac / 10)
  const fen = frac % 10
  let body = ""
  if (integer === 0 && frac > 0) {
    // 不足壹元：直接角分，不写「零元」
    if (jiao) body += NUMS[jiao] + "角"
    if (fen) body += NUMS[fen] + "分"
  } else {
    body = integerToChinese(integer) + "元"
    if (frac === 0) {
      body += "整"
    } else if (jiao) {
      body += NUMS[jiao] + "角"
      if (fen) body += NUMS[fen] + "分"
    } else {
      body += "零" + NUMS[fen] + "分"
    }
  }
  return (neg ? "负" : "") + (opts.prefixRmb ? "人民币" : "") + body
}

function parseSection4(s: string): number {
  let sum = 0
  let num = 0
  for (const ch of s) {
    if (ch in CN_DIGIT) num = CN_DIGIT[ch]
    else if (ch in UNIT_IN) {
      sum += (num || 1) * UNIT_IN[ch]
      num = 0
    }
  }
  return sum + num
}

function splitOnce(s: string, sep: string): [string | null, string] {
  const i = s.indexOf(sep)
  if (i < 0) return [null, s]
  return [s.slice(0, i), s.slice(i + 1)]
}

function parseWan(s: string): number {
  const [w, r] = splitOnce(s, "万")
  if (w === null) return parseSection4(r)
  return parseSection4(w) * 1e4 + parseSection4(r)
}

function parseIntegerCn(s: string): number {
  const [yi, rest] = splitOnce(s, "亿")
  if (yi === null) return parseWan(rest)
  return parseWan(yi) * 1e8 + parseWan(rest)
}

const CORE_RE = /^[零壹贰叁肆伍陆柒捌玖拾佰仟万亿〇一二三四五六七八九]*$/
const FRAC_RE = /^[零壹贰叁肆伍陆柒捌玖〇一二三四五六七八九角分]+$/

/**
 * 中文大写 → 阿拉伯数字金额（元）。cnyToUpper 的逆运算。
 * 不规范/无法解析（含非法字符、缺有效数字）返回 null——供一致性扫描区分「畸形大写」。
 * 兼容人民币/¥前缀、负/欠、圆/整/正、元零X分、万亿。
 */
export function parseCnyUpper(text: string | null | undefined): number | null {
  let t = String(text ?? "").trim()
  if (!t) return null
  t = t.replace(/[\s,，、]/g, "")
  if (t.startsWith("人民币")) t = t.slice(3)
  t = t.replace(/^[¥￥]+/, "")
  let neg = false
  if (t.startsWith("负") || t.startsWith("欠")) {
    neg = true
    t = t.slice(1)
  }
  if (t.startsWith("人民币")) t = t.slice(3)
  t = t.replace(/[整正]$/, "")

  const mYuan = t.search(/[元圆]/)
  let intStr = t
  let fracStr = ""
  if (mYuan >= 0) {
    intStr = t.slice(0, mYuan)
    fracStr = t.slice(mYuan + 1)
  } else if (/[角分]/.test(t)) {
    intStr = ""
    fracStr = t
  }

  if (intStr && !CORE_RE.test(intStr)) return null
  if (fracStr && !FRAC_RE.test(fracStr)) return null
  // 至少含一个非零数字字符才视为真实金额（排除「万元」「拾」等无意义碎片）
  if (!/[壹贰叁肆伍陆柒捌玖]/.test(intStr + fracStr)) return null

  const integer = intStr ? parseIntegerCn(intStr) : 0
  const jm = /([零壹贰叁肆伍陆柒捌玖])角/.exec(fracStr)
  const fm = /([壹贰叁肆伍陆柒捌玖])分/.exec(fracStr)
  const jiao = jm ? CN_DIGIT[jm[1]] : 0
  const fen = fm ? CN_DIGIT[fm[1]] : 0
  const value = integer + (jiao * 10 + fen) / 100
  return neg ? -value : value
}

// 大写金额串：数字串 + 元/圆 + 可选角/分 + 可选整/正（允许「零X分」前导零）。
const UPPER_RE =
  /(?:人民币)?[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+[元圆](?:[零壹贰叁肆伍陆柒捌玖]角)?(?:[零壹贰叁肆伍陆柒捌玖]分)?(?:整|正)?/g
// 小写金额串：¥/￥/人民币 前缀的裸数字，或带 万/亿/元 后缀的数字。
// R187：前缀分支须吃掉可选的「万/亿 + 元」单位，否则「人民币1万元」会被截成小写「人民币1」，
// 余下「万元」再被大写形状接走，凭空造出一条假畸形大写。
const ARABIC_RE =
  /(?:¥|￥|人民币)\s*\d[\d,]*(?:\.\d+)?\s*(?:万亿|万|亿)?\s*[元圆]?|\d[\d,]*(?:\.\d+)?\s*(?:万亿|万|亿)?\s*元/g

function parseArabicAmount(raw: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(万亿|万|亿)?/.exec(raw)
  if (!m) return null
  const base = Number(m[1].replace(/,/g, ""))
  if (!Number.isFinite(base)) return null
  const unit = m[2]
  const mult = unit === "万亿" ? 1e12 : unit === "亿" ? 1e8 : unit === "万" ? 1e4 : 1
  return base * mult
}

export type AmountMismatch = {
  kind: "mismatch" | "malformed"
  upperRaw: string
  arabicRaw: string | null
  upperValue: number | null
  arabicValue: number | null
  /** 相对偏差（|小写-大写| / max），仅 mismatch 且两侧可解析 */
  diffRatio: number | null
  index: number
  /** 大写串与小写串之间的间隔串（无配对时为 ""）；上层可据此区分同行重述与跨行/跨表格格相邻 */
  sep: string
  message: string
}

// 大写↔小写「相邻重述」之间允许的间隔字符（括号/标点/常见连接词），排除会致误配的正文字。
const SEP_OK = new Set(
  Array.from(" \t\r\n（）()[]【】〔〕，,、。:：；;~～-—－_为即约合至到约等共计¥￥"),
)

type Span = { raw: string; start: number; end: number }

function collect(text: string, re: RegExp): Span[] {
  const out: Span[] = []
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex += 1
      continue
    }
    out.push({ raw: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * 扫描正文中「大写金额与其紧邻重述的小写金额」是否一致（只报不拦）。
 * 判定口径：
 *  - 仅比较被括号/标点/轻连接词隔开、间隔 <=6 字符的紧邻对，避免把「总投资1亿（含贰仟万…）」
 *    这类语义不同的相邻金额误判为不一致（含被排除汉字者不配对）。
 *  - 大写串能被识别为金额形状但解析失败（含非法字符/碎片）→ 记 malformed。
 *  - 两侧金额四舍五入到分后不等 → 记 mismatch 并给相对偏差。
 */
export function scanAmountMismatches(text: string, window = 6): AmountMismatch[] {
  const t = String(text ?? "")
  if (!t) return []
  const arms = collect(t, ARABIC_RE)
  // 丢弃与任一阿拉伯金额区间重叠的大写串——避免小写「4000万元」内的「万元」被当成独立大写碎片。
  const ups = collect(t, UPPER_RE).filter((u) => !arms.some((a) => a.start < u.end && u.start < a.end))
  const out: AmountMismatch[] = []

  for (const u of ups) {
    const uv = parseCnyUpper(u.raw)
    let best: { a: Span; gap: number; sep: string } | null = null
    for (const a of arms) {
      let gap: number
      if (a.start >= u.end) gap = a.start - u.end
      else if (a.end <= u.start) gap = u.start - a.end
      else continue
      if (gap > window) continue
      const between = a.start >= u.end ? t.slice(u.end, a.start) : t.slice(a.end, u.start)
      if (!Array.from(between).every((c) => SEP_OK.has(c))) continue
      if (!best || gap < best.gap) best = { a, gap, sep: between }
    }

    if (uv === null) {
      out.push({
        kind: "malformed",
        upperRaw: u.raw,
        arabicRaw: best?.a.raw ?? null,
        upperValue: null,
        arabicValue: null,
        diffRatio: null,
        index: u.start,
        sep: best?.sep ?? "",
        message: `大写金额「${u.raw}」无法解析，疑似不规范书写`,
      })
      continue
    }
    if (!best) continue
    const av = parseArabicAmount(best.a.raw)
    if (av === null) continue
    if (round2(av) !== round2(uv)) {
      const denom = Math.max(Math.abs(av), Math.abs(uv)) || 1
      out.push({
        kind: "mismatch",
        upperRaw: u.raw,
        arabicRaw: best.a.raw,
        upperValue: uv,
        arabicValue: av,
        diffRatio: round2(Math.abs(av - uv) / denom),
        index: Math.min(u.start, best.a.start),
        sep: best.sep,
        message: `金额大小写不一致：大写「${u.raw}」(${uv}) 与小写「${best.a.raw}」(${av}) 不匹配`,
      })
    }
  }
  return out.sort((x, y) => x.index - y.index)
}
