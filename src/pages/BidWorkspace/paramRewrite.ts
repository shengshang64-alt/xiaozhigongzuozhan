/**
 * 招标要求 → 响应式表述 的**字眼转换引擎**（纯规则、零 AI）。
 *
 * 为什么不是词表映射：招标文件里的义务表述是「标记 × 主体 × 动词」的组合爆炸——
 * 要求提供 / 要求支持 / 应支持 / 应提供 / 需具备 / 必须满足 / 须达到 / 不得少于 …，
 * 靠「要求→支持」这类逐词对照表永远补不全；而且「要求→支持」本身就是语义错配：
 * 「要求提供 X」的正确响应是「提供 X」，不是「支持 X」。
 *
 * 真正的规律是句法：**义务标记 +（主体词）+ 谓语动词** → 剥掉标记与主体词、谓语原样保留，
 * 整句自然变成陈述式承诺。所以本引擎认的是「模式」而不是「词」，词表只作为**约束**存在
 * （位置约束 + 谓语白名单 + 假词黑名单），而不是替换规则本身。
 *
 * 语义守卫（用户 2026-10-15：「这些要结合前后的语义才能去替换」）五道：
 *  ① 位置：标记必须落在**分句首**（行首 / 标点后）——否则「需求 / 供应 / 适应 / 相应 / 应对」会被误切；
 *  ② 右邻：标记后必须紧跟**响应谓语白名单**（中间只允许隔主体词）——「须在合同签订后 30 日内完成交付」
 *     这类带状语的句子因此不自动改，只给人工提示（宁可漏改，不可错改）；
 *  ③ 角色：标记后是**采购人/甲方一侧** → 这条不是对我的要求，不改，标人工确认；
 *  ④ 自证：改写结果必须满足「把 changes 逐条作用回原文 === response」逐字成立（verifyRewrite）——
 *     程序自己证明「只调整字眼，原文一个字没动」，任何不满足即放弃改写；
 *  ⑤ 不确定就只提示：禁止类 / 许可类 / 拿不准的一律不改写，只给原因，由人逐条采纳。
 *
 * 四类处理档位（不是四类替换）：
 *  义务类（要求/需/应/须/必须…）→ **剥离标记**，谓语保留；
 *  量化边界（不得少于/不低于/不得超过…）→ **原样保留**（它本身就是承诺口径，删了反而丢信息）；
 *  禁止行为（不得转包/严禁分包…）→ **标记换「不」**（承诺不做）+ 人工确认；
 *  许可建议（可/可以/宜/建议…）→ **不改**，只提示：招标侧选做项，改成承诺会凭空增加验收义务
 *     （与既有 param_escalation「参数加码」红线同源）。
 */

export type RewriteRule =
  | "obligation_strip"
  | "subject_strip"
  | "prohibition_flip"
  | "boundary_keep"
  | "permission_hint"

/** 单处改动：removed → inserted（纯删除时 inserted 为空串），at 为原文下标 */
export type ParamRewriteChange = {
  rule: RewriteRule
  at: number
  removed: string
  inserted: string
  note: string
}

export type ParamRewrite = {
  original: string
  /** 响应式表述；未改写时与原文逐字一致 */
  response: string
  changes: ParamRewriteChange[]
  /** 改写成立（有改动且通过回读自证） */
  rewritten: boolean
  /** 需要人工确认口径（禁止类 / 许可类 / 非投标人义务 / 标记后无谓语等） */
  needs_review: boolean
  /** 人工确认的原因（面板直接展示，不写进响应文本） */
  reason: string
}

/** 义务标记：按长度降序匹配（「要求」必须先于「要」），否则「要求提供」会被切成「要」+「求提供」 */
const OBLIGATION_MARKERS = ["要求", "需要", "应当", "必须", "务必", "须", "需", "应", "要"] as const
/** 禁止类标记 */
const PROHIBITION_MARKERS = ["不允许", "不得", "不应", "不可", "不能", "严禁", "禁止"] as const
/** 许可/建议类标记 */
const PERMISSION_MARKERS = ["可以", "允许", "建议", "宜", "可"] as const

/** 量化边界词：跟在禁止标记后时，整句是「下限/上限」承诺口径，不是禁止行为 */
const BOUNDARY_WORDS = ["少于", "低于", "晚于", "早于", "超过", "超出", "大于", "高于", "多于", "小于", "短于"] as const

/**
 * 响应谓语白名单：标记后必须紧跟其中之一（中间只允许隔主体词）。
 * 这张表的作用是**约束识别**（防止把「需求」「应对」当成标记），不是替换表——
 * 改写时谓语一字不动，被删的只有标记与主体词。
 */
const RESPONSE_VERBS = [
  "承诺提供", "负责提供",
  "提供", "支持", "具备", "满足", "实现", "完成", "配备", "采用", "建设", "部署", "集成", "对接",
  "兼容", "遵循", "符合", "达到", "覆盖", "保障", "确保", "出具", "提交", "附上", "承诺", "负责",
  "安排", "保证", "配置", "安装", "调试", "培训", "维护", "升级", "迁移", "替换", "同步", "接入",
  "开放", "输出", "响应", "受理", "记录", "备份", "恢复", "监控", "告警", "统计", "查询", "导出",
  "打印", "签章", "签署", "认证", "授权", "加盖", "说明", "列明", "注明", "明确", "实行", "执行",
  "落实", "组建", "派驻", "交付", "运送", "运输", "包含", "内置", "预留",
] as const

/** 投标人一侧主体词：可随标记一并剥掉（响应主体默认我方，留着反而像第三人称叙述） */
const BIDDER_SUBJECTS = [
  "投标人", "供应商", "中标人", "成交供应商", "响应人", "报价人", "乙方", "承包人", "承建方", "供货商", "服务商", "供货方",
] as const
/** 采购人一侧主体词：出现即说明这条不是对我的要求 */
const PURCHASER_SUBJECTS = ["采购人", "招标人", "甲方", "发包人", "建设单位", "使用单位", "业主"] as const

/**
 * 假词黑名单 A（标记 + 右邻字）：这些词**以标记字开头但不是义务标记**。
 * 「应对」「需求」「可配置」这类必须整词跳过——否则「应对突发情况」会被切成「应」+「对突发情况」。
 */
const FALSE_PREFIXES = [
  "应对", "应急", "应力", "应酬", "应允", "应诉", "适应", "相应", "对应", "反应", "效应",
  "需求", "供需", "必需品", "无需", "不须", "须知", "须臾",
  "要点", "要紧", "要害", "要闻", "主要", "概要", "摘要", "次要", "重要", "首要",
  "可靠", "可行", "可用", "可控", "可选", "可达", "可扩展", "可视", "可持续", "可维护", "可管理",
  "可定制", "可配置", "可移植", "可兼容", "可观", "可比", "可变", "可查", "可见", "可取", "可疑",
  "可读", "可写", "可编程", "可追溯", "可审计", "可扩展性", "可用性", "可靠性",
] as const

/**
 * 假词黑名单 B（左邻字 + 标记）：单字标记最容易在这里翻车——
 * 「主要提供」「无需提供」「按需配置」里的「要/需」都不是义务标记，而它们**以标记字结尾**，
 * 用「标记+右邻」的黑名单 A 抓不到（A 只认以标记字开头的词），必须按「左邻 + 标记」的二字词判。
 */
const FALSE_BIGRAMS = new Set([
  // 应：本行业最高频的「响应」必须在内——漏掉它，「7×24 小时运维响应」会被当成义务标记
  "响应", "呼应", "因应", "感应", "照应", "适应", "相应", "对应", "反应", "效应", "供应", "应诉", "应允", "应酬", "应力",
  // 需
  "需求", "供需", "必需", "无需", "亟需", "急需", "不须", "毋须", "无须", "何须", "须要", "须知", "所要",
  // 要
  "主要", "重要", "首要", "次要", "概要", "摘要", "简要", "想要", "只要", "必要", "就要", "机要", "将要", "快要",
  "正要", "索要", "紧要", "急要", "莫要", "不必",
  // 可
  "认可", "许可", "宁可", "尚可", "即可", "皆可", "未可", "方可",
])

/**
 * 单字标记的左邻字黑名单：这些字说明标记已与前面的字粘成名词——
 * 「需求」（求+需）、「采购」（购+…）、「按需」（按+需）、「技术应…」（术+应）、「满足…」（足+…）。
 * 左邻是这些字时不认标记，宁可漏改也不改错。
 */
const NOMINAL_LEFT_CHARS = "求购标采足合据按件术目户"

/**
 * 只在**分句首**才算标记的多字标记：「要求」「需要」在中段几乎总是名词短语的一部分
 * （按要求 / 满足要求 / 招标要求 / 技术要求 / 采购需求），删掉会得到「按提供 X」这种病句。
 */
const HEAD_ONLY_MARKERS = new Set(["要求", "需要"])

/** 禁止类假后缀：「不得而知」「不得已」不是禁止行为，不翻转为「不…」 */
const PROHIBITION_FALSE_TAILS = ["而", "之", "得"]

/** 分句首边界：行首 / 空白 / 常见标点之后才认标记（中文无词边界，位置是最可靠的第一道闸） */
const CLAUSE_HEAD_BOUNDARY_RE = /[\s，。；：、,;:！？!?（）()【】“”"'—]/

/** 禁止类后允许先出现的功能词（「不得**将**本项目转包」），跳过它们再判边界词 */
const PROHIBITION_LEAD_WORDS = ["将", "把", "对", "以", "向", "给", "为", "再", "擅自", "私自"] as const

function isClauseHead(text: string, at: number): boolean {
  return at === 0 || CLAUSE_HEAD_BOUNDARY_RE.test(text[at - 1])
}

/** 在 at 处匹配标记（长度降序），返回命中的标记与所属档位 */
function matchMarkerAt(text: string, at: number): { marker: string; family: "obligation" | "prohibition" | "permission" } | null {
  for (const m of OBLIGATION_MARKERS) if (text.startsWith(m, at)) return { marker: m, family: "obligation" }
  for (const m of PROHIBITION_MARKERS) if (text.startsWith(m, at)) return { marker: m, family: "prohibition" }
  for (const m of PERMISSION_MARKERS) if (text.startsWith(m, at)) return { marker: m, family: "permission" }
  return null
}

function falsePrefixAt(text: string, at: number): string {
  for (const p of FALSE_PREFIXES) if (text.startsWith(p, at)) return p
  return ""
}

/**
 * 认标记的唯一入口：位置/假词/左邻三道闸都过才算。
 * 顺序很重要——先整词跳过（黑名单 A），再按左邻二字词跳过（黑名单 B），最后才判标记。
 */
function recognizeAt(text: string, at: number): { marker: string; family: "obligation" | "prohibition" | "permission" } | null {
  const hit = matchMarkerAt(text, at)
  if (!hit) return null
  if (at > 0 && FALSE_BIGRAMS.has(text.slice(at - 1, at + 1))) return null
  if (HEAD_ONLY_MARKERS.has(hit.marker) && !isClauseHead(text, at)) return null
  if (hit.marker.length === 1 && at > 0 && NOMINAL_LEFT_CHARS.includes(text[at - 1])) return null
  return hit
}

/** 跳过空白与主体词，返回跳过长度与角色 */
function skipSubject(text: string, from: number): { skip: number; role: "bidder" | "purchaser" | "" } {
  const lead = /^\s*/.exec(text.slice(from))?.[0].length ?? 0
  const body = text.slice(from + lead)
  for (const s of PURCHASER_SUBJECTS) if (body.startsWith(s)) return { skip: lead + s.length, role: "purchaser" }
  for (const s of BIDDER_SUBJECTS) if (body.startsWith(s)) return { skip: lead + s.length, role: "bidder" }
  return { skip: lead, role: "" }
}

function verbAt(text: string, from: number): string {
  const body = text.slice(from)
  for (const v of RESPONSE_VERBS) if (body.startsWith(v)) return v
  return ""
}

/** 把 changes 逐条作用回原文，得到响应文本（下标升序、互不重叠，由扫描顺序保证） */
function applyChanges(original: string, changes: readonly ParamRewriteChange[]): string {
  let out = ""
  let cursor = 0
  for (const c of changes) {
    out += original.slice(cursor, c.at) + c.inserted
    cursor = c.at + c.removed.length
  }
  return out + original.slice(cursor)
}

/**
 * 回读自证：把 changes 作用回原文必须逐字得到 response。
 * 这是「只调整字眼、原文一个字没动」的机器证明——不成立就说明引擎动了不该动的地方，必须放弃改写。
 */
export function verifyRewrite(original: string, response: string, changes: readonly ParamRewriteChange[]): boolean {
  return applyChanges(original, changes) === response
}

/** 扫描一行里的全部义务/禁止/许可标记（面板与测试用来解释「为什么改/为什么不改」） */
export function scanRequirementMarkers(text: string): { at: number; marker: string; family: string }[] {
  const s = String(text ?? "")
  const out: { at: number; marker: string; family: string }[] = []
  for (let i = 0; i < s.length; i += 1) {
    const fp = falsePrefixAt(s, i)
    if (fp) {
      i += fp.length - 1
      continue
    }
    const hit = recognizeAt(s, i)
    if (hit) out.push({ at: i, marker: hit.marker, family: hit.family })
  }
  return out
}

/**
 * 单条招标要求 → 响应式表述。**不改写也是合法结果**：拿不准时只给 needs_review + reason。
 */
export function rewriteRequirementToResponse(text: string): ParamRewrite {
  const original = String(text ?? "")
  const empty: ParamRewrite = { original, response: original, changes: [], rewritten: false, needs_review: false, reason: "" }
  if (!original.trim()) return { ...empty, reason: "空行" }

  const changes: ParamRewriteChange[] = []
  const reviewNotes: string[] = []
  let i = 0
  while (i < original.length) {
    const fp = falsePrefixAt(original, i)
    if (fp) {
      i += fp.length
      continue
    }
    const hit = recognizeAt(original, i)
    if (!hit) {
      i += 1
      continue
    }
    const markerEnd = i + hit.marker.length

    if (hit.family === "prohibition") {
      // 量化边界优先：「不得少于 3 年」是下限承诺口径，删改反而丢信息
      const lead = PROHIBITION_LEAD_WORDS.find((w) => original.startsWith(w, markerEnd))
      const afterLead = markerEnd + (lead?.length ?? 0)
      if (BOUNDARY_WORDS.some((w) => original.startsWith(w, afterLead))) {
        changes.push({
          rule: "boundary_keep",
          at: i,
          removed: hit.marker,
          inserted: hit.marker,
          note: "量化边界（不得少于/不得超过…）本身就是承诺口径，原样保留",
        })
        i = markerEnd
        continue
      }
      // 假后缀（不得而知 / 不得已）不是禁止行为，不动也不提示
      if (PROHIBITION_FALSE_TAILS.some((t) => original.startsWith(t, afterLead))) {
        i = markerEnd
        continue
      }
      // 禁止行为 → 换成「不」（承诺不做）。语义没变，但语气要人看一眼
      changes.push({
        rule: "prohibition_flip",
        at: i,
        removed: hit.marker,
        inserted: "不",
        note: `禁止类「${hit.marker}」改为承诺不做「不…」，请确认口径`,
      })
      reviewNotes.push(`禁止类表述（${hit.marker}）已改为承诺不做，请确认响应口径`)
      i = markerEnd
      continue
    }

    if (hit.family === "permission") {
      // 许可/建议类：招标侧选做项，改成承诺＝凭空增加验收义务（param_escalation 同源红线）
      const sub = skipSubject(original, markerEnd)
      const verb = verbAt(original, markerEnd + sub.skip)
      if (verb) {
        reviewNotes.push(`许可/建议类表述（${hit.marker}${verb}）属招标侧选做项，改成承诺会凭空增加验收义务，需人工决定是否承诺`)
      }
      i = markerEnd
      continue
    }

    // 义务类：剥掉标记（+ 投标人一侧主体词），谓语原样保留
    const sub = skipSubject(original, markerEnd)
    if (sub.role === "purchaser") {
      reviewNotes.push(`该条义务主体是采购人一侧（${original.slice(markerEnd, markerEnd + sub.skip).trim()}），不是投标人的响应义务，需人工确认是否响应`)
      i = markerEnd + sub.skip
      continue
    }
    const verb = verbAt(original, markerEnd + sub.skip)
    if (!verb) {
      reviewNotes.push(`义务标记「${hit.marker}」后未紧跟可识别的谓语动词（可能带状语，如「须在合同签订后 30 日内完成交付」），未自动改写，请人工确认响应式表述`)
      i = markerEnd
      continue
    }
    changes.push({
      rule: "obligation_strip",
      at: i,
      removed: hit.marker,
      inserted: "",
      note: `剥离义务标记「${hit.marker}」，谓语「${verb}」原样保留`,
    })
    if (sub.role === "bidder" && sub.skip > 0) {
      const subjectText = original.slice(markerEnd, markerEnd + sub.skip)
      changes.push({
        rule: "subject_strip",
        at: markerEnd,
        removed: subjectText,
        inserted: "",
        note: `剥离投标人一侧主体词「${subjectText.trim()}」（响应主体默认我方）`,
      })
    }
    i = markerEnd + sub.skip
  }

  // 自证不过就整体放弃改写：宁可只提示，也不能动原文
  const response = applyChanges(original, changes)
  if (!verifyRewrite(original, response, changes)) {
    return {
      original,
      response: original,
      changes: [],
      rewritten: false,
      needs_review: true,
      reason: "改写结果未能通过「除字眼外逐字一致」自证，已放弃自动改写，请人工确认",
    }
  }
  const rewritten = changes.some((c) => c.rule === "obligation_strip" || c.rule === "subject_strip" || c.rule === "prohibition_flip")
  return {
    original,
    response,
    changes,
    rewritten,
    needs_review: reviewNotes.length > 0,
    reason: reviewNotes.join("；"),
  }
}
