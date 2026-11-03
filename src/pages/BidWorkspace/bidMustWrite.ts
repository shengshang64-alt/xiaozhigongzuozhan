import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/**
 * R-020 商务/技术判定改按评分办法（纯本地零 AI）——第 2 轮 M 类问题根因：
 * 是否编写某章此前只看模型给的 part==="biz"（isBizPart），一旦模型把评分办法里的必写技术内容
 * 误标商务骨架章，商务/技术分开出（outlineScope=tech）时就被整章丢弃 → 丢分（建阳区售后服务/技术培训）。
 * 本模块给每个顶层章打 mustWrite：只要命中「评分办法有对应评分项 / 技术关键词 / ★▲实质性 / 要求性表述兜底」
 * 任一强信号即必写，与 part 解耦；outlineScope 过滤由 !isBizPart 改为 !isBizPart || mustWrite 兜住误标。
 * 目录归类（招标把该条列在技术分册）仅作降权佐证、不单独否决（第⑤级），故并入 reason 不作硬开关。
 */

export type PartVerdict = "tech" | "biz" | "uncertain"

export type MustWriteInfo = {
  mustWrite: boolean
  verdict: PartVerdict
  reason: string
}

export type MustWriteCtx = {
  /** 技术评分项名（numberScoringItems 过滤 category==="tech" 的 item），命中即①级最强信号 */
  techScoringNames: string[]
  /** R-017 必备技术内容清单（可配置下限：凡技术/交付/服务即必写），命中即 tech 强信号，与 part/关键词解耦 */
  requiredKeywords?: string[]
}

// 商务骨架专属词：命中且无技术强信号 → 判 biz、不必写（保守，宁可漏判 biz 也不误砍技术必写章）
const BIZ_EXCLUSIVE = [
  "投标函", "开标一览表", "报价一览表", "分项报价", "投标报价", "报价表",
  "保证金", "资质", "业绩", "证书", "营业执照", "授权", "承诺函", "声明函",
  "商务条款", "商务响应", "商务部分", "资格文件", "法人", "身份证",
]

// 技术内容关键词：命中 → tech 强信号
const TECH_KEYWORD = [
  "系统", "架构", "部署", "接口", "参数", "性能", "指标", "功能", "技术方案",
  "实施", "集成", "运维", "安全", "信创", "等保", "培训", "售后", "质保",
  "响应方案", "解决方案", "设计方案", "技术方案", "偏离", "重保", "验收",
]

// 要求性表述兜底（第⑥级，用户拍板追加）：命中且非商务专属 → mustWrite，verdict uncertain 待人工确认
const REQUIREMENT_PHRASE = ["须提供", "应提供", "需提交", "应编制", "应包括", "应包含", "须包含", "应当提供", "需编制"]

function norm(s: string): string {
  return (s ?? "").replace(/[\s\u3000（）()、，,。.．]/g, "")
}

/** 名称近义匹配：双向包含（「项目实施方案」↔评分项「实施方案」）视为同一评分项 */
function nameMatch(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na.includes(nb) || nb.includes(na)
}

function hitAny(text: string, list: string[]): string {
  for (const kw of list) if (text.includes(kw)) return kw
  return ""
}

/** 单章六级判定：返回 mustWrite / verdict / reason（叶子正文口径，仅顶层章调用） */
export function judgeMustWrite(node: Pick<OutlineNode, "title" | "description" | "part">, ctx: MustWriteCtx): MustWriteInfo {
  const hay = `${node.title ?? ""} ${node.description ?? ""}`
  const bizHit = hitAny(node.title ?? "", BIZ_EXCLUSIVE)
  const techHit = hitAny(hay, TECH_KEYWORD)
  const reqHit = hitAny(hay, REQUIREMENT_PHRASE)
  const starHit = /[★▲]/.test(hay)
  const scoringHit = ctx.techScoringNames.find((nm) => nameMatch(node.title ?? "", nm))
  const reqKwHit = hitAny(hay, ctx.requiredKeywords ?? [])

  // ① 评分办法有对应技术评分项（最强：分值直接挂钩，必写）
  if (scoringHit) return { mustWrite: true, verdict: "tech", reason: `评分办法含「${scoringHit}」评分项` }
  // ② R-017 必备技术内容清单命中（可配置下限：凡技术/交付/服务即必写，非商务专属）
  if (reqKwHit && !bizHit) return { mustWrite: true, verdict: "tech", reason: `必备技术内容清单「${reqKwHit}」` }
  // ④ ★▲实质性响应条款
  if (starHit) return { mustWrite: true, verdict: "tech", reason: "含 ★/▲ 实质性响应标记" }
  // ③ 技术关键词（分值>0 且形态方案/响应/参数并入此级）
  if (techHit && !bizHit) return { mustWrite: true, verdict: "tech", reason: `技术内容关键词「${techHit}」` }
  // ⑥ 要求性表述兜底（须提供/应编制/需提交）——非商务专属才兜，判 uncertain 待人工确认
  if (reqHit && !bizHit) return { mustWrite: true, verdict: "uncertain", reason: `要求性表述「${reqHit}」兜底，建议人工确认` }
  // 商务骨架（资质/报价/承诺…）：不必写正文，只列小节
  if (bizHit) return { mustWrite: false, verdict: "biz", reason: `商务骨架「${bizHit}」` }
  // 缺省：标书页无 part 一律按 tech 兼容（不强制 mustWrite，交给既有 scope 判定）
  return { mustWrite: false, verdict: node.part === "biz" ? "biz" : "tech", reason: "无强信号，沿用模型归属" }
}

/**
 * 给整棵大纲顶层章打 mustWrite（返回新数组，不改入参；子级不动）。
 * 同时回收「被误标 biz 但命中必写强信号」的章（rescued），供页面纠偏提示与 scope=tech 兜底保留。
 */
export function applyMustWrite(
  nodes: OutlineNode[],
  ctx: MustWriteCtx,
): { nodes: OutlineNode[]; rescued: { title: string; reason: string }[]; verdicts: Record<string, MustWriteInfo> } {
  const verdicts: Record<string, MustWriteInfo> = {}
  const rescued: { title: string; reason: string }[] = []
  const out = (nodes ?? []).map((n) => {
    const info = judgeMustWrite(n, ctx)
    verdicts[n.id] = info
    if (n.part === "biz" && info.mustWrite) rescued.push({ title: n.title, reason: info.reason })
    return { ...n, mustWrite: info.mustWrite }
  })
  return { nodes: out, rescued, verdicts }
}
