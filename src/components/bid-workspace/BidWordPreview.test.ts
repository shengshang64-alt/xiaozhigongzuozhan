// @r211 R-004 标书 Word 分页预览：纯逻辑助手单测（分类/编号/纸张）
import { describe, expect, it } from "vitest"
import { BidWordPreview } from "./BidWordPreview"
import { chapterNumber, classify, paperDims } from "./bidWordPreviewLogic"

describe("classify 行类型判定", () => {
  it("三级标题 1.1.1 → h3", () => {
    expect(classify("1.1.1 建设现状", [])).toBe("h3")
  })
  it("二级标题 1.1 → h2", () => {
    expect(classify("1.1 项目背景", [])).toBe("h2")
  })
  it("sections 命中小节 → h2", () => {
    expect(classify("项目概述与目标", ["项目概述"])).toBe("h2")
  })
  it("图/表题注 → caption", () => {
    expect(classify("图 3 系统拓扑", [])).toBe("caption")
    expect(classify("表2 报价一览", [])).toBe("caption")
  })
  it("普通正文 → p", () => {
    expect(classify("本项目旨在提升信息化水平。", [])).toBe("p")
  })
})

describe("chapterNumber 章级编号", () => {
  it("数字层级 1.1.1 → 「N 」", () => {
    expect(chapterNumber(0, "1.1.1")).toBe("1 ")
    expect(chapterNumber(2, "1.1.1")).toBe("3 ")
  })
  it("章—节式 → 第N章 ", () => {
    expect(chapterNumber(0, "chapter")).toBe("第1章 ")
  })
  it("无编号 → 空", () => {
    expect(chapterNumber(5, "none")).toBe("")
  })
})

describe("paperDims 纸张尺寸(cm)", () => {
  it("A4/A3/16K", () => {
    expect(paperDims("A4")).toEqual({ w: 21, h: 29.7 })
    expect(paperDims("A3")).toEqual({ w: 29.7, h: 42 })
    expect(paperDims("16K")).toEqual({ w: 18.5, h: 26 })
  })
})

describe("BidWordPreview 组件导出", () => {
  it("可被引用（函数组件）", () => {
    expect(typeof BidWordPreview).toBe("function")
  })
})
