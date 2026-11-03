// ---------------------------------------------------------------------------
// R56（B27）快照可恢复契约。
//
// 背景：bid_stage_snapshots 同时承载「可恢复成果」与「环节事件留痕」。真实库 255 条里有 3 条
// chapter 事件行 payload 为空（`{}`）——它们此前靠 restoreSnapshot 里的 chId 检查侥幸没造成后果，
// 但提示文案是「该快照对应的章节已不在当前大纲中」，把「本来就没有成果」说成了「章节没了」。
// 本轮新增的大纲失败诊断行（stage=outline）没有这层侥幸：不判可恢复就会假报「已恢复该历史版本」，
// 勾了「同时清空下游产物」还会清空正文与各报告。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { SNAPSHOT_DIAG_KEY, hasSnapshotDiag, isRestorableSnapshot } from "./bidTypes"

const snap = (stage: string, payload: Record<string, unknown> | null) => ({ stage, payload })

describe("R56（B27）isRestorableSnapshot：有成果才可恢复", () => {
  it("各 stage 的正常成果行可恢复", () => {
    expect(isRestorableSnapshot(snap("parse", { parse_report: { sections: [] } }))).toBe(true)
    expect(isRestorableSnapshot(snap("outline", { outline: [{ title: "第一章" }] }))).toBe(true)
    expect(isRestorableSnapshot(snap("chapter", { chapter_id: "n1", content: "正文" }))).toBe(true)
    expect(isRestorableSnapshot(snap("chapter", { chapter_id: "n1", content: "" }))).toBe(true) // 恢复到「该章未生成」是合法意图
    expect(isRestorableSnapshot(snap("check", { void_check: { items: [] } }))).toBe(true) // 三项各自独立留档
    expect(isRestorableSnapshot(snap("check", { submission_check: { items: [] } }))).toBe(true)
    expect(isRestorableSnapshot(snap("eval", { ai_review: { score: 1 } }))).toBe(true)
    expect(isRestorableSnapshot(snap("reset", { chapters: [{ node_id: "n1" }] }))).toBe(true)
  })

  it("空/缺成果键的行不可恢复（真实库那 3 条 chapter 事件行就是这个形状）", () => {
    expect(isRestorableSnapshot(snap("chapter", {}))).toBe(false)
    expect(isRestorableSnapshot(snap("chapter", { content: "有正文但没章节 id，恢复会报错" }))).toBe(false)
    expect(isRestorableSnapshot(snap("outline", { outline: [] }))).toBe(false)
    expect(isRestorableSnapshot(snap("outline", {}))).toBe(false)
    expect(isRestorableSnapshot(snap("parse", null))).toBe(false)
    expect(isRestorableSnapshot(snap("eval", { ai_review: null }))).toBe(false)
    expect(isRestorableSnapshot(snap("check", {}))).toBe(false)
    expect(isRestorableSnapshot(snap("不认识的stage", { anything: 1 }))).toBe(false)
  })

  it("带诊断留痕的行一律不可恢复，哪怕同 payload 里还带着成果键", () => {
    expect(isRestorableSnapshot(snap("outline", { [SNAPSHOT_DIAG_KEY]: { kind: "timeout" } }))).toBe(false)
    expect(isRestorableSnapshot(snap("outline", { outline: [{ title: "x" }], [SNAPSHOT_DIAG_KEY]: { kind: "timeout" } }))).toBe(
      false,
    )
  })

  it("hasSnapshotDiag 只认对象形态（字符串/数字不当诊断）", () => {
    expect(hasSnapshotDiag({ [SNAPSHOT_DIAG_KEY]: { kind: "auth" } })).toBe(true)
    expect(hasSnapshotDiag({ [SNAPSHOT_DIAG_KEY]: "auth" })).toBe(false)
    expect(hasSnapshotDiag({ [SNAPSHOT_DIAG_KEY]: 1 })).toBe(false)
    expect(hasSnapshotDiag({})).toBe(false)
    expect(hasSnapshotDiag(null)).toBe(false)
  })
})
