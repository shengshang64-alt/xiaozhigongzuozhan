import { describe, expect, it } from "vitest"
import { placeholderLeftoverCount } from "./placeholderLedger"
import { buildIncompleteWorkSummary } from "./incompleteWork"
import type { ScoreCheckup } from "./scoreCoverageCheckup"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const emptyScore: ScoreCheckup = {
  hasScoring: false,
  techTotal: 0,
  techLanded: 0,
  techMissing: 0,
  rows: [],
  missingRows: [],
}

function ch(title: string, content: string): Chapter {
  return { id: title, node_id: title, title, content } as Chapter
}

describe("placeholderLeftoverCount / buildIncompleteWorkSummary", () => {
  it("空章节且无评分表、无参数行时三项都视为完成", () => {
    const items = buildIncompleteWorkSummary({
      chapters: [],
      scoreCheckup: emptyScore,
      deviationUncovered: 0,
      deviationTotal: 0,
    })
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.done)).toBe(true)
    expect(placeholderLeftoverCount([])).toBe(0)
  })

  it("正文【待填写】按处数累计", () => {
    const chapters = [ch("实施", "进度计划【待填写】，联系人【待填写】")]
    expect(placeholderLeftoverCount(chapters)).toBe(2)
    const items = buildIncompleteWorkSummary({
      chapters,
      scoreCheckup: emptyScore,
      deviationUncovered: 0,
      deviationTotal: 0,
    })
    const ph = items.find((i) => i.key === "placeholder")!
    expect(ph.done).toBe(false)
    expect(ph.count).toBe(2)
    expect(ph.detail).toContain("2 处")
    expect(ph.step).toBe(4)
  })

  it("未覆盖评分点给出项数、差的分和优先名称", () => {
    const checkup: ScoreCheckup = {
      hasScoring: true,
      techTotal: 20,
      techLanded: 8,
      techMissing: 12,
      rows: [],
      missingRows: [
        { id: "R1", name: "售后服务", score: 8, subjective: true, covered: false, coveredBy: [] },
        { id: "R2", name: "技术培训", score: 4, subjective: true, covered: false, coveredBy: [] },
      ],
    }
    const items = buildIncompleteWorkSummary({
      chapters: [],
      scoreCheckup: checkup,
      deviationUncovered: 0,
      deviationTotal: 0,
    })
    const score = items.find((i) => i.key === "score")!
    expect(score.done).toBe(false)
    expect(score.count).toBe(2)
    expect(score.detail).toContain("差 12 分")
    expect(score.detail).toContain("售后服务")
    expect(score.detail).toContain("技术培训")
  })

  it("偏离表未应答计入第 5 步；无参数行不挡", () => {
    const open = buildIncompleteWorkSummary({
      chapters: [],
      scoreCheckup: emptyScore,
      deviationUncovered: 4,
      deviationTotal: 20,
    }).find((i) => i.key === "deviation")!
    expect(open.done).toBe(false)
    expect(open.count).toBe(4)
    expect(open.detail).toBe("未应答 4 / 20 项")
    expect(open.step).toBe(5)

    const none = buildIncompleteWorkSummary({
      chapters: [],
      scoreCheckup: emptyScore,
      deviationUncovered: 0,
      deviationTotal: 0,
    }).find((i) => i.key === "deviation")!
    expect(none.done).toBe(true)
  })
})
