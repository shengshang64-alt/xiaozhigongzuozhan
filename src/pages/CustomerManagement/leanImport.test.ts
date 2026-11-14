import { describe, expect, it } from "vitest"
import {
  LEAN_IMPORT_COLUMNS,
  leanImportCounts,
  leanImportTemplateCsv,
  parseCsv,
  parseFollowDate,
  parseLeanImportCsv,
  parseOppStage,
  previewLeanImport,
} from "./leanImport"

describe("parseOppStage / parseFollowDate", () => {
  it("中文阶段和英文 key 都能识别，无法识别则留空", () => {
    expect(parseOppStage("需求确认")).toBe("needs")
    expect(parseOppStage("投标")).toBe("bidding")
    expect(parseOppStage("lead")).toBe("lead")
    expect(parseOppStage("未知阶段")).toBe("")
    expect(parseOppStage("")).toBe("")
  })

  it("只接受合法日期", () => {
    expect(parseFollowDate("2026-10-01")).toBe("2026-10-01")
    expect(parseFollowDate("2026/10/1")).toBe("2026-10-01")
    expect(parseFollowDate("明天")).toBe("")
    expect(parseFollowDate("2026-13-40")).toBe("")
  })
})

describe("parseLeanImportCsv", () => {
  it("模板可解析，示例行进入预览", () => {
    const csv = leanImportTemplateCsv()
    expect(csv.startsWith("\uFEFF")).toBe(true)
    for (const col of LEAN_IMPORT_COLUMNS) expect(csv).toContain(col)
    const parsed = parseLeanImportCsv(csv)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].hospitalName).toBe("测试医院-t135")
    expect(parsed.rows[0].contactName).toBe("张三")
    expect(parsed.rows[0].oppName).toBe("信息化升级")
    expect(parsed.rows[0].lastFollow).toBe("2026-10-01")
  })

  it("支持带引号和逗号的单元格", () => {
    const text = `${LEAN_IMPORT_COLUMNS.join(",")}\n"测试医院-t135","李四","院长","","","投标","","","已沟通，下一步出方案"\n`
    const parsed = parseLeanImportCsv(text)
    expect(parsed.rows[0].note).toBe("已沟通，下一步出方案")
  })

  it("缺表头时报错，不硬解析", () => {
    const parsed = parseLeanImportCsv("医院,电话\n甲,1\n")
    expect(parsed.rows).toEqual([])
    expect(parsed.errors[0]).toContain("表头必须包含")
  })
})

describe("parseCsv", () => {
  it("跳过空行，处理 BOM", () => {
    expect(parseCsv("\uFEFFA,B\n\n1,2\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ])
  })
})

describe("previewLeanImport", () => {
  const customers = [
    {
      id: "c1",
      hospital_name: "测试医院-t135",
      contacts: [{ name: "张三", title: "信息科主任", phone: "13800000000" }],
      last_follow_at: "2026-09-01",
    },
  ]

  it("无档案时进入新建客户，同标准名多行合并", () => {
    const parsed = parseLeanImportCsv(
      `${LEAN_IMPORT_COLUMNS.join(",")}\n测试医院-甲,王五,科长,13900000000,系统升级,线索,2026-10-01,2026-11-01,初次拜访\n测试医院-甲,赵六,工程师,13700000000,,,,,,\n`,
    )
    const preview = previewLeanImport(parsed.rows, [])
    expect(leanImportCounts(preview).create).toBe(1)
    expect(preview.create[0].contactsToAdd).toHaveLength(2)
    expect(preview.create[0].oppsToAdd[0]).toEqual({ oppName: "系统升级", stage: "lead" })
    expect(preview.create[0].followsToAdd).toHaveLength(1)
  })

  it("已有客户只追加新联系人/跟进/商机，不因公开字段缺失而去改等级官网", () => {
    const parsed = parseLeanImportCsv(
      `${LEAN_IMPORT_COLUMNS.join(",")}\n测试医院-t135,张三,信息科主任,13800000000,,,,,\n测试医院-t135,钱七,副院长,13600000000,二期改造,方案阶段,2026-10-12,2026-12-01,补充联系人\n`,
    )
    const preview = previewLeanImport(parsed.rows, customers, [{ id: "o1", customer_id: "c1", opp_name: "信息化升级" }])
    expect(leanImportCounts(preview).update).toBe(1)
    expect(preview.update[0].contactsToAdd).toEqual([{ name: "钱七", title: "副院长", phone: "13600000000" }])
    expect(preview.update[0].oppsToAdd).toEqual([{ oppName: "二期改造", stage: "solution" }])
    expect(preview.update[0].lastFollowAt).toBe("2026-10-12")
  })

  it("联系人、商机、跟进都已存在则重复跳过", () => {
    const parsed = parseLeanImportCsv(
      `${LEAN_IMPORT_COLUMNS.join(",")}\n测试医院-t135,张三,信息科主任,13800000000,信息化升级,需求确认,,,,\n`,
    )
    const preview = previewLeanImport(parsed.rows, customers, [{ id: "o1", customer_id: "c1", opp_name: "信息化升级" }])
    expect(leanImportCounts(preview).skip).toBe(1)
    expect(preview.skip[0].reason).toContain("已跳过")
  })

  it("仅模糊相近的已有客户进入待确认，不自动新建或合并", () => {
    const parsed = parseLeanImportCsv(
      `${LEAN_IMPORT_COLUMNS.join(",")}\n测试医院-t135人民医院,孙八,主任,13500000000,,,,,,\n`,
    )
    const preview = previewLeanImport(parsed.rows, customers)
    expect(leanImportCounts(preview).pending).toBe(1)
    expect(leanImportCounts(preview).create).toBe(0)
    expect(leanImportCounts(preview).update).toBe(0)
    expect(preview.pending[0].reason).toContain("需确认")
  })
})
