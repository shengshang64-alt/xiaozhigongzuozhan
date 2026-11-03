/** R199（交互断链）：归档导出卡的「就绪判定 + 出路」单一真源。
 * 每张导出卡在内容未就绪时，此前只显示灰态文案「内容未就绪」却无任何出路——
 * 与本项目反复修复的「提示必须有出路」原则相悖（见 BidNodesCard / MockEvalPanel「前往解析环节」）。
 * 本模块集中：① 该导出项就绪所需产物；② 生成它的流水线步骤号；③ 步骤名（走 PIPELINE_STEPS，杜绝与流程条漂移）；
 * ④ 未就绪时的引导语。纯逻辑、无 React / 后端依赖，可脱离渲染单测。 */
import { stepGoLabel } from "@/components/bid-workspace/pipelineStep"
import { reconcileChaptersWithOutline } from "@/pages/BidWorkspace/chapterIntegrity"

export type ArchiveExportKey = "bid" | "deviation" | "parse" | "check" | "eval"

/** 仅取导出就绪判定所需字段的结构子集（BidProjectRecord 天然满足，多余字段不影响赋值）。 */
export type ArchiveProjLite = {
  bid_chapters: {
    title?: string | null
    content?: string | null
    gen_status?: string | null
    section_stats?: { chars?: number }[] | null
  }[]
  /** 2026-10-25（A1）：章表↔大纲对账用；缺省时不做重复章判定，行为同旧版 */
  bid_outline?: { id?: string; title?: string | null }[] | null
  response_map: { rows?: unknown[] } | null
  parse_report: unknown
  dup_report: unknown
  void_check: unknown
  ai_review: unknown
}

export type ArchiveCardGuidance = {
  ready: boolean
  /** 生成该产物所在的流水线步骤号 */
  step: number
  /** 步骤可读名（取自 PIPELINE_STEPS，与流程条文案一致） */
  goLabel: string
  /** 未就绪时的引导语（作为禁用按钮 title + 出路说明） */
  missingHint: string
  /** 未就绪时按钮上的短语（缺省走通用「内容未就绪」） */
  shortLabel?: string
}

const GUIDANCE: Record<ArchiveExportKey, { step: number; missingHint: string; ready: (p: ArchiveProjLite) => boolean }> = {
  bid: {
    step: 3,
    missingHint: "先在「投标文件编制」生成或编写至少一章正文，再导出投标文件 Word",
    ready: (p) => p.bid_chapters.some((c) => (c.content ?? "").trim().length > 0),
  },
  deviation: {
    step: 3,
    missingHint: "先在「投标文件编制」生成技术偏离表（依赖解析报告与章节正文）",
    ready: (p) => (p.response_map?.rows?.length ?? 0) > 0,
  },
  parse: {
    step: 2,
    missingHint: "先完成「AI 解析报告」环节，再导出解析报告",
    ready: (p) => !!p.parse_report,
  },
  check: {
    step: 4,
    missingHint: "先完成「标书查重」或「废标检查」环节，再导出检查报告",
    ready: (p) => !!p.dup_report || !!p.void_check,
  },
  eval: {
    step: 6,
    missingHint: "先完成「模拟评标」环节，再导出评标报告",
    ready: (p) => !!p.ai_review,
  },
}

// 步骤名统一走 pipelineStep 单一真源（R200 收敛此前重复实现）
function stepLabel(step: number): string {
  return stepGoLabel(step)
}

export function archiveCardGuidance(key: ArchiveExportKey, proj: ArchiveProjLite): ArchiveCardGuidance {
  const g = GUIDANCE[key]
  // 2026-10-25（A1）：章表里有与现有章重复的孤儿章时，导出的 Word 会多出一份同主题章。
  // 只在「本来就能导」的项目上加这道判定——产物都没生成时仍走原有引导语，不给两套未就绪理由。
  if (key === "bid" && g.ready(proj)) {
    const dup = reconcileChaptersWithOutline(proj.bid_outline ?? [], proj.bid_chapters).duplicated
    if (dup.length) {
      const names = dup.slice(0, 3).map((d) => d.title).join("、")
      return {
        ready: false,
        step: g.step,
        goLabel: stepLabel(g.step),
        missingHint: `章表里有 ${dup.length} 章与现有章重复（${names}${dup.length > 3 ? " 等" : ""}）——导出会多出一份同主题章。请先到第 ${g.step} 步按当前大纲整理章表（删除旧稿或合并），再导出`,
        shortLabel: "章表与大纲不一致",
      }
    }
  }
  return { ready: g.ready(proj), step: g.step, goLabel: stepLabel(g.step), missingHint: g.missingHint }
}
