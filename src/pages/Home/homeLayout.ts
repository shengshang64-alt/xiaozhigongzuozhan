import type { ActivityEvent } from "@/hooks/useActivityFeed"
import type { QualRiskView } from "@/pages/QualCerts/qualsCore"
import type { MustSeeItem, MustSeeToday, ProjectItem } from "./useHome"

// ---------------------------------------------------------------------------
// 首页 Phase 1 改版（UI/UX 升级）的派生逻辑层：全部纯函数，可脱离 React 单测。
// 数据一律来自 useHome 已拉取的 mustSee / projects / activityEvents，零新增请求。
// 展示组件（NewKeyMetrics / PriorityTasksBoard / CompactProgressPanel）只消费这里
// 的产出，不再各自写排序 / 过滤，保证口径单点维护。
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

/** 本地时区「今天 0 点」的时间戳（与 useHome.startOfTodayMs 同口径，独立导出供纯函数使用） */
export function todayStartMs(nowMs: number): number {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ------------------------------ 优先级任务看板 ------------------------------

export type PriorityTask = {
  id: string
  group: MustSeeItem["group"]
  title: string
  meta: string
  detail: string
  /** 非 project 项的深链路由（可能为空，空则按钮退化为打开项目详情 / 不可点） */
  route: string | null
  /** project 项的进度（0-100），其余为 null */
  progress: number | null
  /** project 项携带原记录，供「查看」打开项目详情弹框 */
  project: ProjectItem | null
}

/**
 * 今日优先任务：逾期 → 今日到期 → 进行中（按截止日升序，mustSee 已排好）取前 N 项。
 * 「当天最重要的 3 件事」就是本函数的产出顺序，不要在展示层二次排序。
 */
export function priorityTasksOf(mustSee: MustSeeToday, limit = 3): PriorityTask[] {
  const ordered: MustSeeItem[] = [...mustSee.overdue, ...mustSee.dueToday, ...mustSee.active]
  return ordered.slice(0, Math.max(0, limit)).map((item) => ({
    id: item.id,
    group: item.group,
    title: item.title,
    meta: item.meta,
    detail: item.detail,
    route: item.route ?? null,
    progress: item.project ? item.project.progress : null,
    project: item.project ?? null,
  }))
}

// ------------------------------ 关键指标卡 ------------------------------

export type KeyMetricSeverity = "danger" | "warning" | "info"

export type KeyMetricSpec = {
  key: "qual" | "intel" | "deadline"
  title: string
  /** null 表示「无数据」而非 0，展示为「—」 */
  value: number | null
  unit: string
  /** 一行明细，必须说清口径（不能只给数字让人猜） */
  detail: string
  severity: KeyMetricSeverity
  actionLabel: string
}

export type DeadlineInfo = {
  projectId: string
  name: string
  hospital: string
  /** YYYY-MM-DD */
  deadline: string
  daysLeft: number
}

/** 截止日紧迫度分档：≤3 天危险、≤7 天关注、其余平静 */
export function deadlineToneOf(daysLeft: number): KeyMetricSeverity {
  if (daysLeft <= 3) return "danger"
  if (daysLeft <= 7) return "warning"
  return "info"
}

/**
 * 进行中项目里最近的未来截止日（已逾期项走 mustSee 的 overdue 组置顶，不进指标卡）。
 * 无截止日 / 已完成 / 日期非法的项目一律跳过。
 */
export function nearestDeadlineOf(projects: ProjectItem[], todayStart: number): DeadlineInfo | null {
  let best: DeadlineInfo | null = null
  for (const p of projects) {
    if (p.progress >= 100) continue
    const dl = (p.deadline || "").slice(0, 10)
    if (!dl) continue
    const t = new Date(`${dl}T00:00:00`).getTime()
    if (Number.isNaN(t)) continue
    const daysLeft = Math.round((t - todayStart) / DAY_MS)
    if (daysLeft < 0) continue
    if (!best || daysLeft < best.daysLeft || (daysLeft === best.daysLeft && dl < best.deadline)) {
      best = { projectId: p.id, name: p.project_name, hospital: p.hospital, deadline: dl, daysLeft }
    }
  }
  return best
}

/**
 * 首页三张关键指标卡（资质预警 / 情报待确认 / 最近投标截止）。
 * 资质口径与驾驶舱 qualRiskView 逐字一致：value 展示紧急数（已过期 + 30 天内），
 * 90 天内观察量体现在明细行；无紧急但有观察时 severity 用 warning 提示「值得看一眼」。
 */
export function keyMetricsOf(
  qualRisk: QualRiskView,
  intelPendingCount: number,
  deadline: DeadlineInfo | null,
): KeyMetricSpec[] {
  const qualSeverity: KeyMetricSeverity =
    qualRisk.urgent > 0 ? "danger" : qualRisk.watch > 0 ? "warning" : "info"
  return [
    {
      key: "qual",
      title: "资质预警",
      value: qualRisk.urgent,
      unit: "项",
      detail: qualRisk.total > 0 ? qualRisk.line : "暂无过期或临期证书",
      severity: qualSeverity,
      actionLabel: qualRisk.urgent > 0 ? "立即核实" : "查看资质台账",
    },
    {
      key: "intel",
      title: "情报待确认",
      value: intelPendingCount,
      unit: "条",
      detail: "最近 20 条抓取中待本人确认的情报数",
      severity: "info",
      actionLabel: "进入情报中心",
    },
    deadline
      ? {
          key: "deadline",
          title: "最近投标截止",
          value: deadline.daysLeft,
          unit: "天",
          detail: `${deadline.name} · ${deadline.deadline} 截止`,
          severity: deadlineToneOf(deadline.daysLeft),
          actionLabel: "查看项目",
        }
      : {
          key: "deadline",
          title: "最近投标截止",
          value: null,
          unit: "天",
          detail: "暂无带截止日期的进行中项目",
          severity: "info",
          actionLabel: "去登记项目",
        },
  ]
}

// ------------------------------ 紧凑进度面板 ------------------------------

/**
 * 活动流里「今天」的事件。事件 time 是 PocketBase 原始串（空格分隔或 ISO 皆可能），
 * 统一取前 10 位日历日与本地今天比对（与 useHome 月份过滤同款手法，不做时区换算）。
 */
export function eventsTodayOf(events: ActivityEvent[], nowMs: number): ActivityEvent[] {
  const d = new Date(nowMs)
  const pad = (n: number) => String(n).padStart(2, "0")
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return events.filter((e) => (e.time || "").slice(0, 10) === today)
}

/** 进行中面板最多展示条数（驾驶舱是总览不是清单，超出提示看完整列表） */
export const PROGRESS_PANEL_LIMIT = 5
