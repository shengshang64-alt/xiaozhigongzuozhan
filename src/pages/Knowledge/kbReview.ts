// ---------------------------------------------------------------------------
// 知识原子审核队列（2026-10-30 知识库 P0-5 纯逻辑层）
//
// 依据《知识库改造需求文档 v1.0》§7：
//   「审核工作台是人机交互的核心，决定项目成败」
//   「一个场景都勾不出来的，自动驳回」（原则 P3）
//
// 本文件只做**纯逻辑**（排序/分组/批量判定），不碰 React，便于单测。
// UI 在 components/knowledge/KbReviewPage.tsx。
//
// 设计要点：
//   ① 排序严格按 §7.3 第 5 条：冲突组优先 → 高usage潜力 → 近期 → 低置信
//   ② 批量操作是"把 1842 条压到几小时"的关键，必须可预览、可撤销
//   ③ 快捷键映射集中在一处，UI 只负责绑定
// ---------------------------------------------------------------------------

import { ATOM_TYPES, LOW_CONFIDENCE, type AtomType, type AtomStatus } from "./kbAtoms"

/** 审核队列里的一条原子（从 PB 取回的形态） */
export type ReviewAtom = {
  id: string
  atomType: AtomType
  title: string
  body: string
  subjectKey: string
  confidence: number
  kbTrack: string
  kbBucket: string
  kbSection: string
  usableFor: string[]
  sourceDocId: string
  docName: string
  sourceAnchor: string
  sourceQuote: string
  conflictGroup: string
  validUntil: string
  contentStatus: AtomStatus
  version: number
  usageCount: number
  createdAt: string
}

// ===========================================================================
// 一、排序（§7.3 第 5 条）
// ===========================================================================

/**
 * 审核优先级打分。
 *
 * 顺序（分数从高到低）：
 *   1. 冲突组优先（同一主题不同结论，人必须裁决）
 *   2. 高 usage 潜力（case/metric 最常被复用）
 *   3. 近期文档
 *   4. 低置信最后（需要更仔细看，放后面避免一开始就卡住）
 */
export function reviewPriorityScore(a: ReviewAtom, now = Date.now()): number {
  let s = 0
  // 冲突组：最高优先
  if (a.conflictGroup) s += 10000
  // 类型潜力
  if (a.atomType === "case") s += 1000
  else if (a.atomType === "metric") s += 900
  else if (a.atomType === "qualification") s += 600
  else if (a.atomType === "policy") s += 500
  else if (a.atomType === "product_capability") s += 400
  else if (a.atomType === "play") s += 300
  else if (a.atomType === "script") s += 200
  // 近期：180 天内满分，越久越低
  const ts = Date.parse(a.createdAt || "")
  if (Number.isFinite(ts)) {
    const days = (now - ts) / 86_400_000
    s += Math.max(0, 300 - Math.min(days, 300))
  }
  // 低置信扣分（放后面）
  if (a.confidence < LOW_CONFIDENCE) s -= 500
  return s
}

/** 按审核优先级排序（不修改原数组） */
export function sortForReview(atoms: ReviewAtom[]): ReviewAtom[] {
  return atoms
    .map((a) => ({ a, s: reviewPriorityScore(a) }))
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a)
}

// ===========================================================================
// 二、筛选
// ===========================================================================

export type ReviewFilter = "all" | "conflict" | "highConfidence" | "lowConfidence" | "missingUsableFor"

export const FILTER_LABEL: Record<ReviewFilter, string> = {
  all: "全部待审",
  conflict: "冲突待裁决",
  highConfidence: "高置信",
  lowConfidence: "低置信",
  missingUsableFor: "未勾用途",
}

/** 应用筛选 */
export function applyFilter(atoms: ReviewAtom[], filter: ReviewFilter): ReviewAtom[] {
  switch (filter) {
    case "conflict":
      return atoms.filter((a) => Boolean(a.conflictGroup))
    case "highConfidence":
      return atoms.filter((a) => a.confidence >= LOW_CONFIDENCE)
    case "lowConfidence":
      return atoms.filter((a) => a.confidence < LOW_CONFIDENCE)
    case "missingUsableFor":
      return atoms.filter((a) => !a.usableFor.length)
    default:
      return atoms
  }
}

/** 队列统计（顶部四个数字） */
export function reviewStats(atoms: ReviewAtom[]): { total: number; conflict: number; highConfidence: number; lowConfidence: number } {
  return {
    total: atoms.length,
    conflict: atoms.filter((a) => Boolean(a.conflictGroup)).length,
    highConfidence: atoms.filter((a) => a.confidence >= LOW_CONFIDENCE).length,
    lowConfidence: atoms.filter((a) => a.confidence < LOW_CONFIDENCE).length,
  }
}

// ===========================================================================
// 三、通过/驳回判定（§7.2 核心规则）
// ===========================================================================

export type ReviewAction =
  | { kind: "approve"; atomId: string }
  | { kind: "reject"; atomId: string; reason: RejectReason }
  | { kind: "edit"; atomId: string }

/** 驳回原因（5 选 1，不填字——§7.2「不填字」是效率关键） */
export const REJECT_REASONS = ["套话", "重复", "过期", "不准", "不适用"] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/**
 * 是否允许通过。
 *
 * **硬规则（原则 P3）**：`usable_for` 至少勾一项才能通过。
 * 「一个场景都勾不出来的，自动驳回」——这是把"有用吗"翻译成
 * "以后能在哪儿用"的关键机制，必须是硬校验而非提示。
 */
export function canApprove(atom: ReviewAtom, selectedUsableFor: string[]): { ok: boolean; reason?: string } {
  const uf = selectedUsableFor.length ? selectedUsableFor : atom.usableFor
  if (!uf.length) {
    return {
      ok: false,
      reason: "请至少勾选一个用途（方案/PPT/标书/报价/答疑）——这条以后能在哪儿用，是审核的核心判断",
    }
  }
  return { ok: true }
}

/** 乐观判定：不看可用性，只看其他阻断条件（用于批量预览） */
export function wouldBlockApprove(atom: ReviewAtom): string | null {
  if (!atom.title?.trim()) return "标题为空"
  if (!atom.body?.trim() && !atom.sourceQuote?.trim()) return "正文与摘录都为空"
  if (atom.contentStatus !== "pending" && atom.contentStatus !== "draft") return `当前状态为 ${atom.contentStatus}，不能直接通过`
  return null
}

// ===========================================================================
// 四、批量操作（§7.3，把 1842 条压到几小时的关键）
// ===========================================================================

export type BatchPlan =
  | { kind: "dedupeGroup"; subjectKey: string; keepId: string; supersedeIds: string[]; reason: string }
  | { kind: "rejectLowConfidenceFacts"; atomIds: string[]; reason: string }
  | { kind: "rejectJunk"; atomIds: string[]; reason: string }
  | { kind: "rejectBySource"; docId: string; docName: string; atomIds: string[]; reason: string }

/** 套话/过短判定（§7.3 第 3 条） */
const JUNK_PATTERNS = [
  /随着.{0,10}(的发展|进步|推进)/,
  /^(公司简介|企业愿景|组织架构|版权声明|免责声明)/,
  /(XXX|ＸＸＸ|待补充|待填写|待定)/,
]
export function isJunkAtom(a: ReviewAtom): boolean {
  if (a.body.trim().length < 20) return true
  return JUNK_PATTERNS.some((re) => re.test(a.body))
}

/**
 * 生成「同组一键通过」计划（§7.3 第 1 条）。
 *
 * 同一 subject_key 下多条，保留 version 最高的（同版本取置信度最高），其余标 superseded。
 */
export function planDedupeGroups(atoms: ReviewAtom[]): BatchPlan[] {
  const byKey = new Map<string, ReviewAtom[]>()
  for (const a of atoms) {
    if (!a.subjectKey) continue
    const arr = byKey.get(a.subjectKey) ?? []
    arr.push(a)
    byKey.set(a.subjectKey, arr)
  }
  const plans: BatchPlan[] = []
  for (const [key, group] of byKey) {
    if (group.length < 2) continue
    const sorted = group.slice().sort((x, y) => {
      if (y.version !== x.version) return y.version - x.version
      return y.confidence - x.confidence
    })
    const keep = sorted[0]
    plans.push({
      kind: "dedupeGroup",
      subjectKey: key,
      keepId: keep.id,
      supersedeIds: sorted.slice(1).map((a) => a.id),
      reason: `同主题 ${group.length} 条，保留最新版本 v${keep.version}`,
    })
  }
  return plans.sort((x, y) => {
    const cx = x.kind === "dedupeGroup" ? x.supersedeIds.length : 0
    const cy = y.kind === "dedupeGroup" ? y.supersedeIds.length : 0
    return cy - cx
  })
}

/**
 * 2026-10-31 新增：**内容级去重**（补 subject_key 去重的盲区）。
 *
 * 实测问题：B0 批次 682 条 approved 里有 **35 组标题完全相同**，但 subject_key 不同
 * （模型对同一事实起了不同的 key，如 prod:日志记录检索|功能描述 vs
 *  prod:集成平台日志记录检索|功能描述），planDedupeGroups 按 key 分组抓不到。
 * 这些原子正文几乎逐字相同，进检索会挤掉其他内容（实测同一次查询返回的
 * 前两条就是同一句话的两种写法）。
 *
 * 判据：归一化正文后比较相似度（去空白标点、取前 100 字），完全相同或
 * 高度包含即视为重复。保留置信度高、正文更完整的那条。
 */
export function planContentDuplicates(atoms: ReviewAtom[]): BatchPlan[] {
  /** 归一化：去空白与标点，便于比较 */
  const norm = (s: string) => String(s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")

  const plans: BatchPlan[] = []
  const byBody = new Map<string, ReviewAtom[]>()
  for (const a of atoms) {
    const n = norm(a.body || a.sourceQuote || "")
    if (n.length < 20) continue // 太短的不参与（短句本来就常见）
    // 用前 100 字做键：足以区分不同事实，又能抓住"同一个事实不同措辞"
    const key = n.slice(0, 100)
    const arr = byBody.get(key) ?? []
    arr.push(a)
    byBody.set(key, arr)
  }

  for (const [, group] of byBody) {
    if (group.length < 2) continue
    // 保留：置信度高 → 正文长（信息更完整） → 原顺序
    const sorted = group.slice().sort((x, y) => {
      if (y.confidence !== x.confidence) return y.confidence - x.confidence
      return String(y.body).length - String(x.body).length
    })
    const keep = sorted[0]
    plans.push({
      kind: "dedupeGroup",
      subjectKey: `content:${norm(keep.body).slice(0, 40)}`,
      keepId: keep.id,
      supersedeIds: sorted.slice(1).map((a) => a.id),
      reason: `正文重复 ${group.length} 条（key 不同但内容相同），保留置信度最高者`,
    })
  }
  return plans
}

/**
 * 2026-11-01 新增：**语义级去重**（补前两级去重的盲区）。
 *
 * 实测问题（真实库，1376 条 approved）：
 *   同一政策事实「2019 年三级医院电子病历达 3 级」被抽成 **6 条**，
 *   subject_key 6 种完全不同的结构（有的把政策文件名当前缀、有的把主题放前面），
 *   而且**开头引用的文件名各不相同** → planContentDuplicates 按前 100 字比较也抓不到。
 *   后果：一次检索同时返回 3级/4级/5级 三个互斥要求（其中 3 级是 2019 年旧要求、
 *   5 级是当前要求），生成时会引用过期政策。
 *
 * 判据：抽取「语义指纹」= 类型 + 关键数值特征（X级/X年/X%）+ 主题核心词，
 *       指纹相同即视为同一事实的不同表述。这比字面比较更鲁棒。
 */

/** 抽取语义指纹：把"同一事实的不同写法"映射到同一串 */
export function semanticFingerprint(a: ReviewAtom): string {
  const text = `${a.title} ${a.body}`.replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
  const feats: string[] = []
  // 级别特征（X级 / X级以上）
  const levels = [...text.matchAll(/([1-9])\s*级/g)].map((m) => `L${m[1]}`)
  feats.push(...new Set(levels))
  // 年份特征
  const years = [...text.matchAll(/(20\d{2})\s*年/g)].map((m) => `Y${m[1]}`)
  feats.push(...new Set(years))
  // 百分比
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => `P${m[1]}`)
  feats.push(...new Set(pcts))
  // 主题核心词（去重后前 3 个）
  const topics = ["电子病历应用水平", "互联互通", "智慧服务", "智慧管理", "等级保护", "绩效考核"]
    .filter((t) => text.includes(t))
  feats.push(...topics)

  // 至少要有 2 个特征才做指纹（否则太泛，会把不同事实归并）
  if (feats.length < 2) return ""
  return `${a.atomType}|${feats.sort().join(",")}`
}

/**
 * 生成「语义重复」候选计划（**必须人工确认，不可自动执行**）。
 *
 * ⚠️ 2026-11-01 实测教训：这个函数的判据太粗，**差点误删有效知识**。
 *   典型反例——以下 5 条被语义指纹判为「同一事实」（都是 policy + 电子病历应用水平 + 级别）：
 *     · 2019 年国家要求三级医院 ≥3 级   （历史政策）
 *     · 2020 年国家要求 ≥4 级           （后续政策）
 *     · 2025 年安徽省要求 ≥5 级         （地方政策，更严）
 *     · 某医院已达 6 级                 （项目案例）
 *     · 投标人须协助通过四级评审         （本项目具体要求）
 *   它们**全是独立且有价值的**——删掉任何一条都会丢失"政策演进"或"地方要求"信息。
 *
 * 因此本函数只产出**候选**，供审核台作为"建议合并"提示，**禁止脚本自动 apply**。
 * 真正的自动去重只用 planDedupeGroups（同 key）与 planContentDuplicates（近逐字相同）。
 */
export function planSemanticDuplicates(atoms: ReviewAtom[]): BatchPlan[] {
  const byFp = new Map<string, ReviewAtom[]>()
  for (const a of atoms) {
    const fp = semanticFingerprint(a)
    if (!fp) continue
    const arr = byFp.get(fp) ?? []
    arr.push(a)
    byFp.set(fp, arr)
  }
  const plans: BatchPlan[] = []
  for (const [fp, group] of byFp) {
    if (group.length < 2) continue
    const sorted = group.slice().sort((x, y) => {
      if (y.confidence !== x.confidence) return y.confidence - x.confidence
      return String(y.body).length - String(x.body).length
    })
    const keep = sorted[0]
    plans.push({
      kind: "dedupeGroup",
      subjectKey: `sem:${fp}`,
      keepId: keep.id,
      supersedeIds: sorted.slice(1).map((a) => a.id),
      reason: `语义重复 ${group.length} 条（同一事实的不同表述），保留置信度最高者`,
    })
  }
  return plans
}

/** 生成「低置信 fact 批量驳回」计划（§7.3 第 2 条） */
export function planRejectLowConfidenceFacts(atoms: ReviewAtom[]): BatchPlan | null {
  const ids = atoms.filter((a) => a.atomType === "fact" && a.confidence < LOW_CONFIDENCE).map((a) => a.id)
  if (!ids.length) return null
  return {
    kind: "rejectLowConfidenceFacts",
    atomIds: ids,
    reason: `置信度低于 ${LOW_CONFIDENCE} 的事实类原子，多为模型猜测`,
  }
}

/** 生成「套话批量驳回」计划（§7.3 第 3 条） */
export function planRejectJunk(atoms: ReviewAtom[]): BatchPlan | null {
  const ids = atoms.filter(isJunkAtom).map((a) => a.id)
  if (!ids.length) return null
  return { kind: "rejectJunk", atomIds: ids, reason: "正文过短或含套话/占位，无信息量" }
}

/** 生成「按来源批量驳回」计划（§7.3 第 4 条：整篇质量差） */
export function planRejectBySource(atoms: ReviewAtom[]): BatchPlan[] {
  const byDoc = new Map<string, ReviewAtom[]>()
  for (const a of atoms) {
    if (!a.sourceDocId) continue
    const arr = byDoc.get(a.sourceDocId) ?? []
    arr.push(a)
    byDoc.set(a.sourceDocId, arr)
  }
  const plans: BatchPlan[] = []
  for (const [docId, group] of byDoc) {
    // 整篇驳回条件：该文档的原子中，不合格（套话或低置信）占比 > 60%
    const bad = group.filter((a) => isJunkAtom(a) || a.confidence < LOW_CONFIDENCE).length
    if (group.length >= 3 && bad / group.length > 0.6) {
      plans.push({
        kind: "rejectBySource",
        docId,
        docName: group[0].docName,
        atomIds: group.map((a) => a.id),
        reason: `${group.length} 条里 ${bad} 条质量不合格（${Math.round((bad / group.length) * 100)}%），建议整篇驳回后调提示词重跑`,
      })
    }
  }
  return plans.sort((x, y) => {
    const cx = x.kind === "rejectBySource" ? x.atomIds.length : 0
    const cy = y.kind === "rejectBySource" ? y.atomIds.length : 0
    return cy - cx
  })
}

/** 全部批量计划（界面依次展示，让用户逐项确认） */
export function planAllBatches(atoms: ReviewAtom[]): BatchPlan[] {
  const out: BatchPlan[] = []
  out.push(...planDedupeGroups(atoms))
  const lowFact = planRejectLowConfidenceFacts(atoms)
  if (lowFact) out.push(lowFact)
  const junk = planRejectJunk(atoms)
  if (junk) out.push(junk)
  out.push(...planRejectBySource(atoms))
  return out
}

/** 批量计划的影响统计（让用户知道一键能处理多少） */
export function batchImpact(plans: BatchPlan[]): { handled: number; remaining: number; note: string } {
  const handled = plans.reduce((n, p) => {
    if (p.kind === "dedupeGroup") return n + p.supersedeIds.length
    return n + p.atomIds.length
  }, 0)
  return { handled, remaining: 0, note: handled ? `批量可处理 ${handled} 条` : "没有可自动处理的批次" }
}

// ===========================================================================
// 五、键盘快捷键（§7.2 必须实现）
// ===========================================================================

export type ShortcutAction =
  | { kind: "approve" }
  | { kind: "reject" }
  | { kind: "edit" }
  | { kind: "setType"; type: AtomType }
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "undo" }
  | { kind: "focusUsableFor" }
  | { kind: "toggleSource" }
  | { kind: "help" }
  | { kind: "none" }

/**
 * 把键盘事件映射成动作。
 *
 * 注意：
 *   · 在输入框/文本域里时不触发（避免打字时误操作）
 *   · 数字 1-8 对应 8 种原子类型（顺序同 ATOM_TYPES）
 */
export function mapKeyToAction(key: string, opts?: { inEditable?: boolean }): ShortcutAction {
  if (opts?.inEditable) return { kind: "none" }
  const k = key.length === 1 ? key.toLowerCase() : key
  switch (k) {
    case "a":
      return { kind: "approve" }
    case "r":
      return { kind: "reject" }
    case "e":
      return { kind: "edit" }
    case "j":
      return { kind: "next" }
    case "k":
      return { kind: "prev" }
    case "u":
      return { kind: "undo" }
    case "Tab":
      return { kind: "focusUsableFor" }
    case " ":
      return { kind: "toggleSource" }
    case "?":
      return { kind: "help" }
    default: {
      const n = Number(k)
      if (Number.isInteger(n) && n >= 1 && n <= ATOM_TYPES.length) {
        return { kind: "setType", type: ATOM_TYPES[n - 1] }
      }
      return { kind: "none" }
    }
  }
}

/** 快捷键帮助文本（按 `?` 显示） */
export const SHORTCUT_HELP: { key: string; desc: string }[] = [
  { key: "A", desc: "通过（需先勾选至少一个用途）" },
  { key: "R", desc: "驳回（5 选 1 原因）" },
  { key: "E", desc: "编辑标题/正文/类型" },
  { key: "1-8", desc: "快速改原子类型" },
  { key: "J / K", desc: "下一条 / 上一条" },
  { key: "U", desc: "撤销上一步（10 秒内）" },
  { key: "Tab", desc: "聚焦用途勾选组" },
  { key: "空格", desc: "展开/收起原文对照" },
  { key: "?", desc: "显示本帮助" },
]

// ===========================================================================
// 六、撤销栈（§7.2 的 U 键，10 秒内可撤）
// ===========================================================================

export type UndoEntry = {
  atomId: string
  /** 撤销时要恢复的状态 */
  prevStatus: AtomStatus
  prevUsableFor: string[]
  action: "approve" | "reject" | "edit"
  at: number
}

/** 撤销窗口（毫秒） */
export const UNDO_WINDOW_MS = 10_000

/** 是否还能撤销（10 秒内） */
export function canUndo(entry: UndoEntry | null, now = Date.now()): boolean {
  if (!entry) return false
  return now - entry.at <= UNDO_WINDOW_MS
}

/** 撤销剩余秒数（界面倒计时用） */
export function undoRemainingSec(entry: UndoEntry | null, now = Date.now()): number {
  if (!entry) return 0
  return Math.max(0, Math.ceil((UNDO_WINDOW_MS - (now - entry.at)) / 1000))
}
