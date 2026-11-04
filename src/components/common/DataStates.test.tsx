/** @vitest-environment jsdom */
/**
 * 统一「空态 / 失败态」组件的契约（2026-11-04）。
 *
 * 建这个组件的直接动因：R69 审计挖出 4 处**把加载失败说成「没有数据」**的缺陷
 * （知识库检索 401 显示「没有找到」、素材选择器 500 显示「素材库为空」…）。
 * 全仓当时有 123 处手写空态、15 处手写失败态，各写一遍 = 每新增一处多一次写错机会。
 *
 * 本文件钉住四条不变量：
 *  ① ErrorState 必须显示技术原因，且默认带「不是『没有数据』」这句话——防用户误判；
 *  ② EmptyState 不得出现「不是没有数据」这类失败措辞（它与失败是互斥语义）；
 *  ③ 两者互不包含对方的关键元素（用同一套查询双向断言，防以后有人把两者合并成一个含糊组件）；
 *  ④ ErrorState 有 onRetry 才渲染重试按钮；没有就不渲染（不能给死按钮）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import {
  AuthRequiredState,
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  LoadingState,
  NotConfiguredState,
} from "./DataStates"

afterEach(cleanup)

describe("ErrorState：失败必须说清原因，且不能被读成「没数据」", () => {
  it("显示技术原因与「不是『没有数据』」", () => {
    render(<ErrorState reason="HTTP 500：数据库被锁" />)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText(/不是「没有数据」/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 500：数据库被锁/)).toBeInTheDocument()
  })

  it("有 onRetry 才出重试按钮，点击回调触发", () => {
    const onRetry = vi.fn()
    render(<ErrorState reason="boom" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("button", { name: /重试/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("没有 onRetry 时不渲染死按钮", () => {
    render(<ErrorState reason="boom" />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("notEmptyHint=false 时可关掉那句免责说明（表单提交失败等场景）", () => {
    render(<ErrorState reason="boom" notEmptyHint={false} />)
    expect(screen.queryByText(/不是「没有数据」/)).toBeNull()
  })

  it("自定义 title 与 hint 都上屏", () => {
    render(<ErrorState title="正文检索没有成功" reason="401" hint="刷新页面重新登录后再试" />)
    expect(screen.getByText(/正文检索没有成功/)).toBeInTheDocument()
    expect(screen.getByText("刷新页面重新登录后再试")).toBeInTheDocument()
  })
})

describe("EmptyState：成功但无数据，不许出现失败措辞", () => {
  it("标题与提示上屏，且没有「不是没有数据」/「技术原因」", () => {
    render(<EmptyState title="素材库为空或未命中" hint="可先到素材库页导入" />)
    expect(screen.getByText("素材库为空或未命中")).toBeInTheDocument()
    expect(screen.getByText("可先到素材库页导入")).toBeInTheDocument()
    expect(screen.queryByText(/不是「没有数据」/)).toBeNull()
    expect(screen.queryByText(/技术原因/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("action 渲染为可点区域", () => {
    const onClick = vi.fn()
    render(<EmptyState title="空" action={<button onClick={onClick}>去导入</button>} />)
    fireEvent.click(screen.getByText("去导入"))
    expect(onClick).toHaveBeenCalled()
  })
})

describe("筛选后为 0：必须点明是筛选导致，并给清空入口", () => {
  it("默认文案区分「筛选后没有」而不是「库是空的」", () => {
    render(<FilteredEmptyState />)
    expect(screen.getByText(/当前筛选条件下没有结果/)).toBeInTheDocument()
    expect(screen.queryByText(/库是空的|还没有任何/)).toBeNull()
  })

  it("给 onClearFilters 才出「清空筛选」", () => {
    const onClear = vi.fn()
    render(<FilteredEmptyState onClearFilters={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: /清空筛选/ }))
    expect(onClear).toHaveBeenCalled()
    cleanup()
    render(<FilteredEmptyState />)
    expect(screen.queryByRole("button", { name: /清空筛选/ })).toBeNull()
  })
})

describe("其它状态：加载 / 未登录 / 未配置 三者语义不混", () => {
  it("LoadingState 有加载文案，且不出现空态/失败措辞", () => {
    render(<LoadingState text="正在加载情报…" />)
    expect(screen.getByText("正在加载情报…")).toBeInTheDocument()
    expect(screen.queryByText(/不是「没有数据」/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("AuthRequiredState 说的是登录问题，不是「没数据」也不是「重试」", () => {
    render(<AuthRequiredState onLogin={() => {}} />)
    expect(screen.getByText(/需要登录/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /去登录/ })).toBeInTheDocument()
    expect(screen.queryByText(/不是「没有数据」/)).toBeNull()
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull()
  })

  it("NotConfiguredState 是中性信息态，不带 alert 语义", () => {
    render(<NotConfiguredState title="本机资料检索未启用" hint="没装 AnyTXT 时其它功能不受影响" />)
    expect(screen.getByText("本机资料检索未启用")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
