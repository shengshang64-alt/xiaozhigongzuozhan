// 工作台总览 · 屏内 SubTab（UX-v2：/?tab=overview|todos|calendar|review）
//
// 视觉对齐原型 .subtabs，与 ModelSubtabs / SolutionSubtabs 同款：底部 1px 分隔线 +
// 当前项主色下划线，右侧 hint 放本屏一句话说明。
// 首页无未落盘编辑态，切换直接写 ?tab= 即可，无需像方案工作室那样经 hook 统一 flush。
import { useSearchParams } from "react-router-dom"
import { HOME_TABS, type HomeTab } from "@/pages/Home/homeTabs"

export function HomeSubtabs({ active }: { active: HomeTab }) {
  const [, setSearchParams] = useSearchParams()
  const current = HOME_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="工作台子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {HOME_TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => setSearchParams(t.key === "overview" ? {} : { tab: t.key }, { replace: true })}
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
