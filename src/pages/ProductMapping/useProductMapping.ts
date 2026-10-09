import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { pbJsonRequest } from "@/lib/pbJson"
import { decodeRhToken } from "@/lib/rhLogin"
import type { LlmMessage } from "@/lib/llm"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { skillCostSuffix } from "@/lib/skillCore"
import { currentStudioCostText, llmGenerate } from "@/pages/SolutionStudio/studioLlm"
import {
  calcTotal,
  makeLineId,
  normalizeCustomerLine,
  productToLine,
  type CheckMapping,
  type CheckProduct,
  type ChecklistLine,
  type ChecklistRecord,
  type MatchRow,
} from "@/pages/SolutionStudio/checklistTypes"
import {
  applyAiPairs,
  backfillFromMappings,
  buildInitialRows,
  candidateLabel,
  collectRowNotes,
  manualMappingWrites,
  parseMappingJson,
  toCompareRows,
  type MappingCompareRow,
} from "./mappingCore"
import type { OneLinkParseSummary } from "./oneLinkImport"

// ---------------------------------------------------------------------------
// 产品映射 Logic 层：三来源建设清单 → 与 ONE-LINK 公司库逐条一一对照 → 公司格式导出 / 落库
// 匹配引擎（纯函数）在 mappingCore.ts；本 hook 只做状态编排与网络/AI 调用
// ---------------------------------------------------------------------------

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

const MAX_TOKENS_MATCH = 2048

/** 招标文件项目（仅取映射所需字段，parse_report 为集合 json 字段） */
type BidRow = {
  id: string
  project_name: string
  hospital?: string
  parse_report?: { sections?: { key: string; title?: string; content?: string }[] } | null
}

/** 方案记录（仅取快照所需字段） */
type SolutionRow = {
  id: string
  solution_name: string
  hospital?: string
  hospital_info?: {
    ref_checklist_snapshot?: {
      company_systems?: string[]
      external_systems?: string[]
      customer_requirements?: string[]
    }
  } | null
}

export type MappingSourceTab = "paste" | "bid" | "solution"

function normStr(s: string): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase()
}

/** 从招标解析报告取「采购需求结构 / 采购清单」两 section 的逐行内容 */
export function bidLinesFromReport(report: BidRow["parse_report"]): string[] {
  const sections = report?.sections ?? []
  const wanted = sections.filter((s) => s.key === "req_structure" || s.key === "purchase_list")
  const lines: string[] = []
  for (const s of wanted) {
    for (const l of String(s.content ?? "").split("\n")) {
      const t = l.trim()
      if (t) lines.push(t)
    }
  }
  return lines
}

/**
 * 从招标解析报告取「功能需求 / 建设内容」叙述性摘要，作为 AI 语义映射的上下文依据。
 * 参照公司方法论：映射按「建设内容」而非条目字面名，功能需求/技术需求分节才是唯一依据。
 * 取 delivery_req(技术需求/建设内容/功能要求) + project_info(建设内容概况)，按长度上限截断。
 */
export function bidContextFromReport(report: BidRow["parse_report"], maxLen = 4000): string {
  const sections = report?.sections ?? []
  const wanted = sections.filter((s) => s.key === "delivery_req" || s.key === "project_info")
  const parts: string[] = []
  for (const s of wanted) {
    const c = String(s.content ?? "").trim()
    if (c) parts.push(c)
  }
  const joined = parts.join("\n")
  return joined.length > maxLen ? joined.slice(0, maxLen) : joined
}

/** 从方案建设清单快照取客户建设条目（公司系统 + 客户需求，去重保序） */
export function solutionLinesFromSnapshot(sol: SolutionRow): string[] {
  const snap = sol.hospital_info?.ref_checklist_snapshot
  if (!snap) return []
  const out: string[] = []
  for (const name of [...(snap.company_systems ?? []), ...(snap.customer_requirements ?? [])]) {
    const t = String(name ?? "").trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export function useProductMapping() {
  const costConfirm = useCostConfirm()
  const matchSkills = useScopeSkills("product-map", decodeRhToken()?.sub ?? undefined)

  const userIdRef = useRef<string | null>(decodeRhToken()?.sub ?? null)

  const [products, setProducts] = useState<CheckProduct[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [mappings, setMappings] = useState<CheckMapping[]>([])

  const [rows, setRows] = useState<MatchRow[]>([])
  const [busy, setBusy] = useState(false)
  const [rawText, setRawText] = useState("")

  const [sourceTab, setSourceTab] = useState<MappingSourceTab>("paste")
  const [bids, setBids] = useState<BidRow[]>([])
  const [solutions, setSolutions] = useState<SolutionRow[]>([])
  const [sourceLoading, setSourceLoading] = useState(false)

  const [view, setView] = useState<"compare" | "checklist">("compare")
  const [name, setName] = useState("")
  const [hospital, setHospital] = useState("")
  const [lineEdits, setLineEdits] = useState<Record<string, { qty?: number; unit_price?: number; checked?: boolean }>>({})
  // 逐行备注（一对多其余项 / 命名错位说明 / 留空原因）：AI 回写 + 人工可编辑
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({})

  const [saving, setSaving] = useState(false)
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)

  // ONE-LINK 公司库导入（解析预览 → 确认 → 批量写入 check_products）
  const [oneLinkBusy, setOneLinkBusy] = useState(false)
  const [oneLinkSummary, setOneLinkSummary] = useState<OneLinkParseSummary | null>(null)
  const pendingOneLinkRef = useRef<Partial<CheckProduct>[]>([])

  // 匹配候选宇宙：公司库行（in_company），ONE-LINK 导入行也带 in_company:true
  const companyProducts = useMemo(() => products.filter((p) => p.in_company), [products])

  // ------------------------------ 加载公司库 / 映射库 ------------------------------
  const loadProducts = useCallback(async () => {
    setProductsLoading(true)
    try {
      // ONE-LINK 公司库可达 550+ 行，服务端单页上限 200，按页拉全（≤10 页防失控）
      const all: CheckProduct[] = []
      let total = 0
      for (let page = 1; page <= 10; page += 1) {
        const data = await pbJsonRequest<ListResponse<CheckProduct>>(`/api/check_products?page=${page}&perPage=200&sort=created`)
        const items = data.items ?? []
        all.push(...items)
        total = data.totalItems ?? all.length
        if (!items.length || all.length >= total) break
      }
      setProducts(all)
      return all
    } catch {
      toast.error("公司标准清单加载失败，请稍后重试")
      return []
    } finally {
      setProductsLoading(false)
    }
  }, [])

  const loadMappings = useCallback(async () => {
    try {
      const data = await pbJsonRequest<ListResponse<CheckMapping>>("/api/check_mappings?page=1&perPage=200")
      setMappings(data.items ?? [])
    } catch {
      setMappings([])
    }
  }, [])

  useEffect(() => {
    void loadProducts()
    void loadMappings()
  }, [loadProducts, loadMappings])

  // ------------------------------ 三来源清单加载 ------------------------------
  const loadBids = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) {
      setBids([])
      return
    }
    setSourceLoading(true)
    try {
      const data = await pbJsonRequest<ListResponse<BidRow>>(
        `/api/bid_projects?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200&sort=-created`,
      )
      setBids(data.items ?? [])
    } catch {
      toast.error("招标项目加载失败，请稍后重试")
      setBids([])
    } finally {
      setSourceLoading(false)
    }
  }, [])

  const loadSolutions = useCallback(async () => {
    setSourceLoading(true)
    try {
      const data = await pbJsonRequest<ListResponse<SolutionRow>>("/api/solutions?page=1&perPage=200&sort=-updated")
      setSolutions(data.items ?? [])
    } catch {
      toast.error("方案列表加载失败，请稍后重试")
      setSolutions([])
    } finally {
      setSourceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sourceTab === "bid") void loadBids()
    if (sourceTab === "solution") void loadSolutions()
  }, [sourceTab, loadBids, loadSolutions])

  // ------------------------------ AI 语义匹配 + 映射回填 ------------------------------
  const runAiAndBackfill = useCallback(
    async (initialRows: MatchRow[], context = "") => {
      const unmatched = initialRows.filter((r) => r.kind === "none")
      if (!unmatched.length) {
        setRows(initialRows)
        return
      }
      setRows(initialRows)
      setBusy(true)
      try {
        const labels = Array.from(new Set(companyProducts.map(candidateLabel).filter(Boolean)))
        const messages: LlmMessage[] = [
          {
            role: "system",
            content: [
              "你是医疗信息化行业资深售前专家，负责把客户建设清单里的系统/模块名称逐条语义匹配到我公司 ONE-LINK 标准模块名称列表。",
              "匹配铁律：", // 参照公司映射方法论
              "1) 按【建设内容/功能】匹配，绝不只看名称字面：两套分类体系常不同，名称不同不代表不同系统。",
              "2) 一对多取主干：选中主干模块，其余并列项写进 note（如“含XX、YY”），不要把多个名字堆进 product。",
              "3) 对接/接口项按接口名对：招标“XX系统对接”去公司接口清单找对应系统的接口模块。",
              "4) 命名错位靠描述救：根据建设内容描述判定，而非字面；确实无对应才 product 填 null。",
              "只输出严格 JSON 数组，禁止解释文字与代码围栏，格式：",
              '[{"customer":"客户条目原文","product":"我公司标准模块名或null","note":"补充说明或空串"}]',
            ].join("\n"),
          },
          {
            role: "user",
            content: context.trim()
              ? `【客户建设内容/功能需求摘要（映射依据）】\n${context.trim()}\n\n【客户清单条目】\n${unmatched.map((r) => r.norm).join("\n")}\n\n【我公司标准模块名列表】\n${labels.join("、")}\n\n请结合建设内容逐条匹配并输出 JSON。`
              : `【客户清单条目】\n${unmatched.map((r) => r.norm).join("\n")}\n\n【我公司标准模块名列表】\n${labels.join("、")}\n\n请逐条匹配并输出 JSON。`,
          },
        ]
        const text = await llmGenerate(messages, MAX_TOKENS_MATCH, "product-map", 0)
        const pairs = parseMappingJson(text)
        let next = applyAiPairs(initialRows, pairs, companyProducts, candidateLabel)
        next = backfillFromMappings(next, mappings, companyProducts)
        setRows(next)
        const aiNotes = collectRowNotes(next, pairs)
        if (Object.keys(aiNotes).length) setRowNotes((prev) => ({ ...prev, ...aiNotes }))
        toast.success("AI 语义匹配完成，未命中条目可人工指定")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "AI 匹配失败，可人工指定未命中条目")
        setRows(backfillFromMappings(initialRows, mappings, companyProducts))
      } finally {
        setBusy(false)
      }
    },
    [companyProducts, mappings],
  )

  // ------------------------------ 启动一一对照匹配 ------------------------------
  const startMatch = useCallback(
    (rawLines: string[], srcText = "", context = "") => {
      const norms: string[] = []
      for (const raw of rawLines) {
        const n = normalizeCustomerLine(raw)
        if (n.length >= 2 && !norms.includes(n)) norms.push(n)
      }
      if (!norms.length) {
        toast.error("未解析到有效清单条目，请粘贴文本、上传 Excel 或从招标/方案导入")
        return
      }
      setRawText(srcText || rawLines.join("\n"))
      setLineEdits({})
      setRowNotes({})
      setView("compare")
      const initial = buildInitialRows({
        norms,
        products: companyProducts,
        mappings,
        makeRowId: makeLineId,
        labelOf: candidateLabel,
      })
      const unmatched = initial.filter((r) => r.kind === "none").length
      if (!unmatched) {
        setRows(initial)
        toast.success(`已一一对照 ${initial.length} 条客户条目`)
        return
      }
      costConfirm.runWithCostConfirm(
        () => {
          void runAiAndBackfill(initial, context)
        },
        `将对 ${unmatched} 条未命中条目做 AI 语义匹配，${currentStudioCostText()}${skillCostSuffix("product-map")}`,
      )
    },
    [companyProducts, mappings, runAiAndBackfill, costConfirm],
  )

  const importFromBid = useCallback(
    (bid: BidRow | undefined) => {
      if (!bid) return
      const lines = bidLinesFromReport(bid.parse_report)
      if (!lines.length) {
        toast.error("该招标项目暂无「采购需求结构 / 采购清单」，请先到标书工作台解析该项目")
        return
      }
      if (!hospital.trim()) setHospital(bid.hospital ?? "")
      if (!name.trim()) setName(`${bid.project_name} 产品映射`)
      startMatch(lines, lines.join("\n"), bidContextFromReport(bid.parse_report))
    },
    [hospital, name, startMatch],
  )

  const importFromSolution = useCallback(
    (sol: SolutionRow | undefined) => {
      if (!sol) return
      const lines = solutionLinesFromSnapshot(sol)
      if (!lines.length) {
        toast.error("该方案未关联建设清单快照，请从建设清单来源生成方案或改用其它来源")
        return
      }
      if (!hospital.trim()) setHospital(sol.hospital ?? "")
      if (!name.trim()) setName(`${sol.solution_name} 产品映射`)
      startMatch(lines, lines.join("\n"))
    },
    [hospital, name, startMatch],
  )

  // ------------------------------ 人工调整 ------------------------------
  const setMatchProduct = useCallback(
    (rowId: string, productId: string) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.row_id !== rowId) return r
          if (!productId) return { ...r, product_name: "", product_id: "", kind: "none" as const, resolution: "company" as const }
          const p = companyProducts.find((c) => c.id === productId)
          return { ...r, product_id: productId, product_name: p ? candidateLabel(p) : "", kind: "manual" as const, resolution: "company" as const }
        }),
      )
    },
    [companyProducts],
  )

  const setMatchResolution = useCallback((rowId: string, resolution: MatchRow["resolution"]) => {
    setRows((prev) => prev.map((r) => (r.row_id === rowId ? { ...r, resolution } : r)))
  }, [])

  const updateLineEdit = useCallback((rowId: string, patch: { qty?: number; unit_price?: number; checked?: boolean }) => {
    setLineEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }))
  }, [])

  const setRowNote = useCallback((rowId: string, note: string) => {
    setRowNotes((prev) => ({ ...prev, [rowId]: note }))
  }, [])

  const clearResult = useCallback(() => {
    setRows([])
    setRawText("")
    setLineEdits({})
    setRowNotes({})
    setLastSavedId(null)
  }, [])

  // ------------------------------ ONE-LINK 公司库导入 ------------------------------
  const previewOneLink = useCallback(async (file: File) => {
    setOneLinkBusy(true)
    try {
      const { parseOneLinkWorkbook, oneLinkRowsToProductPayloads } = await import("./oneLinkImport")
      const res = await parseOneLinkWorkbook(file)
      if (!res.rows.length) {
        toast.error("未在文件中识别到《按公司规范》数据行")
        return
      }
      pendingOneLinkRef.current = oneLinkRowsToProductPayloads(res.rows)
      setOneLinkSummary(res.summary)
    } catch {
      toast.error("ONE-LINK 解析失败，请检查文件是否为《智慧医院报价（按公司规范）》表")
    } finally {
      setOneLinkBusy(false)
    }
  }, [])

  const commitOneLink = useCallback(async () => {
    const payloads = pendingOneLinkRef.current
    if (!payloads.length) return
    setOneLinkBusy(true)
    try {
      let done = 0
      for (let i = 0; i < payloads.length; i += 12) {
        const chunk = payloads.slice(i, i + 12)
        await Promise.all(chunk.map((body) => pbJsonRequest("/api/check_products", { method: "POST", body: JSON.stringify(body) })))
        done += chunk.length
      }
      await loadProducts()
      pendingOneLinkRef.current = []
      setOneLinkSummary(null)
      toast.success(`已导入 ${done} 条 ONE-LINK 标准模块到公司库`)
    } catch {
      toast.error("导入写入失败，请稍后重试")
    } finally {
      setOneLinkBusy(false)
    }
  }, [loadProducts])

  const cancelOneLink = useCallback(() => {
    pendingOneLinkRef.current = []
    setOneLinkSummary(null)
  }, [])

  // ------------------------------ 派生视图 ------------------------------
  const compareRows = useMemo<MappingCompareRow[]>(() => toCompareRows(rows, companyProducts, rowNotes), [rows, companyProducts, rowNotes])

  const checklistLines = useMemo<ChecklistLine[]>(() => {
    const out: ChecklistLine[] = []
    for (const r of rows) {
      if (r.resolution === "ignore") continue
      const ed = lineEdits[r.row_id] ?? {}
      if (r.resolution === "external") {
        out.push({
          line_id: r.row_id,
          category: "外购系统",
          product_line: "",
          product_name: r.norm,
          module_name: "",
          module_func: "客户要求，公司暂无对应产品",
          unit: "套",
          qty: ed.qty ?? 1,
          unit_price: ed.unit_price ?? 0,
          source: "external",
          rating_hits: [],
          remark: "产品映射外购",
          product_id: "",
          checked: ed.checked ?? true,
        })
        continue
      }
      if (!r.product_id) continue
      const p = companyProducts.find((c) => c.id === r.product_id)
      if (!p) continue
      const line = productToLine(p, "company", [])
      const note = rowNotes[r.row_id]
      out.push({ ...line, line_id: r.row_id, qty: ed.qty ?? line.qty, unit_price: ed.unit_price ?? line.unit_price, checked: ed.checked ?? line.checked, remark: note || line.remark })
    }
    return out
  }, [rows, companyProducts, lineEdits, rowNotes])

  const matchedCount = useMemo(() => rows.filter((r) => r.product_id && r.resolution === "company").length, [rows])
  const unmatchedCount = useMemo(() => rows.filter((r) => r.kind === "none" && r.resolution === "company").length, [rows])
  const externalCount = useMemo(() => rows.filter((r) => r.resolution === "external").length, [rows])
  const ignoredCount = useMemo(() => rows.filter((r) => r.resolution === "ignore").length, [rows])

  // ------------------------------ 导出（懒加载 xlsx 模块） ------------------------------
  const exportCompare = useCallback(async () => {
    if (!compareRows.length) {
      toast.error("暂无一一对照结果可导出")
      return
    }
    try {
      const { exportMappingCompareXlsx } = await import("./productMappingExports")
      const n = exportMappingCompareXlsx(compareRows)
      toast.success(`已导出一一对照表（${n} 行）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [compareRows])

  const exportCompanyStandard = useCallback(async () => {
    const hitProducts = rows
      .filter((r) => r.product_id && r.resolution === "company")
      .map((r) => companyProducts.find((c) => c.id === r.product_id))
      .filter((p): p is CheckProduct => Boolean(p))
    if (!hitProducts.length) {
      toast.error("暂无命中我公司的条目可导出")
      return
    }
    try {
      const { exportCompanyStandardXlsx } = await import("./productMappingExports")
      const n = exportCompanyStandardXlsx(hitProducts)
      toast.success(`已导出公司标准清单（${n} 行）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [rows, companyProducts])

  // 骨架回填式导出：上传公司对照表骨架，只新增四列（产品名称/模块分类/模块名称/备注）、原列不动
  const exportSkeleton = useCallback(
    async (file: File) => {
      if (!compareRows.length) {
        toast.error("暂无一一对照结果可回填，请先完成对照")
        return
      }
      try {
        const { exportFillSkeletonXlsx } = await import("./productMappingExports")
        const n = await exportFillSkeletonXlsx(file, compareRows)
        if (n > 0) toast.success(`已按骨架回填 ${n} 行，导出完成`)
        else toast.error("未在骨架中匹配到对照条目，请确认骨架清单与本次输入一致")
      } catch {
        toast.error("骨架导出失败，请检查文件格式")
      }
    },
    [compareRows],
  )

  // ------------------------------ 映射库沉淀 ------------------------------
  const upsertMapping = useCallback(
    async (norm: string, productName: string, productId: string) => {
      try {
        const existing = mappings.find((m) => normStr(m.customer_norm) === normStr(norm))
        if (existing) {
          await pbJsonRequest(`/api/check_mappings/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ hit_count: (Number(existing.hit_count) || 0) + 1, company_product_name: productName, product_id: productId }),
          })
        } else {
          await pbJsonRequest("/api/check_mappings", {
            method: "POST",
            body: JSON.stringify({ customer_norm: norm, company_product_name: productName, product_id: productId, hit_count: 1 }),
          })
        }
      } catch {
        // 映射沉淀失败不阻断落库
      }
    },
    [mappings],
  )

  // ------------------------------ 落库（复用 checklists） ------------------------------
  const saveMapping = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) {
      toast.error("当前无法保存，请稍后重试")
      return
    }
    const kept = checklistLines.filter((l) => l.checked !== false)
    if (!kept.length) {
      toast.error("没有可入库的映射结果，请为条目指定公司产品或标外购")
      return
    }
    if (!name.trim()) {
      toast.error("请填写映射结果名称")
      return
    }
    setSaving(true)
    try {
      const record = await pbJsonRequest<ChecklistRecord>("/api/checklists", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: uid,
          checklist_name: name.trim(),
          hospital: hospital.trim(),
          rating_targets: [],
          source_mode: "customer_match",
          customer_raw: rawText,
          items: kept,
          total_amount: calcTotal(kept),
          status: "confirmed",
        }),
      })
      setLastSavedId(record.id)
      toast.success("产品映射结果已保存到建设清单")
      const writes = manualMappingWrites(rows)
      if (writes.length) {
        await Promise.all(writes.map((w) => upsertMapping(w.norm, w.productName, w.productId)))
        void loadMappings()
        toast.success(`已将 ${writes.length} 条人工映射写入团队映射库，下次相似条目自动命中`)
      }
    } catch {
      toast.error("保存失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }, [checklistLines, name, hospital, rawText, rows, upsertMapping, loadMappings])

  return {
    // 加载态
    productsLoading,
    sourceLoading,
    busy,
    saving,
    // 数据
    companyProducts,
    rows,
    compareRows,
    checklistLines,
    bids,
    solutions,
    // 逐行备注
    rowNotes,
    setRowNote,
    // 统计
    matchedCount,
    unmatchedCount,
    externalCount,
    ignoredCount,
    // 来源 & 视图 & 表单
    sourceTab,
    setSourceTab,
    view,
    setView,
    rawText,
    setRawText,
    name,
    setName,
    hospital,
    setHospital,
    // 操作
    startMatch,
    importFromBid,
    importFromSolution,
    setMatchProduct,
    setMatchResolution,
    updateLineEdit,
    clearResult,
    exportCompare,
    exportCompanyStandard,
    exportSkeleton,
    saveMapping,
    reloadProducts: loadProducts,
    // ONE-LINK 公司库导入
    oneLinkBusy,
    oneLinkSummary,
    previewOneLink,
    commitOneLink,
    cancelOneLink,
    // AI 成本确认 & 技能
    costConfirm,
    matchSkills,
    hasResult: rows.length > 0,
    lastSavedId,
  }
}

export type UseProductMapping = ReturnType<typeof useProductMapping>
