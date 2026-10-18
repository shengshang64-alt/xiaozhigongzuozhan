// REQ-027 单测：截图标注合规检查（F-04）
// 断言对象是行为：该报的报、不该报的不报，且人工核对项如实列出。
import { describe, it, expect } from "vitest"
import {
  checkFigureAnnotations,
  isScreenshotExpectedChapter,
} from "./figureAnnotation"

const fig = (title: string, caption: string) => ({ title, caption })

describe("REQ-027 截图标注合规（F-04）", () => {
  it("全部合规 → 0 问题、计入 annotatedCount", () => {
    const content = [
      "3.1 门诊挂号功能",
      "【招标要求】支持门诊窗口挂号、自助机挂号与预约挂号三种方式。",
      "【投标响应】本项目提供三种挂号方式，已在 3 家三甲医院上线运行。",
      "【图：门诊挂号界面】",
    ].join("\n")
    const r = checkFigureAnnotations(content, [fig("门诊挂号界面", "展示门诊挂号的三种入口")])
    expect(r.figureCount).toBe(1)
    expect(r.annotatedCount).toBe(1)
    expect(r.issues).toEqual([])
    expect(r.summary).toContain("全部合规")
    expect(r.warnCount).toBe(0)
    expect(r.advisoryCount).toBe(0)
  })

  it("★ 严重度分级：缺标注是 advisory（真实标书 804 张图仅 1 张写了，不判错）", () => {
    const content = ["3.1 门诊挂号功能", "正文说明。", "【图：门诊挂号界面】"].join("\n")
    const r = checkFigureAnnotations(content, [fig("门诊挂号界面", "展示挂号入口")])
    expect(r.issues.every((i) => i.severity === "advisory")).toBe(true)
    expect(r.warnCount).toBe(0)
    expect(r.advisoryCount).toBe(2)
    expect(r.summary).toContain("建议补")
    expect(r.summary).toContain("非缺陷")
  })

  it("★ 缺图注是 warn（图注是导出依赖，真实标书普遍都有）", () => {
    const content = [
      "【招标要求】甲",
      "【投标响应】乙",
      "【图：界面】",
    ].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", "")])
    expect(r.issues[0].severity).toBe("warn")
    expect(r.warnCount).toBe(1)
    expect(r.summary).toContain("需处理")
  })

  it("缺【招标要求】→ 报 missing_tender_req（且不误报 missing_bid_resp）", () => {
    const content = [
      "3.1 门诊挂号功能",
      "【投标响应】本项目提供三种挂号方式。",
      "【图：门诊挂号界面】",
    ].join("\n")
    const r = checkFigureAnnotations(content, [fig("门诊挂号界面", "展示挂号入口")])
    expect(r.issues.map((i) => i.kind)).toEqual(["missing_tender_req"])
    expect(r.issues[0].figureTitle).toBe("门诊挂号界面")
    expect(r.issues[0].line).toBe(3)
  })

  it("缺【投标响应】→ 报 missing_bid_resp", () => {
    const content = [
      "【招标要求】支持三种挂号方式。",
      "【图：门诊挂号界面】",
    ].join("\n")
    const r = checkFigureAnnotations(content, [fig("门诊挂号界面", "展示挂号入口")])
    expect(r.issues.map((i) => i.kind)).toEqual(["missing_bid_resp"])
  })

  it("标注写法不用死：【招标要求：】方括号、编号前缀、无括号都认", () => {
    const variants = [
      ["【招标要求】甲", "【投标响应】乙"],
      ["[招标要求] 甲", "[投标响应] 乙"],
      ["招标要求：甲", "投标响应：乙"],
      ["（一）招标要求 甲", "（二）投标响应 乙"],
      ["1. 招标要求 甲", "2. 投标响应 乙"],
    ]
    for (const [a, b] of variants) {
      const content = [a, b, "【图：界面】"].join("\n")
      const r = checkFigureAnnotations(content, [fig("界面", "图注")])
      expect(r.issues, `写法未被识别：${a} / ${b}`).toEqual([])
    }
  })

  it("标注离图太远（超 8 行）→ 不算带齐，避免把上一张图的标注算到这一张", () => {
    const filler = Array.from({ length: 10 }, (_, i) => `正文第 ${i + 1} 行说明。`)
    const content = ["【招标要求】甲", "【投标响应】乙", ...filler, "【图：界面】"].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", "图注")])
    expect(r.issues.map((i) => i.kind).sort()).toEqual(["missing_bid_resp", "missing_tender_req"])
  })

  it("图注缺失 → 报 missing_caption", () => {
    const content = ["【招标要求】甲", "【投标响应】乙", "【图：界面】"].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", "")])
    expect(r.issues.map((i) => i.kind)).toEqual(["missing_caption"])
    expect(r.issues[0].message).toContain("这张图要表达什么")
  })

  it("图注超 60 字 → 报 caption_too_long（导出会截断）", () => {
    const long = "很".repeat(61)
    const content = ["【招标要求】甲", "【投标响应】乙", "【图：界面】"].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", long)])
    expect(r.issues.map((i) => i.kind)).toEqual(["caption_too_long"])
  })

  it("没有图的章 → 0 图 0 问题 0 汇总（不制造噪声）", () => {
    const r = checkFigureAnnotations("普通正文，没有图。", [])
    expect(r.figureCount).toBe(0)
    expect(r.issues).toEqual([])
    expect(r.summary).toBe("")
    expect(r.manualChecks).toEqual([])
  })

  it("人工核对项如实列出三条（不假装能机器判定）", () => {
    const content = ["【招标要求】甲", "【投标响应】乙", "【图：界面】"].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", "图注")])
    expect(r.manualChecks).toHaveLength(3)
    expect(r.manualChecks.join(" ")).toContain("一个功能点一张截图")
  })

  it("普通正文里的「招标要求」字样不会被误当成标注（只在图前窗口内判定）", () => {
    const content = [
      "本节所述招标要求均为原文摘录，具体如下。",
      "【图：界面】",
    ].join("\n")
    const r = checkFigureAnnotations(content, [fig("界面", "图注")])
    // 该行含「招标要求」但无标记形态，不应被算作已标注
    expect(r.annotatedCount).toBe(0)
  })

  it("isScreenshotExpectedChapter：功能/参数/界面类章应配截图", () => {
    expect(isScreenshotExpectedChapter("技术参数响应")).toBe(true)
    expect(isScreenshotExpectedChapter("系统功能方案")).toBe(true)
    expect(isScreenshotExpectedChapter("售后服务方案")).toBe(false)
  })
})
