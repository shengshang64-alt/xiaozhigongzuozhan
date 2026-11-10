// PPT 与报价 · 屏内 SubTab（UX-v2：/ppt-quote?tab=deck-list|deck-editor|quote-list|quote-editor|quote-preview）
//
// 视觉对齐原型 .subtabs，与其余模块 Subtabs 同款：底部 1px 分隔线 + 当前项主色下划线，
// 右侧 hint 放本屏一句话说明。切换经 onSelect 交给页面——列表↔编辑器的会话归位
// （setActiveView / backTo*List）由既有 hook 动作负责，这里只上报点击。
import { PPT_QUOTE_TABS, type PptQuoteTab } from "@/pages/PptQuote/pptTabs"

export function QuoteSubtabs({
  active,
  onSelect,
}: {
  active: PptQuoteTab
  onSelect: (tab: PptQuoteTab) => void
}) {
  const current = PPT_QUOTE_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="PPT 与报价子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {PPT_QUOTE_TABS.map((t) => {
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
