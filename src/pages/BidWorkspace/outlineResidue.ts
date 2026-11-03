import { type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// R-021（第 2 轮 · 残句治理）：大纲生成后的本地质检，零 AI、零费用、零依赖。
// 建阳区样例实测 32 个技术章里 20 个（62%）是把招标原文句子/评分说明切成碎片
// 当成了顶层章节标题（如「质保期满后系统的维修保养服务内容投标人在」「评分项提及在
// 3 年的免费质保期基础上」「小时内未解决的」），另有「术语管理/术语维护管理/术语细项
// 管理/术语校验管理」4 个 AI 冗余顶层章。本模块只做两件保守的事：
//  ①高置信残句识别 → 仅命中显式特征表才判残句（宁可漏判，不误伤「质保期」「信创符合性
//    测试」这类合法短章节）；顶层残句按其主题并入一个规范父章作为小节（叶子文本保留，
//    标题清洗），子级残句合并回其父章。不删除任何节点内容，只调整挂载层级与标题。
//  ②语义冗余兄弟章合并：共享同一主题前缀（如「术语」）且互为近义的兄弟章并成一章，
//    children 取并集，标题取最规范（最短）的一条。
// 与 validateOutlineShape（结构校验）/ findUncoveredScoringIds（评分承接）互补：那两者
// 管「层级/规模/覆盖」，本模块专管「标题是不是句子」。判定不确定一律保持原样。
// ---------------------------------------------------------------------------

export type ResidueAction = "nestResidue" | "mergeIntoParent" | "mergeSiblings"

/** 一条修复留痕：原标题 → 新标题 / 归并目标，附判定依据（供页面「原→新」对照展示） */
export type ResidueFix = {
  action: ResidueAction
  from: string
  to: string
  note: string
  depth: number
}

export type ResidueResult = {
  nodes: OutlineNode[]
  fixes: ResidueFix[]
  /** 命中的残句数（含顶层并入父章与子级并入父章） */
  residueCount: number
  /** 冗余兄弟章合并的组数 */
  mergedGroups: number
}

// —— 显式特征表：仅命中下列明确片段才判残句，避免误伤正常章节 ——
// 以这些片段「开头」的标题多为招标条款被切断的残句（缺主语 / 介词起头）
const BAD_PREFIX = [
  "投标人在", "投标人所", "小时内", "必须为", "必须针对", "应包括", "应在", "费用应",
  "保证提供", "收到", "交货条件", "根据当地", "评分项提及", "评分说明", "培训对象分为",
  "培训内容包括", "所有系统均需", "与培训相关", "业务系统操作",
]
// 以这些「悬空虚词 / 连词」结尾的标题为句子被截断的残句
const BAD_SUFFIX = ["在", "的", "基础上", "未解决的", "等提出", "之前", "之内", "之中", "以及"]
// 规范章节名的名词性后缀：命中即视为合法标题，即便较短（如「质保期」「开标一览表」）
const OK_SUFFIX = [
  "方案", "计划", "设计", "体系", "要求", "说明", "一览表", "响应表", "表", "承诺", "措施",
  "管理", "组织", "实施", "部署", "架构", "策略", "书", "报告", "分析", "概述", "综述",
  "响应", "测试", "验收", "培训", "服务", "保障", "机构", "团队", "人员", "进度", "预算",
  "报价", "期", "参数", "指标", "偏离", "证明", "函", "保证金", "一览", "条款", "内容",
]
const REQ = ["应", "须", "需"]
const SHORT_LEN = 14
const TOO_SHORT = 8

// 主题归类：顶层残句按其关键词并入的规范父章标题（R-021 保守落地，R-023 双层目录会细化）
const TOPIC_PARENT: { key: RegExp; title: string }[] = [
  { key: /培训/, title: "技术培训方案" },
  { key: /售后|质保|维修|保养|故障|到达现场|响应时间|交货/, title: "售后服务方案" },
  { key: /术语/, title: "术语管理" },
  { key: /信创|网络安全|等保|安全合规/, title: "信创与安全合规方案" },
  { key: /实施|进度|交付|验收|质量/, title: "项目实施与管理" },
]

function stripPunct(s: string): string {
  return (s || "").replace(/[\s、，。；：]/g, "")
}
function findEnd(s: string, list: string[]): string | undefined {
  return list.find((t) => s.endsWith(t))
}
function findStart(s: string, list: string[]): string | undefined {
  return list.find((t) => s.startsWith(t))
}

/** 判定标题是否为残句，返回命中依据（空串表示合法） */
export function residueReason(raw: string): string {
  const core = stripPunct(raw)
  if (!core) return "空标题"
  const p = findStart(core, BAD_PREFIX)
  if (p) return `以招标条款片段「${p}」起头`
  const okSuffix = findEnd(core, OK_SUFFIX)
  const e = findEnd(core, BAD_SUFFIX)
  if (e && !okSuffix) return `以悬空词「${e}」结尾（句子被截断）`
  const hasReq = REQ.some((v) => core.includes(v))
  if (!okSuffix && core.length < SHORT_LEN && hasReq) return "含要求性表述且不足 14 字，非规范章节名"
  if (!okSuffix && core.length < TOO_SHORT) return "过短且非名词性章节名"
  return ""
}

/** 残句主题归类：命中则给出并入的规范父章标题，否则 undefined */
function topicParent(raw: string): string | undefined {
  const s = raw || ""
  for (const r of TOPIC_PARENT) if (r.key.test(s)) return r.title
  return undefined
}

/** 清洗残句作为小节标题：去悬空尾词 / 去要求性起头，保底回落主题名 */
function cleanSectionTitle(raw: string): string {
  let s = (raw || "").trim()
  s = s.replace(/[、，。；：]+$/g, "")
  for (const t of BAD_SUFFIX) {
    if (s.length > t.length && s.endsWith(t) && !findEnd(s, OK_SUFFIX)) s = s.slice(0, s.length - t.length)
  }
  for (const t of BAD_PREFIX) if (s.startsWith(t)) s = s.slice(t.length)
  s = s.replace(/^的|^为|^在/, "")
  s = s.trim()
  if (s.length < 2) {
    const tp = topicParent(raw) || ""
    s = (tp + "相关条款") || "招标条款响应"
  }
  return s
}

/** 拆出去标点尾巴后的名词后缀与词干（术语管理 -> {stem:术语, sfx:管理}） */
function splitSuffix(t: string): { stem: string; sfx: string } {
  const c = stripPunct(t)
  const sfx = findEnd(c, OK_SUFFIX) || ""
  const stem = sfx ? c.slice(0, c.length - sfx.length) : c
  return { stem, sfx }
}

/**
 * 是否为「兄弟冗余」：同一名词后缀（管理/方案…）且一个词干是另一个的严格前缀。
 * 同后缀约束避免误伤「投标函 / 投标报价表」；前缀约束避免误伤「项目实施方案 / 项目验收方案」。
 */
function isRedundantSibling(a: string, b: string): boolean {
  const A = splitSuffix(a)
  const B = splitSuffix(b)
  if (!A.sfx || A.sfx !== B.sfx) return false
  const [s, l] = A.stem.length <= B.stem.length ? [A.stem, B.stem] : [B.stem, A.stem]
  return s.length >= 2 && l.startsWith(s) && s !== l
}

function makeParentShell(title: string, id: string): OutlineNode {
  return { id, title, children: [], part: "tech" }
}

function uid(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 8)
}

/** 递归合并语义冗余兄弟章（同一父下），返回合并组数与留痕 */
function mergeRedundantSiblings(nodes: OutlineNode[], depth: number, fixes: ResidueFix[]): { nodes: OutlineNode[]; groups: number } {
  let groups = 0
  const out: OutlineNode[] = []
  const consumed = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i]
    if (consumed.has(cur.id)) continue
    const kids = (cur.children || []).slice()
    for (let j = i + 1; j < nodes.length; j++) {
      const other = nodes[j]
      if (consumed.has(other.id)) continue
      if (isRedundantSibling(cur.title, other.title)) {
        consumed.add(other.id)
        groups++
        for (const c of other.children || []) kids.push(c)
        fixes.push({
          action: "mergeSiblings",
          from: other.title,
          to: cur.title,
          note: `与「${cur.title}」同主题冗余，已并入`,
          depth,
        })
      }
    }
    // 递归处理并入后的子节点
    const inner = mergeRedundantSiblings(kids, depth + 1, fixes)
    out.push({ ...cur, children: inner.nodes })
  }
  return { nodes: out, groups }
}

/**
 * 残句治理主入口：返回新节点树 + 修复留痕 + 计数。
 * 保守策略——不删除节点内容，只把顶层残句并入主题父章、子级残句合并回父章、冗余兄弟章合并。
 */
export function cleanOutlineResidue(nodes: OutlineNode[]): ResidueResult {
  const fixes: ResidueFix[] = []
  // ①先做冗余兄弟章合并（术语×4 等）
  const mergedPass = mergeRedundantSiblings(nodes, 1, fixes)
  let work = mergedPass.nodes
  const mergedGroups = mergedPass.groups

  // ②子级残句合并回父章（递归）
  function sinkChildResidues(list: OutlineNode[], depth: number): OutlineNode[] {
    const res: OutlineNode[] = []
    for (const n of list) {
      const kids = n.children || []
      const kept: OutlineNode[] = []
      for (const k of kids) {
        if (residueReason(k.title)) {
          // 子级残句：把它的 children 提升进当前父，去掉残句本身这一层
          fixes.push({ action: "mergeIntoParent", from: k.title, to: n.title, note: residueReason(k.title), depth })
          for (const g of k.children || []) kept.push({ ...g, title: cleanSectionTitle(g.title) })
          if (!(k.children && k.children.length)) {
            kept.push({ id: uid("sec"), title: cleanSectionTitle(k.title), children: [], part: k.part || n.part })
          }
        } else {
          kept.push(k)
        }
      }
      res.push({ ...n, children: sinkChildResidues(kept, depth + 1) })
    }
    return res
  }
  work = sinkChildResidues(work, 2)

  // ③顶层残句并入主题父章
  const topLevelResidues = work.filter((n) => residueReason(n.title))
  const survivors = work.filter((n) => !residueReason(n.title))
  // 无法按关键词归类的顶层残句也并入通用父章，确保不残留顶层残句
  const parentByName = new Map<string, OutlineNode>()
  // 已有规范父章则复用
  for (const s of survivors) {
    const tp = topicParent(s.title)
    if (tp && tp === s.title) parentByName.set(s.title, s)
  }
  const result = survivors.slice()
  for (const n of topLevelResidues) {
    const tp = topicParent(n.title) || "其他技术响应条款"
    fixes.push({ action: "nestResidue", from: n.title, to: tp, note: residueReason(n.title), depth: 1 })
    let parent = parentByName.get(tp)
    if (!parent) {
      parent = makeParentShell(tp, uid("tp"))
      parentByName.set(tp, parent)
      result.push(parent)
    }
    parent.children = parent.children || []
    parent.children.push({ ...n, title: cleanSectionTitle(n.title) })
  }

  const residueCount = fixes.filter((f) => f.action === "nestResidue" || f.action === "mergeIntoParent").length
  return { nodes: result, fixes, residueCount, mergedGroups }
}
