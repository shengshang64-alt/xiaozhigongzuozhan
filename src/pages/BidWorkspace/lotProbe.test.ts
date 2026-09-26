// R78 临时探针（真实文件验证，不入库）：池州多标包招标文件 × extractLotsFromText
import { describe, it } from "vitest"
import fs from "fs"
import { extractLotsFromText } from "./bidTypes"

describe("R78 真实多标包招标探针（临时）", () => {
  it("池州招标文件标包抽取", () => {
    const text = fs.readFileSync(".diag/r78_chizhou_main_utf8.txt", "utf8")
    const lots = extractLotsFromText(text)
    const report = ["抽到包数: " + lots.length, ...lots.map((l, i) => `${i + 1}. ${l}`)].join("\n")
    fs.writeFileSync(".diag/r78_lots_after.txt", report, "utf8")
    console.log(report.slice(0, 900))
  })
})
