// ---------------------------------------------------------------------------
// 四象限版式识别与要点分配单测（2026-11-05 v4）
//
// 这版来自**手工小样验证**：我把 4 条医院要点注入公司模板 slide12 的 8 个格子，
// 渲染出来版面整洁、无溢出、无留白（.scratch/render/png_proto/page03.png）。
// 对照：塞 slide5 会溢出重叠、塞 slide18 会挤在一个框里。
// 本文件用实测坐标锁住识别规则，防止以后改坏。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { detectQuadrantSlots, fitsQuadrant, splitQuadrantText, type ShapeInfo } from "./deckQuadrant"

const EMU = 914400 // 1 英寸

/** 按 slide12 实测坐标造形状（x/y/字号都照抄真实模板） */
function slide12Shapes(): ShapeInfo[] {
  const mk = (idx: number, _name: string, xIn: number, yIn: number, wIn: number, hIn: number, pt: number, text: string): ShapeInfo => ({
    idx,
    x: Math.round(xIn * EMU),
    y: Math.round(yIn * EMU),
    cx: Math.round(wIn * EMU),
    cy: Math.round(hIn * EMU),
    fontSize: pt,
    text,
  })
  return [
    mk(0, "胶囊", 0.76, 1.52, 2.08, 0.46, 14, "智慧监控系统"),
    mk(1, "大字", 0.64, 2.0, 6.03, 0.79, 40, "引领工业 4.0 新时代"),
    // 四象限：上行小标题 14pt / 下行说明 12pt
    mk(2, "标题1", 0.76, 3.08, 1.32, 0.41, 14, "实时监控"),
    mk(3, "说明1", 0.76, 3.43, 2.75, 0.53, 12, "系统全天候实时监控，自动捕捉异常行为。"),
    mk(4, "标题2", 3.8, 3.08, 1.32, 0.41, 14, "智能识别"),
    mk(5, "说明2", 3.8, 3.43, 2.75, 0.53, 12, "通过AI算法精准识别人脸、车牌等信息。"),
    mk(6, "标题3", 0.76, 4.4, 1.32, 0.41, 14, "自动报警"),
    mk(7, "说明3", 0.76, 4.75, 2.75, 0.53, 12, "检测到异常时自动触发报警并推送通知。"),
    mk(8, "标题4", 3.8, 4.4, 1.32, 0.41, 14, "数据分析"),
    mk(9, "说明4", 3.8, 4.75, 2.75, 0.53, 12, "对监控数据进行深度分析，生成可视化报告。"),
    // 底部 4 个标签
    mk(10, "标签1", 0.76, 6.51, 2.74, 0.55, 14, "24h全天候实时监控"),
    mk(11, "标签2", 3.78, 6.51, 2.74, 0.55, 14, "AI算法精准识别"),
    mk(12, "标签3", 6.82, 6.51, 2.74, 0.55, 14, "检测异常自动报警"),
    mk(13, "标签4", 9.84, 6.51, 2.74, 0.55, 14, "监控数据深度分析"),
  ]
}

describe("detectQuadrantSlots · 识别四象限结构", () => {
  it("slide12 实测结构能被识别，8 个槽位全部对上", () => {
    const s = detectQuadrantSlots(slide12Shapes())
    expect(s).not.toBeNull()
    expect(s!.headline).toBe(1)
    expect(s!.badge).toBe(0)
    // 四象限：左上/右上/左下/右下，每格 [标题, 说明]
    expect(s!.cells).toEqual([
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ])
    expect(s!.footerTags).toEqual([10, 11, 12, 13])
  })

  it("没有 32pt 以上大字 → 不是四象限（可能只是普通页）", () => {
    const shapes = slide12Shapes().map((s) => (s.fontSize >= 32 ? { ...s, fontSize: 24 } : s))
    expect(detectQuadrantSlots(shapes)).toBeNull()
  })

  it("只有 2 组卡片（一行）→ 认不出（本规则专为 2×2 设计）", () => {
    const shapes = slide12Shapes().filter((s) => s.idx <= 5 || s.idx >= 10)
    expect(detectQuadrantSlots(shapes)).toBeNull()
  })

  it("上行文字不比下行短（不是「标题+说明」结构）→ 不认", () => {
    // 把**整行**「小标题」都换成长文（判定按行平均值，只改一个不影响均值）
    const long = "这是一段非常长的小标题文字比说明还长很多很多字"
    const shapes = slide12Shapes().map((s) => ([2, 4, 6, 8].includes(s.idx) ? { ...s, text: long } : s))
    expect(detectQuadrantSlots(shapes)).toBeNull()
  })

  it("底部没有标签带 → 不认（避免把普通内容页误判成四象限）", () => {
    const shapes = slide12Shapes().filter((s) => s.idx < 10)
    expect(detectQuadrantSlots(shapes)).toBeNull()
  })

  it("小标题字号缺省（继承母版，解析为 0）时仍能识别", () => {
    // 实测模板里小标题的 sz 常缺省，按字号判"上大下小"会把唯一正确结构判掉
    const shapes = slide12Shapes().map((s) => ([2, 4, 6, 8].includes(s.idx) ? { ...s, fontSize: 0 } : s))
    const r = detectQuadrantSlots(shapes)
    expect(r).not.toBeNull()
    expect(r!.cells).toEqual([
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ])
  })

  it("空清单安全返回 null", () => {
    expect(detectQuadrantSlots([])).toBeNull()
  })
})

describe("splitQuadrantText · 一条要点拆成小标题+说明", () => {
  it("「小标题：说明」→ 拆开", () => {
    expect(splitQuadrantText("统一入口：自助机、公众号、医生工作站统一身份与入口")).toEqual({
      title: "统一入口",
      body: "自助机、公众号、医生工作站统一身份与入口",
    })
  })

  it("没有冒号 → 整条当说明，小标题留空（不硬造标题）", () => {
    expect(splitQuadrantText("系统割裂导致数据孤岛")).toEqual({ title: "", body: "系统割裂导致数据孤岛" })
  })

  it("冒号前过长（>12 字）→ 不当小标题", () => {
    const long = "这是一段超过十二个字的前置说明：后面是正文"
    expect(splitQuadrantText(long).title).toBe("")
  })

  it("空串安全", () => {
    expect(splitQuadrantText("")).toEqual({ title: "", body: "" })
  })
})

describe("fitsQuadrant · 什么时候该用四象限", () => {
  it("恰好 4 条且都能拆出小标题 → 适合", () => {
    expect(
      fitsQuadrant(["统一入口：自助机与公众号", "集成底座：ESB 平台统一鉴权", "数据治理：业务库与数据仓", "运营闭环：报表 T+1"]),
    ).toBe(true)
  })

  it("3 条 → 不适合（有格子会空）", () => {
    expect(fitsQuadrant(["甲：1", "乙：2", "丙：3"])).toBe(false)
  })

  it("5 条 → 不适合", () => {
    expect(fitsQuadrant(["甲：1", "乙：2", "丙：3", "丁：4", "戊：5"])).toBe(false)
  })

  it("4 条但有一条拆不出小标题 → 不适合（标题格会空，版面难看）", () => {
    expect(fitsQuadrant(["甲：1", "乙：2", "丙：3", "系统割裂导致数据孤岛"])).toBe(false)
  })

  it("空清单 → 不适合", () => {
    expect(fitsQuadrant([])).toBe(false)
  })
})
