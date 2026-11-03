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
  dedupeProducts,
  manualMappingWrites,
  parseMappingJson,
  rowProductIds,
  toCompareRows,
  type MappingCompareRow,
} from "./mappingCore"
import type { OneLinkParseSummary } from "./oneLinkImport"
import type { ParsedCustomerTable } from "./uploadWizard"
import {
  buildRatingCoverageRows,
  coverageStats,
  type RatingSelection,
} from "./ratingCoverage"
import type { RatingGroupKey } from "@/pages/SolutionStudio/checklistTypes"

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

  // 2026-10-28 重构：上传原表表头（对照表「原表列」与导出共用；非 Excel 来源为空）
  const [sourceColumns, setSourceColumns] = useState<string[]>([])
  // 上传向导：待解析文件（非空即打开 UploadWizardDialog）
  const [wizardFile, setWizardFile] = useState<File | null>(null)
  // 最近一次对照的 AI 上下文（招标「建设内容」摘要），手动触发 AI 时沿用
  const aiContextRef = useRef("")

  const [saving, setSaving] = useState(false)
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)

  // ONE-LINK 公司库导入（解析预览 → 确认 → 批量写入 check_products）
  const [oneLinkBusy, setOneLinkBusy] = useState(false)
  const [oneLinkSummary, setOneLinkSummary] = useState<OneLinkParseSummary | null>(null)
  const pendingOneLinkRef = useRef<Partial<CheckProduct>[]>([])

  // 匹配候选宇宙：公司库行（in_company），ONE-LINK 导入行也带 in_company:true。
  // 2026-10-29：再做一层「同身份去重」——历史两批导入（10-08 残缺行 + 10-28 完整行）
  // 让同一模块在选择器里重影成两项。去重时把「已被映射记忆/当前对照引用的 id」作为保留优先项，
  // 保证既有映射不会因去重而找不到目标行。
  const referencedProductIds = useMemo(() => {
    const ids: string[] = []
    for (const r of rows) for (const id of rowProductIds(r)) ids.push(id)
    for (const m of mappings) if (m.product_id) ids.push(m.product_id)
    return ids
  }, [rows, mappings])

  // 去重前的原始 in_company 池（对照表解析历史映射 id 时用，保持引用稳定）
  const rawCompanyProducts = useMemo(() => products.filter((p) => p.in_company), [products])

  const companyProducts = useMemo(
    () => dedupeProducts(rawCompanyProducts, referencedProductIds),
    [rawCompanyProducts, referencedProductIds],
  )

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
  /**
   * 2026-10-28 重构：统一入口（携带原表单元格的条目）。
   * AI 语义匹配改为「手动触发」——离线规则+记忆库先出结果，
   * 要不要花钱问 AI 由用户在结果区显式点击（旧实现有未命中即弹费用确认，打断对照节奏）。
   */
  const startMatchItems = useCallback(
    (
      items: { norm: string; raw: string; cells?: string[] }[],
      opts: { srcText?: string; context?: string; columns?: string[] } = {},
    ) => {
      if (!items.length) {
        toast.error("未解析到有效清单条目，请粘贴文本、上传 Excel 或从招标/方案导入")
        return
      }
      setRawText(opts.srcText || items.map((x) => x.raw).join("\n"))
      setLineEdits({})
      setRowNotes({})
      setSourceColumns(opts.columns ?? [])
      setView("compare")
      aiContextRef.current = opts.context ?? ""
      const initial = buildInitialRows({
        norms: items.map((x) => x.norm),
        raws: items.map((x) => x.raw),
        cellsList: items.map((x) => x.cells),
        products: companyProducts,
        mappings,
        makeRowId: makeLineId,
        labelOf: candidateLabel,
      })
      setRows(initial)
      const unmatched = initial.filter((r) => r.kind === "none").length
      const suggested = initial.filter((r) => !r.product_id && r.suggestion).length
      toast.success(
        unmatched
          ? `已对照 ${initial.length} 条：命中 ${initial.length - unmatched} 条、待确认 ${suggested} 条、无匹配 ${unmatched - suggested} 条`
          : `已一一对照 ${initial.length} 条客户条目，全部命中`,
      )
    },
    [companyProducts, mappings],
  )

  /** 粘贴 / 招标 / 方案来源：纯文本行 → 条目（无原表单元格） */
  const startMatch = useCallback(
    (rawLines: string[], srcText = "", context = "") => {
      const seen = new Set<string>()
      const items: { norm: string; raw: string }[] = []
      for (const raw of rawLines) {
        const n = normalizeCustomerLine(raw)
        if (n.length >= 2 && !seen.has(n)) {
          seen.add(n)
          items.push({ norm: n, raw: raw.trim() || n })
        }
      }
      startMatchItems(items, { srcText: srcText || rawLines.join("\n"), context })
    },
    [startMatchItems],
  )

  // ------------------------------ 上传向导（任意 Excel，保留原表） ------------------------------
  const openWizard = useCallback((file: File) => setWizardFile(file), [])
  const closeWizard = useCallback(() => setWizardFile(null), [])
  const confirmWizard = useCallback(
    (parsed: ParsedCustomerTable) => {
      setWizardFile(null)
      if (!parsed.items.length) {
        toast.error("向导未解析到有效条目：请检查表头行与名称列选择")
        return
      }
      if (!name.trim()) setName(`${parsed.sheetName} 产品映射`)
      startMatchItems(parsed.items.map((x) => ({ norm: x.norm, raw: x.raw, cells: x.cells })), {
        srcText: parsed.items.map((x) => x.raw).join("\n"),
        columns: parsed.columns,
      })
      if (parsed.skippedEmpty > 0) toast(`有 ${parsed.skippedEmpty} 行名称列为空，已跳过`)
    },
    [name, startMatchItems],
  )

  /** 手动触发 AI 语义匹配（费用门禁仍在，仅改发起时机） */
  const runAiMatch = useCallback(() => {
    const unmatched = rows.filter((r) => r.kind === "none")
    if (!unmatched.length) {
      toast.success("当前没有未命中条目，无需 AI 语义匹配")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runAiAndBackfill(rows, aiContextRef.current)
      },
      `将对 ${unmatched.length} 条未命中条目做 AI 语义匹配。${currentStudioCostText()}${skillCostSuffix("product-map")}`,
    )
  }, [rows, runAiAndBackfill, costConfirm])

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

  // ------------------------------ 人工调整（多对多：一对一 / 一对多 / 多对一） ------------------------------
  /**
   * 多对多设定（2026-10-28）：一行可挂多个公司模块，数组首位 = 主干。
   * 人工确认即同步映射记忆库（pair 级：一个「外部名 → 模块」一对 = 一行），
   * 取消选择的 pair 同步删除——下次同措辞按最新选择恢复全部命中。
   */
  const syncMappingPairsRef = useRef<
    ((norm: string, pairs: { productId: string; productName: string }[]) => Promise<void>) | null
  >(null)
  const upsertMappingRef = useRef<
    ((norm: string, productName: string, productId: string) => Promise<void>) | null
  >(null)
  const loadMappingsRef = useRef<(() => Promise<void>) | null>(null)
  /** 2026-10-29：自定义模块名沉淀（写入 check_mappings.custom_name，product_id 留空） */
  const syncCustomNamesRef = useRef<((norm: string, names: string[]) => Promise<void>) | null>(null)

  const setMatchProducts = useCallback(
    (rowId: string, productIds: string[]) => {
      let accepted: { norm: string; pairs: { productId: string; productName: string }[] } | null = null
      setRows((prev) =>
        prev.map((r) => {
          if (r.row_id !== rowId) return r
          const ids = productIds.filter(Boolean)
          if (!ids.length) {
            accepted = { norm: r.norm, pairs: [] }
            return {
              ...r,
              product_name: "",
              product_id: "",
              product_ids: undefined,
              kind: "none" as const,
              resolution: "company" as const,
            }
          }
          const picked = ids
            .map((id) => companyProducts.find((c) => c.id === id))
            .filter((p): p is CheckProduct => Boolean(p))
          if (!picked.length) return r
          accepted = {
            norm: r.norm,
            pairs: picked.map((p) => ({ productId: p.id, productName: candidateLabel(p) })),
          }
          return {
            ...r,
            product_id: picked[0].id,
            product_name: candidateLabel(picked[0]),
            product_ids: picked.map((p) => p.id),
            kind: "manual" as const,
            resolution: "company" as const,
            // 已采纳，建议位清空
            suggestion: undefined,
          }
        }),
      )
      if (accepted) {
        const hit = accepted as { norm: string; pairs: { productId: string; productName: string }[] }
        void syncMappingPairsRef.current?.(hit.norm, hit.pairs).then(() => void loadMappingsRef.current?.())
      }
    },
    [companyProducts],
  )

  /** 单选便捷入口（采纳建议等场景）：等价于 setMatchProducts(rowId, [productId]) */
  const setMatchProduct = useCallback(
    (rowId: string, productId: string) => {
      setMatchProducts(rowId, productId ? [productId] : [])
    },
    [setMatchProducts],
  )

  const setMatchResolution = useCallback((rowId: string, resolution: MatchRow["resolution"]) => {
    setRows((prev) => prev.map((r) => (r.row_id === rowId ? { ...r, resolution } : r)))
  }, [])

  /**
   * 2026-10-29：设置某行的自定义模块名（公司能做但产品清单里没有的条目）。
   * - 写进 row.custom_names，状态变成「自定义」（算已命中）
   * - 同步沉淀进映射记忆库（custom_name 字段，product_id 留空），下次同类条目自动命中
   * 传空数组 = 清除该行的自定义。
   */
  const setCustomNames = useCallback(
    (rowId: string, names: string[]) => {
      const cleaned = Array.from(new Set(names.map((x) => x.trim()).filter(Boolean)))
      let norm: string | null = null
      setRows((prev) =>
        prev.map((r) => {
          if (r.row_id !== rowId) return r
          norm = r.norm
          const next: MatchRow = { ...r, custom_names: cleaned.length ? cleaned : undefined }
          // 没有任何公司库命中、也没有自定义时，回落成「未匹配」而不是留个假命中
          if (!next.custom_names && !next.product_id) {
            next.kind = "none"
            next.resolution = "company"
          }
          return next
        }),
      )
      if (norm) {
        void syncCustomNamesRef.current?.(norm, cleaned)
      }
    },
    [],
  )

  const updateLineEdit = useCallback((rowId: string, patch: { qty?: number; unit_price?: number; checked?: boolean }) => {
    setLineEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }))
  }, [])

  const setRowNote = useCallback((rowId: string, note: string) => {
    setRowNotes((prev) => ({ ...prev, [rowId]: note }))
  }, [])

  /**
   * 批量采纳全部「待确认」建议：与单条采纳同一契约（kind→manual + 写入映射记忆库）。
   * 分批并发写入（每批 12，同 ONE-LINK 导入先例），全部落完再刷新记忆库。
   */
  const adoptAllSuggestions = useCallback(async () => {
    const targets = rows.filter((r) => !r.product_id && r.suggestion && r.resolution === "company")
    if (!targets.length) return
    const idSet = new Set(targets.map((r) => r.row_id))
    setRows((prev) =>
      prev.map((r) => {
        if (!idSet.has(r.row_id) || !r.suggestion) return r
        const p = companyProducts.find((c) => c.id === r.suggestion!.product_id)
        if (!p) return r
        return {
          ...r,
          product_id: p.id,
          product_name: candidateLabel(p),
          product_ids: [p.id],
          kind: "manual" as const,
          resolution: "company" as const,
          suggestion: undefined,
        }
      }),
    )
    const writes = targets
      .filter((r) => companyProducts.some((c) => c.id === r.suggestion!.product_id))
      .map((r) => ({ norm: r.norm, s: r.suggestion! }))
    for (let i = 0; i < writes.length; i += 12) {
      await Promise.all(writes.slice(i, i + 12).map((w) => upsertMappingRef.current?.(w.norm, w.s.label, w.s.product_id)))
    }
    await loadMappingsRef.current?.()
    toast.success(`已采纳 ${targets.length} 条建议并写入映射记忆库`)
  }, [rows, companyProducts])

  const clearResult = useCallback(() => {
    setRows([])
    setRawText("")
    setLineEdits({})
    setRowNotes({})
    setSourceColumns([])
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

  // ------------------------------ 评级筛选（2026-10-29） ------------------------------
  // 用户需求：公司清单导出要「按评级要求先筛一遍，再把客户提到的要求补进来，
  // 并明确标注 三方/公司/自定义」；评级必选项必须体现。
  const [ratingSel, setRatingSel] = useState<RatingSelection>({})
  const [includeRatingOptional, setIncludeRatingOptional] = useState(true)

  const toggleRating = useCallback((group: RatingGroupKey, value: string) => {
    setRatingSel((prev) => {
      const cur = prev[group] ?? []
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]
      const out: RatingSelection = { ...prev }
      if (next.length) out[group] = next
      else delete out[group]
      return out
    })
  }, [])

  const clearRating = useCallback(() => setRatingSel({}), [])

  /** 评级覆盖行（界面预览 + 导出共用同一份数据，避免两处口径漂移） */
  const ratingCoverageRows = useMemo(
    () => buildRatingCoverageRows(companyProducts, rows, ratingSel, { includeOptional: includeRatingOptional }),
    [companyProducts, rows, ratingSel, includeRatingOptional],
  )
  const ratingStats = useMemo(() => coverageStats(ratingCoverageRows), [ratingCoverageRows])

  // ------------------------------ 派生视图 ------------------------------
  // 第 4 参传入去重前的原始 in_company 池：历史映射若指向被去重收掉的 id，按身份回退解析
  const compareRows = useMemo<MappingCompareRow[]>(
    () => toCompareRows(rows, companyProducts, rowNotes, rawCompanyProducts),
    [rows, companyProducts, rowNotes, rawCompanyProducts],
  )

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
      // 2026-10-29：自定义模块（公司能做但清单没有）也要落进建设清单，
      // 否则界面上填的自定义只是好看、导不出、存不了档。
      // source 记为 company（公司交付范围），product_id 留空并打 custom 标记。
      const customs = r.custom_names ?? []
      for (const cn of customs) {
        const note = rowNotes[r.row_id]
        out.push({
          line_id: `${r.row_id}#custom:${cn}`,
          category: "自定义模块",
          product_line: "",
          product_name: r.norm,
          module_name: cn,
          module_func: "公司可交付，标准清单暂无此模块（人工自定义）",
          unit: "套",
          qty: ed.qty ?? 1,
          unit_price: ed.unit_price ?? 0,
          source: "company",
          rating_hits: [],
          remark: note || "自定义模块",
          product_id: "",
          checked: ed.checked ?? true,
        })
      }
      if (!r.product_id) continue
      // 多对多：一行命中的每个公司模块各生成一条清单行（主干行沿用 row_id 兼容行编辑）
      const ids = rowProductIds(r)
      ids.forEach((pid, idx) => {
        const p = companyProducts.find((c) => c.id === pid)
        if (!p) return
        const line = productToLine(p, "company", [])
        const note = rowNotes[r.row_id]
        const lineId = idx === 0 ? r.row_id : `${r.row_id}#${pid}`
        const lineEd = idx === 0 ? ed : {}
        out.push({ ...line, line_id: lineId, qty: lineEd.qty ?? line.qty, unit_price: lineEd.unit_price ?? line.unit_price, checked: lineEd.checked ?? line.checked, remark: note || line.remark })
      })
    }
    return out
  }, [rows, companyProducts, lineEdits, rowNotes])

  const matchedCount = useMemo(
    () => rows.filter((r) => (r.product_id || (r.custom_names?.length ?? 0) > 0) && r.resolution === "company").length,
    [rows],
  )
  const unmatchedCount = useMemo(
    () => rows.filter((r) => r.kind === "none" && r.resolution === "company" && !r.suggestion && !(r.custom_names?.length ?? 0)).length,
    [rows],
  )
  const suggestedCount = useMemo(
    () => rows.filter((r) => !r.product_id && !(r.custom_names?.length ?? 0) && r.suggestion && r.resolution === "company").length,
    [rows],
  )
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
      const n = exportMappingCompareXlsx(compareRows, { sourceColumns, projectName: name })
      toast.success(`已导出匹配对照表（${n} 行，含统计汇总/待确认清单）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [compareRows, sourceColumns, name])

  /** 目录覆盖视角：公司库逐模块 × 本项目命中情况（未覆盖高亮） */
  const exportCoverage = useCallback(async () => {
    if (!compareRows.length) {
      toast.error("暂无对照结果，无法生成覆盖视角")
      return
    }
    try {
      const { exportCoverageXlsx } = await import("./productMappingExports")
      const n = exportCoverageXlsx(companyProducts, compareRows)
      toast.success(`已导出目录覆盖视角（公司库 ${n} 个模块）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [companyProducts, compareRows])

  /** 评级覆盖清单导出：评级先筛 → 客户要求补充 → 标注 公司/三方/自定义 */
  const exportRatingCoverage = useCallback(async () => {
    if (!ratingCoverageRows.length) {
      toast.error("暂无评级覆盖内容，请先完成对照或选择评级要求")
      return
    }
    try {
      const { exportRatingCoverageXlsx } = await import("./ratingCoverageExport")
      const n = exportRatingCoverageXlsx(ratingCoverageRows, ratingSel)
      toast.success(`已导出评级覆盖清单（${n} 项，含评级必选 ${ratingStats.required} 项）`)
    } catch {
      toast.error("导出失败，请稍后重试")
    }
  }, [ratingCoverageRows, ratingSel, ratingStats])

  const exportCompanyStandard = useCallback(async () => {
    const hitProducts = rows
      .filter((r) => r.product_id && r.resolution === "company")
      .flatMap((r) => rowProductIds(r))
      .map((id) => companyProducts.find((c) => c.id === id))
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

  // ------------------------------ 映射库沉淀（pair 级：一个「外部名 → 模块」一对 = 一行） ------------------------------
  const upsertMapping = useCallback(
    async (norm: string, productName: string, productId: string) => {
      try {
        // pair 级查重：同一外部名允许沉淀多对（一对多），按 productId 区分
        const existing = mappings.find(
          (m) => normStr(m.customer_norm) === normStr(norm) && (m.product_id || "") === productId,
        )
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

  /**
   * 同步某外部名的全部映射 pair（多对多记忆口径）：
   * 新选中的补建、保留的 hit_count+1、被取消的删除。pairs 为空 = 清空该外部名的记忆。
   */
  const syncMappingPairs = useCallback(
    async (norm: string, pairs: { productId: string; productName: string }[]) => {
      try {
        const existing = mappings.filter((m) => normStr(m.customer_norm) === normStr(norm))
        const keepIds = new Set(pairs.map((p) => p.productId))
        const stale = existing.filter((m) => !keepIds.has(m.product_id || ""))
        for (let i = 0; i < stale.length; i += 12) {
          await Promise.all(stale.slice(i, i + 12).map((m) => pbJsonRequest(`/api/check_mappings/${m.id}`, { method: "DELETE" })))
        }
        for (let i = 0; i < pairs.length; i += 12) {
          await Promise.all(
            pairs.slice(i, i + 12).map(async (p) => {
              const hit = existing.find((m) => (m.product_id || "") === p.productId)
              if (hit) {
                await pbJsonRequest(`/api/check_mappings/${hit.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ hit_count: (Number(hit.hit_count) || 0) + 1, company_product_name: p.productName, product_id: p.productId }),
                })
              } else {
                await pbJsonRequest("/api/check_mappings", {
                  method: "POST",
                  body: JSON.stringify({ customer_norm: norm, company_product_name: p.productName, product_id: p.productId, hit_count: 1 }),
                })
              }
            }),
          )
        }
      } catch {
        // 同步失败不阻断界面操作
      }
    },
    [mappings],
  )
  // 供上方 setMatchProducts / adoptAllSuggestions 调用（避免 TDZ，同时保持 setter 身份稳定）。
  // 必须在 effect 里赋值：渲染期写 ref 违反 React 规则（react-hooks/refs 会报「Cannot access refs during render」）。
  useEffect(() => {
    syncMappingPairsRef.current = syncMappingPairs
    upsertMappingRef.current = upsertMapping
    loadMappingsRef.current = loadMappings
  }, [syncMappingPairs, upsertMapping, loadMappings])

  /**
   * 2026-10-29：同步某外部名的自定义模块名到映射记忆库。
   * 一条自定义 = check_mappings 里一行（product_id 空、custom_name 有值）。
   * 与公司库 pair 互不干扰：只增删 custom_name 非空的那批行。
   */
  const syncCustomNames = useCallback(
    async (norm: string, names: string[]) => {
      try {
        const existing = mappings.filter(
          (m) => normStr(m.customer_norm) === normStr(norm) && !String(m.product_id || "").trim(),
        )
        const keep = new Set(names.map((n) => normStr(n)))
        // 已移除的自定义：删行
        const stale = existing.filter((m) => !keep.has(normStr(m.custom_name || "")))
        if (stale.length) {
          await Promise.all(stale.map((m) => pbJsonRequest(`/api/check_mappings/${m.id}`, { method: "DELETE" })))
        }
        // 新加的：补建；已存在的：hit_count+1
        for (const n of names) {
          const hit = existing.find((m) => normStr(m.custom_name || "") === normStr(n))
          if (hit) {
            await pbJsonRequest(`/api/check_mappings/${hit.id}`, {
              method: "PATCH",
              body: JSON.stringify({ hit_count: (Number(hit.hit_count) || 0) + 1 }),
            })
          } else {
            await pbJsonRequest("/api/check_mappings", {
              method: "POST",
              body: JSON.stringify({
                customer_norm: norm,
                company_product_name: n,
                product_id: "",
                custom_name: n,
                hit_count: 1,
              }),
            })
          }
        }
      } catch {
        // 沉淀失败不阻断界面操作
      }
    },
    [mappings],
  )

  useEffect(() => {
    syncCustomNamesRef.current = syncCustomNames
  }, [syncCustomNames])

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
      const writes = manualMappingWrites(rows, companyProducts)
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
  }, [checklistLines, name, hospital, rawText, rows, companyProducts, upsertMapping, loadMappings])

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
    suggestedCount,
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
    // 上传向导（任意 Excel，保留原表列）
    sourceColumns,
    wizardFile,
    openWizard,
    closeWizard,
    confirmWizard,
    // 操作
    startMatch,
    importFromBid,
    importFromSolution,
    setMatchProduct,
    setMatchProducts,
    setMatchResolution,
    setCustomNames,
    updateLineEdit,
    adoptAllSuggestions,
    runAiMatch,
    clearResult,
    exportCompare,
    exportCompanyStandard,
    // 评级筛选（2026-10-29）
    ratingSel,
    toggleRating,
    clearRating,
    includeRatingOptional,
    setIncludeRatingOptional,
    ratingCoverageRows,
    ratingStats,
    exportRatingCoverage,
    exportCoverage,
    exportSkeleton,
    saveMapping,
    reloadProducts: loadProducts,
    reloadMappings: loadMappings,
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
