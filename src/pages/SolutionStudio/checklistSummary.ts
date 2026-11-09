import { calcTotal, formatAmountWan, sumLinesYuan, type ChecklistLine } from "./checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单预算结构汇总：按分类小计 + 全局条目/外购计数（纯函数，无 JSX）
// 供 ChecklistDetailPanel 渲染分类小计行与底部汇总，金额口径复用 calcTotal 单一真源
// ---------------------------------------------------------------------------

export type CategorySummary = {
  category: string
  count: number
  subtotal: number
  externalCount: number
}

export type ChecklistTotals = {
  lineCount: number
  categoryCount: number
  externalCount: number
  total: number
}

/** 一组行的小计（元）：逐行精确到分后累加，口径与 calcTotal 单一真源（B9） */
export function subtotalOfLines(lines: ChecklistLine[]): number {
  return sumLinesYuan(lines)
}

/** 按 category 分组汇总勾选行，保留首次出现顺序；未勾选行剔除，空分类归「未分类」 */
export function summarizeChecklistCategories(lines: ChecklistLine[]): CategorySummary[] {
  const groups = new Map<string, ChecklistLine[]>()
  for (const l of lines ?? []) {
    if (l.checked === false) continue
    const key = l.category || "未分类"
    const arr = groups.get(key)
    if (arr) arr.push(l)
    else groups.set(key, [l])
  }
  // 小计按整数分一次算清，保证「各分类小计之和 === 合计」严格成立（B9）
  return Array.from(groups.entries()).map(([category, group]) => ({
    category,
    count: group.length,
    subtotal: sumLinesYuan(group),
    externalCount: group.filter((l) => l.source === "external").length,
  }))
}

/** 全局汇总：条目数/分类数/外购数/合计（total 复用 calcTotal，避免口径分叉） */
export function buildChecklistTotals(lines: ChecklistLine[]): ChecklistTotals {
  const cats = summarizeChecklistCategories(lines)
  return {
    lineCount: cats.reduce((s, c) => s + c.count, 0),
    categoryCount: cats.length,
    externalCount: cats.reduce((s, c) => s + c.externalCount, 0),
    total: calcTotal(lines),
  }
}


// ---------------------------------------------------------------------------
// UX-v2 屏 B：金额五档汇总 + 三步状态（纯函数）
//
// 分档映射（按 category / 产品线 / 名称 / 模块 / 备注 关键字，先匹配先生效）：
//   税     ← 税、增值税、销项税
//   设备   ← 设备、硬件、服务器、存储、网络设备、一体机、工作站、电脑、打印、终端、机房、交换机、防火墙
//   实施   ← 实施、部署、迁移、培训、上线（不含「集成平台」这类产品名里的集成）
//   服务   ← 运维、维保、驻场、售后、运维服务
//   软件   ← 软件、系统、平台、HIS、EMR、LIS、PACS、数据库、中间件
//   其余无法归类 → 软件（任务书允许「软件」或「未分类」；五档卡无「未分类」行，故归软件）
// ---------------------------------------------------------------------------

export type AmountBucketKey = "equipment" | "software" | "implementation" | "service" | "tax"

export const AMOUNT_BUCKET_ORDER: AmountBucketKey[] = [
  "equipment",
  "software",
  "implementation",
  "service",
  "tax",
]

export const AMOUNT_BUCKET_LABEL: Record<AmountBucketKey, string> = {
  equipment: "设备",
  software: "软件",
  implementation: "实施",
  service: "服务（3 年）",
  tax: "税",
}

export type AmountBreakdown = Record<AmountBucketKey, number> & { total: number }

export function classifyAmountBucket(line: Pick<ChecklistLine, "category" | "product_line" | "product_name" | "module_name" | "module_func" | "remark">): AmountBucketKey {
  const text = [
    line.category,
    line.product_line,
    line.product_name,
    line.module_name,
    line.module_func,
    line.remark,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" | ")
  if (/税|增值税|销项税/.test(text)) return "tax"
  if (/设备|硬件|服务器|存储|网络设备|一体机|工作站|电脑|打印|终端|机房|交换机|防火墙/.test(text)) return "equipment"
  if (/(实施|部署|迁移|培训|上线)/.test(text) && !/集成平台/.test(text)) return "implementation"
  if (/运维|维保|驻场|售后/.test(text)) return "service"
  if (/软件|系统|平台|HIS|EMR|LIS|PACS|数据库|中间件/i.test(text)) return "software"
  return "software"
}

/** 仅勾选行参与；total 复用 calcTotal，保证与页头合计同一口径 */
export function buildAmountBreakdown(lines: ChecklistLine[]): AmountBreakdown {
  const groups: Record<AmountBucketKey, ChecklistLine[]> = {
    equipment: [],
    software: [],
    implementation: [],
    service: [],
    tax: [],
  }
  for (const l of lines ?? []) {
    if (l.checked === false) continue
    groups[classifyAmountBucket(l)].push(l)
  }
  return {
    equipment: sumLinesYuan(groups.equipment),
    software: sumLinesYuan(groups.software),
    implementation: sumLinesYuan(groups.implementation),
    service: sumLinesYuan(groups.service),
    tax: sumLinesYuan(groups.tax),
    total: calcTotal(lines),
  }
}

/** 左卡页脚：「设备 210.0 · 软件 268.0 · 实施 120.0 · 服务 60.0 · 税 40.0」 */
export function formatBreakdownInline(b: AmountBreakdown): string {
  const pair: [AmountBucketKey, string][] = [
    ["equipment", "设备"],
    ["software", "软件"],
    ["implementation", "实施"],
    ["service", "服务"],
    ["tax", "税"],
  ]
  return pair.map(([k, label]) => `${label} ${(Number(b[k]) / 10000).toFixed(1)}`).join(" · ")
}

export type ChecklistStepState = "done" | "on" | "todo"

export type ChecklistStep = {
  key: 1 | 2 | 3
  title: string
  detail: string
  state: ChecklistStepState
  /** 未解锁时点击应 toast 的原因；空 = 可点 */
  lockReason: string
}

/**
 * 三步条真实状态：
 * ① 录入需求 — 段数 ≥ 1
 * ② 生成系统清单 — 清单行 ≥ 1；副文案「进行中/已完成 · n 项已确认 m 项」
 * ③ 转大纲 — 已有方案引用该清单并带大纲，或本次已成功触发生成
 */
export function buildChecklistSteps(input: {
  segmentCount: number
  lineCount: number
  checkedCount: number
  outlineGenerated: boolean
}): ChecklistStep[] {
  const segs = Math.max(0, input.segmentCount)
  const n = Math.max(0, input.lineCount)
  const m = Math.max(0, input.checkedCount)
  const step1done = segs >= 1
  const step2done = n >= 1
  const step3done = Boolean(input.outlineGenerated)

  const step1: ChecklistStep = {
    key: 1,
    title: "录入需求",
    detail: step1done ? `已完成 · ${segs} 段原文` : "待开始",
    state: step1done ? "done" : "on",
    lockReason: "",
  }
  const step2: ChecklistStep = {
    key: 2,
    title: "生成系统清单",
    detail: step2done
      ? `${step3done ? "已完成" : "进行中"} · ${n} 项已确认 ${m} 项`
      : "待开始",
    state: step2done ? (step3done ? "done" : "on") : step1done ? "on" : "todo",
    lockReason: "",
  }
  const step3: ChecklistStep = {
    key: 3,
    title: "转大纲",
    detail: step3done ? "已完成" : "待开始",
    state: step3done ? "done" : "todo",
    lockReason: step2done ? "" : "请先生成系统清单（至少 1 项）",
  }
  return [step1, step2, step3]
}

export type KnowledgeRecommend = { id: string; text: string }

/** 本地规则：需求原文点名、但清单尚未收录的产品库条目 */
export function recommendFromRequirementText(
  raw: string,
  lines: ChecklistLine[],
  products: { id: string; product_name: string }[],
): KnowledgeRecommend[] {
  const text = (raw ?? "").trim()
  if (!text) return []
  const haveIds = new Set((lines ?? []).map((l) => l.product_id).filter(Boolean))
  const haveNames = new Set((lines ?? []).map((l) => (l.product_name ?? "").trim()).filter(Boolean))
  const out: KnowledgeRecommend[] = []
  for (const p of products ?? []) {
    const name = (p.product_name ?? "").trim()
    if (name.length < 2) continue
    if (!text.includes(name)) continue
    if (haveIds.has(p.id) || haveNames.has(name)) continue
    out.push({
      id: `prod:${p.id}`,
      text: `需求原文提到「${name}」，产品库中有对应条目，可追加到系统清单`,
    })
    if (out.length >= 5) break
  }
  return out
}

/** 本地规则：其它清单（同医院或评级目标有交集）中出现、本清单没有的系统名 */
export function recommendFromPeerChecklists(
  current: { id: string; hospital?: string; rating_targets?: string[]; items?: ChecklistLine[] } | null,
  peers: { id: string; checklist_name: string; hospital?: string; rating_targets?: string[]; items?: ChecklistLine[] }[],
): KnowledgeRecommend[] {
  if (!current) return []
  const myNames = new Set((current.items ?? []).map((l) => (l.product_name ?? "").trim()).filter(Boolean))
  const myHospital = (current.hospital ?? "").trim()
  const myTargets = new Set(current.rating_targets ?? [])
  const out: KnowledgeRecommend[] = []
  for (const peer of peers ?? []) {
    if (!peer || peer.id === current.id) continue
    const sameHospital = myHospital && (peer.hospital ?? "").trim() === myHospital
    const overlapTarget = (peer.rating_targets ?? []).some((t) => myTargets.has(t))
    if (!sameHospital && !overlapTarget) continue
    for (const l of peer.items ?? []) {
      const name = (l.product_name ?? "").trim()
      if (!name || myNames.has(name)) continue
      myNames.add(name)
      const peerName = (peer.checklist_name ?? "").trim() || "同类清单"
      out.push({
        id: `peer:${peer.id}:${name}`,
        text: `同类清单「${peerName}」含「${name}」，本清单尚未列入`,
      })
      if (out.length >= 5) break
    }
    if (out.length >= 5) break
  }
  return out
}

export { formatAmountWan }
