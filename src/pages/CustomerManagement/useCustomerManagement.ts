import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import { pbJsonRequest } from "@/lib/pbJson"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  resolveAvailableModels,
  type ModelRef,
} from "@/lib/modelGateway"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { normalizeRegion } from "./customerNormalize"
import { localizeLlmError } from "@/lib/llmError"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { injectSkillBlock, skillBlockFor } from "@/lib/skillCore"
import {
  BID_STAGE_LABEL,
  bidResultLabel,
  buildExtractMessages,
  buildProfileMessages,
  buildSuggestionMessages,
  computeMissingFields,
  decodeBinSections,
  deriveFlatFromLeadership,
  DRAFT_NUMBER_KEYS,
  EMPTY_CUSTOMER_DRAFT,
  isTerminalStage,
  nowIso,
  parseProfileJson,
  parseSuggestionsJson,
  rowToDraft,
  splitDepartmentList,
  STAGE_LABEL,
  toLeadership,
  toNumberOrNull,
  type AiProfileResult,
  type BinSection,
  type BidProjectLinkRow,
  type ChainAssetItem,
  type ContactInfo,
  type CustomerDraft,
  type CustomerLead,
  type CustomerRow,
  type FollowRecordRow,
  type OppStage,
  type OpportunityRow,
  type QuoteLiteRow,
  type RefOption,
  type SolutionLiteRow,
} from "./customerTypes"

// ---------------------------------------------------------------------------
// 数据请求（走 __pb 代理自定义路由）
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return pbJsonRequest<T>(path, init, { exposeHttpStatus: true })
}

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

// 轮次 F 轨 2：商机保存后 next_action + 预计成交日期齐备时自动登记待办（带商机深链元数据）。
// 同源去重：同一商机已存在「未完成 + 同内容」的待办则跳过；登记失败不阻塞商机保存主流程。
type TodoSourceRow = { id: string; done: boolean; content: string; due_date?: string; source_type?: string; source_id?: string }

async function registerNextActionTodo(
  userId: string,
  opp: { id: string; next_action?: string; expected_close_date?: string; next_follow_date?: string },
): Promise<void> {
  const content = (opp.next_action ?? "").trim()
  // 循环8 C5：due_date 优先用下次跟进时间，缺省回落预计成交时间。
  // 已知限制：商机改期不会同步更新已登记待办的 due_date（待办按 source_id+content 去重，不重复登记）。
  const dueDate = (opp.next_follow_date || opp.expected_close_date || "").slice(0, 10)
  if (!content || !dueDate) return
  try {
    // 轮次 3 B3：todos list 路由仅支持 rh_user_id 过滤（perPage 上限 200），
    // 带 perPage=200 拉全后在客户端按 source_id + done + content 二次去重，
    // 避免待办 >50 条时默认分页截断导致重复登记。
    const existing = await apiFetch<ListResponse<TodoSourceRow>>(
      `/api/todos?rh_user_id=${encodeURIComponent(userId)}&perPage=200`,
    )
    const dup = (existing.items ?? []).find(
      (t) => !t.done && t.source_type === "opportunity" && t.source_id === opp.id && t.content === content,
    )
    if (dup) {
      // 循环 9 B2：商机改期同步既有未完成待办 due_date（白名单已确认 PATCH 可改；best-effort，无变化不请求）
      if ((dup.due_date || "").slice(0, 10) !== dueDate) {
        try {
          await apiFetch(`/api/todos/${encodeURIComponent(dup.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ due_date: dueDate }),
          })
        } catch {
          /* 改期同步失败不阻塞商机保存 */
        }
      }
      return
    }
    await apiFetch("/api/todos", {
      method: "POST",
      body: JSON.stringify({
        rh_user_id: userId,
        content,
        done: false,
        due_date: dueDate,
        source_type: "opportunity",
        source_id: opp.id,
        link: `/customer-management?opp=${opp.id}`,
      }),
    })
    toast.info("已按「下一步动作 + 跟进/成交时间」登记待办，可在首页查看")
  } catch {
    /* 待办登记失败不打扰商机保存 */
  }
}

// A2-7 分页：照抄 intel-center 的 page/per_page/loadMore 模式，只调既有 REST list 参数
// 2026-10-08：20 → 200（客户 160 家要求「全量补全」必须整列表在内存里，分页 20 会让全量入口只处理当前页）
const CRM_PER_PAGE = 200
const REFS_PER_PAGE = 20
const RECORDS_PER_PAGE = 20
// A3：商机首屏/加载更多 perPage 提到 200（与全站 D3 治理口径一致），拉满设 capped 标志；
// 跟进首屏已按 200 拉取，拉满同样设标志供统计卡加「+」后缀
const OPPS_PER_PAGE = 200
const STATS_FOLLOWS_PER_PAGE = 200

function normalizeBidRow(b: BidProjectLinkRow): BidProjectLinkRow {
  return {
    ...b,
    project_name: b.project_name ?? "",
    hospital: b.hospital ?? "",
    stage: b.stage ?? "",
    opportunity_id: b.opportunity_id ?? "",
    bid_result: b.bid_result ?? "",
    bid_amount: typeof b.bid_amount === "number" && Number.isFinite(b.bid_amount) ? b.bid_amount : null,
    lost_reason: b.lost_reason ?? "",
    result_synced_at: b.result_synced_at ?? "",
    updated: b.updated ?? "",
  }
}

// 文案基表在 @/lib/llmError（全站唯一），此处只覆写客户管理侧专属措辞。
// 旧实现在未收录错误码时拼 `AI 调用失败：${error}`，会把内部码原样暴露给用户，
// 收敛后统一走中文兜底（用户可见文案禁止暴露内部字段名/错误码）。
const CUSTOMER_ERROR_ZH: Record<string, string> = {
  rh_login_required: "该操作当前不可用",
}

function mapLlmError(error?: string): string {
  return localizeLlmError(error, {
    generic: "AI 调用失败，请稍后重试",
    copy: CUSTOMER_ERROR_ZH,
  })
}

export interface OppDraft {
  opp_name: string
  stage: OppStage
  expected_amount: string
  expected_close_date: string
  next_follow_date: string
  next_action: string
  ref_key: string
  notes: string
}

const EMPTY_OPP_DRAFT: OppDraft = {
  opp_name: "",
  stage: "lead",
  expected_amount: "",
  expected_close_date: "",
  next_follow_date: "",
  next_action: "",
  ref_key: "",
  notes: "",
}

interface StageDialogState {
  opp: OpportunityRow
  target: OppStage
}

export function useCustomerManagement() {
  const costConfirm = useCostConfirm()

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [accountInfo, setAccountInfo] = useState<RhAccountInfo | null>(null)
  // 轮次 F：客户画像 / 客户跟进两技能 scope 接入（技能选择器源暴露给视图）
  const customerProfileSkills = useScopeSkills("customer-profile", userId ?? undefined)
  const customerFollowSkills = useScopeSkills("customer-follow", userId ?? undefined)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
  }, [])


  // ------------------------------ 模型选择 ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")

  const activeModelRef = useMemo(
    () => modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null,
    [modelOptions, selectedModelKey],
  )
  const costText = useMemo(() => costTextForModel(activeModelRef), [activeModelRef])

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

  const handleSelectModel = useCallback((key: string) => setSelectedModelKey(key), [])

  // ------------------------------ 数据加载 ------------------------------
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [allFollowRecords, setAllFollowRecords] = useState<FollowRecordRow[]>([])
  const [refOptions, setRefOptions] = useState<RefOption[]>([])
  const [bidProjects, setBidProjects] = useState<BidProjectLinkRow[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // A2-7 分页状态：page / 总数 / hasMore / loadingMore（客户、商机、关联选项三组）
  // D1：hook 模板 totalItems=页内条数不可信，total 改「可推断精确总数」语义：null=未知（末页拉满）
  const [customersPage, setCustomersPage] = useState(1)
  const [totalCustomers, setTotalCustomers] = useState<number | null>(0)
  const [customersHasMore, setCustomersHasMore] = useState(false)
  const [customersLoadingMore, setCustomersLoadingMore] = useState(false)
  const [oppsPage, setOppsPage] = useState(1)
  const [totalOpps, setTotalOpps] = useState<number | null>(0)
  const [oppsHasMore, setOppsHasMore] = useState(false)
  const [oppsLoadingMore, setOppsLoadingMore] = useState(false)
  // A3：capped=首屏拉满、统计可能少算（统计卡数字加「+」后缀提示）
  const [oppCapped, setOppCapped] = useState(false)
  const [followCapped, setFollowCapped] = useState(false)
  const [solsPage, setSolsPage] = useState(1)
  const [solsHasMore, setSolsHasMore] = useState(false)
  const [bidsPage, setBidsPage] = useState(1)
  const [bidsHasMore, setBidsHasMore] = useState(false)
  const [refsLoadingMore, setRefsLoadingMore] = useState(false)

  const loadAll = useCallback(async (uid: string) => {
    setDataLoading(true)
    try {
      const enc = encodeURIComponent(uid)
      const [cRes, oRes, fRes, sRes, bRes] = await Promise.all([
        apiFetch<ListResponse<CustomerRow>>(`/api/customers?rh_user_id=${enc}&page=1&perPage=${CRM_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<OpportunityRow>>(`/api/opportunities?rh_user_id=${enc}&page=1&perPage=${OPPS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<FollowRecordRow>>(`/api/follow_records?rh_user_id=${enc}&page=1&perPage=${STATS_FOLLOWS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<{ id: string; solution_name: string }>>(`/api/solutions?rh_user_id=${enc}&page=1&perPage=${REFS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<BidProjectLinkRow>>(`/api/bid_projects?rh_user_id=${enc}&page=1&perPage=${REFS_PER_PAGE}`).catch(() => null),
      ])
      // D1：hook 模板 totalItems=页内条数不可信；hasMore 改按「本页拉满」判定，total 仅在拉不满时可精确推断
      const cItems = cRes?.items ?? []
      const cTotal = cRes?.totalItems ?? 0
      setCustomers(cItems)
      setCustomersPage(1)
      // 本轮（B-03/B-04）：/api/customers 已改为返回真总数（大于本页条数即可采信）；
      // 后端未重启时 totalItems 仍等于本页条数，回退旧启发式：满页⇒null（总数未知），未满页⇒本页条数即总数。
      // 这样界面绝不会再把「本页 20 条」当成「客户总数 20」显示。
      setTotalCustomers(cTotal > cItems.length ? cTotal : cItems.length < CRM_PER_PAGE ? cItems.length : null)
      setCustomersHasMore(cItems.length >= CRM_PER_PAGE)
      const oItems = oRes?.items ?? []
      setOpportunities(oItems)
      setOppsPage(1)
      setTotalOpps(oItems.length >= OPPS_PER_PAGE ? null : oItems.length)
      setOppsHasMore(oItems.length >= OPPS_PER_PAGE)
      setOppCapped(oItems.length >= OPPS_PER_PAGE)
      const fItems = fRes?.items ?? []
      setAllFollowRecords(fItems)
      setFollowCapped(fItems.length >= STATS_FOLLOWS_PER_PAGE)
      const bidRows = (bRes?.items ?? []).map(normalizeBidRow)
      setBidProjects(bidRows)
      setBidsPage(1)
      setBidsHasMore(bidRows.length >= REFS_PER_PAGE)
      setSolsPage(1)
      setSolsHasMore((sRes?.items ?? []).length >= REFS_PER_PAGE)
      const refs: RefOption[] = [
        ...(sRes?.items ?? []).map((s) => ({ ref_type: "solution" as const, ref_id: s.id, ref_name: s.solution_name || "未命名方案" })),
        ...bidRows.map((b) => ({ ref_type: "bid" as const, ref_id: b.id, ref_name: b.project_name || "未命名标书项目" })),
      ]
      setRefOptions(refs)
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setCustomers([])
      setOpportunities([])
      setAllFollowRecords([])
      setRefOptions([])
      setBidProjects([])
      setCustomersPage(1)
      setTotalCustomers(0)
      setCustomersHasMore(false)
      setOppsPage(1)
      setTotalOpps(0)
      setOppsHasMore(false)
      setOppCapped(false)
      setFollowCapped(false)
      setSolsPage(1)
      setSolsHasMore(false)
      setBidsPage(1)
      setBidsHasMore(false)
      return
    }
    void loadAll(userId)
  }, [userId, loadAll])

  const loadMoreCustomers = useCallback(async () => {
    if (!userId || customersLoadingMore || !customersHasMore) return
    setCustomersLoadingMore(true)
    try {
      const targetPage = customersPage + 1
      const data = await apiFetch<ListResponse<CustomerRow>>(
        `/api/customers?rh_user_id=${encodeURIComponent(userId)}&page=${targetPage}&perPage=${CRM_PER_PAGE}`,
      )
      const newItems = data.items ?? []
      setCustomers((prev) => [...prev, ...newItems])
      setCustomersPage(targetPage)
      // D1：本页拉满则总数不可知（null），拉不满时精确总数 = 前面整页 + 本页条数
      // 本轮（B-03/B-04）：后端已返回真总数，优先采信；否则回退上述旧启发式
      const mTotal = data.totalItems ?? 0
      setTotalCustomers(
        mTotal > newItems.length
          ? mTotal
          : newItems.length >= CRM_PER_PAGE
            ? null
            : (targetPage - 1) * CRM_PER_PAGE + newItems.length,
      )
      setCustomersHasMore(newItems.length >= CRM_PER_PAGE)
    } catch {
      toast.error("加载更多客户失败，请稍后重试")
    } finally {
      setCustomersLoadingMore(false)
    }
  }, [userId, customersPage, customersLoadingMore, customersHasMore])

  const loadMoreOpportunities = useCallback(async () => {
    if (!userId || oppsLoadingMore || !oppsHasMore) return
    setOppsLoadingMore(true)
    try {
      const targetPage = oppsPage + 1
      const data = await apiFetch<ListResponse<OpportunityRow>>(
        `/api/opportunities?rh_user_id=${encodeURIComponent(userId)}&page=${targetPage}&perPage=${OPPS_PER_PAGE}`,
      )
      const newItems = data.items ?? []
      setOpportunities((prev) => [...prev, ...newItems])
      setOppsPage(targetPage)
      setTotalOpps(newItems.length >= OPPS_PER_PAGE ? null : (targetPage - 1) * OPPS_PER_PAGE + newItems.length)
      setOppsHasMore(newItems.length >= OPPS_PER_PAGE)
      setOppCapped(newItems.length >= OPPS_PER_PAGE)
    } catch {
      toast.error("加载更多商机失败，请稍后重试")
    } finally {
      setOppsLoadingMore(false)
    }
  }, [userId, oppsPage, oppsLoadingMore, oppsHasMore])

  const refsHasMore = solsHasMore || bidsHasMore

  const loadMoreRefs = useCallback(async () => {
    if (!userId || refsLoadingMore || !refsHasMore) return
    setRefsLoadingMore(true)
    try {
      const enc = encodeURIComponent(userId)
      const [sRes, bRes] = await Promise.all([
        solsHasMore
          ? apiFetch<ListResponse<{ id: string; solution_name: string }>>(
              `/api/solutions?rh_user_id=${enc}&page=${solsPage + 1}&perPage=${REFS_PER_PAGE}`,
            ).catch(() => null)
          : Promise.resolve(null),
        bidsHasMore
          ? apiFetch<ListResponse<BidProjectLinkRow>>(
              `/api/bid_projects?rh_user_id=${enc}&page=${bidsPage + 1}&perPage=${REFS_PER_PAGE}`,
            ).catch(() => null)
          : Promise.resolve(null),
      ])
      if (sRes) {
        const targetPage = solsPage + 1
        const newRefs: RefOption[] = (sRes.items ?? []).map((s) => ({
          ref_type: "solution" as const,
          ref_id: s.id,
          ref_name: s.solution_name || "未命名方案",
        }))
        setRefOptions((prev) => [...prev, ...newRefs])
        setSolsPage(targetPage)
        setSolsHasMore((sRes.items ?? []).length >= REFS_PER_PAGE)
      }
      if (bRes) {
        const targetPage = bidsPage + 1
        const bidRows = (bRes.items ?? []).map(normalizeBidRow)
        setBidProjects((prev) => [...prev, ...bidRows])
        setRefOptions((prev) => [
          ...prev,
          ...bidRows.map((b) => ({
            ref_type: "bid" as const,
            ref_id: b.id,
            ref_name: b.project_name || "未命名标书项目",
          })),
        ])
        setBidsPage(targetPage)
        setBidsHasMore(bidRows.length >= REFS_PER_PAGE)
      }
    } catch {
      toast.error("加载更多关联选项失败，请稍后重试")
    } finally {
      setRefsLoadingMore(false)
    }
  }, [userId, refsLoadingMore, refsHasMore, solsHasMore, bidsHasMore, solsPage, bidsPage])

  // ------------------------------ 视图与筛选 ------------------------------
  const [view, setView] = useState<"list" | "board">("list")
  const [searchText, setSearchText] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [regionFilter, setRegionFilter] = useState("")
  const [sortBy, setSortBy] = useState<"updated" | "name">("updated")

  // 轮次 F 轨 1：searchText 走服务端 q= 模糊检索（全量客户，不受已加载分页限制）；
  // serverSearchRows=null 表示无检索 / 请求失败 → 回退本地 includes 兜底
  const [serverSearchRows, setServerSearchRows] = useState<CustomerRow[] | null>(null)
  const searchSeqRef = useRef(0)

  useEffect(() => {
    const kw = searchText.trim()
    searchSeqRef.current += 1
    const seq = searchSeqRef.current
    if (!kw || !userId) {
      setServerSearchRows(null)
      return
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await apiFetch<ListResponse<CustomerRow>>(
            `/api/customers?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=200&q=${encodeURIComponent(kw)}`,
          )
          if (seq !== searchSeqRef.current) return
          setServerSearchRows(data.items ?? [])
        } catch {
          if (seq !== searchSeqRef.current) return
          setServerSearchRows(null)
        }
      })()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchText, userId])

  const regionOptions = useMemo(() => {
    // R57/F13：筛选项走省级归一（「安徽省合肥市」→「安徽」），非地区值（「部门」）不进选项
    const set = new Set<string>()
    for (const c of customers) {
      const r = normalizeRegion(c.region)
      if (r) set.add(r)
    }
    return Array.from(set).sort()
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    // 服务端 q= 结果优先；未返回或请求失败（serverSearchRows=null）时本地 includes 兜底
    const base = kw
      ? (serverSearchRows ??
        customers.filter(
          (c) => c.hospital_name.toLowerCase().includes(kw) || (c.region ?? "").toLowerCase().includes(kw),
        ))
      : customers
    let list = base.filter((c) => {
      if (typeFilter && c.hospital_type !== typeFilter) return false
      if (regionFilter && normalizeRegion(c.region) !== regionFilter) return false
      return true
    })
    list = [...list].sort((a, b) =>
      sortBy === "name"
        ? a.hospital_name.localeCompare(b.hospital_name, "zh-CN")
        : (b.updated ?? "").localeCompare(a.updated ?? ""),
    )
    return list
  }, [customers, serverSearchRows, searchText, typeFilter, regionFilter, sortBy])

  const oppCountByCustomer = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of opportunities) {
      if (isTerminalStage(o.stage)) continue
      map[o.customer_id] = (map[o.customer_id] ?? 0) + 1
    }
    return map
  }, [opportunities])

  // ------------------------------ 选中态 ------------------------------
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null)
  const [followRecords, setFollowRecords] = useState<FollowRecordRow[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  // A2-7 客户维度跟进记录分页（D1：totalRecords null=总数未知，末页拉满）
  const [recordsPage, setRecordsPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState<number | null>(0)
  const [recordsHasMore, setRecordsHasMore] = useState(false)
  const [recordsLoadingMore, setRecordsLoadingMore] = useState(false)

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  )
  const selectedOpportunity = useMemo(
    () => opportunities.find((o) => o.id === selectedOpportunityId) ?? null,
    [opportunities, selectedOpportunityId],
  )
  const customerOpps = useMemo(
    () => opportunities.filter((o) => o.customer_id === selectedCustomerId),
    [opportunities, selectedCustomerId],
  )
  const oppRecords = useMemo(
    () => (selectedOpportunity ? followRecords.filter((r) => r.opportunity_id === selectedOpportunity.id) : []),
    [followRecords, selectedOpportunity],
  )

  // ------------------------------ 关联投标 + 全链路资产（第二轮改造，只读承接） ------------------------------
  /** 当前选中商机关联的投标项目（按 bid_projects.opportunity_id 匹配） */
  const linkedBids = useMemo(
    () => (selectedOpportunity ? bidProjects.filter((b) => b.opportunity_id === selectedOpportunity.id) : []),
    [bidProjects, selectedOpportunity],
  )

  const [chainSolutions, setChainSolutions] = useState<SolutionLiteRow[]>([])
  const [chainQuotes, setChainQuotes] = useState<QuoteLiteRow[]>([])
  const [chainLoading, setChainLoading] = useState(false)

  // 进入客户详情时按需拉取方案/报价列表（bid_projects 已随首屏加载），不新增常驻请求
  useEffect(() => {
    if (!selectedCustomerId || !userId) {
      setChainSolutions([])
      setChainQuotes([])
      return
    }
    let cancelled = false
    const enc = encodeURIComponent(userId)
    setChainLoading(true)
    Promise.all([
      apiFetch<ListResponse<SolutionLiteRow>>(`/api/solutions?rh_user_id=${enc}&page=1&perPage=100`).catch(() => null),
      apiFetch<ListResponse<QuoteLiteRow>>(`/api/quotes?rh_user_id=${enc}&page=1&perPage=100`).catch(() => null),
    ])
      .then(([sRes, qRes]) => {
        if (cancelled) return
        setChainSolutions(sRes?.items ?? [])
        setChainQuotes(qRes?.items ?? [])
      })
      .finally(() => {
        if (!cancelled) setChainLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedCustomerId, userId])

  const chainAssets = useMemo<ChainAssetItem[]>(() => {
    if (!selectedCustomer) return []
    const hosp = (selectedCustomer.hospital_name ?? "").trim()
    const fuzzy = (a: string, b: string) => Boolean(a && b && (a.includes(b) || b.includes(a)))
    const items: ChainAssetItem[] = []
    const customerOppIds = new Set(opportunities.filter((o) => o.customer_id === selectedCustomer.id).map((o) => o.id))
    const docStatusLabel: Record<string, string> = { outline: "大纲中", generating: "生成中", partial: "部分成稿", done: "已完成" }
    for (const b of bidProjects) {
      const viaHospital = fuzzy(b.hospital, hosp)
      const viaOpp = Boolean(b.opportunity_id) && customerOppIds.has(b.opportunity_id)
      if (!viaHospital && !viaOpp) continue
      const statusLabel =
        b.bid_result === "won" || b.bid_result === "lost" || b.bid_result === "pending"
          ? bidResultLabel(b.bid_result)
          : BID_STAGE_LABEL[b.stage] ?? b.stage
      items.push({
        kind: "bid",
        id: b.id,
        name: b.project_name || "未命名投标项目",
        statusLabel,
        updated: b.updated,
        route: `/bid-workspace?project=${b.id}`,
      })
    }
    for (const s of chainSolutions) {
      if (!fuzzy(s.hospital, hosp)) continue
      items.push({
        kind: "solution",
        id: s.id,
        name: s.solution_name || "未命名方案",
        statusLabel: docStatusLabel[s.doc_status] ?? "",
        updated: s.updated,
        route: "/solution-studio",
      })
    }
    for (const q of chainQuotes) {
      if (!fuzzy(q.ref_name, hosp)) continue
      items.push({
        kind: "quote",
        id: q.id,
        name: q.quote_name || "未命名报价",
        statusLabel: q.ref_name ? `关联 ${q.ref_name}` : "",
        updated: q.updated,
        route: "/ppt-quote",
      })
    }
    return items.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
  }, [selectedCustomer, opportunities, bidProjects, chainSolutions, chainQuotes])

  const loadFollowRecords = useCallback(
    async (customerId: string) => {
      if (!userId) return
      setRecordsLoading(true)
      try {
        const data = await apiFetch<ListResponse<FollowRecordRow>>(
          `/api/follow_records?rh_user_id=${encodeURIComponent(userId)}&customer_id=${encodeURIComponent(customerId)}&page=1&perPage=${RECORDS_PER_PAGE}`,
        )
        const items = data.items ?? []
        setFollowRecords(items)
        setRecordsPage(1)
        setTotalRecords(items.length >= RECORDS_PER_PAGE ? null : items.length)
        setRecordsHasMore(items.length >= RECORDS_PER_PAGE)
      } catch {
        toast.error("跟进记录加载失败，请稍后重试")
      } finally {
        setRecordsLoading(false)
      }
    },
    [userId],
  )

  const loadMoreFollowRecords = useCallback(async () => {
    if (!userId || !selectedCustomerId || recordsLoadingMore || !recordsHasMore) return
    setRecordsLoadingMore(true)
    try {
      const targetPage = recordsPage + 1
      const data = await apiFetch<ListResponse<FollowRecordRow>>(
        `/api/follow_records?rh_user_id=${encodeURIComponent(userId)}&customer_id=${encodeURIComponent(selectedCustomerId)}&page=${targetPage}&perPage=${RECORDS_PER_PAGE}`,
      )
      const newItems = data.items ?? []
      setFollowRecords((prev) => [...prev, ...newItems])
      setRecordsPage(targetPage)
      setTotalRecords(newItems.length >= RECORDS_PER_PAGE ? null : (targetPage - 1) * RECORDS_PER_PAGE + newItems.length)
      setRecordsHasMore(newItems.length >= RECORDS_PER_PAGE)
    } catch {
      toast.error("加载更多跟进记录失败，请稍后重试")
    } finally {
      setRecordsLoadingMore(false)
    }
  }, [userId, selectedCustomerId, recordsPage, recordsLoadingMore, recordsHasMore])

  const selectCustomer = useCallback(
    (customerId: string | null) => {
      setSelectedCustomerId(customerId)
      setSelectedOpportunityId(null)
      setFollowRecords([])
      setRecordsPage(1)
      setTotalRecords(0)
      setRecordsHasMore(false)
      setAiSuggestions([])
      if (customerId) void loadFollowRecords(customerId)
    },
    [loadFollowRecords],
  )

  const selectOpportunity = useCallback((oppId: string) => {
    setSelectedOpportunityId(oppId)
    setAiSuggestions([])
  }, [])

  const closeOpportunity = useCallback(() => {
    setSelectedOpportunityId(null)
    setAiSuggestions([])
  }, [])

  const openOpportunityFromBoard = useCallback(
    (opp: OpportunityRow) => {
      setView("list")
      setSelectedCustomerId(opp.customer_id)
      setSelectedOpportunityId(opp.id)
      setFollowRecords([])
      setRecordsPage(1)
      setTotalRecords(0)
      setRecordsHasMore(false)
      void loadFollowRecords(opp.customer_id)
    },
    [loadFollowRecords],
  )

  // 轮次 B + D2：全局搜索/活动流深链 ?customer= / ?opp= 消费（ref 存「已消费 id」，URL id 变化即重新消费）
  const [searchParams] = useSearchParams()
  const customerDeepLinkIdRef = useRef<string | null>(null)
  const oppDeepLinkIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userId || dataLoading) return
    const oppId = searchParams.get("opp")
    if (oppId && oppDeepLinkIdRef.current !== oppId) {
      oppDeepLinkIdRef.current = oppId
      const target = opportunities.find((o) => o.id === oppId)
      if (target) {
        openOpportunityFromBoard(target)
      } else {
        void apiFetch<OpportunityRow>(`/api/opportunities/${encodeURIComponent(oppId)}`)
          .then((rec) => {
            if (rec?.id) openOpportunityFromBoard(rec)
            else toast.error("未找到对应商机")
          })
          .catch(() => toast.error("未找到对应商机"))
      }
      return
    }
    const custId = searchParams.get("customer")
    if (custId && customerDeepLinkIdRef.current !== custId) {
      customerDeepLinkIdRef.current = custId
      if (customers.some((c) => c.id === custId)) {
        selectCustomer(custId)
      } else {
        void apiFetch<CustomerRow>(`/api/customers/${encodeURIComponent(custId)}`)
          .then((rec) => {
            if (!rec?.id) {
              toast.error("未找到对应客户")
              return
            }
            setCustomers((prev) => (prev.some((c) => c.id === rec.id) ? prev : [rec, ...prev]))
            selectCustomer(rec.id)
          })
          .catch(() => toast.error("未找到对应客户"))
      }
    }
  }, [userId, dataLoading, searchParams, opportunities, customers, openOpportunityFromBoard, selectCustomer])

  const closeDetail = useCallback(() => {
    setSelectedCustomerId(null)
    setSelectedOpportunityId(null)
    setFollowRecords([])
    setRecordsPage(1)
    setTotalRecords(0)
    setRecordsHasMore(false)
    setAiSuggestions([])
  }, [])

  // ------------------------------ 统计 ------------------------------
  const stats = useMemo(() => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthIso = monthStart.toISOString()
    return {
      customerCount: totalCustomers ?? customers.length,
      // 本轮（B-03）：totalCustomers=null 表示总数不可知（本页已拉满且后端未给真总数），
      // 此时统计卡数字需加「+」后缀，避免把已加载条数读成精确总数
      customerCountCapped: totalCustomers === null,
      activeOppCount: opportunities.filter((o) => !isTerminalStage(o.stage)).length,
      monthFollowCount: allFollowRecords.filter((r) => (r.created ?? "") >= monthIso).length,
    }
  }, [totalCustomers, customers, opportunities, allFollowRecords])

  // ------------------------------ 客户表单 + AI 档案 ------------------------------
  const [customerFormOpen, setCustomerFormOpen] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT)
  const [customerAiFields, setCustomerAiFields] = useState<string[]>([])
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [aiMatching, setAiMatching] = useState(false)
  const [extractText, setExtractText] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [fetchingSite, setFetchingSite] = useState(false)
  // 微信/公众号文章链接兜底：粘贴具体文章直链→direct 直取正文→抽取回填当前表单
  const [articleUrl, setArticleUrl] = useState("")
  // 批量补全：对列表中已存在的客户，抓官网→抽取→仅回填当前为空的字段→写库
  const [batchEnriching, setBatchEnriching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const batchCancelRef = useRef(false)
  const [enrichingOneId, setEnrichingOneId] = useState<string | null>(null)

  const requireLogin = useCallback((): boolean => {
    if (!userId) {
      toast.error("该操作当前不可用")
      return false
    }
    return true
  }, [userId])

  const openNewCustomer = useCallback(() => {
    if (!requireLogin()) return
    setEditingCustomerId(null)
    setCustomerDraft(EMPTY_CUSTOMER_DRAFT)
    setCustomerAiFields([])
    setExtractText("")
    setCustomerFormOpen(true)
  }, [requireLogin])

  const openEditCustomer = useCallback((row: CustomerRow) => {
    setEditingCustomerId(row.id)
    setCustomerDraft(rowToDraft(row))
    setCustomerAiFields(row.ai_generated_fields ?? [])
    setExtractText("")
    setCustomerFormOpen(true)
  }, [])

  const closeCustomerForm = useCallback(() => setCustomerFormOpen(false), [])

  const setDraftField = useCallback(<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => {
    setCustomerDraft((prev) => ({ ...prev, [key]: value }))
    // 人工修改后清除该字段的「AI 提供需核实」标记
    const aiKey = key === "key_departments_text" ? "key_departments" : String(key)
    setCustomerAiFields((prev) => (prev.includes(aiKey) ? prev.filter((f) => f !== aiKey) : prev))
  }, [])

  const applyProfileToDraft = useCallback((result: AiProfileResult, hospitalName?: string) => {
    const marked: string[] = []
    setCustomerDraft((prev) => {
      const next: CustomerDraft = { ...prev }
      const asRec = next as unknown as Record<string, unknown>
      if (hospitalName && !next.hospital_name.trim()) next.hospital_name = hospitalName
      const putStr = (field: keyof CustomerDraft, value: string | null) => {
        if (value === null) return
        asRec[field] = value
        marked.push(String(field))
      }
      const putNum = (field: keyof CustomerDraft, value: number | null) => {
        if (value === null) return
        asRec[field] = String(value)
        marked.push(String(field))
      }
      putStr("level", result.level)
      if (result.hospital_type) {
        next.hospital_type = result.hospital_type
        marked.push("hospital_type")
      }
      putStr("region", result.region)
      putStr("address", result.address)
      putStr("website", result.website)
      putNum("outpatient_daily", result.outpatient_daily)
      putNum("outpatient_yearly", result.outpatient_yearly)
      putNum("beds_total", result.beds_total)
      putNum("beds_icu", result.beds_icu)
      putNum("beds_or", result.beds_or)
      putNum("annual_revenue", result.annual_revenue)
      putStr("president", result.president)
      putStr("party_secretary", result.party_secretary)
      putStr("it_lead", result.it_lead)
      if (result.key_departments) {
        next.key_departments_text = result.key_departments.join("、")
        marked.push("key_departments")
      }
      if (result.leadership && result.leadership.length) {
        next.leadership = result.leadership.map((m) => ({ name: m.name, title: m.title, role: m.role }))
        marked.push("leadership")
      }
      return next
    })
    setCustomerAiFields((prev) => Array.from(new Set([...prev, ...marked])))
  }, [])

  const handleLlmResult = useCallback(
    (res: { ok: boolean; text: string; error?: string; needsLogin?: boolean }): boolean => {
      if (res.needsLogin || res.error === "rh_login_required") {
          toast.error(mapLlmError("rh_login_required"))
        return false
      }
      if (!res.ok) {
        toast.error(mapLlmError(res.error))
        return false
      }
      return true
    },
    [],
  )

  const doAiMatch = useCallback(async () => {
    const hospitalName = customerDraft.hospital_name.trim()
    if (!hospitalName) {
      toast.error("请先输入医院名称再使用 AI 匹配")
      return
    }
    setAiMatching(true)
    try {
      const res = await chatViaGateway({
        modelRef: activeModelRef,
        messages: injectSkillBlock(buildProfileMessages(hospitalName), skillBlockFor("customer-profile")),
        max_tokens: 2000,
        page: "customer-management",
      })
      if (!handleLlmResult(res)) return
      const parsed = parseProfileJson(res.text)
      if (!parsed) {
        toast.error("AI 返回内容无法解析，请重试或手动填写档案")
        return
      }
      applyProfileToDraft(parsed, hospitalName)
      toast.success("档案初稿已生成，请逐项核实标有「AI 提供」的字段")
    } catch {
      toast.error("网络异常，AI 匹配失败，请稍后重试")
    } finally {
      setAiMatching(false)
    }
  }, [customerDraft.hospital_name, activeModelRef, handleLlmResult, applyProfileToDraft])

  const runAiMatch = useCallback(() => {
    if (!requireLogin()) return
    if (!customerDraft.hospital_name.trim()) {
      toast.error("请先输入医院名称再使用 AI 匹配")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void doAiMatch()
    }, costText)
  }, [requireLogin, customerDraft.hospital_name, costConfirm, costText, doAiMatch])

  // 共享：把一段医院介绍正文交给大模型抽取并回填表单
  // （「粘贴文本提取」与「抓取官网补全」两条入口复用同一抽取管线）
  const extractFromText = useCallback(async (text: string) => {
    setExtracting(true)
    try {
      const res = await chatViaGateway({
        modelRef: activeModelRef,
        messages: injectSkillBlock(buildExtractMessages(text), skillBlockFor("customer-profile")),
        max_tokens: 2000,
        page: "customer-management",
      })
      if (!handleLlmResult(res)) return false
      const parsed = parseProfileJson(res.text)
      if (!parsed) {
        toast.error("未能从文本中提取出医院信息，请检查内容")
        return false
      }
      applyProfileToDraft(parsed)
      toast.success("字段已提取进表单，请逐项核实标有「AI 提供」的字段")
      return true
    } catch {
      toast.error("网络异常，文本提取失败，请稍后重试")
      return false
    } finally {
      setExtracting(false)
    }
  }, [activeModelRef, handleLlmResult, applyProfileToDraft])

  const doExtract = useCallback(() => {
    void extractFromText(extractText)
  }, [extractText, extractFromText])

  // 抓取医院官网正文 → 填入文本框（透明可编辑）→ 复用抽取管线回填
  const doFetchSite = useCallback(async () => {
    const name = customerDraft.hospital_name.trim()
    setFetchingSite(true)
    try {
      const r = await apiFetch<{ ok: boolean; url?: string; introUrl?: string; text?: string; message?: string }>(
        "/api/customers/fetch-site",
        { method: "POST", body: JSON.stringify({ name, website: customerDraft.website.trim() }) },
      )
      if (!r.ok || !r.text) {
        toast.error(r.message || "抓取官网失败，可改用「AI 匹配」或粘贴官网简介文本")
        return
      }
      if (!customerDraft.website.trim() && r.url) setDraftField("website", r.url)
      setExtractText(r.text)
      await extractFromText(r.text)
    } catch {
      toast.error("网络异常，抓取官网失败，请稍后重试")
    } finally {
      setFetchingSite(false)
    }
  }, [customerDraft.hospital_name, customerDraft.website, extractFromText, setDraftField])

  // ---------------- 2026-10-07 用户需求：官网/政府网站商机线索（fetch-site leads） ----------------
  const [siteLeads, setSiteLeads] = useState<{ customerId: string; leads: CustomerLead[] } | null>(null)
  const [leadSavingKey, setLeadSavingKey] = useState("")

  /** 把一条商机线索建为商机（stage=lead 线索），notes 带来源链接，便于回溯核实 */
  const convertLeadToOpportunity = useCallback(
    async (customer: CustomerRow, lead: CustomerLead) => {
      const key = `${customer.id}:${lead.url}`
      setLeadSavingKey(key)
      try {
        const rec = await apiFetch<OpportunityRow>("/api/opportunities", {
          method: "POST",
          body: JSON.stringify({
            customer_id: customer.id,
            customer_name: customer.hospital_name,
            opp_name: lead.title.slice(0, 120),
            stage: "lead",
            next_action: "核实线索真伪与预算口径，确认跟进人",
            notes: `来源：${lead.src}
${lead.url}`,
          }),
        })
        setOpportunities((prev) => (prev.some((o) => o.id === rec.id) ? prev : [rec, ...prev]))
        toast.success(`已建为线索商机：${lead.title.slice(0, 30)}`)
      } catch {
        toast.error("转商机失败，请稍后重试")
      } finally {
        setLeadSavingKey("")
      }
    },
    [],
  )

  const runFetchSite = useCallback(() => {
    if (!requireLogin()) return
    if (!customerDraft.hospital_name.trim()) {
      toast.error("请先填写医院名称")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void doFetchSite()
    }, costText)
  }, [requireLogin, customerDraft.hospital_name, costConfirm, costText, doFetchSite])

  const runExtract = useCallback(() => {
    if (!requireLogin()) return
    if (extractText.trim().length < 10) {
      toast.error("请先粘贴一段医院介绍文字（至少 10 个字）")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void doExtract()
    }, costText)
  }, [requireLogin, extractText, costConfirm, costText, doExtract])

  // 低层：调用后端 fetch-site 抓正文。direct=true 时把 website 当作文章直链直接取正文（微信/公众号兜底）
  // 返回正文已合并后端回传的 GBK 字节段（前端 TextDecoder 解码），并透传 sources 供 UI 展示来源。
  const fetchSiteText = useCallback(async (
    name: string,
    website: string,
    direct: boolean,
  ): Promise<{ ok: boolean; url?: string; text?: string; message?: string; sources?: string[]; leads?: CustomerLead[] }> => {
    try {
      const r = await apiFetch<{
        ok: boolean; url?: string; text?: string; message?: string; sources?: string[]; binSections?: BinSection[]; leads?: CustomerLead[]
      }>("/api/customers/fetch-site", { method: "POST", body: JSON.stringify({ name, website, direct }) })
      if (r.ok) r.text = decodeBinSections(r.text || "", r.binSections)
      return { ok: r.ok, url: r.url, text: r.text, message: r.message, sources: r.sources, leads: Array.isArray(r.leads) ? r.leads : [] }
    } catch {
      return { ok: false, message: "网络异常，抓取失败" }
    }
  }, [])

  // 低层：把正文交给大模型抽取为档案（不回填表单，供批量补全直接写库用）
  const extractProfileFromText = useCallback(async (text: string): Promise<AiProfileResult | null> => {
    const res = await chatViaGateway({
      modelRef: activeModelRef,
      messages: injectSkillBlock(buildExtractMessages(text), skillBlockFor("customer-profile")),
      max_tokens: 2000,
      page: "customer-management",
    })
    if (!res.ok) return null
    return parseProfileJson(res.text)
  }, [activeModelRef])

  // 表单内：粘贴公众号/文章链接 → direct 直取正文 → 复用抽取管线回填当前表单
  const runFetchUrl = useCallback(() => {
    if (!requireLogin()) return
    const u = articleUrl.trim()
    if (!/^https?:\/\//i.test(u)) {
      toast.error("请粘贴完整文章链接（http/https 开头，如公众号推文）")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void (async () => {
        setFetchingSite(true)
        try {
          const r = await fetchSiteText(customerDraft.hospital_name.trim(), u, true)
          if (!r.ok || !r.text) {
            toast.error(r.message || "链接抓取失败（微信文章可能有防盗链/需登录，可在浏览器打开后复制正文用「粘贴文本提取」）")
            return
          }
          setExtractText(r.text)
          await extractFromText(r.text)
        } finally {
          setFetchingSite(false)
        }
      })()
    }, costText)
  }, [requireLogin, articleUrl, costConfirm, costText, customerDraft.hospital_name, fetchSiteText, extractFromText])

  // 批量补全单个客户：抓官网→抽取→仅回填当前为空的字段→PATCH 写库；返回本次实际补上的字段数
  const enrichCustomerRow = useCallback(async (row: CustomerRow): Promise<{ filled: number; note: string; sources?: string[] }> => {
    const fetched = await fetchSiteText(row.hospital_name, row.website, false)
    // 2026-10-07 用户需求：抓官网时同步的「信息化商机线索」落到详情面板（官网公告/招标栏目 + 政府网站检索）
    if (fetched.ok && fetched.leads?.length) {
      setSiteLeads({ customerId: row.id, leads: fetched.leads })
    } else if (fetched.ok) {
      setSiteLeads({ customerId: row.id, leads: [] })
    }
    if (!fetched.ok || !fetched.text) return { filled: 0, note: fetched.message || "官网抓取失败", sources: fetched.sources }
    const profile = await extractProfileFromText(fetched.text)
    if (!profile) return { filled: 0, note: "正文未能抽取到可核实字段", sources: fetched.sources }

    const derived = deriveFlatFromLeadership(profile.leadership)
    const patch: Record<string, unknown> = {}
    const marks = new Set<string>(row.ai_generated_fields ?? [])
    const putStr = (key: string, val: string | null, cur: string) => {
      if (val != null && val !== "" && !cur.trim()) { patch[key] = val; marks.add(key) }
    }
    const putNum = (key: string, val: number | null, cur: number) => {
      if (val != null && !(typeof cur === "number" && cur > 0)) { patch[key] = val; marks.add(key) }
    }
    putStr("level", profile.level, row.level)
    putStr("hospital_type", profile.hospital_type, row.hospital_type)
    putStr("region", profile.region, row.region)
    putStr("address", profile.address, row.address)
    putStr("website", profile.website || fetched.url || null, row.website)
    putNum("outpatient_daily", profile.outpatient_daily, row.outpatient_daily)
    putNum("outpatient_yearly", profile.outpatient_yearly, row.outpatient_yearly)
    putNum("beds_total", profile.beds_total, row.beds_total)
    putNum("beds_icu", profile.beds_icu, row.beds_icu)
    putNum("beds_or", profile.beds_or, row.beds_or)
    putNum("annual_revenue", profile.annual_revenue, row.annual_revenue)
    putStr("president", profile.president || derived.president, row.president)
    putStr("party_secretary", profile.party_secretary || derived.party_secretary, row.party_secretary)
    putStr("it_lead", profile.it_lead, row.it_lead)
    if (profile.key_departments && profile.key_departments.length && !(row.key_departments?.length)) {
      patch.key_departments = profile.key_departments
      marks.add("key_departments")
    }
    if (profile.leadership && profile.leadership.length && !toLeadership(row.leadership).length) {
      patch.leadership = profile.leadership
      marks.add("leadership")
    }

    const filled = Object.keys(patch).filter((k) => k !== "ai_generated_fields").length
    if (filled === 0) return { filled: 0, note: "无新增可填字段（已有信息保持不变）", sources: fetched.sources }
    patch.ai_generated_fields = Array.from(marks)
    const updated = await apiFetch<CustomerRow>(`/api/customers/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    return { filled, note: `补全 ${filled} 项`, sources: fetched.sources }
  }, [fetchSiteText, extractProfileFromText])

  // 批量补全入口：默认先处理前 limit 家（缺省全部）；串行、可中途取消；只填空字段、已核实字段不覆盖
  const runBatchEnrich = useCallback(async (limit?: number) => {
    if (!requireLogin()) return
    if (!activeModelRef) {
      toast.error("请先在上方选择用于抽取的模型")
      return
    }
    const withName = customers.filter((c) => c.hospital_name.trim())
    // 优先处理“缺得最多”的客户（而非列表前 N 家），让批量补全把力气花在刀刃上
    const targets = [...withName].sort((a, b) => computeMissingFields(b).length - computeMissingFields(a).length)
    const slice = limit && limit > 0 ? targets.slice(0, limit) : targets
    if (!slice.length) {
      toast.error("列表里还没有可补全的客户")
      return
    }
    batchCancelRef.current = false
    setBatchEnriching(true)
    setBatchProgress({ done: 0, total: slice.length })
    let totalFilled = 0
    try {
      for (let i = 0; i < slice.length; i++) {
        if (batchCancelRef.current) break
        const row = slice[i]
        try {
          const r = await enrichCustomerRow(row)
          totalFilled += r.filled
        } catch {
          /* 单家失败不阻塞批量，继续下一家 */
        }
        setBatchProgress({ done: i + 1, total: slice.length })
      }
      if (batchCancelRef.current) toast.info(`批量补全已停止，共补上 ${totalFilled} 个字段`)
      else toast.success(`批量补全完成，共补上 ${totalFilled} 个字段（均标记「AI 提供需核实」，请逐项核对）`)
    } finally {
      setBatchEnriching(false)
    }
  }, [requireLogin, activeModelRef, customers, enrichCustomerRow])

  const cancelBatchEnrich = useCallback(() => {
    batchCancelRef.current = true
  }, [])

  // 单家定向补全：只处理选中的这一家（抓官网→抽取→仅填空字段→写库），复用批量补全同一管线
  const enrichOneCustomer = useCallback((customerId: string) => {
    if (!requireLogin()) return
    if (!activeModelRef) {
      toast.error("请先在上方选择用于抽取的模型")
      return
    }
    const row = customers.find((c) => c.id === customerId)
    if (!row) {
      toast.error("未找到该客户")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void (async () => {
        setEnrichingOneId(customerId)
        try {
          const r = await enrichCustomerRow(row)
          if (r.filled > 0) {
            const src = r.sources && r.sources.length ? `（来源：${r.sources.join("、")}）` : ""
            toast.success(`已为「${row.hospital_name}」补全 ${r.filled} 项${src}，均标记「AI 提供需核实」，请逐项核对`)
          } else {
            toast.info(r.note)
          }
        } catch {
          toast.error("补全失败，请稍后重试")
        } finally {
          setEnrichingOneId(null)
        }
      })()
    }, costText)
  }, [requireLogin, activeModelRef, customers, costConfirm, costText, enrichCustomerRow])

  const saveCustomer = useCallback(async () => {
    if (!userId) return
    const hospitalName = customerDraft.hospital_name.trim()
    if (!hospitalName) {
      toast.error("请填写医院名称")
      return
    }
    setSavingCustomer(true)
    try {
      const body: Record<string, unknown> = {
        hospital_name: hospitalName,
        hospital_type: customerDraft.hospital_type,
        level: customerDraft.level.trim(),
        region: customerDraft.region.trim(),
        address: customerDraft.address.trim(),
        website: customerDraft.website.trim(),
        key_departments: splitDepartmentList(customerDraft.key_departments_text),
        notes: customerDraft.notes.trim(),
        president: customerDraft.president.trim(),
        party_secretary: customerDraft.party_secretary.trim(),
        it_lead: customerDraft.it_lead.trim(),
        leadership: toLeadership(customerDraft.leadership),
        ai_generated_fields: customerAiFields,
      }
      for (const key of DRAFT_NUMBER_KEYS) body[key] = toNumberOrNull(customerDraft[key])
      let record: CustomerRow
      if (editingCustomerId) {
        record = await apiFetch<CustomerRow>(`/api/customers/${editingCustomerId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        setCustomers((prev) => prev.map((c) => (c.id === record.id ? record : c)))
        toast.success("客户档案已更新")
      } else {
        record = await apiFetch<CustomerRow>("/api/customers", {
          method: "POST",
          body: JSON.stringify({ ...body, rh_user_id: userId, contacts: [] as ContactInfo[], last_follow_at: "" }),
        })
        setCustomers((prev) => [record, ...prev])
        setTotalCustomers((t) => (t == null ? null : t + 1))
        toast.success("客户已创建")
      }
      setCustomerFormOpen(false)
      selectCustomer(record.id)
    } catch {
      toast.error("客户保存失败，请稍后重试")
    } finally {
      setSavingCustomer(false)
    }
  }, [userId, customerDraft, customerAiFields, editingCustomerId, selectCustomer])

  // ------------------------------ 联系人 ------------------------------
  const [contactName, setContactName] = useState("")
  const [contactTitle, setContactTitle] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [savingContact, setSavingContact] = useState(false)

  const patchContacts = useCallback(
    async (customer: CustomerRow, contacts: ContactInfo[]) => {
      setSavingContact(true)
      try {
        const record = await apiFetch<CustomerRow>(`/api/customers/${customer.id}`, {
          method: "PATCH",
          body: JSON.stringify({ contacts }),
        })
        setCustomers((prev) => prev.map((c) => (c.id === record.id ? record : c)))
        toast.success("联系人已更新")
      } catch {
        toast.error("联系人保存失败，请稍后重试")
      } finally {
        setSavingContact(false)
      }
    },
    [],
  )

  const addContact = useCallback(() => {
    if (!selectedCustomer) return
    const displayName = contactName.trim()
    if (!displayName) {
      toast.error("请填写联系人姓名")
      return
    }
    const next: ContactInfo[] = [
      ...(selectedCustomer.contacts ?? []),
      { name: displayName, title: contactTitle.trim(), phone: contactPhone.trim() },
    ]
    setContactName("")
    setContactTitle("")
    setContactPhone("")
    void patchContacts(selectedCustomer, next)
  }, [selectedCustomer, contactName, contactTitle, contactPhone, patchContacts])

  const removeContact = useCallback(
    (index: number) => {
      if (!selectedCustomer) return
      const next = (selectedCustomer.contacts ?? []).filter((_, i) => i !== index)
      void patchContacts(selectedCustomer, next)
    },
    [selectedCustomer, patchContacts],
  )

  // ------------------------------ 跟进记录 ------------------------------
  const [quickType, setQuickType] = useState<string>("电话")
  const [quickContent, setQuickContent] = useState("")
  const [addingFollow, setAddingFollow] = useState(false)

  const postFollowRecord = useCallback(
    async (input: {
      customerId: string
      opportunityId?: string
      recordType: string
      content: string
      stageChange?: string
    }): Promise<FollowRecordRow | null> => {
      if (!userId) return null
      try {
        const record = await apiFetch<FollowRecordRow>("/api/follow_records", {
          method: "POST",
          body: JSON.stringify({
            rh_user_id: userId,
            customer_id: input.customerId,
            opportunity_id: input.opportunityId ?? "",
            record_type: input.recordType,
            content: input.content,
            stage_change: input.stageChange ?? "",
          }),
        })
        setAllFollowRecords((prev) => [record, ...prev])
        if (record.customer_id === selectedCustomerId) {
          setFollowRecords((prev) => [record, ...prev])
          setTotalRecords((t) => (t == null ? null : t + 1))
        }
        // 同步客户最近跟进时间
        const stamp = nowIso()
        await apiFetch<CustomerRow>(`/api/customers/${input.customerId}`, {
          method: "PATCH",
          body: JSON.stringify({ last_follow_at: stamp }),
        }).catch(() => null)
        setCustomers((prev) =>
          prev.map((c) => (c.id === input.customerId ? { ...c, last_follow_at: stamp } : c)),
        )
        return record
      } catch {
        toast.error("跟进记录保存失败，请稍后重试")
        return null
      }
    },
    [userId, selectedCustomerId],
  )

  const addQuickFollow = useCallback(async () => {
    if (!selectedCustomer) return
    const content = quickContent.trim()
    if (!content) {
      toast.error("请填写跟进内容")
      return
    }
    setAddingFollow(true)
    const record = await postFollowRecord({
      customerId: selectedCustomer.id,
      recordType: quickType,
      content,
    })
    setAddingFollow(false)
    if (record) {
      setQuickContent("")
      toast.success("跟进记录已添加")
    }
  }, [selectedCustomer, quickContent, quickType, postFollowRecord])

  // ------------------------------ 商机表单 ------------------------------
  const [oppFormOpen, setOppFormOpen] = useState(false)
  const [editingOppId, setEditingOppId] = useState<string | null>(null)
  const [oppCustomerId, setOppCustomerId] = useState("")
  // 轮次 3 B1：深链转商机 hospital/region 匹配不到客户时置空不兜底，弹窗内显示提示条
  const [oppNoMatchHint, setOppNoMatchHint] = useState(false)
  const [oppDraft, setOppDraft] = useState<OppDraft>(EMPTY_OPP_DRAFT)
  const [savingOpp, setSavingOpp] = useState(false)

  const setOppField = useCallback(<K extends OppDraftKey>(key: K, value: OppDraft[K]) => {
    setOppDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const openNewOpportunity = useCallback(
    (customerId?: string) => {
      if (!requireLogin()) return
      if (customers.length === 0) {
        toast.error("请先创建客户，再为客户添加商机")
        return
      }
      setEditingOppId(null)
      setOppDraft(EMPTY_OPP_DRAFT)
      setOppNoMatchHint(false)
      setOppCustomerId(customerId ?? selectedCustomerId ?? customers[0]?.id ?? "")
      setOppFormOpen(true)
    },
    [requireLogin, customers, selectedCustomerId],
  )

  // 轮次 F 轨 2 + D2：情报「转为商机」深链 ?new_opp=1 预填接收（ref 存已消费的查询签名，预填参数变化即重新消费）
  const newOppPrefillSigRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userId || dataLoading) return
    if (searchParams.get("new_opp") !== "1") return
    const sig = searchParams.toString()
    if (newOppPrefillSigRef.current === sig) return
    newOppPrefillSigRef.current = sig
    const hospital = (searchParams.get("prefill_hospital") ?? "").trim()
    const region = (searchParams.get("prefill_region") ?? "").trim()
    const matched =
      (hospital
        ? customers.find(
            (c) => c.hospital_name && (c.hospital_name.includes(hospital) || hospital.includes(c.hospital_name)),
          )
        : undefined) ??
      (region ? customers.find((c) => c.region && (c.region.includes(region) || region.includes(c.region))) : undefined)
    openNewOpportunity(matched?.id)
    // 轮次 3 B1：深链匹配不到客户时不静默挂第一个客户，置空 + 提示用户自选或先新建
    if (!matched) {
      setOppCustomerId("")
      setOppNoMatchHint(true)
    }
    setOppDraft({
      ...EMPTY_OPP_DRAFT,
      opp_name: searchParams.get("prefill_name") ?? "",
      expected_amount: searchParams.get("prefill_amount") ?? "",
      notes: searchParams.get("prefill_notes") ?? "",
    })
  }, [userId, dataLoading, searchParams, customers, openNewOpportunity])

  const openEditOpportunity = useCallback((opp: OpportunityRow) => {
    setEditingOppId(opp.id)
    setOppNoMatchHint(false)
    setOppCustomerId(opp.customer_id)
    setOppDraft({
      opp_name: opp.opp_name ?? "",
      stage: (opp.stage || "lead") as OppStage,
      expected_amount: opp.expected_amount ? String(opp.expected_amount) : "",
      expected_close_date: opp.expected_close_date ?? "",
      next_follow_date: opp.next_follow_date ?? "",
      next_action: opp.next_action ?? "",
      ref_key: opp.ref_id ? `${opp.ref_type}:${opp.ref_id}` : "",
      notes: opp.notes ?? "",
    })
    setOppFormOpen(true)
  }, [])

  const closeOppForm = useCallback(() => {
    setOppNoMatchHint(false)
    setOppFormOpen(false)
  }, [])

  const saveOpportunity = useCallback(async () => {
    if (!userId) return
    const oppName = oppDraft.opp_name.trim()
    if (!oppName) {
      toast.error("请填写商机名称")
      return
    }
    const customer = customers.find((c) => c.id === oppCustomerId)
    if (!customer) {
      toast.error("请选择所属客户")
      return
    }
    const ref = refOptions.find((r) => `${r.ref_type}:${r.ref_id}` === oppDraft.ref_key)
    setSavingOpp(true)
    try {
      const body = {
        customer_id: customer.id,
        customer_name: customer.hospital_name,
        opp_name: oppName,
        stage: oppDraft.stage,
        expected_amount: toNumberOrNull(oppDraft.expected_amount) ?? null,
        expected_close_date: oppDraft.expected_close_date,
        next_follow_date: oppDraft.next_follow_date,
        next_action: oppDraft.next_action.trim(),
        ref_type: ref?.ref_type ?? "",
        ref_id: ref?.ref_id ?? "",
        ref_name: ref?.ref_name ?? "",
        notes: oppDraft.notes.trim(),
      }
      let record: OpportunityRow
      if (editingOppId) {
        record = await apiFetch<OpportunityRow>(`/api/opportunities/${editingOppId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        setOpportunities((prev) => prev.map((o) => (o.id === record.id ? record : o)))
        toast.success("商机已更新")
      } else {
        record = await apiFetch<OpportunityRow>("/api/opportunities", {
          method: "POST",
          body: JSON.stringify({ ...body, rh_user_id: userId, lost_reason: "" }),
        })
        setOpportunities((prev) => [record, ...prev])
        setTotalOpps((t) => (t == null ? null : t + 1))
        toast.success("商机已创建")
      }
      setOppFormOpen(false)
      setSelectedCustomerId(customer.id)
      setSelectedOpportunityId(record.id)
      void loadFollowRecords(customer.id)
      // 轮次 F 轨 2：next_action + 预计成交日期齐备时自动登记待办（失败不阻塞保存）
      void registerNextActionTodo(userId, record)
    } catch {
      toast.error("商机保存失败，请稍后重试")
    } finally {
      setSavingOpp(false)
    }
  }, [userId, oppDraft, oppCustomerId, customers, refOptions, editingOppId, loadFollowRecords])

  // ------------------------------ 阶段推进 ------------------------------
  const [stageDialog, setStageDialog] = useState<StageDialogState | null>(null)
  const [stageRecordContent, setStageRecordContent] = useState("")
  const [lostReasonDraft, setLostReasonDraft] = useState("")
  const [savingStage, setSavingStage] = useState(false)

  const requestStageChange = useCallback((opp: OpportunityRow, target: OppStage) => {
    if (isTerminalStage(opp.stage) || opp.stage === target) return
    setStageDialog({ opp, target })
    setStageRecordContent("")
    setLostReasonDraft(opp.lost_reason ?? "")
  }, [])

  const closeStageDialog = useCallback(() => setStageDialog(null), [])

  // A2-9 看板拖拽换阶段：乐观更新（toast 延后到 PATCH resolve，C2），失败回滚 + 错误 toast
  // A2 闸门：拖入 won/lost 不再直接 PATCH，改开既有阶段变更弹窗走 confirmStageChange 完整闸门
  //（lost 收失单原因、必填跟进记录）；取消弹窗则商机停在原列（未做乐观移动，天然回弹）
  const moveOpportunityStage = useCallback(
    async (opp: OpportunityRow, target: OppStage) => {
      if (!userId || isTerminalStage(opp.stage) || opp.stage === target) return
      if (target === "won" || target === "lost") {
        requestStageChange(opp, target)
        return
      }
      const fromLabel = STAGE_LABEL[(opp.stage || "lead") as OppStage]
      setOpportunities((list) => list.map((o) => (o.id === opp.id ? { ...o, stage: target } : o)))
      // C2（循环 6 N7）：成功 toast 延后到 PATCH resolve 之后，避免「先报成功再报回滚」双 toast；
      // 乐观移动保留，失败路径只剩回滚 + 错误提示一条
      try {
        const updated = await apiFetch<OpportunityRow>(`/api/opportunities/${opp.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage: target }),
        })
        setOpportunities((list) => list.map((o) => (o.id === updated.id ? updated : o)))
        toast.success(`已将「${opp.opp_name}」推进到「${STAGE_LABEL[target]}」`)
      } catch {
        setOpportunities((list) => list.map((o) => (o.id === opp.id ? { ...o, stage: opp.stage } : o)))
        toast.error("阶段更新失败，已恢复到原阶段，请稍后重试")
        return
      }
      // A2 留痕：拖拽换阶段成功后自动补登一条跟进记录（复用既有 POST 路径）；
      // postFollowRecord 内部捕获异常并 toast，失败不影响已完成的阶段变更
      await postFollowRecord({
        customerId: opp.customer_id,
        opportunityId: opp.id,
        recordType: "阶段变更",
        content: `阶段调整：${fromLabel} → ${STAGE_LABEL[target]}（看板拖拽）`,
        stageChange: `${fromLabel} → ${STAGE_LABEL[target]}`,
      })
    },
    [userId, requestStageChange, postFollowRecord],
  )

  const confirmStageChange = useCallback(async () => {
    if (!stageDialog) return
    const { opp, target } = stageDialog
    const content = stageRecordContent.trim()
    if (!content) {
      toast.error("推进阶段需要填写一条跟进记录")
      return
    }
    setSavingStage(true)
    const record = await postFollowRecord({
      customerId: opp.customer_id,
      opportunityId: opp.id,
      recordType: "阶段变更",
      content,
      stageChange: `${STAGE_LABEL[(opp.stage || "lead") as OppStage]} → ${STAGE_LABEL[target]}`,
    })
    if (!record) {
      setSavingStage(false)
      return
    }
    try {
      const patch: Record<string, unknown> = { stage: target }
      if (target === "lost" && lostReasonDraft.trim()) patch.lost_reason = lostReasonDraft.trim()
      const updated = await apiFetch<OpportunityRow>(`/api/opportunities/${opp.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setOpportunities((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
      setStageDialog(null)
      toast.success(`商机已推进到「${STAGE_LABEL[target]}」`)
    } catch {
      toast.error("商机阶段更新失败，请稍后重试")
    } finally {
      setSavingStage(false)
    }
  }, [stageDialog, stageRecordContent, lostReasonDraft, postFollowRecord])

  // ------------------------------ AI 跟进建议 ------------------------------
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [suggesting, setSuggesting] = useState(false)

  const doSuggest = useCallback(async () => {
    if (!selectedCustomer || !selectedOpportunity) return
    setSuggesting(true)
    try {
      const contextRecords = oppRecords.length > 0 ? oppRecords : followRecords
      const res = await chatViaGateway({
        modelRef: activeModelRef,
        messages: injectSkillBlock(buildSuggestionMessages(selectedCustomer, selectedOpportunity, contextRecords), skillBlockFor("customer-follow")),
        max_tokens: 1500,
        page: "customer-management",
      })
      if (!handleLlmResult(res)) return
      const parsed = parseSuggestionsJson(res.text)
      if (!parsed) {
        toast.error("AI 建议解析失败，请重试")
        return
      }
      setAiSuggestions(parsed)
    } catch {
      toast.error("网络异常，AI 建议生成失败，请稍后重试")
    } finally {
      setSuggesting(false)
    }
  }, [selectedCustomer, selectedOpportunity, oppRecords, followRecords, activeModelRef, handleLlmResult])

  const runSuggest = useCallback(() => {
    if (!requireLogin()) return
    if (!selectedOpportunity) {
      toast.error("请先选择一个商机")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void doSuggest()
    }, costText)
  }, [requireLogin, selectedOpportunity, costConfirm, costText, doSuggest])

  const applySuggestionAsNextAction = useCallback(
    async (suggestion: string) => {
      if (!selectedOpportunity) return
      try {
        const updated = await apiFetch<OpportunityRow>(`/api/opportunities/${selectedOpportunity.id}`, {
          method: "PATCH",
          body: JSON.stringify({ next_action: suggestion }),
        })
        setOpportunities((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        toast.success("已设为下一步动作")
      } catch {
        toast.error("下一步动作保存失败，请稍后重试")
      }
    },
    [selectedOpportunity],
  )

  const applySuggestionAsRecord = useCallback(
    async (suggestion: string) => {
      if (!selectedOpportunity) return
      const record = await postFollowRecord({
        customerId: selectedOpportunity.customer_id,
        opportunityId: selectedOpportunity.id,
        recordType: "其他",
        content: suggestion,
      })
      if (record) toast.success("已存为跟进记录")
    },
    [selectedOpportunity, postFollowRecord],
  )

  // ------------------------------ A1 删除通道（商机 / 跟进记录） ------------------------------
  // 后端 DELETE 路由现成（opportunities / follow_records），删除成功后本地列表同步剔除，
  // 列表 / 看板 / 详情三处由同一份 opportunities / followRecords state 驱动，天然一致
  const [deletingOppId, setDeletingOppId] = useState<string | null>(null)
  const [deletingFollowId, setDeletingFollowId] = useState<string | null>(null)

  // C1（循环 6 N2）：删除商机前下游引用检测。bid_projects 的 list filter 白名单只有
  // rh_user_id/stage、quotes 只有 rh_user_id，opportunity_id 不支持服务端过滤，
  // 故 perPage=200 拉全后客户端按 opportunity_id 计数；投标项目排除回收站（deleted_at 非空）。
  // 查询失败静默降级：deleteOppRefCounts 保持 null，View 用原文案，不阻断删除。
  const [deleteOppRefCounts, setDeleteOppRefCounts] = useState<{ bids: number; quotes: number } | null>(null)
  const [deleteRefsChecking, setDeleteRefsChecking] = useState(false)

  const checkOpportunityDeleteRefs = useCallback(
    async (oppId: string) => {
      if (!userId) return
      setDeleteOppRefCounts(null)
      setDeleteRefsChecking(true)
      try {
        const enc = encodeURIComponent(userId)
        const [bidRes, quoteRes] = await Promise.all([
          apiFetch<ListResponse<{ id: string; opportunity_id?: string; deleted_at?: string }>>(
            `/api/bid_projects?rh_user_id=${enc}&page=1&perPage=200`,
          ),
          apiFetch<ListResponse<{ id: string; opportunity_id?: string }>>(
            `/api/quotes?rh_user_id=${enc}&page=1&perPage=200`,
          ),
        ])
        const bids = (bidRes.items ?? []).filter(
          (b) => b.opportunity_id === oppId && !(b.deleted_at ?? "").trim(),
        ).length
        const quotes = (quoteRes.items ?? []).filter((q) => q.opportunity_id === oppId).length
        setDeleteOppRefCounts({ bids, quotes })
      } catch {
        setDeleteOppRefCounts(null)
      } finally {
        setDeleteRefsChecking(false)
      }
    },
    [userId],
  )

  const deleteOpportunity = useCallback(
    async (oppId: string) => {
      if (!userId) return
      setDeletingOppId(oppId)
      try {
        await apiFetch<{ ok: boolean }>(`/api/opportunities/${encodeURIComponent(oppId)}`, {
          method: "DELETE",
        })
        setOpportunities((prev) => prev.filter((o) => o.id !== oppId))
        setTotalOpps((t) => (t == null ? null : Math.max(t - 1, 0)))
        // 若详情面板正打开该商机则关闭
        setSelectedOpportunityId((prev) => (prev === oppId ? null : prev))
        setAiSuggestions([])
        // C1：删除成功后清掉引用检测结果，避免残留计数污染下一个商机的确认弹窗
        setDeleteOppRefCounts(null)
        toast.success("商机已删除")
      } catch {
        toast.error("商机删除失败，请稍后重试")
      } finally {
        setDeletingOppId(null)
      }
    },
    [userId],
  )

  // T7（2026-09-27 质量台账）：客户删除通道——后端 DELETE /api/customers/{id} 早已存在但 UI 无入口，
  // 建错的客户（如测试数据）无法清理。删除只移除客户记录本身；商机/跟进记录不级联删除，
  // 确认弹窗文案中如实提示归属关系变化，不隐瞒也不虚报。
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(null)
  const deleteCustomer = useCallback(
    async (customerId: string) => {
      if (!userId) return
      setDeletingCustomerId(customerId)
      try {
        await apiFetch<{ ok: boolean }>(`/api/customers/${encodeURIComponent(customerId)}`, {
          method: "DELETE",
        })
        setCustomers((prev) => prev.filter((c) => c.id !== customerId))
        // 服务端搜索结果缓存同步剔除，避免删除后搜索列表仍显示已删客户
        setServerSearchRows((prev) => (prev ? prev.filter((c) => c.id !== customerId) : prev))
        setTotalCustomers((t) => (t == null ? null : Math.max(t - 1, 0)))
        // 详情面板正打开该客户则关闭，商机面板同步收起
        setSelectedCustomerId((prev) => (prev === customerId ? null : prev))
        setSelectedOpportunityId(null)
        toast.success("客户已删除")
      } catch {
        toast.error("客户删除失败，请稍后重试")
      } finally {
        setDeletingCustomerId(null)
      }
    },
    [userId],
  )

  const deleteFollowRecord = useCallback(
    async (recordId: string) => {
      if (!userId) return
      setDeletingFollowId(recordId)
      try {
        await apiFetch<{ ok: boolean }>(`/api/follow_records/${encodeURIComponent(recordId)}`, {
          method: "DELETE",
        })
        setAllFollowRecords((prev) => prev.filter((r) => r.id !== recordId))
        setFollowRecords((prev) => prev.filter((r) => r.id !== recordId))
        setTotalRecords((t) => (t == null ? null : Math.max(t - 1, 0)))
        toast.success("跟进记录已删除")
      } catch {
        toast.error("跟进记录删除失败，请稍后重试")
      } finally {
        setDeletingFollowId(null)
      }
    },
    [userId],
  )

  // ------------------------------ 看板 ------------------------------
  // A2：won/lost 拆成独立列（不再合并 done），拖入终态列由 moveOpportunityStage 转弹窗闸门
  const boardGroups = useMemo(() => {
    const groups: Record<string, OpportunityRow[]> = {
      lead: [], contact: [], needs: [], solution: [], bidding: [], won: [], lost: [],
    }
    for (const o of opportunities) {
      const key = (o.stage || "lead") as string
      groups[key]?.push(o)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
    }
    return groups
  }, [opportunities])

  return {
    // 登录态
    userId,
    accountInfo,
    handleAccountChange,
    // 技能 scope 源（视图选择器用）
    customerProfileSkills,
    customerFollowSkills,
    // 模型
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    costConfirm,
    // 数据
    customers,
    opportunities,
    refOptions,
    dataLoading,
    stats,
    // A2-7 分页
    totalCustomers,
    customersHasMore,
    customersLoadingMore,
    loadMoreCustomers,
    totalOpps,
    oppsHasMore,
    oppsLoadingMore,
    loadMoreOpportunities,
    // A3 统计 capped 标志（统计卡数字加「+」后缀）
    customerCountCapped: totalCustomers === null,
    oppCapped,
    followCapped,
    refsHasMore,
    refsLoadingMore,
    loadMoreRefs,
    // 视图与筛选
    view,
    setView,
    searchText,
    setSearchText,
    typeFilter,
    setTypeFilter,
    regionFilter,
    setRegionFilter,
    regionOptions,
    sortBy,
    setSortBy,
    filteredCustomers,
    oppCountByCustomer,
    // 选中态
    selectedCustomer,
    selectedOpportunity,
    customerOpps,
    followRecords,
    recordsLoading,
    totalRecords,
    recordsHasMore,
    recordsLoadingMore,
    loadMoreFollowRecords,
    oppRecords,
    selectCustomer,
    selectOpportunity,
    closeOpportunity,
    openOpportunityFromBoard,
    closeDetail,
    // 关联投标 + 全链路资产（第二轮改造）
    linkedBids,
    chainAssets,
    chainLoading,
    // 客户表单 + AI
    customerFormOpen,
    openNewCustomer,
    openEditCustomer,
    closeCustomerForm,
    customerDraft,
    setDraftField,
    customerAiFields,
    savingCustomer,
    saveCustomer,
    editingCustomerId,
    aiMatching,
    runAiMatch,
    extractText,
    setExtractText,
    extracting,
    runExtract,
    fetchingSite,
    runFetchSite,
    // 2026-10-07 用户需求：官网/政府网站商机线索
    siteLeads,
    leadSavingKey,
    convertLeadToOpportunity,
    articleUrl,
    setArticleUrl,
    runFetchUrl,
    batchEnriching,
    batchProgress,
    runBatchEnrich,
    cancelBatchEnrich,
    enrichingOneId,
    enrichOneCustomer,
    // 联系人
    contactName,
    setContactName,
    contactTitle,
    setContactTitle,
    contactPhone,
    setContactPhone,
    addContact,
    removeContact,
    savingContact,
    // 跟进记录
    quickType,
    setQuickType,
    quickContent,
    setQuickContent,
    addQuickFollow,
    addingFollow,
    // 商机表单
    oppFormOpen,
    openNewOpportunity,
    openEditOpportunity,
    closeOppForm,
    oppDraft,
    setOppField,
    oppCustomerId,
    setOppCustomerId,
    oppNoMatchHint,
    savingOpp,
    saveOpportunity,
    editingOppId,
    // 阶段推进
    stageDialog,
    stageRecordContent,
    setStageRecordContent,
    lostReasonDraft,
    setLostReasonDraft,
    confirmStageChange,
    closeStageDialog,
    savingStage,
    requestStageChange,
    moveOpportunityStage,
    // AI 建议
    aiSuggestions,
    suggesting,
    runSuggest,
    applySuggestionAsNextAction,
    applySuggestionAsRecord,
    // A1 删除通道
    deleteOpportunity,
    deleteFollowRecord,
    deletingOppId,
    deletingFollowId,
    // T7 客户删除通道（后端 DELETE 路由既有，前端补入口）
    deleteCustomer,
    deletingCustomerId,
    // C1 删除前下游引用检测（确认弹窗文案升级用）
    deleteOppRefCounts,
    deleteRefsChecking,
    checkOpportunityDeleteRefs,
    // 看板
    boardGroups,
  }
}

export type OppDraftKey = keyof OppDraft
