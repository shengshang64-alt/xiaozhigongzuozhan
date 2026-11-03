import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { oneLinkRowsToProductPayloads, parseOneLinkWorkbook } from "./oneLinkImport"

// ---------------------------------------------------------------------------
// ONE-LINK《智慧医院报价（按公司规范）》解析回归：
// 三行表头 + 合并单元格向下填充 + 计费档位 + 评级勾选并集
// ---------------------------------------------------------------------------

/** 按标准表版式造一张最小工作表：数据行的产品归属/类别/产品名称留空，模拟合并单元格 */
function buildWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  const grid = [
    ["产品归属", "产品类别", "产品名称", "模块分类", "模块名称", "标准名称", "门诊量≥13000", "门诊量≥8000", "门诊量≥4000", "门诊量≥1000", "门诊量<1000", "模块属性", "系数", "建议", "病历四级", "病历五级", "五级四甲", "著作权名称", "模块说明"],
    ["", "", "", "", "", "", "床位≥2000", "床位≥1500", "床位≥1000", "床位≥500", "床位<500", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "A类", "B类", "C类", "D类", "E类", "", "", "", "", "", "", "", ""],
    ["总部", "智慧医疗", "ONE-LINK-HIS", "门诊预交金", "即时结算改造", "即时结算改造", 80000, 60000, 40000, 20000, 10000, "系统建设", "门诊", "必选", "", "", "", "", ""],
    ["", "", "", "门诊管理", "门急诊挂号收费系统", "业务结算与收费-门急诊挂号收费", 120000, 100000, 80000, 50000, 30000, "系统建设", "门诊", "必选", "√", "√", "√", "智业医院信息系统", "0"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "智能随访系统", "随访管理", "随访任务管理", "随访任务管理", 30000, 24000, 18000, 12000, 6000, "系统建设", "住院", "可选", "0", "0", "0", "", ""],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "智慧医院报价（按公司规范）")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["按国家标准"]]), "智慧医院报价（按国家标准）")
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

describe("parseOneLinkWorkbook", () => {
  it("只取「按公司规范」表，合并单元格向下填充且跳过整空行", async () => {
    const { rows, summary } = await parseOneLinkWorkbook(buildWorkbookBuffer())
    expect(summary.sheet).toBe("智慧医院报价（按公司规范）")
    expect(summary.rowCount).toBe(3)
    // 第 2 行的产品归属/类别/产品名称来自上一行向下填充
    expect(rows[1].product_belong).toBe("总部")
    expect(rows[1].category).toBe("智慧医疗")
    expect(rows[1].product_name).toBe("ONE-LINK-HIS")
    expect(rows[1].product_line).toBe("ONE-LINK-HIS")
    expect(rows[1].module_category).toBe("门诊管理")
    expect(rows[1].module_name).toBe("门急诊挂号收费系统")
    expect(rows[1].standard_name).toBe("业务结算与收费-门急诊挂号收费")
    expect(rows[1].module_attr).toBe("系统建设")
    expect(rows[1].coefficient).toBe("门诊")
    expect(rows[1].recommendation).toBe("必选")
    // 第 3 行自带产品名称（非合并行）
    expect(rows[2].product_name).toBe("智能随访系统")
  })

  it("计费档位按三行表头组装：档位名 + 门诊量/床位口径 + 价格", async () => {
    const { rows } = await parseOneLinkWorkbook(buildWorkbookBuffer())
    expect(rows[1].price_tier).toHaveLength(5)
    expect(rows[1].price_tier[0]).toEqual({
      tier: "A类",
      outpatient: "门诊量≥13000",
      bed: "床位≥2000",
      price: 120000,
    })
    expect(rows[1].price_tier[4].tier).toBe("E类")
    expect(rows[1].price_tier[4].price).toBe(30000)
  })

  it("评级勾选列并集为 rating_tags，0 与空视为未勾选", async () => {
    const { rows } = await parseOneLinkWorkbook(buildWorkbookBuffer())
    expect(rows[1].rating_tags.emr).toEqual(["病历四级", "病历五级"])
    expect(rows[1].rating_tags.sm).toEqual(["五级四甲"])
    expect(rows[0].rating_tags).toEqual({})
    expect(rows[2].rating_tags).toEqual({})
  })

  it("著作权/模块说明落 remark，「0」占位不入备注", async () => {
    const { rows } = await parseOneLinkWorkbook(buildWorkbookBuffer())
    expect(rows[1].remark).toBe("智业医院信息系统")
    expect(rows[0].remark).toBe("")
  })

  it("模块名称为空但有标准名称时，以标准名称兜底为模块名", async () => {
    const wb = XLSX.utils.book_new()
    const grid = [
      ["产品名称", "模块分类", "模块名称", "标准名称", "模块属性"],
      ["互联网医院平台", "在线问诊", "", "在线问诊服务", "系统建设"],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "智慧医院报价（按公司规范）")
    const { rows } = await parseOneLinkWorkbook(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    )
    expect(rows[0].module_name).toBe("在线问诊服务")
    expect(rows[0].standard_name).toBe("在线问诊服务")
  })

  it("缺「按公司规范」表时报可读错误", async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["别的工作表"]]), "Sheet1")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    await expect(parseOneLinkWorkbook(buf)).rejects.toThrow(/按公司规范/)
  })

  it("缺产品名称列时报可读错误", async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["模块分类", "模块名称"], ["门诊管理", "挂号收费"]]),
      "智慧医院报价（按公司规范）",
    )
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    await expect(parseOneLinkWorkbook(buf)).rejects.toThrow(/产品名称/)
  })
})

describe("oneLinkRowsToProductPayloads", () => {
  it("写入口径：公司产品行 + 标准列齐备，单价留 0 由报价环节维护", async () => {
    const { rows } = await parseOneLinkWorkbook(buildWorkbookBuffer())
    const payloads = oneLinkRowsToProductPayloads(rows)
    expect(payloads).toHaveLength(3)
    const p = payloads[1]
    expect(p.is_builtin).toBe(false)
    expect(p.in_company).toBe(true)
    expect(p.charge_mode).toBe("模块授权")
    expect(p.status).toBe("在售")
    expect(p.unit_price).toBe(0)
    expect(p.module_func).toBe("业务结算与收费-门急诊挂号收费")
    expect(p.product_belong).toBe("总部")
    expect(p.module_category).toBe("门诊管理")
    expect(p.coefficient).toBe("门诊")
    expect(p.recommendation).toBe("必选")
    expect(p.price_tier?.[0].tier).toBe("A类")
    expect(p.rating_tags?.emr).toEqual(["病历四级", "病历五级"])
  })
})
