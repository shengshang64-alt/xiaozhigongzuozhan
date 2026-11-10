// 模型配置 · 屏内 SubTab（UX-v2：/model-config?tab=channels|health|test）
//
// 为什么用 query 而不是独立路由：本应用路由表是「扁平顶层路径 + 工作区标签保活」，
// 每个路径一个标签、一份页面实例。把三个子屏拆成三条顶层路由会让标签栏多出三个
// 「模型配置」标签，且 useModelConfig 的配置列表要各拉一遍。
// 用 ?tab= 切换则：一个标签、一份 hook、三块内容切换渲染，最贴近原型的屏内 Tab。
//
// 视觉对齐原型 .subtabs：底部 1px 分隔线 + 当前项主色下划线（不是实心 pill），
// 右侧留 hint 位放本屏一句话说明（与 AUTHORING §屏内 Tab 一致）。
import { useSearchParams } from "react-router-dom"
import { MODEL_CONFIG_TABS, type ModelConfigTab } from "./modelConfigTabs"

export function ModelSubtabs({ active }: { active: ModelConfigTab }) {
  const [, setSearchParams] = useSearchParams()
  const current = MODEL_CONFIG_TABS.find((t) => t.key === active)
  return (
    <nav aria-label="模型配置子屏" className="-mt-0.5 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border">
      {MODEL_CONFIG_TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => setSearchParams(t.key === "channels" ? {} : { tab: t.key }, { replace: true })}
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
