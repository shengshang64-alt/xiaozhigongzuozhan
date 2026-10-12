import {
  FORMAT_RULE_LABEL,
  findIntraDupPairs,
  formatCheckReport,
  metaLeftoverHits,
  metricConflictHits,
  splitParagraphs,
  type DupTarget,
  type FormatCheckHit,
  type FormatCheckKey,
  type FormatCheckRule,
} from "@/pages/BidWorkspace/bidTypes"
import { LEGACY_GEN_ERROR_NOTE } from "./genFailureSummary"
import type { Chapter } from "./solutionTypes"

// ---------------------------------------------------------------------------
// R252 方案交付前本地体检（零 AI、零费用、零新数据模型）——
// 标书侧早有「交卷体检」承担 15+ 项确定性硬核验，而方案是医院直接收到的交付物，
// 此前只有 AI 五维自检 + 导出时空章节提示，交付前没有任何零费用的确定性硬伤体检。
// 本模块不另起一套规则口径：直接复用 bidTypes 的同一批纯函数（bidTypes 的 Chapter
// 类型本身就 import 自 solutionTypes，两侧同一个类型，无需任何 cast），
// 只补三项方案侧独有判定（合法占位未填 / 章完成态硬伤 / 跨章重复段）。
// 契约：只报不拦——任何命中都不阻断导出，与标书侧「编造嫌疑未清零禁止导出」
// 维持「只报告不拦截」的既有裁定一致。
// ---------------------------------------------------------------------------

/** 体检规则名 = 标书侧规则 + 方案侧独有规则 */
export type SolCheckRule =
  | FormatCheckRule
  | "placeholder_leftover"
  | "failed_chapter"
  | "empty_chapter"
  | "underlength_chapter"
  | "intra_dup"

/** 中文口径：复用侧直接取标书侧 FORMAT_RULE_LABEL（单一真源），只补方案侧新词条 */
export const SOL_CHECK_LABEL: Record<SolCheckRule, string> = {
  ...FORMAT_RULE_LABEL,
  placeholder_leftover: "占位待填未补全（【待填写】/【请补充素材】）",
  failed_chapter: "章节生成失败（导出会缺章）",
  empty_chapter: "标记已完成但正文为空",
  underlength_chapter: "正文明显偏短",
  intra_dup: "跨章重复段落",
}

/**
 * 方案不是暗标文书，因此只纳入与「交付件硬伤」相关的本地禁则；
 * 暗标专属项（彩色文字/图片、表格底纹、彩色边框、加粗、下划线、空白页、身份泄露）不纳入，
 * 避免对正常方案刷出一片与交付无关的提醒。
 */
export const SOL_DELIVERY_ITEMS: FormatCheckKey[] = [
  "no_hyperlink",
  "no_watermark",
  "no_empty_line_consecutive",
  "no_half_width_punct",
  "wording_scan",
  "decoration_leftover",
]

/** 本体检覆盖的规则清单（长度用于卡片文案与哨兵测试，防实现与文案脱节） */
export const SOL_CHECK_RULES: SolCheckRule[] = [
  ...SOL_DELIVERY_ITEMS,
  "meta_leftover",
  "metric_conflict",
  "intra_dup",
  "placeholder_leftover",
  "failed_chapter",
  "empty_chapter",
  "underlength_chapter",
]

/**
 * 与标书侧 LEGAL_PLACEHOLDER_RE 同一约定（bidTypes 该常量为模块私有未导出，
 * 这里按同一 token 集合镜像，两侧约定变更时由哨兵测试兜底）：
 * 【待填写】【请补充素材】在生成链路里是合法的「等人工补值」态，但对着客户就是硬伤。
 */
const PLACEHOLDER_RE = /【待填写】|【请补充素材】/g

/** 查重段落预算：每章只取前 N 个达标段落参与两两比对（Jaccard 为 O(段落数²)，不设防会卡主线程） */
const DUP_PARAGRAPH_BUDGET = 12

/** 命中上限：超出即截断并置 truncated，防长文档把卡片撑爆 */
const MAX_HITS = 60

/** 跨全文级命中的章名标记（与标书侧一致），此类命中无单章落点、不可跳转 */
const WHOLE_DOC = "（全文）"

export type SolCheckHit = {
  rule: SolCheckRule
  label: string
  /** 章名；跨章重复对用「A ↔ B」；全文级用「（全文）」 */
  chapter: string
  /** 跳转目标 node_id；空串 = 不可跳转（全文级） */
  nodeId: string
  quote: string
  level: "warn" | "info"
}

export type SolCheckGroup = { rule: SolCheckRule; label: string; count: number; level: "warn" | "info" }

export type SolDeliveryReport = {
  hits: SolCheckHit[]
  /** 按规则聚合（已过滤 0 计数），warn 组在前 */
  groups: SolCheckGroup[]
  total: number
  warnCount: number
  infoCount: number
  /** 大纲章数 */
  scannedChapters: number
  /** 已有正文的章数 */
  bodyChapters: number
  truncated: boolean
  checked_at: string
}

/** 章名兜底与标书侧 formatCheckReport 同口径（无标题按序号），否则 title→node_id 映射接不上 */
function titleOf(c: Chapter, i: number): string {
  return (c.title ?? "").trim() || `第${i + 1}章`
}

/** 命中摘录：与标书侧 quoteAround 同口径（前 12 字 + 命中内容 + 后 8 字，截 80） */
function excerpt(line: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 12)
  const end = Math.min(line.length, idx + Math.min(len, 40) + 8)
  const text = `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`
  return text.slice(0, 80)
}

/**
 * 交付前体检主入口（纯函数，无副作用、不碰 AI、不写库）：
 * ① 章完成态硬伤（失败章 / 标完成却空正文 / 偏短章）
 * ② 合法占位未填（每章 ≤2 条）
 * ③ 复用标书侧：占位元话语与绝对化承诺、跨章指标口径、六项本地禁则
 * ④ 跨章重复段落（章内前 12 个达标段落参与，相似度 ≥0.35）
 */
export function auditSolutionDelivery(chapters: Chapter[]): SolDeliveryReport {
  const list = chapters ?? []
  const idByTitle = new Map<string, string>()
  list.forEach((c, i) => {
    const t = titleOf(c, i)
    if (!idByTitle.has(t)) idByTitle.set(t, String(c.node_id ?? ""))
  })

  const all: SolCheckHit[] = []
  const push = (rule: SolCheckRule, chapter: string, nodeId: string, quote: string, level: "warn" | "info") => {
    all.push({ rule, label: SOL_CHECK_LABEL[rule], chapter, nodeId, quote: quote.slice(0, 80), level })
  }

  list.forEach((c, i) => {
    const title = titleOf(c, i)
    const nodeId = String(c.node_id ?? "")
    const content = c.content ?? ""
    const body = content.trim()
    // ① 章完成态：未生成（pending）空正文属正常进度，不算交付硬伤，避免开局满屏红
    if (c.gen_status === "failed") {
      // R282：把 R280 落库的真实原因带进摘录，明细与复制清单都能读到「为什么失败」（旧记录兜底）
      const why = (c.genError ?? "").trim() || LEGACY_GEN_ERROR_NOTE
      push("failed_chapter", title, nodeId, `「${title}」上次生成失败（${why}），正文缺失或为旧稿`, "warn")
    } else if (!body && c.gen_status === "done") {
      push("empty_chapter", title, nodeId, "该章已标记完成但正文为空，导出后将是一页空白", "warn")
    } else if (body && c.underlength) {
      push("underlength_chapter", title, nodeId, "成稿字数低于预算 60%，与其他章节体量明显不匹配", "info")
    }
    // ② 合法占位未填（每章最多 2 条，防刷屏）
    if (!body) return
    let ph = 0
    for (const line of content.split(/\r?\n/)) {
      if (ph >= 2) break
      PLACEHOLDER_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = PLACEHOLDER_RE.exec(line)) !== null) {
        push("placeholder_leftover", title, nodeId, excerpt(line, m.index, m[0].length), "warn")
        if (++ph >= 2) break
      }
    }
  })

  // ③ 复用标书侧同一批纯函数（章名→node_id 回接，全文级无落点）
  const reused: FormatCheckHit[] = [
    ...metaLeftoverHits(list),
    ...metricConflictHits(list),
    ...formatCheckReport(list, SOL_DELIVERY_ITEMS, null).hits,
  ]
  for (const h of reused) {
    push(h.rule, h.chapter, h.chapter === WHOLE_DOC ? "" : idByTitle.get(h.chapter) ?? "", h.quote, h.level)
  }

  // ④ 跨章重复段落：段落预算内取前 12 段/章（成本护栏，见 DUP_PARAGRAPH_BUDGET 注释）
  const targets: DupTarget[] = list
    .map((c, i) => ({
      nodeId: String(c.node_id ?? ""),
      chapter: titleOf(c, i),
      text: splitParagraphs(c.content ?? "", 50, DUP_PARAGRAPH_BUDGET).join("\n"),
    }))
    .filter((t) => t.text)
  for (const p of findIntraDupPairs(targets)) {
    push(
      "intra_dup",
      `${p.a_chapter} ↔ ${p.b_chapter}`,
      p.a_node_id,
      `相似度 ${Math.round(p.similarity * 100)}%：${p.a_text.slice(0, 60)}`,
      "warn",
    )
  }

  const hits = all.slice(0, MAX_HITS)
  const gIdx = new Map<SolCheckRule, number>()
  const groups: SolCheckGroup[] = []
  for (const h of hits) {
    const at = gIdx.get(h.rule)
    if (at === undefined) {
      gIdx.set(h.rule, groups.length)
      groups.push({ rule: h.rule, label: h.label, count: 1, level: h.level })
    } else {
      groups[at].count += 1
    }
  }
  groups.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1))

  return {
    hits,
    groups,
    total: hits.length,
    warnCount: hits.filter((h) => h.level === "warn").length,
    infoCount: hits.filter((h) => h.level === "info").length,
    scannedChapters: list.length,
    bodyChapters: list.filter((c) => (c.content ?? "").trim()).length,
    truncated: all.length > MAX_HITS,
    checked_at: new Date().toISOString(),
  }
}

/** 整改清单复制口径：按规则分组，命中标「章名 — 摘录」，全文级标注不指向单章 */
export function buildDeliveryFixText(report: SolDeliveryReport): string {
  if (!report.total) return "交付前体检：未发现本地可判定的硬伤。"
  const lines: string[] = [`交付前体检待复核 ${report.total} 项（零费用本地核验，只报不拦）`, ""]
  for (const g of report.groups) {
    lines.push(`【${g.label}】${g.count} 处`)
    for (const h of report.hits.filter((x) => x.rule === g.rule)) {
      lines.push(`  - ${h.chapter}：${h.quote}`)
    }
    lines.push("")
  }
  if (report.truncated) lines.push(`（命中较多，以上仅列前 ${MAX_HITS} 条）`)
  return lines.join("\n").trim()
}
