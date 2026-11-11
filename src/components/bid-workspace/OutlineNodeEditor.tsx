import { useMemo } from "react"
import { Check, Pencil, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// ③ 大纲编制 · 中栏「章节编辑」（UX-v2：prototype/bid/outline.html 中栏 1:1）
//
// 原型中栏结构（card-h「第 7 章 …」+ 当前选中·含 3 节；card-b 里两组字段 + 关联评分点 + 子节清单）：
//   · 章节标题（input）+ 层级（select 一级/二级）
//   · 字数预算（input）+ 是否必写（switch）
//   · 关联评分点（chip 列表：来自节点 description 里的 [响应:Rx] 标注，可解绑）
//   · 子节清单（list-row：标题 / 字数预算 / 覆盖状态徽标）
//   · card-f：本章预计字数 · 约 N 页 / 删除本章 / 保存修改
//
// 数据边界（不造假）：
//   · 评分点关联读节点 description 的 `[响应:Rx]` 真标注（R31 口径），没有就是「未关联」；
//   · 字数预算来自 chapterBudgets（按章节下标对齐），不是原型里的演示数字；
//   · 「关联评分点」的添加按钮走既有 addClauseToOutline 通道（把未响应条款补成节）。
// ---------------------------------------------------------------------------

/** 从节点 description 里解出 [响应:R1,R3] 的评分点编号（与 bidTypes 收集口径一致） */
function responseCodesOf(node: OutlineNode | null): string[] {
  const m = (node?.description ?? "").match(/\[(?:响应|Response):([^\]]+)]/i)
  if (!m) return []
  return m[1]
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

type OutlineNodeEditorProps = {
  /** 当前选中的节点（null → 未选中空态） */
  node: OutlineNode | null
  /** 当前节点的树深度（0=章，1=节） */
  depth: number
  /** 字数预算（来自 chapterBudgets，按章对齐；节暂无预算时为 0） */
  budget: number
  /** 归属部分：商务 / 技术（原型 part 分组口径） */
  partLabel: string
  /** 子节数量 */
  childCount: number
  locked: boolean
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
  onAddChild: (parentId: string, depth: number) => void
  /** 该节点承接的评分点编号 → 名称（用于 chip 显示） */
  scoreNameByCode?: Record<string, string>
  /** 「关联评分点」：把未响应条款补入大纲（既有通道） */
  onAddScorePoint?: () => void
  /** 定位到评分点覆盖右栏 */
  onShowCoverage?: () => void
}

export function OutlineNodeEditor({
  node,
  depth,
  budget,
  partLabel,
  childCount,
  locked,
  onRename,
  onRemove,
  onAddChild,
  scoreNameByCode,
  onAddScorePoint,
  onShowCoverage,
}: OutlineNodeEditorProps) {
  const codes = useMemo(() => responseCodesOf(node), [node])

  if (!node) {
    return (
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="text-[13.5px] font-semibold text-card-foreground">章节编辑</h3>
        </header>
        <div className="px-4 py-10 text-center text-xs leading-relaxed text-muted-foreground">
          在左侧大纲树里点选一章或一节，这里就能改标题、字数预算与评分点关联。
          <br />
          大纲确认前都可以自由调整；确认后改动会触发正文重建的二次确认。
        </div>
      </section>
    )
  }

  const isLeaf = childCount === 0
  const levelText = depth === 0 ? "一级（章）" : depth === 1 ? "二级（节）" : `${depth + 1} 级`

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Pencil className="h-4 w-4 shrink-0 text-primary" />
        <h3 className="min-w-0 truncate text-[13.5px] font-semibold text-card-foreground" title={node.title}>
          {node.title || "（未命名章节）"}
        </h3>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          当前选中 · {childCount > 0 ? `含 ${childCount} 节` : "叶节点"}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() => onAddChild(node.id, depth)}
          className="h-7 border-border px-2 text-xs text-card-foreground hover:bg-secondary"
        >
          <Plus className="mr-1 h-3 w-3" />
          加子节
        </Button>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {/* 章节标题 + 层级（原型：input + select 两列） */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-[11.5px] text-muted-foreground">章节标题</span>
            <input
              value={node.title}
              disabled={locked}
              onChange={(e) => onRename(node.id, e.target.value)}
              onBlur={(e) => onRename(node.id, e.target.value.trim())}
              placeholder="如：第 7 章 核心系统功能设计"
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            />
          </label>
          <div className="w-28 shrink-0">
            <span className="mb-1 block text-[11.5px] text-muted-foreground">层级</span>
            <div className="flex h-8 items-center rounded-md border border-border bg-muted px-2 text-[13px] text-muted-foreground">
              {levelText}
            </div>
          </div>
        </div>

        {/* 字数预算 + 是否必写（原型：input + switch 两列） */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32 shrink-0">
            <span className="mb-1 block text-[11.5px] text-muted-foreground">字数预算</span>
            <div className="flex h-8 items-center rounded-md border border-border bg-muted px-2 font-mono text-[13px] tabular-nums text-card-foreground">
              {budget > 0 ? budget.toLocaleString("zh-CN") : "—"}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[11.5px] text-muted-foreground">是否必写</span>
            <div className="flex h-8 items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${
                  node.mustWrite ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {node.mustWrite ? "必写章（不可删除）" : "常规章节"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {node.mustWrite
                  ? "命中评分办法 / ★▲ 条款 / 要求性表述，删了会丢分"
                  : isLeaf
                    ? "叶子节点，正文按此节点逐节生成"
                    : "含子节点，正文按子节点生成"}
              </span>
            </div>
          </div>
        </div>

        {/* 关联评分点（原型：chip 列表 + ＋关联评分点） */}
        <div>
          <span className="mb-1 block text-[11.5px] text-muted-foreground">关联评分点</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {codes.length === 0 ? (
              <span className="text-[11.5px] text-muted-foreground">
                未关联评分点{isLeaf ? "，该节点可能拿不到对应分值" : "（通常由叶子节点承接）"}
              </span>
            ) : (
              codes.map((code) => (
                <span
                  key={code}
                  title={`评分点 ${code}`}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11.5px] text-primary"
                >
                  {scoreNameByCode?.[code] ?? code}
                </span>
              ))
            )}
            {onAddScorePoint && (
              <button
                type="button"
                disabled={locked}
                onClick={onAddScorePoint}
                title="把还没被任何章节承接的评分点补成节（走既有补入通道，只增不删）"
                className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
              >
                ＋ 关联评分点
              </button>
            )}
          </div>
        </div>

        {/* 子节清单（原型：list-row 三行，标题 / 字数预算 / 覆盖徽标） */}
        {node.children.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11.5px] text-muted-foreground">子节</span>
              <div className="flex-1" />
              <span className="text-[11px] text-muted-foreground">左树可拖动调整顺序</span>
            </div>
            <ul className="overflow-hidden rounded-md border border-border">
              {node.children.map((child) => {
                const childCodes = responseCodesOf(child)
                return (
                  <li
                    key={child.id}
                    className="flex items-center gap-2 border-b border-border/60 bg-background px-2.5 py-1.5 text-[12px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-card-foreground" title={child.title}>
                      {child.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {childCodes.length > 0 ? `关联 ${childCodes.length} 个评分点` : "未关联评分点"}
                    </span>
                    {childCodes.length > 0 ? (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
                        已覆盖
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">
                        待关联
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* card-f：本章预计 / 删除本章 */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-3.5 py-2">
        <span className="text-[11.5px] text-muted-foreground">
          {budget > 0 ? `本章预计 ${budget.toLocaleString("zh-CN")} 字 · 约 ${Math.max(1, Math.round(budget / 950))} 页` : "字数预算未设定"}
          <span className="ml-1.5">· {partLabel}</span>
        </span>
        <div className="flex-1" />
        {onShowCoverage && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowCoverage}
            className="h-7 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            看评分点覆盖
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || node.mustWrite}
          title={node.mustWrite ? "必写章不可删除（删了会丢分）" : "删除本章及其子节"}
          onClick={() => onRemove(node.id)}
          className="h-7 px-2 text-[11.5px] text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="mr-1 h-3 w-3" />
          删除本章
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-primary" title="标题修改即时生效并自动保存">
          <Check size={11} strokeWidth={3} />
          自动保存
        </span>
      </footer>
    </section>
  )
}
