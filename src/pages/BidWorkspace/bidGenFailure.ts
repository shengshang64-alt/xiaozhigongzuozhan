// ---------------------------------------------------------------------------
// R301：标书章节生成失败「归因」薄封装——复用 SolutionStudio R282 的 genFailureSummary 纯函数。
// 标书页与方案页共用同一 Chapter 类型（genError 随 bid_chapters JSON 持久化，零 collection 变更），
// 故归类 / 聚合逻辑无需重写；本模块只做「技术章口径过滤」，与 ComposeStep 生成总览 failedCount 同尺。
// 纯本地、零 AI、零写库：只回答「哪些章因同一原因失败」，与体检同口径——只报不拦。
// ---------------------------------------------------------------------------
import {
  classifyGenFailure,
  normalizeGenError,
  summarizeGenFailures,
  type GenFailureCategory,
  type GenFailureSummary,
} from "@/pages/SolutionStudio/genFailureSummary"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

/** 技术章判定：与生成总览 failedCount 同口径（biz 商务骨架章不生成正文，不参与归因；缺省/tech 计入） */
export function isBidTechChapter(ch: Chapter): boolean {
  return !ch.part?.startsWith("biz")
}

/** 整本技术章失败归因摘要（按「归类 + 逐字原因」聚合，最可能根因恒排第一；biz 章先按口径过滤） */
export function summarizeBidGenFailures(chapters: Chapter[] | undefined | null): GenFailureSummary {
  return summarizeGenFailures((chapters ?? []).filter(isBidTechChapter))
}

// ---------------------------------------------------------------------------
// R39：解析链路「分段全灭」的可诊断透出。
// 实测教训：整本 22 段被上游以 HTTP 400 秒拒时，useBidWorkspace 把每段的真实错误 catch 掉，
// 只丢一句「分段解析全部失败，请重试」——用户与运维都看不到真因（本次是 OpenCode GO 端点要求
// x-opencode-session 会话头），只能盲试模型。这里把首个真实原因带出来并给可执行的下一步。
// 归类复用 SolutionStudio R282 的 classifyGenFailure 单源，不另立第二套口径；
// 另补一条窄口径：modelFailover 刻意把 HTTP 400 归 other 以免误冷通道（该裁定维持不动），
// 但**归因文案**仍该告诉用户「这一路不接受请求，先换模型」——两件事目的不同，不冲突。
// ---------------------------------------------------------------------------

/** 上游拒收请求本身（契约变更 / 参数不支持 / 模型名不存在），与「鉴权失败」处置同为换通道 */
const REJECTED_RE = /HTTP\s*400|HTTP\s*404|HTTP\s*422|missing x-|not supported|unsupported|invalid request/i

/** 各类失败的可执行引导（指向前端真实存在的动作：顶部模型选择器、「模型配置」页、逐项重新解析） */
const CATEGORY_HINTS: Record<GenFailureCategory, string> = {
  timeout: "该模型响应超时——换一路更快的模型，或稍后对单项重新解析",
  quota: "该模型限流或额度/余额不足——稍后重试，或到「模型配置」核对该通道额度",
  channel: "该模型通道鉴权/服务异常——到「模型配置」检查 API Key，或先换一路模型",
  parse: "产出无法解析成结构化结果——换一路模型后对单项重新解析",
  network: "网络异常——检查本机到该模型服务端的连通性后重试",
  blank: "模型返回空内容——换一路模型后对单项重新解析",
  other: "请换一路模型后对单项重新解析",
}

/**
 * 分段解析全灭时的透出文案：真实原因（截断到 140 字）+ 一句可执行引导。
 * 一条原因都拿不到时退回原口径，绝不编造原因。
 */
export function parseSegmentsFailedMessage(reasons: (string | undefined | null)[]): string {
  const first = normalizeGenError((reasons ?? []).find((r) => !!normalizeGenError(r)) ?? "")
  if (!first) return "分段解析全部失败，请重试"
  const hint = REJECTED_RE.test(first)
    ? "该模型通道不接受本次请求（多为上游接口契约变更或参数不支持）——先在顶部模型选择器换一路模型，再逐项重新解析"
    : CATEGORY_HINTS[classifyGenFailure(first)]
  return `分段解析全部失败：${first.slice(0, 140)}。${hint}`
}
