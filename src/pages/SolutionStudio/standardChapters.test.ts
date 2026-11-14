import { describe, expect, it } from "vitest"
import type { ChecklistLine } from "./checklistTypes"
import {
  buildStandardChapterPreview,
  checkedChecklistLines,
  classifyCoverage,
  dedupeSources,
  draftFromSources,
  mergeSourcesToBody,
  moduleQueryOf,
  moduleTitleOf,
  maskInstitutionName,
  systemsChapterBodyFromPreview,
  type ChapterSource,
} from "./standardChapters"

function line(partial: Partial<ChecklistLine> & { product_name: string }): ChecklistLine {
  return {
    line_id: partial.line_id ?? partial.product_name,
    category: "",
    product_line: "",
    product_name: partial.product_name,
    module_name: partial.module_name ?? "",
    module_func: partial.module_func ?? "",
    unit: "套",
    qty: 1,
    unit_price: 0,
    source: "company",
    rating_hits: [],
    remark: "",
    product_id: "",
    checked: partial.checked ?? true,
  }
}

function src(partial: Partial<ChapterSource> & { id: string; body: string }): ChapterSource {
  return {
    kind: partial.kind ?? "atom",
    id: partial.id,
    title: partial.title ?? partial.id,
    docName: partial.docName ?? "合成文档",
    quote: partial.quote ?? "",
    body: partial.body,
    anchor: partial.anchor,
  }
}

describe("checkedChecklistLines / 模块标题", () => {
  it("只保留勾选行，并按产品+模块去重", () => {
    const lines = [
      line({ product_name: "电子病历系统", module_name: "质控", line_id: "1" }),
      line({ product_name: "电子病历系统", module_name: "质控", line_id: "1b", checked: true }),
      line({ product_name: "集成平台", checked: false }),
      line({ product_name: "   ", module_name: "" }),
    ]
    const picked = checkedChecklistLines(lines)
    expect(picked.map((l) => l.product_name)).toEqual(["电子病历系统"])
    expect(moduleTitleOf(picked[0])).toBe("电子病历系统 / 质控")
    expect(moduleQueryOf(picked[0])).toContain("电子病历系统")
  })
})

describe("dedupeSources / classifyCoverage / merge", () => {
  it("相同锚点或高度相似正文只保留一条", () => {
    const list = dedupeSources([
      src({ id: "a", body: "建设全院统一的患者主索引，实现多系统身份识别。", docName: "文档A", anchor: "p1" }),
      src({ id: "b", body: "建设全院统一的患者主索引，实现多系统身份识别。", docName: "文档A", anchor: "p1" }),
      src({ id: "c", body: "建设全院统一的患者主索引，实现多系统身份识别！", docName: "文档B", anchor: "p2" }),
    ])
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("a")
  })

  it("无素材为缺项，单条为偏少，两条且够长为充足", () => {
    expect(classifyCoverage([])).toBe("missing")
    expect(classifyCoverage([src({ id: "a", body: "短" })])).toBe("thin")
    expect(
      classifyCoverage([
        src({ id: "a", body: "患者主索引用于打通院内多系统的身份识别，是集成建设的基础能力。" }),
        src({ id: "b", body: "主数据管理应覆盖门诊、住院与医技登记环节，避免一人多号。" }),
      ]),
    ).toBe("ok")
  })

  it("合并正文只含源材料并附来源，不另写没有依据的句子", () => {
    const body = mergeSourcesToBody("患者主索引", [
      src({ id: "a", body: "建设全院统一的患者主索引。", docName: "合成规范" }),
    ])
    expect(body).toContain("建设全院统一的患者主索引。")
    expect(body).toContain("资料来源：")
    expect(body).toContain("合成规范")
    expect(body).not.toMatch(/综上所述|建议采购|我们承诺/)
  })
})

describe("buildStandardChapterPreview", () => {
  it("按模块给出正文或缺项，大纲子节与模块对应，不编造缺项正文", () => {
    const lines = [
      line({ product_name: "电子病历系统", module_name: "门急诊病历", line_id: "emr" }),
      line({ product_name: "集成平台", line_id: "esb" }),
      line({ product_name: "尚无素材的演示模块", line_id: "gap" }),
    ]
    const preview = buildStandardChapterPreview({
      title: "合成清单预览",
      typeKey: "standard",
      lines,
      moduleSources: {
        "电子病历系统::门急诊病历": [
          src({ id: "1", body: "电子病历应覆盖门急诊病历书写、质控与归档，并支持分级评价相关要求。" }),
          src({ id: "2", body: "门急诊病历与挂号收费、医生站联动，避免重复录入。" }),
        ],
        集成平台: [src({ id: "3", body: "集成平台承担系统间数据交换。" })],
      },
    })
    expect(preview.stats).toMatchObject({ ok: 1, thin: 1, missing: 1, truncated: 0 })
    const gap = preview.modules.find((m) => m.moduleTitle.includes("尚无素材"))!
    expect(gap.status).toBe("missing")
    expect(gap.body).toBe("")
    expect(gap.gapReason).toMatch(/未编造/)
    const sys = preview.outline.find((n) => n.title === "核心功能模块介绍")!
    expect(sys.children.map((c) => c.title)).toEqual([
      "电子病历系统 / 门急诊病历",
      "集成平台",
      "尚无素材的演示模块",
    ])
    const chapter = systemsChapterBodyFromPreview(preview)
    expect(chapter).toContain("电子病历应覆盖门急诊病历书写")
    expect(chapter).toContain("（缺项）")
    expect(chapter).not.toMatch(/我们为贵院量身定制尚无素材/)
  })


  it("无关检索命中不会写成该模块正文，应标为缺项", () => {
    const draft = draftFromSources(line({ product_name: "尚无素材的演示模块XYZ" }), [
      src({ id: "noise", title: "门诊电子病历", body: "门诊电子病历系统提供诊间打印、集中打印功能。", docName: "招标文件" }),
    ])
    expect(draft.status).toBe("missing")
    expect(draft.body).toBe("")
  })

  it("缺项草稿不会把空来源写成假正文", () => {
    const draft = draftFromSources(line({ product_name: "不存在模块" }), [])
    expect(draft.status).toBe("missing")
    expect(draft.body).toBe("")
  })
})

describe("maskInstitutionName", () => {
  it("掩盖医院全名，不误伤以医院开头的产品名", () => {
    expect(maskInstitutionName("华东某人民医院信息化建设方案")).toBe("某医院信息化建设方案")
    expect(maskInstitutionName("医院信息系统接口规范")).toBe("医院信息系统接口规范")
    expect(maskInstitutionName("\u6c60\u5dde\u4e8c\u9662\u62db\u6807\u6587\u4ef6")).toBe("\u67d0\u533b\u9662\u62db\u6807\u6587\u4ef6")
  })
})
