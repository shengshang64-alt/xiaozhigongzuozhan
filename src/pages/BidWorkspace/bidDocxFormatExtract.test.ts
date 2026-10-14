import { describe, expect, it } from "vitest"
import {
  detectPaper,
  extractRequirementLines,
  extractedToFields,
  headingLevelOfStyle,
  type ExtractedFormat,
} from "./bidDocxFormatExtract"
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
// ---------------------------------------------------------------------------
// R47（B20）：模板识别扩到 1-6 级标题 + 表格/页眉页脚/页码/目录/编号 + 要求行抽取。
// 「格式更新真能用吗」的根因：旧实现只认 Heading1-3，商务模板的第 4-6 级标题被整段丢弃，
// 导出时那几级退回缺省黑体三号；下面第一组用例钉住修复后的三路识别与四级以上字段产出。
// ---------------------------------------------------------------------------
describe("R47 标题层级识别（Heading1-6）", () => {
  // node 环境没有 DOMParser（本用例不引 jsdom）：用最小假元素覆盖 q()/attr() 实际用到的接口
  function fakePr(outline: string | undefined): Element {
    const level = outline === undefined ? null : outline
    const outlineEl = {
      localName: "outlineLvl",
      children: [] as unknown[],
      getAttributeNS: (_ns: string, n: string) => (n === "val" ? level : null),
      getAttribute: (n: string) => (n === "val" ? level : null),
    }
    return {
      localName: "pPr",
      children: outline === undefined ? [] : [outlineEl],
      getAttributeNS: () => null,
      getAttribute: () => null,
    } as unknown as Element
  }

  it("styleId / 中文样式名 / 英文样式名三路都能认出级别", () => {
    expect(headingLevelOfStyle("Heading1", "heading 1", null)).toBe(1)
    expect(headingLevelOfStyle("heading 4", "heading 4", null)).toBe(4)
    expect(headingLevelOfStyle("标题 6", "标题 6", null)).toBe(6)
    expect(headingLevelOfStyle("标题5", "", null)).toBe(5)
    // CN Word 的 styleId 常是裸数字 "1"，级别只能从样式名读
    expect(headingLevelOfStyle("1", "heading 2", null)).toBe(2)
  })

  it("无样式名可读时退回 pPr/outlineLvl（0-5 → 1-6 级）", () => {
    expect(headingLevelOfStyle("", "", fakePr("0"))).toBe(1)
    expect(headingLevelOfStyle("", "", fakePr("5"))).toBe(6)
    expect(headingLevelOfStyle("", "", fakePr("9"))).toBe(0)
  })

  it("正文 / 自定义样式 / 7 级以上一律不误判", () => {
    expect(headingLevelOfStyle("Normal", "正文", null)).toBe(0)
    expect(headingLevelOfStyle("Heading7", "heading 7", null)).toBe(0)
    expect(headingLevelOfStyle("", "", null)).toBe(0)
  })
})

describe("R47 4-6 级标题与版面项进格式同步清单", () => {
  it("4 级标题产出可勾选项并写好 heading 数组第 4 位（旧实现整段丢弃）", () => {
    const f = extractedToFields(ext({ heading4: { font: "宋体", size: "小四", align: "left" } })).find((x) => x.key === "heading4")
    expect(f).toBeTruthy()
    const patch: Partial<FormatSettings> = {}
    f?.apply(patch)
    expect(patch.heading?.length).toBe(6)
    expect(patch.heading?.[3]).toEqual({ font: "宋体", size: "小四", align: "left" })
    expect(patch.heading?.[5]).toEqual(DEFAULT_FORMAT_SETTINGS.heading[5])
  })

  it("表格 / 页眉页脚 / 页码 / 目录 / 编号各产出一项并落地", () => {
    const fields = extractedToFields(
      ext({
        table: { border: "1pt", contentFont: "宋体五号" },
        header: "某某医院投标文件",
        footer: "",
        pageNumber: true,
        toc: true,
        titleNumbering: "chapter",
      }),
    )
    expect(fields.map((x) => x.key)).toEqual(["table", "headerFooter", "pageNumber", "toc", "titleNumbering"])
    const patch: Partial<FormatSettings> = {}
    for (const f of fields) f.apply(patch)
    expect(patch.table).toEqual({ border: "1pt", contentFont: "宋体五号" })
    expect(patch.headerFooter).toBe(true)
    expect(patch.pageNumber).toBe(true)
    expect(patch.toc).toBe(true)
    expect(patch.titleNumbering).toBe("chapter")
  })

  it("页眉页脚没有页码域时按模板设为不输出页码（不替用户臆造页码）", () => {
    const patch: Partial<FormatSettings> = {}
    for (const f of extractedToFields(ext({ header: "投标文件", pageNumber: false }))) f.apply(patch)
    expect(patch.headerFooter).toBe(true)
    expect(patch.pageNumber).toBe(false)
  })

  it("没有表格 / 页眉页脚时不产出这些项（不写脏值）", () => {
    expect(extractedToFields(ext({})).map((x) => x.key)).toEqual([])
  })
})

describe("R47 模板要求行抽取（本地规则，零 AI）", () => {
  it("命中「须包含 / 应列明 / 格式要求」口径，排除目录点线行、短行与超长段", () => {
    const long = "投标文件须包含" + "甲".repeat(220)
    const lines = [
      "投标文件须包含近三年类似项目业绩表",
      "技术方案应列明系统架构与部署方式",
      "投标文件须包含目录..................",
      "本项目采用公开招标方式。",
      "短",
      long,
      "投标文件须包含近三年类似项目业绩表",
    ]
    expect(extractRequirementLines(lines)).toEqual([
      "投标文件须包含近三年类似项目业绩表",
      "技术方案应列明系统架构与部署方式",
    ])
  })

  it("模板没写要求时返回空数组（不臆造要求）", () => {
    expect(extractRequirementLines(["第一章 项目概述", "本项目建设内容包括以下子系统。"])).toEqual([])
  })
})