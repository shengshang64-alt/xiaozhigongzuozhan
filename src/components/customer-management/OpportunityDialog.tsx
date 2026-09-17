import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  PIPELINE_STAGES,
  STAGE_LABEL,
  refOptionKey,
  type CustomerRow,
  type OppStage,
  type RefOption,
} from "@/pages/CustomerManagement/customerTypes"
import type { OppDraft } from "@/pages/CustomerManagement/useCustomerManagement"

type OpportunityDialogProps = {
  open: boolean
  onClose: () => void
  isEdit: boolean
  draft: OppDraft
  setOppField: <K extends keyof OppDraft>(key: K, value: OppDraft[K]) => void
  customers: CustomerRow[]
  oppCustomerId: string
  setOppCustomerId: (value: string) => void
  noCustomerHint: boolean
  refOptions: RefOption[]
  refsHasMore: boolean
  refsLoadingMore: boolean
  onLoadMoreRefs: () => void
  onSave: () => void
  saving: boolean
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

export function OpportunityDialog({
  open,
  onClose,
  isEdit,
  draft,
  setOppField,
  customers,
  oppCustomerId,
  setOppCustomerId,
  noCustomerHint,
  refOptions,
  refsHasMore,
  refsLoadingMore,
  onLoadMoreRefs,
  onSave,
  saving,
}: OpportunityDialogProps) {
  // A2-8：预计金额行内校验（空串草稿允许，非法输入即时提示）
  const [amountError, setAmountError] = useState("")
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(e) => {
          // 循环7 C4：单行输入 Enter 触发保存；textarea 保留换行；按钮/Radix 浮层内交给原生行为避免双触发
          // 循环8 C3：原生 select（所属客户/关联方案）键盘选完选项的 Enter 也豁免，不提前提交
          if (e.key !== "Enter" || e.shiftKey) return
          const target = e.target as HTMLElement
          if (
            target.tagName === "TEXTAREA" ||
            target.tagName === "BUTTON" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            target.closest("[data-radix-popper-content-wrapper]")
          )
            return
          e.preventDefault()
          if (!saving) onSave()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑商机" : "新建商机"}</DialogTitle>
          <DialogDescription>商机挂在客户下，创建后可在详情里推进阶段、生成跟进建议。</DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3">
          {noCustomerHint && !oppCustomerId && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
            >
              未匹配到客户，请选择或先新建客户
            </p>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">所属客户</p>
            <select
              value={oppCustomerId}
              onChange={(e) => setOppCustomerId(e.target.value)}
              disabled={isEdit}
              className={inputClass}
            >
              <option value="">请选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.hospital_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">商机名称</p>
            <input
              value={draft.opp_name}
              onChange={(e) => setOppField("opp_name", e.target.value)}
              placeholder="如：电子病历系统升级项目"
              className={inputClass}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">初始阶段</p>
            <div className="flex flex-wrap gap-1.5">
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setOppField("stage", stage as OppStage)}
                  className={
                    draft.stage === stage
                      ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      : "rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  }
                >
                  {STAGE_LABEL[stage]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">预计金额（元）</p>
              <input
                value={draft.expected_amount}
                onChange={(e) => {
                  setOppField("expected_amount", e.target.value)
                  const raw = e.target.value.trim()
                  const n = Number(raw)
                  if (raw === "" || (Number.isFinite(n) && n >= 0)) setAmountError("")
                  else setAmountError("请输入 0 以上的数字金额")
                }}
                inputMode="numeric"
                aria-invalid={Boolean(amountError)}
                placeholder="如：800000"
                className={`${inputClass} ${amountError ? "border-destructive focus-visible:ring-destructive" : ""}`}
              />
              {amountError && <p className="mt-1 text-xs text-destructive">{amountError}</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">预计成交时间</p>
              <input
                type="date"
                value={draft.expected_close_date}
                onChange={(e) => setOppField("expected_close_date", e.target.value)}
                className={inputClass}
              />
            </div>
            {/* 循环8 C5：下次跟进时间——登记待办的 due_date 优先用它，缺省回落预计成交时间 */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">下次跟进时间</p>
              <input
                type="date"
                value={draft.next_follow_date}
                onChange={(e) => setOppField("next_follow_date", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">关联方案 / 标书项目（选填）</p>
            <select
              value={draft.ref_key}
              onChange={(e) => setOppField("ref_key", e.target.value)}
              className={inputClass}
            >
              <option value="">不关联</option>
              {refOptions.map((r) => (
                <option key={refOptionKey(r)} value={refOptionKey(r)}>
                  {r.ref_type === "solution" ? "方案" : "标书"} · {r.ref_name}
                </option>
              ))}
            </select>
            {refsHasMore && (
              <button
                type="button"
                onClick={onLoadMoreRefs}
                disabled={refsLoadingMore}
                className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {refsLoadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                找不到想要的？加载更多方案 / 标书选项
              </button>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">下一步动作</p>
            <input
              value={draft.next_action}
              onChange={(e) => setOppField("next_action", e.target.value)}
              placeholder="如：约信息科主任下周拜访"
              className={inputClass}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">参与人备注</p>
            <textarea
              value={draft.notes}
              onChange={(e) => setOppField("notes", e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "保存修改" : "创建商机"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
