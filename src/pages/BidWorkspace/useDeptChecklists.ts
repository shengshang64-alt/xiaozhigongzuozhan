// ---------------------------------------------------------------------------
// 部门检查清单接线层：读 / 一键导入 / 行内编辑（500ms 防抖 + 在飞串行 + 失败可重试）
//
// 落库契约见 bidChecklistStore.ts；这里只做网络与本地状态：
//   - 列表：GET /api/checklists?perPage=200（既有引擎 endpooint，服务端按登录用户过滤），
//     客户端只保留本类（source_mode = "dept_check"）且 project_id = 当前项目的记录；
//   - 导入：POST /api/checklists（既有字段，零 schema 变更），同一项目同一清单定义幂等；
//   - 编辑：PATCH /api/checklists/{id}，只送 items + rating_targets 两列。
// 保存语义与既有建设清单同口径：saving 徽标 / 失败可点重试 / 防抖归并连续键入。
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { pbJsonRequest } from "@/lib/pbJson"
import { decodeRhToken } from "@/lib/rhLogin"
import {
  DEPT_CHECK_SAVE_DEBOUNCE_MS,
  applyDeptCheckRowPatch,
  buildDeptCheckCreateBody,
  buildDeptCheckPatchBody,
  describeDeptCheckMetaChange,
  describeDeptCheckRowChange,
  findDeptCheckDoc,
  pushDeptCheckLog,
  readDeptCheckDoc,
  withDeptCheckDate,
  withDeptCheckHeader,
  withDeptCheckResult,
  withDeptCheckReviseReason,
  withDeptCheckSignature,
  type DeptCheckCellPatch,
  type DeptCheckDoc,
  type DeptCheckGroup,
} from "@/pages/BidWorkspace/bidChecklistStore"
import { deptChecklistDef, type DeptCheckMeta, type DeptCheckSignature } from "@/pages/BidWorkspace/bidChecklists"

type ListResponse = { items?: unknown[] }

export type SaveState = "idle" | "saving" | "error"

export type UseDeptChecklists = {
  /** 首次加载中（面板挂载即拉一次） */
  loading: boolean
  /** 正在导入的清单 key（防重复点击） */
  importing: string | null
  saveState: SaveState
  docs: DeptCheckDoc[]
  docOf: (defKey: string) => DeptCheckDoc | null
  importDef: (defKey: string) => void
  retrySave: () => void
  setRow: (doc: DeptCheckDoc, rid: string, group: DeptCheckGroup, patch: DeptCheckCellPatch) => void
  setHeader: (doc: DeptCheckDoc, field: keyof DeptCheckMeta["header"], value: string) => void
  setCheckDate: (doc: DeptCheckDoc, group: DeptCheckGroup, value: string) => void
  setSignature: (doc: DeptCheckDoc, group: DeptCheckGroup, patch: Partial<DeptCheckSignature>) => void
  setResult: (doc: DeptCheckDoc, result: DeptCheckMeta["result"]) => void
  setReviseReason: (doc: DeptCheckDoc, value: string) => void
}

export function useDeptChecklists(opts: {
  projectId: string
  projectName: string
  /** 操作人（留痕用）；缺省取登录态昵称，再缺省「未知」 */
  operator?: string
}): UseDeptChecklists {
  const { projectId, projectName } = opts
  const [docs, setDocs] = useState<DeptCheckDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")

  // 最新文档镜像（只在事件/异步回调里写，渲染期不读写；供防抖落库取当前值）
  const latestRef = useRef(new Map<string, DeptCheckDoc>())
  // 防抖窗口内累积的留痕文案：一次落库写一条（连续键入不刷屏）
  const pendingWhatsRef = useRef(new Map<string, Set<string>>())
  const timersRef = useRef(new Map<string, number>())
  const inflightRef = useRef(new Set<string>())
  const queuedRef = useRef(new Set<string>())
  /** 保存失败的记录 id（重试时按最新本地状态重发，不重发失败时的旧快照） */
  const failedRef = useRef(new Set<string>())
  const importingKeysRef = useRef(new Set<string>())

  const operator = opts.operator ?? decodeRhToken()?.nickName ?? ""
  const operatorRef = useRef(operator)
  useEffect(() => {
    operatorRef.current = operator
  }, [operator])

  // 挂载/换项目：拉本类记录（loading 初值即 true，避免在 effect 体内同步 setState）
  useEffect(() => {
    let alive = true
    void pbJsonRequest<ListResponse>("/api/checklists?perPage=200")
      .then((data) => {
        if (!alive) return
        const list = (data?.items ?? [])
          .map(readDeptCheckDoc)
          .filter((d): d is DeptCheckDoc => !!d)
          .filter((d) => d.meta.project_id === projectId)
        latestRef.current = new Map(list.map((d) => [d.id, d]))
        setDocs(list)
      })
      .catch(() => {
        if (alive) toast.error("部门检查清单加载失败，请稍后重试")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [projectId])

  // eslint 提示：flush 用 ref 转发，防抖定时器回调永远走最新闭包（operator 变更不会用旧值落库）
  const flushRef = useRef<(id: string) => void>(() => {})

  const flush = useCallback((id: string) => {
    if (inflightRef.current.has(id)) {
      queuedRef.current.add(id)
      return
    }
    const doc = latestRef.current.get(id)
    if (!doc) return
    const whats = pendingWhatsRef.current.get(id)
    pendingWhatsRef.current.delete(id)
    // 留痕：一次落库一条（谁在什么时候改了什么）
    let payload = doc
    if (whats?.size) {
      payload = {
        ...doc,
        meta: pushDeptCheckLog(doc.meta, [
          { at: new Date().toISOString(), by: operatorRef.current || "未知", what: [...whats].join("；") },
        ]),
      }
      latestRef.current.set(id, payload)
      setDocs((prev) => prev.map((d) => (d.id === id ? payload : d)))
    }
    inflightRef.current.add(id)
    void pbJsonRequest<unknown>(`/api/checklists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(buildDeptCheckPatchBody(payload)),
    })
      .then((raw) => {
        failedRef.current.delete(id)
        const saved = readDeptCheckDoc(raw)
        // 只吸收服务端 updated（autodate）；在飞期间若有新编辑，服务端响应已过期，不覆盖本地
        if (saved && latestRef.current.get(id) === payload) {
          const next = { ...payload, updated: saved.updated }
          latestRef.current.set(id, next)
          setDocs((prev) => prev.map((d) => (d.id === id ? next : d)))
        }
      })
      .catch((e) => {
        failedRef.current.add(id)
        setSaveState("error")
        toast.error(`检查清单保存失败：${e instanceof Error ? e.message : "未知原因"}`)
      })
      .finally(() => {
        inflightRef.current.delete(id)
        if (inflightRef.current.size === 0 && pendingWhatsRef.current.size === 0 && failedRef.current.size === 0) {
          setSaveState("idle")
        }
        if (queuedRef.current.delete(id)) flushRef.current(id)
      })
  }, [])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const schedule = useCallback((id: string) => {
    const existing = timersRef.current.get(id)
    if (existing) window.clearTimeout(existing)
    timersRef.current.set(
      id,
      window.setTimeout(() => {
        timersRef.current.delete(id)
        flushRef.current(id)
      }, DEPT_CHECK_SAVE_DEBOUNCE_MS),
    )
  }, [])

  /** 统一改动入口：本地立即更新 + 累加留痕 + 500ms 防抖落库 */
  const mutate = useCallback(
    (doc: DeptCheckDoc, next: DeptCheckDoc, what: string) => {
      latestRef.current.set(doc.id, next)
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? next : d)))
      if (what) {
        const set = pendingWhatsRef.current.get(doc.id) ?? new Set<string>()
        set.add(what)
        pendingWhatsRef.current.set(doc.id, set)
      }
      setSaveState("saving")
      schedule(doc.id)
    },
    [schedule],
  )

  const importDef = useCallback(
    (defKey: string) => {
      const def = deptChecklistDef(defKey)
      if (!def) return
      // 幂等：本项目已有同名清单则不重复导入；也在飞时挡住双击
      if (findDeptCheckDoc([...latestRef.current.values()], projectId, defKey) || importingKeysRef.current.has(defKey)) {
        toast.info("本项目已导入该清单，未重复创建")
        return
      }
      const uid = decodeRhToken()?.sub ?? ""
      importingKeysRef.current.add(defKey)
      setImporting(defKey)
      void pbJsonRequest<unknown>("/api/checklists", {
        method: "POST",
        body: JSON.stringify(buildDeptCheckCreateBody(def, projectId, projectName, uid)),
      })
        .then((raw) => {
          const doc = readDeptCheckDoc(raw)
          if (!doc) {
            toast.error("导入结果无法解析，请刷新后重试")
            return
          }
          latestRef.current.set(doc.id, doc)
          setDocs((prev) => [doc, ...prev])
          toast.success(`已导入「${def.title}」为本项目清单`)
        })
        .catch((e) => {
          toast.error(`导入失败：${e instanceof Error ? e.message : "未知原因"}`)
        })
        .finally(() => {
          importingKeysRef.current.delete(defKey)
          setImporting(null)
        })
    },
    [projectId, projectName],
  )

  const retrySave = useCallback(() => {
    // 只记 id，重发时走 flush 读最新本地状态——失败后用户又改了内容，重试发的是最新一版
    const ids = [...failedRef.current]
    failedRef.current.clear()
    if (!ids.length) {
      setSaveState("idle")
      return
    }
    setSaveState("saving")
    for (const id of ids) flushRef.current(id)
  }, [])

  const docOf = useCallback((defKey: string) => findDeptCheckDoc(docs, projectId, defKey), [docs, projectId])

  const setRow = useCallback(
    (doc: DeptCheckDoc, rid: string, group: DeptCheckGroup, patch: DeptCheckCellPatch) => {
      const row = doc.rows.find((r) => r.rid === rid)
      if (!row) return
      mutate(doc, { ...doc, rows: applyDeptCheckRowPatch(doc.rows, rid, group, patch) }, describeDeptCheckRowChange(row, group, patch))
    },
    [mutate],
  )

  const setHeader = useCallback(
    (doc: DeptCheckDoc, field: keyof DeptCheckMeta["header"], value: string) => {
      const label = field === "projectName" ? "项目名称" : field === "owner" ? "主负责人" : "难度系数"
      mutate(doc, { ...doc, meta: withDeptCheckHeader(doc.meta, field, value) }, describeDeptCheckMetaChange(label, value))
    },
    [mutate],
  )

  const setCheckDate = useCallback(
    (doc: DeptCheckDoc, group: DeptCheckGroup, value: string) => {
      const label = group === "self" ? "自查检查日期" : "交叉检查日期"
      mutate(doc, { ...doc, meta: withDeptCheckDate(doc.meta, group, value) }, describeDeptCheckMetaChange(label, value))
    },
    [mutate],
  )

  const setSignature = useCallback(
    (doc: DeptCheckDoc, group: DeptCheckGroup, patch: Partial<DeptCheckSignature>) => {
      const gl = group === "self" ? "自查" : "交叉检查"
      const label = patch.name !== undefined ? `${gl}人签名` : `${gl}签名日期`
      const value = patch.name !== undefined ? (patch.name ?? "") : (patch.date ?? "")
      mutate(doc, { ...doc, meta: withDeptCheckSignature(doc.meta, group, patch) }, describeDeptCheckMetaChange(label, value))
    },
    [mutate],
  )

  const setResult = useCallback(
    (doc: DeptCheckDoc, result: DeptCheckMeta["result"]) => {
      const label = result === "ready" ? "可以送出" : result === "revise" ? "重新修改" : "检查结果已清空"
      mutate(doc, { ...doc, meta: withDeptCheckResult(doc.meta, result) }, `表尾检查结果「${label}」`)
    },
    [mutate],
  )

  const setReviseReason = useCallback(
    (doc: DeptCheckDoc, value: string) => {
      mutate(doc, { ...doc, meta: withDeptCheckReviseReason(doc.meta, value) }, describeDeptCheckMetaChange("修改原因", value))
    },
    [mutate],
  )

  return useMemo(
    () => ({
      loading,
      importing,
      saveState,
      docs,
      docOf,
      importDef,
      retrySave,
      setRow,
      setHeader,
      setCheckDate,
      setSignature,
      setResult,
      setReviseReason,
    }),
    [
      loading,
      importing,
      saveState,
      docs,
      docOf,
      importDef,
      retrySave,
      setRow,
      setHeader,
      setCheckDate,
      setSignature,
      setResult,
      setReviseReason,
    ],
  )
}
