import { useState } from "react"
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { BizAssemblyCheckDialog } from "@/components/bid-workspace/BizAssemblyCheckDialog"

// ---------------------------------------------------------------------------
// 标书正文编写 · 左栏章节树（UX-v2：prototype/bid/draft.html 左树 + 中写作 + 右检查）。
//
// 合并自两处（2026-11-11 拆屏）：
//   · ComposeStep 内部 OutlineNavTree：小节定位、全部展开、重新生成大纲、空商务章补框架；
//   · 步骤条 CurrentTaskContextPanel（UX-R3 S1/S4）：part 分组组头、行级三态（完成/部分/未写，
//     部分成稿显真实字数）、行 hover 快捷动作（写/续/精）、商务组卷一键核对。
// 步骤条下方的通栏「章节导航」扁表就此拆除——同一份数据不再渲染两棵树，
// 写作区上方不再被整宽面板压住（§5.3：步骤条可留顶上，下面不放通栏章节导航）。
//
// 口径沿用 S1 验收：content 非空且达预算 80%+ 为完成；非空未达为部分；空为未写；
// 预算未知时退化为「非空即完成」。字数一律取 content 真实长度，不写演示值。
// ---------------------------------------------------------------------------

/** 章节行三态：done=完成（绿）/ partial=部分成稿（蓝，显字数）/ empty=未写（灰） */
type ChapterRowState = "done" | "partial" | "empty"

function chapterRowState(ch: Chapter, budget?: number): ChapterRowState {
  const content = ch.content ?? ""
  if (!content.trim()) return "empty"
  if (!budget || budget <= 0) return "done"
  return content.length >= budget * 0.8 ? "done" : "partial"
}

/** 字数缩写：1234 → "1.2k字"，800 → "800字"（部分成稿行右侧小字） */
function fmtCharCount(len: number): string {
  if (len >= 1000) {
    const k = (len / 1000).toFixed(1).replace(/\.0$/, "")
    return `${k}k字`
  }
  return `${len}字`
}

/**
 * part → 分组：biz=商务部分 / tech 或缺省=技术部分（与 bidTypes.isBizPart 的
 * 「无 part 一律按技术章」存量语义一致）/ 其他非空取值防御性归入「其他」。
 */
const CHAPTER_GROUPS: { key: string; label: string; match: (part?: string) => boolean }[] = [
  { key: "biz", label: "商务部分", match: (p) => p === "biz" },
  { key: "tech", label: "技术部分", match: (p) => p === "tech" || p == null },
  { key: "other", label: "其他", match: (p) => p != null && p !== "biz" && p !== "tech" },
]

export type BidChapterNavTreeProps = {
  chapters: Chapter[]
  /** 与 chapters 下标对齐的每章预算字数（三态判定）；缺省退化为「非空即完成」 */
  chapterBudgets: number[]
  activeChapterId: string | null
  supplementState: { nodeId: string; round: number } | null
  sectionState: { nodeId: string; current: number; total: number } | null
  doneChapterCount: number
  techChapterTotal: number
  /** 空商务章数量与补框架入口（商务材料由用户填，系统只给骨架） */
  emptyBizCount: number
  onFillBizSkeletons: () => void
  onSelectChapter: (nodeId: string) => void
  onFocusSection: (nodeId: string, title: string) => void
  /** 编制阶段的大纲重生成入口；不传则不渲染按钮 */
  onRegenerateOutline?: () => void
  /** 行 hover 快捷动作（复用编制页现有生成通道）；三个都不传则不渲染动作位 */
  generateChapter?: (nodeId: string) => void
  continueChapter?: (nodeId: string) => void
  refineChapter?: (nodeId: string, kind: "rewrite" | "expand" | "condense") => void
  /** UX-R3 S4：商务组卷检查「一键补入」（useBidWorkspace.addBizAssemblyItems） */
  addBizAssemblyItems?: (titles: string[]) => void
}

export function BidChapterNavTree({
  chapters,
  chapterBudgets,
  activeChapterId,
  supplementState,
  sectionState,
  doneChapterCount,
  techChapterTotal,
  emptyBizCount,
  onFillBizSkeletons,
  onSelectChapter,
  onFocusSection,
  onRegenerateOutline,
  generateChapter,
  continueChapter,
  refineChapter,
  addBizAssemblyItems,
}: BidChapterNavTreeProps) {
  const [userToggled, setUserToggled] = useState<Record<string, boolean>>({})
  const [bizCheckOpen, setBizCheckOpen] = useState(false)
  // 用户反馈（2026-10-15）：默认只展开"当前章"的小节；「全部展开」一键铺开所有章的小节。
  const [expandAllSections, setExpandAllSections] = useState(false)

  const indexed = chapters.map((ch, idx) => ({
    ch,
    idx,
    state: chapterRowState(ch, chapterBudgets[idx]),
  }))
  const groups = CHAPTER_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: indexed.filter((r) => g.match(r.ch.part)),
  })).filter((g) => g.rows.length > 0)

  const hasActiveChapter = !!activeChapterId && chapters.some((c) => c.node_id === activeChapterId)
  // 折叠态为渲染时纯派生（避免 effect 内 setState）：用户显式切换 > 当前章自动展开 > 全展开。
  const isCollapsed = (key: string, rows: { ch: Chapter }[]): boolean => {
    const override = userToggled[key]
    if (override !== undefined) return override
    if (!hasActiveChapter) return false
    return !rows.some((r) => r.ch.node_id === activeChapterId)
  }
  const toggleGroup = (key: string) => {
    setUserToggled((prev) => {
      const rows = groups.find((g) => g.key === key)?.rows ?? []
      const next = !isCollapsed(key, rows)
      return { ...prev, [key]: next }
    })
  }

  const totalChars = chapters.reduce((sum, c) => sum + (c.content ?? "").length, 0)
  const pct = techChapterTotal ? Math.round((doneChapterCount / techChapterTotal) * 100) : 0
  const hasActions = !!(generateChapter || continueChapter || refineChapter)

  return (
    <aside className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <p className="text-sm font-semibold text-foreground">章节目录</p>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpandAllSections((v) => !v)}
            title={expandAllSections ? "收起到只展开当前章的小节" : "展开所有章的小节，通览整本目录"}
            className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {expandAllSections ? "只看当前章" : "全部展开"}
          </button>
          {onRegenerateOutline && (
            <button
              type="button"
              onClick={onRegenerateOutline}
              title="按当前生成设置重新生成大纲（会替换现有大纲，需再次确认后才重建章节清单）"
              className="flex items-center gap-1 rounded-md border border-primary/40 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <RefreshCw className="h-3 w-3" />
              重新生成大纲
            </button>
          )}
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {doneChapterCount}/{techChapterTotal} 章
          </span>
        </span>
      </div>
      <div className="shrink-0 px-4 pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {/* 空商务章提示——商务材料由你方填写，系统给框架不给内容 */}
      {emptyBizCount > 0 && (
        <div className="mx-2 mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-foreground">
            <span className="font-medium text-warning">{emptyBizCount} 个商务章还没有内容</span>
            <br />
            <span className="text-muted-foreground">
              投标函/授权书/报价表属法律文件，需按招标文件范本填真实信息并盖章，系统不代写。
            </span>
          </p>
          <button
            type="button"
            onClick={onFillBizSkeletons}
            className="mt-1.5 w-full rounded border border-warning/50 bg-background px-2 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10"
          >
            一键补上填写框架
          </button>
        </div>
      )}
      <nav className="mt-2 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            还没有章节大纲——回到第 1-2 步完成解析后先生成大纲
          </p>
        )}
        {groups.map((g) => {
          const doneCount = g.rows.filter((r) => r.state === "done").length
          const total = g.rows.length
          const gPct = total > 0 ? Math.round((doneCount / total) * 100) : 0
          const collapsed = isCollapsed(g.key, g.rows)
          return (
            <div key={g.key} className="mb-1">
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => toggleGroup(g.key)}
                className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-secondary"
              >
                <span className="shrink-0 text-muted-foreground">
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </span>
                <span className="shrink-0 text-xs font-semibold text-card-foreground">{g.label}</span>
                <span className={`shrink-0 text-xs ${doneCount === total ? "text-primary" : "text-muted-foreground"}`}>
                  {doneCount}/{total}
                </span>
                <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${gPct}%` }} />
                </span>
                {/* UX-R3 S4：商务组卷一键核对入口（仅商务组头） */}
                {g.key === "biz" && addBizAssemblyItems && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="按通用规则核对商务必备件是否齐套（投标函/授权书/开标一览表/分项报价表/资格声明等）"
                    onClick={(e) => {
                      e.stopPropagation()
                      setBizCheckOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        setBizCheckOpen(true)
                      }
                    }}
                    className="ml-auto shrink-0 rounded border border-primary/40 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    📋 组卷检查
                  </span>
                )}
              </button>
              {!collapsed && (
                <div className="mt-0.5 space-y-0.5 pl-3">
                  {g.rows.map((r) => {
                    const isCurrent = !!r.ch.node_id && r.ch.node_id === activeChapterId
                    const charLen = (r.ch.content ?? "").length
                    const isBiz = r.ch.part === "biz"
                    const title = r.ch.title || `第${r.idx + 1}章`
                    return (
                      <div key={r.ch.node_id || r.idx}>
                        <div
                          data-chapter-row
                          role="button"
                          tabIndex={0}
                          className={`group/chrow flex h-8 cursor-pointer items-center gap-2 rounded-md border-l-[3px] py-1 pl-2 pr-1.5 transition-colors hover:bg-secondary ${
                            isCurrent
                              ? "border-blue-500 bg-blue-50"
                              : r.state === "done"
                                ? "border-green-500 bg-green-50"
                                : r.state === "partial"
                                  ? "border-blue-400 bg-blue-50/60"
                                  : "border-border bg-background"
                          }`}
                          onClick={() => onSelectChapter(r.ch.node_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              onSelectChapter(r.ch.node_id)
                            }
                          }}
                        >
                          <span
                            className={`w-4 shrink-0 text-center text-xs ${
                              isCurrent
                                ? "text-primary"
                                : r.state === "done"
                                  ? "text-primary"
                                  : r.state === "partial"
                                    ? "text-blue-500"
                                    : "text-muted-foreground/60"
                            }`}
                            title={r.state === "done" ? "已完成" : r.state === "partial" ? "部分成稿" : "未写"}
                          >
                            {r.state === "done" ? "✓" : r.state === "partial" ? "◐" : "○"}
                          </span>
                          <span
                            className={`min-w-0 flex-1 truncate text-sm ${
                              isCurrent ? "font-medium text-primary" : "text-card-foreground"
                            }`}
                          >
                            {isBiz ? title : `第${r.idx + 1}章 ${title}`}
                          </span>
                          {sectionState?.nodeId === r.ch.node_id ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              小节 {sectionState.current}/{sectionState.total}
                            </span>
                          ) : supplementState?.nodeId === r.ch.node_id ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              补足中 第 {supplementState.round} 轮
                            </span>
                          ) : (
                            <>
                              {r.ch.gen_status === "generating" && (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                              )}
                              {r.state === "partial" && (
                                <span className="shrink-0 text-xs text-blue-600">{fmtCharCount(charLen)}</span>
                              )}
                            </>
                          )}
                          {hasActions && (
                            <span className="hidden shrink-0 items-center gap-0.5 group-hover/chrow:flex">
                              {generateChapter && (
                                <button
                                  type="button"
                                  title="生成本章正文"
                                  className="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    generateChapter(r.ch.node_id)
                                  }}
                                >
                                  写
                                </button>
                              )}
                              {continueChapter && (
                                <button
                                  type="button"
                                  title="从断点续写本章"
                                  className="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    continueChapter(r.ch.node_id)
                                  }}
                                >
                                  续
                                </button>
                              )}
                              {refineChapter && (
                                <button
                                  type="button"
                                  title="按版式与文风精修本章"
                                  className="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    refineChapter(r.ch.node_id, "rewrite")
                                  }}
                                >
                                  精
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                        {(isCurrent || expandAllSections) && (r.ch.sections ?? []).length > 0 && (
                          <ul className="ml-4 mt-0.5 border-l border-border pl-3">
                            {(r.ch.sections ?? []).map((sec, j) => (
                              <li
                                key={`${r.ch.node_id}-sec-${j}`}
                                title="点击定位到该小节（预览与编辑均可查询）"
                                onClick={() => onFocusSection(r.ch.node_id, sec)}
                                className="cursor-pointer py-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                              >
                                {r.idx + 1}.{j + 1} {sec}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      {/* 底部总进度（原型 draft.html：已完成章数/总章 + 全文真实字数） */}
      <div className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>总进度</span>
          <span className="ml-auto font-medium tabular-nums text-card-foreground">
            {doneChapterCount}/{chapters.length || techChapterTotal} 章
          </span>
          {totalChars > 0 && <span className="tabular-nums">· {fmtCharCount(totalChars)}</span>}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {/* UX-R3 S4：商务组卷检查弹窗（组头「📋 组卷检查」打开；缺失项可一键补入） */}
      <BizAssemblyCheckDialog
        open={bizCheckOpen}
        onOpenChange={setBizCheckOpen}
        chapters={chapters}
        onAddMissing={addBizAssemblyItems}
      />
    </aside>
  )
}
