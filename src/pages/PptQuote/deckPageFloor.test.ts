// ---------------------------------------------------------------------------
// 页数补齐单测（2026-11-04）
//
// 缺陷：单发路径（≤10 页）一次调用生成整册。实测「要 10 页、模型只返回 4 页」时：
//   · 原判据 `got.length === 0` 只有一页都没有才算失败 → 不重试、不补页、不提示；
//   · 用户拿到 4 页册子，界面还显示过「正在生成 10 页内容…」。
// 这属于「静默交付半成品」，与本轮修的其它「假成功」同源。
//
// 本文件钉住三件事：
//  ① 补的页数正确、页型中性、带可执行提示（不编造业务数字）；
//  ② 占位页插在结尾页**之前**（不能排在「谢谢」后面，那是明显的叙事错误）；
//  ③ 异常入参不炸、不产生负页数。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { PLACEHOLDER_HINT, buildPlaceholderSlides, insertBeforeClosing } from "./deckPageFloor"
import type { Slide } from "./pptQuoteTypes"

function slide(title: string, kind?: Slide["kind"]): Slide {
  return { id: `id-${title}`, title, bullets: ["x"], notes: "", ...(kind ? { kind } : {}) } as Slide
}

describe("buildPlaceholderSlides · 补页", () => {
  it("补 N 页就返回 N 页，且每页 id 唯一", () => {
    const got = buildPlaceholderSlides(3)
    expect(got).toHaveLength(3)
    expect(new Set(got.map((s) => s.id)).size).toBe(3)
  })

  it("占位页给的是可执行提示，不是编造的业务内容", () => {
    const [p] = buildPlaceholderSlides(1)
    expect(p!.title).toContain("待补充")
    expect(p!.bullets).toEqual([PLACEHOLDER_HINT])
    // 描述里必须告诉用户「怎么办」，而不是留一个空页让人猜
    expect(PLACEHOLDER_HINT).toMatch(/AI 补全|手动/)
    // 不能出现具体业务数字/承诺（防把占位内容当已生成内容交付）
    expect(JSON.stringify(p)).not.toMatch(/万元|%|级评审通过/)
  })

  it("页型默认 bullets；layout 显式为 auto（不会被自动配图当成内容页烧钱）", () => {
    const [p] = buildPlaceholderSlides(1)
    expect(p!.kind).toBe("bullets")
    expect(p!.layout).toBe("auto")
  })

  it("可指定页型", () => {
    expect(buildPlaceholderSlides(1, "section")[0]!.kind).toBe("section")
  })

  it("0 / 负数 / NaN 都返回空数组，不产生负页数", () => {
    expect(buildPlaceholderSlides(0)).toEqual([])
    expect(buildPlaceholderSlides(-3)).toEqual([])
    expect(buildPlaceholderSlides(Number.NaN)).toEqual([])
  })
})

describe("insertBeforeClosing · 插在结尾页之前", () => {
  const placeholders = buildPlaceholderSlides(2)

  it("末页是「谢谢」（kind=summary）→ 占位页插在它前面", () => {
    const all = [slide("封面"), slide("正文一"), slide("谢谢", "summary")]
    const out = insertBeforeClosing(all, placeholders)
    expect(out.map((s) => s.title)).toEqual(["封面", "正文一", "待补充章节 1", "待补充章节 2", "谢谢"])
  })

  it("末页标题写着致谢/Q&A 但 kind 缺失 → 也认作结尾页", () => {
    const out = insertBeforeClosing([slide("封面"), slide("谢谢聆听")], placeholders)
    expect(out[out.length - 1]!.title).toBe("谢谢聆听")
    expect(out[1]!.title).toBe("待补充章节 1")
  })

  it("末页是普通正文 → 追加到末尾（不误判为结尾页）", () => {
    const out = insertBeforeClosing([slide("封面"), slide("正文结论")], placeholders)
    expect(out.map((s) => s.title)).toEqual(["封面", "正文结论", "待补充章节 1", "待补充章节 2"])
  })

  it("没有占位页时原样返回（不改变已有册子）", () => {
    const all = [slide("封面")]
    expect(insertBeforeClosing(all, [])).toEqual(all)
  })

  it("空册子 + 有占位页 → 直接返回占位页", () => {
    expect(insertBeforeClosing([], placeholders)).toHaveLength(2)
  })

  it("不就地修改入参数组", () => {
    const all = [slide("封面"), slide("谢谢", "summary")]
    const snapshot = all.map((s) => s.title)
    insertBeforeClosing(all, placeholders)
    expect(all.map((s) => s.title)).toEqual(snapshot)
  })
})
