// ---------------------------------------------------------------------------
// 原子用途推荐（2026-10-31 审核吞吐优化）
//
// 背景：B0 批次抽出 989 条原子，人工逐条勾选取用（P3 原则）不现实。
//   但 P3 原则的核心是「通过与否由人判断」，不是「必须逐条手点」。
//
// 本模块提供**用途推荐**：按原子的类型与内容特征给出建议用途，
// 审核台可一键采纳（也可以改），既守住 P3 又大幅提效。
//
// 判断依据（业务逻辑，非猜测）：
//   · 原子类型决定「这份知识能支撑哪类产出」
//   · 内容中的信号词补充修正（如含"报价/折扣"→ 也适用报价）
//
// 是否可用由审核人最终决定——这里只给建议，不直接改库。
// ---------------------------------------------------------------------------

import type { AtomType } from "./kbAtoms"

/** 用途枚举（与 kbAtomSearch 的 usableFor 一致） */
export type UsableFor = "proposal" | "ppt" | "bid" | "quote" | "faq"

export const USABLE_FOR_LABEL: Record<UsableFor, string> = {
  proposal: "方案",
  ppt: "PPT",
  bid: "标书",
  quote: "报价",
  faq: "答疑",
}

/**
 * 原子类型 → 基础用途（该类型天然能支撑的产出）。
 *
 * 设计原则：宁宽勿窄 —— 漏标会让好知识用不上（比多标危害大，
 * 因为多标只影响排序，漏标直接丢失召回）。
 */
const TYPE_BASE_USABLE: Record<AtomType, UsableFor[]> = {
  // 2026-10-31 二次校准：第一版让 100% 原子的建议都含 proposal/bid/faq，
  // 等于没有区分度、场景过滤形同虚设。改为**按该类型最核心的产出**给 1-2 个，
  // 其余由内容信号词补充（命中才加）。
  // 稳定事实（公司规模、成立时间）→ 主要进方案与标书正文
  fact: ["proposal", "bid"],
  // 带数值指标 → 方案论证 + PPT 数据页（标书由信号词补）
  metric: ["proposal", "ppt"],
  // 项目案例 → 方案业绩章 + PPT 案例页
  case: ["proposal", "ppt"],
  // 资质证书 → 标书资格章（方案里很少需要逐条列资质）
  qualification: ["bid"],
  // 政策条款 → 方案编制依据（标书/答疑由信号词补）
  policy: ["proposal"],
  // 2026-11-01 修正：产品能力**必须包含 ppt**。
  // 原实现只给 proposal+bid，导致 4827 条产品能力原子进不了 PPT 生成
  // （实测「CDSS 智能决策」查 ppt 用途时 18 条相关原子只有 1 条可用，且打分不够没命中）。
  // 产品能力正是 PPT 内容页的核心素材——讲产品不讲能力讲什么。
  product_capability: ["proposal", "bid", "ppt"],
  // 打法（推进路径）→ 方案策略
  play: ["proposal"],
  // 话术（异议应答）→ 答疑是它的主场
  script: ["faq"],
}

/** 内容信号 → 补充用途（命中则追加） */
const CONTENT_SIGNALS: { re: RegExp; add: UsableFor[]; why: string }[] = [
  { re: /(报价|折扣|单价|总价|费用|价格|计费)/, add: ["quote"], why: "含价格要素" },
  { re: /(PPT|汇报|演示|宣讲|路演)/i, add: ["ppt"], why: "含汇报场景词" },
  { re: /(答疑|质疑|异议|澄清|答复)/, add: ["faq"], why: "含答疑场景词" },
  { re: /(招标|投标|标书|评标|中标|废标)/, add: ["bid"], why: "含招投标场景词" },
  { re: /(建设方案|规划|可研|初设|大纲)/, add: ["proposal"], why: "含方案场景词" },
]

export type UsableRecommendation = {
  /** 建议用途（去重后，顺序稳定） */
  usableFor: UsableFor[]
  /** 每项建议的理由（供审核人判断） */
  reasons: string[]
  /** 置信度 0-1：类型基础分 + 信号加成，命中越多越高 */
  confidence: number
}

/**
 * 为一条原子推荐用途。
 *
 * @param atomType 原子类型
 * @param title 标题（参与信号匹配）
 * @param body 正文（参与信号匹配）
 */
export function recommendUsableFor(
  atomType: AtomType | string,
  title: string,
  body: string,
): UsableRecommendation {
  const t = String(atomType ?? "")
  const text = `${title ?? ""} ${body ?? ""}`
  const base = TYPE_BASE_USABLE[t as AtomType] ?? []
  const out = new Set<UsableFor>(base)
  const reasons: string[] = []
  if (base.length) reasons.push(`按类型「${t}」适用：${base.map((u) => USABLE_FOR_LABEL[u]).join("/")}`)

  let signalHits = 0
  for (const sig of CONTENT_SIGNALS) {
    if (sig.re.test(text)) {
      for (const u of sig.add) out.add(u)
      reasons.push(sig.why)
      signalHits += 1
    }
  }

  // 置信度：有类型基础 0.6，每个信号 +0.1，上限 0.95
  const confidence = base.length ? Math.min(0.95, 0.6 + signalHits * 0.1) : Math.min(0.6, 0.3 + signalHits * 0.1)

  // 稳定性：按固定顺序输出，便于 diff 与测试
  const order: UsableFor[] = ["proposal", "ppt", "bid", "quote", "faq"]
  return {
    usableFor: order.filter((u) => out.has(u)),
    reasons,
    confidence,
  }
}

/**
 * 批量推荐：给一批原子各出建议。
 *
 * @returns 只返回「有建议」的（无类型且无信号的返回空数组，留给人工）
 */
export function recommendBatch(
  atoms: { id: string; atomType: string; title: string; body: string }[],
): { id: string; usableFor: UsableFor[]; confidence: number; reasons: string[] }[] {
  const out: { id: string; usableFor: UsableFor[]; confidence: number; reasons: string[] }[] = []
  for (const a of atoms) {
    const r = recommendUsableFor(a.atomType, a.title, a.body)
    if (r.usableFor.length) {
      out.push({ id: a.id, usableFor: r.usableFor, confidence: r.confidence, reasons: r.reasons })
    }
  }
  return out
}
