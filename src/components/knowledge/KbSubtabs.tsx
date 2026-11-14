// 知识库 · 屏内 SubTab（UX-v2：/knowledge?tab=browse|search|atoms|review|qa|upload）
//
// 视觉对齐原型 .subtabs，与 CustomerSubtabs / ModelSubtabs / SolutionSubtabs 同款：
// 底部 1px 分隔线 + 当前项主色下划线，右侧 hint 放本屏一句话说明。
// 切换经 onSelect 交给页面（文档库里点「全文检索」按钮也走同一条路，统一收口）。
import { KB_TABS, type KbTab } from "@/components/knowledge/kbTabs"

export function KbSubtabs({
  active,
  onSelect,
}: {
  active: KbTab
  onSelect: (tab: KbTab) => void
}) {
  const current = KB_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="知识库子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {KB_TABS.map((t) => {
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
