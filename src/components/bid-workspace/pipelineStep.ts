/** R200（提示必须有出路）：流水线「步骤号 ↔ 流程条可读名」的单一真源。
 * 三处面板（标书查重 / 废标检查 / 模拟评标）都要把「请先完成某环节」的提示文案与
 * 「前往该环节」的跳转按钮对齐到流程条真实名称，故集中在此，杜绝各处各写一套、与
 * PIPELINE_STEPS 漂移。纯逻辑、无 React / 后端依赖，可脱离渲染单测。 */
import { PIPELINE_STEPS } from "@/pages/BidWorkspace/bidTypes"

/**
 * 生成标书正文所在的流水线步骤号。
 *
 * UX-v2 七步对齐（2026-11-11）：原第 3 步「投标文件编制」拆成
 * ③大纲编制 与 ④正文编写，正文生成落在 **④**，本常量随之从 3 改为 4。
 * 这是「请先完成某环节」提示与跳转按钮的真实落点。
 */
export const COMPOSE_STEP = 4

/** 解析确认所在的流水线步骤号（新七步里仍为第 2 步「解析确认」）。 */
export const PARSE_STEP = 2

/** 取某步骤在流程条中的真实名称；查不到时兜底为「相关环节」。 */
export function stepGoLabel(step: number): string {
  return PIPELINE_STEPS.find((s) => s.step === step)?.label ?? "相关环节"
}

/** 正文缺失时的统一引导语（步骤名取自 PIPELINE_STEPS，不硬编码、与流程条不漂移）。 */
export function composeChaptersHint(): string {
  return `投标文件还没有正文，请先完成「${stepGoLabel(COMPOSE_STEP)}」环节`
}

/** 交卷前合规清单缺分区时的统一引导语（步骤名取自 PIPELINE_STEPS，与流程条不漂移）。 */
export function checklistParseHint(): string {
  return `解析报告里还没有「响应文件要求」或「资格性审查」分区——请先在「${stepGoLabel(PARSE_STEP)}」环节勾选并解析这两项（或在解析报告中手动补充），清单会自动生成。`
}
