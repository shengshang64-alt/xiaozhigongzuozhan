// 竞品分析页逻辑：列表 / 搜索 / 详情 / 新建编辑 / 删除 / 导入软著基线。
// View（CompetitorsPage 与组件）只消费本 hook 返回的 props。
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  createCompetitor,
  deleteCompetitor,
  listCompetitors,
  updateCompetitor,
  type CompetitorPatch,
  type CompetitorRow,
} from "./competitorsCore"
import { COMPETITOR_SEED, seedToPatch } from "./competitorSeed"

export type SortKey = "copyrights" | "updated" | "name"

const EMPTY_FORM: CompetitorPatch = { name: "", visibility: "team" }

export function useCompetitors() {
  const [rows, setRows] = useState<CompetitorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("copyrights")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CompetitorPatch>(EMPTY_FORM)
  const [formErr, setFormErr] = useState("")
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)

  const rowsRef = useRef<CompetitorRow[]>([])
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const reload = useCallback(async () => {
    try {
      const r = await listCompetitors()
      setRows(r)
    } catch {
      toast.error("竞品数据加载失败，请稍后重试")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // URL ?competitor=id 深链（全局搜索跳转用）
  const [searchParams] = useSearchParams()
  const deepLinked = Boolean(searchParams.get("competitor"))
  useEffect(() => {
    const cid = searchParams.get("competitor")
    if (cid) setSelectedId(cid)
  }, [searchParams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let base = rows
    if (q) {
      base = base.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.legal_name.toLowerCase().includes(q) ||
          (d.positioning ?? "").toLowerCase().includes(q) ||
          (d.summary ?? "").toLowerCase().includes(q) ||
          (d.products ?? "").toLowerCase().includes(q) ||
          (d.keywords ?? []).some((k) => String(k).toLowerCase().includes(q)),
      )
    }
    const sorted = [...base]
    if (sortKey === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    else if (sortKey === "updated") sorted.sort((a, b) => (a.updated < b.updated ? 1 : -1))
    else sorted.sort((a, b) => b.software_copyrights - a.software_copyrights)
    return sorted
  }, [rows, search, sortKey])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  const openCreate = useCallback(() => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErr("")
    setEditOpen(true)
  }, [])

  const openEdit = useCallback((row: CompetitorRow) => {
    setEditingId(row.id)
    setForm({
      name: row.name,
      legal_name: row.legal_name,
      website: row.website,
      wechat: row.wechat,
      software_copyrights: row.software_copyrights,
      earliest_cr_date: row.earliest_cr_date,
      latest_cr_date: row.latest_cr_date,
      positioning: row.positioning,
      products: row.products,
      bid_amount_5y: row.bid_amount_5y,
      regions: row.regions,
      amount_structure: row.amount_structure,
      customer_profile: row.customer_profile,
      certifications: row.certifications,
      ai_evolution: row.ai_evolution,
      xinchuang: row.xinchuang,
      strengths: row.strengths,
      weaknesses: row.weaknesses,
      threat_notes: row.threat_notes,
      summary: row.summary,
      source: row.source,
      visibility: row.visibility,
    })
    setFormErr("")
    setEditOpen(true)
  }, [])

  const submit = useCallback(async () => {
    setFormErr("")
    if (!form.name || !form.name.trim()) return setFormErr("公司名称不能为空")
    setSaving(true)
    try {
      if (editingId) {
        const r = await updateCompetitor(editingId, form)
        setRows((prev) => prev.map((x) => (x.id === r.id ? r : x)))
        toast.success(`已更新：${r.name}`)
      } else {
        const r = await createCompetitor(form)
        setRows((prev) => [r, ...prev])
        setSelectedId(r.id)
        toast.success(`已新增竞品：${r.name}`)
      }
      setEditOpen(false)
    } catch {
      setFormErr("保存失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }, [form, editingId])

  const remove = useCallback(
    async (row: CompetitorRow) => {
      try {
        await deleteCompetitor(row.id)
        setRows((prev) => prev.filter((x) => x.id !== row.id))
        if (selectedId === row.id) setSelectedId(null)
        toast.success(`已删除：${row.name}`)
      } catch {
        toast.error("删除失败，请稍后重试")
      }
    },
    [selectedId],
  )

  /** 导入软著基线：按 name 去重，只补缺失的公司（不覆盖已编辑过的档案） */
  const importSeed = useCallback(async () => {
    setImporting(true)
    const existingNames = new Set(rowsRef.current.map((r) => r.name))
    let added = 0
    let failed = 0
    for (const seed of COMPETITOR_SEED) {
      if (existingNames.has(seed.name)) continue
      try {
        const r = await createCompetitor(seedToPatch(seed))
        setRows((prev) => [...prev, r])
        added += 1
      } catch {
        failed += 1
      }
    }
    setImporting(false)
    if (added > 0) toast.success(`已导入 ${added} 家竞品基线${failed ? `，${failed} 家失败` : ""}`)
    else if (failed > 0) toast.error("导入失败，请稍后重试")
    else toast.info("竞品基线已全部导入，无新增")
  }, [])

  const seedMissingCount = useMemo(() => {
    const existingNames = new Set(rows.map((r) => r.name))
    return COMPETITOR_SEED.filter((s) => !existingNames.has(s.name)).length
  }, [rows])

  return {
    rows,
    loading,
    search,
    setSearch,
    sortKey,
    setSortKey,
    filtered,
    selected,
    selectedId,
    setSelectedId,
    editOpen,
    editingId,
    form,
    setForm,
    formErr,
    saving,
    openCreate,
    openEdit,
    closeEdit: () => setEditOpen(false),
    submit,
    remove,
    importSeed,
    importing,
    seedMissingCount,
    reload,
    deepLinked,
    totalCopyrights: rows.reduce((s, r) => s + (r.software_copyrights || 0), 0),
  }
}

export type UseCompetitors = ReturnType<typeof useCompetitors>
