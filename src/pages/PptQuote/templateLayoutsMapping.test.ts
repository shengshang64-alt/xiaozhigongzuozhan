// ---------------------------------------------------------------------------
// 版式自动映射回归（2026-11-05，用真实公司模板暴露的两个缺陷）
//
// 缺陷一：`anyContent = contentLayouts[0] ?? withTitle[0] ?? ls[0]` 把**封面**当内容页版式。
//   很多模板的封面恰好是「标题+正文」双占位，contentLayouts[0] 就是它。
//   实测公司官方模板 zoe-light-internal（6 版式）：
//     封面(标题+正文) / 目录 / 章节过渡页(标题+正文) / 内页1(仅标题) / 2_仅标题 / 封底
//   → 8 个内容类 kind 全映射到「封面」，导出的册子每页都是大标题居中封面版式，
//     等于完全没套上公司模板（用户原话「套了模板还是像内置模板」的根因之一）。
//
// 缺陷二：结束页名称匹配漏了「封底」→ summary 落到封面版式。
//
// 本文件用**与该模板同构**的版式清单锁定正确映射，不依赖外部文件。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { recommendMapping, resolveMapping, type TemplateLayout, type TemplateOutline } from "./templateLayouts"
import { SLIDE_KINDS } from "./deckSchema"

/** 造一个与 zoe-light-internal 同构的版式清单（名称与占位符特征都照抄真实模板） */
function zoeLikeOutline(): TemplateOutline {
  const mk = (n: number, name: string, hasTitle: boolean, hasBody: boolean): TemplateLayout => ({
    path: `ppt/slideLayouts/slideLayout${n}.xml`,
    layoutId: `layout${n}`,
    name,
    masterPath: "ppt/slideMasters/slideMaster1.xml",
    placeholders: [
      ...(hasTitle ? [{ kind: "title" as const }] : []),
      ...(hasBody ? [{ kind: "body" as const }] : []),
    ] as TemplateLayout["placeholders"],
    hasTitle,
    hasBody,
  })
  return {
    layouts: [
      mk(1, "封面", true, true), // ← 封面带正文占位，正是缺陷一的触发点
      mk(2, "目录", true, false),
      mk(3, "章节过渡页", true, true),
      mk(4, "内页1", true, false),
      mk(5, "2_仅标题", true, false),
      mk(6, "封底", false, false),
    ],
    masterCount: 1,
    failure: null,
  }
}

const CONTENT_KINDS = SLIDE_KINDS.filter((k) => !["cover", "agenda", "section", "summary"].includes(k))

describe("版式自动映射 · 角色页不得抢走内容页版式", () => {
  const outline = zoeLikeOutline()
  const res = resolveMapping(outline, recommendMapping(outline))

  it("内容类 kind 全部映射到「内页1」，不是「封面」", () => {
    for (const k of CONTENT_KINDS) {
      const name = res.resolved[k]?.name ?? ""
      expect(name, `${k} 被映射到「${name}」，应为「内页1」`).toBe("内页1")
    }
  })

  it("封面→封面、目录→目录、章节→章节过渡页", () => {
    expect(res.resolved.cover?.name).toBe("封面")
    expect(res.resolved.agenda?.name).toBe("目录")
    expect(res.resolved.section?.name).toBe("章节过渡页")
  })

  it("summary → 封底（认「封底」这个名字）", () => {
    expect(res.resolved.summary?.name).toBe("封底")
  })

  it("没有任何 kind 落到缺失清单（模板 6 个版式足够覆盖）", () => {
    expect(res.missing).toEqual([])
  })
})

describe("版式自动映射 · 名称优先级", () => {
  it("有「内页/内容/正文」字样时优先用它（即使它只有标题占位）", () => {
    const outline: TemplateOutline = {
      layouts: [
        { path: "ppt/slideLayouts/slideLayout1.xml", layoutId: "layout1", name: "标题幻灯片", masterPath: "", placeholders: [{ kind: "title" }], hasTitle: true, hasBody: true },
        { path: "ppt/slideLayouts/slideLayout2.xml", layoutId: "layout2", name: "内容页", masterPath: "", placeholders: [{ kind: "title" }], hasTitle: true, hasBody: false },
      ] as TemplateOutline["layouts"],
      masterCount: 1,
      failure: null,
    }
    const res = resolveMapping(outline, recommendMapping(outline))
    expect(res.resolved.bullets?.name).toBe("内容页")
  })

  it("模板没有「内页」命名时，排除角色页后选第一个标题+正文版式", () => {
    const outline: TemplateOutline = {
      layouts: [
        { path: "ppt/slideLayouts/slideLayout1.xml", layoutId: "layout1", name: "封面", masterPath: "", placeholders: [{ kind: "title" }, { kind: "body" }], hasTitle: true, hasBody: true },
        { path: "ppt/slideLayouts/slideLayout2.xml", layoutId: "layout2", name: "正文页 A", masterPath: "", placeholders: [{ kind: "title" }, { kind: "body" }], hasTitle: true, hasBody: true },
      ] as TemplateOutline["layouts"],
      masterCount: 1,
      failure: null,
    }
    // 注意：名字含「正文」会命中 contentByName，这里改名为无关键词的「版式甲」才测得到 ② 分支
    outline.layouts[1].name = "版式甲"
    const res = resolveMapping(outline, recommendMapping(outline))
    expect(res.resolved.bullets?.name).toBe("版式甲")
  })

  it("只有角色页时仍能映射（最后兜底，不许整册无法映射）", () => {
    const outline: TemplateOutline = {
      layouts: [
        { path: "ppt/slideLayouts/slideLayout1.xml", layoutId: "layout1", name: "封面", masterPath: "", placeholders: [{ kind: "title" }], hasTitle: true, hasBody: false },
      ] as TemplateOutline["layouts"],
      masterCount: 1,
      failure: null,
    }
    const res = resolveMapping(outline, recommendMapping(outline))
    expect(res.missing).toEqual([])
    expect(res.resolved.bullets?.name).toBe("封面")
  })
})

describe("映射值必须与界面下拉选项同源（2026-11-05 修）", () => {
  // 缺陷：recommendMapping 曾把 `hit.path` 截成「slideLayout1」当映射值，
  // 而 DeckTemplateStep 的 <option value> 与 resolveMapping 都用 layoutId（「layout1」）。
  // 后果：所有页面类型在界面上显示「（未映射）」+ 黄色告警，但引擎其实已匹配好——
  // 用户以为模板没生效，实际导出会走保真通道，属于「界面与行为不一致」。
  it("recommendMapping 产出的是 layoutId（layoutN），不是文件名（slideLayoutN）", () => {
    const outline = zoeLikeOutline()
    const m = recommendMapping(outline)
    for (const [kind, val] of Object.entries(m)) {
      expect(val, `${kind} 的映射值是「${val}」，应为 layoutN`).toMatch(/^layout\d+$/)
    }
  })

  it("映射值能被 resolveMapping 解析回版式（界面才显示得出已匹配）", () => {
    const outline = zoeLikeOutline()
    const m = recommendMapping(outline)
    const res = resolveMapping(outline, m)
    expect(res.missing).toEqual([])
    for (const k of SLIDE_KINDS) expect(res.resolved[k], `${k} 解析失败`).not.toBeNull()
  })

  it("兼容存量数据：映射里存 slideLayoutN 写法仍能解析（老用户保存过的映射不失效）", () => {
    const outline = zoeLikeOutline()
    // 模拟旧版本存下来的映射（带 slideLayout 前缀）
    const legacy = { cover: "slideLayout1", bullets: "slideLayout4" }
    const res = resolveMapping(outline, legacy as never)
    expect(res.resolved.cover?.name).toBe("封面")
    expect(res.resolved.bullets?.name).toBe("内页1")
  })
})
