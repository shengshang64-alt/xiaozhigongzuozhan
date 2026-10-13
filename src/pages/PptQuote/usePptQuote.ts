import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { localDateStamp } from "@/lib/dateStamp"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import type { LlmMessage } from "@/lib/llm"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  resolveAvailableModels,
  type ModelRef,
} from "@/lib/modelGateway"
import { localizeLlmError } from "@/lib/llmError"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { injectSkillBlock, skillBlockFor, skillCostSuffix, type SkillScope } from "@/lib/skillCore"
import { makeUid, type Chapter, type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { callAigcAndPoll, formatAigcFailureMessage, previewAigcPrice, type AigcFailure } from "@/lib/aigc"
import {
  buildSearchQuery,
  searchImages,
  type ImageSearchProvider,
} from "./imageSearch"
// R-008 素材库本地命中（取图顺序①本地库 → ②实时搜图 → ③留空）
import { matchMaterials } from "@/pages/MaterialLibrary/materialCore"
import type { MaterialItem } from "@/pages/MaterialLibrary/materialTypes"
import { lintDeck, lintSummaryText } from "./deckLint"
import {
  clearDeckTemplate,
  decodeTemplateBytes,
  encodeTemplateBytes,
  extractDeckTheme,
  loadDeckTemplate,
  saveDeckTemplate,
  type StoredDeckTemplate,
} from "./deckTheme"
import { finalizeFidelityProbe, probeTemplateFacts } from "./deckFidelityProbe"
import {
  buildDeckBatchMessages,
  buildDeckOutlineMessages,
  buildDeckSingleMessages,
  buildMaterialText,
  buildQuoteDraftMessages,
  buildSlideRefineMessages,
  bumpVersion,
  deepCopyGroups,
  emptySlide,
  groupSubtotal,
  historyQuotesFor,
  isBlankSlide,
  makeDefaultGroups,
  mergeItemsIntoGroups,
  normalizeDraftItemsFromCatalog,
  normalizeSlidePlan,
  normalizeSlides,
  parseJsonLoose,
  quoteItemFromProduct,
  quoteTotal,
  REFINE_LABEL,
  sanitizeDeck,
  sanitizeQuote,
  suggestPageCount,
  TRANSITION_LABEL,
  type DeckRecord,
  type DeckTransition,
  type DeckTypeKey,
  type MaterialOption,
  type MaterialRef,
  type ProductItem,
  type QuoteGroup,
  type QuoteItem,
  type QuoteRecord,
  type RefineKind,
  type Slide,
  type SlidePlan,
} from "./pptQuoteTypes"
import { recommendFromHistory, type QuoteDimensions } from "./quoteRecommend"
import { runBatchesWithRetry, withGenerationRetry } from "./deckBatchRecovery"
import type { CheckProduct, ChecklistRecord } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 数据请求（走 __pb 代理自定义路由，禁用 PB SDK 标准 REST）
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

// 轮次 F 轨 2：报价「关联商机」下拉的最小商机选项（字段与 opportunities collection 一致）
export type QuoteOppOption = {
  id: string
  opp_name: string
  customer_name: string
}

type SolutionRow = {
  id: string
  solution_name?: string
  hospital?: string
  doc_status?: string
  outline?: OutlineNode[]
}

type BidRow = {
  id: string
  project_name?: string
  hospital?: string
  tender_no?: string
  bid_outline?: OutlineNode[]
}

type MaterialDetail = {
  outline?: OutlineNode[]
  bid_outline?: OutlineNode[]
  chapters?: Chapter[]
  bid_chapters?: Chapter[]
  tender_text?: string
}

// ---------------------------------------------------------------------------
// LLM 调用封装（统一模型网关：个人模型走 /api/model-gw/chat，平台模型 poll-first 由
// callLlmWithFallback 内部处理；错误码翻译成中文）
// ---------------------------------------------------------------------------

// 文案基表在 @/lib/llmError（全站唯一），此处只覆写报价侧专属措辞
const QUOTE_ERROR_ZH: Record<string, string> = {
  timeout: "AI 生成超时（可能服务器繁忙），请稍后重试",
  rh_login_required: "AI 生成服务暂不可用，请检查模型配置",
}

// 循环 9 A2：模型引用改实例级（原模块级 let 在账号切换重挂载/第二实例时会串模型）；
// llmGenerate 由调用方显式传入当前实例的模型引用
async function llmGenerate(
  messages: LlmMessage[],
  maxTokens: number,
  scope: SkillScope | undefined,
  modelRef: ModelRef | null,
): Promise<string> {
  const r = await chatViaGateway({
    modelRef,
    messages: injectSkillBlock(messages, skillBlockFor(scope)),
    page: "ppt-quote",
    max_tokens: maxTokens,
  })
  if (r.needsLogin) throw new Error(QUOTE_ERROR_ZH.rh_login_required)
  if (!r.ok || r.status !== "success" || !r.text) {
    // B3 口径已收敛到 @/lib/llmError：未收录错误码 / 裸英文串一律中文兜底，
    // 可读中文串透传（与小智侧同源，不再各抄一份）
    throw new Error(
      localizeLlmError(r.error, { generic: "生成失败，请稍后重试", copy: QUOTE_ERROR_ZH }),
    )
  }
  return r.text
}

const MAX_TOKENS_OUTLINE = 4096
const MAX_TOKENS_LONGFORM = 8192
const BATCH_SIZE = 8
const SINGLE_CALL_MAX_PAGES = 10

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// 主 Hook
// ---------------------------------------------------------------------------

/** 统一确认对话框请求（替代 window.confirm，由 View 层挂 ConfirmDialog 渲染） */
type ConfirmRequestState = {
  title: string
  description?: string
  tone?: "default" | "danger"
  confirmText?: string
  action: () => void
}

export function usePptQuote() {
  const costConfirm = useCostConfirm()

  // ------------------------------ 统一确认对话框 ------------------------------
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequestState | null>(null)
  const requestConfirm = useCallback((req: ConfirmRequestState) => setConfirmRequest(req), [])
  const closeConfirmRequest = useCallback(() => setConfirmRequest(null), [])
  const runConfirmRequest = useCallback(() => {
    const req = confirmRequest
    setConfirmRequest(null)
    req?.action()
  }, [confirmRequest])

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [, setAccountInfo] = useState<RhAccountInfo | null>(null)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
  }, [])

  // ------------------------------ 模型选择（统一网关） ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")

  const loadModelOptions = useCallback(async () => {
    const av = await resolveAvailableModels()
    setModelOptions(av.models)
    setSelectedModelKey((prev) =>
      prev && av.models.some((m) => modelRefKey(m) === prev)
        ? prev
        : av.defaultRef
          ? modelRefKey(av.defaultRef)
          : "",
    )
  }, [])

  useEffect(() => {
    if (userId) void loadModelOptions()
  }, [userId, loadModelOptions])

  // 循环 9 A2：实例级模型引用（null = 平台内置默认）
  const activeModelRef = useRef<ModelRef | null>(null)
  useEffect(() => {
    activeModelRef.current = modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null
  }, [modelOptions, selectedModelKey])

  const handleSelectModel = useCallback((key: string) => setSelectedModelKey(key), [])

  // ------------------------------ 全站技能带入（PPT 侧 2 个功能点） ------------------------------
  const deckSkills = useScopeSkills("ppt-deck", userId ?? undefined)
  const quoteSkills = useScopeSkills("quote-draft", userId ?? undefined)

  const handleGenError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error(msg || "生成失败，请重试")
  }, [])

  // ------------------------------ 视图切换 ------------------------------
  const [activeView, setActiveView] = useState<"deck" | "quote">("deck")

  // ------------------------------ 素材选项（方案 / 标书项目） ------------------------------
  const [solutionOptions, setSolutionOptions] = useState<MaterialOption[]>([])
  const [bidOptions, setBidOptions] = useState<MaterialOption[]>([])
  const [materialLoading, setMaterialLoading] = useState(false)

  const loadMaterialOptions = useCallback(async (uid: string) => {
    setMaterialLoading(true)
    try {
      const [sols, bids] = await Promise.all([
        // B6：perPage 提到 200（服务端缺省 50 会静默截断）；下拉素材类不加 UI 提示，
        // 单页 200 条为边界，超出属极端场景
        apiFetch<ListResponse<SolutionRow>>(`/api/solutions?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`).catch(() => ({
          items: [] as SolutionRow[],
        })),
        apiFetch<ListResponse<BidRow>>(`/api/bid_projects?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`).catch(() => ({
          items: [] as BidRow[],
        })),
      ])
      setSolutionOptions(
        (sols.items ?? []).map((s) => ({
          id: s.id,
          type: "solution" as const,
          name: s.solution_name || "未命名方案",
          desc: [s.hospital, s.outline?.length ? `${s.outline.length} 章大纲` : "", s.doc_status === "done" ? "已成稿" : ""]
            .filter(Boolean)
            .join(" · "),
        })),
      )
      setBidOptions(
        (bids.items ?? []).map((b) => ({
          id: b.id,
          type: "bid" as const,
          name: b.project_name || "未命名项目",
          desc: [b.hospital, b.tender_no].filter(Boolean).join(" · "),
        })),
      )
    } finally {
      setMaterialLoading(false)
    }
  }, [])

  const fetchMaterialText = useCallback(async (ref: MaterialRef): Promise<string> => {
    const path = ref.type === "solution" ? `/api/solutions/${ref.id}` : `/api/bid_projects/${ref.id}`
    const rec = await apiFetch<MaterialDetail>(path)
    const outline = (ref.type === "solution" ? rec.outline : rec.bid_outline) ?? []
    const chapters = (ref.type === "solution" ? rec.chapters : rec.bid_chapters) ?? []
    // R149：标书项目带上招标原文节选，否则仅有大纲/章节时素材实质为空，生成会凭空编造事实
    return buildMaterialText(ref.name, outline, chapters, 4200, ref.type === "bid" ? rec.tender_text ?? "" : "")
  }, [])

  // ------------------------------ PPT 列表 ------------------------------
  const [deckList, setDeckList] = useState<DeckRecord[]>([])
  const [deckListLoading, setDeckListLoading] = useState(false)
  const [deckSearch, setDeckSearch] = useState("")

  const loadDecks = useCallback(async (uid: string) => {
    setDeckListLoading(true)
    try {
      const data = await apiFetch<ListResponse<DeckRecord>>(
        // B6：perPage 提到 200，避免服务端缺省 50 静默截断列表
        `/api/ppt_decks?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`,
      )
      setDeckList((data.items ?? []).map(sanitizeDeck))
    } catch {
      toast.error("PPT 列表加载失败，请稍后重试")
    } finally {
      setDeckListLoading(false)
    }
  }, [])

  const filteredDecks = useMemo(() => {
    const kw = deckSearch.trim().toLowerCase()
    if (!kw) return deckList
    return deckList.filter(
      (d) => d.deck_name?.toLowerCase().includes(kw) || d.audience?.toLowerCase().includes(kw),
    )
  }, [deckList, deckSearch])

  // ------------------------------ PPT 视图与编辑器 ------------------------------
  const [deckMode, setDeckMode] = useState<"list" | "wizard" | "editor">("list")
  const [activeDeck, setActiveDeck] = useState<DeckRecord | null>(null)
  const activeDeckRef = useRef<DeckRecord | null>(null)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [editorTab, setEditorTab] = useState<"edit" | "preview">("edit")
  const [slideAiKind, setSlideAiKind] = useState<RefineKind | null>(null)
  // R249：占位/空白页「一键补全」进行态与进度文案
  const [fillingBlank, setFillingBlank] = useState(false)
  const [fillProgress, setFillProgress] = useState("")

  const deckPersistRef = useRef<number | null>(null)
  // B4：防抖保存失败标志——quiet 模式下不弹 toast，改由编辑器顶部非阻断横幅提示，
  // 成功落盘自动清除；beforeunload 据此拦截关页防丢改动
  const [deckPersistFailed, setDeckPersistFailed] = useState(false)

  const applyDeckState = useCallback((next: DeckRecord | null) => {
    activeDeckRef.current = next
    setActiveDeck(next)
    if (next) setDeckList((prev) => prev.map((d) => (d.id === next.id ? next : d)))
  }, [])

  const runDeckPersistOnce = useCallback(async (rec: DeckRecord, quiet: boolean): Promise<boolean> => {
    try {
      await apiFetch(`/api/ppt_decks/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          deck_name: rec.deck_name,
          slides: rec.slides,
          doc_status: rec.doc_status,
        }),
      })
      setDeckPersistFailed(false)
      return true
    } catch {
      setDeckPersistFailed(true)
      if (!quiet) toast.error("保存失败，请检查网络后重试")
      return false
    }
  }, [])

  // 循环 9 A1：整包覆盖 PATCH 在飞串行 + coalesce——有在飞请求时只存最新快照，
  // 在飞 settle 后自动续发一次，杜绝慢旧响应后落定覆盖新数据；失败标志以最后一次实际请求为准
  const deckInflightRef = useRef<Promise<boolean> | null>(null)
  const deckPendingNextRef = useRef<{ rec: DeckRecord; quiet: boolean } | null>(null)
  const persistDeck = useCallback(
    (rec: DeckRecord, quiet = true): Promise<boolean> => {
      const start = (r: DeckRecord, q: boolean): Promise<boolean> => {
        const p = runDeckPersistOnce(r, q).then((ok) => {
          if (deckInflightRef.current === p) deckInflightRef.current = null
          const next = deckPendingNextRef.current
          if (next) {
            deckPendingNextRef.current = null
            void start(next.rec, next.quiet)
          }
          return ok
        })
        deckInflightRef.current = p
        return p
      }
      if (deckInflightRef.current) {
        deckPendingNextRef.current = { rec, quiet }
        return deckInflightRef.current
      }
      return start(rec, quiet)
    },
    [runDeckPersistOnce],
  )

  const scheduleDeckPersist = useCallback(
    (rec: DeckRecord) => {
      if (deckPersistRef.current) window.clearTimeout(deckPersistRef.current)
      deckPersistRef.current = window.setTimeout(() => {
        deckPersistRef.current = null
        void persistDeck(rec, true)
      }, 1200)
    },
    [persistDeck],
  )

  const flushDeckPersist = useCallback(() => {
    if (deckPersistRef.current) {
      window.clearTimeout(deckPersistRef.current)
      deckPersistRef.current = null
      const rec = activeDeckRef.current
      if (rec) void persistDeck(rec, true)
    }
  }, [persistDeck])

  // B4：失败横幅「立即保存」——清掉 pending 防抖后立刻落盘，成败都有明确反馈
  const saveDeckNow = useCallback(async () => {
    if (deckPersistRef.current) {
      window.clearTimeout(deckPersistRef.current)
      deckPersistRef.current = null
    }
    const rec = activeDeckRef.current
    if (!rec) return
    const ok = await persistDeck(rec, false)
    if (ok) toast.success("已保存")
  }, [persistDeck])

  const mutateDeck = useCallback(
    (fn: (d: DeckRecord) => DeckRecord) => {
      const cur = activeDeckRef.current
      if (!cur) return
      const next = fn(cur)
      applyDeckState(next)
      scheduleDeckPersist(next)
    },
    [applyDeckState, scheduleDeckPersist],
  )

  // ------------------------------ 新建 PPT 向导 ------------------------------
  const [wDeckName, setWDeckName] = useState("")
  const [wDeckType, setWDeckType] = useState<DeckTypeKey>("general")
  const [wTopic, setWTopic] = useState("")
  const [wAudience, setWAudience] = useState("院领导")
  const [wDuration, setWDuration] = useState("15")
  const [wKeyPoints, setWKeyPoints] = useState("")
  const [wMaterial, setWMaterial] = useState<MaterialRef | null>(null)
  const [deckGenerating, setDeckGenerating] = useState(false)
  const [deckProgress, setDeckProgress] = useState("")

  const suggestedPageCount = useMemo(() => suggestPageCount(Number(wDuration) || 10), [wDuration])
  // 目标页数：用户在向导里可直接指定；留空则按汇报时长的建议页数
  const [wPages, setWPages] = useState("")
  const targetPageCount = useMemo(() => {
    const n = Math.round(Number(wPages))
    if (!Number.isFinite(n) || n <= 0) return suggestedPageCount
    return Math.max(1, Math.min(40, n))
  }, [wPages, suggestedPageCount])

  // 导出页面切换动画（deck 级，导出时注入 OOXML；不持久化）
  const [deckTransition, setDeckTransition] = useState<DeckTransition>("fade")

  // 真实配图自动预分配（向导开关）："off" | "search" | "ai" | "hybrid"（先搜后 AI 兜底）
  const [autoFigureMode, setAutoFigureMode] = useState<"off" | "search" | "ai" | "hybrid">("off")
  const [autoFigureProvider, setAutoFigureProvider] = useState<ImageSearchProvider>("pexels")
  // 逐页预置开关：搜图/AI 生图的当页 busy 状态（0 = 闲置）
  const [slideFigureBusy, setSlideFigureBusy] = useState<{ index: number; kind: "search" | "ai" | "" }>({ index: -1, kind: "" })
  // TDZ 规避：`runAutoFigure` 定义在 `doGenerateDeck` 之后，deps 数组不能直接引用；
  // 用 ref 中转，定义完成后用 useEffect 同步，`doGenerateDeck` 中只读 `ref.current`。
  const runAutoFigureRef = useRef<((mode: "off" | "search" | "ai" | "hybrid", provider: ImageSearchProvider) => Promise<void>) | null>(null)

  // 真实配图：从医院官网取候选图池 + 逐页插入
  const [imagePool, setImagePool] = useState<{ source: string; loading: boolean; urls: string[]; error: string }>({
    source: "",
    loading: false,
    urls: [],
    error: "",
  })
  const [slideImageBusy, setSlideImageBusy] = useState(false)

  const openNewDeckWizard = useCallback(() => {
    flushDeckPersist()
    setWDeckName("")
    setWDeckType("general")
    setWTopic("")
    setWAudience("院领导")
    setWDuration("15")
    setWPages("")
    setWKeyPoints("")
    setWMaterial(null)
    setImagePool({ source: "", loading: false, urls: [], error: "" })
    applyDeckState(null)
    setDeckMode("wizard")
  }, [applyDeckState, flushDeckPersist])

  const closeDeckWizard = useCallback(() => {
    if (deckGenerating) return
    setDeckMode("list")
  }, [deckGenerating])

  const backToDeckList = useCallback(() => {
    flushDeckPersist()
    applyDeckState(null)
    setDeckMode("list")
    setEditorTab("edit")
  }, [applyDeckState, flushDeckPersist])

  const openDeck = useCallback(
    (rec: DeckRecord) => {
      flushDeckPersist()
      applyDeckState(sanitizeDeck(rec))
      setCurrentSlideIndex(0)
      setEditorTab("edit")
      setDeckMode("editor")
      // B4：切换 PPT 时清除上一份的保存失败横幅态
      setDeckPersistFailed(false)
    },
    [applyDeckState, flushDeckPersist],
  )

  const deleteDeck = useCallback(
    (rec: DeckRecord) => {
      requestConfirm({
        title: "删除 PPT",
        description: `确定删除「${rec.deck_name}」吗？删除后不可恢复。`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          void (async () => {
            try {
              await apiFetch(`/api/ppt_decks/${rec.id}`, { method: "DELETE" })
              setDeckList((prev) => prev.filter((d) => d.id !== rec.id))
              if (activeDeckRef.current?.id === rec.id) {
                applyDeckState(null)
                setDeckMode("list")
              }
              toast.success("已删除")
            } catch {
              toast.error("删除失败，请稍后重试")
            }
          })()
        },
      })
    },
    [applyDeckState, requestConfirm],
  )

  const doGenerateDeck = useCallback(async () => {
    const topic = wTopic.trim()
    const pageCount = targetPageCount
    const deckName = wDeckName.trim() || `${topic}汇报 PPT`
    const ctx = {
      deckType: wDeckType,
      topic,
      audience: wAudience,
      keyPoints: wKeyPoints,
      materialText: "",
    }
    setDeckGenerating(true)
    try {
      if (wMaterial) {
        setDeckProgress("正在读取方案/标书素材…")
        try {
          ctx.materialText = await fetchMaterialText(wMaterial)
        } catch {
          toast.error("素材读取失败，将不使用素材直接生成")
        }
      }
      let slides: Slide[]
      // R135：逐页生成韧性——单发/单批的瞬时失败或返空不再整单陪葬：
      // 每批自动重试 1 次，仍失败按大纲原位留「仅标题占位页」（emptySlide 无正文
      // 且 layout=auto，不会被自动配图选中二次烧钱），保住骨架供编辑器逐页补全；
      // 全军覆没才报错且不建空壳 deck。口径对齐标书批量编排「单批失败重试 1 次后跳过」。
      let placeholderCount = 0
      if (pageCount <= SINGLE_CALL_MAX_PAGES) {
        slides = await withGenerationRetry(
          async (attempt) => {
            setDeckProgress(attempt === 0 ? `正在生成 ${pageCount} 页内容…` : "生成未完成，正在自动重试…")
            const text = await llmGenerate(buildDeckSingleMessages(ctx, pageCount), MAX_TOKENS_LONGFORM, "ppt-deck", activeModelRef.current)
            // R149：单发路径按目标页数收敛，防模型自行加页（保留开场/致谢、裁中间正文）
            return normalizeSlides(parseJsonLoose(text), null, pageCount)
          },
          { isEmptyResult: (got) => got.length === 0, emptyMessage: "AI 未返回可用的页面内容，请重试" },
        )
      } else {
        setDeckProgress("正在生成整体大纲…")
        const outlineText = await llmGenerate(buildDeckOutlineMessages(ctx, pageCount), MAX_TOKENS_OUTLINE, "ppt-deck", activeModelRef.current)
        const plan: SlidePlan[] = normalizeSlidePlan(parseJsonLoose(outlineText), pageCount)
        const allTitles = plan.map((p) => p.title)
        const batches = chunk(plan, BATCH_SIZE)
        const batchResults = await runBatchesWithRetry<SlidePlan, Slide>({
          batches,
          generate: async (batch) => {
            const batchText = await llmGenerate(
              buildDeckBatchMessages(ctx, batch, allTitles),
              MAX_TOKENS_LONGFORM,
              "ppt-deck",
              activeModelRef.current,
            )
            return normalizeSlides(parseJsonLoose(batchText), batch)
          },
          onBatchStart: (i, total, attempt) =>
            setDeckProgress(
              attempt === 0
                ? `正在生成逐页内容（第 ${i + 1}/${total} 批，共 ${plan.length} 页）…`
                : `第 ${i + 1}/${total} 批生成失败，正在自动重试…`,
            ),
        })
        slides = []
        batchResults.forEach((got, i) => {
          if (got) {
            slides.push(...got)
          } else {
            for (const p of batches[i]) slides.push(emptySlide(p.title))
            placeholderCount += batches[i].length
          }
        })
        if (!slides.length || placeholderCount === slides.length) throw new Error("PPT 逐页生成均未成功，请稍后重试")
      }
      const created = await apiFetch<DeckRecord>("/api/ppt_decks", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          deck_name: deckName,
          deck_type: wDeckType,
          audience: wAudience,
          duration_min: Number(wDuration) || 10,
          material_ref: wMaterial ? JSON.stringify(wMaterial) : "",
          slides,
          doc_status: "done",
        }),
      })
      const rec = sanitizeDeck(created)
      setDeckList((prev) => [rec, ...prev])
      applyDeckState(rec)
      setCurrentSlideIndex(0)
      setEditorTab("edit")
      setDeckMode("editor")
      if (placeholderCount > 0) {
        toast.warning(`${rec.slides.length - placeholderCount}/${rec.slides.length} 页已生成，${placeholderCount} 页未成功已留标题占位，可在编辑器逐页补全后导出`)
      } else {
        toast.success(`已生成 ${rec.slides.length} 页，可逐页精修后导出`)
      }
      // 自动配图（开关开启时）：失败不阻断主流程，内部已 catch
      if (autoFigureMode !== "off") {
        // 释放当前 deckGenerating 锁后，自动配图会重新上锁
        setDeckGenerating(false)
        setDeckProgress("")
        await runAutoFigureRef.current?.(autoFigureMode, autoFigureProvider)
      }
    } catch (err) {
      handleGenError(err)
    } finally {
      setDeckGenerating(false)
      setDeckProgress("")
    }
  }, [
    applyDeckState,
    autoFigureMode,
    autoFigureProvider,
    fetchMaterialText,
    handleGenError,
    targetPageCount,
    userId,
    wAudience,
    wDeckName,
    wDeckType,
    wDuration,
    wKeyPoints,
    wMaterial,
    wTopic,
  ])

  const startDeckGeneration = useCallback(() => {
    if (!wTopic.trim()) {
      toast.error("请填写汇报主题")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void doGenerateDeck()
    }, `将调用 AI 生成整份 PPT 大纲与逐页内容，${costTextForModel(activeModelRef.current)}${skillCostSuffix("ppt-deck")}，具体以 RunningHub 为准`)
  }, [costConfirm, doGenerateDeck, wTopic])

  // ------------------------------ 逐页编辑 ------------------------------
  const currentSlide = useMemo(
    () => activeDeck?.slides?.[currentSlideIndex] ?? null,
    [activeDeck, currentSlideIndex],
  )

  const renameDeck = useCallback(
    (displayName: string) => {
      mutateDeck((d) => ({ ...d, deck_name: displayName }))
    },
    [mutateDeck],
  )

  const updateSlide = useCallback(
    (patch: Partial<Slide>) => {
      mutateDeck((d) => ({
        ...d,
        slides: d.slides.map((s, i) => (i === currentSlideIndex ? { ...s, ...patch } : s)),
      }))
    },
    [currentSlideIndex, mutateDeck],
  )

  const addSlide = useCallback(() => {
    const cur = activeDeckRef.current
    if (!cur) return
    const insertAt = Math.min(currentSlideIndex + 1, cur.slides.length)
    const slide = emptySlide("新页面")
    mutateDeck((d) => ({ ...d, slides: [...d.slides.slice(0, insertAt), slide, ...d.slides.slice(insertAt)] }))
    setCurrentSlideIndex(insertAt)
    setEditorTab("edit")
  }, [currentSlideIndex, mutateDeck])

  const deleteSlideAt = useCallback(
    (index: number) => {
      const cur = activeDeckRef.current
      if (!cur) return
      if (cur.slides.length <= 1) {
        toast.error("至少保留一页")
        return
      }
      requestConfirm({
        title: "删除该页",
        description: `确定删除第 ${index + 1} 页「${cur.slides[index]?.title ?? ""}」吗？`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          mutateDeck((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== index) }))
          setCurrentSlideIndex((prev) => Math.max(0, Math.min(prev, (cur.slides.length ?? 1) - 2)))
        },
      })
    },
    [mutateDeck, requestConfirm],
  )

  const moveSlide = useCallback(
    (index: number, dir: -1 | 1) => {
      const cur = activeDeckRef.current
      if (!cur) return
      const target = index + dir
      if (target < 0 || target >= cur.slides.length) return
      mutateDeck((d) => {
        const slides = [...d.slides]
        const [moved] = slides.splice(index, 1)
        slides.splice(target, 0, moved)
        return { ...d, slides }
      })
      setCurrentSlideIndex(target)
    },
    [mutateDeck],
  )

  const doRefineSlide = useCallback(
    async (deck: DeckRecord, slide: Slide, kind: RefineKind) => {
      setSlideAiKind(kind)
      try {
        const text = await llmGenerate(buildSlideRefineMessages(kind, deck, slide), MAX_TOKENS_OUTLINE, "ppt-deck", activeModelRef.current)
        const refined = normalizeSlides(parseJsonLoose(text), null)[0]
        mutateDeck((d) => ({
          ...d,
          slides: d.slides.map((s) =>
            s.id === slide.id
              ? {
                  ...s,
                  title: refined.title && !/^第\s*\d+\s*页$/.test(refined.title) ? refined.title : s.title,
                  bullets: refined.bullets?.length ? refined.bullets : s.bullets,
                  notes: refined.notes || s.notes,
                }
              : s,
          ),
        }))
        toast.success(`${REFINE_LABEL[kind]}完成`)
      } catch (err) {
        handleGenError(err)
      } finally {
        setSlideAiKind(null)
      }
    },
    [handleGenError, mutateDeck],
  )

  const refineSlide = useCallback(
    (kind: RefineKind) => {
      const deck = activeDeckRef.current
      const slide = deck?.slides?.[currentSlideIndex]
      if (!deck || !slide) return
      costConfirm.runWithCostConfirm(() => {
        void doRefineSlide(deck, slide, kind)
      }, `将调用 AI 执行「${REFINE_LABEL[kind]}」，${costTextForModel(activeModelRef.current)}${skillCostSuffix("ppt-deck")}`)
    },
    [costConfirm, currentSlideIndex, doRefineSlide],
  )

  // ------------------------------ R249 占位/空白页一键补全（串行、单页失败跳过、封顶 12 页控费） ------------------------------
  const blankSlideCount = useMemo(
    () => (activeDeck?.slides ?? []).filter(isBlankSlide).length,
    [activeDeck],
  )

  const doFillBlankSlides = useCallback(async () => {
    const deck = activeDeckRef.current
    if (!deck) return
    const targets = deck.slides.filter(isBlankSlide).slice(0, 12)
    if (!targets.length) {
      toast.info("没有需要补全的空白页")
      return
    }
    setFillingBlank(true)
    let ok = 0
    try {
      for (let k = 0; k < targets.length; k += 1) {
        const slide = targets[k]
        setFillProgress(`正在补全空白页（${k + 1}/${targets.length}）…`)
        const cur = activeDeckRef.current
        if (!cur) break
        try {
          const text = await llmGenerate(buildSlideRefineMessages("fill", cur, slide), MAX_TOKENS_OUTLINE, "ppt-deck", activeModelRef.current)
          const filled = normalizeSlides(parseJsonLoose(text), null)[0]
          if (filled && filled.bullets?.length) {
            mutateDeck((d) => ({
              ...d,
              slides: d.slides.map((x) =>
                x.id === slide.id
                  ? {
                      ...x,
                      title: filled.title && !/^第\s*\d+\s*页$/.test(filled.title) ? filled.title : x.title,
                      bullets: filled.bullets,
                      notes: filled.notes || x.notes,
                    }
                  : x,
              ),
            }))
            ok += 1
          }
        } catch {
          /* 单页补全失败：跳过继续，其余页照常（口径对齐逐页生成韧性） */
        }
      }
    } finally {
      setFillingBlank(false)
      setFillProgress("")
    }
    if (ok === 0) toast.error("空白页补全均未成功，请稍后逐页重试")
    else if (ok < targets.length) toast.warning(`已补全 ${ok}/${targets.length} 页，其余可在编辑器逐页重试`)
    else toast.success(`已补全 ${ok} 页空白内容`)
  }, [mutateDeck])

  const fillBlankSlides = useCallback(() => {
    costConfirm.runWithCostConfirm(
      () => {
        void doFillBlankSlides()
      },
      `将逐个补全 ${Math.min(blankSlideCount, 12)} 个空白页的正文，${costTextForModel(activeModelRef.current)}${skillCostSuffix("ppt-deck")}`,
    )
  }, [blankSlideCount, costConfirm, doFillBlankSlides])

  // ------------------------------ R169 公司模板主题（上传→提取→导出套用） ------------------------------
  const [deckTemplate, setDeckTemplate] = useState<StoredDeckTemplate | null>(() => loadDeckTemplate())

  // R190（r169 切片三）：模板保真体检——解包只随模板变化发生一次，逐页结论在展示层合成
  const deckTemplateProbe = useMemo(() => probeTemplateFacts(deckTemplate), [deckTemplate])

  const uploadDeckTemplate = useCallback(async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const theme = extractDeckTheme(bytes)
      if (!theme) {
        toast.error("未能从该文件提取主题色/字体：请确认是有效的 .pptx/.potx 模板（另存为标准 PowerPoint 格式）")
        return
      }
      // R189（r169 切片二）：模板字节同存 localStorage，纯文字页导出走母版级保真；超容量降级仅套主题
      const base: StoredDeckTemplate = { name: file.name, savedAt: Date.now(), theme }
      const bytesB64 = encodeTemplateBytes(bytes)
      let fidelityOn = false
      if (bytesB64) {
        try {
          saveDeckTemplate({ ...base, bytesB64 })
          fidelityOn = true
        } catch {
          /* localStorage 配额不足：只存主题令牌，不阻断上传 */
        }
      }
      if (!fidelityOn) saveDeckTemplate(base)
      const tpl: StoredDeckTemplate = fidelityOn && bytesB64 ? { ...base, bytesB64 } : base
      setDeckTemplate(tpl)
      toast.success(
        fidelityOn
          ? `已套用模板「${file.name}」主题（主色 #${theme.accents[0]}）：整册纯文字页导出将按模板母版/版式保真，讲稿写入备注；含图表图文的页仍按内置版式+主题色导出`
          : `已套用模板「${file.name}」主题（主色 #${theme.accents[0]}），下次导出 PPT 生效；模板过大或本地空间不足，未启用母版级保真`,
      )
    } catch {
      toast.error("模板读取失败，请重试或换一个文件")
    }
  }, [])

  const clearDeckTemplateChoice = useCallback(() => {
    clearDeckTemplate()
    setDeckTemplate(null)
    toast.success("已改用内置商务版式")
  }, [])

  // ------------------------------ PPT 导出 ------------------------------
  const exportPptx = useCallback(async () => {
    flushDeckPersist()
    const deck = activeDeckRef.current
    if (!deck?.slides?.length) {
      toast.error("没有可导出的页面")
      return
    }
    // 导出前结构自检：命中问题不阻断，只给一句可执行改进提示（借鉴顶级 skill 的自校验闭环）
    const lintIssues = lintDeck(deck.slides)
    if (lintIssues.length) {
      toast.warning(`导出前自检：${lintSummaryText(lintIssues)}；${lintIssues[0].msg}${lintIssues.length > 1 ? ` 等 ${lintIssues.length} 项` : ""}`)
    }
    try {
      // R124：pptxgenjs/docx 导出库改为点击导出时才按需加载，PPT 页进页不再背这几百 kB
      const { exportDeckPptx } = await import("./deckExports")
      // R189（r169 切片二）：模板字节可读且整册纯文字时，exportDeckPptx 内部走母版级保真通道
      const path = await exportDeckPptx(deck, {
        transition: deckTransition,
        theme: deckTemplate?.theme,
        templateBytes: decodeTemplateBytes(deckTemplate) ?? undefined,
      })
      toast.success(
        path === "fidelity"
          ? "PPT 已按公司模板母版/版式保真导出（纯文字页复用模板版式，讲稿写入演讲者备注）；文本框可在 Office/WPS 直接修改"
          : deckTransition === "none"
            ? "PPT 文件已导出（无切换动画）；文本框可在 Office/WPS 直接修改，讲稿已写入演讲者备注"
            : `PPT 文件已导出（含「${TRANSITION_LABEL[deckTransition]}」切换动画）；文本框与图片均可在 Office/WPS 直接修改`,
      )
      // R190：套了模板却没走保真通道时补一句归因，避免用户只在导出后看到「没变样」
      if (path === "legacy" && deckTemplate) {
        const why = finalizeFidelityProbe(deckTemplateProbe, deck.slides)
        toast.warning(
          why.reasons.length
            ? `本次未按模板版式保真导出：${why.reasons[0]}；详情见「模板保真体检」`
            : "本次按内置版式导出，模板配色与字体仍已套用；详情见「模板保真体检」",
        )
      }
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushDeckPersist, deckTransition, deckTemplate, deckTemplateProbe])

  // ------------------------------ 真实配图 ------------------------------
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "")
    } catch {
      return "图片来源"
    }
  }

  const setSlideImage = useCallback(
    (index: number, dataUrl: string, alt: string) => {
      mutateDeck((d) => ({
        ...d,
        slides: d.slides.map((s, i) => {
          if (i !== index) return s
          const keep = s.layout && ["image-right", "image-left", "banner"].includes(s.layout) ? s.layout : "image-right"
          return { ...s, image: dataUrl, imageAlt: s.imageAlt?.trim() || alt, layout: s.chart ? s.layout : keep }
        }),
      }))
    },
    [mutateDeck],
  )

  const clearSlideImage = useCallback(
    (index: number) => {
      mutateDeck((d) => ({
        ...d,
        slides: d.slides.map((s, i) => (i === index ? { ...s, image: undefined, imageAlt: undefined, layout: s.layout === "banner" || s.layout?.startsWith("image") ? "bullets" : s.layout } : s)),
      }))
    },
    [mutateDeck],
  )

  /** 从医院官网/名称取候选真实图片池 */
  const loadImagePool = useCallback(async (source: string) => {
    const q = source.trim()
    if (!q) {
      toast.error("请输入医院名称或官网地址")
      return
    }
    setImagePool({ source: q, loading: true, urls: [], error: "" })
    try {
      const looksUrl = /^https?:\/\//i.test(q) || /\.(cn|com|org|net|gov|net\.cn)(\/|$)/i.test(q)
      const r = await apiFetch<{ ok: boolean; images?: string[]; message?: string }>("/api/customers/fetch-site", {
        method: "POST",
        body: JSON.stringify(looksUrl ? { name: q.slice(0, 40), website: q } : { name: q }),
      })
      const urls = (r.images ?? []).slice(0, 18)
      if (!r.ok || !urls.length) {
        setImagePool({ source: q, loading: false, urls: [], error: r.message || "未从该来源取到可用图片，可换家医院或直接粘贴图片地址" })
        return
      }
      setImagePool({ source: q, loading: false, urls, error: "" })
    } catch {
      setImagePool({ source: q, loading: false, urls: [], error: "取图失败，请稍后重试" })
    }
  }, [])

  /** 通过服务端代理下载某候选图并插入指定页（绕跨域） */
  const attachImageFromUrl = useCallback(
    async (index: number, url: string) => {
      setSlideImageBusy(true)
      try {
        const r = await apiFetch<{ ok: boolean; dataUrl?: string; message?: string }>("/api/customers/fetch-image", {
          method: "POST",
          body: JSON.stringify({ url }),
        })
        if (!r.ok || !r.dataUrl) {
          toast.error(r.message || "图片下载失败，换一张试试")
          return
        }
        setSlideImage(index, r.dataUrl, hostOf(url))
        toast.success("真实图片已插入本页")
      } catch {
        toast.error("图片下载失败，请稍后重试")
      } finally {
        setSlideImageBusy(false)
      }
    },
    [setSlideImage],
  )

  /** 本地上传图片（浏览器 FileReader，dataURL 干净无跨域） */
  const uploadSlideImage = useCallback(
    (index: number, file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("请选择图片文件")
        return
      }
      if (file.size > 6 * 1024 * 1024) {
        toast.error("图片过大（>6MB），请换一张")
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || "")
        if (dataUrl.startsWith("data:image")) {
          setSlideImage(index, dataUrl, file.name.replace(/\.[^.]+$/, "").slice(0, 40))
          toast.success("图片已插入本页")
        } else {
          toast.error("图片读取失败")
        }
      }
      reader.onerror = () => toast.error("图片读取失败")
      reader.readAsDataURL(file)
    },
    [setSlideImage],
  )

  /** 一键：用当前图池给「有 imageHint 且无图」的页批量配真实图 */
  const applyPoolImagesToHinted = useCallback(async () => {
    const deck = activeDeckRef.current
    const pool = imagePool.urls
    if (!deck || !pool.length) {
      toast.error("请先取一张图池")
      return
    }
    const targets = deck.slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !s.image && (s.imageHint?.trim() || s.layout === "banner" || s.layout?.startsWith("image")))
    if (!targets.length) {
      toast.error("没有待配图的页（需 AI 标了配图关键词）")
      return
    }
    setSlideImageBusy(true)
    let ok = 0
    let ptr = 0
    for (const { i } of targets) {
      if (ptr >= pool.length) break
      const url = pool[ptr++]
      try {
        const r = await apiFetch<{ ok: boolean; dataUrl?: string }>("/api/customers/fetch-image", {
          method: "POST",
          body: JSON.stringify({ url }),
        })
        if (r.ok && r.dataUrl) {
          setSlideImage(i, r.dataUrl, hostOf(url))
          ok += 1
        }
      } catch {
        /* 单张失败跳过 */
      }
    }
    setSlideImageBusy(false)
    toast.success(ok ? `已为 ${ok} 页配上真实图片` : "配图失败，请逐页手动插入")
  }, [imagePool.urls, setSlideImage])

  /** 粘贴图片直链（走服务端代理下载） */
  const attachImageByPastedUrl = useCallback(
    async (index: number, url: string) => {
      const u = url.trim()
      if (!/^https?:\/\//i.test(u)) {
        toast.error("请输入 http(s) 图片地址")
        return
      }
      await attachImageFromUrl(index, u)
    },
    [attachImageFromUrl],
  )

  // ---------------- 逐页联网搜图 / AI 生图 ----------------

  /** 拉取图片 URL → dataURL，失败时抛内层错信息。 */
  const urlToDataUrl = useCallback(async (url: string): Promise<string> => {
    const r = await apiFetch<{ ok: boolean; dataUrl?: string; message?: string }>("/api/customers/fetch-image", {
      method: "POST",
      body: JSON.stringify({ url }),
    })
    if (!r.ok || !r.dataUrl) throw new Error(r.message || "图片代理下载失败")
    return r.dataUrl
  }, [])

  // ---------------- 素材库（R-008）：本地命中优先 → 实时搜图兜底 ----------------

  // 素材库元数据缓存（mode=meta 不含原图，量级轻）；ref + 在飞 promise，防 3 路并发重复拉取。
  const localMaterialsRef = useRef<MaterialItem[] | null>(null)
  const localMaterialsPromiseRef = useRef<Promise<MaterialItem[]> | null>(null)
  const ensureLocalMaterials = useCallback(async (): Promise<MaterialItem[]> => {
    if (localMaterialsRef.current) return localMaterialsRef.current
    if (!localMaterialsPromiseRef.current) {
      localMaterialsPromiseRef.current = apiFetch<{ items: MaterialItem[] }>("/api/materials?perPage=200&mode=meta")
        .then((d) => {
          const items = d.items || []
          localMaterialsRef.current = items
          return items
        })
        .catch(() => {
          // 拉取失败按空库处理，不阻断联网搜图兜底
          localMaterialsRef.current = []
          return []
        })
    }
    return localMaterialsPromiseRef.current
  }, [])

  /** 素材库有增删后由选图弹窗触发重拉 */
  const reloadLocalMaterials = useCallback(async () => {
    localMaterialsRef.current = null
    localMaterialsPromiseRef.current = null
    await ensureLocalMaterials()
  }, [ensureLocalMaterials])

  /** 素材库取全量记录并插入指定页（原图 dataURL 直接内嵌 deck，导出 PPTX 内嵌；引用数 +1） */
  const attachImageFromLibrary = useCallback(
    async (index: number, materialId: string) => {
      const deck = activeDeckRef.current
      const sl = deck?.slides?.[index]
      if (!sl) return false
      setSlideFigureBusy({ index, kind: "search" })
      try {
        const full = await apiFetch<MaterialItem>(`/api/materials/${materialId}`)
        if (!full.image_data) throw new Error("素材原图缺失")
        setSlideImage(index, full.image_data, `素材库 · ${full.name}`)
        apiFetch(`/api/materials/${materialId}/usage`, { method: "POST" }).catch(() => { /* 引用计数失败不影响插图 */ })
        toast.success(`已插入素材库图片「${full.name}」`)
        return true
      } catch (e) {
        toast.error(String((e as Error)?.message || e) || "素材库图片插入失败")
        return false
      } finally {
        setSlideFigureBusy({ index: -1, kind: "" })
      }
    },
    [setSlideImage],
  )

  /** 素材库本地命中：imageHint + 标题 + 首条要点 匹配 name/tags/category，命中即插图返回 true */
  const tryAttachFromLibrary = useCallback(
    async (index: number, sl: { imageHint?: string; title: string; bullets: string[] }): Promise<boolean> => {
      const materials = await ensureLocalMaterials()
      if (!materials.length) return false
      const pick = matchMaterials(sl.imageHint || "", sl.title, sl.bullets[0] || "", materials, 1)[0]
      if (!pick) return false
      const full = await apiFetch<MaterialItem>(`/api/materials/${pick.item.id}`)
      if (!full.image_data) return false
      setSlideImage(index, full.image_data, `素材库 · ${full.name}`)
      apiFetch(`/api/materials/${pick.item.id}/usage`, { method: "POST" }).catch(() => { /* 引用计数失败不影响插图 */ })
      return true
    },
    [ensureLocalMaterials, setSlideImage],
  )

  /** 单页搜图：按 imageHint/标题取候选，默认插首张命中，失败不阻断 */
  const searchAndAttachImage = useCallback(
    async (index: number, query?: string, providerOverride?: ImageSearchProvider) => {
      const deck = activeDeckRef.current
      const sl = deck?.slides?.[index]
      if (!sl) return false
      const provider = providerOverride || autoFigureProvider
      const q = (query || buildSearchQuery({ imageHint: sl.imageHint, title: sl.title, firstBullet: sl.bullets[0] })).trim()
      if (!q) {
        toast.error("本页无配图关键词且标题为空，无法搜图")
        return false
      }
      setSlideFigureBusy({ index, kind: "search" })
      try {
        // R-008 取图顺序①：素材库本地命中优先（快、离线可用、商用无忧），未命中/异常再走联网
        try {
          if (await tryAttachFromLibrary(index, sl)) {
            toast.success("已从素材库配图（本地图优先）")
            return true
          }
        } catch {
          /* 素材库未命中或异常 → 继续联网搜图 */
        }
        const res = await searchImages(provider, q, { perPage: 6 })
        if (!res.ok || !res.hits.length) {
          toast.error(res.message || "未搜到相关图片")
          return false
        }
        const hit = res.hits[0]
        const dataUrl = await urlToDataUrl(hit.url)
        setSlideImage(index, dataUrl, hit.alt || `${provider} · ${q}`)
        toast.success(`已从 ${hit.source} 配图`)
        return true
      } catch (e) {
        toast.error(String((e as Error)?.message || e) || "搜图失败")
        return false
      } finally {
        setSlideFigureBusy({ index: -1, kind: "" })
      }
    },
    [autoFigureProvider, setSlideImage, urlToDataUrl, tryAttachFromLibrary],
  )

  /** 单页 AI 生图（nano-banana-pro）：本地无 RH Key 会 401/412，不阻断主流程 */
  const doAiGenerateImageForSlide = useCallback(
    async (index: number, promptOverride?: string) => {
      const deck = activeDeckRef.current
      const sl = deck?.slides?.[index]
      if (!sl) return false
      const hint = (promptOverride || buildSearchQuery({ imageHint: sl.imageHint, title: sl.title, firstBullet: sl.bullets[0] })).trim()
      if (!hint) {
        toast.error("本页无可用提示词")
        return false
      }
      const prompt = `医疗信息化汇报 PPT 实景配图，主题：${hint}；专业、干净、真实感，避免文字水印与多余图标，水平构图 16:9`
      setSlideFigureBusy({ index, kind: "ai" })
      try {
        const r = await callAigcAndPoll("nano-banana-pro", {
          prompt,
          aspectRatio: "16:9",
          page: "ppt-deck",
        })
        if (r.status !== "success") {
          const msg = formatAigcFailureMessage(r as AigcFailure)
          toast.error(msg)
          return false
        }
        const url = r.url || r.outputs?.[0]?.url
        if (!url) {
          toast.error("AI 未返回图片 URL")
          return false
        }
        const dataUrl = await urlToDataUrl(url)
        setSlideImage(index, dataUrl, `AI · ${hint.slice(0, 24)}`)
        toast.success("AI 生图已插入本页")
        return true
      } catch (e) {
        toast.error(String((e as Error)?.message || e) || "AI 生图失败")
        return false
      } finally {
        setSlideFigureBusy({ index: -1, kind: "" })
      }
    },
    [setSlideImage, urlToDataUrl],
  )

  // 计费契约（useCostConfirm.ts 头注）：付费生图必须包 runWithCostConfirm。对齐标书侧
  // AI 位图口径：先价格预估（previewAigcPrice 从不 throw），确认后再执行逐页生图。
  const aiGenerateImageForSlide = useCallback(
    (index: number, promptOverride?: string) => {
      void previewAigcPrice("nano-banana-pro", { prompt: "预算预估", aspectRatio: "16:9", page: "ppt-deck" }).then((price) => {
        const priceText = price.ok && price.message ? `，预估单价 ${price.message}` : ""
        costConfirm.runWithCostConfirm(() => {
          void doAiGenerateImageForSlide(index, promptOverride)
        }, `将调用 AI 为本页生成实景配图（1 次生图调用${priceText}），实际扣费以 RunningHub 为准`)
      })
    },
    [costConfirm, doAiGenerateImageForSlide],
  )

  /**
   * 自动配图为当前 active deck 一切换完毕的 slides 补图：
   *   - search: 只跑图库搜索
   *   - ai:     只跑 AI 生图
   *   - hybrid: 先搜图，失败回退 AI 生图
   *   失败不阻断，每页内部 catch，并发 3 路，上限 12 页。
   */
  const runAutoFigure = useCallback(
    async (mode: "off" | "search" | "ai" | "hybrid", provider: ImageSearchProvider) => {
      if (mode === "off") return
      const deck = activeDeckRef.current
      if (!deck?.slides?.length) return
      const targets = deck.slides
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !s.image && (s.imageHint?.trim() || s.layout === "banner" || (s.layout || "").startsWith("image")))
        .slice(0, 12)
      if (!targets.length) return
      setDeckGenerating(true)
      setDeckProgress(`正在自动配图（共 ${targets.length} 页）…`)
      let done = 0
      let ok = 0
      const queue = targets.slice()
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const t = queue.shift()
          if (!t) break
          try {
            let inserted = false
            if (mode === "search" || mode === "hybrid") {
              // R-008 取图顺序①：先试素材库本地命中，未命中再联网搜图
              try {
                if (await tryAttachFromLibrary(t.i, t.s)) {
                  inserted = true
                  toast.success(`第 ${t.i + 1} 页已命中素材库配图`)
                }
              } catch {
                /* 本地未命中 → 联网搜图 */
              }
              if (!inserted) {
                const q = buildSearchQuery({ imageHint: t.s.imageHint, title: t.s.title, firstBullet: t.s.bullets[0] })
                if (q) {
                  try {
                    const res = await searchImages(provider, q, { perPage: 4 })
                    if (res.ok && res.hits.length) {
                      const hit = res.hits[0]
                      try {
                        const dataUrl = await urlToDataUrl(hit.url)
                        setSlideImage(t.i, dataUrl, hit.alt || `${provider} · ${q}`)
                        inserted = true
                      } catch {
                        /* 代理下载失败→下面 fall back AI */
                      }
                    }
                  } catch {
                    /* search 失败 → fallback */
                  }
                }
              }
            }
            if (!inserted && (mode === "ai" || mode === "hybrid")) {
              const hint = buildSearchQuery({ imageHint: t.s.imageHint, title: t.s.title, firstBullet: t.s.bullets[0] })
              if (hint) {
                const prompt = `医疗信息化汇报 PPT 实景配图，主题：${hint}；专业、干净、真实感，避免文字水印与多余图标，水平构图 16:9`
                try {
                  const r = await callAigcAndPoll("nano-banana-pro", { prompt, aspectRatio: "16:9", page: "ppt-deck" })
                  if (r.status === "success") {
                    const url = r.url || r.outputs?.[0]?.url
                    if (url) {
                      const dataUrl = await urlToDataUrl(url)
                      setSlideImage(t.i, dataUrl, `AI · ${hint.slice(0, 24)}`)
                      inserted = true
                    }
                  }
                } catch {
                  /* AI fail → skip */
                }
              }
            }
            if (inserted) ok += 1
          } finally {
            done += 1
            setDeckProgress(`正在自动配图（${done}/${targets.length}）…`)
          }
        }
      })
      await Promise.all(workers)
      setDeckGenerating(false)
      setDeckProgress("")
      if (ok === 0) {
        toast.info("自动配图未命中，可逐页手动重试")
      } else {
        toast.success(`自动配图完成：${ok}/${targets.length}`)
      }
    },
    [setSlideImage, urlToDataUrl, tryAttachFromLibrary],
  )

  // 同步 ref，让定义更早的 doGenerateDeck 能安全调用。
  useEffect(() => {
    runAutoFigureRef.current = runAutoFigure
  }, [runAutoFigure])


  const exportSpeech = useCallback(async () => {
    flushDeckPersist()
    const deck = activeDeckRef.current
    if (!deck?.slides?.length) {
      toast.error("没有可导出的页面")
      return
    }
    try {
      const { exportSpeechDocx } = await import("./deckExports")
      await exportSpeechDocx(deck)
      toast.success("讲稿 Word 已导出")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushDeckPersist])

  // ------------------------------ 报价列表 ------------------------------
  const [quoteList, setQuoteList] = useState<QuoteRecord[]>([])
  const [quoteListLoading, setQuoteListLoading] = useState(false)
  const [quoteSearch, setQuoteSearch] = useState("")
  const [quoteMode, setQuoteMode] = useState<"list" | "editor">("list")
  const [activeQuote, setActiveQuote] = useState<QuoteRecord | null>(null)
  const activeQuoteRef = useRef<QuoteRecord | null>(null)
  const quotePersistRef = useRef<number | null>(null)

  const loadQuotes = useCallback(async (uid: string) => {
    setQuoteListLoading(true)
    try {
      // B6：perPage 提到 200，避免服务端缺省 50 静默截断列表
      const data = await apiFetch<ListResponse<QuoteRecord>>(`/api/quotes?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`)
      setQuoteList((data.items ?? []).map(sanitizeQuote))
    } catch {
      toast.error("报价列表加载失败，请稍后重试")
    } finally {
      setQuoteListLoading(false)
    }
  }, [])

  const filteredQuotes = useMemo(() => {
    const kw = quoteSearch.trim().toLowerCase()
    if (!kw) return quoteList
    return quoteList.filter(
      (q) => q.quote_name?.toLowerCase().includes(kw) || q.ref_name?.toLowerCase().includes(kw),
    )
  }, [quoteList, quoteSearch])

  const applyQuoteState = useCallback((next: QuoteRecord | null) => {
    activeQuoteRef.current = next
    setActiveQuote(next)
    if (next) setQuoteList((prev) => prev.map((q) => (q.id === next.id ? next : q)))
  }, [])

  // 轮次 F 轨 2：报价 ↔ 商机关联（勾选「保存时同步金额」用 ref 透给防抖保存，避免闭包过期）
  const syncOppAmountRef = useRef(false)
  // 轮次 F 轨 2：「保存时同步金额到商机」勾选 state。
  // B3：声明上移到 openQuote/backToQuoteList 之前——两处切换报价时必须重置开关，
  // 否则报价 A 勾选后打开报价 B 仍勾选，保存 B 会无感知覆盖其关联商机金额
  const [syncOppAmountOnSave, setSyncOppAmountOnSaveState] = useState(false)
  const resetSyncOppAmount = useCallback(() => {
    setSyncOppAmountOnSaveState(false)
    syncOppAmountRef.current = false
  }, [])
  // D6：商机金额同步失败态（编辑器头部 chip 标黄提示「金额未同步」，同步成功后清除）
  const [oppSyncFailed, setOppSyncFailed] = useState(false)
  // B4：报价防抖保存失败标志（与 deckPersistFailed 同语义，横幅提示 + beforeunload 拦截）
  const [quotePersistFailed, setQuotePersistFailed] = useState(false)

  const runQuotePersistOnce = useCallback(async (rec: QuoteRecord, quiet: boolean): Promise<boolean> => {
    try {
      await apiFetch(`/api/quotes/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quote_name: rec.quote_name,
          groups: rec.groups,
          tax_note: rec.tax_note,
          version: rec.version,
          ref_type: rec.ref_type,
          ref_id: rec.ref_id,
          ref_name: rec.ref_name,
          opportunity_id: rec.opportunity_id ?? "",
          opportunity_name: rec.opportunity_name ?? "",
        }),
      })
      setQuotePersistFailed(false)
      // 轮次 F 轨 2：勾选「保存时同步金额到商机」则把报价总额回写商机 expected_amount
      if (syncOppAmountRef.current && rec.opportunity_id) {
        try {
          const total = quoteTotal(rec.groups ?? [])
          await apiFetch(`/api/opportunities/${encodeURIComponent(rec.opportunity_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ expected_amount: total }),
          })
          setOppSyncFailed(false)
        } catch {
          // D6：金额同步失败不影响报价本身的保存，但必须明示用户（toast 固定 id 防抖去重）
          setOppSyncFailed(true)
          toast.error("商机金额同步失败，报价已保存但商机预计金额未更新", { id: "opp-amount-sync-failed" })
        }
      }
      return true
    } catch {
      setQuotePersistFailed(true)
      if (!quiet) toast.error("保存失败，请检查网络后重试")
      return false
    }
  }, [])

  // 循环 9 A1：整包覆盖 PATCH 在飞串行 + coalesce（与 persistDeck 同机制）
  const quoteInflightRef = useRef<Promise<boolean> | null>(null)
  const quotePendingNextRef = useRef<{ rec: QuoteRecord; quiet: boolean } | null>(null)
  const persistQuote = useCallback(
    (rec: QuoteRecord, quiet = true): Promise<boolean> => {
      const start = (r: QuoteRecord, q: boolean): Promise<boolean> => {
        const p = runQuotePersistOnce(r, q).then((ok) => {
          if (quoteInflightRef.current === p) quoteInflightRef.current = null
          const next = quotePendingNextRef.current
          if (next) {
            quotePendingNextRef.current = null
            void start(next.rec, next.quiet)
          }
          return ok
        })
        quoteInflightRef.current = p
        return p
      }
      if (quoteInflightRef.current) {
        quotePendingNextRef.current = { rec, quiet }
        return quoteInflightRef.current
      }
      return start(rec, quiet)
    },
    [runQuotePersistOnce],
  )

  const scheduleQuotePersist = useCallback(
    (rec: QuoteRecord) => {
      if (quotePersistRef.current) window.clearTimeout(quotePersistRef.current)
      quotePersistRef.current = window.setTimeout(() => {
        quotePersistRef.current = null
        void persistQuote(rec, true)
      }, 1200)
    },
    [persistQuote],
  )

  const flushQuotePersist = useCallback(() => {
    if (quotePersistRef.current) {
      window.clearTimeout(quotePersistRef.current)
      quotePersistRef.current = null
      const rec = activeQuoteRef.current
      if (rec) void persistQuote(rec, true)
    }
  }, [persistQuote])

  // B4：失败横幅「立即保存」——清掉 pending 防抖后立刻落盘，成败都有明确反馈
  const saveQuoteNow = useCallback(async () => {
    if (quotePersistRef.current) {
      window.clearTimeout(quotePersistRef.current)
      quotePersistRef.current = null
    }
    const rec = activeQuoteRef.current
    if (!rec) return
    const ok = await persistQuote(rec, false)
    if (ok) toast.success("已保存")
  }, [persistQuote])

  // B4：有 pending 防抖保存或保存失败时，关页签/刷新弹浏览器确认（标准 returnValue 写法），
  // 并尽力 flush 一次未落盘内容（beforeunload 内无法 await，尽力而为）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const deckPending = deckPersistRef.current !== null
      const quotePending = quotePersistRef.current !== null
      if (!deckPending && !quotePending && !deckPersistFailed && !quotePersistFailed) return
      if (deckPending) flushDeckPersist()
      if (quotePending) flushQuotePersist()
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [deckPersistFailed, quotePersistFailed, flushDeckPersist, flushQuotePersist])

  const mutateQuote = useCallback(
    (fn: (q: QuoteRecord) => QuoteRecord) => {
      const cur = activeQuoteRef.current
      if (!cur) return
      const next = fn(cur)
      applyQuoteState(next)
      scheduleQuotePersist(next)
    },
    [applyQuoteState, scheduleQuotePersist],
  )

  const openQuote = useCallback(
    (rec: QuoteRecord) => {
      flushQuotePersist()
      applyQuoteState(sanitizeQuote(rec))
      setQuoteMode("editor")
      // D6：切换报价时清除上一份的「金额未同步」提示态
      setOppSyncFailed(false)
      // B4：切换报价时清除上一份的保存失败横幅态
      setQuotePersistFailed(false)
      // B3：切换报价时重置「保存时同步金额到商机」开关，防止跨报价粘性覆盖商机金额
      resetSyncOppAmount()
    },
    [applyQuoteState, flushQuotePersist, resetSyncOppAmount],
  )

  const backToQuoteList = useCallback(() => {
    flushQuotePersist()
    applyQuoteState(null)
    setQuoteMode("list")
    setOppSyncFailed(false)
    // B3：回列表同样重置同步开关，下次进入任何报价都从默认「关」开始
    resetSyncOppAmount()
  }, [applyQuoteState, flushQuotePersist, resetSyncOppAmount])

  // 轮次 B + D2：全局搜索深链 ?deck= / ?quote= 消费（ref 存「已消费 id」，URL id 变化即重新消费）
  const [searchParams] = useSearchParams()
  const deckDeepLinkIdRef = useRef<string | null>(null)
  const quoteDeepLinkIdRef = useRef<string | null>(null)
  useEffect(() => {
    const deckId = searchParams.get("deck")
    if (deckId && deckDeepLinkIdRef.current !== deckId) {
      deckDeepLinkIdRef.current = deckId
      const target = deckList.find((d) => d.id === deckId)
      if (target) {
        setActiveView("deck")
        openDeck(target)
      } else {
        void apiFetch<DeckRecord>(`/api/ppt_decks/${encodeURIComponent(deckId)}`)
          .then((rec) => {
            if (!rec?.id) {
              toast.error("未找到对应 PPT")
              return
            }
            setActiveView("deck")
            openDeck(sanitizeDeck(rec))
          })
          .catch(() => toast.error("未找到对应 PPT"))
      }
    }
    const quoteId = searchParams.get("quote")
    if (quoteId && quoteDeepLinkIdRef.current !== quoteId) {
      quoteDeepLinkIdRef.current = quoteId
      const target = quoteList.find((q) => q.id === quoteId)
      if (target) {
        setActiveView("quote")
        openQuote(target)
      } else {
        void apiFetch<QuoteRecord>(`/api/quotes/${encodeURIComponent(quoteId)}`)
          .then((rec) => {
            if (!rec?.id) {
              toast.error("未找到对应报价")
              return
            }
            setActiveView("quote")
            openQuote(sanitizeQuote(rec))
          })
          .catch(() => toast.error("未找到对应报价"))
      }
    }
  }, [searchParams, deckList, quoteList, openDeck, openQuote])

  const deleteQuote = useCallback(
    (rec: QuoteRecord) => {
      requestConfirm({
        title: "删除报价",
        description: `确定删除报价「${rec.quote_name}」吗？删除后不可恢复。`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          void (async () => {
            try {
              await apiFetch(`/api/quotes/${rec.id}`, { method: "DELETE" })
              setQuoteList((prev) => prev.filter((q) => q.id !== rec.id))
              if (activeQuoteRef.current?.id === rec.id) {
                applyQuoteState(null)
                setQuoteMode("list")
              }
              toast.success("已删除")
            } catch {
              toast.error("删除失败，请稍后重试")
            }
          })()
        },
      })
    },
    [applyQuoteState, requestConfirm],
  )

  // ------------------------------ 新建报价 ------------------------------
  const [newQuoteOpen, setNewQuoteOpen] = useState(false)
  const [nqName, setNqName] = useState("")
  const [nqRef, setNqRef] = useState<MaterialRef | null>(null)
  const [nqOpportunityId, setNqOpportunityId] = useState("")
  const [quoteCreating, setQuoteCreating] = useState(false)

  // 商机下拉选项（轮次 F 轨 2，加载失败不阻塞报价主流程）
  const [quoteOppOptions, setQuoteOppOptions] = useState<QuoteOppOption[]>([])
  useEffect(() => {
    if (!userId) {
      setQuoteOppOptions([])
      return
    }
    void (async () => {
      try {
        const data = await apiFetch<ListResponse<QuoteOppOption>>(
          `/api/opportunities?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=200`,
        )
        setQuoteOppOptions(data.items ?? [])
      } catch {
        setQuoteOppOptions([])
      }
    })()
  }, [userId])

  const openNewQuote = useCallback(() => {
    setNqName("")
    setNqRef(null)
    setNqOpportunityId("")
    setNewQuoteOpen(true)
  }, [])

  const createQuote = useCallback(async () => {
    if (quoteCreating) return
    const quoteName = nqName.trim() || `报价单 ${localDateStamp()}`
    const groups: QuoteGroup[] = makeDefaultGroups()
    const nqOpp = quoteOppOptions.find((o) => o.id === nqOpportunityId)
    setQuoteCreating(true)
    try {
      const created = await apiFetch<QuoteRecord>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          quote_name: quoteName,
          ref_type: nqRef?.type ?? "",
          ref_id: nqRef?.id ?? "",
          ref_name: nqRef?.name ?? "",
          opportunity_id: nqOpp?.id ?? "",
          opportunity_name: nqOpp ? (nqOpp.customer_name ? `${nqOpp.customer_name} · ${nqOpp.opp_name}` : nqOpp.opp_name) : "",
          groups,
          tax_note: "软件与服务按 6% 增值税计，硬件按 13% 计；报价有效期 30 天，最终以合同为准。",
          version: "v1",
        }),
      })
      const rec = sanitizeQuote(created)
      setQuoteList((prev) => [rec, ...prev])
      applyQuoteState(rec)
      setQuoteMode("editor")
      setNewQuoteOpen(false)
      // B3：新建报价进入编辑器同样从默认「关」开始，防开关跨报价粘性
      resetSyncOppAmount()
      toast.success("报价已创建，可手动录入或用 AI 生成初稿")
    } catch {
      toast.error("创建失败，请检查网络后重试")
    } finally {
      setQuoteCreating(false)
    }
  }, [applyQuoteState, nqName, nqOpportunityId, nqRef, quoteCreating, quoteOppOptions, resetSyncOppAmount, userId])

  const copyQuoteAsVersion = useCallback(
    async (rec: QuoteRecord) => {
      const nextVersion = bumpVersion(rec.version)
      try {
        const created = await apiFetch<QuoteRecord>("/api/quotes", {
          method: "POST",
          body: JSON.stringify({
            rh_user_id: userId,
            quote_name: rec.quote_name,
            ref_type: rec.ref_type,
            ref_id: rec.ref_id,
            ref_name: rec.ref_name,
            opportunity_id: rec.opportunity_id ?? "",
            opportunity_name: rec.opportunity_name ?? "",
            groups: deepCopyGroups(rec.groups),
            tax_note: rec.tax_note,
            version: nextVersion,
          }),
        })
        const next = sanitizeQuote(created)
        setQuoteList((prev) => [next, ...prev])
        applyQuoteState(next)
        setQuoteMode("editor")
        // B3：复制版本进入编辑器同样重置同步开关（复制体带源报价的商机，粘性开关会静默覆盖其金额）
        resetSyncOppAmount()
        toast.success(`已复制为 ${nextVersion}，可在此基础上调整`)
      } catch {
        toast.error("复制失败，请稍后重试")
      }
    },
    [applyQuoteState, resetSyncOppAmount, userId],
  )

  // ------------------------------ 报价编辑 ------------------------------
  const quoteTotals = useMemo(() => {
    const byGroup: Record<string, number> = {}
    const groups = activeQuote?.groups ?? []
    for (const g of groups) byGroup[g.id] = groupSubtotal(g)
    return { byGroup, total: quoteTotal(groups) }
  }, [activeQuote])

  // 轮次 F 轨 2：勾选瞬间先立即同步一次给出反馈（开关 state 声明已上移，见 resetSyncOppAmount 处）
  const handleSyncOppAmountChange = useCallback((checked: boolean) => {
    setSyncOppAmountOnSaveState(checked)
    syncOppAmountRef.current = checked
    const rec = activeQuoteRef.current
    if (!checked || !rec?.opportunity_id) return
    const total = quoteTotal(rec.groups ?? [])
    void apiFetch(`/api/opportunities/${encodeURIComponent(rec.opportunity_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_amount: total }),
    })
      .then(() => {
        setOppSyncFailed(false)
        toast.success("已把报价总额同步到商机预计金额，后续保存自动更新")
      })
      .catch(() => {
        // D6：勾选瞬间的立即同步失败也进「金额未同步」提示态
        setOppSyncFailed(true)
        toast.error("商机金额同步失败，报价已保存但商机预计金额未更新", { id: "opp-amount-sync-failed" })
      })
  }, [])

  const updateQuoteName = useCallback(
    (quoteName: string) => mutateQuote((q) => ({ ...q, quote_name: quoteName })),
    [mutateQuote],
  )
  const updateTaxNote = useCallback(
    (taxNote: string) => mutateQuote((q) => ({ ...q, tax_note: taxNote })),
    [mutateQuote],
  )
  const updateVersion = useCallback(
    (version: string) => mutateQuote((q) => ({ ...q, version })),
    [mutateQuote],
  )

  const addQuoteGroup = useCallback(() => {
    mutateQuote((q) => ({ ...q, groups: [...q.groups, { id: makeUid(), name: "新分组", items: [] }] }))
  }, [mutateQuote])

  const deleteQuoteGroup = useCallback(
    (groupId: string) => {
      const cur = activeQuoteRef.current
      const groupName = cur?.groups.find((g) => g.id === groupId)?.name ?? ""
      requestConfirm({
        title: "删除分组",
        description: `确定删除分组「${groupName}」及其全部行项吗？`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          mutateQuote((q) => ({ ...q, groups: q.groups.filter((g) => g.id !== groupId) }))
        },
      })
    },
    [mutateQuote, requestConfirm],
  )

  const renameQuoteGroup = useCallback(
    (groupId: string, groupName: string) => {
      mutateQuote((q) => ({ ...q, groups: q.groups.map((g) => (g.id === groupId ? { ...g, name: groupName } : g)) }))
    },
    [mutateQuote],
  )

  const addQuoteItem = useCallback(
    (groupId: string) => {
      mutateQuote((q) => ({
        ...q,
        groups: q.groups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                items: [
                  ...g.items,
                  { id: makeUid(), item_name: "", spec: "", unit: "套", qty: 1, price: 0, discount: 100 },
                ],
              }
            : g,
        ),
      }))
    },
    [mutateQuote],
  )

  const addQuoteItemWithData = useCallback(
    (groupId: string, data: Omit<QuoteItem, "id">) => {
      mutateQuote((q) => ({
        ...q,
        groups: q.groups.map((g) => (g.id === groupId ? { ...g, items: [...g.items, { ...data, id: makeUid() }] } : g)),
      }))
    },
    [mutateQuote],
  )

  const updateQuoteItem = useCallback(
    (groupId: string, itemId: string, patch: Partial<QuoteItem>) => {
      mutateQuote((q) => ({
        ...q,
        groups: q.groups.map((g) =>
          g.id === groupId ? { ...g, items: g.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) } : g,
        ),
      }))
    },
    [mutateQuote],
  )

  // r281-quote-discount-no-entry（R285）：按组批量改折扣%。谈判场景「整包九折」常用，
  // 逐行手改易漏；非法值按 normalizeDiscount 口径兜底（0/缺省 = 原价 100）。
  const setGroupDiscount = useCallback(
    (groupId: string, discount: number) => {
      const d =
        discount == null || !Number.isFinite(discount) || discount <= 0
          ? 100
          : Math.min(100, Math.round(discount * 100) / 100)
      mutateQuote((q) => ({
        ...q,
        groups: q.groups.map((g) =>
          g.id === groupId ? { ...g, items: (g.items ?? []).map((it) => ({ ...it, discount: d })) } : g,
        ),
      }))
    },
    [mutateQuote],
  )

  const deleteQuoteItem = useCallback(
    (groupId: string, itemId: string) => {
      const cur = activeQuoteRef.current
      const itemName = cur?.groups.find((g) => g.id === groupId)?.items.find((it) => it.id === itemId)?.item_name || "未命名"
      requestConfirm({
        title: "删除行项",
        description: `确定删除行项「${itemName}」吗？`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          mutateQuote((q) => ({
            ...q,
            groups: q.groups.map((g) => (g.id === groupId ? { ...g, items: g.items.filter((it) => it.id !== itemId) } : g)),
          }))
        },
      })
    },
    [mutateQuote, requestConfirm],
  )

  // ------------------------------ 我公司系统清单（与建设清单同源） ------------------------------
  // CheckProduct / ChecklistRecord 不取时 → 不阻断报价主流程；TTL 5min 避免频繁重拉。
  // 声明位置前置到 AI 草案回调之前，规避 useCallback 依赖的 TDZ 报错。
  const [checkProducts, setCheckProducts] = useState<CheckProduct[]>([])
  const [checkProductsLoading, setCheckProductsLoading] = useState(false)
  const [checklists, setChecklists] = useState<ChecklistRecord[]>([])
  const [checklistsLoading, setChecklistsLoading] = useState(false)
  const [checkProductPickerOpen, setCheckProductPickerOpen] = useState(false)
  const [checklistImportOpen, setChecklistImportOpen] = useState(false)
  const catalogFetchAtRef = useRef(0)
  const checklistsFetchAtRef = useRef(0)

  const loadCheckProducts = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - catalogFetchAtRef.current < 5 * 60 * 1000 && checkProducts.length) return
    catalogFetchAtRef.current = now
    setCheckProductsLoading(true)
    try {
      const data = await apiFetch<ListResponse<CheckProduct>>("/api/check_products?page=1&perPage=200")
      setCheckProducts(data.items ?? [])
    } catch {
      // 目录加载失败不阻断主流程（同旧 product_library 容错口径）
    } finally {
      setCheckProductsLoading(false)
    }
  }, [checkProducts.length])

  const loadChecklists = useCallback(async (uid: string, force = false) => {
    const now = Date.now()
    if (!force && now - checklistsFetchAtRef.current < 5 * 60 * 1000 && checklists.length) return
    checklistsFetchAtRef.current = now
    setChecklistsLoading(true)
    try {
      const data = await apiFetch<ListResponse<ChecklistRecord>>(
        `/api/checklists?rh_user_id=${encodeURIComponent(uid)}&perPage=200`,
      )
      setChecklists(data.items ?? [])
    } catch {
      // 忽略：导入入口自动置空
    } finally {
      setChecklistsLoading(false)
    }
  }, [checklists.length])

  const refreshCheckProducts = useCallback(() => {
    void loadCheckProducts(true)
  }, [loadCheckProducts])

  const refreshChecklists = useCallback(() => {
    if (userId) void loadChecklists(userId, true)
  }, [loadChecklists, userId])

  // ------------------------------ 报价 AI 初稿 ------------------------------
  const [quoteAiOpen, setQuoteAiOpen] = useState(false)
  const [draftRef, setDraftRef] = useState<MaterialRef | null>(null)
  const [quoteAiBusy, setQuoteAiBusy] = useState(false)

  const openQuoteAi = useCallback(() => {
    const cur = activeQuoteRef.current
    setDraftRef(
      cur?.ref_id ? { type: cur.ref_type === "bid" ? "bid" : "solution", id: cur.ref_id, name: cur.ref_name } : null,
    )
    setQuoteAiOpen(true)
  }, [])

  const doGenerateQuoteDraft = useCallback(async () => {
    const ref = draftRef
    if (!ref) return
    setQuoteAiBusy(true)
    try {
      // 确保目录已加载（新报价首次进 AI 草案时拉取一次）
      if (!checkProducts.length) {
        await loadCheckProducts(true)
      }
      const materialText = await fetchMaterialText(ref)
      const catalogForPrompt = checkProducts.length ? checkProducts : []
      const text = await llmGenerate(
        buildQuoteDraftMessages(ref.name, materialText, catalogForPrompt),
        MAX_TOKENS_LONGFORM,
        "quote-draft",
        activeModelRef.current,
      )
      const { items: drafts, filtered } = normalizeDraftItemsFromCatalog(parseJsonLoose(text), catalogForPrompt)
      if (!drafts.length) {
        toast.warning(
          filtered > 0
            ? `AI 返回 ${filtered} 条均不在产品库中，已忽略。建议先丰富产品库或手工加行。`
            : "AI 未从产品库匹配到任何行项，建议手工导入或调整素材。",
        )
        setQuoteAiOpen(false)
        return
      }
      let added = 0
      let skipped = 0
      mutateQuote((q) => {
        const merged = mergeItemsIntoGroups(q.groups, drafts)
        added = merged.added
        skipped = merged.skipped
        return { ...q, ref_type: ref.type, ref_id: ref.id, ref_name: ref.name, groups: merged.groups }
      })
      setQuoteAiOpen(false)
      const filteredNote = filtered > 0 ? `，过滤 ${filtered} 条非目录项` : ""
      const skippedNote = skipped > 0 ? `，跳过 ${skipped} 条重复` : ""
      toast.success(`AI 初稿完成：新增 ${added} 条${skippedNote}${filteredNote}，价格待人工录入`)
    } catch (err) {
      handleGenError(err)
    } finally {
      setQuoteAiBusy(false)
    }
  }, [checkProducts.length, draftRef, fetchMaterialText, handleGenError, loadCheckProducts, mutateQuote])

  const generateQuoteDraft = useCallback(() => {
    if (!draftRef) {
      toast.error("请先选择方案或标书项目")
      return
    }
    if (!activeQuoteRef.current) return
    costConfirm.runWithCostConfirm(() => {
      void doGenerateQuoteDraft()
    }, `将调用 AI 按建设内容推荐报价行项初稿，${costTextForModel(activeModelRef.current)}${skillCostSuffix("quote-draft")}`)
  }, [costConfirm, doGenerateQuoteDraft, draftRef])

  // ------------------------------ 报价导出 ------------------------------
  const exportQuoteExcel = useCallback(async () => {
    flushQuotePersist()
    const quote = activeQuoteRef.current
    if (!quote) return
    try {
      const { exportQuoteXlsx } = await import("./quoteExports")
      await exportQuoteXlsx(quote)
      toast.success("Excel 报价表已导出（含分组小计与总计公式、千分位金额格式）")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushQuotePersist])

  const exportQuoteWord = useCallback(async () => {
    flushQuotePersist()
    const quote = activeQuoteRef.current
    if (!quote) return
    try {
      const { exportQuoteDocx } = await import("./quoteExports")
      await exportQuoteDocx(quote)
      toast.success("Word 报价单已导出")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushQuotePersist])

  // ------------------------------ 常用产品库 ------------------------------
  const [productItems, setProductItems] = useState<ProductItem[]>([])
  const [productLoading, setProductLoading] = useState(false)
  const [productPickerGroup, setProductPickerGroup] = useState<string | null>(null)

  /** 从产品库单条追加到报价（一个或多个 product_id + qty）；自动按 category 归组，价格默认 0（后录） */
  const addCheckProductsToQuote = useCallback(
    (picks: { productId: string; qty?: number }[], opts: { zeroPrice?: boolean } = {}) => {
      const cur = activeQuoteRef.current
      if (!cur) return
      const drafts = picks
        .map(({ productId, qty }) => {
          const p = checkProducts.find((x) => x.id === productId)
          if (!p) return null
          return quoteItemFromProduct(p, { zeroPrice: opts.zeroPrice ?? true, qty: qty ?? 1 })
        })
        .filter((x): x is Omit<QuoteItem, "id"> => Boolean(x))
      if (!drafts.length) {
        toast.error("产品库中未匹配到选中项")
        return
      }
      mutateQuote((q) => ({ ...q, ...mergeItemsIntoGroups(q.groups, drafts) }))
      const skipped = drafts.length - new Set(drafts.map((d) => `${d.category}::${d.product_name}::${d.module_name}`)).size
      toast.success(`已导入 ${drafts.length} 条产品${skipped ? `，其中 ${skipped} 条重复已去重` : ""}`)
    },
    [checkProducts, mutateQuote],
  )

  /** 从一份建设清单导入报价（zeroPrice 开关控制价格是否后置录入） */
  const importFromChecklist = useCallback(
    (checklistId: string, opts: { zeroPrice: boolean }) => {
      const rec = checklists.find((c) => c.id === checklistId)
      if (!rec) {
        toast.error("未找到建设清单")
        return
      }
      const kept = (rec.items ?? []).filter((l) => l.checked !== false)
      if (!kept.length) {
        toast.error("该清单暂无已勾选行项")
        return
      }
      const drafts = kept.map((l) => {
        const p = l.product_id ? checkProducts.find((x) => x.id === l.product_id) : null
        if (p) {
          return {
            ...quoteItemFromProduct(p, { zeroPrice: opts.zeroPrice, qty: l.qty || 1 }),
            module_func: l.module_func || p.module_func,
            source: l.source,
            rating_hits: l.rating_hits ?? [],
            remark: l.remark ?? "",
          }
        }
        return {
          item_name: l.product_name,
          spec: l.module_func || "",
          unit: l.unit || "套",
          qty: Math.max(1, Number(l.qty) || 1),
          price: opts.zeroPrice ? 0 : Number(l.unit_price) || 0,
          discount: 100,
          category: l.category || "未分类",
          product_line: l.product_line,
          product_name: l.product_name,
          module_name: l.module_name,
          module_func: l.module_func,
          source: l.source,
          product_id: l.product_id,
          rating_hits: l.rating_hits ?? [],
          remark: l.remark,
        }
      })
      let addedN = 0
      let skippedN = 0
      mutateQuote((q) => {
        const merged = mergeItemsIntoGroups(q.groups, drafts)
        addedN = merged.added
        skippedN = merged.skipped
        return { ...q, groups: merged.groups }
      })
      toast.success(`从清单「${rec.checklist_name}」导入 ${addedN} 条${skippedN ? `，跳过 ${skippedN} 条已存在` : ""}`)
      setChecklistImportOpen(false)
    },
    [checkProducts, checklists, mutateQuote],
  )

  /** 手工添加一行（归入当前分组，无 product_id，标记为 external） */
  const addManualItem = useCallback(
    (groupId: string) => {
      mutateQuote((q) => ({
        ...q,
        groups: q.groups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                items: [
                  ...g.items,
                  {
                    id: makeUid(),
                    item_name: "",
                    spec: "",
                    unit: "套",
                    qty: 1,
                    price: 0,
                    discount: 100,
                    category: g.name || "未分类",
                    source: "external",
                    rating_hits: [],
                    remark: "",
                  },
                ],
              }
            : g,
        ),
      }))
    },
    [mutateQuote],
  )

  const openCheckProductPicker = useCallback(() => {
    void loadCheckProducts()
    setCheckProductPickerOpen(true)
  }, [loadCheckProducts])
  const closeCheckProductPicker = useCallback(() => setCheckProductPickerOpen(false), [])

  const openChecklistImport = useCallback(() => {
    if (userId) void loadChecklists(userId)
    void loadCheckProducts()
    setChecklistImportOpen(true)
  }, [loadCheckProducts, loadChecklists, userId])
  const closeChecklistImport = useCallback(() => setChecklistImportOpen(false), [])

  // quote-history-01（最小切片）：同一客户（同商机）的历史报价参考 + 一键导入明细（纯检索零 AI，deepCopyGroups 重生 id 防冲突）
  const historyQuotes = useMemo(() => historyQuotesFor(activeQuote, quoteList), [activeQuote, quoteList])
  // R79 quote-history-2 第一步：标记/取消「成交参考样本」——PATCH 沉淀字段（won_sample + 客户档案派生元数据）
  const toggleWonSample = useCallback(
    async (quote: QuoteRecord) => {
      const next = !quote.won_sample
      let hospital_level = quote.hospital_level ?? ""
      let beds_total = quote.beds_total ?? 0
      let modules_summary = quote.modules_summary ?? ""
      if (next) {
        // 从报价分组名聚合模块摘要（每分组取名，≤500 字）
        modules_summary = (quote.groups ?? []).map((g) => g.name).filter(Boolean).join(",").slice(0, 500)
        // 关联客户档案派生医院等级/床位：经商机名匹配客户
        try {
          const keyword = (quote.opportunity_name || quote.quote_name).slice(0, 12)
          const res = await apiFetch<{ items: { id: string; hospital_name: string; level?: string; beds_total?: number }[] }>(
            `/api/customers?q=${encodeURIComponent(keyword)}&perPage=5`,
          )
          const cust = (res.items ?? [])[0]
          if (cust) {
            hospital_level = String(cust.level ?? hospital_level)
            beds_total = Number(cust.beds_total ?? beds_total)
          }
        } catch {
          // 客户匹配失败不阻断标记，等级/床位留原值
        }
      }
      try {
        await apiFetch(`/api/quotes/${quote.id}`, {
          method: "PATCH",
          body: JSON.stringify({ won_sample: next, hospital_level, beds_total, modules_summary }),
        })
        setQuoteList((prev) => prev.map((q) => (q.id === quote.id ? { ...q, won_sample: next, hospital_level, beds_total, modules_summary } : q)))
        toast.success(next ? "已标记为成交参考样本（报价历史沉淀）" : "已取消成交参考样本")
      } catch {
        toast.error("标记失败，请稍后重试")
      }
    },
    [],
  )

  const importQuoteHistory = useCallback(
    (source: QuoteRecord) => {
      if (!source) return
      mutateQuote((q) => ({ ...q, groups: [...q.groups, ...deepCopyGroups(source.groups)] }))
      toast.success(`已导入「${source.quote_name}」的明细，可在对应分组内增删调整`)
    },
    [mutateQuote],
  )

  // quote-history-01 二期：成交参考区间智能推荐（won_sample 样本池 + 客户档案派生维度，纯本地零 AI）
  const [wonSampleDims, setWonSampleDims] = useState<{ hospital_level: string; beds_total: number } | null>(null)
  useEffect(() => {
    const q = activeQuoteRef.current
    if (!q || quoteMode !== "editor") {
      setWonSampleDims(null)
      return
    }
    const savedLevel = String(q.hospital_level ?? "").trim()
    const savedBeds = Number(q.beds_total ?? 0)
    if (savedLevel || savedBeds > 0) {
      setWonSampleDims({ hospital_level: savedLevel, beds_total: savedBeds })
      return
    }
    // 报价本身无沉淀元数据 → 经商机名匹配客户档案派生等级/床位（与 toggleWonSample 同口径）
    const keyword = (q.opportunity_name || q.quote_name || "").slice(0, 12)
    if (!keyword) {
      setWonSampleDims({ hospital_level: "", beds_total: 0 })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch<{ items: { level?: string; beds_total?: number }[] }>(
          `/api/customers?q=${encodeURIComponent(keyword)}&perPage=5`,
        )
        const cust = (res.items ?? [])[0]
        if (!cancelled) setWonSampleDims({ hospital_level: cust ? String(cust.level ?? "") : "", beds_total: cust ? Number(cust.beds_total ?? 0) : 0 })
      } catch {
        if (!cancelled) setWonSampleDims({ hospital_level: "", beds_total: 0 })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeQuote?.id, quoteMode])

  const quoteRecommendation = useMemo(() => {
    if (!activeQuote) return null
    const dims: QuoteDimensions = {
      hospital_level: wonSampleDims?.hospital_level || String(activeQuote.hospital_level ?? ""),
      beds_total: wonSampleDims?.beds_total || Number(activeQuote.beds_total ?? 0),
      modules: (activeQuote.groups ?? []).map((g) => g.name).filter(Boolean),
      items: (activeQuote.groups ?? [])
        .flatMap((g) => (g.items ?? []).map((it) => String(it.product_name ?? it.item_name ?? "").trim()))
        .filter(Boolean),
    }
    return recommendFromHistory(dims, quoteList, activeQuote.id)
  }, [activeQuote, wonSampleDims, quoteList])

  const loadProducts = useCallback(async (uid: string) => {
    setProductLoading(true)
    try {
      // B6：perPage 提到 200，避免服务端缺省 50 静默截断产品库
      // 公司报价体系导入后超过 200 条：分页循环拉全，直到某页不满为止
      const all: ProductItem[] = []
      for (let page = 1; page <= 10; page++) {
        const data = await apiFetch<ListResponse<ProductItem>>(
          `/api/product_library?rh_user_id=${encodeURIComponent(uid)}&page=${page}&perPage=200`,
        )
        const items = data.items ?? []
        all.push(...items)
        if (items.length < 200) break
      }
      setProductItems(all)
    } catch {
      // 产品库加载失败不打断主流程
    } finally {
      setProductLoading(false)
    }
  }, [])

  const refreshProducts = useCallback(() => {
    if (userId) void loadProducts(userId)
  }, [loadProducts, userId])

  const saveItemToLibrary = useCallback(
    async (item: QuoteItem, category: string) => {
      if (!item.item_name.trim()) {
        toast.error("行项名称为空，无法存入产品库")
        return
      }
      // 数据归属前置校验：无 userId 时后端 product_library 的 rh_user_id 必填
      // 校验必然失败，这里提前拦下，避免走到后端才报错。
      if (!userId) {
        toast.error("当前无法确定数据归属，存入已取消")
        return
      }
      try {
        await apiFetch("/api/product_library", {
          method: "POST",
          body: JSON.stringify({
            rh_user_id: userId,
            item_name: item.item_name,
            spec: item.spec,
            unit: item.unit,
            ref_price: item.price,
            category,
          }),
        })
        toast.success(`「${item.item_name}」已存入产品库`)
        void loadProducts(userId)
      } catch {
        toast.error("存入产品库失败，请稍后重试")
      }
    },
    [loadProducts, userId],
  )

  const deleteProduct = useCallback(
    (productId: string) => {
      requestConfirm({
        title: "删除产品",
        description: "确定从产品库删除该条目吗？",
        tone: "danger",
        confirmText: "删除",
        action: () => {
          void (async () => {
            try {
              await apiFetch(`/api/product_library/${productId}`, { method: "DELETE" })
              setProductItems((prev) => prev.filter((it) => it.id !== productId))
              toast.success("已删除")
            } catch {
              toast.error("删除失败，请稍后重试")
            }
          })()
        },
      })
    },
    [requestConfirm],
  )

  const openProductPicker = useCallback((groupId: string) => setProductPickerGroup(groupId), [])
  const closeProductPicker = useCallback(() => setProductPickerGroup(null), [])

  const addProductToGroup = useCallback(
    (productId: string, groupId?: string) => {
      const product = productItems.find((it) => it.id === productId)
      const gid = groupId ?? productPickerGroup
      if (!product || !gid) return
      addQuoteItemWithData(gid, {
        item_name: product.item_name,
        spec: product.spec,
        unit: product.unit || "套",
        qty: 1,
        price: product.ref_price || 0,
        discount: 100,
      })
      setProductPickerGroup(null)
      toast.success(`已添加「${product.item_name}」`)
    },
    [addQuoteItemWithData, productItems, productPickerGroup],
  )

  // ------------------------------ 初始加载 ------------------------------
  useEffect(() => {
    if (!userId) {
      setDeckList([])
      setQuoteList([])
      setProductItems([])
      setSolutionOptions([])
      setBidOptions([])
      return
    }
    void loadDecks(userId)
    void loadQuotes(userId)
    void loadProducts(userId)
    void loadMaterialOptions(userId)
    void loadCheckProducts()
    void loadChecklists(userId)
  }, [loadChecklists, loadCheckProducts, loadDecks, loadMaterialOptions, loadProducts, loadQuotes, userId])

  return {
    // 账号与视图
    userId,
    handleAccountChange,
    activeView,
    setActiveView,
    costConfirm,
    // 统一确认对话框
    confirmRequest,
    closeConfirmRequest,
    runConfirmRequest,
    // 素材选项
    solutionOptions,
    bidOptions,
    materialLoading,
    // PPT 列表与向导
    deckList,
    deckListLoading,
    deckSearch,
    setDeckSearch,
    filteredDecks,
    deckMode,
    openNewDeckWizard,
    closeDeckWizard,
    openDeck,
    backToDeckList,
    deleteDeck,
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
    wMaterial,
    setWMaterial,
    suggestedPageCount,
    wPages,
    setWPages,
    targetPageCount,
    deckGenerating,
    deckProgress,
    startDeckGeneration,
    // PPT 编辑器
    activeDeck,
    currentSlide,
    currentSlideIndex,
    setCurrentSlideIndex,
    editorTab,
    setEditorTab,
    renameDeck,
    updateSlide,
    addSlide,
    deleteSlideAt,
    moveSlide,
    slideAiKind,
    refineSlide,
    // R249 占位/空白页一键补全
    fillBlankSlides,
    fillingBlank,
    fillProgress,
    blankSlideCount,
    // R169 公司模板主题（上传/清除/当前名）
    deckTemplateName: deckTemplate?.name ?? null,
    deckTemplateProbe,
    uploadDeckTemplate,
    clearDeckTemplateChoice,
    deckPersistFailed,
    saveDeckNow,
    exportPptx,
    exportSpeech,
    // 页面切换动画与真实配图
    deckTransition,
    setDeckTransition,
    imagePool,
    loadImagePool,
    attachImageFromUrl,
    attachImageByPastedUrl,
    uploadSlideImage,
    clearSlideImage,
    applyPoolImagesToHinted,
    slideImageBusy,
    // 逐页搜图 / AI 生图 / 自动配图开关
    searchAndAttachImage,
    aiGenerateImageForSlide,
    // 素材库（R-008）：选图弹窗插入 + 缓存重拉
    attachImageFromLibrary,
    reloadLocalMaterials,
    autoFigureMode,
    setAutoFigureMode,
    autoFigureProvider,
    setAutoFigureProvider,
    slideFigureBusy,
    // 报价列表与新建
    quoteList,
    quoteListLoading,
    quoteSearch,
    setQuoteSearch,
    filteredQuotes,
    quoteMode,
    openQuote,
    backToQuoteList,
    deleteQuote,
    copyQuoteAsVersion,
    historyQuotes,
    importQuoteHistory,
    toggleWonSample,
    quoteRecommendation,
    newQuoteOpen,
    setNewQuoteOpen,
    nqName,
    setNqName,
    nqRef,
    setNqRef,
    nqOpportunityId,
    setNqOpportunityId,
    quoteOppOptions,
    openNewQuote,
    createQuote,
    quoteCreating,
    // 报价编辑
    activeQuote,
    quoteTotals,
    syncOppAmountOnSave,
    oppSyncFailed,
    quotePersistFailed,
    saveQuoteNow,
    handleSyncOppAmountChange,
    updateQuoteName,
    updateTaxNote,
    updateVersion,
    addQuoteGroup,
    deleteQuoteGroup,
    renameQuoteGroup,
    addQuoteItem,
    updateQuoteItem,
    setGroupDiscount,
    deleteQuoteItem,
    quoteAiOpen,
    setQuoteAiOpen,
    draftRef,
    setDraftRef,
    quoteAiBusy,
    openQuoteAi,
    generateQuoteDraft,
    exportQuoteExcel,
    exportQuoteWord,
    // 产品库
    productItems,
    productLoading,
    refreshProducts,
    saveItemToLibrary,
    deleteProduct,
    productPickerGroup,
    openProductPicker,
    closeProductPicker,
    addProductToGroup,
    // 我公司系统清单（与 SolutionStudio 建设清单同源）
    checkProducts,
    checkProductsLoading,
    refreshCheckProducts,
    checkProductPickerOpen,
    openCheckProductPicker,
    closeCheckProductPicker,
    addCheckProductsToQuote,
    checklists,
    checklistsLoading,
    refreshChecklists,
    checklistImportOpen,
    openChecklistImport,
    closeChecklistImport,
    importFromChecklist,
    addManualItem,
    // 模型选择（统一网关）
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    // 全站技能带入（PPT 侧 2 个功能点）
    deckSkills,
    quoteSkills,
  }
}
