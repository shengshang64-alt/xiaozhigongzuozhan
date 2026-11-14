import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx"
import { extractDocxTables } from "@/lib/docxTableExtract"
import { normalizeCustomerLine } from "@/pages/SolutionStudio/checklistTypes"
import {
  bidRequirementLinesFromReport,
  buildRequirementPreview,
  detectRatingGoals,
  itemsFromTables,
  kindLabel,
  ratingSelectionIsActive,
  splitRequirementLines,
} from "./requirementExtract"

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/t141-sample-requirements.txt"),
  "utf8",
)

describe("detectRatingGoals：组合口径不是智慧管理", () => {
  it("「五级四甲」识别为病历五级 ∪ 互联互通四甲，不写入 sm", () => {
    const r = detectRatingGoals("建设目标为五级四甲。")
    expect(r.combos.map((c) => c.key)).toEqual(["l5-4a"])
    expect(r.selection.emr).toEqual(["5"])
    expect(r.selection.hpc).toEqual(["4A"])
    expect(r.selection.sm).toBeUndefined()
    expect(r.selection.ss).toBeUndefined()
    expect(r.labels.some((l) => l.includes("五级四甲"))).toBe(true)
    expect(r.labels.join()).not.toMatch(/智慧管理/)
  })

  it("分别写出电子病历五级与互联互通四级甲等时，推导出五级四甲组合", () => {
    const r = detectRatingGoals("按照电子病历五级、互联互通四级甲等开展建设。")
    expect(r.selection.emr).toContain("5")
    expect(r.selection.hpc).toContain("4A")
    expect(r.combos.map((c) => c.key)).toContain("l5-4a")
    expect(r.selection.sm).toBeUndefined()
  })

  it("五级四乙 / 六级四甲 / 六级五乙 各走对应并集", () => {
    expect(detectRatingGoals("目标五级四乙").combos[0]?.key).toBe("l5-4b")
    expect(detectRatingGoals("目标六级四甲").selection).toMatchObject({ emr: ["6"], hpc: ["4A"] })
    expect(detectRatingGoals("目标六级五乙").selection).toMatchObject({ emr: ["6"], hpc: ["5B"] })
  })

  it("智慧服务五级、智慧管理三级需带体系前缀；三级医院信息化不误入", () => {
    const r = detectRatingGoals("同步推进智慧服务五级，智慧管理达到三级。另执行三级医院信息化建设要求与公立医院绩效考核。")
    expect(r.selection.ss).toEqual(["5"])
    expect(r.selection.sm).toEqual(["3"])
    const onlyHospital = detectRatingGoals("按照三级医院信息化建设要求实施。")
    expect(onlyHospital.selection.ss).toBeUndefined()
    expect(onlyHospital.selection.sm).toBeUndefined()
    expect(onlyHospital.combos).toEqual([])
  })

  it("「五级四甲」不会被拆成智慧服务五级", () => {
    const r = detectRatingGoals("对标五级四甲。")
    expect(r.selection.ss).toBeUndefined()
  })
})

describe("splitRequirementLines：行项拆分", () => {
  it("从固定合成材料抽出系统清单与建设内容条目，且评级句不进清单", () => {
    const items = splitRequirementLines(FIXTURE)
    const raws = items.map((i) => i.raw)
    expect(raws.some((r) => r.includes("电子病历系统"))).toBe(true)
    expect(raws.some((r) => r.includes("集成平台"))).toBe(true)
    expect(raws.some((r) => r.includes("门急诊挂号收费"))).toBe(true)
    expect(raws.some((r) => r.includes("患者主索引"))).toBe(true)
    expect(raws.some((r) => r.includes("门诊排队叫号"))).toBe(true)
    expect(raws.some((r) => /五级四甲|评级目标/.test(r))).toBe(false)
  })

  it("编号与项目符号都能拆，normalize 后可交给对照", () => {
    const items = splitRequirementLines("1. 电子病历系统（含质控）\n2、集成平台 V3.0\n(3) 门急诊挂号收费\n- 临床路径管理系统")
    expect(items.map((i) => i.norm)).toEqual(
      ["电子病历系统", "集成平台", "门急诊挂号收费", "临床路径管理系统"].map((s) => normalizeCustomerLine(s)),
    )
  })
})

describe("buildRequirementPreview：预览再对照", () => {
  it("合成材料为混合类型，带五级四甲与可对照条目", () => {
    const preview = buildRequirementPreview({ text: FIXTURE, fileName: "t141-sample-requirements.txt" })
    expect(preview.kind).toBe("mixed")
    expect(kindLabel(preview.kind)).toBe("评级 + 清单")
    expect(preview.rating.combos.map((c) => c.key)).toContain("l5-4a")
    expect(preview.rating.selection.ss).toEqual(["4"])
    expect(preview.rating.selection.sm).toBeUndefined()
    expect(preview.items.length).toBeGreaterThanOrEqual(6)
    expect(preview.items.every((i) => i.norm.length >= 2 && i.raw.length >= 2)).toBe(true)
    expect(ratingSelectionIsActive(preview.rating.selection)).toBe(true)
  })

  it("仅有评级目标时条目可为空，并给出预览警告，不假装写入清单", () => {
    const preview = buildRequirementPreview({ text: "建设目标为五级四甲。", fileName: "rating-only.txt" })
    expect(preview.kind).toBe("rating")
    expect(preview.items).toEqual([])
    expect(preview.warnings.some((w) => w.includes("未抽出模块清单"))).toBe(true)
  })

  it("表格行与正文合并去重，保留原表单元格", () => {
    const tables = [
      [
        ["序号", "系统名称", "数量"],
        ["1", "电子病历系统", "1"],
        ["2", "合理用药系统", "1"],
      ],
    ]
    const preview = buildRequirementPreview({
      text: "一、系统清单\n1. 电子病历系统\n",
      tables,
      fileName: "mix.docx",
    })
    const names = preview.items.map((i) => i.raw)
    expect(names.filter((n) => n.includes("电子病历")).length).toBe(1)
    expect(names.some((n) => n.includes("合理用药"))).toBe(true)
    const tableItem = preview.items.find((i) => i.raw.includes("合理用药"))
    expect(tableItem?.cells?.some((c) => c.includes("合理用药"))).toBe(true)
  })
})

describe("itemsFromTables 与 docx 表格链路", () => {
  it("猜测名称列后抽出模块名", () => {
    const items = itemsFromTables([
      [
        ["序号", "名称", "单位"],
        ["1", "住院护士站", "套"],
        ["2", "临床路径管理系统", "套"],
      ],
    ])
    expect(items.map((i) => i.norm)).toEqual([
      normalizeCustomerLine("住院护士站"),
      normalizeCustomerLine("临床路径管理系统"),
    ])
  })

  it("真实 docx 打包后的表格能抽出行项", async () => {
    const cell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun(text)] })] })
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("示范医院信息化建设要求（合成材料）")] }),
            new Paragraph({ children: [new TextRun("建设目标为五级四甲。")] }),
            new Table({
              rows: [
                new TableRow({ children: ["序号", "系统名称", "数量"].map(cell) }),
                new TableRow({ children: ["1", "电子病历系统", "1"].map(cell) }),
                new TableRow({ children: ["2", "集成平台", "1"].map(cell) }),
              ],
            }),
          ],
        },
      ],
    })
    const buf = await Packer.toBuffer(doc)
    const tables = extractDocxTables(new Uint8Array(buf)).map((t) => t.rows)
    const preview = buildRequirementPreview({ text: "建设目标为五级四甲。", tables, fileName: "sample.docx" })
    expect(preview.rating.combos.map((c) => c.key)).toContain("l5-4a")
    expect(preview.items.map((i) => i.raw)).toEqual(expect.arrayContaining(["电子病历系统", "集成平台"]))
  })
})

describe("bidRequirementLinesFromReport：功能需求/建设内容抽行", () => {
  it("从 delivery_req / project_info 抽出条目，并识别评级", () => {
    const { items, context, rating } = bidRequirementLinesFromReport({
      sections: [
        { key: "purchase_list", title: "采购清单", content: "这节应由采购清单通道处理，不在本函数" },
        {
          key: "delivery_req",
          title: "功能需求 / 建设内容",
          content: "建设目标五级四甲。\n（1）建设全院统一的患者主索引。\n（2）门诊排队叫号与挂号收费联动。",
        },
        { key: "project_info", title: "项目概况", content: "建设内容概况：部署集成平台。" },
      ],
    })
    expect(context).toContain("患者主索引")
    expect(items.some((i) => i.raw.includes("患者主索引"))).toBe(true)
    expect(items.some((i) => i.raw.includes("门诊排队叫号"))).toBe(true)
    expect(rating.combos.map((c) => c.key)).toContain("l5-4a")
    expect(items.some((i) => i.raw.includes("采购清单通道"))).toBe(false)
  })

  it("空报告返回空条目，不抛错", () => {
    expect(bidRequirementLinesFromReport(null).items).toEqual([])
    expect(bidRequirementLinesFromReport({ sections: [] }).items).toEqual([])
  })
})
