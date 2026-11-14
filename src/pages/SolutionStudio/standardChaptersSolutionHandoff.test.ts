// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  STANDARD_CHAPTERS_SOLUTION_FROM,
  consumeStandardChaptersSolution,
  standardChaptersSolutionPath,
  stashStandardChaptersSolution,
} from "./standardChaptersSolutionHandoff"
import type { StandardChapterPreview } from "./standardChapters"

const preview: StandardChapterPreview = {
  title: "t149联调-合成",
  typeKey: "standard",
  outline: [{ id: "n1", title: "建设内容", children: [] }],
  modules: [
    {
      moduleKey: "emr",
      moduleTitle: "电子病历系统",
      productName: "电子病历系统",
      moduleName: "",
      status: "ok",
      body: "电子病历覆盖门急诊书写。",
      sources: [],
    },
    {
      moduleKey: "xyz",
      moduleTitle: "尚无素材的演示模块XYZ",
      productName: "尚无素材的演示模块XYZ",
      moduleName: "",
      status: "missing",
      body: "",
      sources: [],
      gapReason: "知识库中未找到已审核的相关素材，未编造正文。",
    },
  ],
  stats: { ok: 1, thin: 0, missing: 1, truncated: 0 },
  warnings: [],
}

describe("standardChaptersSolutionHandoff", () => {
  it("只交接预览草稿，不暗示覆盖已有方案", () => {
    stashStandardChaptersSolution({
      preview,
      solutionName: "t149联调-合成",
      hospital: "t149联调-合成",
      checklistId: "chk_1",
    })
    expect(standardChaptersSolutionPath()).toContain(STANDARD_CHAPTERS_SOLUTION_FROM)
    const got = consumeStandardChaptersSolution()
    expect(got?.solutionName).toBe("t149联调-合成")
    expect(got?.preview.modules.some((m) => m.status === "missing" && m.moduleTitle.includes("XYZ"))).toBe(true)
    expect(consumeStandardChaptersSolution()).toBeNull()
  })
})
