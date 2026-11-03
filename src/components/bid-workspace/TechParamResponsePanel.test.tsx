/** @vitest-environment jsdom */
/**
 * 技术参数响应表面板 UI 回归网（R55，2026-10-15 用户三条口径）：
 *  - ① 来源如实显示 +「章节描述」可自定义（「这种情况我可以自己描述」）；
 *  - ② ★/▲【评审项】重点条款先列在表格上方（「有的话，需要先在开头标注出来」）；
 *  - ③ 其余参数逐条按原文响应、只调字眼：改写行给「已转换字眼」，待人工确认行给角标 + 原因（title）；
 *  - 反噪音：未改写行不打「已转换字眼」；覆盖核对缺口逐条点名。
 * 断的是行为与可见性，不是「渲染不抛错」。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { TechParamResponsePanel } from "./TechParamResponsePanel"
import type { ParseReport } from "@/pages/BidWorkspace/bidTypes"

afterEach(cleanup)

// 正文长度须过 DEVIATION_MIN_SECTION_CHARS（200）：否则「采购需求」这类标题命中会被当作目录/引用行丢弃而回退
const TENDER = [
  "第五章 采购需求",
  "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓等主流国产数据库，并完成历史数据迁移与一致性校验",
  "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应，重大故障 2 小时内到场处理并提交故障分析报告",
  "5.3 【评审项】系统可用性不得低于 99.9%，单点故障恢复时间不得超过 30 分钟，全年中断时长不高于 8 小时",
  "5.4 应提供不少于 3 场用户培训，培训须覆盖系统管理员与业务操作员，并出具培训记录与考核结果",
  "5.5 可提供三年免费升级服务，升级窗口须安排在业务低峰期并提前 3 个工作日通知使用单位",
  "第六章 评标办法",
  "6.1 技术方案（20 分）：优（15-20 分）、良（10-14 分）、一般（5-9 分）",
  "附件三 技术规格书",
  "1.1 终端须支持双频 Wi-Fi，兼容 802.11a/b/g/n/ac 协议，并提供样机现场演示",
].join("\n")

const panel = (tenderText: string | null = TENDER, report: ParseReport | null = null) =>
  render(<TechParamResponsePanel tenderText={tenderText} report={report} />)

describe("技术参数响应表面板：重点条款先汇总 + 逐条原文响应", () => {
  it("★/▲【评审项】重点条款先在表格上方汇总（按招标文件原文响应）", () => {
    panel()
    expect(screen.getByText(/重点条款 3 条/)).toBeInTheDocument()
    expect(screen.getByText(/按招标文件原文响应/)).toBeInTheDocument()
    // 重点条款逐字（含 ★）出现在「汇总 + 表格」两处，而不是只放在表格里等人自己找
    expect(screen.getAllByText(/★ 系统须支持国产化数据库/).length).toBeGreaterThanOrEqual(2)
    // 两列为主的响应表列头
    expect(screen.getByText("招标要求（原文）")).toBeInTheDocument()
    expect(screen.getByText("响应表述")).toBeInTheDocument()
  })

  it("待人工确认行：角标 + 原因放进 title（不只给一个黄点）", () => {
    panel()
    expect(screen.getAllByText("待人工确认").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTitle(/许可\/建议类表述/)).toBeInTheDocument()
  })

  it("「章节描述」填写后按描述重新定位，来源 label 随之变化；清空回到自动定位", () => {
    panel()
    expect(screen.getByText(/按招标原文标题定位：第五章 采购需求/)).toBeInTheDocument()
    const input = screen.getByLabelText("章节描述")
    fireEvent.change(input, { target: { value: "附件三 技术规格书" } })
    expect(screen.getByText(/按你的描述定位：附件三 技术规格书/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "" } })
    expect(screen.getByText(/按招标原文标题定位：第五章 采购需求/)).toBeInTheDocument()
  })

  it("未改写行不打「已转换字眼」（反噪音），改写行才打", () => {
    // 只有量化边界（不得低于/不得超过）的项目：引擎原样保留，不产生改写
    const report = {
      scope: "full",
      sections: [
        {
          key: "delivery_req",
          title: "交货和服务要求",
          content: "系统可用性不得低于 99.9%，单点故障恢复时间不得超过 30 分钟",
        },
      ],
    } as ParseReport
    const { unmount } = panel("", report)
    expect(screen.queryByText("已转换字眼")).toBeNull()
    unmount()
    panel()
    expect(screen.getAllByText("已转换字眼").length).toBeGreaterThanOrEqual(1)
  })

  it("覆盖点名：抽到但本表没有对应行的条款列出来（最多 10 条 + 另有 N 条）", () => {
    // 「注：以“★”标示…」这类标记说明行不建响应行，但会作为条款被抽到——正是点名的目标
    // （必须放在采购需求章节正文内：备注说明行在正文外的话，两条链路都不会看到它）
    const withNote = TENDER.replace(
      "第六章 评标办法",
      ["注：以“★”标示的为实质性条款，负偏离即废标。", "第六章 评标办法"].join("\n"),
    )
    panel(withNote)
    expect(screen.getByText(/覆盖点名：抽到条款 6 条 ↔ 本表 5 行，1 条未对上/)).toBeInTheDocument()
    expect(screen.getByText(/以“★”标示的为实质性条款/)).toBeInTheDocument()
  })

  it("没有任何来源时给出补齐指引（章节描述框是出路），不静默空白", () => {
    panel("", null)
    expect(screen.getByText(/没有定位到技术参数来源/)).toBeInTheDocument()
    expect(screen.getByLabelText("章节描述")).toBeInTheDocument()
  })
})
