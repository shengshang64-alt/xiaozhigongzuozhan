// ---------------------------------------------------------------------------
// 公司投标编写规范的「本地可判定口径」——纯函数、零 AI、唯一真源
//
// 来源（已精读并逐条对照）：
//   - 《2026.09.17 投标文件编写规范-完整版》
//   - 《智业软件文档编辑使用规范 V2.1》
//   - 招投标技能培训（第一期）编制技巧 / 电子标 / 可研转条款 / 总包代理 / 宣导
//
// 定位：本模块只放**机械可判**的规则（词表命中、章节存在性、编号连续性、命名格式），
// 供两处消费：① 检查侧（格式检查 / 交卷体检）拦截；② 生成侧（提示词）避免踩坑。
// 写作质量类（评分贴合度、响应充分性、语义一致性）不在本模块——那要靠 AI 与人工。
//
// 用户裁定（2026-10-15）：模板/样式**不做强制**，只有用户主动选定某模板时才按该模板强制校验；
// 电子标专项（CA 有效期、清属性、PDF 体积）由商务标同事负责，本模块不含。
// ---------------------------------------------------------------------------

/** 命中位置（行号从 1 起，便于检查面板定位） */
export type RuleHit = { line: number; text: string; word: string }

/**
 * 口语第一人称黑名单（**不是**用于写死自称，而是"除用户设定自称之外"的口语写法）。
 * 用户裁定 2026-10-15：人称不能限制死——每个招标文件对投标人的称呼不同（投标人/供应商/响应人…），
 * 由用户按本次招标文件设置「对外自称」；本表只负责兜住"我们/我司"这类口语，且**会被自称词豁免**
 * （用户若把"我方"设为正式自称，它就不再算违规）。
 */
export const PRONOUN_BLOCKLIST = ["我们", "我方", "本公司", "我司", "咱们", "咱公司"]

/** 招标文件里常见的"对投标人的称呼"，用于本地从招标原文抽候选（零 AI，纯词频） */
export const SELF_REFERENCE_CANDIDATES = [
  "投标人",
  "供应商",
  "响应人",
  "投标单位",
  "投标方",
  "供方",
  "乙方",
  "承包人",
  "申请人",
  "竞选人",
]

/** 默认自称（用户未设置时的兜底，取公司规范口径） */
export const DEFAULT_SELF_REFERENCE = "本投标人"

/**
 * 从招标原文抽取"本项目该叫什么"的候选（本地零 AI，纯词频）：
 * 招标文件通篇会反复出现对投标人的称呼，出现次数最多的通常就是本项目的正式称谓
 * （政采项目多是"供应商"、工程类多是"投标人"、竞争性磋商常见"供应商/响应人"）。
 * 返回按次数降序的候选，供设置界面一键选用；无命中返回空数组（由调用方回落默认自称）。
 */
export function suggestSelfReferences(tenderText: string): { word: string; count: number }[] {
  const text = String(tenderText ?? "")
  if (!text.trim()) return []
  return SELF_REFERENCE_CANDIDATES.map((word) => ({ word, count: text.split(word).length - 1 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * 解析本项目的称谓口径（唯一真源，检查侧与提示词共用）：
 *   allowed = 用户设定的自称（可多个，逗号分隔）+ 默认自称；banned = 口语第一人称 − allowed。
 * 用户设为自称的词从禁用表里移除 —— 这就是"不限制死"的落地方式。
 * 未设置（空串）时回落默认自称，行为与既有规范一致。
 */
export function resolveVoiceRules(selfReference?: string): { allowed: string[]; banned: string[]; promptLine: string } {
  const custom = String(selfReference ?? "")
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const allowed = Array.from(new Set([...custom, ...(custom.length ? [] : [DEFAULT_SELF_REFERENCE, "本供应商"])]))
  const banned = PRONOUN_BLOCKLIST.filter((w) => !allowed.some((a) => a.includes(w) || w.includes(a)))
  const promptLine = `对外自称统一用「${allowed.join("」「")}」（按本次招标文件的称谓）；禁止出现${
    banned.length ? `「${banned.join("」「")}」等第一人称口语写法` : "第一人称口语写法"
  }`
  return { allowed, banned, promptLine }
}

/** 参数表述：规范要求写具体数值，禁用模糊比较词（"不低于/相当于"类） */
/**
 * 模糊参数词（规范原文取向：技术参数必须写具体数值）。
 * R56 收敛：**「不低于 / 不高于」这类下限承诺不放进来**——它们是投标里的常见且合规的口径
 * （「不低于 3 秒」明确给出了边界，不是模糊），实测在真实标书里一次命中 152 处，
 * 会把「相当于 / 大致 / 左右」这类真模糊淹掉。规范要禁的是"说不清"，不是"说下限"。
 * 用户后续如需把下限承诺也纳入检查，应做成独立开关而非并回本表。
 */
export const VAGUE_PARAM_WORDS = ["相当于", "大致", "左右", "若干", "类似标准", "同级产品", "满足要求即可"]

/** 身份泄漏词（暗标/脱敏场景必查）：调用方传入本公司名、产品名、客户名等，逐条扫 */
function hitWords(text: string, words: string[]): RuleHit[] {
  const out: RuleHit[] = []
  const lines = String(text ?? "").split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    for (const w of words) {
      if (w && line.includes(w)) out.push({ line: i + 1, text: line.trim().slice(0, 80), word: w })
    }
  }
  return out
}

/**
 * 人称检查：正文里出现口语第一人称即违规。
 * **必须在调用处传入本项目自称**（opts.selfReference，来自项目设置；缺省用默认自称）——
 * 用户设定的自称词会被豁免，不会因为"这次招标文件叫供应商"就误报。
 */
export function findPronounHits(text: string, opts?: { selfReference?: string }): RuleHit[] {
  const { banned } = resolveVoiceRules(opts?.selfReference)
  return hitWords(text, banned)
}

/** 参数模糊表述检查：命中「不低于/相当于」类词即给出警告（需改写为具体数值） */
export function findVagueParamHits(text: string): RuleHit[] {
  return hitWords(text, VAGUE_PARAM_WORDS)
}

/** 身份泄漏检查：暗标/脱敏场景下，公司名、产品名、客户名不得出现 */
export function findIdentityLeaks(text: string, markers: string[]): RuleHit[] {
  return hitWords(text, markers.map((m) => String(m ?? "").trim()).filter(Boolean))
}

// ---------------------------------------------------------------------------
// 凭证类断言必须有出处（2026-10-26 标书官复核提出的真实缺口）
//
// 标书官原话：表格里写「已通过等保三级测评并提供证书」，而这张表没有证明材料列时
// 这句话**无处可查**；没有证书就是虚假应答，是废标级风险。
//
// 我核实后确认产品里**没有**这条校验（搜「已通过|已获得|已获|已取得证书」，
// 生产代码只命中一句无关注释）。所以这是真缺口，不是误报。
//
// 判据设计（宁漏不误伤，因为误报会让用户对体检失去信任）：
//   只认**明确断言已持有某资质/认证/证书**的句式，不认：
//     - 规划中的（「将提供」「拟申请」「计划取得」）
//     - 招标侧要求（「投标人应通过等保三级」——那是要求不是我们的话）
//     - 泛泛的能力描述（「支持等保三级要求」——这是能力不是持证）
//   命中后要求**同一段落/同一行附近**出现出处指针（详见附件/见附件/附证明/第X页/编号），
//   否则报「无出处」。
// ---------------------------------------------------------------------------

/** 断言已持有资质的句式：**主语必须是投标人自己** + 已通过/已获得/已取得 + 资质名词
 *
 * ⚠️ 2026-10-26 第一版判据在真实库上误报 37/44，逐条核对后确认全是误报，原因是**主体抓错**：
 *   「通过平台实现电子病历评级六级建设」——建设方案，不是持证断言（"通过"是介词不是动词）
 *   「数字证书由具备资质的 CA 机构颁发」——说的是 **CA 机构**有资质，不是我们持证
 *   「证明文件由具备资质的第三方测评机构出具」——同样，主体是第三方
 *
 * 第二版收紧为「必须出现我方主语」，结果把标书官的原句漏了——
 *   表格里写「已通过等保三级测评并提供证书」，**没有主语但语境默认就是投标人自己**。
 *   而恰恰是这种"无主语断言"最危险：读者默认它是一种承诺，却无处可查。
 *
 * 第三版（当前）分两档：
 *   ① 有我方主语 → 强断言，直接报
 *   ② 无主语但句式是**动词开头**（整行/句首就是「已通过/已取得」）→ 也算断言，报
 * 但排除两类误报源：
 *   - 前面出现「由/经」（「由具备资质的 CA 机构颁发」——主体是第三方）
 *   - 「通过」后面紧跟「平台/系统/接口」（「通过平台实现…」——介词用法）
 */
const SELF_SUBJECT = "(?:本投标人|我公司|我司|本公司|我方|投标人)"

/** 「通过」作介词时后的典型宾语：不是动词用法，不能当持证断言
 *
 * ⚠️ 这里不能用 `\s*` 前缀——`(?!\s*(?:平台|…))` 在"已通过等保"上行为正确，
 * 但在调试时发现加 `\s*` 会让某些组合意外放行；去掉 `\s*` 后用紧凑形态，语义更明确。
 */
const THROUGH_PREPOSITION_TAIL = "(?!(?:平台|系统|接口|集成|对接|部署|建设|采用|实施|配置|调用|引入))"

const CREDENTIAL_ASSERTION_RES: readonly RegExp[] = [
  // ① 有我方主语：主语 + 已(经)通过/取得/获得 + 资质名词
  new RegExp(
    `${SELF_SUBJECT}[^。；\\n]{0,12}?已(?:经)?(?:通过|取得|获得|获取)${THROUGH_PREPOSITION_TAIL}[^。；\\n]{0,20}?(?:测评|认证|评估|认定|资质|证书|备案|许可)`,
  ),
  // ② 无主语但位置在「行首 / 句首标点后 / 列分隔（2+空格）后」的「已通过/已取得…」
  //    表格单元格里最常见的形态：`满足等保三级要求  已通过等保三级测评并提供证书  无偏离`
  new RegExp(
    `(?:^|[。；\\n（(]|\\s{2,})已(?:经)?(?:通过|取得|获得|获取)${THROUGH_PREPOSITION_TAIL}[^。；\\n]{0,20}?(?:测评|认证|评估|认定|资质|证书|备案|许可)`,
  ),
  // ③ 我方主语 + 持有/已获 + 证书/资质
  new RegExp(`${SELF_SUBJECT}[^。；\\n]{0,12}?(?:已获|持有)[^。；\\n]{0,20}?(?:证书|资质|认证|执照)`),
  // ④ 无主语但句首「持有 XXX 证书」
  new RegExp(`(?:^|[。；\\n（(]\\s*)(?:已获|持有)[^。；\\n]{0,20}?(?:认证证书|资质证书|证书)`),
]

/** 主体是第三方的句式：命中即排除（「由具备资质的 CA 机构颁发」不是我们持证） */
const THIRD_PARTY_SUBJECT_RE = /(?:由|经)\s*[^。；\n]{0,20}?具备资质的/

/**
 * 条件/要求式：命中即排除。
 *
 * ⚠️ 2026-10-26 真实库复测（v4 剩 3 条）全是这类误报：
 *   「投标人**持有的**信息技术服务管理体系认证…**在有效期内**，认证证书扫描件…」
 *     —— 这是"资格要求/材料归集说明"，不是"我们已持有"
 *   「投标人**如持有**其他行业资质…一并按同一口径归集」
 *     —— "如持有"是条件状语，不是断言
 * 共性：「投标人」在这里是**规范用语指代投标人这一方**（含"应满足"的隐含语气），
 * 且句子里出现「如/若/应当/需要/需提供/扫描件/归集/材料」这类**清单编制语境**的词。
 * 内容里带扫描件/归集/材料/台账时，说明这句话是在说"该准备什么材料"，不是"已经有什么"。
 */
const REQUIREMENT_CONTEXT_RE =
  /如持有|若持有|应当持有|需持有|须持有|持有的[^。；\n]{0,30}?(?:在有效期内|须|应)|扫描件|归集|材料清单|台账|资格要求|评审细则|评分细则/

/** 规划中/未发生的表述：命中即豁免（不是断言已持有）
 *
 * ⚠️ 2026-10-26 第一版豁免过宽，把标书官原句误豁免了：
 *   「已通过等保三级测评并提供证书」里含「等保三级要求」的「要求」二字，
 *   第一版 `(?:应|须|必须|要求)[^。；\n]{0,6}?(?:通过|取得...)` 把「要求」当成主语 →
 *   整句被判为"招标侧要求"而豁免 → **该报的一条都没报**。这是测试抓出来的。
 *
 * 收紧为：
 *   ① 未来时必须是**句首或紧跟主语**的「将/拟/计划/准备/预计 + 通过/取得」，
 *      且「将」后面不能隔着「已」；
 *   ② 要求式必须**明确带主语**（投标人/供应商/中标人/乙方 等）**且** 语气词（应/须/必须），
 *      不接受裸「要求」二字（「等保三级要求」是名词短语，不是要求句）。
 */
const FUTURE_OR_REQUIREMENT_RE = new RegExp(
  [
    // ① 未来时：句首/主语后 + 将拟计划准备预计 + 通过取得获得（中间不许出现「已」）
    "^(?:本?我?公司|投标人|供应商|乙方)?[，,]?\\s*(?:将|拟|计划|准备|预计|承诺于)[^。；\\n已]{0,12}?(?:通过|取得|获得)",
    // ② 要求式：必须带明确主语 + 情态动词
    "(?:投标人|供应商|中标人|乙方|响应人|供方)\\s*(?:应|须|必须|应当)[^。；\\n]{0,10}?(?:通过|取得|获得)[^。；\\n]{0,10}?(?:认证|测评|证书|资质)",
  ].join("|"),
)

/** 出处指针：附件/页码/编号/详见 */
const EVIDENCE_POINTER_RE = /详见|见附件|附件\s*[0-9一二三四五六七八九十]|第\s*\d+\s*页|P\s*\d+|编号[:：]|证书号/

export type CredentialClaim = {
  /** 行号（1 起） */
  line: number
  /** 断言原文片段 */
  excerpt: string
  /** 附近是否找到出处指针 */
  hasPointer: boolean
}

/**
 * 扫描「凭证类断言无出处」（纯本地零 AI）。
 *
 * @param text 章正文
 * @param lookback 出处指针的回看行数（默认 2：凭证断言后面常跟「详见附件3」）
 */
export function findCredentialClaimsWithoutEvidence(text: string, lookback = 2): CredentialClaim[] {
  const lines = String(text ?? "").split(/\r?\n/)
  const out: CredentialClaim[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const hit = CREDENTIAL_ASSERTION_RES.find((re) => re.test(line))
    if (!hit) continue
    // 豁免：该行本身带规划/要求语义
    if (FUTURE_OR_REQUIREMENT_RE.test(line)) continue
    // 豁免：主体是第三方（「由具备资质的 CA 机构颁发」——不是我们持证）
    if (THIRD_PARTY_SUBJECT_RE.test(line)) continue
    // 豁免：清单编制/资格要求语境（「投标人如持有…一并归集」「持有的认证在有效期内，扫描件…」）
    if (REQUIREMENT_CONTEXT_RE.test(line)) continue
    // 找出处：本行 + 后 lookback 行（凭证断言常在句末，出处跟在同一段或下一行）
    const windowText = lines.slice(i, Math.min(lines.length, i + lookback + 1)).join("\n")
    const hasPointer = EVIDENCE_POINTER_RE.test(windowText)
    out.push({ line: i + 1, excerpt: line.trim().slice(0, 80), hasPointer })
  }
  return out
}

// ---------------------------------------------------------------------------
// 专用件与编号（规范硬性要求，可机械判定）
// ---------------------------------------------------------------------------

/**
 * 必备专用件（规范原文：★及承诺条款须以独立《承诺函》形式单独响应，标题层级不低于三级；
 * 偏离表须逐条填写不遗漏、每系统单独拆行）。二者是"必须存在的章"，与是否用公司模板无关。
 */
export const REQUIRED_DEDICATED_SECTIONS = [
  { key: "commitment", label: "承诺函", match: /承诺函/, maxLevel: 3, hint: "★及承诺条款须以独立承诺函单独响应，标题层级不低于三级（即 ≤3 级）" },
  { key: "deviation", label: "偏离表", match: /偏离表|偏离情况表/, maxLevel: 3, hint: "偏离表须逐条填写不遗漏、无偏离写「完全响应」、每系统单独拆行" },
] as const

export type OutlineSectionLike = { title: string; level?: number }

/**
 * 必备专用件检查（吃大纲节点或章节清单标题）。
 * 缺失 → 违规；存在但层级深于 maxLevel → 违规（规范要求"不低于三级"）。
 * opts.satisfied：已知在**大纲之外**已满足的专用件（真实标书实测：偏离表常以独立文件随标提交、
 * 并不作为正文章节存在，此时按"缺偏离表"报就是误报），传 key 即跳过该项。
 */
export function checkDedicatedSections(
  sections: OutlineSectionLike[],
  opts?: { satisfied?: readonly string[] },
): { key: string; label: string; reason: string; hint: string }[] {
  const satisfied = new Set(opts?.satisfied ?? [])
  const issues: { key: string; label: string; reason: string; hint: string }[] = []
  for (const spec of REQUIRED_DEDICATED_SECTIONS) {
    if (satisfied.has(spec.key)) continue
    const hit = (sections ?? []).find((s) => spec.match.test(String(s?.title ?? "")))
    if (!hit) {
      issues.push({ key: spec.key, label: spec.label, reason: `缺少《${spec.label}》`, hint: spec.hint })
      continue
    }
    const level = Number(hit.level ?? 1)
    if (Number.isFinite(level) && level > spec.maxLevel) {
      issues.push({
        key: spec.key,
        label: spec.label,
        reason: `《${spec.label}》层级过低（第 ${level} 级，规范要求不低于三级）`,
        hint: spec.hint,
      })
    }
  }
  return issues
}

/**
 * 图表题注编号（规范：表题在上、图注在下，删改后须更新域；断号或重号即违规）
 *
 * ⚠️ 2026-10-26 标书官复核后的重大修正 —— 原实现只认「表N-M」带横杠形态，
 * 而金标准件（池州主-1129上午修订.docx，34.3 万字）实测：
 *   「表N-M」带横杠 0 处、「表N」全书顺序号 **69 处**；图题是「图N：」带冒号、带横杠 0 处。
 * 也就是说原实现对金标准风格的稿件**永远报零问题**——徽标全绿，用户以为没问题。
 * 这比不检查更坏：不检查用户知道没查，报绿用户会以为查过了。
 *
 * 现同时支持两种编号体系（真实标书就用这两种，没第三种）：
 *   ① 分章式 `表1-1` `图2-3`  —— 按「章内序号应连续」判断号/重号
 *   ② 全书式 `表1` `图2`（可带冒号）—— 按「全书序号应连续」判断号/重号
 * 两者混用时各算各的序列，互不干扰（真实稿里很少混，混了也不算错）。
 *
 * ⚠️ 2026-10-26 第三轮审计再修（真实库 193 章扫出 15 章有题注文本，判据却报 0 问题）：
 *   真实稿的题注写法比我原判据宽得多，实测漏了 4 类：
 *     `表14.5`（**点号**分隔，不是横杠）—— 原分章式只认 `-–—`
 *     `表一` `表四` `图六`（**中文数字**）—— 原全书式只认 `\d+`
 *     `图 六`（中文数字 + 空格）
 *     `表一一`（中文数字连写，是笔误形态，应报重号/异常）
 *   若继续只认阿拉伯数字，对**中文编号体系的老标书**等于没检查——与之前金标准那个假绿同性质。
 *   故把 `\d+` 扩为 `[0-9一二三四五六七八九十百]+`，分章式分隔符加 `.．`。
 *   中文数字转阿拉伯数字用 cnNumToInt，保证「表一→表二→表三」能判连续。
 */

/** 编号 token：阿拉伯数字或中文数字 */
const CAPTION_NUM_SRC = "[0-9一二三四五六七八九十百]+"

/** 中文/阿拉伯混合数字 → 整数（表一→1、表十二→12、表14→14）；解析失败返回 NaN */
export function captionNumToInt(tok: string): number {
  if (/^\d+$/.test(tok)) return parseInt(tok, 10)
  const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  // 百位（如「一百二十三」极少见于题注，做基本支持）
  const hundred = tok.indexOf("百")
  if (hundred > 0) {
    const h = CN[tok.slice(0, hundred)] ?? 1
    const rest = tok.slice(hundred + 1)
    return h * 100 + (rest ? captionNumToInt(rest) : 0)
  }
  const ten = tok.indexOf("十")
  if (ten === 0) return 10 + (tok.length > 1 ? (CN[tok.slice(1)] ?? 0) : 0)
  if (ten > 0) {
    const t = CN[tok.slice(0, ten)] ?? 1
    const u = tok.length > ten + 1 ? (CN[tok.slice(ten + 1)] ?? 0) : 0
    return t * 10 + u
  }
  // 单字（表一）或连写（表一一 → 按末位算 1，同时会被判为异常形态）
  if (tok.length === 1) return CN[tok] ?? NaN
  const last = CN[tok.slice(-1)]
  return last === undefined ? NaN : last
}

export function checkCaptionNumbering(text: string): string[] {
  const issues: string[] = []
  const src = String(text ?? "")

  // ① 分章式：表1-1 / 图2-3 / 表14.5（点号也算分隔符，真实稿里有）
  for (const [label, re] of [
    ["图", new RegExp(`图\\s*(${CAPTION_NUM_SRC})\\s*[-–—.．]\\s*(${CAPTION_NUM_SRC})`, "g")],
    ["表", new RegExp(`表\\s*(${CAPTION_NUM_SRC})\\s*[-–—.．]\\s*(${CAPTION_NUM_SRC})`, "g")],
  ] as const) {
    const seen = new Map<string, number>()
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const a = captionNumToInt(m[1])
      const b = captionNumToInt(m[2])
      if (Number.isNaN(a) || Number.isNaN(b)) continue
      const id = `${a}-${b}`
      seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    for (const [id, n] of seen) {
      if (n > 1) issues.push(`${label}${id} 编号重复（出现 ${n} 次），删改后请更新域`)
    }
    // 断号：同一章内序号应连续（只报首处，避免刷屏）
    const byChapter = new Map<string, number[]>()
    for (const id of seen.keys()) {
      const [c, s] = id.split("-")
      byChapter.set(c, [...(byChapter.get(c) ?? []), Number(s)])
    }
    for (const [c, seqs] of byChapter) {
      const sorted = [...seqs].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
          issues.push(`${label}${c}-${sorted[i - 1]} 与 ${label}${c}-${sorted[i]} 之间断号，请核对题注编号`)
          break
        }
      }
    }
  }

  // ② 全书式：表1 / 图2 / 表一 / 图六（可带冒号或空格），排除已按分章式统计的「表1-1/表14.5」前半段
  //
  // ⚠️ 负向断言不能用 `(?!\s*[-–—.．]\s*NUM)`：`.` 在字符类外是"任意字符"，
  //    会把「表14.5」正常判进分章式后又被全书式重复计一次（实测：表14.5/表14.6 被判「表1 重复」）。
  //    改为**显式检查匹配位置后的字符**：紧接分隔符（- – — . ．）就说明这是分章式，跳过。
  for (const [label, re] of [
    ["图", new RegExp(`图\\s*(${CAPTION_NUM_SRC})`, "g")],
    ["表", new RegExp(`表\\s*(${CAPTION_NUM_SRC})`, "g")],
  ] as const) {
    const seen = new Map<number, number>()
    const rawByNum = new Map<number, string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      // 紧接分隔符 → 这是「表14.5」形态，归分章式管，全书式跳过
      const after = src.slice(m.index + m[0].length)
      if (/^\s*[-–—.．]\s*[0-9一二三四五六七八九十百]/.test(after)) continue
      const n = captionNumToInt(m[1])
      if (Number.isNaN(n)) continue
      seen.set(n, (seen.get(n) ?? 0) + 1)
      if (!rawByNum.has(n)) rawByNum.set(n, m[1])
    }
    // 重号：同一编号出现 ≥2 次 **且** 全文只有这一个编号时也要报
    // （「表三 甲 / 表三 乙」——这是真重号，不是"只有一张表"）
    // 先判断重号，再看是否需要判断号——顺序不能反，否则单编号重号会被 size<2 提前 continue 掉。
    for (const [n, cnt] of seen) {
      if (cnt > 1) issues.push(`${label}${rawByNum.get(n) ?? n} 编号重复（出现 ${cnt} 次），删改后请更新域`)
    }
    // 只有真按全书顺序编号（出现 ≥2 个不同序号）才判断号，避免单张表也说"断号"
    if (seen.size < 2) continue
    const nums = [...seen.keys()].sort((a, b) => a - b)
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] !== nums[i - 1] + 1) {
        issues.push(`${label}${rawByNum.get(nums[i - 1]) ?? nums[i - 1]} 与 ${label}${rawByNum.get(nums[i]) ?? nums[i]} 之间断号（全书顺序号），请核对题注编号`)
        break
      }
    }
  }
  return issues
}

/** 文件命名（规范：文件名含「日期、文档标题、版本号」三要素，形如 2026.09.17-投标文件-V2.1.docx） */
export function checkFileName(name: string): { ok: boolean; reason: string } {
  const s = String(name ?? "").trim()
  if (!s) return { ok: false, reason: "文件名为空" }
  const hasDate = /20\d{2}[.\-/年]\s?\d{1,2}[.\-/月]\s?\d{1,2}/.test(s)
  const hasVersion = /[Vv]\d+(\.\d+)*/.test(s)
  if (!hasDate && !hasVersion) return { ok: false, reason: "文件名缺少日期与版本号（规范：日期 + 标题 + 版本号三要素）" }
  if (!hasDate) return { ok: false, reason: "文件名缺少日期（形如 2026.09.17）" }
  if (!hasVersion) return { ok: false, reason: "文件名缺少版本号（形如 V2.1）" }
  return { ok: true, reason: "" }
}

// ---------------------------------------------------------------------------
// 表格表题 / 图注 / LaTeX 残留（用户硬要求，2026-10-26 补）
//
// 用户原话（团队记忆已固化）：「正文禁 LaTeX，公式用普通文字加 <sup>/<sub>；
// 表格必须有表题；每张图必须有图注并写明『这张图要表达什么』」。
//
// 补齐前的事实核对（2026-10-26 全仓 grep）：
//   - 图注：figureAnnotation.ts 已实现 checkFigureAnnotations（图注缺失判 warn），**已闭环**；
//   - 表题：**全仓零实现**——导出侧 bidFiles.ts:1731 是 `paras.push(buildFmtTable(block))`，
//     表格前后不插任何表题段；提示词也没要求表题（prompts/*.ts 搜「表题」为 0 命中）；
//   - LaTeX：**全仓零实现**，只有 markdownResidueHits 管 markdown 标记，不管 \frac/\times 这类。
// 故本段补「表题缺失」与「LaTeX 残留」两项，图注沿用既有 figureAnnotation。
//
// 判据设计原则（与本仓既有 linter 同口径：宁漏报不误报，徽标可信度优先）：
//   ① 表题只在**首行含 ≥2 列分隔的全角空格表格块**前找，且必须紧邻（前 3 行内），
//      不给「整章有没有『表』字」这种松判据；
//   ② 表题形态放宽（真实标书写法很杂）：`表1-1 xxx`、`表 2-3：xxx`、`表格：xxx`、
//      `**表1-1** xxx`、单独一行 `表1-1` 后面再跟标题都算；
//   ③ LaTeX 只认命令式（`\xxx{`、`$...$`、`\begin{`）与常见符号命令，
//      不认反斜杠路径（`C:\temp`）和普通乘号 `×`——误报会让用户不再看这个徽标。
// ---------------------------------------------------------------------------

/** 表题行形态（宽松：编号/无编号/带「表格」字样/带 markdown 加粗包裹都算）
 *
 * ⚠️ 2026-10-26 标书官复核后补：原文只认「表N-M」带横杠，而金标准件实测
 * 「表N」全书顺序号 69 处、带横杠 0 处 —— 与 checkCaptionNumbering 的口径必须一致，
 * 否则「判缺表题用宽口径、判断号用窄口径」，同一个仓库两套标准。
 * 现两条编号体系都认，与 checkCaptionNumbering 对齐。
 */
const TABLE_CAPTION_RES: readonly RegExp[] = [
  // 分章式「表1-1」「表 2.3」「表三-1」
  /^\s*(?:\*\*)?\s*表\s*[0-9一二三四五六七八九十]{1,3}\s*[-–—.．]\s*[0-9一二三四五六七八九十]{1,3}/,
  // 全书式「表1 门诊病人诊病信息（挂号记录表）」「表2：xxx」（金标准主流形态）
  /^\s*(?:\*\*)?\s*表\s*[0-9一二三四五六七八九十]{1,3}\s*[:：、\s]/,
  // 独立一行只有全书式编号（表题拆两行写）
  /^\s*(?:\*\*)?\s*表\s*[0-9一二三四五六七八九十]{1,3}\s*(?:\*\*)?\s*$/,
  // 「表：xxx」「表格：xxx」「表格 xxx」（不带编号的写法）
  /^\s*(?:\*\*)?\s*(?:表|表格)\s*[:：、]\s*\S/,
]

const isCaptionLine = (line: string): boolean => TABLE_CAPTION_RES.some((re) => re.test(line))

/** 表题查找窗口：表格块首行往前看几行
 *
 * ⚠️ 2026-10-26 标书官复核：原值 3 偏紧。真实稿里表题常见形态有两种会更远——
 *   ① 表题带长说明（「表5 门诊病人诊病信息（挂号记录表）……以下列出字段口径」）；
 *   ② docx 转平文本后表题与表格间夹了空行或整段说明。
 * 放宽到 6 行，但仍要求窗口内**第一个非空行**是表题（中间夹正文则不算），
 * 避免「随便往前 6 行里有个『表』字就算有表题」的松判据。
 */
const TABLE_CAPTION_LOOKBACK = 6

export type TableCaptionFinding = {
  /** 表格块首行行号（1 起） */
  line: number
  /** 该表首行片段（便于用户定位） */
  excerpt: string
  /** 前若干行里是否找到表题 */
  hasCaption: boolean
}

/**
 * 表题缺失检测（纯本地零 AI）。
 *
 * 「表格」的判定与导出侧同源：`bidFiles.splitTableRow` 的口径是「含全角空格 U+3000 且折出 ≥2 列」，
 * 这里再加一条「块内 ≥2 行」——单行孤立表格在导出侧不会变成 docx Table（bidFiles.ts:1729
 * `if (block.length >= 2)`），拿它要求表题就是误报。
 *
 * @param text 章正文
 * @returns 每张表一条；调用方按「hasCaption === false」取缺失项
 */
export function findTableCaptionStatus(text: string): TableCaptionFinding[] {
  const lines = String(text ?? "").split(/\r?\n/)
  const isRow = (l: string): boolean => {
    // 与 bidFiles.splitTableRow 同口径：含全角空格且折出 ≥2 非空列
    if (!l.includes("\u3000")) return false
    return l.split(/\u3000+/).filter((c) => c.trim() !== "").length >= 2
  }
  const out: TableCaptionFinding[] = []
  let i = 0
  while (i < lines.length) {
    if (!isRow(lines[i])) {
      i++
      continue
    }
    // 连续表格行成块
    let j = i + 1
    while (j < lines.length && isRow(lines[j])) j++
    if (j - i >= 2) {
      // 往前找表题（跳过空行）
      let k = i - 1
      let seen = 0
      let hasCaption = false
      while (k >= 0 && seen <= TABLE_CAPTION_LOOKBACK) {
        const t = lines[k].trim()
        if (t) {
          if (isCaptionLine(t)) {
            hasCaption = true
            break
          }
          seen++
        }
        k--
      }
      out.push({
        line: i + 1,
        excerpt: lines[i].trim().slice(0, 40),
        hasCaption,
      })
    }
    i = j
  }
  return out
}

/**
 * LaTeX 残留检测（纯本地零 AI）。
 *
 * 用户硬要求「正文禁止 LaTeX，公式用普通文字加 `<sup>/<sub>`」。
 * 只认**命令式**形态，避免误伤：
 *   - 不认 `C:\temp` 这类反斜杠路径（要求 `\` 后紧跟字母且整体形如 `\frac{`）；
 *   - 不认普通乘号 `×`、普通斜杠 `/`。
 */
const LATEX_RES: readonly { re: RegExp; label: string }[] = [
  // \frac{1}{2} / \times / \le / \ge / \alpha 等命令（后面必须跟 { 或空白或数学符号）
  { re: /\\[a-zA-Z]{2,}\s*\{/, label: "LaTeX 命令（\\命令{…}）" },
  // 行内数学 $...$ 与块级 $$...$$
  { re: /\$\$[^$\n]{1,80}\$\$/, label: "LaTeX 块级公式 $$…$$" },
  { re: /(?<!\$)\$[^$\n]{1,60}\$(?!\$)/, label: "LaTeX 行内公式 $…$" },
  // \begin{...} 环境
  { re: /\\begin\s*\{/, label: "LaTeX 环境 \\begin{…}" },
  // 常见符号命令（不带花括号的形态，如 \le \ge \pm \times \cdot）
  { re: /\\(?:le|ge|leq|geq|neq|pm|times|cdot|div|approx|infty|sum|int|sqrt|alpha|beta|gamma|theta|lambda|mu|sigma|pi)\b/, label: "LaTeX 符号命令（\\le/\\times…）" },
]

export type LatexFinding = { line: number; label: string; excerpt: string }

/** LaTeX 残留检测：返回 ≤30 条（防刷屏），行号 1 起 */
export function findLatexResidue(text: string, cap = 30): LatexFinding[] {
  const out: LatexFinding[] = []
  const lines = String(text ?? "").split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (out.length >= cap) break
    const line = lines[i]
    for (const { re, label } of LATEX_RES) {
      if (re.test(line)) {
        out.push({ line: i + 1, label, excerpt: line.trim().slice(0, 60) })
        break // 一行只报一次，避免同一行被 3 条正则各报一遍
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Markdown 竖线表格 → 纯文本表格行（全角空格分列）兜底转换
//
// 为什么需要（2026-10-26 修的真 bug）：
//   全局风格规则曾要求「关键章必须用 markdown 表格，列间用 | 分隔」，而小节提示词要求
//   「列间用两个全角空格分隔、禁止 markdown 表格符号」——同一请求里两条互斥指令。
//   而 **导出真源** bidFiles.splitTableRow 只认全角空格（U+3000）：
//     行内必须先含 U+3000、否则直接返回 null
//   于是模型若照全局规则出 markdown 表格，导出时整张表退化成一堆带 `|` 的普通文字段落，
//   在 Word 里就是散文。真实库 74 章真稿实测：含 markdown 竖线表的 0 章（模型干脆不出表）。
//
// 提示词那条已统一到全角空格口径；本函数是**兜底**——模型波动时仍写出 markdown 表格，
// 也在落库前就地转成导出能认的形态，不必让用户去 Word 里发现"表没了"。
//
// 转换规则（零语义、字符只增不减地保留信息）：
//   `| 序号 | 名称 |`  →  `序号 + 两个 U+3000 + 名称`
//   `|---|---|`         →  整行丢弃（分隔行不是内容）
//   `| 1 | 系统A |`    →  `1 + 两个 U+3000 + 系统A`
// 非表格行原样保留；markdown 代码围栏内不动（``` 之间是示例代码，不是表格）。
// 注：注释里不直接写 U+3000 字符——eslint no-irregular-whitespace 会报错（本轮踩过）。
// ---------------------------------------------------------------------------

/** 一行是不是 markdown 表格行：以 | 起止且至少 2 个 | */
const MD_TABLE_ROW_RE = /^\s*\|.*\|\s*$/
/** markdown 表格分隔行：|---|---| 或 | :---: | --- | */
const MD_TABLE_SEP_RE = /^\s*\|?[\s:-]*-{3,}[\s:|-]*\|?\s*$/

// ---------------------------------------------------------------------------
// 半角空格分列 → 全角空格（U+3000）分列 的归一
//
// 2026-10-26 真跑实测发现（真网关 qodercn/qfmodel 生成 531 字）：
//   提示词里明确要求「列间用两个全角空格分隔」，模型输出的却是**两个半角空格**：
//     `参数项  招标要求  我方响应  偏离说明`
//   而导出真源 bidFiles.splitTableRow 第一行就是「不含 U+3000 就 return null」，
//   于是这段表格导出时又是一堆普通文字段落。
//
// 根因判断：**不能指望模型稳定输出 U+3000**。全角空格在绝大多数训练语料里不出现，
// 模型对"全角空格"这个指令的执行率极低（本次 1/1 失败）。所以必须在本地做归一，
// 而不是继续在提示词里加感叹号。
//
// 判据（严格，宁漏不误伤）：
//   一行里出现 **连续 2 个以上半角空格** 且能折出 ≥2 个非空列 → 视为表格行，折成全角空格。
//   单个半角空格（中英混排、数字与单位之间）不动——那是正常排版，动了会伤内容。
//
// ⚠️ 2026-10-26 标书官复核后补的两道护栏（他指出的反向风险）：
//   这个函数把"表格变散文"修好，却可能造成"散文变表格"——原 bug 的反面。
//   他举的真实形态：
//     （1）支持门诊挂号  退号  换号功能
//     （2）支持按科室  医生  午别检索
//   两行连续、都含多处双空格、都能折出 ≥2 列 → 旧判据会把它折成一张 2×4 表格，
//   导出后两句正文变成表格，在 Word 里同样要返工，而且**没有任何提示**。
//
//   护栏① 条目起始符不收：行首是「（1）」「1.」「一、」「①」这类编号时，它是条目正文不是表格行。
//   护栏② 列数必须一致：真表格每行列数稳定（本仓生成约定是固定表头 + 固定列数），
//          正文里的双空格是随机的，折出来列数各不相等。列数不一致 → 整块不转。
//
//   实测依据（真实库 8 项目 / 74 章，2026-10-26）：加护栏前被改动 6 章，
//   逐例核对全是真表格表头（「培训对象 / 课程内容 / 场次安排」这类三列标题行），无误伤；
//   但护栏② 几乎零成本且能挡住未来形态，故仍加上。
//   注：注释里不直接写 U+3000 —— eslint no-irregular-whitespace 会报（本轮已踩两次）。
// ---------------------------------------------------------------------------

/** 连续 ≥2 个半角空格（或制表符）作为列分隔 */
const HALF_SPACE_COL_SEP = /[ \t]{2,}/

/** 条目起始符：行首编号（（1）/ 1. / 1、/ 一、/ ①）——这类行是正文条目，不当表格行 */
const LIST_ITEM_START_RE = /^\s*(?:[（(]\s*[0-9一二三四五六七八九十]{1,3}\s*[)）]|[0-9]{1,3}\s*[.、)）]|[一二三四五六七八九十]{1,3}\s*[、.]|[①-⑳])/

/**
 * 把「半角空格分列」的表格行归一成「两个全角空格分列」，让导出侧能认出表格。
 *
 * @returns text：归一后文本；normalized：被处理的表格行数
 */
export function normalizeTableSeparators(text: string): { text: string; normalized: number } {
  const src = String(text ?? "")
  if (!src.includes("  ") && !src.includes("\t")) return { text: src, normalized: 0 }
  const lines = src.split(/\r?\n/)
  const out: string[] = []
  let normalized = 0
  let inFence = false
  // 表格块判定：连续 ≥2 行都符合"半角空格分列"，才算真表格（单行不转，避免误伤正文对齐）
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      i++
      continue
    }
    // 已含全角空格的表格行原样保留（已经是正确形态）
    // 护栏①：条目起始行不判表格行
    const isHalfRow =
      !inFence &&
      !line.includes("\u3000") &&
      HALF_SPACE_COL_SEP.test(line) &&
      line.trim() !== "" &&
      !LIST_ITEM_START_RE.test(line)
    if (!isHalfRow) {
      out.push(line)
      i++
      continue
    }
    // 收集连续的同形态行
    const block: string[] = []
    let j = i
    while (j < lines.length) {
      const l = lines[j]
      if (l.includes("\u3000") || !HALF_SPACE_COL_SEP.test(l) || l.trim() === "") break
      if (LIST_ITEM_START_RE.test(l)) break // 护栏①：遇到条目行即截断表格块
      block.push(l)
      j++
    }
    if (block.length < 2) {
      out.push(line)
      i++
      continue
    }
    // 护栏②：先按列切，列数不一致则整块不转（真表格列数稳定，正文双空格随机）
    const split = block.map((row) =>
      row
        .split(HALF_SPACE_COL_SEP)
        .map((c) => c.trim())
        .filter((c) => c !== ""),
    )
    const colsOfBlock = split.map((cells) => cells.length)
    const colCount = colsOfBlock[0]
    const stableColumns = colCount >= 2 && colsOfBlock.every((n) => n === colCount)
    if (!stableColumns) {
      out.push(line)
      i++
      continue
    }
    for (const cells of split) {
      out.push(cells.join("\u3000\u3000"))
      normalized++
    }
    i = j
  }
  return { text: out.join("\n"), normalized }
}

/**
 * 把 Markdown 竖线表格转成「两个全角空格分列」的纯文本表格行。
 *
 * 只处理**成块**的表格（≥2 行连续的 | 行）：单行的 `| xxx |` 更像正文里引用的竖线，
 * 按既有 isTableRow 同口径（bidProseLinter 也是 ≥2 行才算表）不做转换，避免误伤。
 */
export function convertMarkdownTables(text: string): { text: string; converted: number } {
  const src = String(text ?? "")
  if (!src.includes("|")) return { text: src, converted: 0 }
  const lines = src.split(/\r?\n/)
  const out: string[] = []
  let converted = 0
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      i++
      continue
    }
    if (inFence || !MD_TABLE_ROW_RE.test(line)) {
      out.push(line)
      i++
      continue
    }
    // 收集连续表格行
    const block: string[] = []
    let j = i
    while (j < lines.length && MD_TABLE_ROW_RE.test(lines[j])) {
      block.push(lines[j])
      j++
    }
    if (block.length < 2) {
      // 单行不转（与 bidProseLinter.isTableRow 的 ≥2 行口径一致）
      out.push(line)
      i++
      continue
    }
    for (const row of block) {
      // 分隔行（|---|:--:|）不是内容，丢弃
      if (MD_TABLE_SEP_RE.test(row) && !/[^\s|:-]/.test(row)) continue
      const cells = row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim())
      // 列间用两个全角空格，与 bidFiles.splitTableRow 的生成约定一致
      out.push(cells.join("\u3000\u3000"))
    }
    converted++
    i = j
  }
  return { text: out.join("\n"), converted }
}

// ---------------------------------------------------------------------------
// 生成侧口径（提示词取这里，避免提示词与检查项两处漂移）
// ---------------------------------------------------------------------------

/** 注入正文提示词的表述口径（规范原文取向，逐条可引）；自称按项目设置动态生成 */
export function writingVoiceRules(selfReference?: string): string[] {
  return [resolveVoiceRules(selfReference).promptLine, ...WRITING_VOICE_RULES_FIXED]
}

/** 与自称无关的固定口径（规范原文取向） */
export const WRITING_VOICE_RULES_FIXED = [
  "已实现的能力用「已部署/已上线/已验证」，规划中的用「将提供」，不得混用",
  "技术参数必须写具体数值，禁止「不低于/相当于」这类模糊比较",
  "★及承诺条款以独立《承诺函》单独响应，内容与正文完全一致，严禁增删改原文要求",
  "偏离表逐条填写不遗漏，无偏离写「完全响应」，每系统单独拆行",
  "技术响应按「最小值响应」：不随意增加功能点、响应时间、运维时间等承诺",
  // 用户硬要求（2026-10-26 补进生成侧）：表格必须有表题、正文禁 LaTeX
  "每个表格上方必须有一行表题（形如「表1-1 参数响应表」），表题独占一行、居中、不与表格正文混排",
  "正文禁止 LaTeX 公式，公式用普通文字加 <sup>/<sub> 表达（如 10<sup>3</sup>、H<sub>2</sub>O）",
] as const

/** 检查侧汇总：正文文本一次扫完，返回三类命中（人称 / 模糊参数 / 身份泄漏） */
export function scanChapterText(
  text: string,
  opts?: { identityMarkers?: string[] },
): { pronouns: RuleHit[]; vagueParams: RuleHit[]; identityLeaks: RuleHit[] } {
  return {
    pronouns: findPronounHits(text),
    vagueParams: findVagueParamHits(text),
    identityLeaks: findIdentityLeaks(text, opts?.identityMarkers ?? []),
  }
}
