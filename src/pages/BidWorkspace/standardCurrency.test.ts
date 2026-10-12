// R274 编制依据「标准版本时效体检」场景自测
// 模拟三甲医院招标解析出的编制依据（含旧版标准号），验证：旧版命中/同版不误报/
// 无年份不报/库外不报/晚于现行不报/点分序号不误判/去重/提示语文案。
import { describe, expect, it } from "vitest"
import {
  buildCurrentVersionMap,
  detectStaleVersionRefs,
  scanStaleVersionInText,
  splitCodeYear,
  staleRefHint,
} from "./standardCurrency"
import type { StandardItem } from "./bidTypes"

const item = (code: string, name = "测试标准"): StandardItem => ({ code, name, category: "推荐性国家标准" })

describe("R274 标准版本时效体检 splitCodeYear", () => {
  it("拆出编号主干与尾随年份（含全角破折号、空格归一）", () => {
    expect(splitCodeYear("GB/T 22239-2019")).toEqual({ base: "GB/T22239", year: 2019 })
    expect(splitCodeYear("gb/t 22239—2019")).toEqual({ base: "GB/T22239", year: 2019 })
    expect(splitCodeYear("GB 50174-2017")).toEqual({ base: "GB50174", year: 2017 })
  })
  it("点分序号结尾不误判为年份；无年份条目 year=null", () => {
    expect(splitCodeYear("GB/T 25000.51-2016").year).toBe(2016)
    expect(splitCodeYear("GB/T 25000.51").year).toBeNull()
    expect(splitCodeYear("GB/T 22239")).toEqual({ base: "GB/T22239", year: null })
  })
})

describe("R274 detectStaleVersionRefs", () => {
  it("库内现行 2019，引用 2008 → 命中旧版并给出现行编号", () => {
    const hits = detectStaleVersionRefs([item("GB/T 22239-2008", "等级保护基本要求")])
    expect(hits).toHaveLength(1)
    expect(hits[0].citedYear).toBe(2008)
    expect(hits[0].currentCode).toBe("GB/T 22239-2019")
  })
  it("同版本不误报；无年份不报；库外编号不报；晚于现行不报", () => {
    expect(detectStaleVersionRefs([item("GB/T 22239-2019")])).toHaveLength(0)
    expect(detectStaleVersionRefs([item("GB/T 22239")])).toHaveLength(0)
    expect(detectStaleVersionRefs([item("DB33/T 987-2010")])).toHaveLength(0)
    // 引用晚于库内现行（库可能滞后）：反向判定会误伤 → 不报
    expect(detectStaleVersionRefs([item("GB/T 22239-2025")])).toHaveLength(0)
  })
  it("同一主干+年份重复条目去重；多条旧版各自命中", () => {
    const hits = detectStaleVersionRefs([
      item("GB/T 22239-2008"),
      item("GB/T 22239-2008", "别名"),
      item("GB/T 9385-1999", "需求规格说明规范"),
    ])
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.currentYear).sort()).toEqual([2008, 2019])
  })
  it("自定义规范库（注入 curated）：只比对所给库，不依赖全局", () => {
    const curated: StandardItem[] = [{ code: "XX/T 1-2020", name: "示例", category: "行业标准" }]
    expect(detectStaleVersionRefs([item("XX/T 1-2015")], curated)).toHaveLength(1)
    expect(detectStaleVersionRefs([item("GB/T 22239-2008")], curated)).toHaveLength(0)
  })
})

describe("R274 辅助", () => {
  it("buildCurrentVersionMap 取同主干最高年份", () => {
    const curated: StandardItem[] = [
      { code: "YY/T 1-2015", name: "旧", category: "行业标准" },
      { code: "YY/T 1-2021", name: "新", category: "行业标准" },
    ]
    const map = buildCurrentVersionMap(curated)
    expect(map.get("YY/T1")?.year).toBe(2021)
  })
  it("staleRefHint 输出人话、含引用年份与现行编号、无内部字段名", () => {
    const h = detectStaleVersionRefs([item("GB/T 22239-2008", "网络安全等级保护基本要求")])[0]
    const s = staleRefHint(h)
    expect(s).toContain("2008 版")
    expect(s).toContain("GB/T 22239-2019")
    expect(s).not.toContain("citedYear")
    expect(s).not.toContain("currentCode")
  })
})

describe("R275 scanStaleVersionInText（正文级旧版检测）", () => {
  it("在生成正文中检出旧版标准号并给出现行编号", () => {
    const text = "本项目遵循 GB/T 22239-2008《信息安全技术》进行安全设计。"
    const hits = scanStaleVersionInText(text)
    expect(hits).toHaveLength(1)
    expect(hits[0].citedYear).toBe(2008)
    expect(hits[0].currentCode).toBe("GB/T 22239-2019")
    expect(hits[0].item.code).toBe("GB/T 22239-2008")
  })
  it("同版本/无年份/库外/晚于现行不报", () => {
    expect(scanStaleVersionInText("符合 GB/T 22239-2019 要求")).toHaveLength(0)
    expect(scanStaleVersionInText("符合 GB/T 22239 要求")).toHaveLength(0)
    expect(scanStaleVersionInText("符合 DB33/T 987-2010 要求")).toHaveLength(0)
    expect(scanStaleVersionInText("符合 GB/T 22239-2025 要求")).toHaveLength(0)
  })
  it("多条命中各自独立检出；同一条去重", () => {
    const text = "按照 GB/T 22239-2008 和 WS 374-2012 执行，同时满足 GB/T 22239-2008 要求。"
    const hits = scanStaleVersionInText(text)
    // GB/T 22239-2008 去重报 1 次，WS 374-2012 可能在库内也命中
    const codes = hits.map((h) => h.item.code)
    expect(codes.filter((c) => c === "GB/T 22239-2008")).toHaveLength(1)
  })
  it("空文本返回空数组", () => {
    expect(scanStaleVersionInText("")).toHaveLength(0)
  })
  it("自定义 curated 不依赖全局库", () => {
    const curated: StandardItem[] = [{ code: "XX/T 1-2020", name: "示例", category: "行业标准" }]
    expect(scanStaleVersionInText("遵循 XX/T 1-2015 要求", curated)).toHaveLength(1)
    expect(scanStaleVersionInText("遵循 GB/T 22239-2008 要求", curated)).toHaveLength(0)
  })
  it("多行文本中跨行扫描正常", () => {
    const text = "第一章\n引用 GB 50174-2008 作为依据\n第二章\n引用 GB/T 22239-2008"
    const hits = scanStaleVersionInText(text)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.some((h) => h.item.code === "GB 50174-2008")).toBe(true)
  })
})
