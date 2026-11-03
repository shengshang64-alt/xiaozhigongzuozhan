// 招标文件元信息抽取（零 AI、纯函数）
//
// 用途：新建投标项目时导入招标文件，本地抽出「项目名称 / 招标编号 / 客户医院 / 开标时间」
//       自动填表，省掉手抄。文件本身在浏览器解析（extractTenderFileText），不上传。
//
// 为什么不用 AI：这几个字段在招标文件里有固定的公文标签（项目名称：/ 项目编号：/ 采购人：/
// 开标时间：），规则命中率足够且零成本、零延迟、可单测；AI 解析留给正文的评分办法/废标条款
// 那些真正需要理解的部分（parse_report）。
//
// 抽取口径：
//   1. 先规整文本：统一换行、全角冒号→半角、全角空格→半角（公文里两者混用很常见）
//   2. 标签取值：优先「行首标签: 值」；值为空则取下一行（表格转文本后常见「标签行 + 值行」）
//   3. 兜底：整行匹配（一行里塞多个字段时，值截到下一个标签/两连空格前）
//   4. 各字段再套一层语义兜底（标题行以「招标文件」结尾 → 项目名称；正文里的医院名 → 客户医院）
//   5. 抽不到就返回空串，交给用户手填——绝不猜、不编（宁缺勿错）

export type TenderMeta = {
  /** 项目名称（缺省空串） */
  projectName: string
  /** 招标编号 / 项目编号（缺省空串） */
  tenderNo: string
  /** 客户医院 / 采购人（缺省空串） */
  hospital: string
  /** 开标时间，YYYY-MM-DD（对齐 <input type="date">；抽不到空串） */
  bidOpenDate: string
}

// ---------------------------------------------------------------------------
// 标签表（按命中优先级排列；越具体越靠前）
// ---------------------------------------------------------------------------

const LABEL_PROJECT = ["采购项目名称", "招标项目名称", "项目名称", "工程名称", "标的名称", "项目名"]
const LABEL_TENDER_NO = [
  "招标文件编号",
  "采购项目编号",
  "招标编号",
  "项目编号",
  "采购编号",
  "标段编号",
  "招标编码",
  "项目代码",
]
const LABEL_HOSPITAL = ["采购人名称", "招标人名称", "采购单位", "采购人", "招标人", "建设单位", "招标单位", "采购机关"]
const LABEL_OPEN_DATE = [
  "开标时间",
  "开标日期",
  "开标(报价)时间",
  "开标（报价）时间",
  "提交投标文件截止时间",
  "递交投标文件截止时间",
  "投标文件递交截止时间",
  "响应文件递交截止时间",
  "投标截止时间",
  "报价截止时间",
  "磋商时间",
  "开启时间",
]

/** 所有标签的并集：整行取值时用作终止符，避免把下一个字段吃进来 */
const ALL_LABELS = [...LABEL_PROJECT, ...LABEL_TENDER_NO, ...LABEL_HOSPITAL, ...LABEL_OPEN_DATE].sort(
  (a, b) => b.length - a.length,
)

const RE_ESC = /[.*+?^${}()|[\]\\]/g
function esc(s: string): string {
  return s.replace(RE_ESC, "\\$&")
}

// ---------------------------------------------------------------------------
// 文本规整与取值清理
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ") // 全角空格
    .replace(/[：﹕﹔]/g, ":") // 全角冒号
    .replace(/\u00a0/g, " ") // 不换行空格
}

const PLACEHOLDERS = new Set(["/", "-", "—", "－", "无", "略", "详见招标文件", "详见公告", "见招标文件", "另行通知", "待定", "以公告为准"])

/**
 * 只剥「整值被包裹」的引号/括号。不能无条件剥尾部括号——「XX县中医院（以下简称采购人）」
 * 的右括号是内容的一部分，剥掉后配对失效，括号说明就删不掉了（实测踩过）。
 */
function stripWrapper(v: string): string {
  const pairs: Array<[string, string]> = [
    ["「", "」"],
    ["『", "』"],
    ["【", "】"],
    ["（", "）"],
    ["(", ")"],
    ["[", "]"],
    ["“", "”"],
    ["\"", "\""],
    ["'", "'"],
  ]
  for (const [open, close] of pairs) {
    if (v.startsWith(open) && v.endsWith(close) && v.length > open.length + close.length) {
      return v.slice(open.length, v.length - close.length).trim()
    }
  }
  return v
}

function cleanValue(raw: string): string {
  let v = stripWrapper(String(raw ?? "").trim())
  v = v.replace(/[\s]+$/, "")
  v = v.replace(/[，,。;；、:]+$/, "")
  // 表头行残留（如「项目名称 项目编号 采购人」这种被转成一行的表头）不算值
  if (PLACEHOLDERS.has(v)) return ""
  if (v.length > 90) v = v.slice(0, 90)
  return v
}

/**
 * 值截断：一行里塞了多个字段时（PDF 表格转文本常见），值要停在下一个「标签:」或两连空格前。
 * 否则「项目名称: A  招标编号: B」会把 B 一起吃进项目名称。
 */
function truncateAtBoundary(raw: string): string {
  let v = String(raw ?? "")
  const labelAlt = ALL_LABELS.map(esc).join("|")
  const m1 = v.match(new RegExp("^(.*?)(?=\\s*(?:" + labelAlt + ")\\s*:)"))
  if (m1 && m1[1] !== undefined) v = m1[1]
  const seg = v.split(/\s{2,}/)[0]
  if (seg !== undefined) v = seg
  return v
}

// ---------------------------------------------------------------------------
// 标签取值：两遍扫描
// ---------------------------------------------------------------------------

/** 第一遍：行首「标签: 值」；值为空时取下一行（跳过编号行/章节行） */
function labelValueAtLineStart(lines: string[], labels: string[]): string {
  const pat = new RegExp("^\\s*(?:" + labels.map(esc).join("|") + ")\\s*:\\s*(.*)$")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pat)
    if (!m) continue
    let v = cleanValue(truncateAtBoundary(m[1] ?? ""))
    if (!v) {
      // 标签与值分行：取下一行，但要跳过「一、」「1.」这类小标题
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = cleanValue(truncateAtBoundary(lines[j] ?? ""))
        if (!next) continue
        if (/^(?:第[一二三四五六七八九十]+[章节]|[一二三四五六七八九十]+[、.．]|\d+[、.．])/.test(next)) break
        v = next
        break
      }
    }
    if (v) return v
  }
  return ""
}

/** 第二遍：整行匹配（一行里塞多个字段，PDF 表格转文本常见）——值截到下一个标签或两连空格前 */
function labelValueInline(lines: string[], labels: string[]): string {
  const stop = "(?=" + ALL_LABELS.map(esc).join("|") + "|\\s{2,}|$)"
  const pat = new RegExp("(?:" + labels.map(esc).join("|") + ")\\s*:\\s*(.+?)" + stop)
  for (const line of lines) {
    const m = line.match(pat)
    if (!m) continue
    const v = cleanValue(m[1] ?? "")
    if (v) return v
  }
  return ""
}

function pickLabeled(lines: string[], labels: string[]): string {
  return labelValueAtLineStart(lines, labels) || labelValueInline(lines, labels)
}

// ---------------------------------------------------------------------------
// 各字段的语义兜底
// ---------------------------------------------------------------------------

/** 标题行兜底：以「招标文件/采购文件/磋商文件…」结尾的那一行，前缀就是项目名称 */
function projectNameFromTitleLine(lines: string[]): string {
  const suffixRe = /^(.*?)[\s\-—_]*[（(]?\s*(?:招标文件|采购文件|竞争性磋商文件|竞争性谈判文件|磋商文件|谈判文件|询价文件|比选文件|投标邀请书|招标公告)\s*[）)]?\s*$/
  for (const line of lines.slice(0, 40)) {
    const m = line.match(suffixRe)
    if (!m) continue
    const name = cleanValue(m[1] ?? "")
    if (name.length >= 4) return name
  }
  return ""
}

// 长文本里找医院名：只认带行政区划前缀 + 医院类后缀的完整机构名。
// 前缀允许拉丁字母/数字——机构名常以拼音缩写开头（如「YY市妇幼保健院」「XX县中医院」）。
const HOSPITAL_RE =
  /[A-Za-z0-9\u4e00-\u9fa5]{2,12}(?:省|市|县|区|自治州|自治县)?[\u4e00-\u9fa5]{0,14}?(?:人民医院|中医院|蒙医医院|藏医医院|中心医院|妇幼保健院|妇幼保健院|儿童医院|肿瘤医院|口腔医院|中医医院|中西医结合医院|医院|卫生院|社区卫生服务中心|疾病预防控制中心|医疗中心)/

function hospitalFromText(text: string): string {
  const head = text.slice(0, 4000)
  const m = head.match(HOSPITAL_RE)
  return m ? cleanValue(m[0]) : ""
}

const HOSPITAL_HINT = /医院|卫生院|保健院|疾控|医疗中心|卫生服务中心|卫生健康委员会|卫健委/

function looksLikeHospital(v: string): boolean {
  return HOSPITAL_HINT.test(v)
}

/** 从「采购人：XX医院（以下简称采购人）」这类值里削掉括号补充说明 */
function stripParenthetical(v: string): string {
  return v.replace(/[（(](?:以下简称|下称|简称)[^）)]*[）)]/g, "").trim()
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

const DATE_RE = /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/

function toIsoDate(text: string): string {
  const m = String(text ?? "").match(DATE_RE)
  if (!m) return ""
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!(y >= 2000 && y <= 2100) || mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  // 用本地 Date 校验真实存在（挡 2 月 30 日这类），再回格式化为 YYYY-MM-DD
  const probe = new Date(y, mo - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** 开标时间兜底：正文里「开标/截止/递交」附近的第一个完整日期（关键词在日期前、后都认） */
function dateNearKeyword(text: string): string {
  const date = "\\d{4}\\s*[年\\-\\/\\.]\\s*\\d{1,2}\\s*[月\\-\\/\\.]\\s*\\d{1,2}"
  const before = text.match(new RegExp("(?:开标|截止|递交|提交)[^\\n]{0,60}?(" + date + ")"))
  if (before) {
    const iso = toIsoDate(before[1])
    if (iso) return iso
  }
  // 「投标人应于 2026年10月8日前提交投标文件」这类：日期在前、动作在后
  const after = text.match(new RegExp("(" + date + ")\\s*[日号]?\\s*(?:前|之前)?\\s*(?:提交|递交|开标|截止)"))
  if (after) return toIsoDate(after[1])
  return ""
}

// ---------------------------------------------------------------------------
// 编号
// ---------------------------------------------------------------------------

// 编号允许的字符：公文里常见 [350000]SMZC[GK]2026-0912号 这种带方括号/「号」的写法
const TENDER_NO_RE = /^[A-Za-z0-9[\]【】（）()#\-_/.－—～号]{3,60}$/

/**
 * 编号校验：真编号一定含数字；`XXXX号`「XXXX」这类是脱敏/占位符，不能当编号落库
 * （真实样本实测踩过：脱敏样张里「项目编号：XXXX号」被抽成了编号）
 */
function normalizeTenderNo(v: string): string {
  const s = String(v ?? "").replace(/\s+/g, "").replace(/[。；;，,、]+$/, "")
  if (!TENDER_NO_RE.test(s)) return ""
  if ((s.match(/\d/g) ?? []).length < 2) return ""
  if (/[XxＸｘ]{2,}/.test(s)) return ""
  return s
}

/** 编号兜底：正文里「编号: ABC-123」这种，允许前缀是中文标签 */
function tenderNoFromText(text: string): string {
  const m = text.match(/(?:编号|编码|代码)\s*:?\s*([A-Za-z]{1,8}[-/]?[A-Za-z0-9]{2,}(?:[-—/][A-Za-z0-9（）()]+)*)/)
  return m ? normalizeTenderNo(m[1]) : ""
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function extractTenderMeta(rawText: string): TenderMeta {
  const text = normalizeText(rawText)
  if (!text.trim()) return { projectName: "", tenderNo: "", hospital: "", bidOpenDate: "" }
  const lines = text.split("\n")

  // 项目名称：标签 → 「XX项目招标文件」标题行
  let projectName = pickLabeled(lines, LABEL_PROJECT)
  if (!projectName) projectName = projectNameFromTitleLine(lines)
  if (!projectName) projectName = projectNameFromTitleLine([...lines, text.replace(/\n/g, " ")])

  // 招标编号：标签 → 正文兜底
  const tenderNo = normalizeTenderNo(pickLabeled(lines, LABEL_TENDER_NO)) || tenderNoFromText(text)

  // 客户医院：采购人标签（需像医院）→ 采购人标签原值 → 项目名里的医院 → 正文医院名
  let hospital = stripParenthetical(pickLabeled(lines, LABEL_HOSPITAL))
  if (hospital && !looksLikeHospital(hospital)) hospital = ""
  if (!hospital && projectName) {
    const fromName = hospitalFromText(projectName)
    if (fromName) hospital = fromName
  }
  if (!hospital) hospital = hospitalFromText(text)

  // 开标时间：开标/截止类标签 → 关键词附近日期
  const bidOpenDate = toIsoDate(pickLabeled(lines, LABEL_OPEN_DATE)) || dateNearKeyword(text)

  return { projectName, tenderNo, hospital, bidOpenDate }
}

/** 识别结果里非空的字段名（给 UI 提示用） */
export function tenderMetaHits(meta: TenderMeta): string[] {
  const hits: string[] = []
  if (meta.projectName) hits.push("项目名称")
  if (meta.tenderNo) hits.push("招标编号")
  if (meta.hospital) hits.push("客户医院")
  if (meta.bidOpenDate) hits.push("开标时间")
  return hits
}
