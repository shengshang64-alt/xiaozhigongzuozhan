import { describe, expect, it } from "vitest"
import type { ChecklistLine } from "./checklistTypes"
import { collectStandardChapters } from "./standardChapterCollect"
import type { ChapterSource } from "./standardChapters"

function line(name: string, module = ""): ChecklistLine {
  return {
    line_id: name,
    category: "",
    product_line: "",
    product_name: name,
    module_name: module,
    module_func: "",
    unit: "套",
    qty: 1,
    unit_price: 0,
    source: "company",
    rating_hits: [],
    remark: "",
    product_id: "",
    checked: true,
  }
}

describe("collectStandardChapters（注入检索，不打网络）", () => {
  it("按查询归并来源并标出缺项", async () => {
    const search = async (query: string): Promise<ChapterSource[]> => {
      if (query.includes("电子病历")) {
        return [
          { kind: "atom", id: "1", title: "EMR", docName: "合成规范", quote: "", body: "电子病历覆盖门急诊书写、质控与归档，并支持分级评价。" },
          { kind: "atom", id: "2", title: "EMR2", docName: "合成规范", quote: "", body: "门急诊病历与医生站联动，避免重复录入患者信息。" },
        ]
      }
      if (query.includes("集成平台")) {
        return [{ kind: "atom", id: "3", title: "ESB", docName: "合成规范", quote: "", body: "集成平台承担系统间数据交换。" }]
      }
      return []
    }
    const preview = await collectStandardChapters(
      [line("电子病历系统"), line("集成平台"), line("尚无素材的演示模块")],
      { search, title: "合成预览", typeKey: "standard" },
    )
    expect(preview.stats.ok).toBe(1)
    expect(preview.stats.thin).toBe(1)
    expect(preview.stats.missing).toBe(1)
    expect(preview.modules.find((m) => m.productName === "尚无素材的演示模块")?.gapReason).toMatch(/未编造/)
  })
})
