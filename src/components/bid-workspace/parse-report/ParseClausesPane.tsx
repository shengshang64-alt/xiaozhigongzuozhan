import { ShieldAlert } from "lucide-react"
import {
  groupImplicitConstraints,
  type ImplicitConstraintKind,
  type ParseSection,
} from "@/pages/BidWorkspace/bidTypes"
import { ParseSectionReader, type SectionReaderActions } from "./ParseSectionReader"
import { countStarClauseLines } from "./parseReportLayout"

/**
 * 「重点条款与硬约束」：★/▲ 原文，以及页数、份数、装订、视为无效这类本地抽出的硬约束。
 */
export function ParseClausesPane({
  starSection,
  sections,
  implicitList,
  actions,
}: {
  starSection: ParseSection | null
  sections: ParseSection[]
  implicitList: string[]
  actions: SectionReaderActions
}) {
  const grouped = groupImplicitConstraints(implicitList)
  const starCount = countStarClauseLines(starSection?.content)
  const groups: { key: ImplicitConstraintKind; label: string; hint: string; items: string[]; tone: string }[] = [
    {
      key: "void" as const,
      label: "违反即废标",
      hint: "带「视为无效 / 不合格 / 作废标处理」等明确后果",
      items: grouped.void,
      tone: "border-destructive/30 bg-destructive/5 text-foreground",
    },
    {
      key: "format" as const,
      label: "投标形式要求",
      hint: "页数、份数、装订、签署、上传解密",
      items: grouped.format,
      tone: "border-warning/40 bg-warning/10 text-foreground",
    },
    {
      key: "other" as const,
      label: "其他约束",
      hint: "合规性、报价口径、资格条件等一般性要求",
      items: grouped.other,
      tone: "border-border bg-background text-foreground",
    },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {starSection ? (
        <ParseSectionReader section={starSection} sections={sections} actions={actions} />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center shadow-md">
          <p className="text-sm font-medium text-foreground">还没有扫到 ★/▲ 重点条款</p>
          <p className="mt-1 text-xs text-muted-foreground">招标原文里如果有 ★ 或 ▲，可以点重新扫描。扫描在本地完成，不产生模型费用。</p>
          {actions.onRescanStar && (
            <button
              type="button"
              onClick={actions.onRescanStar}
              className="mt-3 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              重新扫描
            </button>
          )}
        </div>
      )}
      <section className="rounded-lg border border-border bg-card shadow-md">
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          <h3 className="text-sm font-semibold text-foreground">隐式硬约束</h3>
          {grouped.void.length > 0 && <span className="badge-danger">废标 {grouped.void.length}</span>}
          <span className="badge-neutral">共 {implicitList.length} 条</span>
          {starCount > 0 && <span className="text-xs text-muted-foreground">重点条款 {starCount} 条见上方</span>}
        </header>
        {implicitList.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">没有从原文抽出页数、份数或「视为无效」一类硬约束。</p>
        ) : (
          <div className="p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              先看红色「会废标」，再看投标形式，其余是一般性约束。由原文本地抽出，不产生模型费用。
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold text-foreground">{g.label}</span>
                    <span className="badge-neutral">{g.items.length} 条</span>
                    <span className="text-xs text-muted-foreground">{g.hint}</span>
                  </div>
                  <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                    {g.items.map((t, i) => (
                      <li key={`${g.key}-${i}`} className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${g.tone}`}>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
