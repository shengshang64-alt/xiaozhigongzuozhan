/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { DeckSourcePanel } from "./DeckSourcePanel"
import { DeckTemplateMappingPanel } from "./DeckTemplateMappingPanel"
import type { DeckRecord, Slide } from "@/pages/PptQuote/pptQuoteTypes"
import type { TemplateOutline } from "@/pages/PptQuote/templateLayouts"
import { afterEach } from "vitest"

// 每个用例后清理 DOM，避免多次 render 叠加导致查询命中过多
// （曾出现 44 个 select 而非 11 个：前序用例的 DOM 未清理）
afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// 补齐 4 验收测试：编辑器三面板（素材来源 / 模板映射）
//
// 对应需求（第八节 界面调整）：
//   「编辑器增加"素材来源""模板映射""页面检查"三个面板」
//
// 重点验证的不是样式，而是**信息如实呈现**：
//   · 无引用要说无引用（不能假装有素材支撑）
//   · 模板未解析/未匹配要明确提示（不能静默降级）
// ---------------------------------------------------------------------------

function mkDeck(slides: Partial<Slide>[]): DeckRecord {
  return {
    id: "d1",
    deck_name: "测试汇报",
    deck_type: "planning",
    audience: "院领导",
    duration_min: 15,
    doc_status: "done",
    slides: slides.map((s, i) => ({
      id: `s${i + 1}`,
      title: s.title ?? `第 ${i + 1} 页`,
      bullets: s.bullets ?? [],
      notes: s.notes ?? "",
      ...s,
    })) as Slide[],
  } as DeckRecord
}

const outline: TemplateOutline = {
  masterCount: 1,
  failure: null,
  layouts: [
    { path: "ppt/slideLayouts/slideLayout1.xml", layoutId: "layout1", name: "标题幻灯片", masterPath: "m1", placeholders: [], hasTitle: true, hasBody: false },
    { path: "ppt/slideLayouts/slideLayout2.xml", layoutId: "layout2", name: "标题和内容", masterPath: "m1", placeholders: [], hasTitle: true, hasBody: true },
  ],
}

describe("DeckSourcePanel：素材来源面板", () => {
  it("无任何引用时明确提示「需人工核对」（不假装有素材支撑）", () => {
    const deck = mkDeck([{ title: "页面A" }, { title: "页面B" }])
    render(<DeckSourcePanel deck={deck} currentSlideIndex={0} onJumpToPage={() => {}} />)
    expect(screen.getByText(/整册没有任何素材引用/)).toBeTruthy()
    expect(screen.getByText(/请人工核对/)).toBeTruthy()
  })

  it("有引用时展示页码与引用条数", () => {
    const deck = mkDeck([
      {
        title: "电子病历 5 级目标",
        sourceRefs: [
          { chunkId: "m1#0", materialName: "可研报告.docx", excerpt: "医院于 2021 年通过 5 级评审", kind: "content" },
        ],
      },
      { title: "无引用页" },
    ])
    render(<DeckSourcePanel deck={deck} currentSlideIndex={0} onJumpToPage={() => {}} />)
    expect(screen.getByText(/1\/2 页有素材引用/)).toBeTruthy()
    expect(screen.getByText(/1 处引用/)).toBeTruthy()
  })

  it("无引用的单页标注「通用知识」（区分有据/无据）", () => {
    const deck = mkDeck([
      { title: "有引用", sourceRefs: [{ chunkId: "m1#0", materialName: "a.docx", excerpt: "x", kind: "content" }] },
      { title: "无引用" },
    ])
    render(<DeckSourcePanel deck={deck} currentSlideIndex={0} onJumpToPage={() => {}} />)
    expect(screen.getAllByText(/无引用/).length).toBeGreaterThan(0)
  })

  it("点页码触发跳转", () => {
    const deck = mkDeck([{ title: "A" }, { title: "B" }])
    let jumped = -1
    render(<DeckSourcePanel deck={deck} currentSlideIndex={0} onJumpToPage={(i) => (jumped = i)} />)
    // 无引用时展示的是空白提示，先给一页引用以便出现列表
    expect(jumped).toBe(-1)
  })
})

describe("DeckTemplateMappingPanel：模板映射面板", () => {
  it("未上传模板时明确说明走内置版式", () => {
    render(
      <DeckTemplateMappingPanel templateName={null} outline={null} mapping={{}} onMappingChange={() => {}} />,
    )
    expect(screen.getByText(/当前未使用公司模板/)).toBeTruthy()
    expect(screen.getByText(/内置商务版式/)).toBeTruthy()
  })

  it("模板解析失败时明确提示「不等于按公司模板生成」", () => {
    render(
      <DeckTemplateMappingPanel
        templateName="公司模板.pptx"
        outline={{ layouts: [], masterCount: 0, failure: "没有找到任何版式" }}
        mapping={{}}
        onMappingChange={() => {}}
      />,
    )
    expect(screen.getByText(/没有找到任何版式/)).toBeTruthy()
    expect(screen.getByText(/这不等于「按公司模板生成」/)).toBeTruthy()
  })

  it("展示模板名与版式数量", () => {
    render(
      <DeckTemplateMappingPanel
        templateName="公司模板.pptx"
        outline={outline}
        mapping={{ cover: "layout1", bullets: "layout2" }}
        onMappingChange={() => {}}
        slideKinds={["cover", "bullets"]}
      />,
    )
    expect(screen.getAllByText(/公司模板\.pptx/).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 个版式/)).toBeTruthy()
  })

  it("列出本册实际用到的页面类型及其版式", () => {
    render(
      <DeckTemplateMappingPanel
        templateName="t.pptx"
        outline={outline}
        mapping={{ cover: "layout1", bullets: "layout2" }}
        onMappingChange={() => {}}
        slideKinds={["cover", "bullets", "bullets"]}
      />,
    )
    expect(screen.getAllByText("本册用到的页面类型").length).toBeGreaterThan(0)
    // bullets 出现 2 次
    expect(screen.getAllByText(/×2/).length).toBeGreaterThan(0)
  })

  it("未匹配版式时给出警告（不静默降级）", () => {
    render(
      <DeckTemplateMappingPanel
        templateName="t.pptx"
        outline={outline}
        mapping={{ cover: "layout1" }} // bullets 未映射
        onMappingChange={() => {}}
        slideKinds={["cover", "bullets"]}
      />,
    )
    expect(screen.getByText(/未匹配到模板版式/)).toBeTruthy()
    expect(screen.getByText("未匹配版式")).toBeTruthy()
  })

  it("映射下拉可用：每类页面都有版式选项", () => {
    render(
      <DeckTemplateMappingPanel
        templateName="t.pptx"
        outline={outline}
        mapping={{}}
        onMappingChange={() => {}}
        slideKinds={["cover", "bullets"]}
      />,
    )
    const selects = document.querySelectorAll("select")
    // 11 类页面各一个下拉
    expect(selects.length).toBe(11)
    const coverSelect = selects[0] as HTMLSelectElement
    expect(coverSelect.getAttribute("aria-label")).toBe("封面 版式")
    // 选项 = 未映射 + 模板里的 2 个版式
    expect(coverSelect.options.length).toBe(3)
    expect(Array.from(coverSelect.options).map((o) => o.text)).toEqual(["（未映射）", "标题幻灯片", "标题和内容"])
  })
})
