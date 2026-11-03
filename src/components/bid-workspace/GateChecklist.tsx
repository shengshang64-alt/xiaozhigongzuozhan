import { useState } from "react"
import { ArrowRightCircle, CheckCircle2, ChevronDown, CircleDashed, RotateCcw, ShieldAlert, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  findGateRecord,
  gateCondition,
  GATE_KINDS,
  GATE_LABEL,
  type GateKind,
} from "@/pages/BidWorkspace/bidTypes"
import { composeGateBlockingReason } from "@/pages/BidWorkspace/composeGates"

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
  // notingGate=正在展开备注输入的闸门；resetTarget=待二次确认重置的闸门；redlineOpen=公司红线自查展开态
  const [notingGate, setNotingGate] = useState<"" | GateKind>("")
  const [noteDraft, setNoteDraft] = useState("")
  const [resetTarget, setResetTarget] = useState<GateKind | null>(null)
  const [redlineOpen, setRedlineOpen] = useState(false)
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
          const baseCond = gateCondition(activeProject, kind)
          // 2026-10-22：编制门禁 A1-A6 的阻断级问题并入 check 闸——原来只在生成后弹 toast，
          // 交卷与导出都不看它，「知道有问题」和「能不能交卷」之间没有接线。
          const composeReason = kind === "check" ? composeGateBlockingReason(activeProject) : ""
          const cond = baseCond.met && composeReason ? { met: false, missing: composeReason } : baseCond
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
                        {record.confirmed_at ? formatDateTimeDisplay(record.confirmed_at) : ""}
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

      {/* 公司招投标培训（第一期）摘要：培训里的过程红线无法程序化判定，交卷前逐项人工过一遍 */}
      <div className="mt-4 rounded-lg border border-border bg-background">
        <button
          type="button"
          onClick={() => setRedlineOpen((o) => !o)}
          aria-expanded={redlineOpen}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-card-foreground">
            <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
            公司投标红线自查（招投标培训摘要，交卷前逐项人工过一遍）
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${redlineOpen ? "rotate-180" : ""}`} />
        </button>
        {redlineOpen && (
          <div className="grid gap-3 border-t border-border p-4 text-xs leading-relaxed text-muted-foreground lg:grid-cols-2">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="font-medium text-foreground">串标五禁止（处罚：采购额 5‰-10‰ 罚款、1-3 年禁入）</p>
              <p className="mt-1">① 禁止不同投标人同一台电脑制作标书；② 禁止同一 IP 上传/解密；③ 禁止多个 CA 证书同机使用；④ 禁止同一源文件修改制作；⑤ 禁止风格、报价、方案、错误异常雷同。</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="font-medium text-foreground">电子标废标六查 + 文档属性</p>
              <p className="mt-1">CA 有效期须含开标当天；加密文件上传无误；签字盖章无遗漏；关联索引正确；模板占位文字（「请填入您的内容」）零残留；开标解密正常（先跑系统测试）。转 PDF 前删除 Word 文档属性（公司/作者信息），图片保持嵌入型清晰可读。</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="font-medium text-foreground">报价三核实</p>
              <p className="mt-1">大小写金额一致；分项合计＝总价；报价与竞标价/预算关系反复核对。授权期限、投标有效期类形式承诺满足招标全周期。</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="font-medium text-foreground">审核四道关与归档</p>
              <p className="mt-1">自我审核 → 团队互审（发现雷同款）→ 主管复审 → 销售终审（标书须经销售最后确认）；中标公告后 10 个工作日内发总部商务支持部归档；文件名按「日期-标题-版本号」三要素，完稿发审原则上 PDF。</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2 lg:col-span-2">
              <p className="font-medium text-foreground">公司流程时限</p>
              <p className="mt-1">公开招标挂网后 5 日历日内发起竞标评审、开标前 3 日历日完成（谈判/磋商/询价 2 日历日）； 30 万以上项目报价评审挂网前 3 个工作日完成；中标公告 2 个工作日内提交投标结果汇报；二次挂网项目须比对条款变化，重大不一致 3 个工作日内沟通运营管理部。</p>
            </div>
          </div>
        )}
      </div>

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
