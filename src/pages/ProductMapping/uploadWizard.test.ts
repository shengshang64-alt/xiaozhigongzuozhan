import { describe, expect, it } from "vitest"
import {
  extractCustomerTable,
  findWizardTemplate,
  gridWidth,
  guessHeaderRow,
  guessNameCols,
  headerLabels,
  loadWizardTemplates,
  saveWizardTemplate,
  templateFingerprint,
  type SheetGrid,
  type StorageLike,
} from "./uploadWizard"

// ---------------------------------------------------------------------------
// 上传向导解析器（2026-10-28 产品映射重构）：
// 任意业主表格 → 表头行/名称列猜测 → 条目抽取（原表整行保留）→ 模板记忆。
// ---------------------------------------------------------------------------

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

/** 典型业主清单：标题行 + 表头行 + 数据行（含空名称行与重复行） */
const GRID: SheetGrid = {
  name: "采购清单",
  rows: [
    ["XX人民医院智慧化建设采购清单"],
    ["序号", "业务分类", "系统名称", "数量", "单位", "备注"],
    ["1", "门诊", "门急诊挂号收费系统", "1", "套", ""],
    ["2", "门诊", "门诊医生工作站", "1", "套", "含排队叫号"],
    ["3", "门诊", "", "", "", ""],
    ["4", "住院", "门急诊挂号收费系统", "1", "套", ""],
    ["5", "住院", "住院结算管理系统", "1", "套", ""],
  ],
}

describe("guessHeaderRow / guessNameCols", () => {
  it("表头行猜中关键词最多的一行（跳过标题行）", () => {
    expect(guessHeaderRow(GRID.rows)).toBe(1)
  })

  it("名称列猜中「系统名称」，排除序号/数量/备注", () => {
    const w = gridWidth(GRID.rows)
    expect(guessNameCols(GRID.rows, 1, w)).toEqual([2])
  })

  it("表头无关键词时兜底取数据区平均最长的文本列", () => {
    const g: SheetGrid = {
      name: "s",
      rows: [
        ["a", "b"],
        ["1", "电子病历系统（含质控）"],
        ["2", "门急诊挂号收费"],
      ],
    }
    // 「b」列表头不像名称列 → 兜底按数据区长度选第 2 列
    expect(guessNameCols(g.rows, 0, 2)).toEqual([1])
  })
})

describe("extractCustomerTable：原表整行保留", () => {
  const parsed = extractCustomerTable(GRID, { sheetName: GRID.name, headerRow: 1, nameCols: [2] })

  it("表头标签对齐网格宽度", () => {
    expect(parsed.columns).toEqual(["序号", "业务分类", "系统名称", "数量", "单位", "备注"])
  })

  it("抽取 3 条：空名称行跳过、重复条目去重", () => {
    expect(parsed.items.map((x) => x.norm)).toEqual(["门急诊挂号收费系统", "门诊医生工作站", "住院结算管理系统"])
    expect(parsed.skippedEmpty).toBe(1)
  })

  it("每条带整行原表单元格（cells 与 columns 对齐）", () => {
    const row = parsed.items[1]
    expect(row.raw).toBe("门诊医生工作站")
    expect(row.cells).toEqual(["2", "门诊", "门诊医生工作站", "1", "套", "含排队叫号"])
  })

  it("名称列支持多列拼接", () => {
    const multi = extractCustomerTable(GRID, { sheetName: GRID.name, headerRow: 1, nameCols: [1, 2] })
    expect(multi.items[0].raw).toBe("门诊 门急诊挂号收费系统")
  })
})

describe("模板记忆（localStorage 口径，可注入存储）", () => {
  it("保存后按表头指纹命中；表头不同则不命中", () => {
    const store = memStore()
    const headers = headerLabels(GRID.rows, 1, gridWidth(GRID.rows))
    saveWizardTemplate({ sheetName: "采购清单", headerRow: 1, nameCols: [2], headers, savedAt: "2026-10-28T00:00:00Z" }, store)
    const hit = findWizardTemplate(headers, store)
    expect(hit).not.toBeNull()
    expect(hit?.headerRow).toBe(1)
    expect(hit?.nameCols).toEqual([2])
    expect(findWizardTemplate(["完全不同", "的表头"], store)).toBeNull()
  })

  it("指纹与大小写/空白无关；容量裁剪到 50 条", () => {
    const store = memStore()
    saveWizardTemplate({ sheetName: "s", headerRow: 0, nameCols: [0], headers: [" 序号 ", "系统名称"], savedAt: "2026-10-28T01:00:00Z" }, store)
    expect(templateFingerprint(["序号", "系统名称"])).toBe(templateFingerprint([" 序号 ", "系统名称"]))
    for (let i = 0; i < 60; i += 1) {
      saveWizardTemplate({ sheetName: "s", headerRow: 0, nameCols: [0], headers: [`h${i}`], savedAt: `2026-10-28T02:${String(i).padStart(2, "0")}:00Z` }, store)
    }
    expect(Object.keys(loadWizardTemplates(store)).length).toBeLessThanOrEqual(50)
  })
})
