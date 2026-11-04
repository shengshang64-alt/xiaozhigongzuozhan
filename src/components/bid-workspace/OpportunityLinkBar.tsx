import { Hospital, Link2 } from "lucide-react"
import type { ReactNode } from "react"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { displayStageLabel, effectiveHospital } from "@/pages/BidWorkspace/bidTypes"

type OpportunityLinkBarProps = Pick<
  UseBidWorkspace,
  "activeProject" | "activeOppOptions" | "oppOptionsCapped" | "linkOpportunity" | "linkedOpportunityName" | "isArchivedLocked"
> & {
  /** warroom-01：作战室入口插槽（一屏聚合弹框的触发按钮），渲染在头部右侧 */
  warRoomSlot?: ReactNode
  /**
   * bar（默认）：独立成条，自带圆角卡片与左右留白；
   * inline：外层用 display:contents 让本组件内容直接进入父级合并行（项目信息栏），不再重复描边与卡片阴影。
   */
  variant?: "bar" | "inline"
}

const selectClass =
  "h-9 min-w-52 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"

/** 流水线头部信息区：项目基本信息 + 关联商机下拉（第四轮改造） */
export function OpportunityLinkBar({ activeProject, activeOppOptions, oppOptionsCapped, linkOpportunity, linkedOpportunityName, isArchivedLocked, warRoomSlot, variant = "bar" }: OpportunityLinkBarProps) {
  if (!activeProject) return null
  const proj = activeProject
  const inline = variant === "inline"
  return (
    <div className={inline ? "contents" : "mx-auto mt-3 max-w-7xl px-4"}>
      <div
        className={
          inline
            ? "flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3"
            : "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Hospital className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{proj.project_name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {effectiveHospital(proj) || "采购人未填写"}
              {proj.tender_no ? ` · ${proj.tender_no}` : ""}
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{displayStageLabel(proj)}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {warRoomSlot}
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 text-primary" />
            关联商机
          </label>
          <select
            value={proj.opportunity_id ?? ""}
            onChange={(e) => linkOpportunity(e.target.value)}
            disabled={isArchivedLocked}
            title={isArchivedLocked ? "已归档项目为只读，解除归档后可修改关联商机" : undefined}
            className={selectClass}
          >
            <option value="">未关联（可在客户管理创建商机后选择）</option>
            {activeOppOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.customer_name ? `${o.customer_name} · ${o.opp_name}` : o.opp_name}
              </option>
            ))}
          </select>
          {linkedOpportunityName && (
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary lg:inline-flex">
              {linkedOpportunityName}
            </span>
          )}
          {oppOptionsCapped && (
            <span className="basis-full text-right text-xs text-muted-foreground">仅显示最近 200 个商机</span>
          )}
        </div>
      </div>
    </div>
  )
}
