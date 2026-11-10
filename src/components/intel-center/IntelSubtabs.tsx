// 情报中心 · 屏内 SubTab（UX-v2：/intel-center?tab=review|browse|detail|industry|sources）
//
// 视觉对齐原型 .subtabs，与 ModelSubtabs / HomeSubtabs 同款：底部 1px 分隔线 +
// 当前项主色下划线，右侧 hint 放本屏一句话说明。
// 情报中心无未落盘编辑态，切换直接写 ?tab=；审阅/浏览里打开的详情保留右侧面板
// （原型 review.html 即「队列 + 右侧审阅面板」），「详情」Tab 供整屏阅读。
import { useSearchParams } from "react-router-dom"
import { INTEL_TABS, type IntelTab } from "@/pages/IntelCenter/intelTabs"

export function IntelSubtabs({ active }: { active: IntelTab }) {
  const [, setSearchParams] = useSearchParams()
  const current = INTEL_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="情报中心子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {INTEL_TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => setSearchParams(t.key === "review" ? {} : { tab: t.key }, { replace: true })}
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
