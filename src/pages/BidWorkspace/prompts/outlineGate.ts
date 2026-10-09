// ---------------------------------------------------------------------------
// T15（2026-09-29）大纲门禁评审提示词（易标 runFinalOutlineGate 语义移植）：
// 大纲生成 + 结构修复之后的一道 AI 评审门禁——评审「结构/覆盖/承接/体量」并输出问题清单，
// 评审不过由调用方带问题清单走既有 buildOutlineFixMessages 修复（锁定顶层章身份）。
// 2026-10 易标 v2.20.2 对齐轮：目录二审口径升级——判重细则（近义/换说法/同名不机械判重）
// 与节点归属维度（易标 outline_review 的 duplicate-directory / professional-structure 审核维度移植）。
// ---------------------------------------------------------------------------

import { isBizPart } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 2 // 2026-10 易标 v2.20.2 目录二审口径对齐：重复判重细则（近义/换说法/同名不机械判重）+ 节点归属维度

export type OutlineGateReview = { passed: boolean; issues: string[] }

/** 评审输出净化：issues 逐条裁剪、去重、上限 8 条；解析失败由调用方按「跳过评审」处理 */
export function sanitizeOutlineGateReview(raw: unknown): OutlineGateReview {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const passed = rec.passed === true
  const arr = Array.isArray(rec.issues) ? rec.issues : []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const it of arr) {
    const s = String(it ?? "").trim()
    // 超长条目截断保留（丢掉会丢失评审信号），空串才跳过
    if (!s) continue
    const line = s.length > 160 ? `${s.slice(0, 160)}…` : s
    const key = line.slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    issues.push(line)
    if (issues.length >= 8) break
  }
  // 有问题清单却报 passed 视为未通过（问题清单优先，防模型自相矛盾）
  return { passed: passed && issues.length === 0, issues }
}

/** 大纲门禁评审：结构规则 + 评分承接对账 + 叶子体量带，输入为简化大纲树 */
export function buildOutlineGateReviewMessages(
  nodes: OutlineNode[],
  level: 0 | 1 | 2 | 3,
  leafTarget: number,
  numberedScoring: { id: string; item: string }[],
  sectionWords: number,
): LlmMessage[] {
  const slim = (list: OutlineNode[], depth = 1): unknown =>
    list.map((n) => ({
      title: n.title,
      ...(depth === 1 ? { part: isBizPart(n) ? "biz" : "tech" } : {}),
      ...(n.description?.trim() ? { description: n.description.trim() } : {}),
      children: slim(n.children ?? [], depth + 1),
    }))
  const leafLo = Math.max(1, Math.ceil(leafTarget * 0.8))
  const leafHi = Math.max(leafLo, Math.floor(leafTarget * 1.2))
  const leafCount = (list: OutlineNode[]): number =>
    list.reduce((sum, n) => (!isBizPart(n) && (n.children ?? []).length === 0 ? sum + 1 : sum + leafCount(n.children ?? [])), 0)
  const structureExpectation =
    level === 1
      ? "技术章只保留章节点（children 为空）"
      : level === 2
        ? "每个技术章下有节、节的 children 为空"
        : level === 3
          ? "每个技术章下有节、每节下至少 1 个条级节点"
          : "层级合理（最多三级）"
  const system = [
    "你是资深投标评审专家，负责对一份投标文件响应大纲做「生成门禁」评审。只判断结构与覆盖问题，不评价文采。",
    "",
    "评审项（逐项检查）：",
    "1. 单叶子分支：任何章/节下只有且仅有 1 个子节点（孤儿子节点）必须判定不通过；",
    `2. 层级结构：${structureExpectation}；商务骨架章（part="biz"）保持章+一级小节、不生成正文；`,
    `3. 叶子体量：技术章叶子（末端节点，商务章叶子不计入）当前 ${leafCount(nodes ?? [])} 个，应落在 ${leafLo}-${leafHi} 区间（目标 ${leafTarget} 个、每叶子约 ${sectionWords} 字），明显偏离必须指出；`,
    "4. 评分承接：下方给出技术评分项清单，叶子的 description 形如 [响应:R1,R3] 为承接标注；有分值的评分项没有被任何叶子承接时必须指出对应编号；",
    // 2026-10 易标 v2.20.2 目录二审口径：判重细则 + 节点归属
    "5. 重复与空泛：重复、近义、含义重叠或仅换一种说法的叶子标题必须指出；「概述/说明/其他」式空泛命名（应改为具体响应式命名）必须指出；注意不同专业分支下确有独立含义的同名标题（如不同系统各自的「安全保障」）不应机械判重；",
    "6. 节点归属：叶子内容与其父章/父节主题不符（放错章节、应移到更贴切章节）时必须指出，给出建议归属；",
    "7. 顶层章身份：商务章在前、技术章在后，part 归属错乱必须指出。",
    "",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"passed":true,"issues":[]}',
    '或 {"passed":false,"issues":["第二章下只有 1 个孤儿子节点「xxx」，需拆分或上提","评分项 R3 未被任何叶子承接"]}',
    "issues 每条 ≤100 字、指向具体章/节/编号，最多 8 条；全部通过时 passed=true 且 issues 为空数组。",
  ].join("\n")
  const scoringBlock = numberedScoring.length
    ? `【技术评分项清单（承接对账用）】\n${numberedScoring.map((s) => `${s.id} ${s.item}`).join("\n")}`
    : "【技术评分项清单】（本项目未提取到评分项，跳过第 4 项评审）"
  const user = `【大纲 JSON】\n${JSON.stringify({ outline: slim(nodes ?? []) })}\n\n${scoringBlock}\n\n请逐项评审并输出结论 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
