import { ClipboardList, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CHECKLIST_DEFS, deptCheckEntryCount, deptCheckRowTotal, type ChecklistDef } from "@/pages/BidWorkspace/bidChecklists"
import {
  DEPT_CHECK_GROUP_LABEL,
  deptCheckProgress,
  findDeptCheckDoc,
  type DeptCheckCellPatch,
  type DeptCheckDoc,
  type DeptCheckGroup,
} from "@/pages/BidWorkspace/bidChecklistStore"
import { useDeptChecklists, type UseDeptChecklists } from "@/pages/BidWorkspace/useDeptChecklists"

// ---------------------------------------------------------------------------
// 部门检查清单面板（标书工作台第 5 步 · 交卷前检查区）
//
// 三份清单（招标书 / 投标文件 / 解决方案）原样导入：勾选结果 + 问题记录 + 检查人 + 检查日期
// + 交叉检查同四列 + 表尾签名栏，全部人工填写、零 AI、不做自动判定（自动判定是后续批次）。
// 一键「导入为本项目清单」→ 落既有 checklists 集合，项目级副本、同名幂等（见 bidChecklistStore）。
// 结果列照原表手写勾选栏：√ 通过 / × 不通过 / 空 未判定，问题记录列写备注。
// ---------------------------------------------------------------------------

const RESULT_LABEL: Record<"√" | "×", string> = { "√": "通过", "×": "不通过" }

/** 表头栏名（原文 r3：自查检查 / 交叉检查）——与留痕文案用的组别名（自查 / 交叉检查）区分开 */
const COLUMN_GROUP_LABEL: Record<DeptCheckGroup, string> = { self: "自查检查", cross: "交叉检查" }

const GROUP_ORDER: DeptCheckGroup[] = ["self", "cross"]

/** 结果两态按钮（点中态再点一次=取消，回到「未判定」） */
function ResultToggle({
  value,
  group,
  content,
  locked,
  onChange,
}: {
  value: "" | "√" | "×"
  group: DeptCheckGroup
  content: string
  locked: boolean
  onChange: (next: "" | "√" | "×") => void
}) {
  const gl = DEPT_CHECK_GROUP_LABEL[group]
  const btn = (mark: "√" | "×") => {
    const active = value === mark
    return (
      <button
        key={mark}
        type="button"
        disabled={locked}
        aria-pressed={active}
        aria-label={`${gl}${RESULT_LABEL[mark]}：${content}`}
        title={`${gl}${RESULT_LABEL[mark]}`}
        onClick={() => onChange(active ? "" : mark)}
        aria-disabled={locked}
        className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
          active
            ? mark === "√"
              ? "border-primary bg-primary/15 text-primary"
              : "border-destructive bg-destructive/10 text-destructive"
            : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
        }`}
      >
        {mark}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      {btn("√")}
      {btn("×")}
    </div>
  )
}

/** 一组检查列（结果 / 问题记录 / 检查人），自查与交叉检查共用 */
function GroupCells({
  doc,
  rid,
  content,
  group,
  locked,
  api,
}: {
  doc: DeptCheckDoc
  rid: string
  content: string
  group: DeptCheckGroup
  locked: boolean
  api: UseDeptChecklists
}) {
  const row = doc.rows.find((r) => r.rid === rid)
  const cell = row?.[group]
  if (!cell) return null
  const gl = DEPT_CHECK_GROUP_LABEL[group]
  const patch = (p: DeptCheckCellPatch) => api.setRow(doc, rid, group, p)
  return (
    <>
      <td className="border border-border/70 px-2 py-1.5 align-top">
        <ResultToggle value={cell.result} group={group} content={content} locked={locked} onChange={(next) => patch({ result: next })} />
      </td>
      <td className="border border-border/70 px-2 py-1.5 align-top">
        <Input
          value={cell.note}
          disabled={locked}
          onChange={(e) => patch({ note: e.target.value })}
          placeholder="问题记录"
          aria-label={`${gl}问题记录：${content}`}
          className="h-7 min-w-[8rem] text-xs"
        />
      </td>
      <td className="border border-border/70 px-2 py-1.5 align-top">
        <Input
          value={cell.checker}
          disabled={locked}
          onChange={(e) => patch({ checker: e.target.value })}
          placeholder="检查人"
          aria-label={`${gl}检查人：${content}`}
          className="h-7 min-w-[5rem] text-xs"
        />
      </td>
    </>
  )
}

/** 一份已导入的清单：表头三字段 + 两列检查日期 + 逐行表格 + 表尾签名栏 + 留痕 */
function DeptChecklistCard({
  def,
  doc,
  api,
  locked,
}: {
  def: ChecklistDef
  doc: DeptCheckDoc
  api: UseDeptChecklists
  locked: boolean
}) {
  const meta = doc.meta
  const progress = deptCheckProgress(doc.rows)
  const recent = (meta.log ?? []).slice(0, 5)
  return (
    <details open className="rounded-xl border border-border bg-card shadow-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
        <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold text-foreground">{def.title}</span>
        <Badge variant="success" className="rounded-full">
          通过 {progress.pass}
        </Badge>
        {progress.fail > 0 && (
          <Badge variant="danger" className="rounded-full">
            不通过 {progress.fail}
          </Badge>
        )}
        {progress.pending > 0 && (
          <Badge variant="warning" className="rounded-full">
            待判定 {progress.pending}
          </Badge>
        )}
        {locked && (
          <Badge variant="neutral" className="rounded-full">
            已归档只读
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {(doc.updated || "").slice(0, 10) ? `最后保存 ${(doc.updated || "").slice(0, 10)}` : "尚未保存"}
        </span>
      </summary>

      <div className="border-t border-border px-4 py-3">
        {/* 表头三字段（r2 原文标签） */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{def.headers.projectName}</span>
            <Input
              value={meta.header.projectName}
              disabled={locked}
              onChange={(e) => api.setHeader(doc, "projectName", e.target.value)}
              aria-label="项目名称"
              className="h-7 w-56 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{def.headers.owner}</span>
            <Input
              value={meta.header.owner}
              disabled={locked}
              onChange={(e) => api.setHeader(doc, "owner", e.target.value)}
              aria-label="主负责人"
              className="h-7 w-40 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{def.headers.difficulty}</span>
            <Input
              value={meta.header.difficulty}
              disabled={locked}
              onChange={(e) => api.setHeader(doc, "difficulty", e.target.value)}
              aria-label="难度系数"
              className="h-7 w-24 text-xs"
            />
          </label>
        </div>

        {/* 逐行表格：序号 / 检查内容 / 细则 + 自查（结果·问题记录·检查人）+ 交叉检查（同三列） */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-xs">
            <thead className="bg-secondary/60 text-foreground">
              <tr>
                <th className="border border-border/70 px-2 py-1.5 font-medium" rowSpan={2}>
                  序号
                </th>
                <th className="border border-border/70 px-2 py-1.5 font-medium" rowSpan={2}>
                  检查内容
                </th>
                <th className="border border-border/70 px-2 py-1.5 font-medium" rowSpan={2}>
                  细则
                </th>
                {GROUP_ORDER.map((g) => (
                  <th key={g} colSpan={3} className="border border-border/70 px-2 py-1.5 font-medium">
                    {COLUMN_GROUP_LABEL[g]}
                    <span className="ml-2 inline-flex items-center gap-1 font-normal text-muted-foreground">
                      检查日期：
                      <input
                        type="date"
                        value={meta.check_dates[g]}
                        disabled={locked}
                        onChange={(e) => api.setCheckDate(doc, g, e.target.value)}
                        aria-label={`${COLUMN_GROUP_LABEL[g]}日期`}
                        className="h-6 rounded border border-border bg-background px-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </span>
                  </th>
                ))}
              </tr>
              <tr>
                {GROUP_ORDER.map((g) =>
                  ["结果", "问题记录", "检查人"].map((h) => (
                    <th key={`${g}-${h}`} className="border border-border/70 px-2 py-1.5 font-normal text-muted-foreground">
                      {h}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {doc.rows.map((row) =>
                row.section ? (
                  <tr key={row.rid} className="bg-secondary/40">
                    <td className="border border-border/70 px-2 py-1.5 font-semibold text-foreground">{row.no}</td>
                    <td colSpan={8} className="border border-border/70 px-2 py-1.5 font-semibold text-foreground">
                      {row.content}
                    </td>
                  </tr>
                ) : (
                  <tr key={row.rid} className="align-top">
                    <td className="w-10 border border-border/70 px-2 py-1.5 text-muted-foreground">{row.no}</td>
                    <td className="border border-border/70 px-2 py-1.5 font-medium text-foreground">{row.content}</td>
                    <td className="whitespace-pre-line border border-border/70 px-2 py-1.5 leading-relaxed text-muted-foreground">
                      {row.detail || "—"}
                    </td>
                    {GROUP_ORDER.map((g) => (
                      <GroupCells
                        key={g}
                        doc={doc}
                        rid={row.rid}
                        content={row.content}
                        group={g}
                        locked={locked}
                        api={api}
                      />
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {/* 表尾：原文检查结果/签名栏提示 + 结果选择 + 修改原因 + 签名栏 */}
        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2.5">
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{def.footer}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">检查结果：</span>
            <button
              type="button"
              disabled={locked}
              aria-pressed={meta.result === "ready"}
              onClick={() => api.setResult(doc, meta.result === "ready" ? "" : "ready")}
              className={`rounded-full border px-2.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                meta.result === "ready" ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:text-primary"
              }`}
            >
              1、可以送出
            </button>
            <button
              type="button"
              disabled={locked}
              aria-pressed={meta.result === "revise"}
              onClick={() => api.setResult(doc, meta.result === "revise" ? "" : "revise")}
              className={`rounded-full border px-2.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                meta.result === "revise" ? "border-destructive bg-destructive/10 font-medium text-destructive" : "border-border text-muted-foreground hover:text-destructive"
              }`}
            >
              2、重新修改
            </button>
            <label className="ml-2 flex min-w-0 flex-1 items-center gap-1.5">
              <span className="shrink-0 text-muted-foreground">修改原因:</span>
              <Input
                value={meta.revise_reason}
                disabled={locked}
                onChange={(e) => api.setReviseReason(doc, e.target.value)}
                aria-label="修改原因"
                className="h-7 min-w-[10rem] flex-1 text-xs"
              />
            </label>
          </div>
          {/* 签名栏：自查 / 交叉检查各一（签名 + 日期，不做电子签章） */}
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            {GROUP_ORDER.map((g) => (
              <div key={g} className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">{DEPT_CHECK_GROUP_LABEL[g]}人签名：</span>
                <Input
                  value={meta.signatures[g].name}
                  disabled={locked}
                  onChange={(e) => api.setSignature(doc, g, { name: e.target.value })}
                  aria-label={`${DEPT_CHECK_GROUP_LABEL[g]}人签名`}
                  className="h-7 w-28 text-xs"
                />
                <span className="text-muted-foreground">日期：</span>
                <input
                  type="date"
                  value={meta.signatures[g].date}
                  disabled={locked}
                  onChange={(e) => api.setSignature(doc, g, { date: e.target.value })}
                  aria-label={`${DEPT_CHECK_GROUP_LABEL[g]}签名日期`}
                  className="h-7 rounded border border-border bg-background px-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 留痕：谁在什么时候改了什么（元数据 JSON 列内自管，最多 50 条） */}
        <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {recent.length ? (
            <>
              <span className="font-medium text-foreground">留痕（最近 {recent.length} 条，共 {meta.log.length} 条）：</span>
              <ul className="mt-0.5 space-y-0.5">
                {recent.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    {(e.at || "").replace("T", " ").slice(0, 16)} · {e.by || "未知"} · {e.what}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <span>尚无留痕：每次勾选 / 填写都会记录「谁、何时、改了什么」</span>
          )}
        </div>
      </div>
    </details>
  )
}

export function DeptChecklistPanel({
  projectId,
  projectName,
  locked = false,
  operator,
}: {
  projectId: string
  projectName: string
  locked?: boolean
  operator?: string
}) {
  const api = useDeptChecklists({ projectId, projectName, operator })
  const pending = CHECKLIST_DEFS.filter((d) => !findDeptCheckDoc(api.docs, projectId, d.key))
  const imported = CHECKLIST_DEFS.filter((d) => !!findDeptCheckDoc(api.docs, projectId, d.key))

  return (
    <section className="mt-5 rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <ClipboardList className="h-4 w-4 text-primary" />
            部门检查清单（招标书 / 投标文件 / 解决方案）
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            三份部门检查清单原样导入：自查 + 交叉检查各填「结果 / 问题记录 / 检查人」与检查日期，表尾填检查结果与签名。
            本轮只做原样清单 + 人工勾选留痕，不做自动判定；每次改动都会留下「谁、何时、改了什么」。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {api.saveState === "saving" && <span className="badge-neutral">保存中…</span>}
          {api.saveState === "error" && (
            <button
              type="button"
              onClick={api.retrySave}
              title="点击重新保存"
              className="badge-danger cursor-pointer transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              保存失败，点击重试
            </button>
          )}
        </div>
      </div>

      {api.loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          检查清单加载中…
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {pending.map((def) => (
                <div key={def.key} className="rounded-xl border border-dashed border-border bg-background/60 p-3">
                  <p className="text-sm font-semibold text-foreground">{def.title}</p>
                  {def.subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{def.subtitle}</p>}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    共 {deptCheckEntryCount(def)} 条（源表 {deptCheckRowTotal(def)} 行：条目 + 分区 + 表尾）
                  </p>
                  <Button
                    size="sm"
                    disabled={locked || api.importing === def.key}
                    onClick={() => api.importDef(def.key)}
                    className="mt-2 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  >
                    {api.importing === def.key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    导入为本项目清单
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-4">
            {imported.map((def) => {
              const doc = findDeptCheckDoc(api.docs, projectId, def.key)
              if (!doc) return null
              return <DeptChecklistCard key={def.key} def={def} doc={doc} api={api} locked={locked} />
            })}
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        结果照原表勾选栏：√ 通过 / × 不通过 / 空 未判定；清单为项目级副本，重复导入不会重复堆积。
      </p>
    </section>
  )
}
