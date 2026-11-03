import { useMemo, useState } from "react"
import { CheckSquare, CircleSlash, Copy, Download, ListChecks, ShieldAlert, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/clipboard"
import { triggerBlobDownload } from "@/lib/download"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import {
  buildDeliveryActionList,
  readDeliveryProgress,
  renderDeliveryActionMarkdown,
  summarizeDeliveryActions,
  writeDeliveryProgress,
  type DeliveryActionState,
  type DeliveryProgressMap,
} from "@/pages/BidWorkspace/deliveryActionList"

// ---------------------------------------------------------------------------
// R288（bid-placeholder-owner-split · P1）：交付前必办清单（按责任方）。
// 把正文里所有【待填写】类占位按「谁来办」分成①商务拍板 / ②人工附材料 / ③系统可回取 /
// ④待人工判定四组，逐项可勾销（进度按项目存本机），并可复制或下载成清单带进评审会。
// 与既有两张卡互补：交卷体检查「有没有命中」、合规清单查「形式要件备齐没」，本卡回答
// 「谁还欠几件事、其中几项必须我拍板」。判据与 scripts/bid-delivery-gate.mjs 同源。
// 只报不拦：不拦截导出、不自动改正文（维持既有裁定）。
// 用 key={projectId} 重挂载 + useState 惰性初始化读本机进度，规避 react-hooks/set-state-in-effect。
// ---------------------------------------------------------------------------

/** 单组默认展开条数，其余折叠（实测单组可达百条，全展开会把页面卡死） */
const GROUP_LIMIT = 8

export function DeliveryActionPanel({
  projectId,
  chapters,
  projectName,
  locked = false,
}: {
  projectId: string
  chapters: Chapter[]
  projectName: string
  locked?: boolean
}) {
  const items = useMemo(() => buildDeliveryActionList(chapters), [chapters])
  const [progress, setProgress] = useState<DeliveryProgressMap>(() => readDeliveryProgress(projectId))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const report = useMemo(() => summarizeDeliveryActions(items, progress), [items, progress])

  const patch = (id: string, next: DeliveryActionState | null) => {
    const copy: DeliveryProgressMap = { ...progress }
    if (next === null) delete copy[id]
    else copy[id] = next
    setProgress(copy)
    writeDeliveryProgress(projectId, copy)
  }

  const markdown = () => renderDeliveryActionMarkdown(projectName, report, progress)

  if (report.total === 0) {
    return (
      <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-md">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <ListChecks className="h-4 w-4" />
          交付前必办清单（按责任方）
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-primary/90">
          各章正文未发现「待填写」类占位，无需人工补录，可直接进入交卷归档。
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
            <ListChecks className="h-4 w-4 text-primary" />
            交付前必办清单（按责任方）
            {report.fatalPending > 0 ? (
              <Badge variant="danger" className="flex items-center gap-1 rounded-full">
                <ShieldAlert className="h-3.5 w-3.5" />
                致命待办 {report.fatalPending}
              </Badge>
            ) : (
              <Badge variant="success" className="rounded-full">
                致命项已清零
              </Badge>
            )}
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            从各章正文本地推导（零 AI 费用）：占位按「谁来办」分流——商务拍板 / 人工附件 / 系统回取 /
            待判定，交付前逐条勾销。勾销进度保存在本机浏览器；本卡只报不拦，不拦截导出。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              report.decisionPending > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}
          >
            {report.decisionPending > 0 ? `还有 ${report.decisionPending} 项等你拍板` : "商务决策项均已拍板"}
          </span>
          <Button size="sm" variant="outline" onClick={() => void copyTextToClipboard(markdown(), { successMessage: "清单已复制，可粘贴进邮件或评审纪要" })}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制清单
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              triggerBlobDownload(
                new Blob([markdown()], { type: "text/markdown;charset=utf-8" }),
                `交付前必办清单-${(projectName || "项目").slice(0, 20)}.md`,
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            下载清单
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {report.byOwner.map((group) => {
          if (group.total === 0) return null
          const open = !!expanded[group.owner]
          const shown = open ? group.items : group.items.slice(0, GROUP_LIMIT)
          return (
            <div key={group.owner} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-foreground">{group.label}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    group.pending ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                  }`}
                >
                  {group.pending ? `待办 ${group.pending} / ${group.total}` : `已办结 ${group.total}`}
                  {group.fatalPending > 0 ? ` · 致命待办 ${group.fatalPending}` : ""}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">办结口径：{group.action}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {shown.map((it) => {
                  const state = progress[it.id]
                  const done = state === "done"
                  const na = state === "na"
                  return (
                    <li
                      key={it.id}
                      className={`rounded-md border px-2.5 py-2 text-xs ${
                        na
                          ? "border-border/60 bg-muted/20"
                          : done
                            ? "border-primary/30 bg-primary/5"
                            : it.fatal
                              ? "border-destructive/30 bg-destructive/5"
                              : "border-border/60 bg-background"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => patch(it.id, done ? null : "done")}
                          aria-pressed={done}
                          title={locked ? "已归档项目为只读" : done ? "取消办结" : `标记${group.doneLabel}`}
                          className="mt-0.5 shrink-0 rounded text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {done ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                it.fatal ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                              }`}
                            >
                              {it.fatal ? "致命" : "警告"}
                            </span>
                            <span className="shrink-0 font-medium text-card-foreground">{it.chapters.join(" / ")}</span>
                            {it.occurrences > 1 && (
                              <Badge variant="neutral" className="rounded-full text-[10px]">
                                {it.occurrences} 处同形态
                              </Badge>
                            )}
                            {na && <Badge variant="neutral" className="rounded-full">不适用</Badge>}
                          </div>
                          <p className={`mt-1 leading-relaxed ${na ? "text-muted-foreground line-through" : "text-card-foreground"}`}>
                            …{it.snippet}…
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">归责依据：{it.why}</p>
                        </div>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => patch(it.id, na ? null : "na")}
                          title={locked ? "已归档项目为只读" : na ? "取消不适用" : "标记本项不适用"}
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                            na
                              ? "border-border bg-muted text-muted-foreground"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                          }`}
                        >
                          {na ? (
                            <span className="inline-flex items-center gap-1">
                              <CircleSlash className="h-3 w-3" />
                              不适用
                            </span>
                          ) : (
                            "不适用"
                          )}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {group.items.length > GROUP_LIMIT && (
                <button
                  type="button"
                  onClick={() => setExpanded({ ...expanded, [group.owner]: !open })}
                  className="mt-2 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {open ? "收起" : `展开全部 ${group.items.length} 条`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p
        className={`mt-3 rounded-md px-3 py-2 text-xs leading-relaxed ${
          report.pending === 0
            ? "border border-primary/30 bg-primary/5 font-medium text-primary"
            : "border border-dashed border-border bg-background text-muted-foreground"
        }`}
      >
        {report.pending === 0
          ? "四组待办均已勾销，占位层面可交卷；导出前仍建议跑一次交卷体检复核（本卡只报不拦）。"
          : `还有 ${report.pending} 项未办结（其中致命 ${report.fatalPending} 项）${
              report.truncated > 0 ? `；另有 ${report.truncated} 条同形态未展开` : ""
            }——① 组必须由商务/投标负责人给出真实数值，AI 代填即承诺风险。`}
      </p>
    </div>
  )
}
