// 方案工作室 · 屏内 SubTab（UX-v2：/solution-studio?tab=list|editor|checklist|delivery）
//
// 视觉对齐原型 .subtabs 与 ModelSubtabs 同款：底部 1px 分隔线 + 当前项主色下划线
// （不是实心 pill），右侧留 hint 位放本屏一句话说明（AUTHORING §屏内 Tab）。
//
// 切换不走本组件的 setSearchParams：编辑器屏有未落盘正文与进行中的批量生成，
// 离开前要 flush / 停批量 / 重拉列表（useSolutionStudio.goStudioTab 统一管），
// 这里只负责渲染与上报点击。
import { SOLUTION_STUDIO_TABS, type SolutionStudioTab } from "@/pages/SolutionStudio/solutionStudioTabs"

export function SolutionSubtabs({
  active,
  onSelect,
}: {
  active: SolutionStudioTab
  onSelect: (tab: SolutionStudioTab) => void
}) {
  const current = SOLUTION_STUDIO_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="方案工作室子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {SOLUTION_STUDIO_TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(t.key)}
            className={
              on
                ? "relative border-b-2 border-primary px-3 pb-2.5 pt-2 text-[13px] font-semibold text-primary"
                : "relative border-b-2 border-transparent px-3 pb-2.5 pt-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {t.label}
          </button>
        )
      })}
      <span className="ml-auto hidden pr-0.5 text-[11.5px] text-muted-foreground sm:block">{current?.hint}</span>
    </nav>
  )
}
