// ---------------------------------------------------------------------------
// 2026-10-27 诊断固化：解析质量的决定因素不是字数限制，是模型可用性
//
// 起因：用户要求「把大文件解析搬到后端」，我原以为是 wholeParse.ts 的四条字数上限
// （WHOLE_FILE_LIMIT=60000 / PARSE_MAX_SEGMENTS=20 等）导致素材丢失。
//
// 实测后**推翻了这个假设**：
//   ① 前端切段其实没丢内容：76 万字 ÷ 4.5 万字/段 = 17 段，仍在 24 段上限内，全覆盖。
//   ② 真实库统计（31 个项目）显示真正分界线是「AI 解析是否降级」：
//        有降级的 5 个项目：平均 30.8 万字 → 解析 3.1 万字，提取率 14.0%
//        无降级的 26 个项目：平均 15.1 万字 → 解析 3.9 万字，提取率 30.7%
//   ③ 降级触发条件是 `msg` 非空（模型调用失败），代码位置 useBidWorkspace.ts:4073。
//   ④ 直接实测工作站网关 8 个模型：**7 个报 model_disabled，1 个欠费 402**。
//
// 结论：解析质量差的根因是**模型不可用导致降级**，不是字数限制。
//      在这个前提下把解析搬到后端，收益为零（切段能力本就不缺）。
//
// 本测试把「降级 → 提取率腰斩」这个关系钉死，防止以后有人再往字数上限方向找原因。
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))
const HAS_DB = existsSync(DB_PATH)

describe.skipIf(!HAS_DB)("解析质量：降级项目 vs 正常项目", () => {
  it("有 AI 降级的项目，提取率显著低于正常项目", () => {
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    const rows = db
      .prepare("select project_name, tender_text, parse_report from bid_projects where parse_report is not null and tender_text is not null")
      .all() as { project_name: string; tender_text: string; parse_report: string }[]

    const degraded: number[] = []
    const normal: number[] = []
    for (const r of rows) {
      let pr: { sections?: { content?: string }[]; warnings?: string[] }
      try {
        pr = JSON.parse(r.parse_report) as typeof pr
      } catch {
        continue
      }
      const tenderChars = String(r.tender_text).length
      if (!tenderChars) continue
      const parsedChars = (pr.sections ?? []).reduce((a, s) => a + String(s.content ?? "").length, 0)
      const ratio = parsedChars / tenderChars
      const ws: string[] = pr.warnings ?? []
      const isDegraded = ws.some((w) => w.includes("未完成") && w.includes("降级"))
      ;(isDegraded ? degraded : normal).push(ratio)
    }

    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
    const dAvg = avg(degraded)
    const nAvg = avg(normal)

    console.log(`[解析质量] 降级项目 ${degraded.length} 个，平均提取率 ${(dAvg * 100).toFixed(1)}%`)
    console.log(`[解析质量] 正常项目 ${normal.length} 个，平均提取率 ${(nAvg * 100).toFixed(1)}%`)

    // 不变量：两者的存在性（数据会变，具体倍数不断言）
    expect(rows.length).toBeGreaterThan(0)
    // 若两组都有样本，降级组应更低（这是本诊断的核心结论）
    if (degraded.length > 0 && normal.length > 0) {
      expect(dAvg, "降级项目提取率不应高于正常项目（若相反说明判据或数据变了，需重新诊断）").toBeLessThan(nAvg)
    }
  }, 180000)

  it("切段能力核算：真实标书在前端 24 段上限内是否被覆盖完整", () => {
    // 前端常量（与 wholeParse.ts 对齐）
    const PARSE_SEGMENT_CHARS = 45000
    const PARSE_MAX_SEGMENTS_CRITICAL = 24
    const maxCoverChars = PARSE_SEGMENT_CHARS * PARSE_MAX_SEGMENTS_CRITICAL // 108 万字

    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    const rows = db.prepare("select project_name, length(tender_text) as n from bid_projects where tender_text is not null").all() as {
      project_name: string
      n: number
    }[]

    const overLimit = rows.filter((r) => r.n > maxCoverChars)
    const maxLen = Math.max(...rows.map((r) => r.n))
    console.log(`[切段核算] 前端理论上限覆盖 ${maxCoverChars.toLocaleString()} 字；库内最长标书 ${maxLen.toLocaleString()} 字`)
    console.log(`[切段核算] 超出上限的项目：${overLimit.length} 个`)
    for (const r of overLimit) console.log(`  ${r.project_name} ${r.n.toLocaleString()} 字`)

    // 结论性断言：当前真实语料没有一例超出切段上限 → 字数不是瓶颈
    expect(overLimit.length, `有 ${overLimit.length} 个项目真的超出切段上限，那字数才是瓶颈`).toBe(0)
  }, 180000)
})
