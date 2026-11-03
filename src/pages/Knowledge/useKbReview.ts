// ---------------------------------------------------------------------------
// 知识原子审核台 · 数据层（2026-10-30 知识库 P0-5 UI）
//
// 为什么单独一个 hook：审核台的交互逻辑很重（队列/快捷键/撤销/批量），
// 塞进 useKnowledge（1873 行）会让那个文件彻底失控。
//
// 关键设计：
//   · 所有状态变更都走 PB 路由（review 路由含状态机校验，前端不自己造状态）
//   · 乐观更新 + 失败回滚（审核是高频操作，等网络会打断节奏）
//   · 撤销栈只留最近一条（§7.2 的 U 键是"救手滑"，不是完整历史）
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import type { AtomType, AtomStatus } from "./kbAtoms"
import {
  applyFilter,
  canApprove,
  canUndo,
  mapKeyToAction,
  planAllBatches,
  sortForReview,
  type BatchPlan,
  type RejectReason,
  type ReviewAtom,
  type ReviewFilter,
  type UndoEntry,
} from "./kbReview"

/** PB /api/kb/atoms/pending 返回的原始形态 */
type PendingRaw = {
  id: string
  atom_type: string
  title: string
  body: string
  subject_key: string
  confidence: number
  kb_track: string
  kb_bucket: string
  usable_for: string[]
  source_doc_id: string
  source_anchor: string
  source_quote: string
  conflict_group: string
  valid_until: string
}

function toReviewAtom(r: PendingRaw): ReviewAtom {
  return {
    id: r.id,
    atomType: (r.atom_type || "fact") as AtomType,
    title: r.title ?? "",
    body: r.body ?? "",
    subjectKey: r.subject_key ?? "",
    confidence: Number(r.confidence ?? 0),
    kbTrack: r.kb_track ?? "",
    kbBucket: r.kb_bucket ?? "",
    kbSection: "",
    usableFor: Array.isArray(r.usable_for) ? r.usable_for : [],
    sourceDocId: r.source_doc_id ?? "",
    docName: "",
    sourceAnchor: r.source_anchor ?? "",
    sourceQuote: r.source_quote ?? "",
    conflictGroup: r.conflict_group ?? "",
    validUntil: r.valid_until ?? "",
    contentStatus: "pending" as AtomStatus,
    version: 1,
    usageCount: 0,
    createdAt: new Date().toISOString(),
  }
}

async function pbFetch<T>(path: string, opts?: { method?: string; body?: unknown; userId?: string | null }): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.userId ? { "X-Rh-User-Id": opts.userId } : {}),
      ...vibexAuthHeaders(),
    },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}${text ? `：${text.slice(0, 160)}` : ""}`)
  }
  return (await res.json()) as T
}

export function useKbReview(userId: string | null) {
  const [queue, setQueue] = useState<ReviewAtom[]>([])
  const [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0)
  const [filter, setFilterRaw] = useState<ReviewFilter>("all")
  // 切换筛选时同步重置游标（不用 effect，避免级联渲染）
  const setFilter = useCallback((f: ReviewFilter) => {
    setFilterRaw(f)
    setIndex(0)
  }, [])
  const [selectedUsableFor, setSelectedUsableFor] = useState<string[]>([])
  const [sourceOpen, setSourceOpen] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const [batchPlans, setBatchPlans] = useState<BatchPlan[]>([])

  /** 加载待审队列 */
  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const data = await pbFetch<{ ok: boolean; items?: PendingRaw[] }>("/api/kb/atoms/pending?limit=200", { userId })
      const list = (data.items ?? []).map(toReviewAtom)
      setQueue(list)
      setBatchPlans(planAllBatches(list))
    } catch (e) {
      toast.error(`待审队列加载失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [userId])

  // 首次挂载时加载队列。用 setTimeout(0) 让 setState 发生在微任务之后，
  // 满足 React 编译器"effect 内不同步 setState"的规则。
  useEffect(() => {
    const t = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const filtered = useMemo(() => sortForReview(applyFilter(queue, filter)), [queue, filter])
  const current = filtered[Math.min(index, Math.max(0, filtered.length - 1))] ?? null



  // -------------------------------------------------------------------------
  // 审核动作
  // -------------------------------------------------------------------------

  /** 通用的原子状态变更（乐观更新 + 失败回滚） */
  const mutateAtom = useCallback(
    async (atomId: string, body: Record<string, unknown>, optimistic: (a: ReviewAtom) => ReviewAtom) => {
      const before = queue.find((a) => a.id === atomId)
      if (!before) return
      // 乐观更新
      setQueue((prev) => prev.map((a) => (a.id === atomId ? optimistic(a) : a)))
      try {
        await pbFetch(`/api/kb/atoms/${atomId}/review`, { method: "POST", body, userId })
        return true
      } catch (e) {
        // 回滚
        setQueue((prev) => prev.map((a) => (a.id === atomId ? before : a)))
        toast.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)
        return false
      }
    },
    [queue, userId],
  )

  /** 通过（必须先勾用途） */
  const approve = useCallback(async () => {
    if (!current) return
    const gate = canApprove(current, selectedUsableFor)
    if (!gate.ok) {
      toast.error(gate.reason ?? "请先勾选用途")
      return
    }
    const entry: UndoEntry = {
      atomId: current.id,
      prevStatus: current.contentStatus,
      prevUsableFor: current.usableFor,
      action: "approve",
      at: Date.now(),
    }
    const ok = await mutateAtom(
      current.id,
      { action: "approve", usable_for: selectedUsableFor },
      (a) => ({ ...a, contentStatus: "approved", usableFor: selectedUsableFor }),
    )
    if (ok) {
      setUndoEntry(entry)
      // 从队列移除已处理的（保持队列只含待审）
      setQueue((prev) => prev.filter((a) => a.id !== current.id))
      toast.success("已通过")
    }
  }, [current, selectedUsableFor, mutateAtom])

  /**
   * 批量采纳用途推荐并通过（2026-11-01 吞吐优化）。
   *
   * 与 P3 原则的关系：
   *   · 用途来自 recommendUsableFor 的建议，**已在界面上展示**给审核人看
   *   · 审核人点这个按钮即表示确认采纳（不是无人确认的自动入库）
   *   · 逐条调用 mutateAtom 保持与单条通过同一条服务端路径（不绕过门禁）
   */
  const bulkAdoptApprove = useCallback(
    async (items: { id: string; usableFor: string[] }[]) => {
      if (!items.length) return
      let ok = 0
      let fail = 0
      for (const it of items) {
        const done = await mutateAtom(
          it.id,
          { action: "approve", usable_for: it.usableFor },
          (a) => ({ ...a, contentStatus: "approved", usableFor: it.usableFor }),
        )
        if (done) ok += 1
        else fail += 1
      }
      const ids = new Set(items.map((i) => i.id))
      setQueue((prev) => prev.filter((a) => !ids.has(a.id)))
      if (ok) toast.success(`已批量通过 ${ok} 条${fail ? `（${fail} 条失败）` : ""}`)
      else toast.error("批量通过失败，请检查网络后重试")
    },
    [mutateAtom],
  )

  /** 驳回（5 选 1 原因） */
  const reject = useCallback(
    async (reason: RejectReason) => {
      if (!current) return
      const entry: UndoEntry = {
        atomId: current.id,
        prevStatus: current.contentStatus,
        prevUsableFor: current.usableFor,
        action: "reject",
        at: Date.now(),
      }
      const ok = await mutateAtom(
        current.id,
        { action: "reject", reason },
        (a) => ({ ...a, contentStatus: "rejected" }),
      )
      if (ok) {
        setUndoEntry(entry)
        setQueue((prev) => prev.filter((a) => a.id !== current.id))
        toast.success(`已驳回（${reason}）`)
      }
    },
    [current, mutateAtom],
  )

  /** 改原子类型（数字键 1-8） */
  const setAtomType = useCallback(
    async (type: AtomType) => {
      if (!current) return
      const ok = await mutateAtom(current.id, { action: "edit", atom_type: type }, (a) => ({ ...a, atomType: type }))
      if (ok) toast.success(`已改为「${type}」`)
    },
    [current, mutateAtom],
  )

  /** 撤销（10 秒内） */
  const undo = useCallback(async () => {
    const entry = undoEntry
    if (!entry || !canUndo(entry)) {
      toast.info("没有可撤销的操作（限 10 秒内）")
      return
    }
    try {
      // 恢复到 pending
      await pbFetch(`/api/kb/atoms/${entry.atomId}/review`, {
        method: "POST",
        body: { action: "edit", content_status: "pending", usable_for: entry.prevUsableFor },
        userId,
      })
      setUndoEntry(null)
      await load()
      toast.success("已撤销")
    } catch (e) {
      toast.error(`撤销失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [userId, load, undoEntry])

  // -------------------------------------------------------------------------
  // 键盘快捷键（§7.2）
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ""
      const inEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target?.isContentEditable)
      const action = mapKeyToAction(e.key, { inEditable })
      if (action.kind === "none") return
      e.preventDefault()
      switch (action.kind) {
        case "approve":
          void approve()
          break
        case "reject":
          // R 键直接驳回为「不适用」太快，这里弹出原因选择（用 toast 带按钮过度复杂，
          // 改为聚焦到原因选择区——由 UI 层处理，这里只派发事件）
          window.dispatchEvent(new CustomEvent("kb-review-focus-reject"))
          break
        case "edit":
          window.dispatchEvent(new CustomEvent("kb-review-focus-edit"))
          break
        case "setType":
          void setAtomType(action.type)
          break
        case "next":
          setIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)))
          break
        case "prev":
          setIndex((i) => Math.max(0, i - 1))
          break
        case "undo":
          void undo()
          break
        case "focusUsableFor":
          window.dispatchEvent(new CustomEvent("kb-review-focus-usable"))
          break
        case "toggleSource":
          setSourceOpen((v) => !v)
          break
        case "help":
          setShowHelp((v) => !v)
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [approve, setAtomType, undo, filtered.length])

  // -------------------------------------------------------------------------
  // 批量操作执行
  // -------------------------------------------------------------------------
  const runBatch = useCallback(
    async (plan: BatchPlan) => {
      try {
        if (plan.kind === "dedupeGroup") {
          // 保留的通过，其余标 superseded
          await pbFetch(`/api/kb/atoms/${plan.keepId}/review`, {
            method: "POST",
            body: { action: "approve", usable_for: ["proposal"] },
            userId,
          })
          for (const id of plan.supersedeIds) {
            await pbFetch(`/api/kb/atoms/${id}/review`, {
              method: "POST",
              body: { action: "edit", content_status: "superseded" },
              userId,
            })
          }
          toast.success(`已处理 ${plan.supersedeIds.length + 1} 条同组原子`)
        } else {
          for (const id of plan.atomIds) {
            await pbFetch(`/api/kb/atoms/${id}/review`, {
              method: "POST",
              body: { action: "reject", reason: plan.kind === "rejectJunk" ? "套话" : "不适用" },
              userId,
            })
          }
          toast.success(`已批量驳回 ${plan.atomIds.length} 条`)
        }
        await load()
      } catch (e) {
        toast.error(`批量操作失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [userId, load],
  )

  // 撤销可用性：不在 render 里读 Date.now()（React 纯度规则），
  // 改为在用户动作时判定——点击撤销按钮时实时校验是否还在 10 秒窗口内。
  // 界面只显示"可撤销"，不显示秒级倒计时（少一个定时器，也少一类 bug）。
  const undoAvailable = Boolean(undoEntry)

  return {
    queue,
    filtered,
    current,
    index,
    setIndex,
    loading,
    filter,
    setFilter,
    selectedUsableFor,
    setSelectedUsableFor,
    sourceOpen,
    setSourceOpen,
    showHelp,
    setShowHelp,
    undoEntry,
    undoAvailable,
    batchPlans,
    load,
    approve,
    bulkAdoptApprove,
    reject,
    setAtomType,
    undo,
    runBatch,
  }
}
