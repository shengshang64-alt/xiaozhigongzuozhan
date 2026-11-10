// 素材库 · 屏内 SubTab（UX-v2：/materials?tab=overview|import|web|settings）
//
// 视觉与模型配置的 ModelSubtabs 同族：底部 1px 分隔线 + 当前项主色下划线。
// 为什么用 query 而不是四条顶层路由：本应用一个路径一个工作区标签，
// 拆成四条会让标签栏堆出四个同名「素材库」标签，且四屏各拉一遍列表与统计。
import { useSearchParams } from "react-router-dom"
import { MATERIAL_TABS, type MaterialTab } from "./materialTabs"

export function MaterialSubtabs({ active }: { active: MaterialTab }) {
  const [, setSearchParams] = useSearchParams()
  const current = MATERIAL_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="素材库子屏" className="mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {MATERIAL_TABS.map((t) => {
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
