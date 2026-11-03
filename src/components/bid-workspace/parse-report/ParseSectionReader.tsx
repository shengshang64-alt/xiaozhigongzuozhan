import { useState, type ReactNode } from "react"
import { BookOpenCheck, ClipboardList, Copy, FileDown, Lock, PencilLine, RefreshCw, ScanSearch, ShieldAlert, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  BASIS_CATEGORY_BADGE,
  basisItemKey,
  COMPILATION_BASIS_KEY,
  PARSE_STATUS_LABEL,
  parseSectionFields,
  sectionStatus,
  type ParseReport,
  type ParseSection,
  type StandardItem,
} from "@/pages/BidWorkspace/bidTypes"
import { buildPurchaseListRows } from "@/pages/BidWorkspace/parseSchemas"
import { pickTableOfKind, type TenderTableRecord } from "@/pages/BidWorkspace/tenderTables"
import { countMarkerLossLines } from "@/pages/BidWorkspace/materialIntegrity"
import { renderDetailLine, STATUS_BADGE } from "./parseReportShared"

const DEGRADED_FOLD_LIMIT = 15

export type SectionReaderActions = {
  onChange: (patch: Partial<ParseReport>) => void
  onReparse?: (key: string) => void
  reparseBusyKey?: string | null
  skillPickerSlot?: ReactNode
  onRescanStar?: () => void
  basisMerged?: StandardItem[]
  onOpenStandardsPicker?: () => void
  restoredTables?: TenderTableRecord[] | null
  onExportPurchaseList?: () => void
}

/**
 * 单个解析项的阅读 / 编辑区：状态、重解析、复制、原表、清单表、降级原文折叠、编制依据合并清单。
 * 列表选择由外层负责，这里只负责「当前这一项」。
 */
export function ParseSectionReader({
  section,
  sections,
  actions,
}: {
  section: ParseSection
  sections: ParseSection[]
  actions: SectionReaderActions
}) {
  const [editKey, setEditKey] = useState<string | null>(null)
  const [expandedDegraded, setExpandedDegraded] = useState<Set<string>>(new Set())
  const editing = editKey === section.key
  const status = sectionStatus(section)
  const busyHere = actions.reparseBusyKey === section.key
  const markerLoss = countMarkerLossLines(section.content)
  const detailLines = section.content.split(/\n+/).filter((l) => l.trim())
  const fieldPairs = parseSectionFields(section)
  const listTable = section.key === "purchase_list" ? buildPurchaseListRows(detailLines) : null
  const restoredTable = section.key === "purchase_list" ? pickTableOfKind(actions.restoredTables, "purchase_list") : null
  const isDegraded = section.content.startsWith("〔系统降级")
  const degradedCollapsed = isDegraded && !expandedDegraded.has(section.key) && detailLines.length > DEGRADED_FOLD_LIMIT
  const shownLines = degradedCollapsed ? detailLines.slice(0, DEGRADED_FOLD_LIMIT) : detailLines

  const patchSection = (content: string) => {
    actions.onChange({
      sections: sections.map((s) => (s.key === section.key ? { ...s, content, human_edited: true } : s)),
    })
  }

  const copyContent = () => {
    void copyTextToClipboard(section.content, {
      successMessage: "解析内容已复制到剪贴板",
      errorMessage: "复制失败，请手动选中内容复制",
    })
  }

  return (
    <section className="flex min-h-96 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold text-foreground">{section.title}</h3>
          {section.key === "star_clauses" && (
            <span className="badge-success inline-flex shrink-0 items-center gap-0.5">
              <Star className="h-3 w-3" />
              重点
            </span>
          )}
          <span className={`shrink-0 ${STATUS_BADGE[status]}`}>{PARSE_STATUS_LABEL[status]}</span>
          {markerLoss > 0 && (
            <span
              title={`本分区有 ${markerLoss} 行疑似丢失 ★/▲ 标注（原文件符号已损坏）。命中行已逐条标出，请对照招标原件核实。`}
              className="badge-warning inline-flex shrink-0 cursor-help items-center gap-1"
            >
              <ShieldAlert className="h-3 w-3" />
              疑符号丢失 {markerLoss} 行
            </span>
          )}
          {section.human_edited && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <PencilLine className="h-3 w-3 text-primary" />
              已人工编辑
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {actions.onOpenStandardsPicker && section.key === COMPILATION_BASIS_KEY && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={actions.onOpenStandardsPicker}
              className="border-primary/40 text-primary hover:bg-primary/10"
              title="从医疗信息化常用规范库勾选补充编制依据（随项目保存）"
            >
              <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
              规范库补选
            </Button>
          )}
          {actions.onRescanStar && section.key === "star_clauses" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={actions.onRescanStar}
              className="text-primary hover:bg-primary/10 hover:text-primary"
              title="从招标文件原文重跑本地扫描（不产生模型费用）"
            >
              <ScanSearch className="mr-1 h-3.5 w-3.5" />
              重新扫描
            </Button>
          )}
          {actions.onReparse && section.key !== "star_clauses" && actions.skillPickerSlot}
          {actions.onReparse && section.key !== "star_clauses" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyHere || actions.reparseBusyKey != null}
              onClick={() => actions.onReparse?.(section.key)}
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busyHere ? "animate-spin" : ""}`} />
              {busyHere ? "重新解析中…" : "重新解析此项"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!section.content.trim()}
            onClick={copyContent}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            复制
          </Button>
          {section.key === "purchase_list" && actions.onExportPurchaseList && (
            <Button type="button" size="sm" variant="outline" onClick={actions.onExportPurchaseList}>
              <FileDown className="mr-1 h-3.5 w-3.5" />
              导出采购清单 Word
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {status === "failed" && section.content.trim() && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
            上次重解析未成功，下面仍是此前的内容。可以再点「重新解析此项」。
          </p>
        )}
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={section.content}
              onChange={(e) => patchSection(e.target.value)}
              className="min-h-72 resize-y border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                编辑后，后续编制、检查、评标都以这份内容为准
              </p>
              <Button type="button" size="sm" onClick={() => setEditKey(null)}>
                完成编辑
              </Button>
            </div>
          </div>
        ) : fieldPairs.length ? (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <tbody>
                {fieldPairs.map((f, i) => (
                  <tr key={`${f.label}-${i}`} className="border-b border-border/60 last:border-0">
                    <th className="w-44 bg-muted/40 px-3 py-2 align-top text-xs font-medium text-muted-foreground">{f.label}</th>
                    <td className="px-3 py-2 text-sm leading-relaxed text-foreground">{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : restoredTable ? (
          <div>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              直接来自上传的文档原表：{restoredTable.rows.length} 行 × {restoredTable.rows[0]?.length ?? 0} 列，未经模型改写
              （来源：{restoredTable.file} 第 {restoredTable.index + 1} 张表）。
            </p>
            <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <tbody>
                  {restoredTable.rows.map((r, ri) => (
                    <tr key={ri} className={ri === 0 ? "sticky top-0 bg-muted/60 font-medium" : "border-t border-border/60 align-top"}>
                      {r.map((c, ci) => (
                        <td key={ci} className="whitespace-pre-wrap px-3 py-2 text-sm text-foreground/90">
                          {c || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : listTable ? (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {listTable.columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listTable.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border/60 align-top">
                    {r.map((cell, j) => (
                      <td key={j} className={`px-3 py-2 text-sm ${j === 1 ? "font-medium text-foreground" : "text-foreground/90"}`}>
                        {cell || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : section.content.trim() ? (
          <div>
            <ul className="flex flex-col gap-1.5">
              {shownLines.map((line, i) => (
                <li key={i} className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm leading-relaxed text-foreground">
                  {renderDetailLine(line, section.key === "star_clauses")}
                </li>
              ))}
            </ul>
            {isDegraded && detailLines.length > DEGRADED_FOLD_LIMIT && (
              <button
                type="button"
                onClick={() =>
                  setExpandedDegraded((prev) => {
                    const next = new Set(prev)
                    if (next.has(section.key)) next.delete(section.key)
                    else next.add(section.key)
                    return next
                  })
                }
                className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {degradedCollapsed ? `展开全部 ${detailLines.length} 行降级原文（当前节选 ${DEGRADED_FOLD_LIMIT} 行）` : "收起降级原文"}
              </button>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                内容可以人工修改。后续编制、检查、评标都以核对后的内容为准
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditKey(section.key)}>
                <PencilLine className="mr-1 h-3.5 w-3.5" />
                编辑
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {status === "failed" ? "这项重新解析没有取到有效内容" : "这项还没有解析"}
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              点右上角「重新解析此项」，只会从招标文件里提取这一项
            </p>
          </div>
        )}
        {section.key === COMPILATION_BASIS_KEY && actions.basisMerged && actions.basisMerged.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">
                合并依据清单 · {actions.basisMerged.length} 条（解析提取和规范库补选，已去重）
              </p>
              {actions.onOpenStandardsPicker && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={actions.onOpenStandardsPicker}
                  className="h-7 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                >
                  <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
                  继续补选
                </Button>
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {actions.basisMerged.map((it) => (
                <li
                  key={basisItemKey(it)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${BASIS_CATEGORY_BADGE[it.category]}`}
                  title={it.category}
                >
                  {it.code ? `${it.code} · ` : ""}
                  {it.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
