import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import type { LlmMessage } from "@/lib/llm"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  resolveAvailableModels,
  type ModelRef,
} from "@/lib/modelGateway"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { injectSkillBlock, skillBlockFor, skillCostSuffix, type SkillScope } from "@/lib/skillCore"
import { makeUid, type Chapter, type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { exportDeckPptx, exportSpeechDocx } from "./deckExports"
import { exportQuoteDocx as writeQuoteDocx, exportQuoteXlsx as writeQuoteXlsx } from "./quoteExports"
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
  makeDefaultGroups,
  normalizeQuoteGroups,
  normalizeSlidePlan,
  normalizeSlides,
  parseJsonLoose,
  REFINE_LABEL,
  sanitizeDeck,
  sanitizeQuote,
  suggestPageCount,
  type DeckRecord,
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
}

// ---------------------------------------------------------------------------
// LLM 调用封装（统一模型网关：个人模型走 /api/model-gw/chat，平台模型 poll-first 由
// callLlmWithFallback 内部处理；错误码翻译成中文）
// ---------------------------------------------------------------------------

const LLM_ERROR_ZH: Record<string, string> = {
  timeout: "AI 生成超时（可能服务器繁忙），请稍后重试",
  not_found: "请求未能到达 AI，请检查网络后重试",
  rh_login_required: "AI 生成服务暂不可用，请检查模型配置",
  insufficient_balance: "RunningHub 账户余额不足，请充值后重试",
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
  if (r.needsLogin) throw new Error(LLM_ERROR_ZH.rh_login_required)
  if (!r.ok || r.status !== "success" || !r.text) {
    // B3：未收录错误码 / 裸英文串替换为中文通用文案，可读中文串透传（与小智侧同口径）
    const raw = r.error ?? ""
    throw new Error(LLM_ERROR_ZH[raw] ?? (/[一-龥]/.test(raw) ? raw : "生成失败，请稍后重试"))
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
    return buildMaterialText(ref.name, outline, chapters)
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

  const openNewDeckWizard = useCallback(() => {
    flushDeckPersist()
    setWDeckName("")
    setWDeckType("general")
    setWTopic("")
    setWAudience("院领导")
    setWDuration("15")
    setWKeyPoints("")
    setWMaterial(null)
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
    const pageCount = suggestedPageCount
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
      if (pageCount <= SINGLE_CALL_MAX_PAGES) {
        setDeckProgress(`正在生成 ${pageCount} 页内容…`)
        const text = await llmGenerate(buildDeckSingleMessages(ctx, pageCount), MAX_TOKENS_LONGFORM, "ppt-deck", activeModelRef.current)
        slides = normalizeSlides(parseJsonLoose(text), null)
      } else {
        setDeckProgress("正在生成整体大纲…")
        const outlineText = await llmGenerate(buildDeckOutlineMessages(ctx, pageCount), MAX_TOKENS_OUTLINE, "ppt-deck", activeModelRef.current)
        const plan: SlidePlan[] = normalizeSlidePlan(parseJsonLoose(outlineText), pageCount)
        const allTitles = plan.map((p) => p.title)
        const batches = chunk(plan, BATCH_SIZE)
        slides = []
        for (let i = 0; i < batches.length; i += 1) {
          setDeckProgress(`正在生成逐页内容（第 ${i + 1}/${batches.length} 批，共 ${plan.length} 页）…`)
          const batchText = await llmGenerate(
            buildDeckBatchMessages(ctx, batches[i], allTitles),
            MAX_TOKENS_LONGFORM,
            "ppt-deck",
            activeModelRef.current,
          )
          slides.push(...normalizeSlides(parseJsonLoose(batchText), batches[i]))
        }
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
      toast.success(`已生成 ${rec.slides.length} 页，可逐页精修后导出`)
    } catch (err) {
      handleGenError(err)
    } finally {
      setDeckGenerating(false)
      setDeckProgress("")
    }
  }, [
    applyDeckState,
    fetchMaterialText,
    handleGenError,
    suggestedPageCount,
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

  // ------------------------------ PPT 导出 ------------------------------
  const exportPptx = useCallback(async () => {
    flushDeckPersist()
    const deck = activeDeckRef.current
    if (!deck?.slides?.length) {
      toast.error("没有可导出的页面")
      return
    }
    try {
      await exportDeckPptx(deck)
      toast.success("PPT 文件已导出，文件内文本框可在 Office/WPS 直接修改（若打开是保护视图，先点「启用编辑」）；讲稿已写入演讲者备注")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushDeckPersist])

  const exportSpeech = useCallback(async () => {
    flushDeckPersist()
    const deck = activeDeckRef.current
    if (!deck?.slides?.length) {
      toast.error("没有可导出的页面")
      return
    }
    try {
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
          const total = Math.round((rec.groups ?? []).reduce((s, g) => s + groupSubtotal(g), 0) * 100) / 100
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
    const quoteName = nqName.trim() || `报价单 ${new Date().toLocaleDateString("zh-CN")}`
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
    let total = 0
    for (const g of activeQuote?.groups ?? []) {
      const sub = groupSubtotal(g)
      byGroup[g.id] = sub
      total += sub
    }
    return { byGroup, total: Math.round(total * 100) / 100 }
  }, [activeQuote])

  // 轮次 F 轨 2：勾选瞬间先立即同步一次给出反馈（开关 state 声明已上移，见 resetSyncOppAmount 处）
  const handleSyncOppAmountChange = useCallback((checked: boolean) => {
    setSyncOppAmountOnSaveState(checked)
    syncOppAmountRef.current = checked
    const rec = activeQuoteRef.current
    if (!checked || !rec?.opportunity_id) return
    const total = Math.round((rec.groups ?? []).reduce((s, g) => s + groupSubtotal(g), 0) * 100) / 100
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
      const materialText = await fetchMaterialText(ref)
      const text = await llmGenerate(buildQuoteDraftMessages(ref.name, materialText), MAX_TOKENS_LONGFORM, "quote-draft", activeModelRef.current)
      const parsed = normalizeQuoteGroups(parseJsonLoose(text))
      let added = 0
      mutateQuote((q) => {
        const groups = q.groups.map((g) => ({ ...g, items: [...g.items] }))
        for (const pg of parsed) {
          let target = groups.find((g) => g.name === pg.name)
          if (!target) target = groups.find((g) => g.name === "实施服务") ?? groups[0]
          if (!target) continue
          for (const it of pg.items) {
            target.items.push({ ...it, id: makeUid() })
            added += 1
          }
        }
        return { ...q, ref_type: ref.type, ref_id: ref.id, ref_name: ref.name, groups }
      })
      setQuoteAiOpen(false)
      toast.success(`已生成 ${added} 条行项初稿，请核对价格与数量`)
    } catch (err) {
      handleGenError(err)
    } finally {
      setQuoteAiBusy(false)
    }
  }, [draftRef, fetchMaterialText, handleGenError, mutateQuote])

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
      await writeQuoteXlsx(quote)
      toast.success("Excel 报价表已导出（含分组小计与总计公式）")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushQuotePersist])

  const exportQuoteWord = useCallback(async () => {
    flushQuotePersist()
    const quote = activeQuoteRef.current
    if (!quote) return
    try {
      await writeQuoteDocx(quote)
      toast.success("Word 报价单已导出")
    } catch {
      toast.error("导出失败，请重试")
    }
  }, [flushQuotePersist])

  // ------------------------------ 常用产品库 ------------------------------
  const [productItems, setProductItems] = useState<ProductItem[]>([])
  const [productLoading, setProductLoading] = useState(false)
  const [productPickerGroup, setProductPickerGroup] = useState<string | null>(null)

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
  }, [loadDecks, loadMaterialOptions, loadProducts, loadQuotes, userId])

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
    deckPersistFailed,
    saveDeckNow,
    exportPptx,
    exportSpeech,
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
    // 模型选择（统一网关）
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    // 全站技能带入（PPT 侧 2 个功能点）
    deckSkills,
    quoteSkills,
  }
}
