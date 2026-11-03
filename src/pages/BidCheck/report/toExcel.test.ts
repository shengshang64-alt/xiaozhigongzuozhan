import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { buildExcelBlob } from "./toExcel"
import { summarize, type BidCheckResult, type CheckItem } from "../bidCheckTypes"

function item(over: Partial<CheckItem>): CheckItem {
  return {
    code: "L5-A1",
    level: "L5",
    category: "主体身份",
    title: "公司名称泄露",
    severity: "critical",
    status: "fail",
    basis: "A1 暗标出现公司名即废标",
    suggestion: "删除公司名",
    hits: [{ location: "第一章", text: "某某科技有限公司", rule: "company_word", basis: "" }],
    confidence: null,
    ...over,
  }
}

function result(items: CheckItem[]): BidCheckResult {
  return {
    mode: "sealed",
    sourceName: "投标文件",
    inputKind: "file",
    hasPackage: true,
    items,
    coverage: { expectedChapters: 0, checkedChapters: 1, complete: true, note: "按上传文件全文检查（1 章）" },
    summary: summarize(items),
    generatedAt: "2026-10-01 10:00",
    chapters: [],
    paragraphs: [],
    chapterOf: [],
  }
}

async function firstSheet(blob: Blob): Promise<unknown[][]> {
  const buf = await blob.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" })
  const ws = wb.Sheets["整改清单"]
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][]
}

describe("toExcel 整改清单", () => {
  it("一行一命中：表头 + 命中行；pass 项不入表", async () => {
    const items = [
      item({}),
      item({ code: "L1-1", level: "L1", title: "字体一致", status: "pass", hits: [] }),
    ]
    const rows = await firstSheet(buildExcelBlob(result(items)))
    expect(rows[0][0]).toBe("序号")
    // 仅一条 fail 命中 → 2 行（表头 + 1）
    expect(rows.length).toBe(2)
    expect(rows[1]).toContain("L5-A1")
    expect(rows[1]).toContain("某某科技有限公司")
  })

  it("零 AI 项置信度填「—」", async () => {
    const rows = await firstSheet(buildExcelBlob(result([item({})])))
    const header = rows[0] as string[]
    const confIdx = header.indexOf("置信度")
    expect(confIdx).toBeGreaterThanOrEqual(0)
    expect((rows[1] as string[])[confIdx]).toBe("—")
  })

  it("unconfigured 项入表且状态为「标准未配置」", async () => {
    const rows = await firstSheet(
      buildExcelBlob(result([item({ code: "L5-C9", title: "页数超限", status: "unconfigured", hits: [] })])),
    )
    expect(rows.length).toBe(2)
    expect((rows[1] as string[]).includes("标准未配置")).toBe(true)
  })

  it("整改清单按严重度优先排（critical→high→medium），废标级排最前（R264）", async () => {
    const items = [
      item({ code: "L1-3", level: "L1", severity: "medium", title: "行距不齐" }),
      item({ code: "L5-A1", level: "L5", severity: "critical", title: "公司名泄露" }),
      item({ code: "L1-1", level: "L1", severity: "high", title: "字体混用" }),
    ]
    const rows = await firstSheet(buildExcelBlob(result(items)))
    expect(rows.length).toBe(4)
    expect((rows[1] as string[]).includes("L5-A1")).toBe(true)
    expect((rows[2] as string[]).includes("L1-1")).toBe(true)
    expect((rows[3] as string[]).includes("L1-3")).toBe(true)
  })

  it("正文命中位置用解析锚点（章节 / 小节 / 第N段）精确呈现（R264）", async () => {
    const items = [
      item({
        hits: [
          {
            location: "正文",
            text: "某某科技有限公司",
            rule: "company_word",
            basis: "",
            paragraphIndex: 7,
            chapterTitle: "第三章 实施方案",
            sectionHint: "3.1 实施组织",
            lineNo: 42,
          },
        ],
      }),
    ]
    const rows = await firstSheet(buildExcelBlob(result(items)))
    const header = rows[0] as string[]
    const locIdx = header.indexOf("位置")
    expect((rows[1] as string[])[locIdx]).toBe("第三章 实施方案 / 3.1 实施组织 / 第 42 段")
  })
})
