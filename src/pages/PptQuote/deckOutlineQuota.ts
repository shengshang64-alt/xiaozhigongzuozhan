// ---------------------------------------------------------------------------
// 大纲页型配额（2026-11-04，B 项）
//
// 用户反馈：「PPT 生成出来还是纯文字墙，没有架构/流程/KPI 页」。
//
// 根因有两层：
//   ① 提示词里只写「按内容决定形式」，模型绝大多数页都输出 bullets —— 这是"建议"，
//      模型执行率极低（实测 29 页里 20 页纯文字）；
//   ② 即使提示词写了配额，模型也会漏；而大纲是**唯一能在逐页生成前纠偏**的时点，
//      过了这个点再改就要重写内容。
//
// 所以这一层做两件事：
//   · kindQuotaRuleText()：给大纲/单发提示词用的**硬配额文案**（与页面预算同源，改一处生效）；
//   · enforceOutlineKindQuota()：模型大纲返回后的**确定性校正**——把语义上本来就是
//     架构/流程/对照的页改成对应 kind，并把超配额的纯 bullets 页降级成对照表。
//
// 重要原则：**只改 kind，不改标题、不编内容、不编数字**。
//   · 转 architecture/flow 必须标题或 intent 自带结构语义（否则就是在乱贴标签，
//     deckReshape 曾因此把「数据标准不统一」画成分层架构，属于事故级误判）；
//   · 纯文字超额时最后兜底改 table（维度/说明两列），只是把并列论点换个更规整的版面，
//     不涉及数字，因此不会产生"编数据"风险；
//   · 仍不满足配额的，如实写进 notes 交给结构自检报告，不假装达标。
// ---------------------------------------------------------------------------

import type { SlidePlan } from "./pptQuoteTypes"
import type { SlideKindZ as KindZ } from "./deckSchema"

/** 不参与页型配额统计的页（封面/目录/章节过渡/致谢） */
const QUOTA_EXEMPT_KINDS: ReadonlySet<KindZ> = new Set<KindZ>(["cover", "agenda", "section", "summary"])

/** 结构化页型语义词表：只有命中才算"这页本来就是这种结构" */
const ARCH_HINT_RE = /(架构|分层|层级|技术栈|总体设计|总体思路|总体蓝图|系统组成|平台架构|一体化平台|信息平台|中台|蓝图|建设内容)/
const FLOW_HINT_RE =
  /(分期|分步|阶段|路径|步骤|流程|路线图|节奏|一期|二期|三期|里程碑|推进计划|实施计划|建设顺序|下一步|推进安排)/
const TABLE_HINT_RE = /(对照|对比|清单|矩阵|指标表|维度|差异|优劣|取舍|要求与|依据与|保障措施|保障体系|举措|任务分工)/
const KPI_HINT_RE = /(成效|价值|亮点|指标|规模|数量|收益|投入产出|降本|增效|KPI)/

/** 配额口径（10 页左右一册的最低要求，按内容页数等比折算） */
export const KIND_QUOTA = {
  /** 内容页 ≥4 页时至少 1 页分层架构图 */
  architectureMinPages: 4,
  /** 内容页 ≥5 页时至少 1 页流程/分期路径图 */
  flowMinPages: 5,
  /** 内容页 ≥4 页时至少 1 页 KPI/对照表 */
  dataMinPages: 4,
  /** 纯 bullets 页上限：内容页的 30% */
  bulletsMaxRatio: 0.3,
} as const

/** 纯文字（bullets）页预算 */
export function bulletsBudgetOf(contentPages: number): number {
  if (contentPages <= 0) return 0
  // 下限 1 页：极小册子（1-3 页内容）按 30% 向下取整会变成 0，等于逼模型把唯一的内容页
  // 也硬改成图表——这与「不为凑页型编内容」的原则冲突，故至少允许 1 页纯文字。
  return Math.max(1, Math.floor(contentPages * KIND_QUOTA.bulletsMaxRatio))
}

export interface KindQuota {
  contentPages: number
  /** 需要的最少架构页 */
  architectureMin: number
  /** 需要的最少流程/分期页 */
  flowMin: number
  /** 需要的最少 KPI/对照页 */
  dataMin: number
  /** 允许保留的纯 bullets 页数 */
  bulletsMax: number
}

/** 按页数算配额（单一真源：提示词文案与确定性校正都用它） */
export function kindQuotaFor(pageCount: number): KindQuota {
  // 内容页 = 总页数扣掉封面/致谢两页（目录/章节页是模型自由加的，这里保守估 2 页）
  const contentPages = Math.max(1, Math.min(pageCount, pageCount - 2))
  return {
    contentPages,
    architectureMin: contentPages >= KIND_QUOTA.architectureMinPages ? 1 : 0,
    flowMin: contentPages >= KIND_QUOTA.flowMinPages ? 1 : 0,
    dataMin: contentPages >= KIND_QUOTA.dataMinPages ? 1 : 0,
    bulletsMax: bulletsBudgetOf(contentPages),
  }
}

/**
 * 生成给模型看的「页型配额」硬规则文案。
 *
 * 与 enforceOutlineKindQuota 同源（都用 kindQuotaFor），所以提示词里的数字和
 * 事后校正的口径永远一致——不会出现"提示词说至少 1 页架构、校正却按 2 页算"。
 */
export function kindQuotaRuleText(pageCount: number): string {
  const q = kindQuotaFor(pageCount)
  const lines: string[] = [
    "【页型配额铁律】（大纲阶段就要排好，不是写完再改）",
    `本次共 ${pageCount} 页，其中内容页约 ${q.contentPages} 页，页型配额如下：`,
  ]
  if (q.architectureMin) lines.push(`1. 至少 ${q.architectureMin} 页 kind="architecture"（分层架构：渠道/接入→业务→能力→数据，每层 3-6 个真实系统模块）；`)
  if (q.flowMin) lines.push(`2. 至少 ${q.flowMin} 页 kind="flow"（业务流程或分期建设路径：一期/二期/三期，或 3-7 个有序步骤）；`)
  if (q.dataMin) lines.push(`3. 至少 ${q.dataMin} 页 kind="kpi" 或 kind="table"（KPI 指标页或前后对照表）；`)
  lines.push(
    `4. 纯文字页（kind="bullets"）不得超过 ${q.bulletsMax} 页（约 ${Math.round(KIND_QUOTA.bulletsMaxRatio * 100)}%），超出部分必须改成上述结构化页型；`,
    "5. 每页必须显式给 kind 与 imageHint：kind 只能取 cover/agenda/section/bullets/kpi/chart/table/flow/architecture/image/summary；imageHint 写这页要画什么/给谁看（不需要配图的页留空串）；",
    "6. 大纲里就要把结构化页的骨架写进 intent：架构页写「层名：模块1、模块2…」，流程页写「一期：…／二期：…」，对照页写「维度：现状｜目标」。",
    "7. 数据类页型（kpi/chart/table 里的数值）没有素材依据就不要排，改用 architecture/flow 承载——**宁可用结构图，不可编数字**。",
  )
  return lines.join("\n")
}

/** 单页候选评分：命中哪类语义、命中几个词（0 = 没有结构语义，不许硬转） */
function semanticOf(p: SlidePlan): { arch: number; flow: number; table: number; kpi: number } {
  const hay = `${p.title} ${p.intent ?? ""}`
  const count = (re: RegExp): number => (hay.match(new RegExp(re.source, "g")) ?? []).length
  return {
    arch: ARCH_HINT_RE.test(hay) ? 1 + count(ARCH_HINT_RE) : 0,
    flow: FLOW_HINT_RE.test(hay) ? 1 + count(FLOW_HINT_RE) : 0,
    table: TABLE_HINT_RE.test(hay) ? 1 + count(TABLE_HINT_RE) : 0,
    kpi: KPI_HINT_RE.test(hay) ? 1 + count(KPI_HINT_RE) : 0,
  }
}

export interface OutlineQuotaResult {
  plan: SlidePlan[]
  /** 本次被改 kind 的页数 */
  converted: number
  /** 每处改动的人话说明（供 toast/报告） */
  notes: string[]
  counts: {
    contentPages: number
    architecture: number
    flow: number
    data: number
    bullets: number
  }
  /** 校正后仍未满足的配额（中文，空数组=达标） */
  unmet: string[]
}

function countsOf(plan: SlidePlan[]) {
  let contentPages = 0
  let architecture = 0
  let flow = 0
  let data = 0
  let bullets = 0
  for (const p of plan) {
    if (QUOTA_EXEMPT_KINDS.has(p.kind)) continue
    contentPages += 1
    if (p.kind === "architecture") architecture += 1
    else if (p.kind === "flow") flow += 1
    else if (p.kind === "kpi" || p.kind === "table" || p.kind === "chart") data += 1
    else if (p.kind === "bullets" || !p.kind) bullets += 1
  }
  return { contentPages, architecture, flow, data, bullets }
}

/**
 * 大纲页型配额确定性校正（纯函数，不改标题/不改内容）。
 *
 * 只做「语义本来就成立」的 kind 改判，顺序：
 *   ① 先补缺口（架构 → 流程 → KPI/对照），从语义分最高的 bullets 页里挑；
 *   ② 再压纯文字超额：剩余 bullets 页里仍有结构语义的按语义转，没有的降级成 table(维度对照)；
 *   ③ 都做完仍不达标 → 写进 unmet，交给结构自检报告如实告知，不假装达标。
 */
export function enforceOutlineKindQuota(plan: SlidePlan[], pageCount?: number): OutlineQuotaResult {
  const q = kindQuotaFor(pageCount ?? plan.length)
  const out = plan.map((p) => ({ ...p }))
  const notes: string[] = []
  let converted = 0

  /** 可被改判的候选（纯文字页），按语义分从高到低 */
  const pickCandidate = (need: "arch" | "flow" | "table" | "kpi"): number => {
    let bestIdx = -1
    let bestScore = 0
    out.forEach((p, i) => {
      if (QUOTA_EXEMPT_KINDS.has(p.kind)) return
      if (p.kind !== "bullets" && p.kind !== "table" && p.kind !== "kpi" && p.kind !== "chart") return
      // 只从纯文字页里挑：已经有 chart/kpi/table 的页不重复改判
      if (p.kind !== "bullets") return
      const s = semanticOf(p)[need]
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    })
    return bestScore > 0 ? bestIdx : -1
  }

  const apply = (idx: number, kind: KindZ, why: string): void => {
    if (idx < 0) return
    const page = out[idx]
    const from = page.kind
    out[idx] = { ...page, kind }
    converted += 1
    notes.push(`第 ${idx + 1} 页「${page.title}」：${from} → ${kind}（${why}）`)
  }

  let c = countsOf(out)

  // ① 补架构缺口
  while (c.architecture < q.architectureMin) {
    const idx = pickCandidate("arch")
    if (idx < 0) break
    apply(idx, "architecture", "标题/意图本就是分层或平台结构")
    c = countsOf(out)
  }
  // ② 补流程缺口
  while (c.flow < q.flowMin) {
    const idx = pickCandidate("flow")
    if (idx < 0) break
    apply(idx, "flow", "标题/意图本就是分期或实施路径")
    c = countsOf(out)
  }
  // ③ 补 KPI/对照缺口（先用语义相近的 table/kpi）
  while (c.data < q.dataMin) {
    let idx = pickCandidate("table")
    let kind: KindZ = "table"
    let why = "标题/意图本就是维度对照"
    if (idx < 0) {
      idx = pickCandidate("kpi")
      kind = "kpi"
      why = "标题/意图本就是指标成效"
    }
    if (idx < 0) break
    apply(idx, kind, why)
    c = countsOf(out)
  }

  // ④ 压纯文字超额：优先按语义转，实在没语义的降级成对照表（只换版面，不编数字）
  while (c.bullets > q.bulletsMax) {
    const bySemantic: [("arch" | "flow" | "table" | "kpi"), KindZ, string][] = [
      ["arch", "architecture", "标题/意图本就是分层结构"],
      ["flow", "flow", "标题/意图本就是流程/分期"],
      ["table", "table", "标题/意图本就是对照结构"],
      ["kpi", "kpi", "标题/意图本就是指标成效"],
    ]
    let done = false
    for (const [need, kind, why] of bySemantic) {
      const idx = pickCandidate(need)
      if (idx >= 0) {
        apply(idx, kind, why)
        done = true
        break
      }
    }
    if (done) {
      c = countsOf(out)
      continue
    }
    // 无语义可依：把最后一页纯文字降级成对照表（维度/说明），不涉及任何数字
    let lastBullets = -1
    out.forEach((p, i) => {
      if (!QUOTA_EXEMPT_KINDS.has(p.kind) && p.kind === "bullets") lastBullets = i
    })
    if (lastBullets < 0) break
    apply(lastBullets, "table", "纯文字页超额，改为维度对照表（只换版面，数值仍需素材依据）")
    c = countsOf(out)
  }

  const unmet: string[] = []
  if (c.architecture < q.architectureMin) unmet.push(`缺 ${q.architectureMin - c.architecture} 页分层架构图（大纲里没有架构语义的页可改）`)
  if (c.flow < q.flowMin) unmet.push(`缺 ${q.flowMin - c.flow} 页流程/分期路径图`)
  if (c.data < q.dataMin) unmet.push(`缺 ${q.dataMin - c.data} 页 KPI/对照页`)
  if (c.bullets > q.bulletsMax) unmet.push(`纯文字页 ${c.bullets} 页仍超过上限 ${q.bulletsMax} 页`)

  return { plan: out, converted, notes, counts: c, unmet }
}
