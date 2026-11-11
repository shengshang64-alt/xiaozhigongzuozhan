import { describe, expect, it } from "vitest"
import { COMPOSE_STEP, PARSE_STEP, checklistParseHint, composeChaptersHint, stepGoLabel } from "./pipelineStep"
import { PIPELINE_STEPS } from "@/pages/BidWorkspace/bidTypes"

const realLabel = (s: number) => PIPELINE_STEPS.find((x) => x.step === s)?.label ?? ""

describe("pipelineStep", () => {
  it("stepGoLabel 取自流程条真实名称，不硬编码不漂移", () => {
    for (const s of PIPELINE_STEPS) {
      expect(stepGoLabel(s.step)).toBe(realLabel(s.step))
    }
  })

  it("未知步骤号兜底为「相关环节」", () => {
    expect(stepGoLabel(9999)).toBe("相关环节")
  })

  it("COMPOSE_STEP 指向真实存在的正文步骤（UX-v2 七步：④ 正文编写）", () => {
    expect(PIPELINE_STEPS.some((s) => s.step === COMPOSE_STEP)).toBe(true)
    expect(COMPOSE_STEP).toBe(4)
    expect(stepGoLabel(COMPOSE_STEP)).toContain("正文编写")
  })

  it("composeChaptersHint 用单一真源步骤名拼引导语", () => {
    const hint = composeChaptersHint()
    expect(hint).toContain("投标文件还没有正文")
    expect(hint).toContain(stepGoLabel(COMPOSE_STEP))
  })

  it("PARSE_STEP 指向真实存在的解析步骤且名称含「解析确认」", () => {
    expect(PIPELINE_STEPS.some((s) => s.step === PARSE_STEP)).toBe(true)
    expect(stepGoLabel(PARSE_STEP)).toContain("解析确认")
  })

  it("checklistParseHint 用单一真源解析步骤名拼引导语", () => {
    const hint = checklistParseHint()
    expect(hint).toContain(`「${stepGoLabel(PARSE_STEP)}」`)
    expect(hint).toContain("响应文件要求")
    expect(hint).toContain("资格性审查")
  })
})
