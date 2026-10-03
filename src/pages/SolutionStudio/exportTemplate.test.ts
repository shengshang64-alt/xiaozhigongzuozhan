// R147（解除 r124-solutionstudio-docx-defer）伴生单测：buildExportFrontMatter 转
// async（docx 改为函数内动态导入），钉住封面/目录/日期行的结构口径改动前后等价。
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_EXPORT_TEMPLATE,
  buildExportFrontMatter,
  normalizeExportTemplate,
  readSolutionExportTemplate,
  writeSolutionExportTemplate,
} from "./exportTemplate"
import type { SolutionRecord } from "./solutionTypes"

const sol = {
  solution_name: "XX医院信息化方案",
  hospital: "某三甲医院",
  solution_type: "smart",
} as unknown as SolutionRecord

describe("normalizeExportTemplate / 读写容错", () => {
  it("空输入恢复默认（cover/toc 默认开）", () => {
    expect(normalizeExportTemplate(null)).toEqual(DEFAULT_EXPORT_TEMPLATE)
    expect(DEFAULT_EXPORT_TEMPLATE.cover).toBe(true)
    expect(DEFAULT_EXPORT_TEMPLATE.toc).toBe(true)
  })

  it("localStorage 不可用时读写静默降级不抛错", () => {
    vi.stubGlobal("window", { localStorage: null })
    expect(readSolutionExportTemplate("x").cover).toBe(true)
    expect(() => writeSolutionExportTemplate("x", DEFAULT_EXPORT_TEMPLATE)).not.toThrow()
    vi.unstubAllGlobals()
  })
})

describe("buildExportFrontMatter（R147 按需化后行为等价）", () => {
  it("全关：返回空数组", async () => {
    const children = await buildExportFrontMatter(sol, { cover: false, company: "", toc: false, headerText: "" })
    expect(children).toHaveLength(0)
  })

  it("封面（无单位名）：标题/医院·类型/日期/分页 = 4 段", async () => {
    const children = await buildExportFrontMatter(sol, { cover: true, company: "", toc: false, headerText: "" })
    expect(children).toHaveLength(4)
  })

  it("封面（带单位名）比不带多 1 段", async () => {
    const withCompany = await buildExportFrontMatter(sol, { cover: true, company: "XX科技有限公司", toc: false, headerText: "" })
    const without = await buildExportFrontMatter(sol, { cover: true, company: "", toc: false, headerText: "" })
    expect(withCompany).toHaveLength(without.length + 1)
  })

  it("封面+目录全开：4 + 3（目录标题/目录域/分页）= 7 段", async () => {
    const children = await buildExportFrontMatter(sol, { cover: true, company: "", toc: true, headerText: "" })
    expect(children).toHaveLength(7)
  })
})
