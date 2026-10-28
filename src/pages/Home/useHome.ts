import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import type { CrmOppBrief, CrmStats } from "@/components/home/CustomerOverviewSection"
import type { BidReview } from "@/components/home/BidReviewCard"
import { useActivityFeed } from "@/hooks/useActivityFeed"
import { useActiveWork } from "@/hooks/useActiveWork"
import { cleanIntelLine, cleanIntelSnippet, cleanIntelSummary } from "@/pages/IntelCenter/intelBodyClean"
import { qualRiskView, type QualRiskView } from "@/pages/QualCerts/qualsCore"

// ---------------------------------------------------------------------------
// 数据类型（字段名与 PocketBase collection 完全一致，snake_case，不做转换层）
// ---------------------------------------------------------------------------

export type TodoItem = {
  id: string
  rh_user_id: string
  content: string
  done: boolean
  due_date?: string | null
  // 轮次 F 轨 2：商机 next_action 自动登记的待办带来源元数据与深链
  source_type?: string
  source_id?: string
  link?: string
  created: string
  updated: string
}

// 五桶分组（参考 atomic-crm tasksPredicate 纯函数）：逾期 / 今天 / 明天 / 本周内 / 更晚 / 无期限
export type TodoBucketKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none"

export type TodoBucketView = {
  key: TodoBucketKey
  label: string
  defaultOpen: boolean
  items: TodoItem[]
}

const TODO_BUCKET_META: { key: TodoBucketKey; label: string; defaultOpen: boolean }[] = [
  { key: "overdue", label: "已逾期", defaultOpen: true },
  { key: "today", label: "今天", defaultOpen: true },
  { key: "tomorrow", label: "明天", defaultOpen: false },
  { key: "week", label: "本周内", defaultOpen: false },
  { key: "later", label: "更晚", defaultOpen: false },
  { key: "none", label: "无期限", defaultOpen: false },
]

const DAY_MS = 86_400_000
// 完成勾选后条目保留 5 分钟再消失（防闪烁，期间可撤销）
const RECENT_DONE_WINDOW_MS = 5 * 60_000

// B2：完成防闪烁窗口持久化到 localStorage（key 按 userId 隔离，换账号不串；登出不清）
const TODOS_DONE_KEY_PREFIX = "todos_done_"

function pruneDoneMap(map: Record<string, number>, now: number): Record<string, number> {
  const fresh: Record<string, number> = {}
  for (const [id, ts] of Object.entries(map)) {
    if (typeof ts === "number" && now - ts < RECENT_DONE_WINDOW_MS) fresh[id] = ts
  }
  return fresh
}

/** 读回已完成时间戳表，过期条目顺手清理 */
function readRecentDone(uid: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(`${TODOS_DONE_KEY_PREFIX}${uid}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return pruneDoneMap(parsed, Date.now())
  } catch {
    return {}
  }
}

function writeRecentDone(uid: string, map: Record<string, number>): void {
  try {
    const fresh = pruneDoneMap(map, Date.now())
    const key = `${TODOS_DONE_KEY_PREFIX}${uid}`
    if (Object.keys(fresh).length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(fresh))
  } catch {
    /* 存储不可用时静默降级为纯内存行为 */
  }
}

function startOfTodayMs(nowTick: number): number {
  const d = new Date(nowTick)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function todoBucketKeyOf(dueDate: string | null | undefined, todayStartMs: number): TodoBucketKey {
  const raw = String(dueDate ?? "").slice(0, 10)
  if (!raw) return "none"
  const t = new Date(`${raw}T00:00:00`).getTime()
  if (Number.isNaN(t)) return "none"
  const days = Math.round((t - todayStartMs) / DAY_MS)
  if (days < 0) return "overdue"
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days <= 7) return "week"
  return "later"
}

export type ProjectItem = {
  id: string
  rh_user_id: string
  project_name: string
  project_type: string
  hospital: string
  progress: number
  deadline: string
  notes: string
  created: string
  updated: string
}

export type IntelItem = {
  id: string
  title: string
  source: string
  publishedAt: string
  tag: string
  summary: string
}

export type ProjectForm = {
  projectName: string
  projectType: string
  hospital: string
  deadline: string
  notes: string
}

const EMPTY_PROJECT_FORM: ProjectForm = {
  projectName: "",
  projectType: "方案",
  hospital: "",
  deadline: "",
  notes: "",
}

export const PROJECT_TYPES = ["方案", "标书", "PPT", "报价"] as const

// home-02：今日必看行动条——置顶的首屏唯一强调整点，纯客户端归集已拉取数据（零新增请求/零后端）
export type MustSeeGroup = "overdue" | "dueToday" | "active"
export type MustSeeCategory = "todo" | "opp" | "project" | "qual"
export type MustSeeItem = {
  id: string
  group: MustSeeGroup
  category: MustSeeCategory
  title: string
  meta: string
  detail: string
  route?: string
  project?: ProjectItem
}
export type MustSeeToday = {
  overdue: MustSeeItem[]
  dueToday: MustSeeItem[]
  active: MustSeeItem[]
  total: number
}

// 情报摘要（真实数据来自情报中心 intel_items，首页取最新 5 条，按本人 my_status 已确认优先）
type IntelItemRow = {
  id: string
  title: string
  source_name: string
  url: string
  content_snippet: string
  item_type: string
  summary: string
  item_status: string
  my_status: string
  visibility: string
  published_at: string
  created: string
}

// 2026-09-26 Q5 整改（全局质量规范）：item_type 是「信息源类型」不是「公告结果」——
// bid 表示该条来自招标类信息源（可能还在招标，未必中标），旧映射 bid→"中标" 属于错标，
// 曾把公开招标公告全部打上「中标」徽章。改为「招标」，与情报中心「招标中标」类目对齐。
const INTEL_TAG_BY_TYPE: Record<string, string> = {
  policy: "政策",
  competitor: "竞品",
  bid: "招标",
  media: "媒体",
}

function mapIntelRow(row: IntelItemRow): IntelItem {
  const when = row.published_at || row.created || ""
  // R53/F10：采集解析出的「未来日期」（招标截止时间/栏目占位 2027-01-01 被当发布日）不可信 → 不显示
  const pubDay = when.slice(0, 10)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const limit = new Date(today)
  limit.setDate(limit.getDate() + 1)
  const pubMs = pubDay ? new Date(`${pubDay}T00:00:00`).getTime() : NaN
  const future = Number.isFinite(pubMs) && pubMs > limit.getTime()
  // 抓取入库的 content_snippet/summary 常带被从中间截断的半截 HTML/CSS 残片；
  // 展示层走 cleanIntelSnippet（深度清洗 + 剥「更多…」+ 列表残片只留本条正文），
  // 避免把「同站其他文章的标题 + 日期」当成这条情报的摘要显示（R65 实测 672 条里 309 条如此）
  const snippet = cleanIntelSnippet(row.content_snippet || "", { title: row.title, max: 120 })
  // R64：摘要改用 cleanIntelSummary（先剥站点名前缀/JSON 元数据块再深度清洗）——
  // 「健康报」源的 summary 是「站点名 + 页面 JSON + 真正文」同处一行，直接用 displayizeIntel
  // 会被「整行含花括号即丢」的判据把真正文一起丢掉，首页表现为「有摘要但空白」
  const cleanedSummary = row.summary ? cleanIntelSummary(row.summary, 160) : ""
  return {
    id: row.id,
    title: cleanIntelLine(row.title),
    source: row.source_name || "情报中心",
    publishedAt: pubDay && !future ? pubDay : "",
    tag: INTEL_TAG_BY_TYPE[row.item_type] ?? "情报",
    summary: cleanedSummary || snippet || "暂无摘要，进入情报中心用 AI 摘要打标",
  }
}

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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

// 胜负复盘聚合源行（opportunities collection 子集，snake_case 与 PB 一致）
type OppReviewRow = CrmOppBrief & {
  lost_reason?: string
  // 循环 9 B1：首页待跟进提醒复用同一次拉取（零新增请求）
  next_follow_date?: string
}

// 循环 9 B1：待跟进商机提醒行（今日到期 + 已逾期两组）
export type FollowDueOpp = {
  id: string
  opp_name: string
  customer_name: string
  next_follow_date: string
  overdue: boolean
}

// 深度项：胜负复盘第二聚合源（bid_projects 子集，投标结果回流前也能进胜率统计）
type BidReviewRow = {
  id: string
  opportunity_id?: string
  bid_result?: string
  lost_reason?: string
}

// D1：hook 模板 perPage 上限 200，拉满 200 视为可能截断（统计卡显示「N+」）
const HOME_STATS_PER_PAGE = 200
// C2：待办同口径——hook 模板默认前 50 条会静默截断，改拉 200 条并设 capped 标志
const HOME_TODOS_PER_PAGE = 200
// T2.1：项目同口径——hook 模板默认前 50 条会静默截断，改拉 200 条并设 capped 标志
const HOME_PROJECTS_PER_PAGE = 200

const EMPTY_BID_REVIEW: BidReview = { won: 0, lost: 0, winRate: null, lostReasonTop: [], sourceCapped: false }

// 商机漏斗（阶段分布）口径：与 customerTypes.PIPELINE_STAGES 一致，只统计在跟的 5 个阶段，
// won/lost 终态不进漏斗（终态由「胜负复盘」卡单独呈现）。
const OPP_FUNNEL_STAGES: { stage: string; name: string }[] = [
  { stage: "lead", name: "线索" },
  { stage: "contact", name: "初步接触" },
  { stage: "needs", name: "需求确认" },
  { stage: "solution", name: "方案阶段" },
  { stage: "bidding", name: "投标" },
]

// 漏斗单条：{ 阶段 key, 阶段名, 商机数 }（展示色由 FunnelCard 按 index 分配，逻辑层不依赖 echarts）
export type FunnelDatum = { stage: string; name: string; value: number }

export function useHome() {
  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [accountInfo, setAccountInfo] = useState<RhAccountInfo | null>(null)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    setUserId(account?.userId ?? decodeRhToken()?.sub ?? null)
  }, [])

  // ------------------------------ 活动流（B-3 跨实体聚合，零后端） ------------------------------
  const { activityEvents, activityLoading } = useActivityFeed(userId)
  // ------------------------------ 工作台进行中事项（R196 §3.2 跨工作台聚合，只读零后端） ------------------------------
  const {
    activeWork,
    activeWorkTotal,
    activeWorkByKind,
    activeWorkTruncated,
    activeWorkExact,
    activeWorkCaveat,
    activeWorkLoading,
  } = useActiveWork(userId)

  // ------------------------------ 待办 ------------------------------
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todosLoading, setTodosLoading] = useState(false)
  // C2：拉满 200 条即可能被截断，待办区底部显示提示行（与 bid 列表 capped 模式一致）
  const [todosCapped, setTodosCapped] = useState(false)
  const [todoInput, setTodoInput] = useState("")
  const [todoDueDate, setTodoDueDate] = useState("")
  const [todoAdding, setTodoAdding] = useState(false)
  // 完成防闪烁：id → 勾选完成时刻（5 分钟内保留显示、可撤销）
  const [recentDoneAt, setRecentDoneAt] = useState<Record<string, number>>({})
  // B2：ref 镜像，供 toggleTodo 内取最新值并同步持久化
  const recentDoneAtRef = useRef<Record<string, number>>({})
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // B2：挂载 / 切换账号时读回完成窗口（过期条目顺手清理；按 userId 隔离换账号不串）
  useEffect(() => {
    if (!userId) {
      recentDoneAtRef.current = {}
      setRecentDoneAt({})
      return
    }
    const fresh = readRecentDone(userId)
    recentDoneAtRef.current = fresh
    setRecentDoneAt(fresh)
    writeRecentDone(userId, fresh)
  }, [userId])

  const loadTodos = useCallback(async (uid: string) => {
    setTodosLoading(true)
    try {
      const data = await apiFetch<ListResponse<TodoItem>>(
        `/api/todos?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=${HOME_TODOS_PER_PAGE}&sort=-created`,
      )
      const rows = data.items ?? []
      setTodos(rows)
      setTodosCapped(rows.length >= HOME_TODOS_PER_PAGE)
    } catch {
      toast.error("待办加载失败，请稍后重试")
    } finally {
      setTodosLoading(false)
    }
  }, [])

  const addTodo = useCallback(async () => {
    const content = todoInput.trim()
    if (!content) return
    if (todoAdding) return
    if (!userId) {
      toast.error("当前无法添加待办，请稍后重试")
      return
    }
    setTodoInput("")
    setTodoAdding(true)
    const dueDate = todoDueDate
    try {
      const record = await apiFetch<TodoItem>("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          content,
          done: false,
          ...(dueDate ? { due_date: dueDate } : {}),
        }),
      })
      setTodos((prev) => [record, ...prev])
      setTodoDueDate("")
      toast.success("待办已添加")
    } catch {
      setTodoInput(content)
      toast.error("待办保存失败，请稍后重试")
    } finally {
      setTodoAdding(false)
    }
  }, [todoAdding, todoDueDate, todoInput, userId])

  const toggleTodo = useCallback(
    async (item: TodoItem) => {
      const nextDone = !item.done
      // B2：操作前捕获原完成时刻，取消勾选失败时对称回补，条目不会凭空消失
      const prevDoneAt = recentDoneAtRef.current[item.id]
      setTodos((prev) => prev.map((t) => (t.id === item.id ? { ...t, done: nextDone } : t)))
      // B2：完成时刻同步写 localStorage（撤销 / 失败回滚同步移除），刷新后 5 分钟内保持已完成展示态
      const nextDoneMap = { ...recentDoneAtRef.current }
      if (nextDone) nextDoneMap[item.id] = Date.now()
      else delete nextDoneMap[item.id]
      recentDoneAtRef.current = nextDoneMap
      setRecentDoneAt(nextDoneMap)
      if (userId) writeRecentDone(userId, nextDoneMap)
      try {
        await apiFetch<TodoItem>(`/api/todos/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ done: nextDone }),
        })
      } catch {
        setTodos((prev) => prev.map((t) => (t.id === item.id ? { ...t, done: !nextDone } : t)))
        // B2：回滚按操作方向对称——勾选失败删时间戳；取消勾选失败回补原时间戳
        const rollbackMap = { ...recentDoneAtRef.current }
        if (nextDone) delete rollbackMap[item.id]
        else if (typeof prevDoneAt === "number") rollbackMap[item.id] = prevDoneAt
        recentDoneAtRef.current = rollbackMap
        setRecentDoneAt(rollbackMap)
        if (userId) writeRecentDone(userId, rollbackMap)
        toast.error("待办更新失败，请稍后重试")
      }
    },
    [userId],
  )

  const deleteTodo = useCallback(async (item: TodoItem) => {
    // T2.3：删除前捕获原索引，失败回滚按原索引插回，不打乱 -created 排序
    const prevIndex = todos.findIndex((t) => t.id === item.id)
    setTodos((prev) => prev.filter((t) => t.id !== item.id))
    try {
      await apiFetch<{ ok: boolean }>(`/api/todos/${item.id}`, { method: "DELETE" })
      toast.success("待办已删除")
    } catch {
      setTodos((prev) => {
        if (prev.some((t) => t.id === item.id)) return prev
        const next = [...prev]
        const insertAt = prevIndex >= 0 && prevIndex <= next.length ? prevIndex : next.length
        next.splice(insertAt, 0, item)
        return next
      })
      toast.error("待办删除失败，请稍后重试")
    }
  }, [todos])

  // ------------------------------ 项目 ------------------------------
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  // T2.1：拉满 200 条即可能被截断，统计卡显示「N+」+ 项目区底部提示行（与 todos capped 同模式）
  const [projectsCapped, setProjectsCapped] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectForm, setProjectForm] = useState<ProjectForm>(EMPTY_PROJECT_FORM)
  const [savingProject, setSavingProject] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null)
  const [progressDraft, setProgressDraft] = useState(0)
  const [notesDraft, setNotesDraft] = useState("")
  const [savingDetail, setSavingDetail] = useState(false)

  const loadProjects = useCallback(async (uid: string) => {
    setProjectsLoading(true)
    try {
      const data = await apiFetch<ListResponse<ProjectItem>>(
        `/api/projects?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=${HOME_PROJECTS_PER_PAGE}&sort=-created`,
      )
      const rows = data.items ?? []
      setProjects(rows)
      setProjectsCapped(rows.length >= HOME_PROJECTS_PER_PAGE)
    } catch {
      toast.error("项目加载失败，请稍后重试")
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  // ------------------------------ 客户概览（客户管理真实数据） ------------------------------
  const [crmStats, setCrmStats] = useState<CrmStats>({ customerCount: 0, activeOppCount: 0, monthFollowCount: 0 })
  const [crmRecentOpps, setCrmRecentOpps] = useState<CrmOppBrief[]>([])
  const [crmLoading, setCrmLoading] = useState(false)
  // 轮次 F 轨 2：胜负复盘聚合源（当前用户全部商机的 stage/lost_reason，内存聚合零后端）
  const [reviewOpps, setReviewOpps] = useState<OppReviewRow[]>([])
  // 循环 9 B1：今日到期 + 已逾期商机（复用商机拉取客户端过滤，零新增请求）
  const [followDueOpps, setFollowDueOpps] = useState<FollowDueOpp[]>([])
  // 深度项：复盘第二聚合源 bid_projects（won/lost by bid_result）
  const [reviewBids, setReviewBids] = useState<BidReviewRow[]>([])
  // D1：拉满 200 条即可能被截断，统计卡显示「N+」、复盘卡加小字
  const [statsCapped, setStatsCapped] = useState({ customers: false, opps: false, follows: false, bids: false })

  const loadCrmOverview = useCallback(async (uid: string) => {
    setCrmLoading(true)
    try {
      const enc = encodeURIComponent(uid)
      const [cRes, oRes, fRes, bRes] = await Promise.all([
        apiFetch<ListResponse<{ id: string }>>(`/api/customers?rh_user_id=${enc}&page=1&perPage=${HOME_STATS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<OppReviewRow>>(`/api/opportunities?rh_user_id=${enc}&page=1&perPage=${HOME_STATS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<{ id: string; created: string }>>(`/api/follow_records?rh_user_id=${enc}&page=1&perPage=${HOME_STATS_PER_PAGE}`).catch(() => null),
        apiFetch<ListResponse<BidReviewRow>>(`/api/bid_projects?rh_user_id=${enc}&page=1&perPage=${HOME_STATS_PER_PAGE}`).catch(() => null),
      ])
      // D1：opp/follow/bid 是本页客户端聚合（在跟/本月为过滤子集，totalItems 给不了）→ 保留 200+ 上限提示
      const customerRows = cRes?.items ?? []
      // crm-consistency-01：/api/customers 已返回真总数 totalItems（实测 perPage 变化仍稳定），首页客户数直接采信，
      // 消除「客户 >200 时首页显示 200+、客户管理页显示真实数」的两页口径不一致；缺字段/失败时回退本页条数
      const customerTotal = typeof cRes?.totalItems === "number" && cRes.totalItems > 0 ? cRes.totalItems : customerRows.length
      const opps = oRes?.items ?? []
      const followRows = fRes?.items ?? []
      const bidRows = bRes?.items ?? []
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      // T2.2：PB created 是空格分隔（"2026-09-01 10:00:00.123Z"），toISOString 产 T 分隔串，
      // 直接字典序比较会漏算每月 1 日（空格 0x20 < T）；统一 replace(" ", "T") 后再比较
      const monthStartIso = monthStart.toISOString()
      setCrmStats({
        customerCount: customerTotal,
        customerCountCapped: false,
        activeOppCount: opps.filter((o) => o.stage !== "won" && o.stage !== "lost").length,
        activeOppCountCapped: opps.length >= HOME_STATS_PER_PAGE,
        monthFollowCount: followRows.filter((r) => (r.created ?? "").replace(" ", "T") >= monthStartIso).length,
        monthFollowCountCapped: followRows.length >= HOME_STATS_PER_PAGE,
      })
      setCrmRecentOpps(
        [...opps].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).slice(0, 3),
      )
      setReviewOpps(opps)
      setReviewBids(bidRows)
      // 循环 9 B1：待跟进提醒——未终结商机按本地今天过滤今日到期/已逾期，日期升序取前 10
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, "0")
      const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      setFollowDueOpps(
        opps
          .filter((o) => o.stage !== "won" && o.stage !== "lost" && (o.next_follow_date ?? "").trim())
          .map((o) => ({
            id: o.id,
            opp_name: o.opp_name,
            customer_name: o.customer_name,
            next_follow_date: (o.next_follow_date ?? "").slice(0, 10),
            overdue: (o.next_follow_date ?? "").slice(0, 10) < todayStr,
          }))
          .filter((o) => o.next_follow_date <= todayStr)
          .sort((a, b) => a.next_follow_date.localeCompare(b.next_follow_date))
          .slice(0, 10),
      )
      setStatsCapped({
        customers: customerRows.length >= HOME_STATS_PER_PAGE,
        opps: opps.length >= HOME_STATS_PER_PAGE,
        follows: followRows.length >= HOME_STATS_PER_PAGE,
        bids: bidRows.length >= HOME_STATS_PER_PAGE,
      })
    } catch {
      /* 概览加载失败时保持空数据，不打扰首页 */
    } finally {
      setCrmLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setTodos([])
      setTodosCapped(false)
      setProjects([])
      setProjectsCapped(false)
      setCrmStats({ customerCount: 0, activeOppCount: 0, monthFollowCount: 0 })
      setCrmRecentOpps([])
      setReviewOpps([])
      setReviewBids([])
      setFollowDueOpps([])
      setStatsCapped({ customers: false, opps: false, follows: false, bids: false })
      return
    }
    void loadTodos(userId)
    void loadProjects(userId)
    void loadCrmOverview(userId)
  }, [userId, loadTodos, loadProjects, loadCrmOverview])

  // 轮次 F 轨 2 + 深度项：胜负复盘——胜率 won/(won+lost)、输单原因 Top 5（纯内存聚合）
  // 聚合源 = 商机 stage 终态 + bid_projects.bid_result；按 opportunity_id 去重，
  // 同商机既有 stage 终态又有 bid_result 时以 bid_result 为准，lost_reason 取 bid_projects 优先
  const bidReview = useMemo<BidReview>(() => {
    const sourceCapped = statsCapped.opps || statsCapped.bids
    type Decided = { result: "won" | "lost"; lostReason: string }
    const byOpportunity = new Map<string, Decided>()
    const standalone: Decided[] = []
    for (const o of reviewOpps) {
      if (o.stage === "won") byOpportunity.set(o.id, { result: "won", lostReason: "" })
      else if (o.stage === "lost") byOpportunity.set(o.id, { result: "lost", lostReason: (o.lost_reason ?? "").trim() })
    }
    for (const b of reviewBids) {
      if (b.bid_result !== "won" && b.bid_result !== "lost") continue
      const decided: Decided = { result: b.bid_result, lostReason: (b.lost_reason ?? "").trim() }
      if (b.opportunity_id) {
        const prev = byOpportunity.get(b.opportunity_id)
        // bid_result 优先覆盖商机 stage 终态；失单原因以 bid_projects 为先、商机原因为兜底
        byOpportunity.set(b.opportunity_id, {
          result: decided.result,
          lostReason: decided.lostReason || prev?.lostReason || "",
        })
      } else {
        standalone.push(decided)
      }
    }
    const decidedRows = [...byOpportunity.values(), ...standalone]
    if (decidedRows.length === 0) return { ...EMPTY_BID_REVIEW, sourceCapped }
    const won = decidedRows.filter((d) => d.result === "won").length
    const lostRows = decidedRows.filter((d) => d.result === "lost")
    const lost = lostRows.length
    const reasonCount = new Map<string, number>()
    for (const row of lostRows) {
      const rawReason = row.lostReason || "未填写原因"
      // R012 对齐：结构化失单原因「【类别】明细」按类别聚合，无前缀旧数据回退原文
      const coded = rawReason.match(/^【([^】]+)】/)
      const reason = coded ? coded[1] : rawReason
      reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1)
    }
    const lostReasonTop = [...reasonCount.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 5)
    return {
      won,
      lost,
      winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
      lostReasonTop,
      sourceCapped,
    }
  }, [reviewOpps, reviewBids, statsCapped])

  // 商机漏斗（阶段分布）——复用 reviewOpps（零新增请求），按 5 个在跟阶段计数，
  // 展示色由 FunnelCard 分配；总数 = 当前用户全部商机条数（含终态，用于「共 N 条商机」标签）。
  const oppFunnel = useMemo<FunnelDatum[]>(() => {
    const counts = new Map<string, number>()
    for (const o of reviewOpps) counts.set(o.stage, (counts.get(o.stage) ?? 0) + 1)
    return OPP_FUNNEL_STAGES.map((s) => ({
      stage: s.stage,
      name: s.name,
      value: counts.get(s.stage) ?? 0,
    }))
  }, [reviewOpps])
  const oppFunnelTotal = useMemo(() => reviewOpps.length, [reviewOpps])

  const setProjectField = useCallback(<K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) => {
    setProjectForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const openNewProject = useCallback(() => {
    if (!userId) {
      toast.error("当前无法新增项目，请稍后重试")
      return
    }
    setProjectForm(EMPTY_PROJECT_FORM)
    setNewProjectOpen(true)
  }, [userId])

  const closeNewProject = useCallback(() => setNewProjectOpen(false), [])

  const submitProject = useCallback(async () => {
    const projectName = projectForm.projectName.trim()
    if (!projectName) {
      toast.error("请填写项目名称")
      return
    }
    if (!userId) return
    setSavingProject(true)
    try {
      const record = await apiFetch<ProjectItem>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          project_name: projectName,
          project_type: projectForm.projectType,
          hospital: projectForm.hospital.trim(),
          progress: 0,
          deadline: projectForm.deadline,
          notes: projectForm.notes.trim(),
        }),
      })
      setProjects((prev) => [record, ...prev])
      setNewProjectOpen(false)
      toast.success("项目已创建")
    } catch {
      toast.error("项目创建失败，请稍后重试")
    } finally {
      setSavingProject(false)
    }
  }, [projectForm, userId])

  const openProjectDetail = useCallback((item: ProjectItem) => {
    setSelectedProject(item)
    setProgressDraft(item.progress)
    setNotesDraft(item.notes ?? "")
  }, [])

  const closeProjectDetail = useCallback(() => setSelectedProject(null), [])

  const saveProjectDetail = useCallback(async () => {
    if (!selectedProject) return
    setSavingDetail(true)
    try {
      const record = await apiFetch<ProjectItem>(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        body: JSON.stringify({ progress: progressDraft, notes: notesDraft }),
      })
      setProjects((prev) => prev.map((p) => (p.id === record.id ? record : p)))
      setSelectedProject(record)
      toast.success("项目已更新")
    } catch {
      toast.error("项目更新失败，请稍后重试")
    } finally {
      setSavingDetail(false)
    }
  }, [selectedProject, progressDraft, notesDraft])

  // ------------------------------ 情报 ------------------------------
  const [expandedIntelId, setExpandedIntelId] = useState<string | null>(null)
  const [intelItems, setIntelItems] = useState<IntelItem[]>([])
  const [intelPendingCount, setIntelPendingCount] = useState(0)
  const [intelLoading, setIntelLoading] = useState(false)

  // Q20 配套（2026-09-28）：资质台账预警联动驾驶舱，口径与台账/导出硬拦截对齐（O-006）——
  // 读 summary.buckets 走 qualRiskView：urgent = 已过期 + 30 天内（需马上处理），
  // watch = 90 天内（观察），line 逐档明细与台账分档标签逐字一致。
  // 拉取失败静默为 0（资质台账未建时不打扰首页），有风险才提示。
  const [qualRisk, setQualRisk] = useState<QualRiskView>({ urgent: 0, watch: 0, total: 0, line: "" })
  useEffect(() => {
    let alive = true
    apiFetch<{ buckets?: { expired?: number; critical?: number; warning?: number } }>("/api/qual_certs/summary")
      .then((data) => {
        if (alive) setQualRisk(qualRiskView(data.buckets))
      })
      .catch(() => {
        /* 资质台账未建或未登录：静默 */
      })
    return () => {
      alive = false
    }
  }, [])

  const loadIntelItems = useCallback(async () => {
    setIntelLoading(true)
    try {
      const data = await apiFetch<ListResponse<IntelItemRow>>(
        "/api/intel/items?item_status=pending,confirmed&page=1&per_page=20",
      )
      const rows = data.items ?? []
      // 状态语义 = 本人 my_status（确认/忽略每人独立），已确认优先展示
      const confirmed = rows.filter((r) => (r.my_status || "pending") === "confirmed")
      const pending = rows.filter((r) => (r.my_status || "pending") !== "confirmed")
      const picked = [...confirmed, ...pending].slice(0, 5)
      setIntelItems(picked.map(mapIntelRow))
      // R76：首屏横幅速览用——前 20 条里待确认数（轻量口径，不额外拉全量）
      setIntelPendingCount(pending.length)
    } catch {
      setIntelItems([])
    } finally {
      setIntelLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIntelItems()
  }, [loadIntelItems])

  const toggleIntel = useCallback((intelId: string) => {
    setExpandedIntelId((prev) => (prev === intelId ? null : intelId))
  }, [])

  // ------------------------------ 派生数据 ------------------------------
  // 完成 5 分钟内保留显示（划线 + 可撤销），超时后从列表消失；存量已完成待办刷新后不再展示
  const visibleTodos = useMemo(
    () =>
      todos.filter(
        (t) => !t.done || (recentDoneAt[t.id] != null && nowTick - recentDoneAt[t.id] < RECENT_DONE_WINDOW_MS),
      ),
    [todos, recentDoneAt, nowTick],
  )

  const todoBuckets = useMemo<TodoBucketView[]>(() => {
    const todayStart = startOfTodayMs(nowTick)
    const byKey = new Map<TodoBucketKey, TodoItem[]>()
    for (const item of visibleTodos) {
      const key = todoBucketKeyOf(item.due_date, todayStart)
      const list = byKey.get(key)
      if (list) list.push(item)
      else byKey.set(key, [item])
    }
    return TODO_BUCKET_META.map((meta) => ({
      ...meta,
      items: (byKey.get(meta.key) ?? []).sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1
        return b.created.localeCompare(a.created)
      }),
    })).filter((bucket) => bucket.items.length > 0)
  }, [visibleTodos, nowTick])

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aDone = a.progress >= 100
      const bDone = b.progress >= 100
      if (aDone !== bDone) return aDone ? 1 : -1
      const aDeadline = a.deadline || "9999-12-31"
      const bDeadline = b.deadline || "9999-12-31"
      return aDeadline.localeCompare(bDeadline)
    })
  }, [projects])

  const activeProjectCount = useMemo(
    () => projects.filter((p) => p.progress < 100).length,
    [projects],
  )
  const pendingTodoCount = useMemo(() => todos.filter((t) => !t.done).length, [todos])
  const doneTodoCount = useMemo(() => todos.filter((t) => t.done).length, [todos])
  const overdueTodoCount = useMemo(() => {
    const todayStart = startOfTodayMs(nowTick)
    return todos.filter((t) => !t.done && todoBucketKeyOf(t.due_date, todayStart) === "overdue").length
  }, [todos, nowTick])

  // home-02：今日必看——把逾期待办 / 今日到期 / 进行中项目归集到一个置顶行动条（复用已拉数据，零新请求）
  const mustSee = useMemo<MustSeeToday>(() => {
    const todayStart = startOfTodayMs(nowTick)
    const overdue: MustSeeItem[] = []
    const dueToday: MustSeeItem[] = []
    const active: MustSeeItem[] = []

    for (const t of visibleTodos) {
      if (t.done) continue
      const key = todoBucketKeyOf(t.due_date, todayStart)
      if (key !== "overdue" && key !== "today") continue
      const route =
        t.link ||
        (t.source_type === "opportunity" && t.source_id
          ? `/customer-management?opp=${t.source_id}`
          : "/customer-management")
      const item: MustSeeItem = {
        id: `todo_${t.id}`,
        group: key === "overdue" ? "overdue" : "dueToday",
        category: "todo",
        title: t.content.slice(0, 40) || "待办",
        meta: t.source_type === "opportunity" ? "商机跟进" : "待办",
        detail: key === "overdue" ? `已逾期（截止 ${String(t.due_date ?? "").slice(5, 10)}）` : "今天到期",
        route,
      }
      ;(key === "overdue" ? overdue : dueToday).push(item)
    }

    for (const o of followDueOpps) {
      const item: MustSeeItem = {
        id: `opp_${o.id}`,
        group: o.overdue ? "overdue" : "dueToday",
        category: "opp",
        title: o.opp_name || "商机",
        meta: o.customer_name || "未填客户",
        detail: o.overdue ? `待跟进逾期（${o.next_follow_date.slice(5)}）` : `今日待跟进（${o.next_follow_date.slice(5)}）`,
        route: `/customer-management?opp=${o.id}`,
      }
      ;(o.overdue ? overdue : dueToday).push(item)
    }

    for (const pr of projects) {
      if (pr.progress >= 100) continue
      const dl = (pr.deadline || "").slice(0, 10)
      let daysLeft: number | null = null
      if (dl) {
        const t = new Date(`${dl}T00:00:00`).getTime()
        if (!Number.isNaN(t)) daysLeft = Math.round((t - todayStart) / DAY_MS)
      }
      if (daysLeft !== null && daysLeft < 0) {
        overdue.push({ id: `prj_${pr.id}`, group: "overdue", category: "project", title: pr.project_name, meta: pr.hospital || "未填医院", detail: `${pr.project_type}已逾期 ${Math.abs(daysLeft)} 天 · 进度 ${pr.progress}%`, project: pr })
      } else if (daysLeft === 0) {
        dueToday.push({ id: `prj_${pr.id}`, group: "dueToday", category: "project", title: pr.project_name, meta: pr.hospital || "未填医院", detail: `${pr.project_type}今日截止 · 进度 ${pr.progress}%`, project: pr })
      } else {
        active.push({ id: `prj_${pr.id}`, group: "active", category: "project", title: pr.project_name, meta: pr.hospital || "未填医院", detail: `${pr.project_type} · 进度 ${pr.progress}%${daysLeft !== null ? ` · 剩 ${daysLeft} 天` : ""}`, project: pr })
      }
    }

    active.sort((a, b) => (a.project?.deadline || "9999-12-31").localeCompare(b.project?.deadline || "9999-12-31"))

    // 资质预警（Q20 配套 / O-006）：已过期 + 30 天内到期证书进「今日必看」overdue 组置顶——
    // 与导出硬拦截同口径，只把"已经出问题/马上要出事"的置顶；90 天内观察项不上置顶条（提示须有出路，route 直达台账）。
    if (qualRisk.urgent > 0) {
      overdue.push({
        id: "qual_alerts",
        group: "overdue",
        category: "qual",
        title: `${qualRisk.urgent} 项资质已过期或 30 天内到期`,
        meta: "资质台账",
        detail: "证书过期直接废标，点击核实",
        route: "/qual-certs",
      })
    }

    return { overdue, dueToday, active, total: overdue.length + dueToday.length + active.length }
  }, [visibleTodos, followDueOpps, projects, nowTick, qualRisk.urgent])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 6) return "夜深了"
    if (hour < 12) return "早上好"
    if (hour < 14) return "中午好"
    if (hour < 18) return "下午好"
    return "晚上好"
  }, [])

  return {
    // 登录态
    userId,
    accountInfo,
    handleAccountChange,
    // 待办
    todoBuckets,
    todosLoading,
    todosCapped,
    todoInput,
    setTodoInput,
    todoDueDate,
    setTodoDueDate,
    addTodo,
    todoAdding,
    toggleTodo,
    deleteTodo,
    // 项目
    projects: sortedProjects,
    projectsLoading,
    projectsCapped,
    newProjectOpen,
    openNewProject,
    closeNewProject,
    projectForm,
    setProjectField,
    submitProject,
    savingProject,
    selectedProject,
    openProjectDetail,
    closeProjectDetail,
    progressDraft,
    setProgressDraft,
    notesDraft,
    setNotesDraft,
    saveProjectDetail,
    savingDetail,
    // 客户概览
    crmStats,
    // 商机漏斗（阶段分布，供 FunnelCard echarts 消费）
    oppFunnel,
    oppFunnelTotal,
    // 循环 9 B1：待跟进商机提醒（今日到期 + 已逾期）
    followDueOpps,
    crmRecentOpps,
    crmLoading,
    // 胜负复盘（轮次 F 轨 2）
    bidReview,
    // 情报
    intelItems,
    intelPendingCount,
    qualRisk,
    intelLoading,
    expandedIntelId,
    toggleIntel,
    // 活动流
    activityEvents,
    activityLoading,
    // 工作台进行中事项（R196 聚合卡 / R197 顶部数字与明细 / R302 计数下限口径）
    activeWork,
    activeWorkTotal,
    activeWorkByKind,
    activeWorkTruncated,
    activeWorkExact,
    activeWorkCaveat,
    activeWorkLoading,
    // 派生
    mustSee,
    activeProjectCount,
    pendingTodoCount,
    doneTodoCount,
    overdueTodoCount,
    greeting,
  }
}
