import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { decodeRhToken } from "@/lib/rhLogin"
import { pbJsonGet } from "@/lib/pbJson"
import { listKbDocs, visibleKbDocs } from "@/lib/kbCore"
import { STAGE_LABEL, type OppStage } from "@/pages/CustomerManagement/customerTypes"

// ---------------------------------------------------------------------------
// 全局命令面板 Logic 层：Cmd+K 打开、最近访问记录、跨实体聚合检索（300ms 防抖）。
// View（GlobalCommandPalette.tsx）只消费本 hook 返回的 props。
// ---------------------------------------------------------------------------

export type SearchResultItem = {
  id: string
  title: string
  subtitle: string
  route: string
}

export type SearchResultGroup = {
  key: "customer" | "opportunity" | "intel" | "bid" | "solution" | "deck" | "quote" | "kb"
  label: string
  moreRoute: string
  items: SearchResultItem[]
}

export type RecentPage = { path: string; label: string }

export type PageNavItem = { path: string; label: string; keywords: string[] }

export const PAGE_NAV: PageNavItem[] = [
  { path: "/", label: "工作台首页", keywords: ["首页", "home", "工作台", "总览", "待办"] },
  { path: "/solution-studio", label: "方案编制", keywords: ["方案", "solution", "编制", "文档"] },
  { path: "/product-mapping", label: "产品映射", keywords: ["产品映射", "ONE-LINK", "对照", "映射", "建设清单"] },
  { path: "/bid-workspace", label: "标书工作", keywords: ["标书", "投标", "招标", "bid", "tender"] },
  { path: "/ppt-quote", label: "PPT 与报价", keywords: ["ppt", "报价", "幻灯片", "quote", "幻灯"] },
  { path: "/materials", label: "素材库", keywords: ["素材", "图片", "架构图", "截图", "图库", "material"] },
  { path: "/intel-center", label: "情报中心", keywords: ["情报", "资讯", "政策", "intel"] },
  { path: "/competitors", label: "竞品分析", keywords: ["竞品", "竞争对手", "友商", "厂商", "competitor"] },
  { path: "/customer-management", label: "客户管理", keywords: ["客户", "crm", "商机", "医院", "customer"] },
  { path: "/knowledge", label: "知识库", keywords: ["知识", "资料", "文档", "knowledge", "kb"] },
  { path: "/model-config", label: "模型配置", keywords: ["模型", "配置", "设置", "model"] },
  { path: "/assistant", label: "小智助手", keywords: ["小智", "助手", "聊天", "问答", "ai"] },
]

export const QUICK_ACTIONS = [
  { key: "new-solution", label: "新建方案", hint: "去方案编制", route: "/solution-studio" },
  { key: "new-bid", label: "新建投标项目", hint: "去标书工作", route: "/bid-workspace" },
  { key: "new-customer", label: "新建客户", hint: "去客户管理", route: "/customer-management" },
  { key: "new-ppt", label: "新建 PPT", hint: "去 PPT 与报价", route: "/ppt-quote" },
  { key: "new-quote", label: "新建报价", hint: "去 PPT 与报价", route: "/ppt-quote" },
  { key: "ask-assistant", label: "问小智", hint: "打开小智助手", route: "/assistant" },
  { key: "add-intel", label: "录情报", hint: "去情报中心", route: "/intel-center" },
  { key: "qual-certs", label: "资质台账", hint: "去资质台账核验有效期", route: "/qual-certs" },
]

const RECENT_PAGES_KEY = "xz_recent_pages"
const MAX_RECENT_PAGES = 6
const SEARCH_DEBOUNCE_MS = 300
const PER_GROUP_LIMIT = 5
const SEARCH_PER_ENTITY = 8

async function apiFetch<T>(path: string): Promise<T | null> {
  return pbJsonGet<T>(path)
}

type ListResponse<T> = { items: T[] }

function matches(kw: string, ...fields: (string | undefined | null)[]): boolean {
  return fields.some((f) => (f ?? "").toLowerCase().includes(kw))
}

function readRecentPages(): RecentPage[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PAGES_KEY)
    const list = raw ? (JSON.parse(raw) as RecentPage[]) : []
    return Array.isArray(list) ? list.filter((x) => x && x.path && x.label).slice(0, MAX_RECENT_PAGES) : []
  } catch {
    return []
  }
}

export function useGlobalSearch() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<SearchResultGroup[]>([])
  const [searching, setSearching] = useState(false)
  const [recentPages, setRecentPages] = useState<RecentPage[]>([])
  const searchSeqRef = useRef(0)

  // ------------------------------ 全局快捷键 Cmd+K / Ctrl+K ------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // ------------------------------ 最近访问记录 ------------------------------
  useEffect(() => {
    const entry = PAGE_NAV.find((p) => p.path === pathname)
    if (!entry) return
    const next = [{ path: entry.path, label: entry.label }, ...readRecentPages().filter((x) => x.path !== entry.path)].slice(
      0,
      MAX_RECENT_PAGES,
    )
    try {
      window.localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next))
    } catch {
      /* localStorage 不可用时静默降级 */
    }
    setRecentPages(next)
  }, [pathname])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setRecentPages(readRecentPages())
    } else {
      setQuery("")
      setGroups([])
      setSearching(false)
    }
  }, [])

  // ------------------------------ 跨实体检索 ------------------------------
  const runSearch = useCallback(async (kw: string, seq: number) => {
    const uid = decodeRhToken()?.sub ?? null
    const nextGroups: SearchResultGroup[] = []
    if (uid) {
      const enc = encodeURIComponent(uid)
      const [custRes, oppRes, intelRes, bidRes, solRes, deckRes, quoteRes, kbRows] = await Promise.all([
        apiFetch<ListResponse<{ id: string; hospital_name: string; hospital_type: string; region: string }>>(
          `/api/customers?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        apiFetch<ListResponse<{ id: string; opp_name: string; customer_name: string; stage: string }>>(
          `/api/opportunities?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        apiFetch<ListResponse<{ id: string; title: string; source_name: string; published_at: string; created: string }>>(
          `/api/intel/items?q=${encodeURIComponent(kw)}&item_status=pending,confirmed&page=1&per_page=${SEARCH_PER_ENTITY}`,
        ),
        apiFetch<ListResponse<{ id: string; project_name: string; hospital: string; deleted_at?: string | null }>>(
          `/api/bid_projects?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        apiFetch<ListResponse<{ id: string; solution_name: string; hospital: string }>>(
          `/api/solutions?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        apiFetch<ListResponse<{ id: string; deck_name: string; audience: string }>>(
          `/api/ppt_decks?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        apiFetch<ListResponse<{ id: string; quote_name: string; ref_name: string }>>(
          `/api/quotes?rh_user_id=${enc}&perPage=${SEARCH_PER_ENTITY}&sort=-updated&q=${encodeURIComponent(kw)}`,
        ),
        // 轮次 C1：kb 走服务端 q=（title/source_file_name like）+ 20 条上限，不再每轮键入全量重拉整库；
        // fields 用 PB 原生参数裁掉 content（单文档可达 50 万字，命令面板不需要全文）。
        // 取舍：服务端 q 不匹配 folder_path/summary，这两字段的命中损失可接受（标题/文件名为主路径）
        listKbDocs({
          q: kw,
          perPage: 20,
          fields: "id,title,folder_path,summary,visibility,rh_user_id,source_file_name,updated,created",
        }).catch(() => null),
      ])
      if (seq !== searchSeqRef.current) return

      // customers/intel/solutions/decks/quotes/kb 的服务端 q= 已收敛结果，前端不做二次过滤；
      // opportunities / bid_projects 的服务端 list 路由不支持 q=（恒返最近 N 条），这两组保留客户端 matches() 兜底（D-1）
      const customers = (custRes?.items ?? []).slice(0, PER_GROUP_LIMIT)
      if (customers.length > 0) {
        nextGroups.push({
          key: "customer",
          label: "客户",
          moreRoute: "/customer-management",
          items: customers.map((c) => ({
            id: c.id,
            title: c.hospital_name || "未命名客户",
            subtitle: [c.hospital_type, c.region].filter(Boolean).join(" · "),
            route: `/customer-management?customer=${c.id}`,
          })),
        })
      }

      const opps = (oppRes?.items ?? [])
        // R003（D-1）：opportunities 服务端不支持 q=，客户端兜底防假阳性（与 bid 组同模式）；服务端支持 q 后可移除
        .filter((o) => matches(kw, o.opp_name, o.customer_name))
        .slice(0, PER_GROUP_LIMIT)
      if (opps.length > 0) {
        nextGroups.push({
          key: "opportunity",
          label: "商机",
          moreRoute: "/customer-management",
          items: opps.map((o) => ({
            id: o.id,
            title: o.opp_name || "未命名商机",
            subtitle: [o.customer_name, STAGE_LABEL[(o.stage || "lead") as OppStage] ?? o.stage]
              .filter(Boolean)
              .join(" · "),
            route: `/customer-management?opp=${o.id}`,
          })),
        })
      }

      const intelRows = intelRes?.items ?? []
      if (intelRows.length > 0) {
        nextGroups.push({
          key: "intel",
          label: "招标情报",
          moreRoute: "/intel-center",
          items: intelRows.map((it) => ({
            id: it.id,
            title: it.title || "未命名情报",
            subtitle: [it.source_name, (it.published_at || it.created || "").slice(0, 10)].filter(Boolean).join(" · "),
            route: `/intel-center?item=${it.id}`,
          })),
        })
      }

      const bids = (bidRes?.items ?? [])
        // 第十一轮改造 1：回收站（deleted_at 非空）项目不进全局搜索
        .filter((b) => !b.deleted_at)
        // 循环7 C2-1：bid_projects 服务端 list 路由不支持 q=（恒返最近 N 条），
        // 仅 bid 组做客户端 includes 二次过滤兜底；服务端支持 q 后可移除本行
        .filter((b) => matches(kw, b.project_name, b.hospital))
        .slice(0, PER_GROUP_LIMIT)
      if (bids.length > 0) {
        nextGroups.push({
          key: "bid",
          label: "标书项目",
          moreRoute: "/bid-workspace",
          items: bids.map((b) => ({
            id: b.id,
            title: b.project_name || "未命名标书项目",
            subtitle: b.hospital || "",
            route: `/bid-workspace?project=${b.id}`,
          })),
        })
      }

      const sols = (solRes?.items ?? []).slice(0, PER_GROUP_LIMIT)
      if (sols.length > 0) {
        nextGroups.push({
          key: "solution",
          label: "方案",
          moreRoute: "/solution-studio",
          items: sols.map((s) => ({
            id: s.id,
            title: s.solution_name || "未命名方案",
            subtitle: s.hospital || "",
            route: `/solution-studio?solution=${s.id}`,
          })),
        })
      }

      const decks = (deckRes?.items ?? []).slice(0, PER_GROUP_LIMIT)
      if (decks.length > 0) {
        nextGroups.push({
          key: "deck",
          label: "PPT",
          moreRoute: "/ppt-quote",
          items: decks.map((d) => ({
            id: d.id,
            title: d.deck_name || "未命名 PPT",
            subtitle: d.audience ? `汇报对象 · ${d.audience}` : "",
            route: `/ppt-quote?deck=${d.id}`,
          })),
        })
      }

      const quotes = (quoteRes?.items ?? []).slice(0, PER_GROUP_LIMIT)
      if (quotes.length > 0) {
        nextGroups.push({
          key: "quote",
          label: "报价",
          moreRoute: "/ppt-quote",
          items: quotes.map((q) => ({
            id: q.id,
            title: q.quote_name || "未命名报价",
            subtitle: q.ref_name ? `关联 ${q.ref_name}` : "",
            route: `/ppt-quote?quote=${q.id}`,
          })),
        })
      }

      // 轮次 C1：q= 服务端模糊匹配已收敛结果，前端不再做 includes 二次过滤（与其他 7 类实体一致）；
      // 个人文档可见性隔离仍在前端做（list 路由不按 rh_user_id 过滤）
      const docs = (kbRows ? visibleKbDocs(kbRows, uid) : []).slice(0, PER_GROUP_LIMIT)
      if (docs.length > 0) {
        nextGroups.push({
          key: "kb",
          label: "知识文档",
          moreRoute: "/knowledge",
          items: docs.map((d) => ({
            id: d.id,
            title: d.title || "未命名文档",
            subtitle: d.folder_path || (d.visibility === "personal" ? "个人笔记" : "团队知识库"),
            route: `/knowledge?doc=${d.id}`,
          })),
        })
      }
    }
    if (seq !== searchSeqRef.current) return
    setGroups(nextGroups)
    setSearching(false)
  }, [])

  useEffect(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) {
      searchSeqRef.current += 1
      setGroups([])
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = searchSeqRef.current + 1
    const timer = window.setTimeout(() => {
      searchSeqRef.current = seq
      void runSearch(kw, seq)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, runSearch])

  // ------------------------------ 导航过滤（关键词别名） ------------------------------
  const filteredNav = useMemo(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) return PAGE_NAV
    return PAGE_NAV.filter(
      (p) => matches(kw, p.label, p.path) || p.keywords.some((k) => k.toLowerCase().includes(kw) || kw.includes(k)),
    )
  }, [query])

  const entityResultCount = useMemo(() => groups.reduce((acc, g) => acc + g.items.length, 0), [groups])
  const hasQuery = query.trim().length > 0
  const noResults = hasQuery && !searching && entityResultCount === 0 && filteredNav.length === 0

  const go = useCallback(
    (route: string) => {
      setOpen(false)
      setQuery("")
      setGroups([])
      setSearching(false)
      navigate(route)
    },
    [navigate],
  )

  const askAssistantRoute = useMemo(
    () => `/assistant?q=${encodeURIComponent(query.trim())}`,
    [query],
  )

  return {
    open,
    handleOpenChange,
    query,
    setQuery,
    groups,
    searching,
    recentPages,
    filteredNav,
    quickActions: QUICK_ACTIONS,
    hasQuery,
    noResults,
    go,
    askAssistantRoute,
  }
}
