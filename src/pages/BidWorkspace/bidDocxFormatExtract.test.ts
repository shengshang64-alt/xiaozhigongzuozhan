import { describe, expect, it } from "vitest"
import { detectPaper, extractedToFields, type ExtractedFormat } from "./bidDocxFormatExtract"
import { PAPER_TWIPS } from "./bidFiles"
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "./bidTypes"

// R-042 底稿 docx 格式提取器：纸张识别 + docx 原值 → 本项目受限枚举的映射。
// 只测纯函数（DOMParser 那半边要真 docx，node 环境跑不了）。

function ext(partial: Partial<ExtractedFormat>): ExtractedFormat {
  return { evidence: {}, ...partial }
}

describe("R-042 docx 纸张识别", () => {
  it("与导出侧 PAPER_TWIPS 同口径：A4/A3/16K 都能认出来", () => {
    for (const paper of ["A4", "A3", "16K"] as const) {
      expect(detectPaper(PAPER_TWIPS[paper].width, PAPER_TWIPS[paper].height)).toBe(paper)
    }
  })

  it("容差 200 twips：各 Word 版本取整差异仍可识别", () => {
    expect(detectPaper(11906 + 150, 16838 - 150)).toBe("A4")
    expect(detectPaper(10489 - 199, 14740)).toBe("16K")
  })

  it("表外纸张（Letter）、零尺寸、异常值一律不产出", () => {
    expect(detectPaper(12240, 15840)).toBeNull() // Letter：本项目不支持，不能硬套成 A4
    expect(detectPaper(0, 0)).toBeNull()
    expect(detectPaper(Number.NaN, Number.NaN)).toBeNull()
    expect(detectPaper(11906, 99999)).toBeNull() // 宽度像 A4、高度不符
  })
})

describe("R-042 docx 原值 → 受限枚举映射", () => {
  it("纸张字段直接落地为 FormatPaper", () => {
    const f = extractedToFields(ext({ paper: "16K", evidence: { paper: "pgSz" } }))[0]
    const patch: Partial<FormatSettings> = {}
    f.apply(patch)
    expect(patch.paper).toBe("16K")
  })

  it("正文字体表外值（等线）退回缺省，并在预览里标出落地值", () => {
    const f = extractedToFields(ext({ bodyFont: "等线" }))[0]
    expect(f.key).toBe("bodyFont")
    expect(f.value).toBe(`等线 → ${DEFAULT_FORMAT_SETTINGS.body.font}`)
    const patch: Partial<FormatSettings> = {}
    f.apply(patch)
    expect(patch.body!.font).toBe(DEFAULT_FORMAT_SETTINGS.body.font)
  })

  it("正文字体表内值（仿宋）原样落地，且不动其它正文项", () => {
    const f = extractedToFields(ext({ bodyFont: "仿宋" }))[0]
    expect(f.value).toBe("仿宋")
    const patch: Partial<FormatSettings> = {}
    f.apply(patch)
    expect(patch.body!.font).toBe("仿宋")
    expect(patch.body!.size).toBe(DEFAULT_FORMAT_SETTINGS.body.size)
    expect(patch.body!.lineSpacing).toBe(DEFAULT_FORMAT_SETTINGS.body.lineSpacing)
  })

  it("字号走中文字号映射，行距原样带入", () => {
    const fields = extractedToFields(ext({ bodySize: "小四", bodyLineSpacing: "1.5倍" }))
    expect(fields.map((x) => x.key)).toEqual(["bodySize", "bodyLineSpacing"])
    const patch: Partial<FormatSettings> = {}
    for (const f of fields) f.apply(patch)
    expect(patch.body!.size).toBe("小四")
    expect(patch.body!.lineSpacing).toBe("1.5倍")
  })

  it("标题格式：表外字体映射到缺省、缺省补齐六级、其余级不受影响", () => {
    const f = extractedToFields(ext({ heading1: { font: "等线", size: "三号", align: "center" } }))[0]
    expect(f.key).toBe("heading1")
    expect(f.value).toContain("字体 等线 → 黑体")
    const patch: Partial<FormatSettings> = {}
    f.apply(patch)
    expect(patch.heading!.length).toBe(6)
    expect(patch.heading![0]).toEqual({ font: "黑体", size: "三号", align: "center" })
    expect(patch.heading![5]).toEqual(DEFAULT_FORMAT_SETTINGS.heading[5])
  })

  it("非法对齐（distribute）退回缺省对齐，不写脏值", () => {
    const f = extractedToFields(ext({ heading2: { align: "distribute" } }))[0]
    const patch: Partial<FormatSettings> = {}
    f.apply(patch)
    expect(patch.heading![1]).toEqual(DEFAULT_FORMAT_SETTINGS.heading[1])
  })

  it("未提取到任何项时返回空清单（UI 显示：未提取到格式）", () => {
    expect(extractedToFields(ext({}))).toHaveLength(0)
  })
})
