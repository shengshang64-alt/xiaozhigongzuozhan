// 资质台账 VM：列表 + 三档预警汇总 + 增删改（REST 走 __pb 代理自定义路由）
// UX-R2: 资质台账 已按 docs/ux-review-2026-11 修复 2026-11-07（新增批量登记有效期 batchRegisterValidity）
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { readQualHardBlock, writeQualHardBlock } from "@/lib/qualHardBlock"
import { summarizeQuals, type QualCertRow, type QualSummary } from "./qualsCore"

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
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`)
  }
  return (await res.json()) as T
}

export type QualDraft = {
  cert_name: string
  category: string
  cert_no: string
  issuer: string
  valid_from: string
  valid_to: string
  scope: string
  external_ok: boolean
  file_ref: string
  notes: string
}

export const EMPTY_DRAFT: QualDraft = {
  cert_name: "",
  category: "硬资质",
  cert_no: "",
  issuer: "",
  valid_from: "",
  valid_to: "",
  scope: "",
  external_ok: true,
  file_ref: "",
  notes: "",
}

export function useQualCerts() {
  const [rows, setRows] = useState<QualCertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // 硬拦截开关（Q20 补全）：开启后导出标书时存在过期/临期证书会直接阻断导出（localStorage 持久化）
  // R66：判定与写入一律走 lib/qualHardBlock 的单一真源。此前这里用 `=== "1"`（默认关），
  // 而导出闸门用 `!== "0"`（默认拦）——默认态下页面显示「关」但导出实际被拦，用户点一次
  // 开关只会把 "1" 写进去（仍在拦），看起来像开关坏了。默认值以闸门为准：默认拦。
  const [hardBlock, setHardBlockState] = useState<boolean>(() => readQualHardBlock())
  const setHardBlock = useCallback((on: boolean) => {
    setHardBlockState(on)
    writeQualHardBlock(on)
  }, [])
  const [editing, setEditing] = useState<QualCertRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<QualDraft>(EMPTY_DRAFT)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ items: QualCertRow[] }>("/api/qual_certs?perPage=500", { headers: vibexAuthHeaders() })
      setRows(data.items ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "资质台账加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const summary: QualSummary = useMemo(() => summarizeQuals(rows, new Date(new Date().toDateString()).getTime()), [rows])

  const openCreate = useCallback(() => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((row: QualCertRow) => {
    setEditing(row)
    setDraft({
      cert_name: row.cert_name ?? "",
      category: row.category || "其他",
      cert_no: row.cert_no ?? "",
      issuer: row.issuer ?? "",
      valid_from: row.valid_from ?? "",
      valid_to: row.valid_to ?? "",
      scope: row.scope ?? "",
      external_ok: row.external_ok === true,
      file_ref: row.file_ref ?? "",
      notes: row.notes ?? "",
    })
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => setFormOpen(false), [])

  const saveDraft = useCallback(async () => {
    if (!draft.cert_name.trim()) {
      toast.error("请填写证照名称")
      return
    }
    setBusy(true)
    try {
      const method = editing ? "PATCH" : "POST"
      const path = editing ? `/api/qual_certs/${encodeURIComponent(editing.id)}` : "/api/qual_certs"
      await apiFetch(path, { method, headers: vibexAuthHeaders(), body: JSON.stringify(draft) })
      toast.success(editing ? "资质已更新" : "资质已登记")
      setFormOpen(false)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败，请稍后重试")
    } finally {
      setBusy(false)
    }
  }, [draft, editing, reload])

  const removeRow = useCallback(
    async (row: QualCertRow) => {
      setBusy(true)
      try {
        await apiFetch(`/api/qual_certs/${encodeURIComponent(row.id)}`, { method: "DELETE", headers: vibexAuthHeaders() })
        toast.success("资质已删除")
        await reload()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败，请稍后重试")
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  // UX-R2（docs/ux-review-2026-11 §十三）：批量登记有效期——
  // 服务端 PATCH 为局部更新语义（body 字段缺省即不动），逐行只发 { valid_to }；
  // allSettled 聚合结果，部分失败不整批回滚（成功的已落库，失败的行号在页面 toast 中点名）。
  const batchRegisterValidity = useCallback(
    async (ids: string[], validTo: string): Promise<{ ok: number; failed: string[] }> => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          apiFetch<QualCertRow>(`/api/qual_certs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: vibexAuthHeaders(),
            body: JSON.stringify({ valid_to: validTo }),
          }),
        ),
      )
      const failed: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === "fulfilled") ok += 1
        else failed.push(ids[i])
      })
      if (ok > 0) await reload()
      return { ok, failed }
    },
    [reload],
  )

  return {
    rows,
    loading,
    busy,
    summary,
    hardBlock,
    setHardBlock,
    editing,
    formOpen,
    draft,
    setDraft,
    openCreate,
    openEdit,
    closeForm,
    saveDraft,
    removeRow,
    batchRegisterValidity,
    reload,
  }
}

export type UseQualCerts = ReturnType<typeof useQualCerts>
