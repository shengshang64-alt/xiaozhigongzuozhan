/** @vitest-environment jsdom */
/**
 * R64 UI 回归网：价格分面板必须把「我方当前报价本身会被判废标」摆到最前面。
 *
 * 守的是一条自相矛盾——现价 800 万、限价 2500 万、招标文件写「低于 45% 按无效投标」时，
 * 面板过去给的是满分 30 分 + 「当前报价已拿满价格分，无需再降」，只在阶梯的「有效性」列里
 * 用小字写「按无效投标处理」。废标价拿满分没有意义，主结论必须让位给废标提示。
 *
 * 断的是用户能看见的话（置顶红字 / 建议价文案），不是「渲染不抛错」；
 * 同时反向断「合法报价时不许乱报警」，否则天天亮红会让人无视。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { PriceScorePanel } from "./PriceScorePanel"

afterEach(cleanup)

/** 真实语料口径（.diag/r50_tender.txt）：限价 2500 万，价格分 30 分，比值法 */
const RATIO_181 =
  "满足招标文件要求且投标价格最低的投标报价为评标基准价，其价格分为满分。其他投标人的价格分统一按照下列公式计算：投标报价得分＝（评标基准价/投标报价）×价格权值×100"

function panel(ourPrice: string, competitor: string, ratio: string) {
  const activeProject = {
    id: "p1",
    opportunity_id: "",
    global_facts: "最高限价：2500万元",
    parse_report: {
      scope: "full",
      sections: [
        // 行格式须能被 extractScoringFromText 认成评分项：`名称（N分）：评分标准`
        { key: "tech_score", title: "技术评分", content: `价格分（30分）：${RATIO_181}`, status: "ok" },
      ],
    },
  }
  const props = {
    activeProject,
    quoteRefs: [],
    goParseStep: () => {},
  } as unknown as Parameters<typeof PriceScorePanel>[0]
  render(<PriceScorePanel {...props} />)
  return { ourPrice, competitor, ratio }
}

async function fill(ourPrice: string, competitor: string, ratio: string) {
  panel(ourPrice, competitor, ratio)
  const user = userEvent.setup()
  const our = screen.getByLabelText("我方投标报价（元）")
  await user.clear(our)
  if (ourPrice) await user.type(our, ourPrice)
  await user.type(screen.getByLabelText("对手有效报价（每行一个，必手填）"), competitor)
  if (ratio) await user.type(screen.getByLabelText("低于限价该比例按无效标（%，招标文件写了才填）"), ratio)
}

describe("R64 · 价格分面板：现价废标必须置顶", () => {
  it("现价 800 万 < 限价 45%：置顶红字点破，且不再说「无需再降」", async () => {
    await fill("800万", "1200万", "45")
    const warn = screen.getByText(/我方当前报价低于最高限价的 45%/)
    expect(warn).toBeInTheDocument()
    expect(warn.textContent).toContain("按无效投标处理")
    // 主结论里的「满分」仍在（事实如此），但建议价文案必须先解决废标
    expect(screen.getByText(/先解决废标/)).toBeInTheDocument()
    expect(screen.queryByText(/无需再降/)).toBeNull()
  })

  it("现价 2600 万 > 限价 2500 万：超限价同样置顶", async () => {
    await fill("2600万", "1200万", "")
    expect(screen.getByText(/我方当前报价超过最高限价/)).toBeInTheDocument()
    expect(screen.queryByText(/无需再降/)).toBeNull()
  })

  it("现价 1200 万（门槛 1125 万之上）：不报红，照旧给「已拿满价格分」", async () => {
    await fill("1200万", "1500万", "45")
    expect(screen.queryByText(/我方当前报价/)).toBeNull()
    expect(screen.getByText(/已拿满价格分/)).toBeInTheDocument()
  })

  it("没填无效标比例、也没超限价：不报红（门槛没给就不替招标文件假设）", async () => {
    await fill("800万", "1200万", "")
    expect(screen.queryByText(/我方当前报价/)).toBeNull()
  })
})
