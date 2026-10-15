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

/** 图表题注编号（规范：表「表三-1/表X-Y」在上、图在下，删改后须更新域；断号或重号即违规） */
export function checkCaptionNumbering(text: string): string[] {
  const issues: string[] = []
  for (const [label, re] of [["图", /图\s*(\d+)\s*[-–—]\s*(\d+)/g], ["表", /表\s*(\d+)\s*[-–—]\s*(\d+)/g]] as const) {
    const seen = new Map<string, number>()
    let m: RegExpExecArray | null
    while ((m = re.exec(String(text ?? "")))) {
      const id = `${m[1]}-${m[2]}`
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
