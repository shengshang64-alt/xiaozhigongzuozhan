import { Download, Clock, Loader2, Plus, Presentation, Search, Trash2, Users } from "lucide-react"
import { CompanyTemplateHint } from "@/components/common/CompanyTemplateHint"
import { DECK_STATUS_LABEL, deckTypeLabel, type DeckRecord } from "@/pages/PptQuote/pptQuoteTypes"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import { formatShortDateTime } from "@/lib/dateDisplay"

type DeckListPanelProps = {
  decks: DeckRecord[]
  listLoading: boolean
  search: string
  setSearch: (value: string) => void
  onNew: () => void
  onOpen: (deck: DeckRecord) => void
  onDelete: (deck: DeckRecord) => void
}

export function DeckListPanel({
  decks,
  listLoading,
  search,
  setSearch,
  onNew,
  onOpen,
  onDelete,
}: DeckListPanelProps) {
  const handleExportDecks = () => {
    const headers = ["PPT名称", "类型", "受众", "时长(分)", "页数", "状态", "创建时间", "更新时间"]
    const rows = decks.map((d) => [d.deck_name, d.deck_type, d.audience, d.duration_min, d.slides?.length ?? 0, d.doc_status, d.created, d.updated])
    exportToCsv(`PPT列表_${localDateStamp()}.csv`, headers, rows)
  }

  return (
    <section className="pb-16">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-8 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-primary">汇报 PPT</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
              医疗售前<span className="text-primary">汇报 PPT</span> 生产线
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              选类型、填主题，AI 生成逐页大纲与讲稿备注；可引入方案或标书素材，逐页精修后导出可编辑的 .pptx 与 Word 讲稿。
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportDecks}
            disabled={decks.length === 0}
            title="导出 PPT 列表"
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            新建 PPT
          </button>
        </div>
        {/* R-203：本场景配套的公司标准模版（附件5 PPT 模板 + 格式规范），点击即下载 */}
        <CompanyTemplateHint scenario="ppt" extraScenario="spec" />
      </header>

      <div className="mt-5 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 PPT 名称或汇报对象"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <span className="text-xs text-muted-foreground">共 {decks.length} 份</span>
      </div>

      {listLoading ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在加载…
        </p>
      ) : decks.length === 0 && search.trim() ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">没有匹配的结果</p>
          <p className="max-w-sm text-xs text-muted-foreground">换个关键词试试，或清除搜索浏览全部 PPT</p>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            清除筛选
          </button>
        </div>
      ) : decks.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <Presentation className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">还没有汇报 PPT</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            选择通用介绍、规划汇报或专题汇报，AI 会按医疗售前场景生成整份逐页内容
          </p>
          {/* UX-R2：空态主行动居中放大（比右上角按钮更醒目） */}
          <button
            type="button"
            onClick={onNew}
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Presentation className="h-5 w-5" />
            新建汇报 PPT
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => (
            <article
              key={deck.id}
              className="group flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg lg:p-5"
            >
              <button type="button" onClick={() => onOpen(deck)} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-primary">{deck.deck_name}</h3>
                  <span className="badge-neutral shrink-0">
                    {deckTypeLabel(deck.deck_type)}
                  </span>
                </div>
              </button>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Presentation className="h-3.5 w-3.5" />
                  {deck.slides?.length ?? 0} 页
                </span>
                {deck.audience && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {deck.audience}
                  </span>
                )}
                {!!deck.duration_min && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {deck.duration_min} 分钟
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <span className="text-xs text-muted-foreground">
                  {DECK_STATUS_LABEL[deck.doc_status] ?? ""} · {formatShortDateTime(deck.updated)}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpen(deck)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    打开编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(deck)}
                    aria-label="删除"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
