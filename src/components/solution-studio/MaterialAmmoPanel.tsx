import type { ReactNode } from "react"
import { Archive, BookOpen, CornerDownLeft, Library, Loader2, MessageSquareQuote, PanelRightClose, PanelRightOpen, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"

// ---------------------------------------------------------------------------
// 素材弹药面板（轮次 E-1）：知识库 / 弹药库 / 历史方案 三来源检索，
// 引用即复制——「插入正文」只写当前章节草稿，绝不修改任何源文档 / 源方案。
// ---------------------------------------------------------------------------

type MaterialAmmoPanelProps = Pick<
  UseSolutionStudio,
  | "materialTab"
  | "setMaterialTab"
  | "materialQueryInput"
  | "setMaterialQueryInput"
  | "materialQuery"
  | "materialKbHits"
  | "materialAmmoPairs"
  | "materialHistoryBlocks"
  | "materialLoading"
  | "insertMaterialToChapter"
  | "activeChapterId"
  | "solutions"
> & {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 历史方案页签空态：打开「拆块入素材库」向导 */
  onOpenKbWizard: () => void
}

const TABS: { key: "kb" | "ammo" | "history"; label: string }[] = [
  { key: "kb", label: "知识库" },
  { key: "ammo", label: "弹药库" },
  { key: "history", label: "历史方案" },
]

function InsertButton({
  disabled,
  onInsert,
}: {
  disabled: boolean
  onInsert: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      title={disabled ? "先在右侧选中章节" : "插入到正文光标处"}
      // preventDefault 保住 textarea 焦点与光标位置，插入才能落在光标处
      onMouseDown={(e) => e.preventDefault()}
      onClick={onInsert}
      className="shrink-0 border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
    >
      <CornerDownLeft className="mr-1 h-3.5 w-3.5" />
      插入正文
    </Button>
  )
}

function MaterialCard({
  title,
  badge,
  snippet,
  disabled,
  onInsert,
}: {
  title: string
  badge?: string
  snippet: string
  disabled: boolean
  onInsert: () => void
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{title}</p>
          {badge && (
            <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>
          )}
        </div>
        <InsertButton disabled={disabled} onInsert={onInsert} />
      </div>
      <p className="mt-2 line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{snippet}</p>
    </article>
  )
}

function EmptyHint({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {action}
    </div>
  )
}

export function MaterialAmmoPanel(p: MaterialAmmoPanelProps) {
  const canInsert = Boolean(p.activeChapterId)

  if (p.collapsed) {
    return (
      <aside className="flex h-full min-h-32 flex-col items-center gap-3 rounded-lg border border-border bg-card py-3 shadow-md">
        <button
          type="button"
          onClick={p.onToggleCollapsed}
          title="展开素材栏"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <Library className="h-4 w-4 text-primary" />
        <span className="mt-1 text-xs tracking-widest text-muted-foreground [writing-mode:vertical-rl]">素材弹药</span>
      </aside>
    )
  }

  return (
    <aside className="flex h-full max-h-[calc(100vh-9rem)] flex-col rounded-lg border border-border bg-card shadow-md lg:sticky lg:top-20">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Library className="h-4 w-4 text-primary" />
          素材弹药
        </p>
        <button
          type="button"
          onClick={p.onToggleCollapsed}
          title="收起素材栏"
          className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:block"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={p.materialQueryInput}
            onChange={(e) => p.setMaterialQueryInput(e.target.value)}
            placeholder="搜索团队素材…"
            className="h-8 pl-8 text-xs focus-visible:shadow-[var(--focus-ring)]"
          />
        </div>
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = p.materialTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => p.setMaterialTab(t.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "bg-secondary text-muted-foreground hover:text-primary"
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {p.materialLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            素材来源加载中…
          </div>
        ) : p.materialTab === "kb" ? (
          !p.materialQuery ? (
            <EmptyHint
              icon={<BookOpen className="h-7 w-7" />}
              title="输入关键词检索团队素材"
              desc="按块命中知识库文档，脱敏与禁入策略自动生效"
            />
          ) : p.materialKbHits.length === 0 ? (
            <EmptyHint icon={<BookOpen className="h-7 w-7" />} title="没有命中的知识块" desc="换个关键词，或到弹药库 / 历史方案找找" />
          ) : (
            p.materialKbHits.map((hit, i) => (
              <MaterialCard
                key={`${hit.doc.id}-${hit.chunkStart ?? "doc"}-${i}`}
                title={hit.doc.title}
                badge={hit.headingPath || hit.doc.folder_path || "知识库"}
                snippet={hit.snippet}
                disabled={!canInsert}
                onInsert={() => p.insertMaterialToChapter(hit.snippet, `《${hit.doc.title}》${hit.headingPath ? ` · ${hit.headingPath}` : ""}`)}
              />
            ))
          )
        ) : p.materialTab === "ammo" ? (
          p.materialAmmoPairs.length === 0 ? (
            <EmptyHint
              icon={<MessageSquareQuote className="h-7 w-7" />}
              title={p.materialQuery ? "没有匹配的标准问答" : "弹药库还是空的"}
              desc={p.materialQuery ? "换个关键词试试" : "到知识中心沉淀已审批的标准问答后，这里可直接引用"}
            />
          ) : (
            p.materialAmmoPairs.map((pair) => (
              <MaterialCard
                key={pair.id}
                title={pair.question}
                badge={pair.category || "标准问答"}
                snippet={pair.answer}
                disabled={!canInsert}
                onInsert={() => p.insertMaterialToChapter(pair.answer, `弹药库 · ${pair.question}`)}
              />
            ))
          )
        ) : p.materialHistoryBlocks.length === 0 ? (
          p.solutions.length === 0 ? (
            <EmptyHint
              icon={<Archive className="h-7 w-7" />}
              title="还没有历史方案"
              desc="创建方案并生成正文后，可拆块入素材库供后续项目复用"
            />
          ) : (
            <EmptyHint
              icon={<Archive className="h-7 w-7" />}
              title={p.materialQuery ? "没有匹配的成稿章节" : "还没有可引用的成稿章节"}
              desc={p.materialQuery ? "换个关键词试试" : "章节生成正文后即可作为素材引用"}
              action={
                <Button size="sm" variant="outline" onClick={p.onOpenKbWizard} className="mt-1 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
                  把当前方案拆块入素材库
                </Button>
              }
            />
          )
        ) : (
          <>
            {!p.materialQuery && (
              <Button size="sm" variant="ghost" onClick={p.onOpenKbWizard} className="w-full text-xs text-muted-foreground hover:text-primary">
                <Archive className="mr-1 h-3.5 w-3.5" />
                把当前方案拆块入素材库，沉淀可检索素材
              </Button>
            )}
            {p.materialHistoryBlocks.map((block) => (
              <MaterialCard
                key={block.key}
                title={`${block.solutionName} · ${block.chapterTitle}`}
                badge="历史方案"
                snippet={block.text}
                disabled={!canInsert}
                onInsert={() => p.insertMaterialToChapter(block.text, `${block.solutionName} · ${block.chapterTitle}`)}
              />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        引用即复制，插入后记得改写融合，源文档不受影响
      </div>
    </aside>
  )
}
