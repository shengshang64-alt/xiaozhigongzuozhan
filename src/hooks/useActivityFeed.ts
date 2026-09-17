import { useCallback, useEffect, useState } from "react"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { BID_STAGE_LABEL, STAGE_LABEL, type OppStage } from "@/pages/CustomerManagement/customerTypes"

// ---------------------------------------------------------------------------
// 首页活动流 Logic 层：跨实体客户端聚合（零后端改动）。
// 并行拉取 客户 / 商机 / 跟进记录 / 标书项目 / 方案 / 情报 的最新动态，
// 映射为统一事件后按时间倒序取前 20 条。全部失败时返回空列表，不阻塞首页。
// ---------------------------------------------------------------------------

export type ActivityKind = "customer" | "opportunity" | "follow" | "bid" | "solution" | "intel"

export type ActivityEvent = {
  id: string
  kind: ActivityKind
  title: string
  desc: string
  time: string
  timeLabel: string
  route: string
}

const PER_ENTITY = 8
const MAX_EVENTS = 20

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}${path}`, {
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type ListResponse<T> = { items: T[] }

export function formatRelativeTime(iso: string): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function useActivityFeed(userId: string | null) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [feedLoading, setFeedLoading] = useState(false)

  const loadFeed = useCallback(async (uid: string) => {
    setFeedLoading(true)
    const enc = encodeURIComponent(uid)
    const [custRes, oppRes, followRes, bidRes, solRes, intelRes] = await Promise.all([
      apiFetch<ListResponse<{ id: string; hospital_name: string; hospital_type: string; region: string; created: string }>>(
        `/api/customers?rh_user_id=${enc}&perPage=${PER_ENTITY}&sort=-created`,
      ),
      apiFetch<ListResponse<{ id: string; opp_name: string; customer_name: string; stage: string; updated: string }>>(
        `/api/opportunities?rh_user_id=${enc}&perPage=${PER_ENTITY}&sort=-updated`,
      ),
      apiFetch<ListResponse<{ id: string; customer_id: string; record_type: string; content: string; created: string }>>(
        `/api/follow_records?rh_user_id=${enc}&perPage=${PER_ENTITY}&sort=-created`,
      ),
      apiFetch<ListResponse<{ id: string; project_name: string; hospital: string; stage: string; updated: string }>>(
        `/api/bid_projects?rh_user_id=${enc}&perPage=${PER_ENTITY}&sort=-updated`,
      ),
      apiFetch<ListResponse<{ id: string; solution_name: string; hospital: string; created: string }>>(
        `/api/solutions?rh_user_id=${enc}&perPage=${PER_ENTITY}&sort=-created`,
      ),
      apiFetch<ListResponse<{ id: string; title: string; source_name: string; published_at: string; created: string }>>(
        `/api/intel/items?item_status=pending,confirmed&page=1&per_page=${PER_ENTITY}`,
      ),
    ])

    const merged: ActivityEvent[] = []
    const push = (e: Omit<ActivityEvent, "timeLabel"> & { time: string }) => {
      if (!e.time) return
      merged.push({ ...e, timeLabel: formatRelativeTime(e.time) })
    }

    for (const c of custRes?.items ?? []) {
      push({
        id: `customer_${c.id}`,
        kind: "customer",
        title: "新增客户",
        desc: [c.hospital_name, [c.hospital_type, c.region].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
        time: c.created,
        route: `/customer-management?customer=${c.id}`,
      })
    }
    for (const o of oppRes?.items ?? []) {
      push({
        id: `opp_${o.id}`,
        kind: "opportunity",
        title: "商机动态",
        desc: [o.opp_name, o.customer_name, STAGE_LABEL[(o.stage || "lead") as OppStage] ?? o.stage]
          .filter(Boolean)
          .join(" · "),
        time: o.updated,
        route: `/customer-management?opp=${o.id}`,
      })
    }
    for (const f of followRes?.items ?? []) {
      push({
        id: `follow_${f.id}`,
        kind: "follow",
        title: `跟进记录 · ${f.record_type || "跟进"}`,
        desc: (f.content ?? "").replace(/\s+/g, " ").slice(0, 48),
        time: f.created,
        route: f.customer_id ? `/customer-management?customer=${f.customer_id}` : "/customer-management",
      })
    }
    for (const b of bidRes?.items ?? []) {
      push({
        id: `bid_${b.id}`,
        kind: "bid",
        title: "标书项目推进",
        desc: [b.project_name, b.hospital, BID_STAGE_LABEL[b.stage] ?? b.stage].filter(Boolean).join(" · "),
        time: b.updated,
        route: `/bid-workspace?project=${b.id}`,
      })
    }
    for (const s of solRes?.items ?? []) {
      push({
        id: `solution_${s.id}`,
        kind: "solution",
        title: "新方案创建",
        desc: [s.solution_name, s.hospital].filter(Boolean).join(" · "),
        time: s.created,
        route: `/solution-studio?solution=${s.id}`,
      })
    }
    for (const it of intelRes?.items ?? []) {
      push({
        id: `intel_${it.id}`,
        kind: "intel",
        title: "情报采集",
        desc: [it.title, it.source_name].filter(Boolean).join(" · "),
        time: it.published_at || it.created,
        route: `/intel-center?item=${it.id}`,
      })
    }

    merged.sort((a, b) => (b.time || "").localeCompare(a.time || ""))
    setEvents(merged.slice(0, MAX_EVENTS))
    setFeedLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) {
      setEvents([])
      setFeedLoading(false)
      return
    }
    void loadFeed(userId)
  }, [userId, loadFeed])

  return { activityEvents: events, activityLoading: feedLoading }
}
