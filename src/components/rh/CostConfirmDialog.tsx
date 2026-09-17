// Canonical page-in-page billing confirm dialog. Pair with `useCostConfirm()`
// (src/hooks/useCostConfirm.ts) — do not build a separate dialog and do not fall back
// to `window.confirm`/`alert`/`prompt` for billing confirmation, see
// vibex_billing_contract.yaml. Rendering is entirely local (fixed overlay), no portal
// dependency required.
import { useEffect, useRef } from "react"
import { Wallet } from "lucide-react"
import type { UseCostConfirmResult } from "@/hooks/useCostConfirm"

type CostConfirmDialogProps = Pick<
  UseCostConfirmResult,
  "costConfirmOpen" | "costConfirmPriceText" | "dontShowToday" | "setDontShowToday" | "confirmCostAction" | "cancelCostConfirm"
> & {
  title?: string
}

export function CostConfirmDialog({
  costConfirmOpen,
  costConfirmPriceText,
  dontShowToday,
  setDontShowToday,
  confirmCostAction,
  cancelCostConfirm,
  title = "确认运行",
}: CostConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 打开时聚焦「取消」（防误触确认）；Escape = 取消；Tab 焦点循环限制在弹窗内。
  useEffect(() => {
    if (!costConfirmOpen) return
    cancelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        cancelCostConfirm()
        return
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [costConfirmOpen, cancelCostConfirm])

  if (!costConfirmOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg"
      >
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          将调用 AI 模型，可能产生接口调用费用。
          {costConfirmPriceText ? ` ${costConfirmPriceText}。` : ""}
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={dontShowToday}
            onChange={(e) => setDontShowToday(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          今天内不再提醒（仅对当前项目有效）
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={cancelCostConfirm}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirmCostAction}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:scale-105"
          >
            确认运行
          </button>
        </div>
      </div>
    </div>
  )
}
