/**
 * 部门检查清单落库层单测（node 环境，纯函数，零 AI、不触网）。
 *
 * 守三件事：
 *  ① 复用既有 checklists 集合、不改 schema：POST body 的字段名必须全部落在既有字段表内；
 *  ② 幂等：同项目 + 同清单定义只认一份记录（重复导入不堆积）；
 *  ③ 容错：存量脏数据（换了一份 JSON、缺字段）不能让面板崩，只当不存在。
 */
import { describe, expect, it } from "vitest"
import {
  DEPT_CHECK_SAVE_DEBOUNCE_MS,
  applyDeptCheckRowPatch,
  buildDeptCheckCreateBody,
  buildDeptCheckPatchBody,
  deptCheckProgress,
  describeDeptCheckMetaChange,
  describeDeptCheckRowChange,
  findDeptCheckDoc,
  isDeptCheckRecord,
  parseDeptCheckMeta,
  parseDeptCheckRows,
  pushDeptCheckLog,
  readDeptCheckDoc,
  withDeptCheckDate,
  withDeptCheckHeader,
  withDeptCheckResult,
  withDeptCheckReviseReason,
  withDeptCheckSignature,
  type DeptCheckDoc,
} from "./bidChecklistStore"
import { DEPT_CHECK_LOG_CAP, buildDeptCheckRows, deptChecklistDef, emptyDeptCheckMeta } from "./bidChecklists"

/** 既有 checklists 集合的全部字段（pb_hooks/checklists.pb.js）——本类记录不得写入此外的字段 */
const CHECKLISTS_FIELDS = [
  "rh_user_id",
  "checklist_name",
  "hospital",
  "rating_targets",
  "source_mode",
  "customer_raw",
  "items",
  "total_amount",
  "status",
]

const tenderDef = deptChecklistDef("tender")!
const solDef = deptChecklistDef("sol")!

/** 模拟 PocketBase 建记录后的响应（含 autodate） */
function fakeSavedRecord(body: Record<string, unknown>, id = "rec1", updated = "2026-10-16 09:30:00.000Z") {
  return { id, ...body, created: updated, updated }
}

function docOf(projectId: string, defKey = "tender", id = "rec1"): DeptCheckDoc {
  const def = deptChecklistDef(defKey)!
  return {
    id,
    checklist_name: def.title,
    updated: "2026-10-16 09:30:00.000Z",
    meta: emptyDeptCheckMeta(def, projectId, "某医院项目"),
    rows: buildDeptCheckRows(def),
  }
}

describe("bidChecklistStore：复用既有集合、零 schema 变更", () => {
  it("POST body 只使用既有 checklists 字段", () => {
    const body = buildDeptCheckCreateBody(tenderDef, "proj1", "某医院项目", "user1")
    expect(Object.keys(body).sort()).toEqual([...CHECKLISTS_FIELDS].sort())
    expect(body.source_mode).toBe("dept_check")
    expect(body.checklist_name).toBe("招标书检查表")
    expect(body.rating_targets).toMatchObject({ kind: "dept_check", project_id: "proj1", def_key: "tender" })
    expect((body.items as unknown[]).length).toBe(tenderDef.items.length)
  })

  it("PATCH body 只动 items + rating_targets（不碰建设清单用的其它列）", () => {
    const body = buildDeptCheckPatchBody(docOf("proj1"))
    expect(Object.keys(body).sort()).toEqual(["items", "rating_targets"])
  })

  it("建记录响应能原样解析回面板视图（往返一致）", () => {
    const def = solDef
    const body = buildDeptCheckCreateBody(def, "proj9", "某医院项目", "user1")
    const doc = readDeptCheckDoc(fakeSavedRecord(body))
    expect(doc).not.toBeNull()
    expect(doc!.meta.project_id).toBe("proj9")
    expect(doc!.meta.header.projectName).toBe("某医院项目")
    expect(doc!.rows).toEqual(buildDeptCheckRows(def))
    expect(doc!.updated).toBe("2026-10-16 09:30:00.000Z")
  })

  it("防抖常量与既有建设清单同口径（500ms）", () => {
    expect(DEPT_CHECK_SAVE_DEBOUNCE_MS).toBe(500)
  })
})

describe("bidChecklistStore：幂等（同项目同名不重复堆积）", () => {
  it("同项目 + 同清单定义只认一份；不同项目 / 不同清单互不影响", () => {
    const a = docOf("proj1", "tender", "r1")
    const b = docOf("proj1", "bid", "r2")
    const c = docOf("proj2", "tender", "r3")
    const docs = [a, b, c]
    expect(findDeptCheckDoc(docs, "proj1", "tender")?.id).toBe("r1")
    expect(findDeptCheckDoc(docs, "proj1", "bid")?.id).toBe("r2")
    expect(findDeptCheckDoc(docs, "proj2", "tender")?.id).toBe("r3")
    expect(findDeptCheckDoc(docs, "proj2", "sol")).toBeNull()
  })

  it("识别本类记录：source_mode 标记或 rating_targets.kind 任一命中", () => {
    expect(isDeptCheckRecord({ source_mode: "dept_check" })).toBe(true)
    expect(isDeptCheckRecord({ source_mode: "", rating_targets: { kind: "dept_check" } })).toBe(true)
    expect(isDeptCheckRecord({ source_mode: "rating", rating_targets: ["emr:5"] })).toBe(false)
    expect(isDeptCheckRecord(null)).toBe(false)
    expect(isDeptCheckRecord("x")).toBe(false)
  })

  it("建设清单记录（rating/customer_match）不会被误读成本类文档", () => {
    expect(readDeptCheckDoc({ id: "x", source_mode: "rating", rating_targets: ["emr:5"], items: [] })).toBeNull()
  })
})

describe("bidChecklistStore：容错解析（脏数据不崩）", () => {
  it("元数据非对象 / kind 不符 / 字段缺失 → null 或补空", () => {
    expect(parseDeptCheckMeta(null)).toBeNull()
    expect(parseDeptCheckMeta([])).toBeNull()
    expect(parseDeptCheckMeta({ kind: "other" })).toBeNull()
    const meta = parseDeptCheckMeta({ kind: "dept_check", def_key: "tender" })
    expect(meta).not.toBeNull()
    expect(meta!.header).toEqual({ projectName: "", owner: "", difficulty: "" })
    expect(meta!.signatures.cross).toEqual({ name: "", date: "" })
    expect(meta!.result).toBe("")
    expect(meta!.log).toEqual([])
  })

  it("结果只认 √ / ×（脏值收敛为空），留痕数组带脏项时跳过脏项", () => {
    const rows = parseDeptCheckRows([
      { rid: "r1", content: "x", self: { result: "√", note: "n", checker: "c" }, cross: { result: "pass" } },
      { rid: "", content: "缺 rid" },
      { content: "缺 rid 与对象" } as unknown,
      null,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].self).toEqual({ result: "√", note: "n", checker: "c" })
    expect(rows[0].cross).toEqual({ result: "", note: "", checker: "" })
    expect(parseDeptCheckRows({ not: "array" })).toEqual([])
  })

  it("留痕上限：超出丢最旧（最新在前）", () => {
    let meta = emptyDeptCheckMeta(tenderDef, "proj1", "p")
    const entries = Array.from({ length: DEPT_CHECK_LOG_CAP + 5 }, (_, i) => ({
      at: `2026-10-16T00:00:${String(i).padStart(2, "0")}.000Z`,
      by: "张三",
      what: `改动${i}`,
    }))
    meta = pushDeptCheckLog(meta, entries)
    expect(meta.log).toHaveLength(DEPT_CHECK_LOG_CAP)
    expect(meta.log[0].what).toBe("改动0")
    expect(meta.log.at(-1)!.what).toBe("改动49")
    // 空文案不入留痕
    expect(pushDeptCheckLog(meta, [{ at: "x", by: "y", what: "" }])).toBe(meta)
  })
})

describe("bidChecklistStore：行内改动与表头/日期/签名/表尾", () => {
  it("按 rid 定位，只改目标行与目标组", () => {
    const rows = buildDeptCheckRows(tenderDef)
    const target = rows[3]
    const next = applyDeptCheckRowPatch(rows, target.rid, "cross", { result: "×", note: "封面有公司旧名", checker: "李四" })
    expect(next[3].cross).toEqual({ result: "×", note: "封面有公司旧名", checker: "李四" })
    expect(next[3].self).toEqual({ result: "", note: "", checker: "" })
    expect(next[2].cross).toEqual({ result: "", note: "", checker: "" })
    // 未命中 rid 时整表原样返回（不静默改错行）
    expect(applyDeptCheckRowPatch(rows, "不存在", "self", { result: "√" })).toEqual(rows)
  })

  it("表头 / 检查日期 / 签名 / 检查结果 / 修改原因各自可改，且不改动其它字段", () => {
    let meta = emptyDeptCheckMeta(tenderDef, "proj1", "p")
    meta = withDeptCheckHeader(meta, "owner", "王五")
    expect(meta.header.owner).toBe("王五")
    expect(meta.header.projectName).toBe("p")
    meta = withDeptCheckDate(meta, "cross", "2026-10-20")
    expect(meta.check_dates).toEqual({ self: "", cross: "2026-10-20" })
    meta = withDeptCheckSignature(meta, "cross", { name: "李四", date: "2026-10-20" })
    expect(meta.signatures.cross).toEqual({ name: "李四", date: "2026-10-20" })
    expect(meta.signatures.self).toEqual({ name: "", date: "" })
    meta = withDeptCheckResult(meta, "ready")
    expect(meta.result).toBe("ready")
    meta = withDeptCheckReviseReason(meta, "第 3 条整改中")
    expect(meta.revise_reason).toBe("第 3 条整改中")
  })

  it("进度统计：√ 通过 / × 不通过 / 空 待判定，分区行不计", () => {
    let rows = buildDeptCheckRows(tenderDef)
    // 10 条目 × 2 组 = 20 格
    expect(deptCheckProgress(rows).total).toBe(20)
    expect(deptCheckProgress(rows)).toEqual({ pass: 0, fail: 0, pending: 20, total: 20 })
    rows = applyDeptCheckRowPatch(rows, rows[1].rid, "self", { result: "√" })
    rows = applyDeptCheckRowPatch(rows, rows[2].rid, "cross", { result: "×" })
    expect(deptCheckProgress(rows)).toEqual({ pass: 1, fail: 1, pending: 18, total: 20 })
  })

  it("留痕文案：写清组别、改了什么与条目名；清空也算一次改动", () => {
    const row = buildDeptCheckRows(tenderDef)[1]
    expect(describeDeptCheckRowChange(row, "self", { result: "√" })).toBe("自查：结果「√」 · 文件命名是否规范")
    expect(describeDeptCheckRowChange(row, "cross", { result: "" })).toBe("交叉检查：结果「未判定」 · 文件命名是否规范")
    expect(describeDeptCheckRowChange(row, "self", { note: "封面用了旧院名" })).toBe(
      "自查：问题记录已填写 · 文件命名是否规范",
    )
    expect(describeDeptCheckRowChange(row, "self", { checker: "王五" })).toBe("自查：检查人「王五」 · 文件命名是否规范")
    expect(describeDeptCheckRowChange(row, "self", {})).toBe("")
    expect(describeDeptCheckMetaChange("项目名称", "某医院项目")).toBe("项目名称「某医院项目」")
    expect(describeDeptCheckMetaChange("难度系数", "")).toBe("难度系数已清空")
  })
})
