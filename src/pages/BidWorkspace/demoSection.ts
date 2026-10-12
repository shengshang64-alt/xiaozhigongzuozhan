/**
 * R-019/R-024 演示分节点治理（纯本地零 AI）
 * 演示 / 答辩 / 讲标类顶层章是现场环节的真实评分项（样例：功能演示 1/2 共 6 分），但应答内容是实机演示与
 * 讲标答辩，AI 长篇正文既无法替代、又会白占字数页数预算。默认策略：这类节点保留在目录、醒目标记「演示分」、
 * 不进正文生成、不计字数页数，并提示线下准备演示；提供 gen_options.generate_demo 开关按需生成占位应答。
 * 检测函数 isDemoScoreTitle 与 bidTypes 同源（isGenTargetChapter / chapterWordBudgets 已在 bidTypes 侧消费），
 * 本模块只做「UI 展示所需的节点扫描 / 汇总 + 线下准备提示语」，判定口径单一真源不重复实现。
 */
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { isDemoScoreTitle } from "./bidTypes"

export { isDemoScoreTitle }

export interface DemoNodeInfo {
  id: string
  title: string
}

/** 扫描顶层章里的演示/答辩节点（与生成目标判定同口径：跳过商务骨架章，只认命中演示关键词的技术章） */
export function findDemoScoreNodes(nodes: OutlineNode[] | null | undefined): DemoNodeInfo[] {
  const out: DemoNodeInfo[] = []
  for (const n of nodes ?? []) {
    if (!n) continue
    if (n.part === "biz") continue
    if (isDemoScoreTitle(n.title)) out.push({ id: n.id, title: (n.title ?? "").trim() })
  }
  return out
}

export interface DemoScoreSummary {
  hasDemo: boolean
  count: number
  titles: string[]
}

/** 演示分节点汇总（供「生成设置」醒目提示线下准备） */
export function summarizeDemoNodes(nodes: OutlineNode[] | null | undefined): DemoScoreSummary {
  const found = findDemoScoreNodes(nodes)
  return { hasDemo: found.length > 0, count: found.length, titles: found.map((f) => f.title) }
}

/** 线下准备演示提示语：演示 / 答辩按招标评分细则现场计取，正文不替代实机演示 */
export const DEMO_OFFLINE_HINT =
  "以下为演示 / 答辩评分节点：AI 正文无法替代现场实机演示与讲标答辩。请线下准备演示环境、演示脚本与答辩材料（数据脱敏、备用录屏、设备与网络预案），得分按招标评分细则现场计取。如需在标书中放占位应答，可在「生成设置」开启「演示分节点生成正文」。"
