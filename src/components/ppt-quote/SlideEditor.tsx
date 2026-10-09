import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Camera,
  Image as ImageIcon,
  Images,
  Key,
  Link2,
  Loader2,
  Minimize2,
  Network,
  PenLine,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react"
import {
  REFINE_LABEL,
  type RefineKind,
  type Slide,
  type SlideLayout,
} from "@/pages/PptQuote/pptQuoteTypes"
import {
  getImageSearchKey,
  setImageSearchKey,
  type ImageSearchProvider,
} from "@/pages/PptQuote/imageSearch"
import { BidFigure } from "@/components/bid-workspace/BidFigure"

type ImagePool = { source: string; loading: boolean; urls: string[]; error: string }

type SlideEditorProps = {
  slide: Slide | null
  index: number
  total: number
  slideAiKind: RefineKind | null
  /** B4：自动保存失败态——徽章变「自动保存失败」（destructive），横幅在编辑器工作区顶部 */
  persistFailed?: boolean
  onTitleChange: (value: string) => void
  onLayoutChange: (layout: SlideLayout) => void
  onBulletsChange: (value: string) => void
  onNotesChange: (value: string) => void
  onRefine: (kind: RefineKind) => void
  /** 「改写 / 扩写 / 精简」旁的带入技能选择器（页面注入） */
  refinePickerSlot?: ReactNode
  /** 真实配图 */
  imagePool: ImagePool
  imageBusy: boolean
  onLoadImagePool: (source: string) => void
  onAttachImageFromUrl: (url: string) => void
  onAttachImageByPastedUrl: (url: string) => void
  onUploadImage: (file: File) => void
  onClearImage: () => void
  onApplyPoolImagesToHinted: () => void
  /** 逐页联网搜图（默认拿本页 imageHint/标题作为 query） */
  onSearchImage?: (query?: string) => Promise<boolean>
  /** 逐页 AI 生图（默认拿本页 imageHint/标题作为提示词） */
  onAIGenerateImage?: (prompt?: string) => void
  /** 当前首选图搜 Provider，受控于上层 */
  autoFigureProvider?: ImageSearchProvider
  setAutoFigureProvider?: (v: ImageSearchProvider) => void
  /** 本页当前正在跑的图相关任务（逐页 busy） */
  figureBusyKind?: "search" | "ai" | ""
  /** R-008：打开「从素材库选图」弹窗（弹窗由上层承载） */
  onPickFromLibrary?: () => void
}

const REFINE_ICONS: Record<RefineKind, typeof PenLine> = {
  rewrite: PenLine,
  expand: PlusCircle,
  condense: Minimize2,
}

/** 用户可手动切换的版式（图表 / 数字亮点页由数据自动决定，不单列） */
const LAYOUT_OPTIONS: { key: SlideLayout; label: string }[] = [
  { key: "auto", label: "自动" },
  { key: "bullets", label: "纯文字要点" },
  { key: "section", label: "章节分隔页" },
  { key: "image-right", label: "文左图右" },
  { key: "image-left", label: "图左文右" },
  { key: "banner", label: "顶部横幅图" },
]

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return "图片来源"
  }
}

export function SlideEditor({
  slide,
  index,
  total,
  slideAiKind,
  persistFailed,
  onTitleChange,
  onLayoutChange,
  onBulletsChange,
  onNotesChange,
  onRefine,
  refinePickerSlot,
  imagePool,
  imageBusy,
  onLoadImagePool,
  onAttachImageFromUrl,
  onAttachImageByPastedUrl,
  onUploadImage,
  onClearImage,
  onApplyPoolImagesToHinted,
  onSearchImage,
  onAIGenerateImage,
  autoFigureProvider = "pexels",
  setAutoFigureProvider,
  figureBusyKind = "",
  onPickFromLibrary,
}: SlideEditorProps) {
  // A2-8：要点列表编辑期保留原文（空行 / 首尾空格不即时吞掉），失焦或触发 AI 改写时统一 trim 提交
  const [bulletsDraft, setBulletsDraft] = useState<{ slideId: string; text: string } | null>(null)
  // 真实配图：来源输入 + 粘贴地址输入
  const [poolSource, setPoolSource] = useState("")
  const [pastedUrl, setPastedUrl] = useState("")
  // 逐页搜图 / AI 生图：临时关键词（默认取本页 imageHint，不传则后端自动取）
  const [figureQuery, setFigureQuery] = useState("")
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  const [pexelsKeyDraft, setPexelsKeyDraft] = useState(() => getImageSearchKey("pexels"))
  const [unsplashKeyDraft, setUnsplashKeyDraft] = useState(() => getImageSearchKey("unsplash"))
  const fileRef = useRef<HTMLInputElement>(null)
  // B5：精修落定（slideAiKind 非空 → null）后清掉本地草稿，界面始终显示精修结果，
  // 杜绝旧草稿优先显示导致的双向不一致与失焦回写覆盖
  useEffect(() => {
    if (slideAiKind === null) setBulletsDraft(null)
  }, [slideAiKind])
  const commitBulletsDraft = () => {
    if (bulletsDraft && slide && bulletsDraft.slideId === slide.id) {
      onBulletsChange(bulletsDraft.text)
    }
    setBulletsDraft(null)
  }
  // B5：精修进行中锁定编辑（生成窗口数十秒，落定按旧快照合并会无声覆盖用户输入）
  const refineLocked = !!slideAiKind
  if (!slide) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-card py-20 text-sm text-muted-foreground shadow-md">
        从左侧选择一页开始编辑
      </div>
    )
  }
  const refineKinds: RefineKind[] = ["rewrite", "expand", "condense"]
  const hasChart = !!slide.chart
  const hasKpi = !!slide.kpi?.length
  const imageDisabled = refineLocked || imageBusy
  return (
    <div className="rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-4">
        <h3 className="text-sm font-semibold text-foreground">
          第 {index + 1} / {total} 页
          {refineLocked ? (
            <span className="badge-success ml-2">AI 精修中 · 编辑已锁定</span>
          ) : persistFailed ? (
            <span className="ml-2 rounded-full border border-transparent bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              自动保存失败
            </span>
          ) : (
            <span className="badge-neutral ml-2">编辑中 · 自动保存</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {refinePickerSlot}
          {refineKinds.map((kind) => {
            const Icon = REFINE_ICONS[kind]
            const busy = slideAiKind === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  commitBulletsDraft()
                  onRefine(kind)
                }}
                disabled={!!slideAiKind}
                className={
                  busy
                    ? "flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    : "flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                {REFINE_LABEL[kind]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-5 p-4 lg:p-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">页标题</span>
          <input
            value={slide.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="本页标题"
            disabled={refineLocked}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-base font-semibold text-foreground placeholder:text-muted-foreground placeholder:font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            要点列表（每行一条）
            <span>{slide.bullets.length} 条{slide.bullets.length > 6 ? " · 建议精简到 6 条以内" : ""}</span>
          </span>
          <textarea
            value={bulletsDraft && bulletsDraft.slideId === slide.id ? bulletsDraft.text : slide.bullets.join("\n")}
            onChange={(e) => setBulletsDraft({ slideId: slide.id, text: e.target.value })}
            onBlur={commitBulletsDraft}
            rows={7}
            disabled={refineLocked}
            placeholder={"每行一条要点，如：\n覆盖全院 42 个科室的一体化电子病历\n闭环管理医嘱、用药与检验检查"}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            讲稿备注（导出 PPT 时写入演讲者备注）
            <span>{slide.notes.length} 字</span>
          </span>
          <textarea
            value={slide.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={5}
            disabled={refineLocked}
            placeholder="本页汇报时口头讲解的内容，导出后在 PowerPoint 演讲者备注中可见"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {/* ---------------- 版式与真实配图 ---------------- */}
        <div className="rounded-lg border border-border bg-muted/30 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">版式</span>
            <select
              value={hasChart ? "chart" : hasKpi ? "kpi" : slide.layout ?? "auto"}
              onChange={(e) => onLayoutChange(e.target.value as SlideLayout)}
              disabled={refineLocked || hasChart || hasKpi}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hasChart ? <option value="chart">数据图表（自动）</option> : null}
              {hasKpi && !hasChart ? <option value="kpi">数字亮点（自动）</option> : null}
              {!hasChart && !hasKpi
                ? LAYOUT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))
                : null}
            </select>
            {hasChart || hasKpi ? (
              <span className="text-xs text-muted-foreground">该页由 AI 生成的图表 / 数据驱动，版式自动确定</span>
            ) : null}
          </div>

          <div className="mt-3.5 border-t border-border pt-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Network className="h-3.5 w-3.5 text-teal-600" />
              AI 图示
              <span className="font-normal text-muted-foreground">（矢量自动绘制，导出时嵌入 PPT）</span>
            </p>
            {slide.figures?.length ? (
              <div className="mt-2 space-y-2.5">
                {slide.figures.map((fig, i) => (
                  <BidFigure key={`${fig.type}-${i}`} spec={fig} />
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">本页未生成结构化图示（架构/流程/界面类页面会由 AI 自动配图）</p>
            )}
          </div>

          <div className="mt-3.5 border-t border-border pt-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <ImageIcon className="h-3.5 w-3.5 text-primary" />
              真实配图
              {slide.imageHint ? (
                <span className="badge-neutral font-normal">AI 建议：{slide.imageHint}</span>
              ) : null}
            </p>

            {slide.image ? (
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={slide.image}
                  alt={slide.imageAlt || "本页配图"}
                  className="h-16 w-24 shrink-0 rounded-md border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-muted-foreground">
                    已插入图片{slide.imageAlt ? ` · 来源：${slide.imageAlt}` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={onClearImage}
                    disabled={imageDisabled}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Trash2 className="h-3 w-3" />
                    移除本页图片
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">本页尚未配图</p>
            )}

            {/* 取图池：从医院官网/名称 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={poolSource}
                onChange={(e) => setPoolSource(e.target.value)}
                placeholder="医院名称或官网，如：北京协和医院 / www.pumch.cn"
                disabled={imageDisabled}
                className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => onLoadImagePool(poolSource || slide.imageHint || "")}
                disabled={imageDisabled}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {imagePool.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                取官网图
              </button>
            </div>
            {imagePool.error ? <p className="mt-1.5 text-xs text-destructive">{imagePool.error}</p> : null}
            {imagePool.urls.length ? (
              <div className="mt-2">
                <p className="mb-1.5 text-xs text-muted-foreground">
                  来自「{imagePool.source}」的候选图，点击插入本页：
                </p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {imagePool.urls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      title={hostOf(url)}
                      onClick={() => onAttachImageFromUrl(url)}
                      disabled={imageDisabled}
                      className="group relative aspect-square overflow-hidden rounded-md border border-border bg-background transition-all hover:border-primary hover:ring-2 hover:ring-primary/40 disabled:opacity-50"
                    >
                      <img src={url} alt={hostOf(url)} loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.15" }} />
                      {imageBusy ? <span className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-4 w-4 animate-spin text-primary" /></span> : null}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onApplyPoolImagesToHinted}
                  disabled={imageDisabled}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  一键为所有「建议配图」的页批量配图
                </button>
              </div>
            ) : null}

            {/* 上传 / 粘贴地址 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUploadImage(f)
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={imageDisabled}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Upload className="h-3.5 w-3.5" />
                上传本地图片
              </button>
              <div className="flex min-w-[220px] flex-1 items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="粘贴图片直链 http(s)…"
                  disabled={imageDisabled}
                  className="h-8 w-full flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => {
                    onAttachImageByPastedUrl(pastedUrl)
                    setPastedUrl("")
                  }}
                  disabled={imageDisabled || !pastedUrl.trim()}
                  className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  插入
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              图片经服务端代理下载后以数据内嵌，导出的 PPT 无外链、离线可看。
            </p>

            {/* 联网搜图 / AI 生图 */}
            <div className="mt-3.5 border-t border-border pt-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Camera className="h-3.5 w-3.5 text-indigo-500" />
                  联网搜图 / AI 生图
                </p>
                <select
                  value={autoFigureProvider}
                  onChange={(e) => setAutoFigureProvider?.(e.target.value as ImageSearchProvider)}
                  disabled={imageDisabled}
                  className="ml-auto h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                >
                  <option value="pixabay">Pixabay 图库（中文直搜）</option>
                  <option value="pexels">Pexels 图库</option>
                  <option value="unsplash">Unsplash 图库</option>
                </select>
                <button
                  type="button"
                  onClick={() => setKeyPanelOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Key className="h-3 w-3" />
                  API Key
                </button>
              </div>

              {keyPanelOpen ? (
                <div className="mt-2 space-y-2 rounded-md border border-border bg-background/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    国内无网墙时 Pexels 一般可达；Unsplash 需能访问国际接口。Key 仅存本地 localStorage，不上传。
                  </p>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Pexels API Key</span>
                    <input
                      value={pexelsKeyDraft}
                      onChange={(e) => setPexelsKeyDraft(e.target.value)}
                      onBlur={() => setImageSearchKey("pexels", pexelsKeyDraft)}
                      placeholder="例：xxxxxxxxxxxxxx"
                      className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Unsplash Access Key</span>
                    <input
                      value={unsplashKeyDraft}
                      onChange={(e) => setUnsplashKeyDraft(e.target.value)}
                      onBlur={() => setImageSearchKey("unsplash", unsplashKeyDraft)}
                      placeholder="例：xxxxxxxxxxxxxx"
                      className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    一次性写入环境变量则取 <code className="rounded bg-muted px-1">VITE_PEXELS_API_KEY</code> / <code className="rounded bg-muted px-1">VITE_UNSPLASH_ACCESS_KEY</code>（需重启 Vite）。
                  </p>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={figureQuery}
                  onChange={(e) => setFigureQuery(e.target.value)}
                  placeholder={slide.imageHint ? `默认使用 AI 关键词：“${slide.imageHint}”，留空即可` : "默认使用页标题，或自定义关键词…"}
                  disabled={imageDisabled}
                  className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => {
                    void onSearchImage?.(figureQuery.trim() || undefined)
                  }}
                  disabled={imageDisabled || figureBusyKind !== "" || !onSearchImage}
                  title={onSearchImage ? "" : "本页当前不支持搜图"}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {figureBusyKind === "search" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  联网搜图首张
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onAIGenerateImage?.(figureQuery.trim() || undefined)
                  }}
                  disabled={imageDisabled || figureBusyKind !== "" || !onAIGenerateImage}
                  title="需已登录 RunningHub，自动消耗 RH 币；本地无 Key 会失败但不影响主流程"
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {figureBusyKind === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  AI 生图
                </button>
                <button
                  type="button"
                  onClick={() => onPickFromLibrary?.()}
                  disabled={imageDisabled}
                  title="从素材库选图插入本页（原图内嵌导出，商用无忧）"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Images className="h-3.5 w-3.5" />
                  素材库选图
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                搜图命中后自动取首张，失败不阻断；AI 生图走 nano-banana-pro，失败会提示登录/余额。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
