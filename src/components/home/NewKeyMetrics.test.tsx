/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import "@testing-library/jest-dom/vitest"
import { NewKeyMetrics } from "./NewKeyMetrics"
import { keyMetricsOf, type DeadlineInfo } from "@/pages/Home/homeLayout"
import type { QualRiskView } from "@/pages/QualCerts/qualsCore"

afterEach(cleanup)

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc">{loc.pathname}</span>
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<>{ui}<LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const NO_RISK: QualRiskView = { urgent: 0, watch: 0, total: 0, line: "" }
const DEADLINE: DeadlineInfo = {
  projectId: "p1",
  name: "某医院智慧病房方案",
  hospital: "某医院",
  deadline: "2026-11-10",
  daysLeft: 3,
}

describe("NewKeyMetrics：三张指标卡", () => {
  it("渲染三张卡：标题 / 数值 / 明细口径", () => {
    const metrics = keyMetricsOf({ urgent: 4, watch: 25, total: 29, line: "已过期 1 · 30 天内到期 3" }, 29, DEADLINE)
    renderWithRouter(<NewKeyMetrics metrics={metrics} onOpenDeadlineProject={() => {}} />)
    expect(screen.getByText("资质预警")).toBeInTheDocument()
    expect(screen.getByText("已过期 1 · 30 天内到期 3")).toBeInTheDocument()
    expect(screen.getByText("29")).toBeInTheDocument() // 情报待确认
    expect(screen.getByText("3")).toBeInTheDocument() // 截止倒计时 3 天
    expect(screen.getByText("某医院智慧病房方案 · 2026-11-10 截止")).toBeInTheDocument()
  })

  it("点击资质卡 → /qual-certs；点击情报卡 → /intel-center", () => {
    const metrics = keyMetricsOf(NO_RISK, 5, null)
    renderWithRouter(<NewKeyMetrics metrics={metrics} onOpenDeadlineProject={() => {}} />)
    fireEvent.click(screen.getByText("查看资质台账"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/qual-certs")
    fireEvent.click(screen.getByText("进入情报中心"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/intel-center")
  })

  it("点击截止卡 → 打开项目详情回调（不走路由）", () => {
    const onOpen = vi.fn()
    const metrics = keyMetricsOf(NO_RISK, 0, DEADLINE)
    renderWithRouter(<NewKeyMetrics metrics={metrics} onOpenDeadlineProject={onOpen} />)
    fireEvent.click(screen.getByText("查看项目"))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("loc")).toHaveTextContent("/")
  })

  it("无截止日 → 显示「—」与引导文案", () => {
    const metrics = keyMetricsOf(NO_RISK, 0, null)
    renderWithRouter(<NewKeyMetrics metrics={metrics} onOpenDeadlineProject={() => {}} />)
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.getByText("暂无带截止日期的进行中项目")).toBeInTheDocument()
  })
})
