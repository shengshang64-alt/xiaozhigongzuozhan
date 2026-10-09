// Author: loop-R190
import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, LayoutTemplate, ShieldCheck } from "lucide-react"
import { finalizeFidelityProbe, type FidelityProbe, type FidelityVerdict, type TemplateFacts } from "@/pages/PptQuote/deckFidelityProbe"
import type { Slide } from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// R190（r169 切片三·展示层）：公司模板的「保真体检」卡片——上传模板后立刻看清
// 整册能否复用模板的母版/版式、选中的样式页是哪一页，以及不能保真时的逐条归因与建议。
// 结论全部由 deckFidelityProbe 纯函数合成（与导出通道同口径），本组件只呈现；
// 非阻断契约维持：只提示、不拦截导出与生成（交互形态沿用 R166 导出前自检面板）。
// ---------------------------------------------------------------------------

const OPEN_KEY = "ppt_fidelity_panel_open"
/** 模板可能有几十页，目录优先列选中的样式页，最多 8 行避免刷屏 */
const MAX_ROWS = 8

type IconCmp = typeof ShieldCheck

const VERDICT: Record<FidelityVerdict, { label: string; tone: string; Icon: IconCmp }> = {
  fidelity: { label: "可复用模板版式", tone: "bg-primary/10 text-primary", Icon: ShieldCheck },
  theme: { label: "本次仅套用主题", tone: "bg-muted text-muted-foreground", Icon: LayoutTemplate },
  unreadable: { label: "模板读取失败", tone: "bg-destructive/10 text-destructive", Icon: AlertTriangle },
}

const ROLE_LABEL: Record<NonNullable<FidelityProbe["rows"][number]["role"]>, string> = {
  title: "标题样式",
  body: "正文样式",
  both: "标题与正文样式",
}

type TemplateFidelityPanelProps = {
  templateName: string
  /** 模板侧探测事实（解包只在模板变化时发生一次） */
  facts: TemplateFacts
  /** 当前册页面，用于合成整册能否保真的结论 */
  slides: Slide[]
}

export function TemplateFidelityPanel({ templateName, facts, slides }: TemplateFidelityPanelProps) {
  const probe = useMemo(() => finalizeFidelityProbe(facts, slides), [facts, slides])
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(OPEN_KEY) === "1"
    } catch {
      return false
    }
  })
  const { shown, hidden } = useMemo(() => {
    const picked = probe.rows.filter((r) => r.role)
    const rest = probe.rows.filter((r) => !r.role)
    const all = [...picked, ...rest]
    return { shown: all.slice(0, MAX_ROWS), hidden: Math.max(0, all.length - MAX_ROWS) }
  }, [probe.rows])
  const { tone, label, Icon } = VERDICT[probe.verdict]

  return (
    <section
      aria-label="模板保真体检"
      className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-md animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <LayoutTemplate className="h-4 w-4 text-primary" />
          模板保真体检
        </h3>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="min-w-0 max-w-[240px] truncate text-xs text-muted-foreground" title={templateName}>
          模板：{templateName}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((prev) => {
              try {
                sessionStorage.setItem(OPEN_KEY, prev ? "0" : "1")
              } catch {
                /* 隐私模式静默降级，仅当次会话不记忆 */
              }
              return !prev
            })
          }}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {open ? "收起明细" : "展开明细"}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-card-foreground">{probe.headline}</p>

      {open ? (
        <div className="mt-2 border-t border-border pt-2">
          {probe.reasons.length ? (
            <ul className="flex flex-col gap-1">
              {probe.reasons.map((r) => (
                <li key={r} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          ) : null}

          {shown.length ? (
            <ul className="mt-2 flex flex-col gap-1">
              <li className="text-xs font-medium text-muted-foreground">可复用版式目录</li>
              {shown.map((row) => (
                <li key={row.page} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">
                    模板第 {row.page} 页
                  </span>
                  {row.role ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {ROLE_LABEL[row.role]}
                    </span>
                  ) : null}
                  {row.caps.map((c) => (
                    <span key={c} className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                      {c}
                    </span>
                  ))}
                  {row.note ? <span className="min-w-0 flex-1 text-muted-foreground">{row.note}</span> : null}
                </li>
              ))}
              {hidden > 0 ? <li className="text-xs text-muted-foreground">另有 {hidden} 页未列出</li> : null}
            </ul>
          ) : null}

          {probe.advice ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-primary">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {probe.advice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
