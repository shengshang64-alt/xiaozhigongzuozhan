// Canonical page-in-page billing confirm dialog. Pair with `useCostConfirm()`
// (src/hooks/useCostConfirm.ts) — do not build a separate dialog and do not fall back
// to `window.confirm`/`alert`/`prompt` for billing confirmation, see
// vibex_billing_contract.yaml.
//
// ⚠️ 2026-09-27 重构为 Radix Dialog（S1 实测修复）：旧实现是手写 fixed overlay（非 Radix），
// 当它叠在某个 Radix 模态弹窗（新建方案向导 / 标书向导 / 客户编辑等）之上时，
// 底层 Radix DismissableLayer 会把「层外」pointerdown 直接 preventDefault ——
// 表现为确认框看得见、Escape 能关、但鼠标怎么都点不动，用户在向导里触发付费生成时被卡死。
// Radix Dialog 嵌套是官方支持场景：后打开的 modal layer 自动在最上层且可正常交互。
// 视觉与旧版保持一致；Escape=取消、点外部不关闭（付费确认必须显式选择）、打开时聚焦「取消」。
import { useEffect, useRef } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
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
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 打开时聚焦「取消」（防误触确认）
  useEffect(() => {
    if (costConfirmOpen) cancelRef.current?.focus()
  }, [costConfirmOpen])

  return (
    <DialogPrimitive.Root
      open={costConfirmOpen}
      onOpenChange={(open) => {
        if (!open) cancelCostConfirm()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/50" />
        <DialogPrimitive.Content
          aria-label={title}
          className="fixed left-1/2 top-1/2 z-[100] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg"
          // 付费确认必须显式选择：点 overlay 外部不关闭；Escape 走 onOpenChange=取消
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
