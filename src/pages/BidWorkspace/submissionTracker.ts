// ---------------------------------------------------------------------------
// T19（2026-09-30）提交校验退回修复机制（易标 v2.30.5 piRuntimeService 的
// createSubmissionTracker 语义移植）：
//  - 校验不通过时每个目标最多退回修复 LIMIT 次（与执行失败的重试分开计数）；
//  - 按问题数判断修复进展：错误附带 issues 清单时按条数计，只有一句说明按 1 条计；
//  - 停滞熔断：最近 3 次问题数单调不降（连续两次修复都没减少问题）即停止退回——
//    防"越修越糟/原地打转"的无效修复白烧钱；
//  - 停止退回时把原因附加到 error.message，供调用方展示。
// 纯逻辑零依赖，不绑定任何 AI/任务设施。
// ---------------------------------------------------------------------------

export const SUBMISSION_RETURN_LIMIT = 3

export type SubmissionError = Error & { issues?: unknown[] }

export type SubmissionTracker = {
  /** 已退回次数 */
  readonly returns: number
  /** 本轮记录的问题数轨迹（诊断用） */
  readonly counts: number[]
  /** 校验失败时调用：true=允许再退回修复一次，false=停止（error.message 会被附加原因） */
  allowReturn(error: SubmissionError): boolean
}

function issueCountOf(error: SubmissionError): number {
  return Array.isArray(error?.issues) && error.issues.length ? error.issues.length : 1
}

export function createSubmissionTracker(limit: number = SUBMISSION_RETURN_LIMIT): SubmissionTracker {
  const counts: number[] = []
  let returns = 0
  return {
    get returns() {
      return returns
    },
    get counts() {
      return [...counts]
    },
    allowReturn(error: SubmissionError): boolean {
      counts.push(issueCountOf(error))
      const n = counts.length
      const stalled = n >= 3 && counts[n - 1] >= counts[n - 2] && counts[n - 2] >= counts[n - 3]
      if (returns >= limit || stalled) {
        error.message = `${error.message}\n提交校验已退回修复 ${returns} 次${stalled ? "，且连续两次问题数没有减少" : ""}，停止自动修复。`
        return false
      }
      returns += 1
      return true
    },
  }
}
