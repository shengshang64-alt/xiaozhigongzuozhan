import { useEffect, useMemo, useState, type ReactNode } from "react"
import { copyTextToClipboard } from "@/lib/clipboard"
import { BookOpenCheck, ClipboardList, Copy, Lock, PencilLine, RefreshCw, ScanSearch, ShieldAlert, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  BASIS_CATEGORY_BADGE,
  basisItemKey,
  COMPILATION_BASIS_KEY,
  extractImplicitConstraints,
  PARSE_KEY_SECTIONS,
  PARSE_STATUS_LABEL,
  STAR_CLAUSE_SECTION,
  sectionSnippet,
  sectionStatus,
  summarizeParseWarnings,
  parseLotsLineInfo,
  type LotsScope,
  type ParseReport,
  type ParseSection,
  type ParseSectionStatus,
  type StandardItem,
} from "@/pages/BidWorkspace/bidTypes"

type ParseReportPanelProps = {
  report: ParseReport | null
  onChange: (patch: Partial<ParseReport>) => void
  /** 单项重解析（项目流水线与快捷工具都接入）；不传则隐藏按钮 */
  onReparse?: (key: string) => void
  reparseBusyKey?: string | null
  /** 单项重解析入口旁的「带入技能」选择器（bid-parse 功能点） */
  skillPickerSlot?: ReactNode
  /** 第七轮改造 3：招标文件全文（本地抽取隐式硬约束展示区；不传则不显示该区） */
  tenderText?: string
  /** 第八轮改造 1：分段解析失败提示（顶部横幅；空数组/不传则不显示） */
  warnings?: string[]
  /** 第十二轮改造 2：★/▲ 重点条款「重新扫描」（本地扫描零费用；不传则隐藏按钮） */
  onRescanStar?: () => void
  /** 第十七轮 17B：编制依据合并清单（解析提取 ∪ 规范库补选，已去重）；不传则不显示清单区 */
  basisMerged?: StandardItem[]
  /** 第十七轮 17B：「规范库补选」对话框入口；不传则隐藏按钮（快捷工具无项目上下文时不传） */
  onOpenStandardsPicker?: () => void
}

const STATUS_BADGE: Record<ParseSectionStatus, string> = {
  ok: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
  miss: "bg-amber-500/10 text-amber-600",
}

/** 第十二轮改造 2：重点条款只读渲染时行首 ★/▲ 标记高亮（允许编号前缀） */
const STAR_LINE_HEAD_RE = /^(\s*(?:\d+[.、)）]\s*)?[★☆▲△]+)/

// 关键项 key 集合：PARSE_KEY_SECTIONS 为模块级常量，此处一次性求值即可，
// 无需在组件内用 useMemo（早于任何提前 return，规避条件性 Hook 调用崩溃）
const PARSE_KEY_SECTION_KEYS = new Set(PARSE_KEY_SECTIONS.map((d) => d.key))

function renderStarLine(line: string): ReactNode {
  const m = line.match(STAR_LINE_HEAD_RE)
  if (!m) return line
  return (
    <>
      <span className="font-semibold text-primary">{m[1]}</span>
      {line.slice(m[1].length)}
    </>
  )
}

/**
 * 解析报告主详情布局：左栏项列表（进度 N/M + 进度条 + 每项一句摘要与状态徽标，点选高亮），
 * 右栏选中项详情（状态徽标 + 重新解析此项 + 复制 + 结构化内容 + 人工编辑保存）。
 */
export function ParseReportPanel({ report, onChange, onReparse, reparseBusyKey, skillPickerSlot, tenderText, warnings, onRescanStar, basisMerged, onOpenStandardsPicker }: ParseReportPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  // 用户反馈轮：完整解析报告默认只看关键项（关键项 + 重点条款），可一键展开全部项
  const [keyOnly, setKeyOnly] = useState(false)
  // Q26 切片A：降级分区原文默认折叠（节选前若干行），按项 key 记忆展开态，防 2 万字碎片铺满列表
  const [expandedDegraded, setExpandedDegraded] = useState<Set<string>>(new Set())
  useEffect(() => {
    setKeyOnly(report?.scope === "full")
  }, [report?.scope])
  // 第七轮改造 3：本地正则抽取的招标隐式硬约束（零 AI，解析完成即显示）
  const implicitList = useMemo(() => extractImplicitConstraints(tenderText ?? ""), [tenderText])

  // 第八轮改造 1 / R46-F3：分段解析失败提示横幅。旧版逐条列「第 X 段解析失败」（红色），与侧栏「N/N 项」同屏读来自相矛盾；
  // 改为聚合一条琥珀色提示，说清“段（文本块）≠ 项（提取结果）”两个口径（仅展示层，不改数据/不碰提示词）
  const warningSummary = summarizeParseWarnings(warnings)
  // Q27 切片B：多包项目所投包件选择——lots 分区存在且原文扫出 ≥2 包时，报告顶部给「本次投标包件」chips
  // （本地扫描零费用；选择落 parse_report.lots_scope，经既有 onChange(patch) 通道 updateParseReport 落库）
  const lotsChips = useMemo(() => {
    const lotsSec = report?.sections.find((s) => s.key === "lots" && s.content.trim())
    if (!lotsSec || !tenderText?.trim()) return null
    const infos = parseLotsLineInfo(tenderText.split(/\r?\n/))
    const nos = [...new Set(infos.map((l) => l.no))].sort((a, b) => a - b)
    if (nos.length < 2) return null
    const all = nos.map((n) => {
      const info = infos.find((l) => l.no === n)
      return { no: n, title: info?.title ?? "第" + n + "包", lines: info?.lines ?? -1 }
    })
    return { nos, all }
  }, [report, tenderText])
  const lotsSelected = report?.lots_scope?.selected ?? []
  const lotsLimited = lotsChips != null && lotsSelected.length > 0 && lotsSelected.length < lotsChips.nos.length
  const setLotsSelection = (sel: number[]) => {
    if (!lotsChips) return
    const next: LotsScope = { selected: sel, all: lotsChips.all }
    onChange({ lots_scope: next })
  }
  const warningBanner =
    warningSummary ? (
      <div className="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 shadow-sm text-amber-800">
        <p className="text-xs font-semibold leading-relaxed">{warningSummary.headline}</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-700">
          （若某项内容明显缺失，可在该项处「重新解析此项」补齐；降级项的检索原文见对应分区。）
        </p>
      </div>
    ) : null

  if (!report || report.sections.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        {warningBanner}
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-md">
          <ClipboardList className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">还没有解析报告</p>
          <p className="mt-1 text-xs text-muted-foreground">请回到「招标文件」环节导入内容，配置解析范围后运行 AI 解析</p>
        </div>
      </div>
    )
  }

  const sections = report.sections
  // 用户反馈轮：关键项视图——完整解析报告默认折叠其他项，只看关键项与重点条款（展示层过滤，不改数据）
  const isFull = report.scope === "full"
  const keyFiltered = sections.filter((s) => PARSE_KEY_SECTION_KEYS.has(s.key) || s.key === STAR_CLAUSE_SECTION.key)
  const shown = isFull && keyOnly && keyFiltered.length > 0 ? keyFiltered : sections
  const selected: ParseSection = shown.find((s) => s.key === selectedKey) ?? shown[0]
  const selectedStatus = sectionStatus(selected)
  const okCount = shown.filter((s) => sectionStatus(s) === "ok").length
  const pct = shown.length ? Math.round((okCount / shown.length) * 100) : 0
  const busyHere = reparseBusyKey === selected.key
  // Q26 切片A：详情区降级原文折叠计算（〔系统降级 开头且超阈值时默认节选，可一键展开）
  const DEGRADED_FOLD_LIMIT = 15
  const detailLines = selected.content.split(/\n+/).filter((l) => l.trim())
  const isDegradedDetail = selected.content.startsWith("〔系统降级")
  const degradedCollapsed = isDegradedDetail && !expandedDegraded.has(selected.key) && detailLines.length > DEGRADED_FOLD_LIMIT
  const shownDetailLines = degradedCollapsed ? detailLines.slice(0, DEGRADED_FOLD_LIMIT) : detailLines

  const patchSection = (key: string, content: string) => {
    const next = sections.map((s) => (s.key === key ? { ...s, content, human_edited: true } : s))
    onChange({ sections: next })
  }

  const copyContent = (text: string) => {
    void copyTextToClipboard(text, {
      successMessage: "解析内容已复制到剪贴板",
      errorMessage: "复制失败，请手动选中内容复制",
    })
  }

  const selectSection = (key: string) => {
    setSelectedKey(key)
    setEditing(false)
  }

  return (
    <>
    {warningBanner}
    {lotsChips && (
      <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-foreground">本次投标包件</span>
          <button
            type="button"
            onClick={() => setLotsSelection([])}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${!lotsLimited ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            全部（{lotsChips.nos.length} 包）
          </button>
          {lotsChips.nos.map((n) => {
            const on = lotsSelected.includes(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => setLotsSelection(on ? lotsSelected.filter((x) => x !== n) : [...lotsSelected, n].sort((a, b) => a - b))}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
              >
                第{n}包
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {lotsLimited
            ? "已限定第 " + lotsSelected.join("、") + " 包：后续大纲/正文只响应所选包件内容，其他包件专属条款不响应（公共条款照常）。"
            : "未限定包件：按整份文件口径响应。选定具体包件后，大纲与正文生成将注入包件范围约束（本地注入，零费用）。"}
        </p>
      </div>
    )}
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="flex max-h-[calc(100vh-320px)] min-h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">核心信息</h2>
          <div className="flex shrink-0 items-center gap-2">
            {isFull && keyFiltered.length > 0 && (
              <button
                type="button"
                onClick={() => setKeyOnly((v) => !v)}
                className="rounded-full border border-primary/40 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title={keyOnly ? "展开查看完整解析的其他项" : "折叠其他项，只看关键项与重点条款"}
              >
                {keyOnly ? `全部 ${sections.length} 项` : "只看关键项"}
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              {okCount}/{shown.length} 项
            </span>
          </div>
        </header>
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">解析进度</span>
            <span className="font-semibold text-primary">
              {okCount}/{sections.length}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">失败 / 未解析的项可在右侧单独重解析</p>
          {isFull && keyOnly && keyFiltered.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">完整解析报告默认只看关键项与重点条款，跨项重复行已归并；点右上可展开其他项</p>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.map((s) => {
            const st = sectionStatus(s)
            const active = s.key === selected.key
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => selectSection(s.key)}
                  className={`mb-1 flex w-full items-start gap-2 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active ? "border-primary/50 bg-primary/5 shadow-sm" : "border-transparent hover:bg-secondary"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {s.key === "star_clauses" && (
                        <span className="mr-1 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-xs font-semibold text-primary">
                          ★
                        </span>
                      )}
                      {s.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {sectionSnippet(s) || "暂无内容"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[st]}`}>
                    {PARSE_STATUS_LABEL[st]}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <section className="flex min-h-96 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{selected.title}</h2>
            {selected.key === "star_clauses" && (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Star className="h-3 w-3" />
                重点
              </span>
            )}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[selectedStatus]}`}>
              {PARSE_STATUS_LABEL[selectedStatus]}
            </span>
            {selected.human_edited && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <PencilLine className="h-3 w-3 text-primary" />
                已人工编辑
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {onOpenStandardsPicker && selected.key === COMPILATION_BASIS_KEY && (
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenStandardsPicker}
                className="border-primary/40 text-primary hover:bg-primary/10"
                title="从医疗信息化常用规范库勾选补充编制依据（随项目保存）"
              >
                <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
                规范库补选
              </Button>
            )}
            {onRescanStar && selected.key === "star_clauses" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRescanStar}
                className="text-primary hover:bg-primary/10 hover:text-primary"
                title="从招标文件原文重跑本地扫描（零 AI 费用）"
              >
                <ScanSearch className="mr-1 h-3.5 w-3.5" />
                重新扫描
              </Button>
            )}
            {onReparse && selected.key !== "star_clauses" && skillPickerSlot}
            {onReparse && selected.key !== "star_clauses" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busyHere || reparseBusyKey != null}
                onClick={() => onReparse(selected.key)}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busyHere ? "animate-spin" : ""}`} />
                {busyHere ? "重新解析中…" : "重新解析此项"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!selected.content.trim()}
              onClick={() => void copyContent(selected.content)}
              className="border-border text-muted-foreground shadow-sm hover:text-foreground"
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              复制
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selectedStatus === "failed" && selected.content.trim() && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-card-foreground">
              上次重解析未成功，下面仍是此前的内容，可再次点「重新解析此项」重试
            </p>
          )}
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={selected.content}
                onChange={(e) => patchSection(selected.key, e.target.value)}
                className="min-h-72 resize-y border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  编辑后后续编制、检查、评标都以这份内容为准
                </p>
                <Button
                  size="sm"
                  onClick={() => setEditing(false)}
                  className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
                >
                  完成编辑
                </Button>
              </div>
            </div>
          ) : selected.content.trim() ? (
            <div>
              <ul className="flex flex-col gap-1.5">
                {shownDetailLines.map((line, i) => (
                  <li key={i} className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm leading-relaxed text-foreground">
                    {selected.key === "star_clauses" ? renderStarLine(line) : line}
                  </li>
                ))}
              </ul>
              {isDegradedDetail && detailLines.length > DEGRADED_FOLD_LIMIT && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedDegraded((prev) => {
                      const next = new Set(prev)
                      if (next.has(selected.key)) next.delete(selected.key)
                      else next.add(selected.key)
                      return next
                    })
                  }
                  className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                >
                  {degradedCollapsed ? `展开全部 ${detailLines.length} 行降级原文（当前节选 ${DEGRADED_FOLD_LIMIT} 行）` : "收起降级原文"}
                </button>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  内容可人工修改补充，后续编制、检查、评标都以核对后的分区内容为准
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  className="border-border text-muted-foreground shadow-sm hover:text-foreground"
                >
                  <PencilLine className="mr-1 h-3.5 w-3.5" />
                  编辑
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {selectedStatus === "failed" ? "该项重新解析未取到有效内容" : "该项尚未解析"}
              </p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                点右上角「重新解析此项」，AI 会只从招标文件中提取这一项的内容
              </p>
            </div>
          )}
          {/* 第十七轮 17B：编制依据合并清单（解析提取 ∪ 规范库补选，按 code/name 去重；类别分色徽标） */}
          {selected.key === COMPILATION_BASIS_KEY && basisMerged && basisMerged.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-background p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-card-foreground">
                  合并依据清单 · {basisMerged.length} 条（解析提取 ∪ 规范库补选，已去重）
                </p>
                {onOpenStandardsPicker && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onOpenStandardsPicker}
                    className="h-7 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
                    继续补选
                  </Button>
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {basisMerged.map((it) => (
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
    </div>
    {implicitList.length > 0 && (
      <section className="mt-4 rounded-lg border border-border bg-card shadow-md">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
            <h2 className="text-sm font-semibold text-card-foreground">隐式硬约束</h2>
            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              {implicitList.length} 条
            </span>
          </div>
          <p className="text-xs text-muted-foreground">从招标文件本地抽取（零 AI），已自动注入大纲与章节生成</p>
        </header>
        <div className="p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            页数 / 份数 / 装订 / 格式 / 「视为无效」类刚性要求，任何一条被违反都可能废标，请人工核对正文是否逐条满足。
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            {implicitList.map((t, i) => (
              <li
                key={i}
                className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-card-foreground"
              >
                {i + 1}. {t}
              </li>
            ))}
          </ul>
        </div>
      </section>
    )}
    </>
  )
}
