import type { DocStatus } from "./solutionTypes"

// ---------------------------------------------------------------------------
// 方案侧批量生成中断恢复（对齐标书工作流 D1「上次批量中断恢复」）。
// runBulkGenerate 起跑即把 doc_status 写为「生成中」并落库，收口才改写终态；
// 若中途刷新页面 / 崩溃 / 切走，方案刷新后会永久显示「生成中」徽标，且用户
// 不知道已生成的章可续跑。以下纯函数用于打开方案时按各章真实进度推导阶段、
// 判定是否需要复位、以及生成断点续跑提示文案，口径与 runBulkGenerate 的
// nextStatus 推导（doneTotal 与 total 比较）保持一致。
// ---------------------------------------------------------------------------

/** 仅依赖各章 gen_status 推导方案阶段：全 done→done，有 done 但未全→partial，无 done→outline。 */
export function deriveSolutionDocStatus(
  chapters: readonly { gen_status: string }[],
): DocStatus {
  const total = chapters.length
  let done = 0
  for (const c of chapters) {
    if (c.gen_status === "done") done += 1
  }
  if (total > 0 && done >= total) return "done"
  if (done > 0) return "partial"
  return "outline"
}

/** 打开方案时是否需要复位陈旧的「生成中」持久态：仅当记录显示 generating 且当前无进行中的批量。 */
export function shouldRecoverStaleGenerating(docStatus: string, bulkGenerating: boolean): boolean {
  return docStatus === "generating" && !bulkGenerating
}

/** 断点续跑提示文案：存在「已完成但未全」的章时给出，否则返回 null（与标书 D1 横幅同口径措辞）。 */
export function bulkResumeNotice(done: number, total: number): string | null {
  if (total > 0 && done > 0 && done < total) {
    return "检测到上次批量生成尚未完成，点「继续生成正文」可从上次的章继续（已生成的章节不会重复付费）"
  }
  return null
}
