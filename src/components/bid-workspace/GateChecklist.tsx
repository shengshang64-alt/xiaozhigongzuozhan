import { useState } from "react"
import { ArrowRightCircle, CheckCircle2, CircleDashed, RotateCcw, ShieldAlert, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  findGateRecord,
  gateCondition,
  GATE_KINDS,
  GATE_LABEL,
  type GateKind,
} from "@/pages/BidWorkspace/bidTypes"

type GateChecklistProps = Pick<
  UseBidWorkspace,
  "activeProject" | "confirmGate" | "resetGate" | "voidCriticalUnresolved"
>

/**
 * 第九轮改造 1：交卷闸门卡（确认留痕，不拦导航只拦导出）。
 * 五闸门逐条显示——条件满足可确认（备注可选）；未满足灰显 + 强制放行（备注必填留痕）；
 * 已确认显示绿勾 + 时间 + 备注，重置需二次确认。确认/重置即 PATCH stage_gates。
 */
export function GateChecklist({ activeProject, confirmGate, resetGate, voidCriticalUnresolved }: GateChecklistProps) {
  // notingGate=正在展开备注输入的闸门；resetTarget=待二次确认重置的闸门
  const [notingGate, setNotingGate] = useState<"" | GateKind>("")
  const [noteDraft, setNoteDraft] = useState("")
  const [resetTarget, setResetTarget] = useState<GateKind | null>(null)
  if (!activeProject) return null
  const gates = activeProject.stage_gates
  const confirmedCount = GATE_KINDS.filter((k) => findGateRecord(gates, k)).length
  const allDone = confirmedCount === GATE_KINDS.length

  const openNoting = (kind: GateKind) => {
    setNotingGate(kind)
    setNoteDraft("")
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-md">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-card-foreground">
            <ShieldAlert className="h-4 w-4 text-primary" />
            交卷闸门
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            交卷前五道闸门逐条确认留痕：条件满足可直接确认，未满足可填备注强制放行；五个闸门全部确认后才能导出全套文档。闸门仅约束全套导出与归档，单份文档导出与各步骤流转不受影响。
          </p>
        </div>
        <Badge variant={allDone ? "success" : "warning"} className="shrink-0">
          已确认 {confirmedCount}/{GATE_KINDS.length}
        </Badge>
      </header>

      <ul className="mt-4 flex flex-col gap-2.5">
        {GATE_KINDS.map((kind) => {
          const record = findGateRecord(gates, kind)
          const cond = gateCondition(activeProject, kind)
          const noting = notingGate === kind
          return (
            <li
              key={kind}
              className={`rounded-lg border px-4 py-3 ${
                record
                  ? "border-primary/30 bg-primary/5"
                  : cond.met
                    ? "border-border bg-background"
                    : "border-dashed border-border bg-muted/40"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {record ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  ) : cond.met ? (
                    <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <TriangleAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={`text-sm font-medium ${record ? "text-foreground" : cond.met ? "text-card-foreground" : "text-muted-foreground"}`}>
                    {GATE_LABEL[kind]}
                  </span>
                  {record ? (
                    <>
                      <Badge variant="success">已确认</Badge>
                      {record.forced && <Badge variant="warning">强制放行</Badge>}
                    </>
                  ) : cond.met ? (
                    <Badge variant="neutral">可确认</Badge>
                  ) : (
                    <span className="truncate text-xs text-muted-foreground">{cond.missing}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {record ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {record.confirmed_at ? new Date(record.confirmed_at).toLocaleString("zh-CN") : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setResetTarget(kind)}
                        className="border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        重置
                      </Button>
                    </>
                  ) : noting ? null : (
                    <Button
                      size="sm"
                      variant={cond.met ? "default" : "outline"}
                      onClick={() => openNoting(kind)}
                      className={
                        cond.met
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
                          : "border-border text-muted-foreground hover:bg-secondary"
                      }
                    >
                      {cond.met ? "确认闸门" : "强制放行"}
                    </Button>
                  )}
                </span>
              </div>

              {record?.notes && (
                <p className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  备注：{record.notes}
                </p>
              )}
              {kind === "check" && voidCriticalUnresolved > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  废标检查还有 {voidCriticalUnresolved} 条 critical 未核销（不拦确认，建议先处理）
                </p>
              )}

              {noting && !record && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder={cond.met ? "备注（可选）：确认说明留痕" : "强制放行必须填写备注说明原因"}
                    maxLength={200}
                    className="min-w-56 flex-1 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
                  />
                  <Button
                    size="sm"
                    disabled={!cond.met && !noteDraft.trim()}
                    onClick={() => {
                      confirmGate(kind, noteDraft, !cond.met)
                      setNotingGate("")
                      setNoteDraft("")
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {cond.met ? "确认" : "留痕放行"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNotingGate("")
                      setNoteDraft("")
                    }}
                    className="border-border text-muted-foreground hover:bg-secondary"
                  >
                    取消
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {!allDone && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowRightCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
          闸门仅约束全套导出与归档，单份文档随时可导，各环节仍可自由进出继续完善
        </p>
      )}

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null)
        }}
        title="重置该闸门？"
        description={resetTarget ? `将清掉「${GATE_LABEL[resetTarget]}」闸门的确认记录（含备注留痕），重置后回到未确认状态。` : ""}
        confirmText="重置"
        tone="danger"
        onConfirm={() => {
          if (resetTarget) resetGate(resetTarget)
          setResetTarget(null)
        }}
      />
    </section>
  )
}
