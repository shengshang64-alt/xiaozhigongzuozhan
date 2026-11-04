/** @vitest-environment jsdom */
/**
 * 知识库列表空态的「筛选 vs 真空库」区分（2026-11-04，R69 审计 P2-7）。
 *
 * 缺陷形态：分类筛选生效、结果 0 条时，空态只判了 `searchQuery`，
 * 于是显示「团队知识库还是空的 / 上传第一批文档」，而左栏明明写着 2175 篇。
 * 用户会以为库被清空了（或以为筛选没生效），而真实原因是分类把结果筛空了。
 *
 * 本文件钉住三条：
 *  ① 只有分类筛选生效（没搜索词）→ 必须说「当前筛选条件下没有文档」，不许说「库还是空的」；
 *  ② 给出「清除筛选」入口，且点击时**同时**清搜索与分类（否则点一下还是看不到东西）；
 *  ③ 真空库（无任何筛选）→ 仍显示「团队知识库还是空的 + 上传第一批文档」。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { DocListPanel } from "./DocListPanel"
import type { KbDocRow } from "@/lib/kbCore"

// jsdom 未实现 Element.prototype.scrollTo（组件里用它做「切换筛选后列表回到顶部」），
// 补一个空实现即可——本文件断言的是空态文案，与滚动行为无关。
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {}
  }
})

afterEach(cleanup)

function renderPanel(over: { categoryFilter?: string; searchQuery?: string; docs?: KbDocRow[] } = {}) {
  const onClearSearch = vi.fn()
  const setCategoryFilter = vi.fn()
  const openUpload = vi.fn()
  render(
    <DocListPanel
      sortedDocs={over.docs ?? []}
      selectedDoc={null}
      selectDoc={() => {}}
      sortKey="updated"
      setSortKey={() => {}}
      docsLoading={false}
      docsCalibrating={false}
      libTab="team"
      searchQuery={over.searchQuery ?? ""}
      openUpload={openUpload}
      categoryFilter={over.categoryFilter ?? ""}
      setCategoryFilter={setCategoryFilter}
      batchMode={false}
      batchSelectedIds={[]}
      batchBusy={false}
      onToggleBatchMode={() => {}}
      onToggleBatchSelect={() => {}}
      onClearBatchSelect={() => {}}
      onBatchMove={() => {}}
      onBatchCategory={() => {}}
      onBatchDelete={() => {}}
      flashDocId={null}
      allFolderPaths={[]}
      openDocAction={() => {}}
      canEditDoc={() => false}
      onClearSearch={onClearSearch}
      trashCount={0}
      onOpenTrash={() => {}}
      trashOpen={false}
      onCloseTrash={() => {}}
      trashItems={[]}
      onRestoreTrash={() => {}}
      onPurgeTrash={() => {}}
    />,
  )
  return { onClearSearch, setCategoryFilter, openUpload }
}

describe("知识库列表空态：分类筛选导致的 0 条不能显示成「库是空的」", () => {
  it("只有分类筛选生效 → 说「当前筛选条件下没有文档」，并点明是哪个分类", () => {
    renderPanel({ categoryFilter: "合同商务" })
    expect(screen.getByText(/当前筛选条件下没有文档/)).toBeInTheDocument()
    // 必须点出具体筛选原因，用户才知道该清什么
    expect(screen.getByText(/分类「合同商务」/)).toBeInTheDocument()
    // 关键：不许出现「库是空的」这种误导
    expect(screen.queryByText(/团队知识库还是空的/)).toBeNull()
    expect(screen.queryByText(/上传第一批文档/)).toBeNull()
  })

  it("「清除筛选」同时清搜索与分类（只清一个等于没清）", () => {
    const { onClearSearch, setCategoryFilter } = renderPanel({ categoryFilter: "合同商务", searchQuery: "电子病历" })
    fireEvent.click(screen.getByRole("button", { name: /清除筛选/ }))
    expect(onClearSearch).toHaveBeenCalledTimes(1)
    expect(setCategoryFilter).toHaveBeenCalledWith("")
  })

  it("搜索词 + 分类同时生效时，两者都在提示里点名", () => {
    renderPanel({ categoryFilter: "技术方案", searchQuery: "互联互通" })
    expect(screen.getByText(/搜索词/)).toBeInTheDocument()
    expect(screen.getByText(/分类「技术方案」/)).toBeInTheDocument()
  })

  it("真空库（无任何筛选）→ 仍显示原「团队知识库还是空的」+ 上传入口", () => {
    const { openUpload } = renderPanel({})
    expect(screen.getByText(/团队知识库还是空的/)).toBeInTheDocument()
    const btn = screen.getByRole("button", { name: /上传第一批文档/ })
    fireEvent.click(btn)
    expect(openUpload).toHaveBeenCalledTimes(1)
  })

  it("有文档时不显示任何空态", () => {
    renderPanel({ docs: [{ id: "d1", title: "某方案", content: "正文", rh_user_id: "u" } as KbDocRow] })
    expect(screen.queryByText(/当前筛选条件下没有文档/)).toBeNull()
    expect(screen.queryByText(/团队知识库还是空的/)).toBeNull()
  })
})
