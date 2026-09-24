// 投标项目作战室（warroom-01 / A1）：一屏聚合招标要点 + 我方章节进度 + 检查器红黄灯
// + 该客群竞品 battlecard + 相关情报，替代横跨解析/编制/查重/废标/评标/竞品/情报多页人肉找信息。
// 纯前端聚合、只读：标内三源直接取自当前项目已加载数据（零额外请求），竞品/情报按需懒加载，零后端红线。
import { useMemo, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  ExternalLink,
  FileSearch,
  Gauge,
  ListChecks,
  Loader2,
  Newspaper,
  Radar,
  ShieldAlert,
  Swords,
  TriangleAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { listCompetitors, enrichProgress, type CompetitorRow } from "@/pages/Competitors/competitorsCore"
import {
  parseSectionDef,
  scoringItemsFromReport,
  sectionText,
  type BidProjectRecord,
} from "@/pages/BidWorkspace/bidTypes"

// 招标要点：从解析报告里挑最能驱动决策的关键分区（缺项自动跳过），每区展示前若干行原文要点
const TENDER_KEYS = [
  "overview",
  "purchaser_info",
  "qualification",
  "void_items",
  "tech_score",
  "biz_score",
  "bid_nodes",
  "bid_deposit",
]
const TENDER_LINE_CAP = 5

// 竞品/情报懒加载形状
interface IntelBrief {
  id: string
  title: string
  summary: string
  source_name: string
  published_at: string
  url: string
}

type SignalLevel = "danger" | "warning" | "ok" | "info"

const SIGNAL_BADGE: Record<SignalLevel, "danger" | "warning" | "success" | "neutral"> = {
  danger: "danger",
  warning: "warning",
  ok: "success",
  info: "neutral",
}

function signalIcon(level: SignalLevel) {
  if (level === "danger") return <ShieldAlert className="h-4 w-4 text-destructive" />
  if (level === "warning") return <TriangleAlert className="h-4 w-4 text-warning" />
  if (level === "ok") return <CheckCircle2 className="h-4 w-4 text-primary" />
  return <CircleAlert className="h-4 w-4 text-muted-foreground" />
}

/** 单个信息区块：图标 + 标题 + 右侧计数徽标 + 说明，正文由 children 提供 */
function SectionCard(props: { icon: ReactNode; title: string; count?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{props.icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{props.title}</h3>
        {props.count}
      </header>
      {props.hint && <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{props.hint}</p>}
      {props.children}
    </section>
  )
}

/** 取解析分区的前若干非空行（要点直读，超长行截断，避免把整段原文搬进作战室） */
function tenderLines(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TENDER_LINE_CAP)
    .map((l) => (l.length > 80 ? `${l.slice(0, 80)}…` : l))
}

export function BidWarRoom({ activeProject, missCount = 0, riskCount = 0 }: { activeProject: BidProjectRecord; missCount?: number; riskCount?: number }) {
  const [open, setOpen] = useState(false)
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [compState, setCompState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [intel, setIntel] = useState<IntelBrief[]>([])
  const [intelState, setIntelState] = useState<"idle" | "loading" | "done" | "error">("idle")

  const proj = activeProject
  const report = proj.parse_report

  // —— 纯派生（零请求）：招标要点 / 我方章节进度 / 检查器红黄灯 ——
  const tenderSections = useMemo(() => {
    if (!report) return []
    return TENDER_KEYS.map((key) => {
      const content = sectionText(report, key)
      const lines = tenderLines(content)
      return { key, title: parseSectionDef(key)?.title ?? key, lines }
    }).filter((s) => s.lines.length > 0)
  }, [report])

  const scoring = useMemo(() => scoringItemsFromReport(report), [report])

  const chapterStat = useMemo(() => {
    const techRoots = (proj.bid_outline ?? []).filter((n) => n.part !== "biz")
    const generated = (proj.bid_chapters ?? []).filter((c) => (c.content ?? "").trim().length > 0)
    const words = generated.reduce((sum, c) => sum + (c.content ?? "").replace(/\s+/g, "").length, 0)
    return { planTotal: techRoots.length, doneTotal: generated.length, words }
  }, [proj.bid_outline, proj.bid_chapters])

  const fmt = proj.submission_check?.format_report ?? null
  const fmtWarn = fmt ? fmt.hits.filter((h) => h.level === "warn").length : 0
  const fmtInfo = fmt ? fmt.hits.filter((h) => h.level === "info").length : 0

  const signals: { level: SignalLevel; label: string; value: string; icon: ReactNode }[] = [
    {
      level: riskCount > 0 ? "danger" : proj.void_check ? "ok" : "info",
      label: "废标重大风险待核销",
      value: proj.void_check ? `${riskCount} 项` : "未检查",
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    {
      level: missCount > 0 ? "warning" : report ? "ok" : "info",
      label: "招标条款待响应",
      value: report ? `${missCount} 项` : "未解析",
      icon: <ListChecks className="h-4 w-4" />,
    },
    {
      level: fmtWarn > 0 ? "warning" : fmt ? "ok" : "info",
      label: "格式 / 一致性体检",
      value: fmt ? `${fmtWarn} 警告 · ${fmtInfo} 提示` : "未体检",
      icon: <Gauge className="h-4 w-4" />,
    },
    {
      level: proj.dup_report ? (proj.dup_report.suspect_count > 0 ? "warning" : "ok") : "info",
      label: "全文查重疑似",
      value: proj.dup_report ? `${proj.dup_report.suspect_count} 处` : "未查重",
      icon: <FileSearch className="h-4 w-4" />,
    },
    {
      level: proj.ai_review ? "ok" : "info",
      label: "模拟评标得分",
      value: proj.ai_review ? `${proj.ai_review.total_score} 分` : "未评标",
      icon: <Gauge className="h-4 w-4" />,
    },
  ]

  // —— 竞品相关性：竞品名 / 全称 / 关键词命中「采购人 + 标书正文 + 解析报告」文本，即视为该客群具名竞品 ——
  const competitorMatch = useMemo(() => {
    const corpus = [
      proj.hospital,
      proj.project_name,
      proj.tender_text ?? "",
      ...(report?.sections.map((s) => s.content ?? "") ?? []),
    ]
      .join("\n")
      .toLowerCase()
    const scored = competitors.map((c) => {
      const terms = [c.name, c.legal_name, ...(c.keywords ?? [])].map((t) => (t ?? "").trim().toLowerCase()).filter((t) => t.length >= 2)
      const hit = terms.some((t) => corpus.includes(t))
      return { row: c, hit }
    })
    const named = scored.filter((s) => s.hit).map((s) => s.row)
    if (named.length > 0) return { rows: named.slice(0, 4), named: true }
    // 无具名命中：按档案完整度给最常打的 3 家竞品做通用参考（明确标注非本标具名）
    const fallback = [...competitors].sort((a, b) => enrichProgress(b).ratio - enrichProgress(a).ratio).slice(0, 3)
    return { rows: fallback, named: false }
  }, [competitors, proj.hospital, proj.project_name, proj.tender_text, report])

  // —— 懒加载：仅在弹框首次打开时拉取竞品与相关情报，之后复用（事件驱动，非 effect 内同步 setState）——
  const kickedRef = useRef(false)
  const kickLoad = () => {
    if (kickedRef.current) return
    kickedRef.current = true
    setCompState("loading")
    listCompetitors()
      .then(setCompetitors)
      .catch(() => setCompState("error"))
      .finally(() => setCompState("done"))
    const term = (proj.hospital || proj.project_name || "").trim()
    if (!term) {
      setIntelState("done")
      return
    }
    setIntelState("loading")
    const params = new URLSearchParams({ q: term, item_status: "pending,confirmed", page: "1", per_page: "8" })
    fetch(`${getPocketBaseUrl()}/api/intel/items?${params}`, {
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { items?: Record<string, unknown>[] }) => {
        const rows = (data.items ?? []).map((it) => ({
          id: String(it.id ?? ""),
          title: String(it.title ?? ""),
          summary: String(it.summary ?? it.content_snippet ?? ""),
          source_name: String(it.source_name ?? ""),
          published_at: String(it.published_at ?? ""),
          url: String(it.url ?? ""),
        }))
        setIntel(rows)
        setIntelState("done")
      })
      .catch(() => setIntelState("error"))
  }

  const tenderTotal = report ? report.sections.length : 0

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) kickLoad() }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="shrink-0 border-primary/40 text-primary hover:bg-primary/10">
          <Radar className="mr-1.5 h-4 w-4" />
          作战室
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            投标作战室
            <span className="truncate text-sm font-normal text-muted-foreground">{proj.project_name}</span>
          </DialogTitle>
          <DialogDescription>
            {proj.hospital || "采购人未填写"}
            {proj.bid_open_date ? ` · 开标 ${proj.bid_open_date}` : ""} · 一屏聚合招标要点、编制进度、风险灯、竞品与情报
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[68vh] pr-3">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 检查器红黄灯 */}
            <SectionCard icon={<ShieldAlert className="h-4 w-4" />} title="风险信号灯" hint="各检查器最新状态，点击查看对应步骤详情">
              <ul className="space-y-1.5">
                {signals.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5">
                    {signalIcon(s.level)}
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.label}</span>
                    <Badge variant={SIGNAL_BADGE[s.level]} className="shrink-0">{s.value}</Badge>
                  </li>
                ))}
              </ul>
            </SectionCard>

            {/* 我方章节进度 */}
            <SectionCard
              icon={<ClipboardList className="h-4 w-4" />}
              title="我方技术章进度"
              count={<Badge variant={chapterStat.doneTotal > 0 && chapterStat.doneTotal >= chapterStat.planTotal ? "success" : "neutral"}>{chapterStat.doneTotal}/{chapterStat.planTotal} 章</Badge>}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                已生成正文合计约 <span className="font-semibold text-foreground">{chapterStat.words.toLocaleString()}</span> 字。
                {chapterStat.planTotal === 0
                  ? "尚未生成大纲，先到「方案编制」确认大纲。"
                  : chapterStat.doneTotal < chapterStat.planTotal
                    ? `还有 ${chapterStat.planTotal - chapterStat.doneTotal} 章待编制。`
                    : "技术章已全部成稿，可进入检查环节。"}
              </p>
            </SectionCard>

            {/* 招标要点 */}
            <SectionCard
              icon={<FileSearch className="h-4 w-4" />}
              title="招标要点"
              count={scoring.length > 0 ? <Badge variant="neutral">{scoring.length} 个评分项</Badge> : undefined}
              hint={report ? `解析报告 ${tenderTotal} 个分区中的关键项，逐区取前 ${TENDER_LINE_CAP} 行要点` : "尚未运行 AI 解析，暂无招标要点"}
            >
              {!report ? (
                <p className="text-xs text-muted-foreground">上传招标文件后运行解析，这里会聚合评分、资质、废标、节点等要点。</p>
              ) : tenderSections.length === 0 ? (
                <p className="text-xs text-muted-foreground">解析报告已生成但关键分区为空，请到「AI 解析报告」核对补充。</p>
              ) : (
                <div className="space-y-3">
                  {scoring.length > 0 && (
                    <div className="rounded-lg bg-secondary/60 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-foreground">评分构成</p>
                      <div className="flex flex-wrap gap-1.5">
                        {scoring.slice(0, 8).map((sc, i) => (
                          <span key={i} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" title={sc.criteria}>
                            {sc.item.slice(0, 12)} · {sc.score}分
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tenderSections.map((sec) => (
                    <div key={sec.key}>
                      <p className="mb-1 text-xs font-semibold text-foreground">{sec.title}</p>
                      <ul className="space-y-0.5">
                        {sec.lines.map((ln, i) => (
                          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                            <span className="min-w-0 flex-1">{ln}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* 竞品 battlecard */}
            <SectionCard
              icon={<Swords className="h-4 w-4" />}
              title="该客群竞品 battlecard"
              count={competitorMatch.rows.length > 0 ? <Badge variant={competitorMatch.named ? "warning" : "neutral"}>{competitorMatch.rows.length} 家</Badge> : undefined}
              hint={competitorMatch.named ? "按竞品名/关键词命中本标书文本识别（含甲方参数指向）" : undefined}
            >
              {compState === "loading" && <InlineLoader text="正在加载竞品档案…" />}
              {compState === "error" && <InlineError text="竞品档案加载失败" />}
              {compState === "done" && competitorMatch.rows.length === 0 && (
                <EmptyWithLink to="/competitors" text="暂无竞品档案，去「竞品分析」建立基线" />
              )}
              {compState === "done" && competitorMatch.rows.length > 0 && (
                <div className="space-y-2.5">
                  {!competitorMatch.named && (
                    <p className="text-[11px] text-muted-foreground">未在本标书命中具名竞品，以下为常用竞品档案供参考（仅供内部研判）。</p>
                  )}
                  {competitorMatch.rows.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border/70 bg-background p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{c.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">软著 {c.software_copyrights}</span>
                      </div>
                      <BattleField label="我方优势位" text={c.strengths} />
                      <BattleField label="其软肋" text={c.weaknesses} />
                      <BattleField label="威胁与应对" text={c.threat_notes} />
                    </div>
                  ))}
                  <Link to="/competitors" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    竞品分析 <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </SectionCard>

            {/* 相关情报 */}
            <SectionCard icon={<Newspaper className="h-4 w-4" />} title="相关情报" hint={intel.length > 0 ? `按「${proj.hospital || proj.project_name}」检索情报中心` : undefined}>
              {intelState === "loading" && <InlineLoader text="正在检索相关情报…" />}
              {intelState === "error" && <InlineError text="情报检索失败" />}
              {intelState === "done" && intel.length === 0 && <p className="text-xs text-muted-foreground">暂无与该采购人/项目相关的情报条目。</p>}
              {intelState === "done" && intel.length > 0 && (
                <ul className="space-y-2">
                  {intel.map((it) => (
                    <li key={it.id}>
                      <Link to={`/intel-center?item=${encodeURIComponent(it.id)}`} className="group block">
                        <p className="line-clamp-2 text-xs font-medium text-foreground group-hover:text-primary">{it.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {it.source_name}
                          {it.published_at ? ` · ${it.published_at.slice(0, 10)}` : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function InlineLoader({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {text}
    </p>
  )
}

function InlineError({ text }: { text: string }) {
  return <p className="text-xs text-destructive">{text}，请稍后重试</p>
}

function EmptyWithLink({ to, text }: { to: string; text: string }) {
  return (
    <Link to={to} className="text-xs font-medium text-primary hover:underline">
      {text}
    </Link>
  )
}

/** battlecard 单行：label + 内容（空则跳过），内容截断防撑爆卡片 */
function BattleField({ label, text }: { label: string; text: string }) {
  const t = (text ?? "").trim()
  if (!t) return null
  const shown = t.length > 90 ? `${t.slice(0, 90)}…` : t
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{label}：</span>
      {shown}
    </p>
  )
}
