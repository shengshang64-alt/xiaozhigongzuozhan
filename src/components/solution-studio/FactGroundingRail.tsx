import { ShieldQuestion } from "lucide-react"

// ---------------------------------------------------------------------------
// 事实接地检查 · 编辑器右栏卡（UX-v2：prototype/solution/editor.html 右栏第 2 卡）。
// 原型该卡列「数值 / 厂商名 / 资质引用」三类待核事实并逐条给核实按钮；
// 现网方案侧**还没有**这条比对引擎（需要知识库引用 + 客户档案 + 资质台账联动，
// 属 UX-v2 P3 的后端包）。按总控铁律不造假条目：卡与版式骨架保留，
// 正文给诚实空态，说明接入后会核什么、数据从哪来。
// ---------------------------------------------------------------------------

/** 接入后会核的三类事实（与原型 editor.html 右栏第 2 卡的三种徽标一一对应） */
const PLANNED_CHECKS: { label: string; desc: string }[] = [
  { label: "数值", desc: "正文里的峰值 / 人数 / 时长等数字，是否在知识库或客户附件有出处" },
  { label: "厂商名", desc: "现网系统与承建厂商的说法，是否与客户档案记载一致" },
  { label: "资质", desc: "引用的资质证书是否有效、是否临近有效期" },
]

export function FactGroundingRail() {
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ShieldQuestion className="h-4 w-4 shrink-0 text-muted-foreground" />
          事实接地检查
        </h3>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">未接入</span>
      </div>
      <p className="mt-2.5 rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        方案正文与知识库 / 客户档案 / 资质台账的自动比对暂未接入（属模型健康之外的独立后端包）。
        接入后这里会逐条列出待核事实，并在「交付检查」屏参与导出门禁；当前请人工核对关键数字与厂商名。
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {PLANNED_CHECKS.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.label}</span>
            <span className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{c.desc}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">—</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
