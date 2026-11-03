// ---------------------------------------------------------------------------
// r277 切片4 · 评分策略建议卡（评审报告 B/C 级根修，纯本地零 AI）：
// 评标口径是「未提供的证据一律不得分」（A3 截图全占位、B 级客观项零证据仅复读评分标准），
// 而笼统「完全满足」（C1 118 项）拿不到竞争分。本模块基于既有数据派生两类建议，不新增存储字段：
//  ① 加分建议：承诺维度库（质保/免费维保/响应时效/驻场）× 评分细则匹配，全文已含升级式承诺则不推（幂等）；
//  ② 证据挂载提醒：客观项要求截图/证书/案例等佐证而全文未见任何挂载占位 → 提醒挂载（AI 不可编造证据）。
// 建议文本只给「口径 + 【待填写】占位」，绝不替用户编造数值承诺。
// ---------------------------------------------------------------------------
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { NumberedScoringItem } from "./bidTypes"

export type SuggestionKind = "enhance" | "evidence"

export interface ScoringSuggestion {
  id: string
  title: string
  score: number
  kind: SuggestionKind
  text: string
}

/** 承诺维度库：细则命中 trigger，正文缺 upgrade 式承诺时输出建议口径（评审报告实例：质保 3 年→6 年、维保 8% 逐字承诺） */
const COMMIT_DIMENSIONS: { name: string; trigger: RegExp; upgrade: RegExp; advice: string }[] = [
  { name: "质保期", trigger: /质保|保修/, upgrade: /延长质保|质保[^。\n]{0,8}(?:5|6|7|8|10)\s*年/, advice: "建议评估延长质保期口径（如招标要求之上再加年），以「我方承诺质保【待填写：X】年（超出招标要求【待填写：Y】年）」逐字写入对应章节" },
  { name: "免费维保", trigger: /免费维保|维保|维护费/, upgrade: /免费维保[^。\n]{0,10}\d+|维保(?:费率|比例)[^。\n]{0,8}\d+\s*%/, advice: "建议明确免费维保年限/维保费率并逐字承诺（评分细则认书面口径，口头套话不得分）" },
  { name: "响应时效", trigger: /响应时间|响应时效|故障恢复/, upgrade: /7×24|7x24|30分钟|1小时[^。\n]{0,12}(?:恢复|到场|响应)/, advice: "建议给出优于招标要求的量化响应时效（如 7×24 小时、30 分钟到场），并写明违约处置口径" },
  { name: "驻场服务", trigger: /驻场|本地化服务/, upgrade: /≥?\s*\d+\s*人[^。\n]{0,10}驻场|\d+\s*名[^。\n]{0,8}驻场/, advice: "建议明确驻场人数与期限，写入服务方案对应小节" },
]

/** 客观证据挂载要求（细则原文出现即视为该评分项须书面挂载证据） */
const EVIDENCE_RE = /截图|证书|案例|报告|扫描件|原件|复印件|证明材料|佐证/

/** 评分策略建议：≤8 条（按 score 降序）；items 为空返回空数组（老项目静默） */
export function scoringStrategySuggestions(
  items: NumberedScoringItem[],
  chapters: Chapter[],
): ScoringSuggestion[] {
  if (!items.length) return []
  const fullText = chapters.map((c) => c.content ?? "").join("\n")
  const hasEvidenceMount = /【\s*待填写[^】]*】/.test(fullText)
  const out: ScoringSuggestion[] = []
  for (const it of items) {
    const crit = `${it.item ?? ""} ${it.criteria ?? ""}`
    if (!it.isSubjective && EVIDENCE_RE.test(crit) && !hasEvidenceMount) {
      out.push({
        id: `${it.id}-evidence`, title: it.item, score: it.score, kind: "evidence",
        text: `客观项须书面挂载证据（${(crit.match(EVIDENCE_RE) || [""])[0]}类）：请在对应章节以「佐证材料：【待填写：证据确切名称】」占位并挂载真实材料，复述评分标准不得分`,
      })
      continue
    }
    for (const dim of COMMIT_DIMENSIONS) {
      if (!dim.trigger.test(crit) || dim.upgrade.test(fullText)) continue
      out.push({ id: `${it.id}-${dim.name}`, title: it.item, score: it.score, kind: "enhance", text: `${dim.name}：${dim.advice}` })
      break // 每评分项至多推一个维度，防刷屏
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, 8)
}

// ---------------------------------------------------------------------------
// 演示方案骨架（R-019/R-024 增强，纯本地零 AI）：演示/答辩章的应答是实机演示与讲标，
// AI 长篇正文无法替代；开启「演示分节点生成正文」后不再交给 AI 自由发挥，而是本地生成
// 可执行准备骨架（环境/脚本/录屏/问答/得分对照），演示脚本环节一律【待填写】等人工填实。
// ---------------------------------------------------------------------------
export const DEMO_SKELETON_MARK = "【演示准备骨架"

/** 骨架小节：标题 → 行生成器（name=大纲节点名，score=该节点演示分值，0=评分项未解析） */
export function buildDemoSkeleton(name: string, score: number, nodes: { title: string }[]): string {
  const list = nodes.map((n, i) => `${i + 1}. 【待填写：功能点】——「${(n.title ?? "").trim()}」对应演示路径与讲词`).join("\n")
  return [
    `【演示准备骨架（本地生成占位，请按项目实际填实后再交卷）】「${name}」${score > 0 ? `（${score} 分）` : ""}`,
    "一、演示环境：【待填写：系统版本/数据集/账号权限/网络与设备】",
    "二、演示脚本（按评分细则逐环节）：",
    list || "1. 【待填写：演示环节】",
    "三、备用录屏：【待填写：录屏链接/文件位置，现场故障时切换】",
    "四、答辩问答边界：【待填写：主讲人分工、答不上问题的统一口径】",
    "五、得分对照：本环节得分点以评分细则为准，演示完成后逐项自查打钩。",
  ].join("\n")
}
