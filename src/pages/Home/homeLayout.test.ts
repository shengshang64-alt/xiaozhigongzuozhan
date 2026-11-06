import { describe, expect, it } from "vitest"
import type { ActivityEvent } from "@/hooks/useActivityFeed"
import type { QualRiskView } from "@/pages/QualCerts/qualsCore"
import {
  deadlineToneOf,
  eventsTodayOf,
  keyMetricsOf,
  nearestDeadlineOf,
  priorityTasksOf,
  todayStartMs,
} from "./homeLayout"
import type { MustSeeItem, MustSeeToday, ProjectItem } from "./useHome"

// ---------------------------------------------------------------------------
// Phase 1 改版派生逻辑的口径钉子（homeLayout.ts）：优先任务排序、最近截止日、
// 指标卡语义、今日事件过滤。全部纯函数，node 环境直接跑。
// ---------------------------------------------------------------------------

const TODAY_START = todayStartMs(new Date(2026, 10, 7, 15, 30).getTime()) // 2026-11-07 15:30 → 当天 0 点
const DAY = 86_400_000

function makeProject(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: "p1",
    rh_user_id: "u1",
    project_name: "某医院智慧病房方案",
    project_type: "方案",
    hospital: "某医院",
    progress: 40,
    deadline: "2026-11-14",
    notes: "",
    created: "2026-11-01 10:00:00.000Z",
    updated: "2026-11-05 10:00:00.000Z",
    ...overrides,
  }
}

function makeItem(overrides: Partial<MustSeeItem> = {}): MustSeeItem {
  return {
    id: "item_1",
    group: "active",
    category: "project",
    title: "待办标题",
    meta: "待办",
    detail: "今天到期",
    ...overrides,
  }
}

function makeMustSee(overrides: Partial<MustSeeToday> = {}): MustSeeToday {
  return {
    overdue: [],
    dueToday: [],
    active: [],
    total: 0,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    kind: "bid",
    title: "标书更新",
    desc: "解析完成",
    time: "2026-11-07 09:30:00.000Z",
    timeLabel: "09:30",
    route: "/bid-workspace",
    ...overrides,
  }
}

describe("todayStartMs：本地时区当天 0 点", () => {
  it("去掉时分秒", () => {
    expect(new Date(TODAY_START).getHours()).toBe(0)
    expect(new Date(TODAY_START).getMinutes()).toBe(0)
    expect(new Date(TODAY_START).getDate()).toBe(7)
    expect(new Date(TODAY_START).getMonth()).toBe(10)
  })
})

describe("priorityTasksOf：逾期 → 今日到期 → 进行中，取前 N 项", () => {
  it("按组优先级排序，project 项带出进度", () => {
    const mustSee = makeMustSee({
      overdue: [makeItem({ id: "o1", group: "overdue", title: "逾期待办" })],
      dueToday: [makeItem({ id: "d1", group: "dueToday", title: "今日到期" })],
      active: [makeItem({ id: "a1", title: "推进项目", project: makeProject({ progress: 45 }) })],
      total: 3,
    })
    const tasks = priorityTasksOf(mustSee, 3)
    expect(tasks.map((t) => t.id)).toEqual(["o1", "d1", "a1"])
    expect(tasks[2].progress).toBe(45)
    expect(tasks[2].project?.progress).toBe(45)
    expect(tasks[0].progress).toBeNull()
  })

  it("超出 limit 截断，limit=0 返回空", () => {
    const mustSee = makeMustSee({
      overdue: [makeItem({ id: "o1", group: "overdue" }), makeItem({ id: "o2", group: "overdue" })],
      total: 2,
    })
    expect(priorityTasksOf(mustSee, 1).map((t) => t.id)).toEqual(["o1"])
    expect(priorityTasksOf(mustSee, 0)).toEqual([])
  })
})

describe("nearestDeadlineOf：最近未来截止的进行中项目", () => {
  it("取最近的未来截止日；跳过已完成 / 无截止日 / 已逾期", () => {
    const projects = [
      makeProject({ id: "done", progress: 100, deadline: "2026-11-08" }),
      makeProject({ id: "nodate", deadline: "" }),
      makeProject({ id: "past", deadline: "2026-11-01" }),
      makeProject({ id: "near", deadline: "2026-11-10" }),
      makeProject({ id: "far", deadline: "2026-12-01" }),
    ]
    const best = nearestDeadlineOf(projects, TODAY_START)
    expect(best?.projectId).toBe("near")
    expect(best?.daysLeft).toBe(3)
  })

  it("全部不可用 / 空列表返回 null", () => {
    expect(nearestDeadlineOf([], TODAY_START)).toBeNull()
    expect(nearestDeadlineOf([makeProject({ progress: 100 })], TODAY_START)).toBeNull()
  })

  it("同天并列时取日期串更早者（稳定性）", () => {
    const projects = [
      makeProject({ id: "b", deadline: "2026-11-10" }),
      makeProject({ id: "a", deadline: "2026-11-10" }),
    ]
    expect(nearestDeadlineOf(projects, TODAY_START)?.projectId).toBe("b")
  })
})

describe("deadlineToneOf：≤3 天危险、≤7 天关注、其余平静", () => {
  it("分档边界", () => {
    expect(deadlineToneOf(0)).toBe("danger")
    expect(deadlineToneOf(3)).toBe("danger")
    expect(deadlineToneOf(4)).toBe("warning")
    expect(deadlineToneOf(7)).toBe("warning")
    expect(deadlineToneOf(8)).toBe("info")
  })
})

describe("keyMetricsOf：三张指标卡口径", () => {
  it("有紧急资质风险 → danger + 紧急数 + 分档明细", () => {
    const risk: QualRiskView = { urgent: 4, watch: 25, total: 29, line: "已过期 1 · 30 天内到期 3 · 90 天内到期 25" }
    const [qual] = keyMetricsOf(risk, 29, null)
    expect(qual.severity).toBe("danger")
    expect(qual.value).toBe(4)
    expect(qual.detail).toContain("已过期 1")
    expect(qual.detail).toContain("90 天内到期 25")
  })

  it("无紧急但有观察量 → value 为紧急数 0 但 severity 用 warning 提示值得看一眼", () => {
    const risk: QualRiskView = { urgent: 0, watch: 25, total: 25, line: "90 天内到期 25" }
    const [qual] = keyMetricsOf(risk, 0, null)
    expect(qual.value).toBe(0)
    expect(qual.severity).toBe("warning")
  })

  it("完全无风险 → info + 「暂无过期或临期证书」", () => {
    const risk: QualRiskView = { urgent: 0, watch: 0, total: 0, line: "" }
    const [qual] = keyMetricsOf(risk, 0, null)
    expect(qual.severity).toBe("info")
    expect(qual.detail).toBe("暂无过期或临期证书")
  })

  it("有最近截止 → 天数 + 项目名；无 → value null + 引导文案", () => {
    const [, intel, withDeadline] = keyMetricsOf({ urgent: 0, watch: 0, total: 0, line: "" }, 12, {
      projectId: "p1",
      name: "某方案",
      hospital: "某医院",
      deadline: "2026-11-10",
      daysLeft: 3,
    })
    expect(intel.value).toBe(12)
    expect(withDeadline.value).toBe(3)
    expect(withDeadline.detail).toContain("某方案")
    expect(withDeadline.severity).toBe("danger")

    const withoutDeadline = keyMetricsOf({ urgent: 0, watch: 0, total: 0, line: "" }, 0, null)[2]
    expect(withoutDeadline.value).toBeNull()
    expect(withoutDeadline.detail).toBe("暂无带截止日期的进行中项目")
  })
})

describe("eventsTodayOf：活动流按日历日过滤「今天」", () => {
  it("兼容 PB 空格分隔串与 ISO 串；跨天排除", () => {
    const events = [
      makeEvent({ id: "today-space", time: "2026-11-07 09:30:00.000Z" }),
      makeEvent({ id: "today-iso", time: "2026-11-07T22:10:00.000Z" }),
      makeEvent({ id: "yesterday", time: "2026-11-06 18:00:00.000Z" }),
      makeEvent({ id: "empty", time: "" }),
    ]
    const today = eventsTodayOf(events, TODAY_START + DAY - 1)
    expect(today.map((e) => e.id)).toEqual(["today-space", "today-iso"])
  })
})
