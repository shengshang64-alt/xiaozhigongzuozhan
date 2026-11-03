import { useLayoutEffect, useRef, useState } from "react"
import { sectionSnippet, sectionStatus, PARSE_STATUS_LABEL, parseSectionTier, STAR_CLAUSE_SECTION, PARSE_KEY_SECTIONS, type ParseReport, type ParseSection } from "@/pages/BidWorkspace/bidTypes"
import { ParseSummaryBoard } from "../ParseSummaryBoard"
import type { SummaryColumn } from "@/pages/BidWorkspace/parseSummary"
import { ParseSectionReader, type SectionReaderActions } from "./ParseSectionReader"
import { STATUS_BADGE } from "./parseReportShared"
import type { ParsePanelView } from "./parseReportLayout"

const KEY_SECTION_KEYS = new Set(PARSE_KEY_SECTIONS.map((d) => d.key))

/**
 * 「解析项明细」：三栏摘要，或左列表 + 右详情。
 * 完整解析默认只列关键项，右上角可展开全部。
 */
export function ParseItemsPane({
  report,
  columns,
  requiredFailureKeys,
  view,
  onView,
  selectedKey,
  onSelect,
  actions,
}: {
  report: ParseReport
  columns: SummaryColumn[]
  requiredFailureKeys: Set<string>
  view: ParsePanelView
  onView: (view: ParsePanelView) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  actions: SectionReaderActions
}) {
  const scope = report.scope
  const [keyOnlyOverride, setKeyOnlyOverride] = useState<{ scope: string; value: boolean } | null>(null)
  const keyOnly = keyOnlyOverride && keyOnlyOverride.scope === scope ? keyOnlyOverride.value : scope === "full"
  const sections = report.sections
  const isFull = scope === "full"
  const keyFiltered = sections.filter((s) => KEY_SECTION_KEYS.has(s.key) || s.key === STAR_CLAUSE_SECTION.key)
  const shown = isFull && keyOnly && keyFiltered.length > 0 ? keyFiltered : sections
  const selected: ParseSection = shown.find((s) => s.key === selectedKey) ?? shown[0]
  const okAll = sections.filter((s) => sectionStatus(s) === "ok").length
  const pctAll = sections.length ? Math.round((okAll / sections.length) * 100) : 0
  const okShown = shown.filter((s) => sectionStatus(s) === "ok").length
  const listRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const ul = listRef.current
    const el = ul?.querySelector("[data-selected='true']")
    if (!ul || !(el instanceof HTMLElement)) return
    const delta = el.getBoundingClientRect().top - ul.getBoundingClientRect().top
    ul.scrollTop += delta - 8
  }, [selected.key])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          {(
            [
              ["summary", "三栏摘要"],
              ["detail", "逐项查看"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onView(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          已解析 {okAll}/{sections.length} 项
        </span>
      </div>
      {view === "summary" ? (
        <ParseSummaryBoard
          columns={columns}
          onOpen={(key) => {
            onSelect(key)
            onView("detail")
          }}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="flex max-h-[calc(100vh-280px)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
            <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">解析项</h3>
              <div className="flex shrink-0 items-center gap-2">
                {isFull && keyFiltered.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setKeyOnlyOverride({ scope, value: !keyOnly })}
                    className="rounded-full border border-primary/40 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    title={keyOnly ? "展开查看其余解析项" : "只看关键项和重点条款"}
                  >
                    {keyOnly ? `全部 ${sections.length} 项` : "只看关键项"}
                  </button>
                )}
                <span className="text-xs text-muted-foreground">
                  {okShown}/{shown.length}
                </span>
              </div>
            </header>
            <div className="shrink-0 border-b border-border px-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">解析进度</span>
                <span className="font-semibold tabular-nums text-primary">
                  {okAll}/{sections.length}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pctAll}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">点一项查看原文。失败或未解析的项可以单独重解析。</p>
            </div>
            <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
              {shown.map((s) => {
                const st = sectionStatus(s)
                const active = s.key === selected.key
                const tier = parseSectionTier(s.key)
                const showRequired = tier === "required" && st !== "ok"
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(s.key)}
                      data-selected={active ? "true" : "false"}
                      className={`mb-1 flex w-full items-start gap-2 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        active ? "border-primary/50 bg-primary/5 shadow-sm" : "border-transparent hover:bg-secondary"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {s.key === "star_clauses" && <span className="badge-success mr-1 align-middle">★</span>}
                          {showRequired && (
                            <span
                              className={`mr-1 align-middle ${
                                requiredFailureKeys.has(s.key) ? "badge-danger" : "badge-success"
                              }`}
                            >
                              必选
                            </span>
                          )}
                          {s.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sectionSnippet(s) || "暂无内容"}</span>
                      </span>
                      <span className={`shrink-0 ${STATUS_BADGE[st]}`}>{PARSE_STATUS_LABEL[st]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
          <ParseSectionReader section={selected} sections={sections} actions={actions} />
        </div>
      )}
    </div>
  )
}
