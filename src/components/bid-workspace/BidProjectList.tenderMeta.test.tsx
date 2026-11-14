/** @vitest-environment jsdom */
/**
 * 「导入招标文件自动识别」装配回归网（新建投标项目弹窗）。
 *
 * 守的是这条链路的接线，而不是抽取规则本身（规则由 tenderMeta.test.ts 覆盖）：
 *   选文件 → extractTenderFileText 解析 → extractTenderMeta 抽取 → 四个表单 setter 被填 → 提示文案
 * 抽取规则再准，只要这里漏接一个 setter，用户看到的就是「识别了但没填上」。
 * 反噪音同样断言：抽取不到信息时必须明确说「没识别出可用信息」，不能静默什么都不做。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

// vi.mock 会被提升到文件顶部，factory 里只能引用 vi.hoisted 提升出来的值
const { SAMPLE, DOCX, PDF } = vi.hoisted(() => ({
  SAMPLE: [
    "三明市中西医结合医院信息化整体提升项目招标文件",
    "项目编号：SMZC-2026-0912",
    "项目名称：三明市中西医结合医院信息化整体提升项目",
    "采购人：三明市中西医结合医院",
    "开标时间：2026年9月12日9时30分",
  ].join("\n"),
  DOCX: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  PDF: { type: "application/pdf" },
}))

// 旁路重依赖：bidFiles 会拉起 docx/pdfjs，与本测试的接线断言无关，直接替换成固定文本
vi.mock("@/pages/BidWorkspace/bidFiles", () => ({
  extractTenderFileText: vi.fn(async () => SAMPLE),
}))

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { BidProjectList } from "./BidProjectList"

/**
 * 2026-11-11：BidReviewSummary 的「投标复盘 →」改成 react-router 的 <Link>（原裸 <a href="/review">
 * 是死链），因此 BidProjectList 子树现在依赖 Router context —— 必须包 MemoryRouter 渲染。
 */
function renderList(props: Parameters<typeof BidProjectList>[0]) {
  return render(
    <MemoryRouter>
      <BidProjectList {...props} />
    </MemoryRouter>,
  )
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    projects: [],
    projectsCapped: false,
    listLoading: false,
    searchKeyword: "",
    setSearchKeyword: vi.fn(),
    openNewDialog: vi.fn(),
    openProject: vi.fn(),
    deleteProject: vi.fn(),
    listView: "active" as const,
    setListView: vi.fn(),
    recentDeleted: [],
    softDeleteProject: vi.fn(),
    restoreProject: vi.fn(),
    setProjectArchived: vi.fn(),
    newDialogOpen: true,
    setNewDialogOpen: vi.fn(),
    formProjectName: "",
    setFormProjectName: vi.fn(),
    formTenderNo: "",
    setFormTenderNo: vi.fn(),
    formHospital: "",
    setFormHospital: vi.fn(),
    formBidOpenDate: "",
    setFormBidOpenDate: vi.fn(),
    formOpportunityId: "",
    setFormOpportunityId: vi.fn(),
    dialogOppOptions: [],
    oppOptionsCapped: false,
    creating: false,
    createProject: vi.fn(),
    ...overrides,
  } as Parameters<typeof BidProjectList>[0]
}

afterEach(() => cleanup())

describe("新建投标项目弹窗：导入招标文件自动识别", () => {
  it("选择文件后把识别到的四要素填进表单并给出提示", async () => {
    const setFormProjectName = vi.fn()
    const setFormTenderNo = vi.fn()
    const setFormHospital = vi.fn()
    const setFormBidOpenDate = vi.fn()
    const props = makeProps({ setFormProjectName, setFormTenderNo, setFormHospital, setFormBidOpenDate })
    renderList(props)

    expect(screen.getByText("导入招标文件自动识别")).toBeInTheDocument()
    // Dialog 走 Radix portal 渲染，节点不在 render 的 container 内，只能从 document 查
    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()

    await userEvent.upload(input as HTMLInputElement, new File(["x"], "tender.docx", DOCX))

    await waitFor(() => expect(setFormProjectName).toHaveBeenCalledWith("三明市中西医结合医院信息化整体提升项目"))
    expect(setFormTenderNo).toHaveBeenCalledWith("SMZC-2026-0912")
    expect(setFormHospital).toHaveBeenCalledWith("三明市中西医结合医院")
    expect(setFormBidOpenDate).toHaveBeenCalledWith("2026-09-12")
    expect(await screen.findByText(/已识别并填入：项目名称、招标编号、客户医院、开标时间/)).toBeInTheDocument()
  })

  it("抽取不到信息时明确提示，不静默", async () => {
    const mod = await import("@/pages/BidWorkspace/bidFiles")
    vi.mocked(mod.extractTenderFileText).mockResolvedValueOnce("目录\n第一章 招标公告\n第二章 投标人须知")
    const setFormProjectName = vi.fn()
    renderList(makeProps({ setFormProjectName }))

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(["x"], "tender.docx", DOCX))

    expect(await screen.findByText("没识别出可用信息，请手动填写")).toBeInTheDocument()
    expect(setFormProjectName).not.toHaveBeenCalled()
  })

  it("文件解析失败时把原因显示出来（如扫描件 PDF）", async () => {
    const mod = await import("@/pages/BidWorkspace/bidFiles")
    vi.mocked(mod.extractTenderFileText).mockRejectedValueOnce(new Error("该 PDF 没有文字层（疑似扫描件），请改用粘贴文本"))
    renderList(makeProps())

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(["x"], "scan.pdf", PDF))

    expect(await screen.findByText(/疑似扫描件/)).toBeInTheDocument()
  })
})
