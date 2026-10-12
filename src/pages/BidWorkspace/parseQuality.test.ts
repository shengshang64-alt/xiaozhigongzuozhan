// R-029（R255）招标文件解析质量评估 场景自测（零模型，纯函数判级）
import { describe, expect, it } from "vitest"
import { assessTenderParseQuality } from "./parseQuality"

describe("R-029 招标文件解析质量评估（R255）", () => {
  it("空/全空白文本 → suspect_scanned（含 OCR/粘贴指引）", () => {
    expect(assessTenderParseQuality("").level).toBe("suspect_scanned")
    expect(assessTenderParseQuality("   \n  \t ").level).toBe("suspect_scanned")
    expect(assessTenderParseQuality("").hint).toContain("OCR")
  })

  it("极短文本（< 30 字）→ suspect_scanned", () => {
    expect(assessTenderParseQuality("第1页 盖章").level).toBe("suspect_scanned")
  })

  it("大文件 + 极少文字（图片型 PDF）→ suspect_scanned（密度判据，优先于偏少）", () => {
    const a = assessTenderParseQuality("字".repeat(100), { bytes: 3_000_000 })
    expect(a.level).toBe("suspect_scanned")
    expect(a.reason).toContain("KB")
  })

  it("文字偏少（30~200 字，未给 bytes）→ low", () => {
    expect(assessTenderParseQuality("字".repeat(120)).level).toBe("low")
  })

  it("正常长文本 → ok", () => {
    expect(assessTenderParseQuality("字".repeat(300)).level).toBe("ok")
  })

  it("小体量粘贴文本不因密度误判 → ok", () => {
    expect(assessTenderParseQuality("字".repeat(250), { bytes: 2_000 }).level).toBe("ok")
  })
})
