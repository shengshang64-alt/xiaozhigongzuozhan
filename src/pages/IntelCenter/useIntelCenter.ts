import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import { buildIntelToOppQuery } from "@/lib/intelToOpp"
import { cleanIntelBody, cleanIntelLine, looksJunkIntel } from "./intelBodyClean"
import { groupIntelItems } from "./intelDedup"
import { selectDailyIntel, selectWeeklyIntelItems } from "./intelDaily"
import { triggerBlobDownload } from "@/lib/download"
import {
  canProceedToDelete,
  cleanupBackupFileName,
  formatBackupStamp,
  serializeCleanupBackup,
  type CleanupBackupItem,
} from "./intelCleanupBackup"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import { localizeLlmError } from "@/lib/llmError"
import type { LlmMessage } from "@/lib/llm"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  resolveAvailableModels,
  type ModelRef,
} from "@/lib/modelGateway"
import { useCostConfirm } from "@/hooks/useCostConfirm"

// ---------------------------------------------------------------------------
// 类型（字段名与 PocketBase collection 100% 一致，snake_case）
// ---------------------------------------------------------------------------

export type IntelSourceType = "policy" | "competitor" | "bid" | "media"
/** 循环 10 小改 1：列表排序口径（发布时刻缺省 / 加入时刻 / 标题） */
export type IntelListSortKey = "published" | "added" | "title"

export interface IntelSourceRow {
  id: string
  source_name: string
  url: string
  source_type: IntelSourceType | ""
  is_builtin: boolean
  owner_id: string
  enabled: boolean
  last_fetch_at: string
  last_status: string
  last_error: string
  fetched_count: number
  /** 连续失败次数（后端记账；死链连续 3 次自动停用） */
  failure_count?: number
  /** 最近一次抓取成功时间（与 last_fetch_at=最近尝试区分） */
  last_success_at?: string
  created: string
}

/** 招标/中标结构化字段（后端 /api/intel/extract-bid 规则抽取，零 AI，可能缺项） */
export interface IntelStructured {
  buyer?: string
  budget?: string
  deadline?: string
  code?: string
  winner?: string
  won_amount?: string
}

export interface IntelItemRow {
  id: string
  source_id: string
  source_name: string
  title: string
  url: string
  content_snippet: string
  item_type: IntelSourceType | ""
  summary: string
  tags: string[]
  structured?: IntelStructured | null
  /** 展示层同题聚合信息（仅 groupIntelItems 生成，不落库） */
  duplicate_count?: number
  duplicate_sources?: string[]
  /** 今日工作队列的推荐理由（展示层计算，不落库） */
  priority_reason?: string[]
  region: string
  item_status: "pending" | "confirmed" | "ignored" | ""
  added_by: string
  owner_id: string
  visibility: "public" | "personal" | ""
  my_status: "pending" | "confirmed" | "ignored" | ""
  published_at: string
  created: string
  updated: string
}

export interface IntelStarRow {
  id: string
  rh_user_id: string
  item_id: string
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  policy: "政策动态",
  competitor: "竞品动向",
  bid: "招标中标",
  media: "行业媒体",
}

export const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  ignored: "已忽略",
}

// ------------------------------ 个人偏好（默认界面 + 按账号调整） ------------------------------

export interface IntelPrefs {
  region_focus: string
  focus_sources: string[]
  focus_topics: string[]
}

/** 未保存过偏好时的默认内容关注词（与服务端 DEFAULT_TOPICS 一致） */
export const DEFAULT_FOCUS_TOPICS = [
  "HIS",
  "EMR",
  "集成平台",
  "数据中心",
  "人工智能",
  "信创",
  "智慧医院",
  "互联互通",
  "招标",
]

/** 首次登录默认界面：全国 + 不锁源 + 预设内容词 */
export const DEFAULT_INTEL_PREFS: IntelPrefs = {
  region_focus: "",
  focus_sources: [],
  focus_topics: DEFAULT_FOCUS_TOPICS,
}

/** 可选关注区域：省级行政区 + 单列市/特区（「全国」即空串） */
export const REGION_CHOICES: string[] = [
  "北京", "天津", "上海", "重庆",
  "河北", "山西", "辽宁", "吉林", "黑龙江",
  "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "海南",
  "四川", "贵州", "云南", "陕西", "甘肃", "青海",
  "内蒙古", "广西", "西藏", "宁夏", "新疆",
  "深圳", "大连", "青岛", "宁波", "厦门",
]

// ---------------------------------------------------------------------------
// 数据请求（走 __pb 代理自定义路由）
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
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

type ItemsResponse = {
  ok: boolean
  items: IntelItemRow[]
  page: number
  perPage: number
  totalItems: number
  allTags: string[]
}

type SourcesResponse = { ok: boolean; items: IntelSourceRow[] }

type StarListResponse = { items: IntelStarRow[] }

export function fmtIntelTime(iso: string): string {
  return formatDateTimeDisplay(iso)
}

const PER_PAGE = 10

// ---------------------------------------------------------------------------
// AI 摘要打标（统一模型网关：个人模型优先，平台 gpt-5.5 兜底）
// ---------------------------------------------------------------------------

/** 项目线索标记的 localStorage 持久化键（个人维度，不跨设备同步） */
const INTEL_LEAD_KEY = "zx_intel_leads_v1"

// 文案基表在 @/lib/llmError（全站唯一），此处只覆写情报侧专属措辞
const INTEL_ERROR_ZH: Record<string, string> = {
  rh_login_required: "AI 摘要服务暂不可用，请检查模型配置",
}

let activeModelRef: ModelRef | null = null

interface AiTagResult {
  summary: string
  item_type: IntelSourceType
  region: string
  tags: string[]
}

function parseAiTagResult(text: string): AiTagResult | null {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<AiTagResult> & {
      tags?: unknown
    }
    const summary = String(obj.summary ?? "").trim().slice(0, 160)
    if (!summary) return null
    const tp = String(obj.item_type ?? "")
    const itemType: IntelSourceType =
      tp === "policy" || tp === "competitor" || tp === "bid" ? tp : "policy"
    const region = String(obj.region ?? "").trim().slice(0, 30)
    const tags = Array.isArray(obj.tags)
      ? obj.tags.map((t) => String(t).trim().slice(0, 12)).filter(Boolean).slice(0, 5)
      : []
    return { summary, item_type: itemType, region, tags }
  } catch {
    return null
  }
}

function buildTagMessages(item: IntelItemRow): LlmMessage[] {
  const snippet = (item.content_snippet || "").slice(0, 1500)
  return [
    {
      role: "system",
      content:
        "你是医疗行业售前情报分析师。用户给你一条从政府网站或行业资讯站抓取的情报条目，请完成摘要与打标，只输出一个 JSON 对象，不要输出任何其他文字。JSON 结构：{\"summary\":\"不超过120字的中文摘要，说清这条情报对医疗信息化售前工作的意义\",\"item_type\":\"policy 或 competitor 或 bid\",\"region\":\"涉及的省市地区名，全国层面填 全国，无法判断填空字符串\",\"tags\":[\"最多5个中文标签，如 医保支付、电子病历、招标采购\"]}",
    },
    {
      role: "user",
      content: `标题：${item.title}\n来源：${item.source_name || "未知"}\n链接：${item.url}\n内容片段：${snippet || "（无正文片段，请根据标题判断）"}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// 主 Hook
// ---------------------------------------------------------------------------

export function useIntelCenter() {
  const costConfirm = useCostConfirm()

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [, setAccountInfo] = useState<RhAccountInfo | null>(null)
  const [needsRhLogin, setNeedsRhLogin] = useState(false)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
    if (uid) setNeedsRhLogin(false)
  }, [])

  // ------------------------------ 模型选择 ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")

  const loadModelOptions = useCallback(async () => {
    try {
      const av = await resolveAvailableModels()
      setModelOptions(av.models)
      setSelectedModelKey((prev) =>
        prev && av.models.some((m) => modelRefKey(m) === prev)
          ? prev
          : av.defaultRef
            ? modelRefKey(av.defaultRef)
            : "",
      )
    } catch {
      /* 模型列表加载失败时静默回退平台默认模型 */
    }
  }, [])

  useEffect(() => {
    if (userId) void loadModelOptions()
  }, [userId, loadModelOptions])

  useEffect(() => {
    activeModelRef = modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null
  }, [modelOptions, selectedModelKey])

  const handleSelectModel = useCallback((key: string) => setSelectedModelKey(key), [])

  // ------------------------------ 筛选条件 ------------------------------
  const [typeTab, setTypeTab] = useState<"all" | IntelSourceType>("all")
  const [statusTab, setStatusTab] = useState<"active" | "pending" | "confirmed" | "ignored">("active")
  const [searchInput, setSearchInput] = useState("")
  const [searchText, setSearchText] = useState("")
  const [activeTag, setActiveTag] = useState("")
  const [sinceRange, setSinceRange] = useState<"all" | "7" | "30">("all")
  // 区域 / 信息源 两个新筛选维度（值均为服务端过滤参数；"all" = 不过滤）
  const [regionFilter, setRegionFilter] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  // 已加载条目出现过的区域累计去重（区域下拉选项来源）
  const [knownRegions, setKnownRegions] = useState<string[]>([])

  const submitSearch = useCallback(() => {
    setPage(1)
    setItemList([])
    setSearchText(searchInput.trim())
  }, [searchInput])

  const clearFilters = useCallback(() => {
    setSearchInput("")
    setSearchText("")
    setActiveTag("")
    setSinceRange("all")
    setTypeTab("all")
    setStatusTab("active")
    setRegionFilter("all")
    setSourceFilter("all")
    setPage(1)
    setItemList([])
  }, [])

  // ------------------------------ 情报列表 ------------------------------
  const [itemList, setItemList] = useState<IntelItemRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [allTags, setAllTags] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)

  const sinceDate = useCallback((): string => {
    if (sinceRange === "all") return ""
    const days = Number(sinceRange)
    const d = new Date(Date.now() - days * 24 * 3600 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }, [sinceRange])

  const buildItemsQuery = useCallback(
    (targetPage: number) => {
      const qs = new URLSearchParams()
      qs.set("item_status", statusTab === "active" ? "pending,confirmed" : statusTab)
      if (typeTab !== "all") qs.set("item_type", typeTab)
      if (searchText) qs.set("q", searchText)
      if (activeTag) qs.set("tag", activeTag)
      const since = sinceDate()
      if (since) qs.set("since", since)
      if (regionFilter !== "all" && regionFilter) qs.set("region", regionFilter)
      if (sourceFilter !== "all" && sourceFilter) qs.set("source_id", sourceFilter)
      qs.set("page", String(targetPage))
      qs.set("per_page", String(PER_PAGE))
      return qs.toString()
    },
    [statusTab, typeTab, searchText, activeTag, sinceDate, regionFilter, sourceFilter],
  )

  // 循环7 C1-2：请求序号守卫——快速切换筛选/翻页时旧响应直接丢弃，避免乱序回跳覆盖当前列表
  const itemsSeqRef = useRef(0)

  const loadItems = useCallback(
    async (targetPage: number) => {
      itemsSeqRef.current += 1
      const seq = itemsSeqRef.current
      setItemsLoading(true)
      try {
        const data = await apiFetch<ItemsResponse>(`/api/intel/items?${buildItemsQuery(targetPage)}`)
        if (seq !== itemsSeqRef.current) return
        setTotalItems(data.totalItems ?? 0)
        setAllTags(data.allTags ?? [])
        setKnownRegions((prev) => {
          const nextRegions = [...prev]
          let changed = false
          for (const it of data.items ?? []) {
            if (it.region && !nextRegions.includes(it.region)) {
              nextRegions.push(it.region)
              changed = true
            }
          }
          return changed ? nextRegions : prev
        })
        setHasMore(targetPage * PER_PAGE < (data.totalItems ?? 0))
        setItemList((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]))
      } catch (err) {
        if (seq !== itemsSeqRef.current) return
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("情报列表加载失败，请稍后重试")
      } finally {
        if (seq === itemsSeqRef.current) setItemsLoading(false)
      }
    },
    [buildItemsQuery],
  )

  useEffect(() => {
    void loadItems(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, typeTab, statusTab, searchText, activeTag, sinceRange, regionFilter, sourceFilter])

  const loadMore = useCallback(() => setPage((p) => p + 1), [])

  // 循环7 C3：导出当前已加载的情报清单为 xlsx（标题/来源/时间/标签/摘要/链接）
  const exportItems = useCallback(async () => {
    if (itemList.length === 0) {
      toast.info("当前没有已加载的情报可导出，请先调整筛选或加载更多")
      return
    }
    try {
      // R124：xlsx 导出库改为点击导出时才按需加载，情报中心进页不再背 400+ kB
      const { exportIntelItemsXlsx } = await import("@/lib/intelExports")
      const count = exportIntelItemsXlsx(itemList)
      toast.success(`已导出 ${count} 条情报清单（xlsx）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [itemList])

  const handleTypeTab = useCallback((t: "all" | IntelSourceType) => {
    setTypeTab(t)
    setPage(1)
    setItemList([])
  }, [])

  const handleStatusTab = useCallback((s: "active" | "pending" | "confirmed" | "ignored") => {
    setStatusTab(s)
    setPage(1)
    setItemList([])
  }, [])

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag((prev) => (prev === tag ? "" : tag))
    setPage(1)
    setItemList([])
  }, [])

  const handleSinceChange = useCallback((v: "all" | "7" | "30") => {
    setSinceRange(v)
    setPage(1)
    setItemList([])
  }, [])

  const handleRegionFilter = useCallback((v: string) => {
    setRegionFilter(v)
    setPage(1)
    setItemList([])
  }, [])

  const handleSourceFilter = useCallback((v: string) => {
    setSourceFilter(v)
    setPage(1)
    setItemList([])
  }, [])

  const refreshItems = useCallback(() => {
    setPage(1)
    setItemList([])
    void loadItems(1)
  }, [loadItems])

  // ------------------------------ 信息源 ------------------------------
  // R52（2026-10-16）：本块整体上移到 triggerTick 之前。原顺序里 triggerTick(464) 在
  // 自身 deps 未包含 loadSources 的情况下前向引用 loadSources(507)，形成「声明前访问」：
  // react-hooks/immutability 报 TDZ、preserve-manual-memoization 判「memo 无法保留」。
  // 运行时当时不出错（triggerTick 只在 effect/interval 里被调用），但一旦启用 React Compiler
  // 且上调 panicThreshold，loadSources 会失去稳定引用 → [loadSources] 每次渲染都变 →
  // setSourcesLoading(true) → 无限渲染。整体上移即从根上消除该前向引用。
  const [sources, setSources] = useState<IntelSourceRow[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false)
  const [fetchingSourceId, setFetchingSourceId] = useState("")
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceUrl, setNewSourceUrl] = useState("")
  const [newSourceType, setNewSourceType] = useState<IntelSourceType>("policy")
  const [addingSource, setAddingSource] = useState(false)

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const data = await apiFetch<SourcesResponse>("/api/intel/sources")
      setSources(data.items ?? [])
    } catch {
      toast.error("信息源列表加载失败")
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  // ------------------------------ 定时抓取触发（服务端 30 分钟门控） ------------------------------
  const tickRef = useRef(false)

  const triggerTick = useCallback(async () => {
    try {
      const r = await apiFetch<{ ok: boolean; ran: boolean; added: number; message?: string }>(
        "/api/intel/tick",
        { method: "POST" },
      )
      if (r.ok && r.ran) {
        if (r.added > 0) {
          toast.success(`自动抓取完成，新增 ${r.added} 条待确认情报`)
          refreshItems()
          void loadSources()
        }
      }
    } catch {
      /* 抓取触发失败不打扰用户，下一轮会重试 */
    }
  }, [refreshItems, loadSources])

  // 循环7 C1-1：定时刷新经 ref 取最新 triggerTick，避免空依赖 useEffect 捕获挂载时的
  // 初始筛选闭包、15 分钟 tick 用旧条件覆盖当前列表
  const triggerTickRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    triggerTickRef.current = triggerTick
  }, [triggerTick])

  useEffect(() => {
    if (tickRef.current) return
    tickRef.current = true
    void triggerTickRef.current()
    const timer = window.setInterval(() => void triggerTickRef.current(), 15 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  const openSourcesPanel = useCallback(() => setSourcesPanelOpen(true), [])
  const closeSourcesPanel = useCallback(() => setSourcesPanelOpen(false), [])

  const requireLogin = useCallback((): boolean => {
    if (!userId) {
      setNeedsRhLogin(true)
      toast.error("当前无法执行该操作，请稍后重试")
      return false
    }
    return true
  }, [userId])

  // ------------------------------ 个人偏好（默认界面 + 按账号调整） ------------------------------
  const [prefs, setPrefs] = useState<IntelPrefs>(DEFAULT_INTEL_PREFS)
  const [prefsDialogOpen, setPrefsDialogOpen] = useState(false)
  const [prefsSaving, setPrefsSaving] = useState(false)

  // 进页并行读取本人偏好；未登录或读取失败静默用默认界面，不打扰用户
  const loadPrefs = useCallback(async () => {
    try {
      const r = await apiFetch<{ ok: boolean; prefs?: IntelPrefs }>("/api/intel/prefs")
      if (r.ok && r.prefs) {
        setPrefs({
          region_focus: String(r.prefs.region_focus ?? "").slice(0, 20),
          focus_sources: Array.isArray(r.prefs.focus_sources)
            ? r.prefs.focus_sources.map((s) => String(s))
            : [],
          focus_topics:
            Array.isArray(r.prefs.focus_topics) && r.prefs.focus_topics.length > 0
              ? r.prefs.focus_topics.map((t) => String(t))
              : DEFAULT_FOCUS_TOPICS,
        })
      }
    } catch {
      /* 偏好读取失败静默回退默认界面 */
    }
  }, [])

  useEffect(() => {
    void loadPrefs()
  }, [loadPrefs])

  const openPrefsDialog = useCallback(() => {
    if (!requireLogin()) return
    setPrefsDialogOpen(true)
  }, [requireLogin])

  const closePrefsDialog = useCallback(() => setPrefsDialogOpen(false), [])

  const savePrefs = useCallback(async (next: IntelPrefs) => {
    setPrefsSaving(true)
    try {
      const r = await apiFetch<{ ok: boolean; message?: string }>("/api/intel/prefs", {
        method: "POST",
        body: JSON.stringify({
          region_focus: next.region_focus,
          focus_sources: next.focus_sources,
          focus_topics: next.focus_topics,
        }),
      })
      if (!r.ok) {
        toast.error(r.message || "保存偏好失败，请稍后重试")
        return
      }
      setPrefs(next)
      setPrefsDialogOpen(false)
      toast.success("偏好已保存，关注标记与置顶已即时更新")
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      if (e.httpStatus === 401) setNeedsRhLogin(true)
      toast.error("保存偏好失败，请稍后重试")
    } finally {
      setPrefsSaving(false)
    }
  }, [])

  // 关注标记：重点源含来源名 或 内容词命中标题+片段 或 关注区域命中条目区域
  const isItemFocused = useCallback(
    (item: IntelItemRow): boolean => {
      if (item.source_name && prefs.focus_sources.includes(item.source_name)) return true
      if (prefs.region_focus && item.region === prefs.region_focus) return true
      if (prefs.focus_topics.length > 0) {
        const text = `${item.title} ${item.content_snippet}`
        for (const topic of prefs.focus_topics) {
          if (topic && text.includes(topic)) return true
        }
      }
      return false
    },
    [prefs],
  )

  // 循环 10 小改 1：列表排序口径（发布时刻缺省 / 加入时刻 / 标题），sessionStorage 记忆
  const [listSortKey, setListSortKeyState] = useState<IntelListSortKey>(() => {
    try {
      const v = sessionStorage.getItem("intel_list_sort")
      return v === "added" || v === "title" ? v : "published"
    } catch {
      return "published"
    }
  })
  const setListSortKey = useCallback((k: IntelListSortKey) => {
    setListSortKeyState(k)
    try {
      sessionStorage.setItem("intel_list_sort", k)
    } catch {
      /* 隐私模式静默降级 */
    }
  }, [])

  // 列表加载后内存排序：关注项置顶（优先级不变），组内按排序口径重排（Array.sort 稳定）
  const displayItems = useMemo(() => {
    const arr = [...itemList]
    const timeOf = (it: IntelItemRow, kind: "published" | "added") =>
      (kind === "published" ? it.published_at || it.created : it.created) ?? ""
    arr.sort((a, b) => {
      const f = Number(isItemFocused(b)) - Number(isItemFocused(a))
      if (f !== 0) return f
      // F23 垃圾条目沉底（仅排序，不隐藏；关注项优先权不变）
      const j = Number(looksJunkIntel(a.title ?? "", a.content_snippet ?? "")) -
               Number(looksJunkIntel(b.title ?? "", b.content_snippet ?? ""))
      if (j !== 0) return j
      if (listSortKey === "title") return (a.title ?? "").localeCompare(b.title ?? "", "zh-CN")
      const kind = listSortKey === "added" ? "added" : "published"
      return timeOf(b, kind).localeCompare(timeOf(a, kind))
    })
    // 同 URL / 同题跨源转载只聚合展示，不删库内记录；保留全部来源与最完整字段
    return groupIntelItems(arr)
  }, [itemList, isItemFocused, listSortKey])

  // 今日工作（2026-11-02）：必看/临期/待分诊，基于已去重且当前筛选可见的条目
  const dailyWork = useMemo(
    () => selectDailyIntel(displayItems, new Date(), isItemFocused, 10),
    [displayItems, isItemFocused],
  )

  // 区域下拉选项：全部 + 我的区域（非空置顶）+ 已加载条目出现过的区域去重
  // 循环 12：省份级固定筛选清单（按省筛政策/需求）；计划单列市在服务端归并到归属省；
  // 已加载条目出现过的其他区域值（如单列市）追加在尾部仍可直接筛
  const regionOptions = useMemo(() => {
    const provinces = [
      "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
      "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
      "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
      "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
    ]
    const opts: { value: string; label: string }[] = [
      { value: "all", label: "全部区域" },
      { value: "__none__", label: "区域未知" },
      ...provinces.map((p) => ({ value: p, label: p })),
    ]
    if (prefs.region_focus) {
      const hit = opts.find((o) => o.value === prefs.region_focus)
      if (hit) {
        hit.label = `我的区域 · ${prefs.region_focus}`
        opts.splice(opts.indexOf(hit), 1)
        opts.splice(1, 0, hit)
      } else {
        opts.splice(1, 0, { value: prefs.region_focus, label: `我的区域 · ${prefs.region_focus}` })
      }
    }
    const seen = new Set(opts.map((o) => o.value))
    for (const r of knownRegions) {
      if (r && !seen.has(r)) {
        seen.add(r)
        opts.push({ value: r, label: r })
      }
    }
    return opts
  }, [prefs.region_focus, knownRegions])

  // 信息源下拉选项：全部 + 可见源按名称去重（值传 source_id，服务端过滤）
  const sourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "all", label: "全部信息源" }]
    const seenNames = new Set<string>()
    for (const s of sources) {
      if (!s.source_name || seenNames.has(s.source_name)) continue
      seenNames.add(s.source_name)
      opts.push({ value: s.id, label: s.source_name })
    }
    return opts
  }, [sources])

  // 偏好对话框的重点网站选项：可见源 source_name 去重清单
  const prefsSourceNames = useMemo(() => {
    const names: string[] = []
    for (const s of sources) {
      if (s.source_name && !names.includes(s.source_name)) names.push(s.source_name)
    }
    return names
  }, [sources])

  // ------------------------------ 存量不相关情报一键清理（预览 → 确认两段） ------------------------------
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupInfo, setCleanupInfo] = useState<{ count: number; samples: string[] } | null>(null)
  // 循环 12：挂载后静默预览一次存量不相关数，>0 时列表顶部出引导横幅（本次会话忽略后不再打扰）
  const [cleanupSuggested, setCleanupSuggested] = useState(false)
  const cleanupPreviewedRef = useRef(false)
  useEffect(() => {
    if (!userId || cleanupPreviewedRef.current) return
    cleanupPreviewedRef.current = true
    try {
      if (sessionStorage.getItem("intel_cleanup_dismissed") === "1") return
    } catch {
      /* 隐私模式：照常预览 */
    }
    apiFetch<{ ok: boolean; count?: number; samples?: string[] }>("/api/intel/cleanup-irrelevant", {
      method: "POST",
      body: JSON.stringify({ confirm: false }),
    })
      .then((r) => {
        if (r.ok && (r.count ?? 0) > 0) {
          setCleanupInfo({ count: r.count ?? 0, samples: r.samples ?? [] })
          setCleanupSuggested(true)
        }
      })
      .catch(() => {
        /* 预览失败静默，不打扰 */
      })
  }, [userId])
  const dismissCleanupSuggested = useCallback(() => {
    setCleanupSuggested(false)
    try {
      sessionStorage.setItem("intel_cleanup_dismissed", "1")
    } catch {
      /* 隐私模式静默降级 */
    }
  }, [])

  /** 第一段：只预览命中数与样例，不删除 */
  const openCleanupPreview = useCallback(async () => {
    if (!requireLogin()) return
    setCleanupBusy(true)
    try {
      const r = await apiFetch<{ ok: boolean; count?: number; samples?: string[]; message?: string }>(
        "/api/intel/cleanup-irrelevant",
        { method: "POST", body: JSON.stringify({ confirm: false }) },
      )
      if (!r.ok) {
        toast.error(r.message || "预览失败，请稍后重试")
        return
      }
      const count = r.count ?? 0
      if (count === 0) {
        toast.success("存量条目均符合医疗信息化建设口径，无需清理")
        return
      }
      setCleanupInfo({ count, samples: r.samples ?? [] })
      setCleanupOpen(true)
    } catch {
      toast.error("预览失败，请稍后重试")
    } finally {
      setCleanupBusy(false)
    }
  }, [requireLogin])

  /** 第二段：先导出本地备份，备份成功且数量对齐后才删除并刷新列表（R-033 数据安全） */
  const confirmCleanup = useCallback(async () => {
    setCleanupBusy(true)
    const expected = cleanupInfo?.count ?? 0
    try {
      // 1) 取全量命中记录做本地备份（backup 模式不删除，与下方 delete 同一命中集）
      const bk = await apiFetch<{
        ok: boolean
        backup?: boolean
        count?: number
        items?: CleanupBackupItem[]
        message?: string
      }>("/api/intel/cleanup-irrelevant", {
        method: "POST",
        body: JSON.stringify({ backup: true }),
      })
      const items = Array.isArray(bk.items) ? bk.items : []
      // 2) 删除前安全闸：备份未取得 / 条数漂移一律拒绝删除，绝不删掉没备份到的条目
      const gate = canProceedToDelete({
        backupOk: !!bk.ok,
        backupCount: items.length,
        expectedCount: expected,
      })
      if (!gate.proceed) {
        toast.error("已取消清理（" + gate.reason + "），未删除任何条目，请稍后重试")
        return
      }
      // 3) 落本地 JSON 备份文件（可离线查阅 / 后续再导入）
      const now = new Date()
      const text = serializeCleanupBackup(items, {
        generatedAt: now.toISOString(),
        reason: "不相关情报清理前本地备份（医疗信息化建设口径）",
      })
      triggerBlobDownload(new Blob([text], { type: "application/json" }), cleanupBackupFileName(formatBackupStamp(now)))
      // 4) 备份就绪后才真正删除
      const r = await apiFetch<{ ok: boolean; deleted?: number; message?: string }>(
        "/api/intel/cleanup-irrelevant",
        { method: "POST", body: JSON.stringify({ confirm: true }) },
      )
      if (!r.ok) {
        toast.error(r.message || "清理失败，请稍后重试")
        return
      }
      toast.success("已导出 " + items.length + " 条本地备份，并清理 " + (r.deleted ?? 0) + " 条不相关情报")
      setCleanupOpen(false)
      setCleanupInfo(null)
      setCleanupSuggested(false)
      refreshItems()
    } catch {
      toast.error("清理失败，请稍后重试")
    } finally {
      setCleanupBusy(false)
    }
  }, [cleanupInfo, refreshItems])

  const closeCleanup = useCallback(() => {
    setCleanupOpen(false)
    setCleanupInfo(null)
  }, [])

  const addSource = useCallback(async () => {
    if (!requireLogin()) return
    const name = newSourceName.trim()
    const url = newSourceUrl.trim()
    if (!name) {
      toast.error("请填写信息源名称")
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error("网址必须以 http:// 或 https:// 开头")
      return
    }
    setAddingSource(true)
    try {
      const r = await apiFetch<{ ok: boolean; message?: string }>("/api/intel/sources", {
        method: "POST",
        body: JSON.stringify({ source_name: name, url, source_type: newSourceType }),
      })
      if (!r.ok) {
        toast.error(r.message || "添加失败")
        return
      }
      toast.success("信息源已添加")
      setNewSourceName("")
      setNewSourceUrl("")
      setNewSourceType("policy")
      void loadSources()
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      if (e.httpStatus === 401) setNeedsRhLogin(true)
      toast.error("添加信息源失败，请稍后重试")
    } finally {
      setAddingSource(false)
    }
  }, [requireLogin, newSourceName, newSourceUrl, newSourceType, loadSources])

  const toggleSource = useCallback(
    async (source: IntelSourceRow) => {
      if (!source.is_builtin && !requireLogin()) return
      try {
        const r = await apiFetch<{ ok: boolean; message?: string }>(
          `/api/intel/sources/${encodeURIComponent(source.id)}`,
          { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) },
        )
        if (!r.ok) {
          toast.error(r.message || "操作失败")
          return
        }
        setSources((prev) =>
          prev.map((s) => (s.id === source.id ? { ...s, enabled: !s.enabled } : s)),
        )
        toast.success(source.enabled ? "已停用该信息源" : "已启用该信息源")
      } catch (err) {
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("操作失败，请稍后重试")
      }
    },
    [requireLogin],
  )

  const deleteSource = useCallback(
    async (source: IntelSourceRow) => {
      if (!requireLogin()) return
      try {
        const r = await apiFetch<{ ok: boolean; message?: string }>(
          `/api/intel/sources/${encodeURIComponent(source.id)}`,
          { method: "DELETE" },
        )
        if (!r.ok) {
          toast.error(r.message || "删除失败")
          return
        }
        toast.success("信息源已删除")
        void loadSources()
      } catch (err) {
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("删除失败，请稍后重试")
      }
    },
    [requireLogin, loadSources],
  )

  const fetchSourceNow = useCallback(
    async (source: IntelSourceRow) => {
      if (!requireLogin()) return
      setFetchingSourceId(source.id)
      try {
        const r = await apiFetch<{ ok: boolean; added?: number; message?: string }>(
          "/api/intel/fetch-now",
          { method: "POST", body: JSON.stringify({ source_id: source.id }) },
        )
        if (!r.ok) {
          toast.error(r.message || "抓取失败")
        } else {
          const added = r.added ?? 0
          toast.success(added > 0 ? `抓取完成，新增 ${added} 条待确认情报` : "抓取完成，没有新条目")
          if (added > 0) refreshItems()
        }
        void loadSources()
      } catch (err) {
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("抓取失败，请稍后重试")
      } finally {
        setFetchingSourceId("")
      }
    },
    [requireLogin, refreshItems, loadSources],
  )

  // T3 一键重试：自动抓取有 30 分钟单源冷却，持续失败的源只能手动重试才能提前恢复；
  // 逐个串行补抓（单源出站超时 15s），全部结束后一次拉取最新状态统计恢复数。
  const [retryingFailed, setRetryingFailed] = useState(false)
  const retryFailedSources = useCallback(async () => {
    if (!requireLogin()) return
    const targets = sources.filter((s) => s.enabled && s.last_status === "error")
    if (targets.length === 0) {
      toast.info("当前没有抓取失败的信息源")
      return
    }
    setRetryingFailed(true)
    for (const s of targets) {
      setFetchingSourceId(s.id)
      try {
        await apiFetch<{ ok: boolean }>("/api/intel/fetch-now", {
          method: "POST",
          body: JSON.stringify({ source_id: s.id }),
        })
      } catch {
        // 请求级异常（断网/服务重启）不中断整轮重试，最终按服务端状态如实统计
      }
    }
    setFetchingSourceId("")
    let recovered = 0
    try {
      const fresh = await apiFetch<SourcesResponse>("/api/intel/sources")
      const rows = fresh.items ?? []
      setSources(rows)
      const statusById = new Map(rows.map((x) => [x.id, x.last_status]))
      recovered = targets.filter((t) => statusById.get(t.id) === "ok").length
    } catch {
      void loadSources()
    }
    if (recovered > 0) refreshItems()
    const still = targets.length - recovered
    toast[recovered > 0 ? "success" : "error"](
      recovered > 0
        ? `重试完成：${recovered} 个源恢复正常，${still} 个仍失败`
        : `重试完成：${targets.length} 个源仍无法抓取（多为对方反爬或站点改版，可考虑停用）`
    )
    setRetryingFailed(false)
  }, [requireLogin, sources, refreshItems, loadSources])

  // T8 运维自助：存量情报回填（重抓正文 → summary/tags/region 重生成）是已有服务端接口，
  // 此前只能脚本触发。这里扫描「缺描述 / 区域未知 / 摘要是垃圾」的列表条目，前端分批驱动补抓。
  // 每请求 40 条、时间预算 95s，最多 3 轮（≈120 条封顶，未跑完的提示再点一次）；零 AI 费用。
  const [enriching, setEnriching] = useState(false)
  const [enrichPhase, setEnrichPhase] = useState("")
  // 同一会话内已尝试回填的条目不重复抓：反爬/证书失败导致字段仍缺时，
  // 旧筛选会把同一批 120 条无限重选，用户点「续跑」永远撞同一堵墙。刷新页面可重新尝试。
  const enrichAttemptedRef = useRef<Set<string>>(new Set())
  const runIntelEnrich = useCallback(async () => {
    if (!requireLogin() || enriching) return
    setEnriching(true)
    setEnrichPhase("正在扫描待修复条目…")
    try {
      const todo: string[] = []
      // 发布时间不可能是未来（2026-10-27 补）：抓取端旧实现会从源页正文里抽出课程日期 /
      // 政策实施日期当发布日入库，实测 3 条 HIT专家网条目被写成 2027-04-29 / 2027-01-03。
      // 列表按 -published_at 排序，这类条目会永远置顶，而用户看到的「2027 年」其实不是发布日。
      // 后端 __intelValidDate 早已补了未来守卫，但存量坏值只在 recompute_crawl 模式下才清，
      // 而这里的筛选条件只看「缺摘要 / 缺区域」——实测 3 条里只有 1 条满足，另外 2 条
      // 摘要区域都正常、永远修不到。故把「发布日在未来」并入待修集合。
      const todayStamp = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      let hasFuturePub = false
      for (let page = 1; page <= 6 && todo.length < 120; page++) {
        const data = await apiFetch<ItemsResponse>(
          `/api/intel/items?page=${page}&per_page=50&item_status=pending,confirmed`,
        )
        const rows = data.items ?? []
        for (const it of rows) {
          const sum = (it.summary || "").trim()
          const junkSum = !!sum && /<a\s|href=|https?:\/\//i.test(sum)
          const pubFuture = (it.published_at || "").slice(0, 10) > todayStamp
          if (pubFuture) hasFuturePub = true
          // 2026-11-03 招标正文补齐：旧筛选只看摘要/区域，导致「采购人已抽到但正文仍是列表残片」
          // 的招标条目永远进不了回填——实测 210 条招标仅 2 条正文 ≥500 字，截止/预算几乎为零。
          // 任一关键要素缺失即需重抓原文；手动录入不重抓（与既有保护一致）。
          const st = it.structured ?? {}
          const needsBidBody = it.item_type === "bid" && it.added_by !== "manual" &&
            (!st.deadline || !st.budget || !st.code || !st.buyer)
          const alreadyTried = enrichAttemptedRef.current.has(it.id)
          if (!alreadyTried && (!sum || junkSum || !(it.region || "").trim() || pubFuture || needsBidBody)) {
            todo.push(it.id)
            enrichAttemptedRef.current.add(it.id)
          }
          if (todo.length >= 120) break
        }
        if (rows.length < 50) break
      }
      if (todo.length === 0) {
        toast.info("没有发现待修复条目：近期条目的描述与区域都已齐备")
        return
      }
      let processed = 0
      let changed = 0
      let cleared = 0
      // queue = 尚未发送的条目 + 批内超时的回补项（pending_ids 只含已发送批内的超时条目，
      // 若不保留 queue 会把 todo 里第 40 条之后从未请求过的条目静默丢掉）
      let queue = todo
      for (let round = 0; round < 3 && queue.length > 0; round++) {
        setEnrichPhase(`回填中 第 ${round + 1} 轮（已处理 ${processed}/${todo.length}）…`)
        const batch = queue.slice(0, 40)
        queue = queue.slice(40)
        const r = await apiFetch<{
          ok: boolean
          changed?: number
          cleared_summary?: number
          done_ids?: string[]
          pending_ids?: string[]
          message?: string
        }>("/api/intel/enrich", {
          method: "POST",
          // recompute_crawl（2026-10-27）：上面新增了「发布日在未来」这一待修项，而未来日期
          // 的清理只存在于后端的 recompute_crawl 分支（fill 模式只补空不覆盖）。
          // 该模式后端只动机器写入（added_by='crawl'）的条目，manual 条目永不触碰。
          body: JSON.stringify(
            hasFuturePub
              ? { item_ids: batch, budget_ms: 95000, region_mode: "recompute_crawl" }
              : { item_ids: batch, budget_ms: 95000 },
          ),
        })
        if (!r.ok) {
          toast.error(r.message || "回填请求失败，请稍后重试")
          return
        }
        changed += r.changed ?? 0
        cleared += r.cleared_summary ?? 0
        processed += (r.done_ids ?? []).length
        queue = queue.concat(r.pending_ids ?? [])
      }
      // T4：先用 enrich 补齐正文/摘要，再做招标要素抽取（纯本地正则、零 AI 费用）——
      // 此时证据文本更全；deadline/buyer/budget 等写入 structured 后，列表「截止」徽章与详情面板自动展示。
      // 缺省全量模式幂等（只补空缺键），pending 非空时续跑，最多 3 轮。
      setEnrichPhase("抽取招标要素（采购方/预算/截止/编号）…")
      let ebUpdated = 0
      let ebDeadline = 0
      try {
        for (let ebRound = 0; ebRound < 3; ebRound++) {
          const er = await apiFetch<{
            ok: boolean
            updated?: number
            hits?: { deadline?: number }
            pending_ids?: string[]
          }>("/api/intel/extract-bid", {
            method: "POST",
            body: JSON.stringify({ budget_ms: 110000 }),
          })
          if (!er.ok) break
          ebUpdated += er.updated ?? 0
          ebDeadline += er.hits?.deadline ?? 0
          if ((er.pending_ids ?? []).length === 0) break
        }
      } catch {
        // 要素抽取失败不阻断修复主流程（条目数据已回填生效）
      }
      refreshItems()
      toast.success(
        `数据修复完成：处理 ${processed} 条，更新 ${changed}` +
          (cleared > 0 ? `，清掉垃圾摘要 ${cleared}` : "") +
          (ebUpdated > 0 ? `；抽取招标要素 ${ebUpdated} 条（含截止 ${ebDeadline}）` : "") +
          (queue.length > 0 ? `（还有 ${queue.length} 条未处理完，可再点一次续跑）` : ""),
      )
    } catch {
      toast.error("数据修复失败：连不上情报服务")
    } finally {
      setEnriching(false)
      setEnrichPhase("")
    }
  }, [requireLogin, enriching, refreshItems])

  // ------------------------------ 收藏 ------------------------------
  const [starRows, setStarRows] = useState<IntelStarRow[]>([])

  const loadStars = useCallback(async (uid: string) => {
    try {
      const data = await apiFetch<StarListResponse>(
        `/api/intel_stars?rh_user_id=${encodeURIComponent(uid)}`,
      )
      setStarRows(data.items ?? [])
    } catch {
      setStarRows([])
    }
  }, [])

  useEffect(() => {
    if (userId) void loadStars(userId)
    else setStarRows([])
  }, [userId, loadStars])

  const starredIds = starRows.map((s) => s.item_id)

  const isStarred = useCallback(
    (itemId: string) => starRows.some((s) => s.item_id === itemId),
    [starRows],
  )

  const toggleStar = useCallback(
    async (item: IntelItemRow) => {
      if (!requireLogin()) return
      const existing = starRows.find((s) => s.item_id === item.id)
      try {
        if (existing) {
          await apiFetch<{ ok?: boolean }>(
            `/api/intel_stars/${encodeURIComponent(existing.id)}`,
            { method: "DELETE" },
          )
          setStarRows((prev) => prev.filter((s) => s.id !== existing.id))
          toast.success("已取消收藏")
        } else {
          const created = await apiFetch<IntelStarRow & { ok?: boolean }>("/api/intel_stars", {
            method: "POST",
            body: JSON.stringify({ rh_user_id: userId ?? "", item_id: item.id }),
          })
          const newId = (created as { id?: string }).id
          if (newId) setStarRows((prev) => [...prev, { id: newId, rh_user_id: userId ?? "", item_id: item.id }])
          else void loadStars(userId ?? "")
          toast.success("已收藏")
        }
      } catch (err) {
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("收藏操作失败，请稍后重试")
      }
    },
    [requireLogin, starRows, userId, loadStars],
  )

  // ------------------------------ 条目操作 ------------------------------
  // 轮次 B：全局搜索/首页情报深链 ?item= 消费（声明前置：ux-04 closeDetail 需同步清理参数）
  const [searchParams, setSearchParams] = useSearchParams()
  const [detailItem, setDetailItem] = useState<IntelItemRow | null>(null)
  const [taggingIds, setTaggingIds] = useState<string[]>([])

  const openDetail = useCallback((item: IntelItemRow) => setDetailItem(item), [])
  // ux-04：关闭详情后同步清理深链 ?item= 参数，避免地址栏残留过期状态（回退/分享态一致）
  const closeDetail = useCallback(() => {
    setDetailItem(null)
    setSearchParams((prev) => {
      if (!prev.has("item")) return prev
      const next = new URLSearchParams(prev)
      next.delete("item")
      return next
    }, { replace: true })
  }, [setSearchParams])

  // 轮次 F 轨 2：情报一键转商机——本地抽取医院名/金额后带预填深链跳客户管理
  const navigate = useNavigate()
  const convertToOpportunity = useCallback(
    (item: IntelItemRow) => {
      setDetailItem(null)
      navigate(`/customer-management?${buildIntelToOppQuery(item)}`)
      toast.success("已跳转客户管理，商机信息已按情报预填")
    },
    [navigate],
  )

  // 轮次 B：深链 ?item= 消费。分页列表可能不含该条，直接按 id 取单条。
  const deepLinkItemRef = useRef<string | null>(null)
  useEffect(() => {
    const itemId = searchParams.get("item")
    if (!itemId || deepLinkItemRef.current === itemId) return
    deepLinkItemRef.current = itemId
    void apiFetch<IntelItemRow>(`/api/intel_items/${encodeURIComponent(itemId)}`)
      .then((rec) => {
        if (!rec?.id) {
          toast.error("未找到对应情报")
          return
        }
        // 单条路由返回原始记录：my_status 来自本人状态表，缺省按 pending 容错
        setDetailItem({
          ...rec,
          tags: Array.isArray(rec.tags) ? rec.tags : [],
          my_status: rec.my_status || "pending",
        })
      })
      .catch(() => toast.error("未找到对应情报"))
  }, [searchParams])

  const patchItemLocal = useCallback((itemId: string, patch: Partial<IntelItemRow>) => {
    setItemList((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)))
    setDetailItem((prev) => (prev && prev.id === itemId ? { ...prev, ...patch } : prev))
  }, [])

  /** 招标要素人工补正：只提交白名单字段，成功后同步列表与详情；失败不覆盖本地现状 */
  const saveStructured = useCallback(async (item: IntelItemRow, structured: IntelStructured): Promise<boolean> => {
    if (!requireLogin()) return false
    try {
      const rec = await apiFetch<IntelItemRow>(`/api/intel_items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ structured }),
      })
      if (!rec?.id) {
        toast.error("招标要素保存失败：服务未返回记录")
        return false
      }
      patchItemLocal(item.id, { structured: rec.structured ?? structured })
      toast.success("招标要素已保存，后续新建标书任务将按修正后的要素预填")
      return true
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      if (e.httpStatus === 401) setNeedsRhLogin(true)
      toast.error("招标要素保存失败，请稍后重试")
      return false
    }
  }, [patchItemLocal, requireLogin])

  const setItemStatus = useCallback(
    async (item: IntelItemRow, nextStatus: "confirmed" | "ignored") => {
      if (!requireLogin()) return
      const prevStatus = (item.my_status || "pending") as "pending" | "confirmed" | "ignored"
      patchItemLocal(item.id, { my_status: nextStatus })
      try {
        const r = await apiFetch<{ ok: boolean; message?: string }>(
          `/api/intel/items/${encodeURIComponent(item.id)}/view`,
          { method: "POST", body: JSON.stringify({ view_status: nextStatus }) },
        )
        if (!r.ok) {
          patchItemLocal(item.id, { my_status: prevStatus })
          toast.error(r.message || "操作失败，请稍后重试")
          return
        }
        toast.success(nextStatus === "confirmed" ? "已确认该情报（仅更新你自己的状态）" : "已忽略该情报（仅更新你自己的状态）")
      } catch (err) {
        patchItemLocal(item.id, { my_status: prevStatus })
        const e = err as Error & { httpStatus?: number }
        if (e.httpStatus === 401) setNeedsRhLogin(true)
        toast.error("操作失败，请稍后重试")
      }
    },
    [patchItemLocal, requireLogin],
  )

  const confirmItem = useCallback(
    (item: IntelItemRow) => void setItemStatus(item, "confirmed"),
    [setItemStatus],
  )
  const ignoreItem = useCallback(
    (item: IntelItemRow) => void setItemStatus(item, "ignored"),
    [setItemStatus],
  )

  // ------------------------------ 循环 10 小改 2：批量模式（确认/忽略/收藏，串行 best-effort 汇总 toast） ------------------------------
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchBusy, setBatchBusy] = useState(false)

  const toggleBatchMode = useCallback(() => {
    setBatchMode((v) => {
      if (v) setBatchSelectedIds([])
      return !v
    })
  }, [])
  const toggleBatchSelect = useCallback((id: string) => {
    setBatchSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])
  const clearBatchSelect = useCallback(() => setBatchSelectedIds([]), [])

  const batchSetStatus = useCallback(
    async (nextStatus: "confirmed" | "ignored") => {
      const ids = batchSelectedIds
      if (!ids.length) return
      if (!requireLogin()) return
      setBatchBusy(true)
      let ok = 0
      let fail = 0
      for (const id of ids) {
        const item = itemList.find((it) => it.id === id)
        if (!item) continue
        const prevStatus = (item.my_status || "pending") as "pending" | "confirmed" | "ignored"
        patchItemLocal(id, { my_status: nextStatus })
        try {
          const r = await apiFetch<{ ok: boolean; message?: string }>(
            `/api/intel/items/${encodeURIComponent(id)}/view`,
            { method: "POST", body: JSON.stringify({ view_status: nextStatus }) },
          )
          if (!r.ok) {
            patchItemLocal(id, { my_status: prevStatus })
            fail += 1
          } else {
            ok += 1
          }
        } catch {
          patchItemLocal(id, { my_status: prevStatus })
          fail += 1
        }
      }
      setBatchBusy(false)
      setBatchSelectedIds([])
      setBatchMode(false)
      const verb = nextStatus === "confirmed" ? "确认" : "忽略"
      toast[fail ? "error" : "success"](
        fail ? `批量${verb}：${ok} 条成功，${fail} 条失败请重试` : `已批量${verb} ${ok} 条情报（仅更新你自己的状态）`,
      )
    },
    [batchSelectedIds, itemList, patchItemLocal, requireLogin],
  )

  const batchToggleStar = useCallback(async () => {
    const ids = batchSelectedIds
    if (!ids.length) return
    if (!requireLogin()) return
    setBatchBusy(true)
    let ok = 0
    let fail = 0
    let added = 0
    let removed = 0
    for (const id of ids) {
      const existing = starRows.find((s) => s.item_id === id)
      try {
        if (existing) {
          await apiFetch<{ ok?: boolean }>(`/api/intel_stars/${encodeURIComponent(existing.id)}`, { method: "DELETE" })
          setStarRows((prev) => prev.filter((s) => s.id !== existing.id))
          removed += 1
        } else {
          const created = await apiFetch<IntelStarRow & { ok?: boolean }>("/api/intel_stars", {
            method: "POST",
            body: JSON.stringify({ rh_user_id: userId ?? "", item_id: id }),
          })
          const newId = (created as { id?: string }).id
          if (newId) setStarRows((prev) => [...prev, { id: newId, rh_user_id: userId ?? "", item_id: id }])
          added += 1
        }
        ok += 1
      } catch {
        fail += 1
      }
    }
    setBatchBusy(false)
    setBatchSelectedIds([])
    setBatchMode(false)
    toast[fail ? "error" : "success"](
      fail
        ? `批量收藏：${ok} 条成功，${fail} 条失败请重试`
        : `批量收藏完成：新增 ${added} 条、取消 ${removed} 条`,
    )
  }, [batchSelectedIds, requireLogin, starRows, userId])

  // 单条 AI 增强的核心：调用网关 → 解析 → 乐观更新 + PATCH 落库（失败回滚）。
  // 不弹 toast、不管理 taggingIds，供单条按钮与批量增强复用。
  const runAiTag = useCallback(
    async (item: IntelItemRow): Promise<{ ok: boolean; reason?: string }> => {
      try {
        const r = await chatViaGateway({
          modelRef: activeModelRef,
          messages: buildTagMessages(item),
          page: "intel-center",
          max_tokens: 1024,
        })
        if (r.needsLogin) return { ok: false, reason: "login" }
        if (!r.ok || r.status !== "success" || !r.text) {
          // 循环7 C1 附带：未收录错误码/裸英文码统一中文兜底（口径见 @/lib/llmError）
          return {
            ok: false,
            reason: localizeLlmError(r.error, { generic: "AI 摘要失败，请稍后重试", copy: INTEL_ERROR_ZH }),
          }
        }
        const parsed = parseAiTagResult(r.text)
        if (!parsed) return { ok: false, reason: "parse" }
        // 循环7 C1-3：乐观更新前快照本地字段，PATCH 落库失败时回滚并提示
        const prevSnapshot = {
          summary: item.summary,
          item_type: item.item_type,
          region: item.region,
          tags: item.tags,
        }
        patchItemLocal(item.id, {
          summary: parsed.summary,
          item_type: parsed.item_type,
          region: parsed.region,
          tags: parsed.tags,
        })
        try {
          await apiFetch<{ ok?: boolean }>(`/api/intel_items/${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              summary: parsed.summary,
              item_type: parsed.item_type,
              region: parsed.region,
              tags: parsed.tags,
            }),
          })
        } catch (patchErr) {
          patchItemLocal(item.id, prevSnapshot)
          const pe = patchErr as Error & { httpStatus?: number }
          if (pe.httpStatus === 401) return { ok: false, reason: "login" }
          return { ok: false, reason: "save" }
        }
        return { ok: true }
      } catch {
        return { ok: false, reason: "AI 摘要失败，请稍后重试" }
      }
    },
    [patchItemLocal],
  )

  const doAiTag = useCallback(
    async (item: IntelItemRow) => {
      setTaggingIds((prev) => [...prev, item.id])
      const res = await runAiTag(item)
      setTaggingIds((prev) => prev.filter((id) => id !== item.id))
      if (res.ok) {
        toast.success("AI 摘要与打标完成")
      } else if (res.reason === "login") {
        setNeedsRhLogin(true)
        toast.error(INTEL_ERROR_ZH.rh_login_required)
      } else if (res.reason === "parse") {
        toast.error("AI 返回内容无法解析，请重试")
      } else if (res.reason === "save") {
        toast.error("AI 打标结果保存失败，已恢复原内容，请稍后重试")
      } else {
        toast.error(res.reason || "AI 摘要失败，请稍后重试")
      }
    },
    [runAiTag],
  )

  const aiTagItem = useCallback(
    (item: IntelItemRow) => {
      if (!requireLogin()) return
      costConfirm.runWithCostConfirm(
        () => {
          void doAiTag(item)
        },
        `将调用 AI 为这条情报生成摘要与标签，${costTextForModel(activeModelRef)}`,
      )
    },
    [requireLogin, costConfirm, doAiTag],
  )

  const aiTagging = useCallback((itemId: string) => taggingIds.includes(itemId), [taggingIds])

  // 批量 AI 增强：对当前选中的情报逐条调用网关生成摘要/分类/区域/标签，串行执行、
  // 命中登录失效即中断，结束给一次汇总提示（成本确认在 aiTagBatch 入口统一做一次）。
  const batchAiTag = useCallback(async () => {
    const ids = batchSelectedIds
    if (!ids.length) return
    if (!requireLogin()) return
    const targets = itemList.filter((it) => ids.includes(it.id))
    setBatchBusy(true)
    let ok = 0
    let fail = 0
    let login = false
    for (const it of targets) {
      const res = await runAiTag(it)
      if (res.ok) {
        ok += 1
      } else {
        fail += 1
        if (res.reason === "login") {
          login = true
          break
        }
      }
    }
    setBatchBusy(false)
    if (login) {
      setNeedsRhLogin(true)
      toast.error(INTEL_ERROR_ZH.rh_login_required)
      return
    }
    toast[fail ? "error" : "success"](
      fail
        ? `批量 AI 增强：${ok} 条成功，${fail} 条失败可重试`
        : `已完成 ${ok} 条情报的 AI 摘要与打标`,
    )
    setBatchSelectedIds([])
    setBatchMode(false)
  }, [batchSelectedIds, itemList, requireLogin, runAiTag])

  const aiTagBatch = useCallback(() => {
    if (!requireLogin()) return
    if (!batchSelectedIds.length) return
    costConfirm.runWithCostConfirm(
      () => {
        void batchAiTag()
      },
      `将调用 AI 为选中的 ${batchSelectedIds.length} 条情报生成摘要与标签，${costTextForModel(activeModelRef)}`,
    )
  }, [requireLogin, batchSelectedIds, costConfirm, batchAiTag])

  // ------------------------------ 手动录入 ------------------------------
  const [entryDialogOpen, setEntryDialogOpen] = useState(false)
  const [entryTitle, setEntryTitle] = useState("")
  const [entryUrl, setEntryUrl] = useState("")
  const [entrySnippet, setEntrySnippet] = useState("")
  const [entryType, setEntryType] = useState<IntelSourceType>("policy")
  const [entryRegion, setEntryRegion] = useState("")
  const [entrySaving, setEntrySaving] = useState(false)
  const [entryIsPublic, setEntryIsPublic] = useState(false)
  const [entryFetchingUrl, setEntryFetchingUrl] = useState(false)

  const openEntryDialog = useCallback(() => {
    if (!requireLogin()) return
    setEntryDialogOpen(true)
  }, [requireLogin])
  const closeEntryDialog = useCallback(() => setEntryDialogOpen(false), [])

  const fetchEntryUrl = useCallback(async () => {
    const url = entryUrl.trim()
    if (!/^https?:\/\//i.test(url)) {
      toast.error("请先在链接框填写 http:// 或 https:// 开头的文章链接")
      return
    }
    setEntryFetchingUrl(true)
    try {
      const r = await apiFetch<{ ok: boolean; title?: string; snippet?: string; message?: string }>(
        "/api/intel/fetch-url",
        { method: "POST", body: JSON.stringify({ url }) },
      )
      if (!r.ok) {
        toast.error(r.message || "抓取失败，可手动填写标题与正文")
        return
      }
      if (r.title) setEntryTitle(r.title.slice(0, 200))
      if (r.snippet) setEntrySnippet(r.snippet.slice(0, 2000))
      toast.success("已抓取链接内容，可继续编辑后保存")
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      if (e.httpStatus === 401) setNeedsRhLogin(true)
      toast.error("抓取链接失败，请稍后重试或手动填写")
    } finally {
      setEntryFetchingUrl(false)
    }
  }, [entryUrl])

  const submitEntry = useCallback(async () => {
    // Round 26 (intel-data-01)：持久化前清洗粘贴/抓取的网页残留（服务端 POST 对手动入库零清洗）
    const title = cleanIntelLine(entryTitle)
    if (!title) {
      toast.error("请填写情报标题")
      return
    }
    const cleanBody = cleanIntelBody(entrySnippet, 2000)
    if (!cleanBody.text) {
      toast.error("请填写情报正文（清理后无有效内容）")
      return
    }
    const url = entryUrl.trim()
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error("原文链接必须以 http:// 或 https:// 开头")
      return
    }
    if (cleanBody.changed) {
      toast.info(cleanBody.removedLines > 0 ? `已自动清理正文中的脚本/标签与 ${cleanBody.removedLines} 行噪声内容` : "已自动清理正文中的脚本/标签残留")
    }
    setEntrySaving(true)
    try {
      const nowIso = new Date().toISOString()
      const r = await apiFetch<{ id?: string }>("/api/intel_items", {
        method: "POST",
        body: JSON.stringify({
          title: title.slice(0, 200),
          url: url.slice(0, 500),
          content_snippet: cleanBody.text.slice(0, 2000),
          item_type: entryType,
          region: entryRegion.trim().slice(0, 30),
          item_status: "pending",
          added_by: "manual",
          owner_id: userId ?? "",
          visibility: entryIsPublic ? "public" : "personal",
          source_name: "手动录入",
          published_at: nowIso,
        }),
      })
      if (!r || !r.id) {
        toast.error("录入失败，请稍后重试")
        return
      }
      toast.success(entryIsPublic ? "情报已录入并公开到团队" : "情报已录入（仅自己可见），可在列表中确认或用 AI 打标")
      setEntryDialogOpen(false)
      setEntryTitle("")
      setEntryUrl("")
      setEntrySnippet("")
      setEntryType("policy")
      setEntryRegion("")
      setEntryIsPublic(false)
      refreshItems()
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      if (e.httpStatus === 401) setNeedsRhLogin(true)
      toast.error("录入失败，请稍后重试")
    } finally {
      setEntrySaving(false)
    }
  }, [entryTitle, entryUrl, entrySnippet, entryType, entryRegion, entryIsPublic, userId, refreshItems])

  // ------------------------------ 重构轮：项目线索标记 / 一键建标书任务 / AI 情报周报 ------------------------------

  // 线索标记（个人维度，localStorage 持久化；卡片显「已标线索」徽标，详情可一键建标/转商机）
  const [leadIds, setLeadIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(INTEL_LEAD_KEY) || "[]")
      return Array.isArray(raw) ? raw.map(String) : []
    } catch {
      return []
    }
  })
  const isLead = useCallback((itemId: string) => leadIds.includes(itemId), [leadIds])
  const toggleLead = useCallback(
    (item: IntelItemRow) => {
      const wasLead = leadIds.includes(item.id)
      setLeadIds((prev) => {
        const next = prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]
        try {
          localStorage.setItem(INTEL_LEAD_KEY, JSON.stringify(next))
        } catch {
          /* 存储不可用时仅内存态生效 */
        }
        return next
      })
      toast.success(wasLead ? "已取消线索标记" : "已标记为项目线索，可在详情一键建标书任务")
    },
    [leadIds],
  )

  // 一键新建标书任务：按情报招标要素预填创建 bid_projects 草稿并直跳标书工作区
  const createBidTask = useCallback(
    (item: IntelItemRow) => {
      if (!requireLogin()) return
      const st = (item.structured || {}) as Record<string, string>
      const hasStructured = Boolean(st.code || st.buyer || st.budget || st.deadline)
      const dm = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(st.deadline || "")
      const payload: Record<string, unknown> = {
        rh_user_id: userId ?? "",
        project_name: item.title.slice(0, 120),
        tender_no: st.code || "",
        hospital: st.buyer || "",
        stage: "pending_parse",
        global_facts: `来源情报：${item.url || item.title}；预算参考：${st.budget || "未抽取到"}；截止：${st.deadline || "未抽取到"}`,
      }
      if (dm) payload.bid_open_date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`
      void apiFetch<{ id?: string }>("/api/bid_projects", { method: "POST", body: JSON.stringify(payload) })
        .then((r) => {
          if (!r?.id) {
            toast.error("标书任务创建失败：未返回项目 id")
            return
          }
          // R217：手动录入的情报没有 structured 要素，如实提示避免「已带入」误导
          toast.success(hasStructured
            ? "标书任务已创建（招标要素已带入），正在跳转标书工作区"
            : "标书任务已创建（该情报无结构化要素，请到第 1 步粘贴招标原文），正在跳转")
          setDetailItem(null)
          navigate(`/bid-workspace?project=${encodeURIComponent(r.id)}`)
        })
        .catch((err) => {
          const e = err as Error & { httpStatus?: number }
          if (e.httpStatus === 401) setNeedsRhLogin(true)
          toast.error("标书任务创建失败，请稍后重试")
        })
    },
    [requireLogin, userId, navigate],
  )

  // AI 情报周报：只汇总近 7 天高分待办、临期与已确认条目，避免「垃圾进垃圾出」
  const [reportOpen, setReportOpen] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportText, setReportText] = useState("")

  const doWeeklyReport = useCallback(async () => {
    setReportLoading(true)
    setReportText("")
    try {
      const weekItems = selectWeeklyIntelItems(itemList, new Date(), isItemFocused, 20)
      if (weekItems.length === 0) {
        setReportText("近 7 天没有可汇总的情报（已忽略条目不计入）。可调整筛选时间范围，或先到信息源管理补充采集源。")
        return
      }
      const ctx = weekItems
        .map((it, i) => {
          const st = it.structured ?? {}
          const facts = [
            st.buyer ? `采购人=${st.buyer}` : "",
            st.budget ? `预算=${st.budget}` : "",
            st.deadline ? `截止=${st.deadline}` : "",
            st.code ? `编号=${st.code}` : "",
          ].filter(Boolean).join("；")
          return `${i + 1}. [${SOURCE_TYPE_LABEL[it.item_type] || "其他"}] ${it.title}（${it.source_name || "来源未知"}${it.region ? `｜${it.region}` : ""}｜${fmtIntelTime(it.published_at || it.created)}）${facts ? `【${facts}】` : ""}${it.summary ? ` 摘要：${it.summary.slice(0, 120)}` : ""}`
        })
        .join("\n")
      const messages: LlmMessage[] = [
        {
          role: "system",
          content:
            "你是医疗信息化售前团队的情报分析师。基于给定的一周情报清单输出一份 Markdown 周报，结构固定为：\n# 售前情报周报\n## 本周要点（3-5 条）\n## 政策与标准\n## 招标机会（含预算/截止，标注建议动作）\n## 竞品动态\n## 建议行动清单\n只依据清单内容，不得编造；某节无内容写「本周无」。语言精炼，面向售前工程师。",
        },
        { role: "user", content: `请基于以下 ${weekItems.length} 条本周情报生成周报：\n${ctx}` },
      ]
      const r = await chatViaGateway({ modelRef: activeModelRef, messages, page: "intel-center", max_tokens: 2048 })
      if (r.needsLogin) {
        setNeedsRhLogin(true)
        setReportText(INTEL_ERROR_ZH.rh_login_required)
        return
      }
      if (!r.ok || r.status !== "success" || !r.text) {
        setReportText(
          localizeLlmError(r.error, { generic: "周报生成失败，请稍后重试", copy: INTEL_ERROR_ZH }),
        )
        return
      }
      setReportText(r.text)
    } catch {
      setReportText("周报生成异常，请稍后重试")
    } finally {
      setReportLoading(false)
    }
  }, [itemList, isItemFocused])

  const generateWeeklyReport = useCallback(() => {
    if (!requireLogin()) return
    setReportOpen(true)
    costConfirm.runWithCostConfirm(
      () => {
        void doWeeklyReport()
      },
      `将调用 AI 汇总近 7 天情报生成售前周报，${costTextForModel(activeModelRef)}`,
    )
  }, [requireLogin, costConfirm, doWeeklyReport])

  // ------------------------------ 汇总 ------------------------------
  return {
    costConfirm,
    // 登录
    userId,
    handleAccountChange,
    needsRhLogin,
    // 模型
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    // 筛选
    typeTab,
    handleTypeTab,
    statusTab,
    handleStatusTab,
    searchInput,
    setSearchInput,
    submitSearch,
    clearFilters,
    activeTag,
    handleTagClick,
    allTags,
    sinceRange,
    handleSinceChange,
    regionFilter,
    handleRegionFilter,
    sourceFilter,
    handleSourceFilter,
    regionOptions,
    sourceOptions,
    // 个人偏好
    prefs,
    prefsDialogOpen,
    openPrefsDialog,
    closePrefsDialog,
    prefsSaving,
    savePrefs,
    prefsSourceNames,
    // 关注置顶
    displayItems,
    // 今日工作队列
    dailyWork,
    // 循环 10 小改 1：排序口径
    listSortKey,
    setListSortKey,
    isItemFocused,
    // 列表
    itemList,
    itemsLoading,
    totalItems,
    hasMore,
    loadMore,
    exportItems,
    refreshItems,
    // 存量清理
    cleanupOpen,
    cleanupBusy,
    cleanupInfo,
    openCleanupPreview,
    confirmCleanup,
    // 循环 12：存量不相关引导横幅
    cleanupSuggested,
    dismissCleanupSuggested,
    closeCleanup,
    // 条目操作
    detailItem,
    openDetail,
    closeDetail,
    convertToOpportunity,
    confirmItem,
    ignoreItem,
    saveStructured,
    // 重构轮：线索 / 建标 / 周报
    leadIds,
    isLead,
    toggleLead,
    createBidTask,
    reportOpen,
    closeReport: () => setReportOpen(false),
    reportLoading,
    reportText,
    generateWeeklyReport,
    // 循环 10 小改 2：批量模式
    batchMode,
    batchSelectedIds,
    batchBusy,
    toggleBatchMode,
    toggleBatchSelect,
    clearBatchSelect,
    batchSetStatus,
    batchToggleStar,
    aiTagItem,
    aiTagBatch,
    aiTagging,
    // 收藏
    starredIds,
    isStarred,
    toggleStar,
    // 手动录入
    entryDialogOpen,
    openEntryDialog,
    closeEntryDialog,
    entryTitle,
    setEntryTitle,
    entryUrl,
    setEntryUrl,
    entrySnippet,
    setEntrySnippet,
    entryType,
    setEntryType,
    entryRegion,
    setEntryRegion,
    entrySaving,
    submitEntry,
    entryIsPublic,
    setEntryIsPublic,
    entryFetchingUrl,
    fetchEntryUrl,
    // 信息源
    sources,
    sourcesLoading,
    sourcesPanelOpen,
    openSourcesPanel,
    closeSourcesPanel,
    fetchingSourceId,
    newSourceName,
    setNewSourceName,
    newSourceUrl,
    setNewSourceUrl,
    newSourceType,
    setNewSourceType,
    addingSource,
    addSource,
    toggleSource,
    deleteSource,
    fetchSourceNow,
    retryingFailed,
    retryFailedSources,
    enriching,
    enrichPhase,
    runIntelEnrich,
  }
}
