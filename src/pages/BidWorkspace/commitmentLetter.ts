// ---------------------------------------------------------------------------
// 第3轮 G3：★/▲ 实质性条款逐字响应承诺函（纯本地零 AI）
// 依据《医疗信息化投标全流程规范（整合版）V1.0》：带 ★/▲ 的实质性条款须逐字响应、
// 不得改述、负偏离即无效投标。承诺语走固定模板（零 AI、稳定），生成后作为「商务部分」
// 章节并入投标正文（part=biz 不参与 AI 正文生成、随全套文档导出），落款留空由投标人盖章签字。
// ---------------------------------------------------------------------------
import type { Chapter, OutlineNode } from "../SolutionStudio/solutionTypes"
import { sectionText, STAR_CLAUSE_SECTION, type ParseReport } from "./bidTypes"

export const COMMITMENT_CHAPTER_ID = "bid-commitment-letter"
export const COMMITMENT_CHAPTER_TITLE = "实质性条款响应承诺函"

/** 条款起始行：可选编号前缀 + ★/☆/▲/△ 实质标记 */
const CLAUSE_HEAD_RE = /^\s*(?:\d+[.、)）]\s*)?[★☆▲△]/

/** 尾注行：条款清单末尾的"…另有 N 条未列出"之类提示，非独立条款、不并入 */
const TRAILING_NOTE_RE = /^…\s*另有/

/** 把 star_clauses 分区正文（多条、每条可多行）切分为独立条款；丢弃前置普通行与尾注 */
export function splitStarClauses(sectionContent: string): string[] {
  const lines = (sectionContent ?? "").split(/\r?\n/)
  const clauses: string[] = []
  let buf: string[] = []
  const flush = () => {
    const t = buf.join("\n").trim()
    if (t) clauses.push(t)
    buf = []
  }
  for (const line of lines) {
    if (!line.trim()) continue
    if (CLAUSE_HEAD_RE.test(line)) {
      flush()
      buf.push(line)
    } else if (buf.length) {
      if (TRAILING_NOTE_RE.test(line.trim())) continue // 尾注行不并入前一条款
      buf.push(line) // 进行中的条款续行
    }
  }
  flush()
  return clauses.filter((c) => !TRAILING_NOTE_RE.test(c))
}

/** 逐字引用条款 + 模板化承诺语，生成承诺函正文（零 AI） */
export function buildCommitmentLetter(clauses: string[]): string {
  const list = clauses.map((c) => (c ?? "").trim()).filter(Boolean)
  const head = ["我方已详细阅读并充分理解本招标文件中带 ★/▲ 标注的实质性条款与要求，现逐条郑重承诺如下：", ""]
  const body = list.map((c, i) => {
    const quote = c.replace(/\s+/g, " ").trim()
    return [
      `${i + 1}. 招标实质性条款（逐字引用）：「${quote}」`,
      "   我方承诺：完全响应并无条件满足上述条款的全部要求，不作负偏离；如有偏离或未按约履约，愿按招标文件规定承担无效投标及由此产生的一切法律责任。",
    ].join("\n")
  })
  const tail = [
    "",
    "我方承诺以上响应真实、有效，投标文件对全部实质性条款的响应均按上述口径执行，并加盖单位公章。",
    "",
    "投标人（盖章）：____________________",
    "法定代表人或授权代表（签字）：____________________",
    "日期：________ 年 ____ 月 ____ 日",
  ]
  return [...head, ...body, ...tail].join("\n")
}

/** 承诺函章节（biz 归属，随正文导出；gen_status=done 不参与 AI 正文生成） */
export function commitmentChapter(content: string): Chapter {
  return {
    node_id: COMMITMENT_CHAPTER_ID,
    title: COMMITMENT_CHAPTER_TITLE,
    sections: [],
    content,
    gen_status: "done",
    part: "biz",
  }
}

export function commitmentOutlineNode(): OutlineNode {
  return { id: COMMITMENT_CHAPTER_ID, title: COMMITMENT_CHAPTER_TITLE, children: [], part: "biz" }
}

/** 幂等 upsert 章节：存在则替换内容、不存在则追加末尾 */
export function upsertCommitment(chapters: Chapter[], content: string): Chapter[] {
  const ch = commitmentChapter(content)
  const idx = chapters.findIndex((c) => c.node_id === COMMITMENT_CHAPTER_ID)
  if (idx < 0) return [...chapters, ch]
  const next = chapters.slice()
  next[idx] = { ...next[idx], ...ch }
  return next
}

/** 幂等 upsert 大纲顶层节点；返回是否新增（供 toast 文案） */
export function upsertCommitmentOutline(outline: OutlineNode[]): { outline: OutlineNode[]; added: boolean } {
  if (outline.some((n) => n.id === COMMITMENT_CHAPTER_ID)) return { outline, added: false }
  return { outline: [...outline, commitmentOutlineNode()], added: true }
}

/**
 * 2026-10-23（用户要求：所有承诺函都按原文先响应，人工再调整）
 *
 * 收集承诺函要覆盖的条款：
 *   ① ★/▲ 实质性条款（逐字引用，原文不动）；
 *   ② 技术参数里的「方案型 + 含承诺」条款（如「须提供《第三方接口费用承诺函》」这类）。
 * 两条来源都保持原文逐字，不做改写——用户明确要「先按原文响应，我自己再调」。
 */
export function collectCommitmentClauses(report: ParseReport | null, extraClauses: string[] = []): string[] {
  const out: string[] = []
  const key = (t: string) => t.replace(/\s+/g, "").slice(0, 60)
  const seen = new Set<string>()
  const push = (raw: string) => {
    const t = (raw ?? "").trim()
    if (!t) return
    const k = key(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  for (const c of splitStarClauses(sectionText(report, STAR_CLAUSE_SECTION.key))) push(c)
  for (const c of extraClauses ?? []) if (/(承诺函|书面承诺|作出承诺|承诺不|承诺提供|承诺其|出具承诺)/.test(c)) push(c)
  return out
}
