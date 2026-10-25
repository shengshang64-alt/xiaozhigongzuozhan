import { BriefcaseBusiness, Check, Copy, ExternalLink, FileStack, Flag, Sparkles, Star, X } from "lucide-react"
import { copyTextToClipboard } from "@/lib/clipboard"
import { cleanIntelSummary } from "@/pages/IntelCenter/intelBodyClean"
import {
  fmtIntelTime,
  ITEM_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type IntelItemRow,
} from "@/pages/IntelCenter/useIntelCenter"

type IntelDetailPanelProps = {
  item: IntelItemRow | null
  starred: boolean
  aiTagging: boolean
  lead: boolean
  onClose: () => void
  onConfirm: (item: IntelItemRow) => void
  onIgnore: (item: IntelItemRow) => void
  onAiTag: (item: IntelItemRow) => void
  onToggleStar: (item: IntelItemRow) => void
  onToggleLead: (item: IntelItemRow) => void
  onCreateBidTask: (item: IntelItemRow) => void
  onConvertToOpp: (item: IntelItemRow) => void
}

/** 右栏固定详情面板：未选中时展示引导空态（对齐重构原型三栏布局，取代原overlay抽屉） */
export function IntelDetailPanel({
  item,
  starred,
  aiTagging,
  lead,
  onClose,
  onConfirm,
  onIgnore,
  onAiTag,
  onToggleStar,
  onToggleLead,
  onCreateBidTask,
  onConvertToOpp,
}: IntelDetailPanelProps) {
  if (!item) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border bg-card p-6 text-center shadow-md">
        <FileStack className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">点击左侧情报查看详情</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          选中后可查看招标要素与 AI 摘要，标记项目线索或一键新建标书任务
        </p>
      </div>
    )
  }
  // R64：摘要统一走展示层清洗（剥站点名前缀/JSON 元数据块），与列表卡片、首页动态卡同口径
  const summaryText = item.summary ? cleanIntelSummary(item.summary, 600) : ""
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">情报详情</h2>
        <span
          className={
            item.my_status === "confirmed"
              ? "badge-success"
              : item.my_status === "ignored"
                ? "badge-neutral"
                : "badge-warning"
          }
        >
          {ITEM_STATUS_LABEL[item.my_status || "pending"] ?? "待确认"}
        </span>
        {lead && <span className="badge-warning border-violet-400/60 bg-violet-500/10 text-violet-600">线索</span>}
        <button
          type="button"
          onClick={() => onToggleStar(item)}
          className="ml-auto rounded-md p-1 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title={starred ? "取消收藏" : "收藏"}
        >
          <Star className={starred ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4 text-muted-foreground"} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="关闭详情"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3.5 py-3.5">
        <h3 className="text-base font-semibold leading-snug text-foreground">{item.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.item_type && (
            <span className="rounded-full bg-muted px-2 py-0.5">{SOURCE_TYPE_LABEL[item.item_type] ?? item.item_type}</span>
          )}
          {item.region && <span className="rounded-full border border-dashed border-border px-2 py-0.5">{item.region}</span>}
          <span>{item.source_name || (item.added_by === "manual" ? "手动录入" : "未知来源")}</span>
          <span>{fmtIntelTime(item.published_at || item.created)}</span>
        </div>

        {item.structured && (
          <section className="mt-3.5 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold text-foreground">招标要素（自动抽取，未经人工核对）</p>
            <dl className="mt-2 grid grid-cols-[3.8rem_1fr] gap-x-2.5 gap-y-1.5 text-sm">
              {item.structured.buyer && (
                <>
                  <dt className="text-muted-foreground">采购方</dt>
                  <dd className="break-all text-foreground">{item.structured.buyer}</dd>
                </>
              )}
              {item.structured.budget && (
                <>
                  <dt className="text-muted-foreground">预算</dt>
                  <dd className="text-foreground">{item.structured.budget}</dd>
                </>
              )}
              {item.structured.deadline && (
                <>
                  <dt className="text-muted-foreground">截止</dt>
                  <dd className="text-foreground">{item.structured.deadline}</dd>
                </>
              )}
              {item.structured.code && (
                <>
                  <dt className="text-muted-foreground">编号</dt>
                  <dd className="break-all text-foreground">{item.structured.code}</dd>
                </>
              )}
              {item.structured.winner && (
                <>
                  <dt className="text-muted-foreground">中标方</dt>
                  <dd className="break-all text-foreground">{item.structured.winner}</dd>
                </>
              )}
              {item.structured.won_amount && (
                <>
                  <dt className="text-muted-foreground">中标金额</dt>
                  <dd className="text-foreground">{item.structured.won_amount}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {summaryText && (
          <section className="mt-3.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center justify-between text-xs font-semibold text-primary">
              AI 摘要
              <button
                type="button"
                onClick={() => {
                  const text = (item.title ? item.title + "\n" : "") + summaryText
                  void copyTextToClipboard(text, {
                    successMessage: "已复制标题与摘要",
                    errorMessage: "复制失败，请手动选择文本",
                  })
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{summaryText}</p>
          </section>
        )}

        {item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}

        {item.content_snippet && (
          <section className="mt-3.5">
            <p className="text-xs font-semibold text-muted-foreground">内容片段</p>
            <p className="mt-1.5 line-clamp-8 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-muted-foreground">
              {item.content_snippet}
            </p>
          </section>
        )}

        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3.5 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-card-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ExternalLink className="h-4 w-4 text-primary" />
            查看原文
          </a>
        )}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-border px-3.5 py-3">
        <button
          type="button"
          onClick={() => onCreateBidTask(item)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="按情报中的采购方、招标编号、截止时间预填创建标书任务并跳转标书工作区"
        >
          <FileStack className="h-4 w-4" />
          一键新建标书任务
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleLead(item)}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
              lead
                ? "border-violet-400/60 bg-violet-500/10 text-violet-600"
                : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
            title={lead ? "取消项目线索标记" : "标记为项目线索（个人视角，便于跟进）"}
          >
            <Flag className={lead ? "h-3.5 w-3.5 fill-violet-500 text-violet-600" : "h-3.5 w-3.5"} />
            {lead ? "已标线索" : "标记线索"}
          </button>
          <button
            type="button"
            onClick={() => onAiTag(item)}
            disabled={aiTagging}
            className="flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Sparkles className={aiTagging ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {aiTagging ? "分析中…" : item.summary ? "重新打标" : "AI 打标"}
          </button>
          <button
            type="button"
            onClick={() => onConvertToOpp(item)}
            title="带情报预填信息跳转客户管理新建商机"
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BriefcaseBusiness className="h-3.5 w-3.5 text-primary" />
            转商机
          </button>
          {item.my_status !== "confirmed" && (
            <button
              type="button"
              onClick={() => onConfirm(item)}
              title="只更新你自己的确认状态"
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Check className="h-3.5 w-3.5 text-primary" />
              确认
            </button>
          )}
          {item.my_status !== "ignored" && (
            <button
              type="button"
              onClick={() => onIgnore(item)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-3.5 w-3.5" />
              忽略
            </button>
          )}
        </div>
      </footer>
    </section>
  )
}
