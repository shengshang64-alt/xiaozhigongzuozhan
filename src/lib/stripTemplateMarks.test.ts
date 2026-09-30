// R88/F17：模板名显示层剥内部标记——只影响渲染字符串，绝不产生数据改写副作用。
import { describe, expect, it } from "vitest"

import { stripInternalTemplateMarks } from "@/pages/FormatTool/useFormatTool"

describe("stripInternalTemplateMarks", () => {
  it("剥除方头括号内部标记，保留正文名", () => {
    expect(stripInternalTemplateMarks("[PDF多模态转译]公司标准方案格式")).toBe("公司标准方案格式")
    expect(stripInternalTemplateMarks("方案模板 v2 [内部测试]")).toBe("方案模板 v2")
    expect(stripInternalTemplateMarks("【草稿】投标格式")).toBe("投标格式")
  })

  it("全名即标记/空串时回退原值（不显示空标题）", () => {
    expect(stripInternalTemplateMarks("[PDF多模态转译]")).toBe("[PDF多模态转译]")
    expect(stripInternalTemplateMarks("")).toBe("")
  })

  it("普通模板名原样返回（无副作用）", () => {
    expect(stripInternalTemplateMarks("公司标准方案格式")).toBe("公司标准方案格式")
    expect(stripInternalTemplateMarks("HIS投标-2026版")).toBe("HIS投标-2026版")
  })
})
