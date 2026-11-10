// 产品映射 · 屏内 SubTab（UX-v2：/product-mapping?tab=upload|compare|result|library）
//
// 视觉对齐原型 .subtabs，与 ModelSubtabs / IntelSubtabs 同款：底部 1px 分隔线 +
// 当前项主色下划线，右侧 hint 放本屏一句话说明。切换经 onSelect 交给页面
// （②对照 / ③结果 需要同步 hook 的表格视图状态，统一收口）。
import { MAPPING_TABS, type MappingTab } from "@/pages/ProductMapping/mappingTabs"

export function MappingSubtabs({
  active,
  onSelect,
}: {
  active: MappingTab
  onSelect: (tab: MappingTab) => void
}) {
  const current = MAPPING_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="产品映射子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {MAPPING_TABS.map((t) => {
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
