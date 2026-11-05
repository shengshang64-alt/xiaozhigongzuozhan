import { useState, type ReactNode } from "react"
import { Camera, Loader2, Sparkles, X } from "lucide-react"
import { AUDIENCES, DECK_TYPES, type DeckTypeKey, type MaterialRef, type MaterialOption } from "@/pages/PptQuote/pptQuoteTypes"
import type { ImageSearchProvider } from "@/pages/PptQuote/imageSearch"
import { MaterialPicker } from "./MaterialPicker"
import { DeckMaterialPanel } from "./DeckMaterialPanel"
import { DeckTemplateStep } from "./DeckTemplateStep"
import { DeckOutlineStep } from "./DeckOutlineStep"
import { Button } from "@/components/ui/button"
import type { SlidePlan } from "@/pages/PptQuote/pptQuoteTypes"
import type { TemplateOutline } from "@/pages/PptQuote/templateLayouts"
import type { TemplateMappingZ } from "@/pages/PptQuote/deckSchema"

type NewDeckWizardProps = {
  wDeckName: string
  setWDeckName: (v: string) => void
  wDeckType: DeckTypeKey
  setWDeckType: (v: DeckTypeKey) => void
  wTopic: string
  setWTopic: (v: string) => void
  wAudience: string
  setWAudience: (v: string) => void
  wDuration: string
  setWDuration: (v: string) => void
  wKeyPoints: string
  setWKeyPoints: (v: string) => void
  suggestedPageCount: number
  wPages: string
  setWPages: (v: string) => void
  targetPageCount: number
  wMaterial: MaterialRef | null
  setWMaterial: (ref: MaterialRef | null) => void
  solutionOptions: MaterialOption[]
  bidOptions: MaterialOption[]
  materialLoading: boolean
  deckGenerating: boolean
  deckProgress: string
  onCancel: () => void
  onGenerate: () => void
  /** 「AI 生成 PPT」按钮旁的带入技能选择器（页面注入） */
  deckPickerSlot?: ReactNode
  /** 自动配图开关与参数（"search+ai" = 搜图 + AI 插画） */
  autoFigureMode: "off" | "search" | "search+ai"
  setAutoFigureMode: (v: "off" | "search" | "search+ai") => void
  autoFigureProvider: ImageSearchProvider
  setAutoFigureProvider: (v: ImageSearchProvider) => void
  // 2026-10-30 四步向导：素材 / 模板 / 大纲
  templateName?: string | null
  templateOutline?: TemplateOutline | null
  layoutMapping?: TemplateMappingZ
  onUploadTemplate?: (file: File) => Promise<void> | void
  onClearTemplate?: () => void
  onMappingChange?: (m: TemplateMappingZ) => void
  /** 2026-11-05 内置公司模板（智业浅色母版）：走 fetch 通道，不受 localStorage 3MB 上限 */
  builtinTemplates?: { key: string; label: string; desc: string; layouts: string[] }[]
  builtinTemplateKey?: string | null
  onSelectBuiltinTemplate?: (key: string) => Promise<void> | void
  /** 当前草稿大纲（null=尚未生成） */
  outlineDraft?: SlidePlan[] | null
  onDraftOutline?: () => Promise<unknown> | void
  onOutlineChange?: (next: SlidePlan[]) => void
  onGenerateFromOutline?: () => void
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

export function NewDeckWizard({
  wDeckName,
  setWDeckName,
  wDeckType,
  setWDeckType,
  wTopic,
  setWTopic,
  wAudience,
  setWAudience,
  wDuration,
  setWDuration,
  wKeyPoints,
  setWKeyPoints,
  suggestedPageCount,
  wPages,
  setWPages,
  targetPageCount,
  wMaterial,
  setWMaterial,
  solutionOptions,
  bidOptions,
  materialLoading,
  deckGenerating,
  deckProgress,
  onCancel,
  onGenerate,
  deckPickerSlot,
  autoFigureMode,
  setAutoFigureMode,
  autoFigureProvider,
  setAutoFigureProvider,
  templateName = null,
  templateOutline = null,
  layoutMapping = {},
  onUploadTemplate = async () => {},
  onClearTemplate = () => {},
  onMappingChange = () => {},
  builtinTemplates = [],
  builtinTemplateKey = null,
  onSelectBuiltinTemplate = async () => {},
  outlineDraft = null,
  onDraftOutline = async () => {},
  onOutlineChange = () => {},
  onGenerateFromOutline = () => {},
}: NewDeckWizardProps) {
  // A2-8：汇报时长 onBlur clamp + 必填项空值行内提示
  const [durationHint, setDurationHint] = useState("")
  const [topicError, setTopicError] = useState("")
  // 2026-10-30 四步向导：1 基本信息 → 2 参考素材 → 3 公司模板 → 4 大纲确认
  // 设计取舍：保留原有"单页也能一键直出"的快捷路径（点「直接生成」跳过步骤），
  // 因为老用户已习惯一键出稿；四步是给"要严格控制结构"的场景用的。
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  const steps: { n: 1 | 2 | 3 | 4; label: string; hint: string }[] = [
    { n: 1, label: "基本信息", hint: "主题、受众、目的、页数" },
    { n: 2, label: "参考素材", hint: "上传方案/标书/政策，内容更贴合" },
    { n: 3, label: "公司模板", hint: "按真实版式导出" },
    { n: 4, label: "大纲确认", hint: "确认结构后再生成" },
  ]

  const canNext = step === 1 ? Boolean(wTopic.trim()) : true
  return (
    <section className="pb-16">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">新建</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">新建汇报 PPT</h1>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={deckGenerating}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:text-card-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
          取消
        </button>
      </header>

      {/* 2026-10-30 四步向导 · 步骤导航 */}
      <nav aria-label="生成步骤" className="mt-4 flex flex-wrap items-center gap-1.5">
        {steps.map((s, idx) => {
          const active = step === s.n
          const done = step > s.n
          return (
            <div key={s.n} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  // 只允许回退到已完成步骤（避免跳步丢失前置信息）
                  if (s.n < step) setStep(s.n)
                }}
                disabled={s.n > step || deckGenerating}
                title={s.hint}
                className={
                  active
                    ? "flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    : done
                      ? "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:border-primary/40"
                      : "flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
                }
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={
                    active || done
                      ? "flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
                      : "flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/30 text-[10px]"
                  }
                >
                  {done ? "✓" : s.n}
                </span>
                {s.label}
              </button>
              {idx < steps.length - 1 && <span className="text-muted-foreground/40">›</span>}
            </div>
          )
        })}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {steps.find((s) => s.n === step)?.hint}
        </span>
      </nav>

      {/* 第 2/3 步：独立面板（占满宽度，信息密度高） */}
      {step === 2 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">参考素材</h2>
          <DeckMaterialPanel />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextLabel="下一步 · 公司模板"
            disabled={deckGenerating}
          />
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">公司模板</h2>
          <DeckTemplateStep
            templateName={templateName ?? null}
            outline={templateOutline ?? null}
            mapping={layoutMapping ?? {}}
            onUpload={onUploadTemplate}
            onClear={onClearTemplate}
            onMappingChange={onMappingChange}
            builtinTemplates={builtinTemplates}
            builtinTemplateKey={builtinTemplateKey}
            onSelectBuiltin={onSelectBuiltinTemplate}
          />
          <StepNav
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            nextLabel="下一步 · 生成大纲"
            disabled={deckGenerating}
          />
        </div>
      )}

      {step === 4 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">大纲确认</h2>
          {outlineDraft ? (
            <DeckOutlineStep
              outline={outlineDraft}
              onChange={onOutlineChange}
              onGenerate={onGenerateFromOutline}
              onBack={() => setStep(3)}
              generating={deckGenerating}
              progress={deckProgress}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                先生成大纲（只有标题与页面类型，不逐页填充内容），确认结构无误后再开始逐页生成，
                避免结构不对导致整册返工。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onDraftOutline()}
                  disabled={deckGenerating || !wTopic.trim()}
                  className="gap-1.5"
                >
                  {deckGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {deckGenerating ? "生成中…" : "生成大纲"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep(3)} disabled={deckGenerating}>
                  返回
                </Button>
                {deckProgress && <span className="text-[11px] text-muted-foreground">{deckProgress}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 第 1 步：基本信息（原表单，保留全部字段与校验） */}
      <div className={step === 1 ? "mt-5 grid gap-4 lg:grid-cols-[3fr_2fr]" : "hidden"}>
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-4 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500 lg:p-5">
            <h2 className="text-sm font-semibold text-foreground">
              选择 PPT 类型
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {DECK_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setWDeckType(t.key)}
                  className={
                    wDeckType === t.key
                      ? "rounded-lg border-2 border-primary bg-primary/5 p-4 text-left shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      : "rounded-lg border border-border bg-background p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  }
                >
                  <p className={wDeckType === t.key ? "text-sm font-semibold text-primary" : "text-sm font-semibold text-foreground"}>
                    {t.label}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500 lg:p-5">
            <h2 className="text-sm font-semibold text-foreground">汇报场景信息</h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">汇报主题 *</span>
                  <input
                    value={wTopic}
                    onChange={(e) => {
                      setWTopic(e.target.value)
                      if (topicError) setTopicError("")
                    }}
                    onBlur={() => {
                      if (!wTopic.trim()) setTopicError("请填写汇报主题后再生成")
                    }}
                    aria-invalid={Boolean(topicError)}
                    placeholder="如：某某市人民医院智慧医院建设规划汇报"
                    className={`${inputCls} ${topicError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {topicError && <span className="mt-1 block text-xs text-destructive">{topicError}</span>}
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">PPT 名称（选填，默认按主题命名）</span>
                  <input
                    value={wDeckName}
                    onChange={(e) => setWDeckName(e.target.value)}
                    placeholder="如：智慧医院规划汇报 2026"
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">汇报对象</span>
                  <select value={wAudience} onChange={(e) => setWAudience(e.target.value)} className={inputCls}>
                    {AUDIENCES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    汇报时长（分钟）
                    <span className="badge-neutral">
                      建议 {suggestedPageCount} 页
                    </span>
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={wDuration}
                    aria-invalid={Boolean(durationHint)}
                    onChange={(e) => {
                      setWDuration(e.target.value)
                      if (durationHint) setDurationHint("")
                    }}
                    onBlur={() => {
                      const raw = wDuration.trim()
                      const n = Number(raw)
                      if (raw === "" || !Number.isFinite(n)) {
                        setDurationHint("请输入 5–60 之间的分钟数，已恢复为 15")
                        setWDuration("15")
                        return
                      }
                      const clamped = Math.max(5, Math.min(60, Math.round(n)))
                      if (clamped !== n) setDurationHint(`汇报时长应在 5–60 分钟之间，已自动调整为 ${clamped}`)
                      setWDuration(String(clamped))
                    }}
                    className={`${inputCls} ${durationHint ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {durationHint && <span className="mt-1 block text-xs text-destructive">{durationHint}</span>}
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    目标页数（选填）
                    <span className="badge-neutral">默认 {suggestedPageCount} 页</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={wPages}
                    onChange={(e) => setWPages(e.target.value)}
                    onBlur={() => {
                      const raw = wPages.trim()
                      if (raw === "") return
                      const n = Number(raw)
                      if (!Number.isFinite(n) || n <= 0) {
                        setWPages("")
                        return
                      }
                      setWPages(String(Math.max(1, Math.min(40, Math.round(n)))))
                    }}
                    placeholder={`留空按建议 ${suggestedPageCount} 页`}
                    className={inputCls}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {wPages.trim() ? `将生成 ${targetPageCount} 页（1–40）` : `将按时长建议生成约 ${suggestedPageCount} 页`}
                  </span>
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">核心要点（选填，每行一条）</span>
                <textarea
                  value={wKeyPoints}
                  onChange={(e) => setWKeyPoints(e.target.value)}
                  rows={4}
                  placeholder={"如：\n突出电子病历五级评审目标\n强调分期建设与预算控制\n加入本院已有系统现状"}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              {step === 1 && (
                <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    下一步可上传参考素材与公司模板；也可以直接一键生成（跳过四步）。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setStep(2)}
                    disabled={!canNext || deckGenerating}
                    className="ml-auto shrink-0"
                  >
                    下一步 · 参考素材
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <MaterialPicker
            solutionOptions={solutionOptions}
            bidOptions={bidOptions}
            loading={materialLoading}
            value={wMaterial}
            onChange={setWMaterial}
          />

          <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
            <h2 className="text-sm font-semibold text-foreground">生成</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              AI 将按医疗售前汇报场景生成约 {targetPageCount} 页的图文内容（标题、要点、讲稿，并按内容自动判断是否配数据图表 / 数字亮点 / 配图建议）
              {targetPageCount > 10 ? "（页数较多时分批生成，请耐心等待）" : ""}，生成后可逐页精修、真实配图后导出。按实际 token 用量扣费。
            </p>

            {/* 自动配图开关 */}
            <div className="mt-3.5 rounded-md border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Camera className="h-3.5 w-3.5 text-indigo-500" />
                  自动为推荐配图页拉真实图片
                </p>
                <select
                  value={autoFigureMode}
                  onChange={(e) => setAutoFigureMode(e.target.value as "off" | "search" | "search+ai")}
                  disabled={deckGenerating}
                  className="ml-auto h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                >
                  <option value="off">不自动（逐页手动）</option>
                  <option value="search">仅联网搜图（免费）</option>
                  <option value="search+ai">搜图 + AI 插画（抽象页走生图）</option>
                </select>
                {autoFigureMode !== "off" ? (
                  <select
                    value={autoFigureProvider}
                    onChange={(e) => setAutoFigureProvider(e.target.value as ImageSearchProvider)}
                    disabled={deckGenerating}
                    className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                  >
                    <option value="pixabay">Pixabay（中文直搜）</option>
                    <option value="pexels">Pexels</option>
                    <option value="unsplash">Unsplash</option>
                  </select>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {autoFigureMode === "off"
                  ? "不自动配图，逐页在图框内部手工选图；可随时切回自动（默认：搜图 + AI 插画）。"
                  : autoFigureMode === "search+ai"
                    ? "抽象概念页（AI 插画）走服务端 AI 生图，其余页仍按 Pexels/Unsplash/Pixabay 搜图，素材库本地命中优先。生图需在 sidecar 配好 ZX_AI_IMAGE_*（或数据库里的图像模型凭据）；未配置或生图失败会自动退回搜图，不阻断生成。真实产品界面/资质/Logo 类页面永不生图。"
                    : "仅 Pexels/Unsplash/Pixabay 图库（素材库本地命中优先）。需先在逐页编辑里的 “API Key” 面板写好 Key（或写入 .env.local）；无 Key 会自动跳过。"}
              </p>
            </div>
            {deckGenerating && (
              <p className="mt-3 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {deckProgress || "正在生成…"}
              </p>
            )}
            <button
              type="button"
              onClick={onGenerate}
              disabled={deckGenerating || !wTopic.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {deckGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {deckGenerating ? "生成中…" : "AI 生成 PPT"}
            </button>
            {deckPickerSlot && <div className="mt-3">{deckPickerSlot}</div>}
          </div>
        </div>
      </div>
    </section>
  )
}


/** 步骤底部导航（上一步/下一步） */
function StepNav({
  onBack,
  onNext,
  nextLabel,
  disabled,
}: {
  onBack: () => void
  onNext: () => void
  nextLabel: string
  disabled?: boolean
}) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3">
      <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={disabled}>
        上一步
      </Button>
      <Button type="button" size="sm" onClick={onNext} disabled={disabled} className="ml-auto">
        {nextLabel}
      </Button>
    </div>
  )
}
