/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { BidPipelineStepperEnhanced } from "./BidPipelineStepperEnhanced"
import { BidChapterNavTree } from "./BidChapterNavTree"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// TASK-2.1-FIX：按 docs/GLM-5.3-EXECUTE-SCRIPT-TASK-2.1.md Part 1 重写的测试。
// 断言文案与组件源码逐字对齐（PIPELINE_STEPS 实际标签：标书查重 / 废标项检查 / 模拟评标），
// 夹具形状与真实类型对齐（Chapter 需 node_id/sections/gen_status；BidStage 无 "in_progress"），
// 最小夹具 + 收窄转换沿用仓库既有惯例（BidCheck/rules/dedup.test.ts 的 rec()）。
//
// UX-v2 拆屏（2026-11-11）：步骤条里的通栏「章节导航」面板拆除，章节树整体迁到
// ComposeStep 左栏 BidChapterNavTree——S1 分组/三态/S4 商务组卷用例改锚到该组件直渲染；
// 步骤条用例（跳转 / 按钮态 / 闸门徽标 / 进度）仍走 BidPipelineStepperEnhanced。
// ---------------------------------------------------------------------------

// Mock 数据工厂：每次调用返回全新对象，避免测试间状态污染
// 注意：树的行文案是「第{下标+1}章 {title}」（与正文标题、Word 预览同编号），
// 夹具 title 不带章号，断言里的「第1章 测试章节」由树拼出。
function makeChapters(count: number, doneCount: number): Chapter[] {
  return Array.from({ length: count }, (_, i) => ({
    node_id: `ch-${i + 1}`,
    title: `测试章节`,
    sections: [],
    content: i < doneCount ? `第${i + 1}章的正文内容` : "",
    gen_status: "done" as const,
  }))
}

function makeProject(overrides: Partial<BidProjectRecord> = {}): BidProjectRecord {
  return {
    // 只填组件读取路径所需的字段（tender_text / parse_report / bid_chapters /
    // dup_report / void_check / ai_review / stage / stage_gates），其余字段按
    // dedup.test.ts rec() 同款最小夹具惯例省略。
    id: "test-proj-001",
    project_name: "测试项目",
    tender_text: "招标文件全文内容",
    parse_report: { summary: "已解析" },
    bid_chapters: makeChapters(2, 1), // 默认 2 章，1 章完成
    dup_report: null,
    void_check: null,
    ai_review: null,
    stage: "composing",
    stage_gates: { gates: [] },
    ...overrides,
  } as unknown as BidProjectRecord
}

// 渲染辅助：每次都渲染一个全新的容器，避免 DOM 残留
function renderStepper(opts: {
  activeStep?: number
  project?: BidProjectRecord
  requestStep?: (step: number) => void
} = {}) {
  const { activeStep = 1, project = makeProject(), requestStep = vi.fn() } = opts
  return {
    requestStep,
    ...render(<BidPipelineStepperEnhanced activeStep={activeStep} requestStep={requestStep} activeProject={project} />),
  }
}

/** UX-v2 拆屏后，章节树用例直渲染 BidChapterNavTree（原经步骤条面板间接渲染） */
function renderTree(opts: {
  chapters?: Chapter[]
  budgets?: number[]
  activeChapterId?: string | null
  selectChapter?: (nodeId: string) => void
  generateChapter?: (nodeId: string) => void
  continueChapter?: (nodeId: string) => void
  refineChapter?: (nodeId: string, kind: "rewrite" | "expand" | "condense") => void
  addBizAssemblyItems?: (titles: string[]) => void
} = {}) {
  const {
    chapters = makeChapters(2, 1),
    budgets = [],
    activeChapterId = null,
    selectChapter = vi.fn(),
    generateChapter,
    continueChapter,
    refineChapter,
    addBizAssemblyItems = vi.fn(),
  } = opts
  return {
    selectChapter,
    addBizAssemblyItems,
    ...render(
      <BidChapterNavTree
        chapters={chapters}
        chapterBudgets={budgets}
        activeChapterId={activeChapterId}
        supplementState={null}
        sectionState={null}
        doneChapterCount={chapters.filter((c) => (c.content ?? "").trim().length > 0).length}
        techChapterTotal={chapters.length}
        emptyBizCount={0}
        onFillBizSkeletons={() => {}}
        onSelectChapter={selectChapter}
        onFocusSection={() => {}}
        generateChapter={generateChapter}
        continueChapter={continueChapter}
        refineChapter={refineChapter}
        addBizAssemblyItems={addBizAssemblyItems}
      />,
    ),
  }
}

describe("BidPipelineStepperEnhanced", () => {
  beforeEach(() => {
    // 每个测试前清理 DOM，防止上一个测试的渲染残留
    document.body.innerHTML = ""
  })

  afterEach(cleanup)

  // -----------------------------------------------------------
  // 1. 基础渲染
  // -----------------------------------------------------------
  it("渲染全部 7 个流程步骤", () => {
    renderStepper({ activeStep: 1 })

    // 通过步骤标签文本查找（与 bidTypes.PIPELINE_STEPS 实际标签逐字一致），每步一个
    const stepLabels = [
      "招标文件",
      "AI 解析报告",
      "投标文件编制",
      "标书查重",
      "废标项检查",
      "模拟评标",
      "归档导出",
    ]
    for (const label of stepLabels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  // -----------------------------------------------------------
  // 2. 完成态标记（UX-v2 胶囊步骤条：完成 = 主色浅底胶囊）
  // -----------------------------------------------------------
  it("已完成步骤显示主色浅底胶囊", () => {
    // tender_text 非空 → 步骤 1 完成（默认夹具即如此，切到第 2 步观察第 1 步样式）
    const project = makeProject({ tender_text: "有内容" })
    renderStepper({ activeStep: 2, project })

    const step1Label = screen.getByText("招标文件")
    const pill = step1Label.closest("button")
    expect(pill).toHaveClass("bg-primary/5")
    expect(pill).toHaveClass("text-primary")
  })

  // -----------------------------------------------------------
  // 3. 第 3 步显示真实章进度（唯一有真进度数据的步骤；不再编造百分比与时长）
  // -----------------------------------------------------------
  it("第 3 步显示真实章进度（N/M 章）", () => {
    const project = makeProject({
      bid_chapters: makeChapters(4, 2),
    })
    renderStepper({ activeStep: 3, project })

    expect(screen.getByText("2/4 章")).toBeInTheDocument()
    // 拍脑袋的时长演示值（“3 小时 / 45 分钟”）已按铁律删除
    expect(screen.queryByText("3 小时")).not.toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 4. 当前步骤高亮
  // -----------------------------------------------------------
  it("当前步骤显示主色实底胶囊", () => {
    // 注意：组件逻辑「完成态优先于当前态」——只要第 3 步任一章节有正文就算完成，
    // 因此这里必须用 0 章有正文的夹具，第 3 步才会以 current 渲染。
    const project = makeProject({
      bid_chapters: makeChapters(2, 0),
    })
    renderStepper({ activeStep: 3, project })

    const currentLabel = screen.getByText("投标文件编制")
    const pill = currentLabel.closest("button")
    expect(pill).toHaveClass("border-primary")
    expect(pill).toHaveClass("bg-primary/10")
    expect(pill).toHaveClass("font-semibold")
  })

  // -----------------------------------------------------------
  // 5. 点击步骤触发跳转
  // -----------------------------------------------------------
  it("点击步骤胶囊可触发 requestStep 回调", () => {
    const requestStep = vi.fn()
    renderStepper({ activeStep: 1, requestStep })

    fireEvent.click(screen.getByText("AI 解析报告").closest("button")!)
    expect(requestStep).toHaveBeenCalledWith(2)
  })

  // -----------------------------------------------------------
  // 6. UX-v2：假「保存草稿」按钮与前后步按钮组退役
  //    （保存草稿只有 console.log，自动保存一直存在；返回/继续与点步骤跳转重复）
  // -----------------------------------------------------------
  it("不再渲染「返回上一步 / 保存草稿 / 继续编写」按钮组", () => {
    renderStepper({ activeStep: 3 })

    expect(screen.queryByText(/返回上一步/)).not.toBeInTheDocument()
    expect(screen.queryByText(/保存草稿/)).not.toBeInTheDocument()
    expect(screen.queryByText(/继续编写/)).not.toBeInTheDocument()
    expect(screen.queryByText(/完成/)).not.toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 9. UX-v2 拆屏：通栏章节导航整体拆除（树在 ComposeStep 左栏）
  // -----------------------------------------------------------
  it("activeStep=3 不再渲染通栏「章节导航」与假「快速工具」行", () => {
    renderStepper({ activeStep: 3 })

    expect(screen.queryByText(/章节导航/)).not.toBeInTheDocument()
    expect(screen.queryByText(/快速工具/)).not.toBeInTheDocument()
  })

  it("activeStep≠3 同样不显示章节导航", () => {
    renderStepper({ activeStep: 1 })

    expect(screen.queryByText(/章节导航/)).not.toBeInTheDocument()
    expect(screen.queryByText(/快速工具/)).not.toBeInTheDocument()
  })
})

describe("BidChapterNavTree（正文编写左栏树 · UX-v2）", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  afterEach(cleanup)

  // -----------------------------------------------------------
  // 10. 章节完成态样式（UX-R3 S1：绿色左边框行保留，行级三态见下方新用例）
  // -----------------------------------------------------------
  it("已完成章节显示绿色左边框与绿色背景", () => {
    renderTree() // 默认 2 章 1 章完成

    const chapterTitle = screen.getByText("第1章 测试章节")
    const chapterRow = chapterTitle.closest("[data-chapter-row]")
    expect(chapterRow).toHaveClass("border-green-500")
    expect(chapterRow).toHaveClass("bg-green-50")
  })

  // -----------------------------------------------------------
  // 11. 空章节数组容错
  // -----------------------------------------------------------
  it("空章节数组时组件不崩溃，给出「先生成大纲」空态", () => {
    renderTree({ chapters: [] })

    expect(screen.getByText(/还没有章节大纲/)).toBeInTheDocument()
    expect(screen.queryByText(/测试章节/)).not.toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // UX-R3 S1（2026-11-08）：分组大纲树 + 行级三态
  // -----------------------------------------------------------
  it("章节按 part 分组显示「商务部分/技术部分」组头", () => {
    const bizCh: Chapter = {
      node_id: "biz-1",
      title: "投标函",
      sections: [],
      content: "正文",
      gen_status: "done",
      part: "biz",
    }
    const techCh: Chapter = {
      node_id: "tech-1",
      title: "系统总体设计",
      sections: [],
      content: "",
      gen_status: "pending",
      part: "tech",
    }
    renderTree({ chapters: [bizCh, techCh] })

    expect(screen.getByText("商务部分")).toBeInTheDocument()
    expect(screen.getByText("技术部分")).toBeInTheDocument()
    // 组头显示完成度：商务 1/1、技术 0/1
    expect(screen.getByText("1/1")).toBeInTheDocument()
    expect(screen.getByText("0/1")).toBeInTheDocument()
  })

  it("无 part 字段的存量章节归入技术部分", () => {
    // 与 bidTypes.isBizPart「无 part 一律按技术章」存量语义一致
    renderTree({ chapters: makeChapters(2, 0) })

    expect(screen.getByText("技术部分")).toBeInTheDocument()
    expect(screen.queryByText("商务部分")).not.toBeInTheDocument()
  })

  it("部分成稿章（未达预算 80%）显示蓝色◐态与字数", () => {
    const partialCh: Chapter = {
      node_id: "ch-partial",
      title: "半成品章",
      sections: [],
      content: "一二三四五", // 5 字，远低于 100 字预算的 80%
      gen_status: "done",
    }
    renderTree({ chapters: [partialCh], budgets: [100] })

    const row = screen.getByText(/半成品章/).closest("[data-chapter-row]")
    expect(row).toHaveClass("border-blue-400")
    expect(screen.getByText("5字")).toBeInTheDocument()
  })

  it("达到预算 80% 的章判为完成态", () => {
    const doneCh: Chapter = {
      node_id: "ch-done",
      title: "达标章",
      sections: [],
      content: "正".repeat(90), // 90 字 ≥ 100 × 80%
      gen_status: "done",
    }
    renderTree({ chapters: [doneCh], budgets: [100] })

    const row = screen.getByText(/达标章/).closest("[data-chapter-row]")
    expect(row).toHaveClass("border-green-500")
  })

  it("当前编辑章整行蓝色高亮", () => {
    renderTree({ activeChapterId: "ch-2" })

    const row = screen.getByText("第2章 测试章节").closest("[data-chapter-row]")
    expect(row).toHaveClass("border-blue-500")
    expect(row).toHaveClass("bg-blue-50")
  })

  it("传入选章回调后点击章节行触发 selectChapter", () => {
    const selectChapter = vi.fn()
    renderTree({ chapters: makeChapters(2, 0), selectChapter })

    fireEvent.click(screen.getByText("第2章 测试章节").closest("[data-chapter-row]")!)
    expect(selectChapter).toHaveBeenCalledWith("ch-2")
  })

  it("行 hover 快捷动作：写/续/精按钮透传生成通道", () => {
    const generateChapter = vi.fn()
    const continueChapter = vi.fn()
    const refineChapter = vi.fn()
    renderTree({ chapters: makeChapters(1, 0), generateChapter, continueChapter, refineChapter })

    fireEvent.click(screen.getByTitle("生成本章正文"))
    fireEvent.click(screen.getByTitle("从断点续写本章"))
    fireEvent.click(screen.getByTitle("按版式与文风精修本章"))
    expect(generateChapter).toHaveBeenCalledWith("ch-1")
    expect(continueChapter).toHaveBeenCalledWith("ch-1")
    expect(refineChapter).toHaveBeenCalledWith("ch-1", "rewrite")
  })

  it("千字以上部分成稿章字数显示为 k 缩写", () => {
    const partialCh: Chapter = {
      node_id: "ch-partial-2",
      title: "长半成品章",
      sections: [],
      content: "字".repeat(1234),
      gen_status: "done",
    }
    renderTree({ chapters: [partialCh], budgets: [4000] })

    expect(screen.getByText("1.2k字")).toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // UX-v2：底部总进度（原型 draft.html 口径，字数为全文真实累计）
  // -----------------------------------------------------------
  it("底部总进度显示已完成章数与全文真实字数", () => {
    const chs = makeChapters(2, 1)
    renderTree({ chapters: chs })

    expect(screen.getByText("总进度")).toBeInTheDocument()
    // 「1/2 章」在头部徽标与底部总进度各出现一次
    expect(screen.getAllByText("1/2 章").length).toBeGreaterThanOrEqual(1)
    // 第 1 章夹具正文「第1章的正文内容」= 8 个字符 → 8字
    expect(screen.getByText("· 8字")).toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // UX-R3 S4（2026-11-08）：商务组卷检查
  // -----------------------------------------------------------
  it("商务组头显示「组卷检查」入口，技术组无此入口", () => {
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    const techCh: Chapter = { node_id: "t1", title: "技术方案", sections: [], content: "", gen_status: "pending", part: "tech" }
    renderTree({ chapters: [bizCh, techCh] })

    expect(screen.getAllByText(/组卷检查/)).toHaveLength(1)
  })

  it("点击「组卷检查」打开齐套/缺失/需注意三态清单", () => {
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    renderTree({ chapters: [bizCh] })

    fireEvent.click(screen.getByText(/组卷检查/))
    // 标题
    expect(screen.getByText("商务部分组卷检查")).toBeInTheDocument()
    // 三态计数：投标函已建章但内容为空 → 需注意 1；其余 5 项缺失
    expect(screen.getByText("齐套 0")).toBeInTheDocument()
    expect(screen.getByText("需注意 1")).toBeInTheDocument()
    expect(screen.getByText("缺失 5")).toBeInTheDocument()
    // 通用规则依据明示（不伪造解析结果）
    expect(screen.getAllByText(/格式依据（通用规则）/).length).toBeGreaterThan(0)
  })

  it("缺失项「补入」透传 addBizAssemblyItems", () => {
    const addBizAssemblyItems = vi.fn()
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    renderTree({ chapters: [bizCh], addBizAssemblyItems })

    fireEvent.click(screen.getByText(/组卷检查/))
    fireEvent.click(screen.getByText(/^补入「法定代表人授权书」$/))
    expect(addBizAssemblyItems).toHaveBeenCalledWith(["法定代表人授权书"])
  })

  it("一键补齐全部缺失项", () => {
    const addBizAssemblyItems = vi.fn()
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    renderTree({ chapters: [bizCh], addBizAssemblyItems })

    fireEvent.click(screen.getByText(/组卷检查/))
    fireEvent.click(screen.getByText(/一键补齐/))
    expect(addBizAssemblyItems).toHaveBeenCalledTimes(1)
    expect(addBizAssemblyItems.mock.calls[0][0]).toHaveLength(5)
  })

  it("已填实的必备件判为齐套", () => {
    const bizCh: Chapter = {
      node_id: "b1",
      title: "分项报价表",
      sections: [],
      content: "合计：人民币 120,000 元",
      gen_status: "done",
      part: "biz",
    }
    renderTree({ chapters: [bizCh] })

    fireEvent.click(screen.getByText(/组卷检查/))
    expect(screen.getByText("齐套 1")).toBeInTheDocument()
  })
})
