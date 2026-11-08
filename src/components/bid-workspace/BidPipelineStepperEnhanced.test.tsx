/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { BidPipelineStepperEnhanced } from "./BidPipelineStepperEnhanced"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// TASK-2.1-FIX：按 docs/GLM-5.3-EXECUTE-SCRIPT-TASK-2.1.md Part 1 重写的测试。
// 断言文案与组件源码逐字对齐（PIPELINE_STEPS 实际标签：标书查重 / 废标项检查 / 模拟评标），
// 夹具形状与真实类型对齐（Chapter 需 node_id/sections/gen_status；BidStage 无 "in_progress"），
// 最小夹具 + 收窄转换沿用仓库既有惯例（BidCheck/rules/dedup.test.ts 的 rec()）。
// ---------------------------------------------------------------------------

// Mock 数据工厂：每次调用返回全新对象，避免测试间状态污染
function makeChapters(count: number, doneCount: number): Chapter[] {
  return Array.from({ length: count }, (_, i) => ({
    node_id: `ch-${i + 1}`,
    title: `第${i + 1}章 测试章节`,
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
  activeChapterId?: string | null
  selectChapter?: (nodeId: string) => void
  chapterBudgets?: number[]
  generateChapter?: (nodeId: string) => void
  continueChapter?: (nodeId: string) => void
  refineChapter?: (nodeId: string, kind: "rewrite" | "expand" | "condense") => void
  addBizAssemblyItems?: (titles: string[]) => void
} = {}) {
  const {
    activeStep = 1,
    project = makeProject(),
    requestStep = vi.fn(),
    activeChapterId,
    selectChapter,
    chapterBudgets,
    generateChapter,
    continueChapter,
    refineChapter,
    addBizAssemblyItems,
  } = opts
  return {
    requestStep,
    selectChapter,
    ...render(
      <BidPipelineStepperEnhanced
        activeStep={activeStep}
        requestStep={requestStep}
        activeProject={project}
        activeChapterId={activeChapterId}
        selectChapter={selectChapter}
        chapterBudgets={chapterBudgets}
        generateChapter={generateChapter}
        continueChapter={continueChapter}
        refineChapter={refineChapter}
        addBizAssemblyItems={addBizAssemblyItems}
      />
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
  // 2. 完成态标记
  // -----------------------------------------------------------
  it("已完成步骤显示绿色文字", () => {
    // tender_text 非空 → 步骤 1 完成（默认夹具即如此，切到第 2 步观察第 1 步样式）
    const project = makeProject({ tender_text: "有内容" })
    renderStepper({ activeStep: 2, project })

    const step1Label = screen.getByText("招标文件")
    expect(step1Label).toHaveClass("text-green-600")
  })

  // -----------------------------------------------------------
  // 3. 第 3 步进度信息
  // -----------------------------------------------------------
  it("第 3 步显示章节进度百分比与进度条", () => {
    const project = makeProject({
      bid_chapters: makeChapters(4, 2), // 2/4 = 50%
    })
    renderStepper({ activeStep: 3, project })

    // 百分比文本
    expect(screen.getByText("50% (2/4章)")).toBeInTheDocument()
    // 进度条容器存在（蓝色渐变条）
    const progressBar = document.querySelector(".bg-gradient-to-r")
    expect(progressBar).not.toBeNull()
  })

  // -----------------------------------------------------------
  // 4. 当前步骤高亮
  // -----------------------------------------------------------
  it("当前步骤标签显示蓝色高亮", () => {
    // 注意：组件逻辑「完成态优先于当前态」——只要第 3 步任一章节有正文就算完成，
    // 因此这里必须用 0 章有正文的夹具，第 3 步才会以 current（蓝色）渲染。
    const project = makeProject({
      bid_chapters: makeChapters(2, 0),
    })
    renderStepper({ activeStep: 3, project })

    const currentLabel = screen.getByText("投标文件编制")
    expect(currentLabel).toHaveClass("text-blue-600")
  })

  // -----------------------------------------------------------
  // 5. 点击步骤触发跳转
  // -----------------------------------------------------------
  it("点击步骤可触发 requestStep 回调", () => {
    const requestStep = vi.fn()
    renderStepper({ activeStep: 1, requestStep })

    // 点击步骤 2 的容器（通过标签文本向上找到可点击元素）
    const step2Label = screen.getByText("AI 解析报告")
    const clickable = step2Label.closest("[class*='cursor-pointer']")
    expect(clickable).not.toBeNull()
    fireEvent.click(clickable!)

    expect(requestStep).toHaveBeenCalledWith(2)
  })

  // -----------------------------------------------------------
  // 6. 上一步按钮在第一步禁用
  // -----------------------------------------------------------
  it("activeStep=1 时「返回上一步」按钮禁用", () => {
    renderStepper({ activeStep: 1 })

    const prevBtn = screen.getByRole("button", { name: /返回上一步/ })
    expect(prevBtn).toBeDisabled()
  })

  // -----------------------------------------------------------
  // 7. 下一步按钮在非最后一步可用
  // -----------------------------------------------------------
  it("activeStep=3 时「继续编写」按钮可用", () => {
    renderStepper({ activeStep: 3 })

    const nextBtn = screen.getByRole("button", { name: /继续编写/ })
    expect(nextBtn).not.toBeDisabled()
  })

  // -----------------------------------------------------------
  // 8. 最后一步按钮文案变为「完成」
  // -----------------------------------------------------------
  it("activeStep=7 时按钮文案为「完成」", () => {
    renderStepper({ activeStep: 7 })

    const doneBtn = screen.getByRole("button", { name: /完成/ })
    expect(doneBtn).toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 9. 上下文面板仅在第 3 步出现
  // -----------------------------------------------------------
  it("activeStep=3 时显示章节导航与快速工具", () => {
    renderStepper({ activeStep: 3 })

    expect(screen.getByText(/章节导航/)).toBeInTheDocument()
    expect(screen.getByText(/快速工具/)).toBeInTheDocument()
  })

  it("activeStep≠3 时不显示章节导航", () => {
    renderStepper({ activeStep: 1 })

    expect(screen.queryByText(/章节导航/)).not.toBeInTheDocument()
    expect(screen.queryByText(/快速工具/)).not.toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 10. 章节完成态样式（UX-R3 S1：绿色左边框行保留，行级三态见下方新用例）
  // -----------------------------------------------------------
  it("已完成章节显示绿色左边框与绿色背景", () => {
    const project = makeProject({
      bid_chapters: makeChapters(2, 1), // 第 1 章完成
    })
    renderStepper({ activeStep: 3, project })

    // UX-R3 S1 后行容器带 data-chapter-row 标记，左边框压到 3px
    const chapterTitle = screen.getByText("第1章 测试章节")
    const chapterRow = chapterTitle.closest("[data-chapter-row]")
    expect(chapterRow).toHaveClass("border-green-500")
    expect(chapterRow).toHaveClass("bg-green-50")
  })

  // -----------------------------------------------------------
  // 11. 空章节数组容错
  // -----------------------------------------------------------
  it("空章节数组时组件不崩溃，面板以「共 0 章」渲染", () => {
    // 脚本原预期「面板不渲染」，但组件实际判据是 !project?.bid_chapters（真值判断），
    // 空数组为真值 → 面板仍渲染、章节列表为空。按脚本 Part 1 指引「对照组件源码
    // 调整断言」：这里钉住真实行为——不崩溃 + 空清单 + 计数为 0。
    const project = makeProject({ bid_chapters: [] })
    renderStepper({ activeStep: 3, project })

    expect(screen.getByText(/章节导航/)).toBeInTheDocument()
    expect(screen.getByText(/共 0 章/)).toBeInTheDocument()
    expect(screen.queryByText("第1章 测试章节")).not.toBeInTheDocument()
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
    const project = makeProject({ bid_chapters: [bizCh, techCh] })
    renderStepper({ activeStep: 3, project })

    expect(screen.getByText("商务部分")).toBeInTheDocument()
    expect(screen.getByText("技术部分")).toBeInTheDocument()
    // 组头显示完成度：商务 1/1、技术 0/1
    expect(screen.getByText("1/1")).toBeInTheDocument()
    expect(screen.getByText("0/1")).toBeInTheDocument()
  })

  it("无 part 字段的存量章节归入技术部分", () => {
    // 与 bidTypes.isBizPart「无 part 一律按技术章」存量语义一致
    const project = makeProject({ bid_chapters: makeChapters(2, 0) })
    renderStepper({ activeStep: 3, project })

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
    const project = makeProject({ bid_chapters: [partialCh] })
    renderStepper({ activeStep: 3, project, chapterBudgets: [100] })

    const row = screen.getByText("半成品章").closest("[data-chapter-row]")
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
    const project = makeProject({ bid_chapters: [doneCh] })
    renderStepper({ activeStep: 3, project, chapterBudgets: [100] })

    const row = screen.getByText("达标章").closest("[data-chapter-row]")
    expect(row).toHaveClass("border-green-500")
  })

  it("当前编辑章整行蓝色高亮", () => {
    const chapters = makeChapters(2, 1)
    const project = makeProject({ bid_chapters: chapters })
    renderStepper({ activeStep: 3, project, activeChapterId: "ch-2" })

    const row = screen.getByText("第2章 测试章节").closest("[data-chapter-row]")
    expect(row).toHaveClass("border-blue-500")
    expect(row).toHaveClass("bg-blue-50")
  })

  it("传入选章回调后点击章节行触发 selectChapter", () => {
    const selectChapter = vi.fn()
    const project = makeProject({ bid_chapters: makeChapters(2, 0) })
    renderStepper({ activeStep: 3, project, selectChapter })

    fireEvent.click(screen.getByText("第2章 测试章节").closest("[data-chapter-row]")!)
    expect(selectChapter).toHaveBeenCalledWith("ch-2")
  })

  it("行 hover 快捷动作：写/续/精按钮透传生成通道", () => {
    const generateChapter = vi.fn()
    const continueChapter = vi.fn()
    const refineChapter = vi.fn()
    const project = makeProject({ bid_chapters: makeChapters(1, 0) })
    renderStepper({ activeStep: 3, project, generateChapter, continueChapter, refineChapter })

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
    const project = makeProject({ bid_chapters: [partialCh] })
    renderStepper({ activeStep: 3, project, chapterBudgets: [4000] })

    expect(screen.getByText("1.2k字")).toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // UX-R3 S4（2026-11-08）：商务组卷检查
  // -----------------------------------------------------------
  it("商务组头显示「组卷检查」入口，技术组无此入口", () => {
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    const techCh: Chapter = { node_id: "t1", title: "技术方案", sections: [], content: "", gen_status: "pending", part: "tech" }
    const project = makeProject({ bid_chapters: [bizCh, techCh] })
    renderStepper({ activeStep: 3, project })

    expect(screen.getAllByText(/组卷检查/)).toHaveLength(1)
  })

  it("点击「组卷检查」打开齐套/缺失/需注意三态清单", () => {
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    const project = makeProject({ bid_chapters: [bizCh] })
    renderStepper({ activeStep: 3, project })

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
    const project = makeProject({ bid_chapters: [bizCh] })
    renderStepper({ activeStep: 3, project, addBizAssemblyItems })

    fireEvent.click(screen.getByText(/组卷检查/))
    fireEvent.click(screen.getByText(/^补入「法定代表人授权书」$/))
    expect(addBizAssemblyItems).toHaveBeenCalledWith(["法定代表人授权书"])
  })

  it("一键补齐全部缺失项", () => {
    const addBizAssemblyItems = vi.fn()
    const bizCh: Chapter = { node_id: "b1", title: "投标函", sections: [], content: "", gen_status: "pending", part: "biz" }
    const project = makeProject({ bid_chapters: [bizCh] })
    renderStepper({ activeStep: 3, project, addBizAssemblyItems })

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
    const project = makeProject({ bid_chapters: [bizCh] })
    renderStepper({ activeStep: 3, project })

    fireEvent.click(screen.getByText(/组卷检查/))
    expect(screen.getByText("齐套 1")).toBeInTheDocument()
  })
})
