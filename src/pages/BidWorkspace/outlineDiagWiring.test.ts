// ---------------------------------------------------------------------------
// R56（B27）接线哨兵：诊断记录必须真的接在「失败/被拦」的每条路径上，且不会变成假成果。
//
// 这一层测的是「来源」而不是「行为」——stop 的是最常见的退化方式：把 recordOutlineDiag 删掉、
// 把恢复守卫挪到 setSnapshotBusyId 之后、把同源中文清单换回旧的错配调用，这些都不影响纯函数单测，
// 但会让线上重新回到「失败不留痕」「点了恢复假报成功」。
// ---------------------------------------------------------------------------
import { hookSources, sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"
import { classifyOutlineFailure } from "./outlineDiagnostics"

// 路径统一为仓库相对 POSIX 路径；读取走单一入口（R57 · 审计 §3.1）。
const COVERAGE = "src/pages/BidWorkspace/parseCoverage.ts"
const PANEL = "src/components/bid-workspace/StageHistoryPanel.tsx"

function region(src: string, from: string, to: string): string {
  const i = src.indexOf(from)
  const j = src.indexOf(to, i + from.length)
  if (i < 0 || j <= i) throw new Error(`定位失败：${from} → ${to}`)
  return src.slice(i, j)
}

describe("R56（B27）失败路径留痕", () => {
  const hook = hookSources()
  const outline = region(hook, "const runGenerateOutline = useCallback", "const generateOutline = useCallback")

  it("该函数里每条 throw 都能被分类：以后新增失败文案不分类就会红", () => {
    const literals = [...outline.matchAll(/throw new Error\(\s*"([^"\\]*)"/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThanOrEqual(3)
    for (const lit of literals) {
      expect(classifyOutlineFailure(new Error(lit)).kind, `未分类的失败文案：${lit}`).not.toBe("unknown")
    }
    // 三条已知文案的分类不许退化成别的档（改了分类等于改了线上提示的归因）
    expect(classifyOutlineFailure(new Error("大纲格式解析失败，请重试")).kind).toBe("json_parse")
    expect(classifyOutlineFailure(new Error("分步大纲未产出技术章，请重试")).kind).toBe("empty_outline")
    expect(classifyOutlineFailure(new Error("大纲生成结果为空，未产出任何章节，请重试")).kind).toBe("empty_outline")
  })

  it("三处预检拦截都留证，且都在 toast 之前（先落库再提示，顺序反了就没证据）", () => {
    for (const kind of ["blocked_no_report", "blocked_dependency", "blocked_critical"]) {
      expect(outline, `缺少拦截留痕：${kind}`).toContain(`recordOutlineDiag("${kind}"`)
    }
    expect(outline.indexOf('recordOutlineDiag("blocked_no_report"')).toBeLessThan(outline.indexOf("请先完成招标文件 AI 解析"))
    expect(outline.indexOf('recordOutlineDiag("blocked_dependency"')).toBeLessThan(outline.indexOf("大纲生成依赖「"))
    expect(outline.indexOf('recordOutlineDiag("blocked_critical"')).toBeLessThan(outline.indexOf("关键解析项缺失："))
  })

  it("catch 里先落诊断记录再走 handleLlmError（toast 关掉就没了，记录是唯一复盘依据）", () => {
    const catchBlock = region(outline, "} catch (e) {", "} finally {")
    expect(catchBlock).toContain("classifyOutlineFailure(e)")
    expect(catchBlock.indexOf("recordOutlineDiag(")).toBeGreaterThan(-1)
    expect(catchBlock.indexOf("recordOutlineDiag(")).toBeLessThan(catchBlock.indexOf("handleLlmError(e"))
  })

  it("记录写入的是 diag 键（面板与恢复守卫据此判定「不是成果快照」）", () => {
    const recorder = region(hook, "const recordOutlineDiag = useCallback", "const runGenerateOutline = useCallback")
    expect(recorder).toContain("outlineDiagLabel(diag)")
    expect(recorder).toContain("[SNAPSHOT_DIAG_KEY]: diag")
    expect(recorder).toContain("shouldRecordOutlineDiag(lastOutlineDiagRef.current, diag)")
  })
})

describe("R56（B27）拦截提示的缺项清单与判据同源", () => {
  const hook = hookSources()
  const coverage = sourceText(COVERAGE)

  it("拦截 toast 用同源中文清单；旧的错配调用已从代码里消失", () => {
    // R58（B28）：判据与清单都按该项目实际请求的 keys 判定——只改一处就会出现
    // 「判缺按作用域、提示名单按全量」的新错配（用户看到的名字与拦截理由不一致）。
    expect(hook).toContain("missingCriticalSectionTitles(cur.parse_report, CRITICAL_SECTION_KEYS, reqKeys)")
    expect(hook).toContain("missingCriticalSections(cur.parse_report.sections, CRITICAL_SECTION_KEYS, reqKeys)")
    expect(hook).not.toContain("missingSectionTitles(cur.parse_report, criticalMissing)")
  })

  it("两个清单函数共用同一个缺失判据（口径不可能再漂移）", () => {
    expect(coverage).toContain("function isSectionMissing(")
    expect(coverage).toContain("return isSectionMissing(byKey.get(k))")
    expect(coverage).toContain(
      "missingCriticalSections(report?.sections ?? [], keys, requestedKeys).map((k) => parseSectionTitle(k))",
    )
  })
})

describe("R56（B27）恢复守卫：非成果行不得被当成可恢复版本", () => {
  it("restoreSnapshot 先判可恢复，再进入恢复流程（顺序反了会先写 busyId 再退出，按钮会闪）", () => {
    const hook = hookSources()
    const restore = region(hook, "const restoreSnapshot = useCallback", "/** 重置项目为初始状态")
    const iGuard = restore.indexOf("isRestorableSnapshot(snap)")
    const iBusy = restore.indexOf("setSnapshotBusyId(snap.id)")
    expect(iGuard).toBeGreaterThan(-1)
    expect(iBusy).toBeGreaterThan(-1)
    expect(iGuard).toBeLessThan(iBusy)
  })

  it("工作记录面板：不可恢复的行不给「恢复此版本」，改标「留痕·不可恢复」，查看弹窗显示诊断正文", () => {
    const panel = sourceText(PANEL)
    expect(panel).toContain("isRestorableSnapshot(snap)")
    expect(panel).toContain("留痕·不可恢复")
    expect(panel).toContain("describeOutlineDiag(previewDiag)")
    expect(panel).toContain("? previewDiag")
  })
})
