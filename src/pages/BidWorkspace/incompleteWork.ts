// 交卷前「还没写完」总览：待填写、未覆盖评分点、偏离表未应答。
// 纯本地派生，不造假数；没有评分表或参数行时该项视为无需处理，不挡交卷。
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { placeholderLeftoverCount } from "./placeholderLedger"
import type { ScoreCheckup } from "./scoreCoverageCheckup"

export type IncompleteWorkItem = {
  key: "placeholder" | "score" | "deviation"
  done: boolean
  count: number
  detail: string
  step: 4 | 5
}

export function buildIncompleteWorkSummary(input: {
  chapters: Chapter[] | null | undefined
  scoreCheckup: ScoreCheckup
  deviationUncovered: number
  deviationTotal: number
}): IncompleteWorkItem[] {
  const chapters = input.chapters ?? []
  const ph = placeholderLeftoverCount(chapters)
  const checkup = input.scoreCheckup
  const missing = checkup.hasScoring ? checkup.missingRows : []
  const names = missing.slice(0, 3).map((r) => r.name.trim()).filter(Boolean)
  const devUnc = input.deviationUncovered
  const devTotal = input.deviationTotal

  const scoreDetail = !checkup.hasScoring
    ? "暂无评分表，此项不用处理"
    : missing.length === 0
      ? `评分点已全部落点（${checkup.techLanded}/${checkup.techTotal} 分）`
      : `未覆盖 ${missing.length} 项，差 ${checkup.techMissing} 分` + (
        names.length ? `：${names.join("、")}${missing.length > 3 ? " 等" : ""}` : ""
      )

  const devDetail = devTotal === 0
    ? "暂无技术参数行，此项不用处理"
    : devUnc === 0
      ? `偏离表已覆盖 ${devTotal} 项`
      : `未应答 ${devUnc} / ${devTotal} 项`

  return [
    {
      key: "placeholder",
      done: ph === 0,
      count: ph,
      detail: ph === 0 ? "正文没有未填的【待填写】" : `正文还有 ${ph} 处【待填写】`,
      step: 4,
    },
    {
      key: "score",
      done: !checkup.hasScoring || missing.length === 0,
      count: missing.length,
      detail: scoreDetail,
      step: 4,
    },
    {
      key: "deviation",
      done: devTotal === 0 || devUnc === 0,
      count: devUnc,
      detail: devDetail,
      step: 5,
    },
  ]
}
