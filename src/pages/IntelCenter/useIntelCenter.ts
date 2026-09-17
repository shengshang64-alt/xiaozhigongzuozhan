import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import { buildIntelToOppQuery } from "@/lib/intelToOpp"
import { exportIntelItemsXlsx } from "@/lib/intelExports"
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
  created: string
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
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PER_PAGE = 10

// ---------------------------------------------------------------------------
// AI 摘要打标（统一模型网关：个人模型优先，平台 gpt-5.5 兜底）
// ---------------------------------------------------------------------------

const LLM_ERROR_ZH: Record<string, string> = {
  timeout: "AI 处理超时（可能服务器繁忙），请稍后重试",
  not_found: "请求未能到达 AI，请检查网络后重试",
  rh_login_required: "AI 摘要服务暂不可用，请检查模型配置",
  insufficient_balance: "RunningHub 账户余额不足，请充值后重试",
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
  const exportItems = useCallback(() => {
    if (itemList.length === 0) {
      toast.info("当前没有已加载的情报可导出，请先调整筛选或加载更多")
      return
    }
    try {
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
  }, [refreshItems])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------ 信息源 ------------------------------
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
      if (listSortKey === "title") return (a.title ?? "").localeCompare(b.title ?? "", "zh-CN")
      const kind = listSortKey === "added" ? "added" : "published"
      return timeOf(b, kind).localeCompare(timeOf(a, kind))
    })
    return arr
  }, [itemList, isItemFocused, listSortKey])

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

  /** 第二段：确认后真正删除并刷新列表 */
  const confirmCleanup = useCallback(async () => {
    setCleanupBusy(true)
    try {
      const r = await apiFetch<{ ok: boolean; deleted?: number; message?: string }>(
        "/api/intel/cleanup-irrelevant",
        { method: "POST", body: JSON.stringify({ confirm: true }) },
      )
      if (!r.ok) {
        toast.error(r.message || "清理失败，请稍后重试")
        return
      }
      toast.success(`已清理 ${r.deleted ?? 0} 条不相关情报`)
      setCleanupOpen(false)
      setCleanupInfo(null)
      setCleanupSuggested(false)
      refreshItems()
    } catch {
      toast.error("清理失败，请稍后重试")
    } finally {
      setCleanupBusy(false)
    }
  }, [refreshItems])

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
  const [detailItem, setDetailItem] = useState<IntelItemRow | null>(null)
  const [taggingIds, setTaggingIds] = useState<string[]>([])

  const openDetail = useCallback((item: IntelItemRow) => setDetailItem(item), [])
  const closeDetail = useCallback(() => setDetailItem(null), [])

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

  // 轮次 B：全局搜索/首页情报深链 ?item= 消费。分页列表可能不含该条，直接按 id 取单条。
  const [searchParams] = useSearchParams()
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

  const doAiTag = useCallback(
    async (item: IntelItemRow) => {
      setTaggingIds((prev) => [...prev, item.id])
      try {
        const r = await chatViaGateway({
          modelRef: activeModelRef,
          messages: buildTagMessages(item),
          page: "intel-center",
          max_tokens: 1024,
        })
        if (r.needsLogin) {
          setNeedsRhLogin(true)
          toast.error(LLM_ERROR_ZH.rh_login_required)
          return
        }
        if (!r.ok || r.status !== "success" || !r.text) {
          // 循环7 C1 附带：未收录错误码/裸英文码统一中文兜底，不再把原始码透给用户
          const rawErr = r.error ?? ""
          const zhErr =
            LLM_ERROR_ZH[rawErr] ??
            (/[一-龥]/.test(rawErr) ? rawErr : "AI 摘要失败，请稍后重试")
          toast.error(zhErr)
          return
        }
        const parsed = parseAiTagResult(r.text)
        if (!parsed) {
          toast.error("AI 返回内容无法解析，请重试")
          return
        }
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
          if (pe.httpStatus === 401) setNeedsRhLogin(true)
          toast.error("AI 打标结果保存失败，已恢复原内容，请稍后重试")
          return
        }
        toast.success("AI 摘要与打标完成")
      } catch {
        toast.error("AI 摘要失败，请稍后重试")
      } finally {
        setTaggingIds((prev) => prev.filter((id) => id !== item.id))
      }
    },
    [patchItemLocal],
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
    const title = entryTitle.trim()
    if (!title) {
      toast.error("请填写情报标题")
      return
    }
    const url = entryUrl.trim()
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error("原文链接必须以 http:// 或 https:// 开头")
      return
    }
    setEntrySaving(true)
    try {
      const nowIso = new Date().toISOString()
      const r = await apiFetch<{ id?: string }>("/api/intel_items", {
        method: "POST",
        body: JSON.stringify({
          title: title.slice(0, 200),
          url: url.slice(0, 500),
          content_snippet: entrySnippet.trim().slice(0, 2000),
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
  }
}
