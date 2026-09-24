import { describe, expect, it } from "vitest"
import { normalizeSlideFigures, sanitizeDeck } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// AI 图示（figures）契约回归：结构化归一 + 经 sanitizeDeck 落到 slide 上
// ---------------------------------------------------------------------------

describe("normalizeSlideFigures", () => {
  it("架构图：合法 layers 归一保留，非法项丢弃", () => {
    const out = normalizeSlideFigures([
      { type: "architecture", title: "总体架构", layers: [{ name: "应用层", modules: ["电子病历", "LIS"] }, { name: "", modules: [] }] },
      { type: "architecture", title: "", layers: [{ name: "x", modules: ["y"] }] }, // 缺 title 丢弃
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: "architecture", title: "总体架构" })
    expect(out[0].type === "architecture" && out[0].layers).toHaveLength(1)
  })

  it("流程图：steps 必填，branches 可选", () => {
    const out = normalizeSlideFigures([
      { type: "flow", title: "就诊流程", steps: [{ name: "挂号" }, { name: "分诊", desc: "自动" }], branches: ["急诊"] },
    ])
    expect(out[0]).toMatchObject({ type: "flow", title: "就诊流程" })
    if (out[0].type === "flow") {
      expect(out[0].steps).toHaveLength(2)
      expect(out[0].branches).toEqual(["急诊"])
    }
  })

  it("界面示意：sidebar/main 至少一个非空", () => {
    const withSide = normalizeSlideFigures([{ type: "demo", title: "工作台", sidebar: ["首页"] }])
    expect(withSide).toHaveLength(1)
    const empty = normalizeSlideFigures([{ type: "demo", title: "工作台" }])
    expect(empty).toHaveLength(0)
  })

  it("非数组 / 未知 type / 最多 2 个", () => {
    expect(normalizeSlideFigures(null)).toEqual([])
    expect(normalizeSlideFigures({})).toEqual([])
    expect(normalizeSlideFigures([{ type: "unknown", title: "x" }])).toEqual([])
    const three = normalizeSlideFigures([
      { type: "flow", title: "a", steps: [{ name: "1" }] },
      { type: "flow", title: "b", steps: [{ name: "2" }] },
      { type: "flow", title: "c", steps: [{ name: "3" }] },
    ])
    expect(three).toHaveLength(2)
  })
})

describe("sanitizeDeck 携带 figures", () => {
  it("字符串 slides 解析后保留合法图示", () => {
    const rec = sanitizeDeck({
      id: "d1",
      rh_user_id: "u1",
      deck_name: "t",
      deck_type: "general",
      audience: "",
      duration_min: 10,
      material_ref: "",
      doc_status: "done",
      created: "",
      updated: "",
      slides: JSON.parse(
        JSON.stringify([{ title: "架构页", bullets: ["a"], notes: "", figures: [{ type: "architecture", title: "总体架构", layers: [{ name: "应用层", modules: ["EMR"] }] }] }]),
      ),
    } as never)
    expect(rec.slides[0].figures).toHaveLength(1)
    expect(rec.slides[0].figures?.[0].type).toBe("architecture")
  })
})
