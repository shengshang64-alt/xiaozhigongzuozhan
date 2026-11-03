// ---------------------------------------------------------------------------
// 部门检查清单落库层（纯函数；网络调用在 useDeptChecklists / 面板里）
//
// 复用的既有清单引擎（零 schema 变更，理由与边界都写在这里）：
//   集合 checklists（pocketbase/pb_hooks/checklists.pb.js，REST /api/checklists）
//   字段映射：
//     checklist_name   ← 清单表名（如「招标书检查表」）
//     source_mode      ← "dept_check"（本类记录标记；既有值为 rating / customer_match）
//     items (json)     ← 逐行可填结构（序号/检查内容/细则 + 自查·交叉检查的结果·问题记录·检查人）
//     rating_targets (json) ← 扩展元数据整包（表头三字段、两列检查日期、表尾签名栏、检查结果、留痕）
//     hospital / customer_raw / total_amount / status 本类记录留空不使用
//   之所以扩展结构放 rating_targets：既有集合里只有 items / rating_targets 两个 json 列，
//   items 必须是数组（既有建设清单面板按数组渲染），元数据只能另找 json 列承载。
//   代价与防护：建设清单侧列表会显式过滤 source_mode === "dept_check"（checklistLogic.loadMyChecklists），
//   使既有面板永远看不到本类记录的 rating_targets 对象，见该处注释。
//
// 项目级副本：meta.project_id 绑定 bid_projects.id，同一项目同一清单定义只允许一份记录（幂等，
//   见 findDeptCheckDoc）；不同项目互不影响。
// 留痕：既有集合无操作日志字段 → 最小实现=服务端 updated（autodate）+ meta.log（谁/何时/改了什么，
//   上限 DEPT_CHECK_LOG_CAP 条，超出丢最旧）。
// 本模块零 AI、不引用网络与重库（可被单测直接跑）。
// ---------------------------------------------------------------------------

import {
  DEPT_CHECK_KIND,
  DEPT_CHECK_LOG_CAP,
  DEPT_CHECK_SOURCE_MODE,
  buildDeptCheckRows,
  emptyDeptCheckMeta,
  type ChecklistDef,
  type DeptCheckCell,
  type DeptCheckLogEntry,
  type DeptCheckMeta,
  type DeptCheckRow,
  type DeptCheckSignature,
} from "./bidChecklists"

/** 检查组：自查 / 交叉检查（原文两栏） */
export type DeptCheckGroup = "self" | "cross"

export const DEPT_CHECK_GROUP_LABEL: Record<DeptCheckGroup, string> = {
  self: "自查",
  cross: "交叉检查",
}

/** 行内改动的 patch（三列各自可改；undefined = 不动这一列） */
export type DeptCheckCellPatch = Partial<DeptCheckCell>

/** 保存防抖（与既有建设清单行内编辑同口径 500ms） */
export const DEPT_CHECK_SAVE_DEBOUNCE_MS = 500

/** 一条已落库的部门检查清单（解析后的稳定视图） */
export type DeptCheckDoc = {
  id: string
  checklist_name: string
  /** 服务端 autodate（最后保存时间，只读展示） */
  updated: string
  meta: DeptCheckMeta
  rows: DeptCheckRow[]
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v)
}

/** 结果三态收敛：只认原文勾选栏的 √ / ×，其余（含空）一律 "" */
function cellResult(v: unknown): DeptCheckCell["result"] {
  return v === "√" || v === "×" ? v : ""
}

/**
 * 轻量判定：这条 checklists 记录是不是部门检查清单。
 * source_mode 标记优先，rating_targets 里的 kind 兜底（存量记录 source_mode 可能没写全）。
 */
export function isDeptCheckRecord(raw: unknown): boolean {
  const rec = asObj(raw)
  if (!rec) return false
  if (str(rec.source_mode) === DEPT_CHECK_SOURCE_MODE) return true
  const meta = asObj(rec.rating_targets)
  return !!meta && str(meta.kind) === DEPT_CHECK_KIND
}

/** 容错解析扩展元数据：非本类 / 结构不符一律 null（绝不抛错，存量脏数据只当不存在） */
export function parseDeptCheckMeta(v: unknown): DeptCheckMeta | null {
  const m = asObj(v)
  if (!m || str(m.kind) !== DEPT_CHECK_KIND) return null
  const header = asObj(m.header) ?? {}
  const dates = asObj(m.check_dates) ?? {}
  const sigs = asObj(m.signatures) ?? {}
  const sig = (x: unknown): DeptCheckSignature => {
    const s = asObj(x) ?? {}
    return { name: str(s.name), date: str(s.date) }
  }
  const result = str(m.result)
  const log: DeptCheckLogEntry[] = []
  for (const item of Array.isArray(m.log) ? m.log : []) {
    const e = asObj(item)
    if (!e) continue
    log.push({ at: str(e.at), by: str(e.by), what: str(e.what) })
  }
  return {
    v: 1,
    kind: DEPT_CHECK_KIND,
    def_key: str(m.def_key),
    project_id: str(m.project_id),
    header: {
      projectName: str(header.projectName),
      owner: str(header.owner),
      difficulty: str(header.difficulty),
    },
    check_dates: { self: str(dates.self), cross: str(dates.cross) },
    signatures: { self: sig(sigs.self), cross: sig(sigs.cross) },
    revise_reason: str(m.revise_reason),
    result: result === "ready" || result === "revise" ? result : "",
    log: log.slice(0, DEPT_CHECK_LOG_CAP),
  }
}

/** 容错解析可填行：只认带 rid / content 的对象；缺失的填写格补空（不因为是脏数据就整份丢） */
export function parseDeptCheckRows(v: unknown): DeptCheckRow[] {
  if (!Array.isArray(v)) return []
  const cell = (x: unknown): DeptCheckCell => {
    const c = asObj(x) ?? {}
    return { result: cellResult(c.result), note: str(c.note), checker: str(c.checker) }
  }
  const out: DeptCheckRow[] = []
  for (const item of v) {
    const r = asObj(item)
    if (!r) continue
    const rid = str(r.rid)
    const content = str(r.content)
    if (!rid || !content) continue
    out.push({
      rid,
      no: str(r.no),
      content,
      detail: str(r.detail),
      ...(r.section === true ? { section: true as const } : {}),
      self: cell(r.self),
      cross: cell(r.cross),
    })
  }
  return out
}

/** 解析一条记录为面板可用视图：非本类记录 / 元数据坏 → null */
export function readDeptCheckDoc(raw: unknown): DeptCheckDoc | null {
  if (!isDeptCheckRecord(raw)) return null
  const rec = asObj(raw)
  if (!rec) return null
  const meta = parseDeptCheckMeta(rec.rating_targets)
  if (!meta || !meta.def_key) return null
  return {
    id: str(rec.id),
    checklist_name: str(rec.checklist_name),
    updated: str(rec.updated),
    meta,
    rows: parseDeptCheckRows(rec.items),
  }
}

/**
 * 幂等核心：本项目 + 本清单定义 是否已导入。
 * 重复点击「导入为本项目清单」不会堆积第二条（同名不重复）。
 */
export function findDeptCheckDoc(docs: DeptCheckDoc[], projectId: string, defKey: string): DeptCheckDoc | null {
  return docs.find((d) => d.meta.project_id === projectId && d.meta.def_key === defKey) ?? null
}

/** 首次导入的 POST body（既有 checklists 字段，零新增字段） */
export function buildDeptCheckCreateBody(
  def: ChecklistDef,
  projectId: string,
  projectName: string,
  uid: string,
): Record<string, unknown> {
  return {
    rh_user_id: uid,
    checklist_name: def.title,
    source_mode: DEPT_CHECK_SOURCE_MODE,
    items: buildDeptCheckRows(def),
    rating_targets: emptyDeptCheckMeta(def, projectId, projectName),
    hospital: "",
    customer_raw: "",
    total_amount: 0,
    status: "",
  }
}

/** PATCH body：本类记录只动这两列（其余列保持既有值不动） */
export function buildDeptCheckPatchBody(doc: DeptCheckDoc): Record<string, unknown> {
  return { items: doc.rows, rating_targets: doc.meta }
}

/** 行内改动：按 rid 定位（序号在组内重复，不能当主键） */
export function applyDeptCheckRowPatch(
  rows: DeptCheckRow[],
  rid: string,
  group: DeptCheckGroup,
  patch: DeptCheckCellPatch,
): DeptCheckRow[] {
  return rows.map((r) => (r.rid === rid ? { ...r, [group]: { ...r[group], ...patch } } : r))
}

/** 表头三字段 */
export function withDeptCheckHeader(
  meta: DeptCheckMeta,
  field: keyof DeptCheckMeta["header"],
  value: string,
): DeptCheckMeta {
  return { ...meta, header: { ...meta.header, [field]: value } }
}

/** 表头「检查日期：」（自查 / 交叉检查各一个） */
export function withDeptCheckDate(meta: DeptCheckMeta, group: DeptCheckGroup, value: string): DeptCheckMeta {
  return { ...meta, check_dates: { ...meta.check_dates, [group]: value } }
}

/** 表尾签名栏 */
export function withDeptCheckSignature(
  meta: DeptCheckMeta,
  group: DeptCheckGroup,
  patch: Partial<DeptCheckSignature>,
): DeptCheckMeta {
  return { ...meta, signatures: { ...meta.signatures, [group]: { ...meta.signatures[group], ...patch } } }
}

/** 表尾检查结果（可以送出 / 重新修改）与修改原因 */
export function withDeptCheckResult(meta: DeptCheckMeta, result: DeptCheckMeta["result"]): DeptCheckMeta {
  return { ...meta, result }
}

export function withDeptCheckReviseReason(meta: DeptCheckMeta, value: string): DeptCheckMeta {
  return { ...meta, revise_reason: value }
}

/** 追加留痕（最新在前，超上限丢最旧） */
export function pushDeptCheckLog(meta: DeptCheckMeta, entries: DeptCheckLogEntry[]): DeptCheckMeta {
  const kept = entries.filter((e) => e.what)
  if (!kept.length) return meta
  return { ...meta, log: [...kept, ...meta.log].slice(0, DEPT_CHECK_LOG_CAP) }
}

function clip(s: string, n = 40): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** 行内改动的留痕文案：「自查：结果「√」 · 文件命名是否规范」 */
export function describeDeptCheckRowChange(row: DeptCheckRow, group: DeptCheckGroup, patch: DeptCheckCellPatch): string {
  const parts: string[] = []
  if (patch.result !== undefined) parts.push(`结果「${patch.result || "未判定"}」`)
  if (patch.note !== undefined) parts.push(patch.note ? "问题记录已填写" : "问题记录已清空")
  if (patch.checker !== undefined) parts.push(`检查人「${patch.checker || "未填"}」`)
  if (!parts.length) return ""
  return `${DEPT_CHECK_GROUP_LABEL[group]}：${parts.join("、")} · ${clip(row.content, 30)}`
}

/** 表头 / 日期 / 签名 / 表尾改动的留痕文案 */
export function describeDeptCheckMetaChange(label: string, value: string): string {
  return value ? `${label}「${clip(value, 40)}」` : `${label}已清空`
}

/** 进度统计：√ / × / 未判定（分区行不计入） */
export function deptCheckProgress(rows: DeptCheckRow[]): { pass: number; fail: number; pending: number; total: number } {
  let pass = 0
  let fail = 0
  let pending = 0
  for (const r of rows) {
    if (r.section) continue
    for (const g of ["self", "cross"] as DeptCheckGroup[]) {
      const v = r[g].result
      if (v === "√") pass += 1
      else if (v === "×") fail += 1
      else pending += 1
    }
  }
  return { pass, fail, pending, total: pass + fail + pending }
}
