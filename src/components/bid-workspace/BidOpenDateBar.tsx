import { useState } from "react"
import { CalendarClock, Check, Pencil, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  bidOpenDateDay,
  bidOpenDateStatus,
  normalizeBidOpenDateInput,
  type BidOpenDateStatus,
} from "@/components/bid-workspace/bidOpenDate"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type BidOpenDateBarProps = Pick<UseBidWorkspace, "activeProject" | "isArchivedLocked" | "updateProject">

const CHIP: Record<BidOpenDateStatus["tone"], string> = {
  missing: "border border-dashed border-warning/50 bg-warning/10 text-warning",
  past: "border border-destructive/40 bg-destructive/10 font-medium text-destructive",
  urgent: "border border-destructive/40 bg-destructive/10 font-medium text-destructive",
  normal: "border border-border bg-muted text-muted-foreground",
}

/** R198（§3.5）：流水线头部「开标时间」补录条。
 * 此前开标时间仅能在「新建项目」对话框设置，已建项目缺失后无任何补录入口——
 * 而驾驶舱投标节点提醒、开标倒计时、截标预警都依赖它。本条让当前项目就地补录 / 修改 / 清除，
 * 复用既有 updateProject（PATCH 已有 bid_open_date 字段，零新 collection、零迁移、零 pb_hooks）。 */
export function BidOpenDateBar({ activeProject, isArchivedLocked, updateProject }: BidOpenDateBarProps) {
  const proj = activeProject
  // R68：库里这个字段可能是 PB 的日期时间串（`2026-12-01 00:00:00.000Z`）。旧实现把它原样
  // 塞进展示文案与 `<input type="date">`，于是界面上直出「开标时间：2026-12-01 00:00:00.000Z」，
  // 点「修改」后日期框是**空白**的（date 输入拒绝非法值），用户会以为日期没存上。
  // 展示与编辑一律用 YYYY-MM-DD；写回也是 YYYY-MM-DD（updateProject 只认这个格式）。
  const savedRaw = proj?.bid_open_date ?? ""
  const saved = bidOpenDateDay(savedRaw)
  const [draft, setDraft] = useState(saved)
  const [editing, setEditing] = useState(!saved)

  if (!proj) return null
  const status = bidOpenDateStatus(savedRaw)
  const dirty = draft !== saved
  const lockTitle = isArchivedLocked ? "已归档项目为只读，解除归档后可修改开标时间" : undefined

  const commit = () => {
    const norm = normalizeBidOpenDateInput(draft)
    if (norm === null) {
      toast.error("请选择有效的开标日期")
      return
    }
    updateProject({ bid_open_date: norm })
    setDraft(norm)
    setEditing(norm === "")
    toast.success(norm ? `已登记开标时间：${norm}` : "已清除开标时间")
  }

  const clear = () => {
    updateProject({ bid_open_date: "" })
    setDraft("")
    setEditing(true)
    toast.success("已清除开标时间")
  }

  return (
    <div className="mx-auto mt-3 max-w-7xl px-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${CHIP[status.tone]}`}>
          <CalendarClock className="h-3.5 w-3.5" />
          {status.label}
        </span>

        {!editing ? (
          <>
            <span className="text-xs text-muted-foreground">
              开标时间：<span className="font-medium text-foreground">{saved}</span>
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={isArchivedLocked}
                title={lockTitle}
                onClick={() => setEditing(true)}
                className="border-border text-muted-foreground hover:text-foreground"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                修改
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isArchivedLocked}
                title={lockTitle}
                onClick={clear}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                清除
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">开标时间</span>
            <Input
              type="date"
              value={draft}
              disabled={isArchivedLocked}
              aria-label="开标时间"
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 w-40 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
            />
            {!savedRaw && (
              <span className="text-xs text-muted-foreground">
                尚未登记——驾驶舱投标节点提醒、开标倒计时与截标预警都依赖它，建议补录
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                disabled={isArchivedLocked || !dirty}
                onClick={commit}
                className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                保存
              </Button>
              {saved && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isArchivedLocked}
                  onClick={() => {
                    setDraft(saved)
                    setEditing(false)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  取消
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
