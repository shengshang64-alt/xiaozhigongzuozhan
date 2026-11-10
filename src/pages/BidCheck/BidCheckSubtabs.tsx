// 标书检查 · 屏内 SubTab（UX-v2：/bid-check?tab=upload|running|report|history）
//
// 视觉对齐原型 .subtabs，与 ModelSubtabs / IntelSubtabs 同款：底部 1px 分隔线 +
// 当前项主色下划线，右侧 hint 放本屏一句话说明。
// 检查页无未落盘编辑态（结果是一次性产出），切换直接写 ?tab= 即可。
import { useSearchParams } from "react-router-dom"
import { BID_CHECK_TABS, type BidCheckTab } from "@/pages/BidCheck/bidCheckTabs"

export function BidCheckSubtabs({ active }: { active: BidCheckTab }) {
  const [, setSearchParams] = useSearchParams()
  const current = BID_CHECK_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="标书检查子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {BID_CHECK_TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => setSearchParams(t.key === "upload" ? {} : { tab: t.key }, { replace: true })}
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
