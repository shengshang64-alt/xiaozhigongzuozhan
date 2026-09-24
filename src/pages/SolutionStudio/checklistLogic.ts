import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import type { LlmMessage } from "@/lib/llm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { skillCostSuffix } from "@/lib/skillCore"
import { currentStudioCostText, llmGenerate } from "./studioLlm"
import { exportTechParamsXlsx } from "./checklistExports"
import { companySeedRows, industrySeedRows } from "./checklistSeed"
import {
  calcTotal,
  lineSimilarity,
  makeLineId,
  normalizeCustomerLine,
  parseMatchJson,
  productToLine,
  tagsHitTargets,
  type CheckMapping,
  type CheckProduct,
  type ChecklistLine,
  type ChecklistRecord,
  type MatchRow,
  type ProductDraft,
  type TechParam,
} from "./checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单 Logic 层：产品库 / 两路径清单向导 / 清单详情 / 映射库沉淀
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

export type CkStep = "path" | "targets" | "autocheck" | "raw" | "match"

const MAX_TOKENS_MATCH = 2048
const SIM_THRESHOLD = 0.6
const MAPPING_SIM_THRESHOLD = 0.8

async function postInChunks<T>(path: string, payloads: T[], chunkSize = 12): Promise<number> {
  let done = 0
  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(async (body) => {
        await apiFetch(path, { method: "POST", body: JSON.stringify(body) })
        done += 1
      }),
    )
  }
  return done
}

function nameNorm(s: string): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase()
}

/** 统一确认对话框请求（替代 window.confirm，由 View 层挂 ConfirmDialog 渲染） */
type CkConfirmRequest = {
  title: string
  description?: string
  tone?: "default" | "danger"
  confirmText?: string
  action: () => void
}

export function useChecklist(deps: {
  userId: string | null
  runCostConfirm: (action: () => void, priceText: string) => void
}) {
  const userIdRef = useRef(deps.userId)
  userIdRef.current = deps.userId

  // ------------------------------ 统一确认对话框 ------------------------------
  const [confirmRequest, setConfirmRequest] = useState<CkConfirmRequest | null>(null)
  const requestConfirm = useCallback((req: CkConfirmRequest) => setConfirmRequest(req), [])
  const closeConfirmRequest = useCallback(() => setConfirmRequest(null), [])
  const runConfirmRequest = useCallback(() => {
    const req = confirmRequest
    setConfirmRequest(null)
    req?.action()
  }, [confirmRequest])

  // 全站技能带入：清单 AI 语义匹配功能点
  const matchSkills = useScopeSkills("checklist-match", deps.userId ?? undefined)

  // ------------------------------ 产品库（团队共享） ------------------------------
  const [products, setProducts] = useState<CheckProduct[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const seedTriedRef = useRef(false)

  const [mappings, setMappings] = useState<CheckMapping[]>([])
  const [myChecklists, setMyChecklists] = useState<ChecklistRecord[]>([])
  const [checklistsLoading, setChecklistsLoading] = useState(false)
  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    setProductsLoading(true)
    try {
      // B6：服务端单页上限 200（传 500 会被钳到 200 且无翻页），显式声明 200 边界；
      // >200 条产品属极端场景，暂接受单页截断
      const data = await apiFetch<ListResponse<CheckProduct>>("/api/check_products?page=1&perPage=200")
      setProducts(data.items ?? [])
      return data.items ?? []
    } catch {
      toast.error("产品库加载失败，请稍后重试")
      return []
    } finally {
      setProductsLoading(false)
    }
  }, [])

  const loadMappings = useCallback(async () => {
    try {
      // B6：同 loadProducts——单页上限 200，显式声明边界
      const data = await apiFetch<ListResponse<CheckMapping>>("/api/check_mappings?page=1&perPage=200")
      setMappings(data.items ?? [])
    } catch {
      setMappings([])
    }
  }, [])

  const loadMyChecklists = useCallback(async (uid: string) => {
    setChecklistsLoading(true)
    try {
      const data = await apiFetch<ListResponse<ChecklistRecord>>(
        `/api/checklists?rh_user_id=${encodeURIComponent(uid)}&perPage=200`,
      )
      setMyChecklists(data.items ?? [])
    } catch {
      toast.error("我的清单加载失败，请稍后重试")
    } finally {
      setChecklistsLoading(false)
    }
  }, [])

  /** 首次进入：无 is_builtin 行则批量写入行业库 + 示例公司产品（幂等） */
  const seedIfNeeded = useCallback(
    async (rows: CheckProduct[]) => {
      if (seedTriedRef.current) return
      if (rows.some((p) => p.is_builtin)) return
      if (!userIdRef.current) return
      seedTriedRef.current = true
      setSeeding(true)
      try {
        const payloads = [...industrySeedRows(), ...companySeedRows()]
        await postInChunks("/api/check_products", payloads)
        toast.success(`行业系统库已初始化（${payloads.length} 行），可直接使用或修改`)
        await loadProducts()
      } catch {
        seedTriedRef.current = false
        toast.error("行业系统库初始化失败，请稍后重试")
      } finally {
        setSeeding(false)
      }
    },
    [loadProducts],
  )

  useEffect(() => {
    void (async () => {
      const rows = await loadProducts()
      await loadMappings()
      await seedIfNeeded(rows)
    })()
  }, [loadMappings, loadProducts, seedIfNeeded])

  useEffect(() => {
    if (deps.userId) void loadMyChecklists(deps.userId)
    else setMyChecklists([])
  }, [deps.userId, loadMyChecklists])

  const companyProducts = useMemo(() => products.filter((p) => p.in_company), [products])
  const industryProducts = useMemo(() => products.filter((p) => p.is_builtin), [products])

  // ------------------------------ 产品增删改 / 导入导出 ------------------------------
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null)
  const [productDraftId, setProductDraftId] = useState<string | null>(null)
  const [productSaving, setProductSaving] = useState(false)
  const [importBusy, setImportBusy] = useState(false)

  const openAddCompanyProduct = useCallback(() => {
    setProductDraftId(null)
    setProductDraft({
      is_builtin: false,
      in_company: true,
      category: "",
      product_line: "",
      product_name: "",
      module_name: "",
      module_func: "",
      description: "",
      charge_mode: "系统授权",
      unit_price: 0,
      status: "在售",
      rating_tags: {},
    })
    setProductDialogOpen(true)
  }, [])

  const openAddIndustryProduct = useCallback(() => {
    setProductDraftId(null)
    setProductDraft({
      is_builtin: true,
      in_company: false,
      category: "",
      product_line: "",
      product_name: "",
      module_name: "",
      module_func: "",
      description: "",
      charge_mode: "模块授权",
      unit_price: 0,
      status: "在售",
      rating_tags: {},
    })
    setProductDialogOpen(true)
  }, [])

  const openEditProduct = useCallback((p: CheckProduct) => {
    setProductDraftId(p.id)
    setProductDraft({
      is_builtin: p.is_builtin,
      in_company: p.in_company,
      category: p.category,
      product_line: p.product_line,
      product_name: p.product_name,
      module_name: p.module_name,
      module_func: p.module_func,
      description: p.description,
      charge_mode: p.charge_mode,
      unit_price: Number(p.unit_price) || 0,
      status: p.status,
      rating_tags: p.rating_tags ?? {},
    })
    setProductDialogOpen(true)
  }, [])

  const closeProductDialog = useCallback(() => setProductDialogOpen(false), [])

  const saveProductDraft = useCallback(async () => {
    if (!productDraft) return
    if (!productDraft.product_name.trim()) {
      toast.error("请填写产品名称")
      return
    }
    setProductSaving(true)
    try {
      if (productDraftId) {
        await apiFetch(`/api/check_products/${productDraftId}`, {
          method: "PATCH",
          body: JSON.stringify(productDraft),
        })
        toast.success("产品已更新")
      } else {
        await apiFetch("/api/check_products", { method: "POST", body: JSON.stringify(productDraft) })
        toast.success("产品已新增")
      }
      setProductDialogOpen(false)
      await loadProducts()
    } catch {
      toast.error("保存失败，请检查网络后重试")
    } finally {
      setProductSaving(false)
    }
  }, [productDraft, productDraftId, loadProducts])

  const deleteProduct = useCallback(
    (id: string) => {
      const target = products.find((x) => x.id === id)
      requestConfirm({
        title: "删除产品",
        description: `确定删除「${target?.product_name ?? "该产品"}」吗？删除后引用该产品的清单不受影响。`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          void (async () => {
            try {
              await apiFetch(`/api/check_products/${id}`, { method: "DELETE" })
              toast.success("产品已删除")
              await loadProducts()
            } catch {
              toast.error("删除失败，请稍后重试")
            }
          })()
        },
      })
    },
    [loadProducts, products, requestConfirm],
  )

  const adoptIndustryRow = useCallback(
    async (p: CheckProduct) => {
      try {
        await apiFetch("/api/check_products", {
          method: "POST",
          body: JSON.stringify({ ...p, id: undefined, is_builtin: false, in_company: true }),
        })
        toast.success(`「${p.product_name}」已纳入我公司产品，可编辑`)
        await loadProducts()
      } catch {
        toast.error("纳入失败，请稍后重试")
      }
    },
    [loadProducts],
  )

  const importProductRows = useCallback(
    async (rows: Partial<CheckProduct>[]) => {
      if (!rows.length) {
        toast.error("未解析到有效产品行，请检查模板表头")
        return
      }
      setImportBusy(true)
      try {
        const payloads = rows.map((r) => ({
          is_builtin: false,
          in_company: true,
          category: r.category ?? "",
          product_line: r.product_line ?? "",
          product_name: r.product_name ?? "",
          module_name: r.module_name ?? "",
          module_func: r.module_func ?? "",
          description: r.description ?? "",
          charge_mode: r.charge_mode || "模块授权",
          unit_price: Number(r.unit_price) || 0,
          status: r.status || "在售",
          rating_tags: r.rating_tags ?? {},
        }))
        await postInChunks("/api/check_products", payloads)
        toast.success(`已导入 ${payloads.length} 行产品`)
        await loadProducts()
      } catch {
        toast.error("导入失败，请稍后重试")
      } finally {
        setImportBusy(false)
      }
    },
    [loadProducts],
  )

  // ------------------------------ 技术参数库（轮次 E-3） ------------------------------
  const [paramDialogOpen, setParamDialogOpen] = useState(false)
  const [paramProduct, setParamProduct] = useState<CheckProduct | null>(null)
  const [paramDraft, setParamDraft] = useState<TechParam[]>([])
  const [paramDirty, setParamDirty] = useState(false)
  const paramDirtyRef = useRef(false)
  const paramSaveTimerRef = useRef<number | null>(null)

  const persistTechParams = useCallback(async (productId: string, params: TechParam[]) => {
    try {
      await apiFetch(`/api/check_products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ tech_params: params }),
      })
      setProducts((prev) => prev.map((x) => (x.id === productId ? { ...x, tech_params: params } : x)))
      paramDirtyRef.current = false
      setParamDirty(false)
    } catch {
      toast.error("参数保存失败，请检查网络后重试")
    }
  }, [])

  const openParamEditor = useCallback((p: CheckProduct) => {
    if (paramSaveTimerRef.current) {
      window.clearTimeout(paramSaveTimerRef.current)
      paramSaveTimerRef.current = null
    }
    setParamProduct(p)
    setParamDraft((p.tech_params ?? []).map((t) => ({ ...t })))
    paramDirtyRef.current = false
    setParamDirty(false)
    setParamDialogOpen(true)
  }, [])

  /** 行内编辑统一入口：本地立即更新 + 400ms 防抖 PATCH（照抄清单详情 500ms 防抖模式） */
  const updateParamDraft = useCallback(
    (next: TechParam[]) => {
      setParamDraft(next)
      const pid = paramProduct?.id
      if (!pid) return
      paramDirtyRef.current = true
      setParamDirty(true)
      if (paramSaveTimerRef.current) window.clearTimeout(paramSaveTimerRef.current)
      paramSaveTimerRef.current = window.setTimeout(() => {
        paramSaveTimerRef.current = null
        void persistTechParams(pid, next)
      }, 400)
    },
    [paramProduct, persistTechParams],
  )

  const flushParamDraft = useCallback(() => {
    if (paramSaveTimerRef.current) {
      window.clearTimeout(paramSaveTimerRef.current)
      paramSaveTimerRef.current = null
    }
    const pid = paramProduct?.id
    if (pid && paramDirtyRef.current) void persistTechParams(pid, paramDraft)
  }, [paramDraft, paramProduct, persistTechParams])

  /** 关闭前脏数据确认：确认=保存并关闭，取消=留在对话框继续编辑 */
  const requestCloseParamEditor = useCallback(() => {
    if (paramDirtyRef.current) {
      requestConfirm({
        title: "参数尚未保存",
        description: "最近一次参数修改还在同步中，保存并关闭吗？取消则留在本页继续编辑。",
        confirmText: "保存并关闭",
        action: () => {
          flushParamDraft()
          setParamDialogOpen(false)
        },
      })
      return
    }
    setParamDialogOpen(false)
  }, [flushParamDraft, requestConfirm])

  const setParamRow = useCallback(
    (index: number, patch: Partial<TechParam>) => {
      updateParamDraft(paramDraft.map((t, i) => (i === index ? { ...t, ...patch } : t)))
    },
    [paramDraft, updateParamDraft],
  )

  const addParamRow = useCallback(() => {
    updateParamDraft([...paramDraft, { param_name: "", param_value: "", competitor_note: "" }])
  }, [paramDraft, updateParamDraft])

  const removeParamRow = useCallback(
    (index: number) => {
      updateParamDraft(paramDraft.filter((_, i) => i !== index))
    },
    [paramDraft, updateParamDraft],
  )

  const moveParamRow = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir
      if (target < 0 || target >= paramDraft.length) return
      const next = [...paramDraft]
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      updateParamDraft(next)
    },
    [paramDraft, updateParamDraft],
  )

  // 多选模式 → 导出参数响应表
  const [paramSelectMode, setParamSelectMode] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])

  const toggleParamSelectMode = useCallback(() => {
    setParamSelectMode((prev) => {
      if (prev) setSelectedProductIds([])
      return !prev
    })
  }, [])

  const toggleProductSelect = useCallback((id: string) => {
    setSelectedProductIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const exportSelectedTechParams = useCallback(() => {
    const rows = companyProducts.filter((p) => selectedProductIds.includes(p.id))
    if (!rows.length) {
      toast.error("请先勾选要导出的产品")
      return
    }
    const { exported, skipped } = exportTechParamsXlsx(rows)
    if (!exported) {
      toast.error("所选产品均未配置技术参数，无法导出参数响应表")
      return
    }
    toast.success(
      skipped
        ? `参数响应表已导出（${exported} 个产品），${skipped} 个产品未配参数已跳过`
        : `参数响应表已导出（${exported} 个产品）`,
    )
  }, [companyProducts, selectedProductIds])

  // ------------------------------ 新建清单向导 ------------------------------
  const [ckWizardOpen, setCkWizardOpen] = useState(false)
  const [ckStep, setCkStep] = useState<CkStep>("path")
  const [ckTargets, setCkTargets] = useState<string[]>([])
  const [ckLines, setCkLines] = useState<ChecklistLine[]>([])
  const [ckRawText, setCkRawText] = useState("")
  const [ckMatchRows, setCkMatchRows] = useState<MatchRow[]>([])
  const [ckMatchBusy, setCkMatchBusy] = useState(false)
  const [ckName, setCkName] = useState("")
  const [ckHospital, setCkHospital] = useState("")
  const [ckSaving, setCkSaving] = useState(false)

  const openChecklistWizard = useCallback(() => {
    if (!userIdRef.current) {
      toast.error("当前无法新建清单，请稍后重试")
      return
    }
    setCkStep("path")
    setCkTargets([])
    setCkLines([])
    setCkRawText("")
    setCkMatchRows([])
    setCkName("")
    setCkHospital("")
    setCkWizardOpen(true)
  }, [])

  const closeChecklistWizard = useCallback(() => setCkWizardOpen(false), [])

  const toggleTarget = useCallback((code: string) => {
    setCkTargets((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }, [])

  const companyCoversName = useCallback(
    (productName: string) => {
      const norm = nameNorm(productName)
      return companyProducts.some((c) => {
        const cn = nameNorm(c.product_name)
        return cn === norm || cn.includes(norm) || norm.includes(cn)
      })
    },
    [companyProducts],
  )

  /** 路径 A：按评级目标自动勾选 */
  const applyAutoCheck = useCallback(() => {
    if (!ckTargets.length) {
      toast.error("请至少选择一个评级目标")
      return
    }
    const lines: ChecklistLine[] = []
    for (const p of companyProducts) {
      const hits = tagsHitTargets(p.rating_tags, ckTargets)
      if (hits.length) lines.push(productToLine(p, "company", hits))
    }
    for (const p of industryProducts) {
      const hits = tagsHitTargets(p.rating_tags, ckTargets)
      if (!hits.length) continue
      if (companyCoversName(p.product_name)) continue
      lines.push(productToLine(p, "external", hits))
    }
    if (!lines.length) {
      toast.error("当前评级目标没有匹配到任何系统，请调整目标或先维护产品库")
      return
    }
    setCkLines(lines)
    if (!ckName.trim()) setCkName(`${ckHospital.trim() || "医院"}建设清单`)
    setCkStep("autocheck")
    const externalCount = lines.filter((l) => l.source === "external").length
    toast.success(`已自动勾选 ${lines.length} 项，其中外购 ${externalCount} 项，可人工调整`)
  }, [ckTargets, companyProducts, industryProducts, companyCoversName, ckName, ckHospital])

  const toggleLineChecked = useCallback((lineId: string) => {
    setCkLines((prev) => prev.map((l) => (l.line_id === lineId ? { ...l, checked: !l.checked } : l)))
  }, [])

  const updateWizardLine = useCallback((lineId: string, patch: Partial<ChecklistLine>) => {
    setCkLines((prev) => prev.map((l) => (l.line_id === lineId ? { ...l, ...patch } : l)))
  }, [])

  const removeWizardLine = useCallback((lineId: string) => {
    setCkLines((prev) => prev.filter((l) => l.line_id !== lineId))
  }, [])

  const addWizardLineFromProduct = useCallback(
    (productId: string) => {
      const p = companyProducts.find((c) => c.id === productId)
      if (!p) return
      setCkLines((prev) => [...prev, productToLine(p, "company", tagsHitTargets(p.rating_tags, ckTargets))])
    },
    [companyProducts, ckTargets],
  )

  // ------------------------------ 路径 B：客户清单匹配 ------------------------------

  const localMatchProduct = useCallback(
    (norm: string): CheckProduct | null => {
      if (!norm) return null
      let best: CheckProduct | null = null
      let bestScore = 0
      for (const p of companyProducts) {
        const pn = nameNorm(p.product_name)
        const mn = nameNorm(p.module_name)
        if (!pn) continue
        if (pn === norm || (norm.length >= 2 && (norm.includes(pn) || pn.includes(norm)))) return p
        const score = Math.max(lineSimilarity(norm, pn), mn ? lineSimilarity(norm, mn) * 0.9 : 0)
        if (score > bestScore) {
          bestScore = score
          best = p
        }
      }
      return bestScore >= SIM_THRESHOLD ? best : null
    },
    [companyProducts],
  )

  const runAiAndMappingMatch = useCallback(
    async (rows: MatchRow[]) => {
      const unmatched = rows.filter((r) => r.kind === "none")
      if (!unmatched.length) {
        setCkMatchRows(rows)
        setCkStep("match")
        return
      }
      setCkMatchRows(rows)
      setCkStep("match")
      setCkMatchBusy(true)
      try {
        const names = Array.from(new Set(companyProducts.map((p) => p.product_name)))
        const messages: LlmMessage[] = [
          {
            role: "system",
            content: [
              "你是医疗信息化行业资深售前专家，负责把客户清单里的系统名称语义匹配到我公司产品名列表。",
              "只输出严格 JSON 数组，禁止解释文字与代码围栏，格式：",
              '[{"customer":"客户条目原文","product":"我公司产品名或null"}]',
              "名称含义相同或属同一系统（如「电子病历系统」对「电子病历」、「集成平台软件」对「集成平台」）即匹配；确实无关才填 null。",
            ].join("\n"),
          },
          {
            role: "user",
            content: `【客户清单条目】\n${unmatched.map((r) => r.norm).join("\n")}\n\n【我公司产品名列表】\n${names.join("、")}\n\n请逐条匹配并输出 JSON。`,
          },
        ]
        const text = await llmGenerate(messages, MAX_TOKENS_MATCH, "checklist-match", 0)
        const pairs = parseMatchJson(text)
        const nameToProduct = new Map(companyProducts.map((p) => [nameNorm(p.product_name), p]))
        setCkMatchRows((prev) =>
          prev.map((r) => {
            if (r.kind !== "none") return r
            const pair = pairs.find((x) => nameNorm(x.customer) === r.norm)
            if (pair?.product) {
              const product = nameToProduct.get(nameNorm(pair.product))
              if (product) return { ...r, kind: "ai" as const, product_name: product.product_name, product_id: product.id, resolution: "company" as const }
            }
            return r
          }),
        )
        toast.success("AI 语义匹配完成，未命中条目可人工指定")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "AI 匹配失败，可人工指定未命中条目")
      } finally {
        // AI 后仍未命中的，再查团队共享映射库模糊命中
        setCkMatchRows((prev) =>
          prev.map((r) => {
            if (r.kind !== "none") return r
            const hit = mappings.find(
              (m) =>
                nameNorm(m.customer_norm) === r.norm ||
                (r.norm.length >= 4 && (r.norm.includes(nameNorm(m.customer_norm)) || nameNorm(m.customer_norm).includes(r.norm))) ||
                lineSimilarity(r.norm, nameNorm(m.customer_norm)) >= MAPPING_SIM_THRESHOLD,
            )
            if (!hit) return r
            const product = companyProducts.find((p) => p.id === hit.product_id)
            return {
              ...r,
              kind: "mapping" as const,
              product_name: product?.product_name ?? hit.company_product_name,
              product_id: product?.id ?? "",
              resolution: "company" as const,
            }
          }),
        )
        setCkMatchBusy(false)
      }
    },
    [companyProducts, mappings],
  )

  const startCustomerMatch = useCallback(
    (rawLines: string[], rawText: string) => {
      const norms: string[] = []
      for (const raw of rawLines) {
        const norm = normalizeCustomerLine(raw)
        if (norm.length >= 2 && !norms.includes(norm)) norms.push(norm)
      }
      if (!norms.length) {
        toast.error("未解析到有效清单条目，请粘贴文本或上传 Excel")
        return
      }
      setCkRawText(rawText)
      const rows: MatchRow[] = norms.map((norm) => {
        const exactMapping = mappings.find((m) => nameNorm(m.customer_norm) === norm)
        if (exactMapping) {
          const product = companyProducts.find((p) => p.id === exactMapping.product_id)
          return {
            row_id: makeLineId(),
            raw: norm,
            norm,
            product_name: product?.product_name ?? exactMapping.company_product_name,
            product_id: product?.id ?? "",
            kind: "mapping" as const,
            resolution: "company" as const,
          }
        }
        const local = localMatchProduct(norm)
        if (local) {
          return {
            row_id: makeLineId(),
            raw: norm,
            norm,
            product_name: local.product_name,
            product_id: local.id,
            kind: "local" as const,
            resolution: "company" as const,
          }
        }
        return { row_id: makeLineId(), raw: norm, norm, product_name: "", product_id: "", kind: "none" as const, resolution: "company" as const }
      })
      const unmatchedCount = rows.filter((r) => r.kind === "none").length
      if (!unmatchedCount) {
        setCkMatchRows(rows)
        setCkStep("match")
        toast.success(`已匹配 ${rows.length} 条客户条目`)
        return
      }
      deps.runCostConfirm(() => {
        void runAiAndMappingMatch(rows)
      }, `将对 ${unmatchedCount} 条未命中条目做 AI 语义匹配，${currentStudioCostText()}${skillCostSuffix("checklist-match")}`)
    },
    [companyProducts, deps, localMatchProduct, mappings, runAiAndMappingMatch],
  )

  const setMatchProduct = useCallback(
    (rowId: string, productId: string) => {
      setCkMatchRows((prev) =>
        prev.map((r) => {
          if (r.row_id !== rowId) return r
          if (!productId) {
            return { ...r, product_name: "", product_id: "", kind: "none" as const, resolution: "company" as const }
          }
          const product = companyProducts.find((p) => p.id === productId)
          return {
            ...r,
            product_id: productId,
            product_name: product?.product_name ?? "",
            kind: "manual" as const,
            resolution: "company" as const,
          }
        }),
      )
    },
    [companyProducts],
  )

  const setMatchResolution = useCallback((rowId: string, resolution: MatchRow["resolution"]) => {
    setCkMatchRows((prev) =>
      prev.map((r) => (r.row_id === rowId ? { ...r, resolution } : r)),
    )
  }, [])

  // ------------------------------ 映射库沉淀 ------------------------------
  const upsertMapping = useCallback(async (norm: string, productName: string, productId: string) => {
    try {
      const existing = mappings.find((m) => nameNorm(m.customer_norm) === nameNorm(norm))
      if (existing) {
        await apiFetch(`/api/check_mappings/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ hit_count: (Number(existing.hit_count) || 0) + 1, company_product_name: productName, product_id: productId }),
        })
      } else {
        await apiFetch("/api/check_mappings", {
          method: "POST",
          body: JSON.stringify({ customer_norm: norm, company_product_name: productName, product_id: productId, hit_count: 1 }),
        })
      }
    } catch {
      // 映射沉淀失败不阻断清单生成
    }
  }, [mappings])

  // ------------------------------ 保存清单 ------------------------------
  // T2-12：返回成功/失败布尔——调用侧（saveMatchChecklist）按结果分支，
  // 保存失败时不再写人工映射、不弹成功 toast
  const saveChecklist = useCallback(
    async (sourceMode: "rating" | "customer_match", lines: ChecklistLine[], customerRaw: string): Promise<boolean> => {
      const uid = userIdRef.current
      if (!uid) {
        toast.error("当前无法保存清单，请稍后重试")
        return false
      }
      const kept = lines.filter((l) => l.checked !== false)
      if (!kept.length) {
        toast.error("清单没有任何勾选条目，请补充后再保存")
        return false
      }
      if (!ckName.trim()) {
        toast.error("请填写清单名称")
        return false
      }
      setCkSaving(true)
      try {
        const record = await apiFetch<ChecklistRecord>("/api/checklists", {
          method: "POST",
          body: JSON.stringify({
            rh_user_id: uid,
            checklist_name: ckName.trim(),
            hospital: ckHospital.trim(),
            rating_targets: ckTargets,
            source_mode: sourceMode,
            customer_raw: customerRaw,
            items: kept,
            total_amount: calcTotal(kept),
            status: "confirmed",
          }),
        })
        setMyChecklists((prev) => [record, ...prev.filter((c) => c.id !== record.id)])
        setActiveChecklistId(record.id)
        setCkWizardOpen(false)
        toast.success("建设清单已保存")
        return true
      } catch {
        toast.error("清单保存失败，请稍后重试")
        return false
      } finally {
        setCkSaving(false)
      }
    },
    [ckHospital, ckName, ckTargets],
  )

  const saveRatingChecklist = useCallback(() => {
    void saveChecklist("rating", ckLines, "")
  }, [ckLines, saveChecklist])

  const saveMatchChecklist = useCallback(() => {
    const lines: ChecklistLine[] = []
    const manualWrites: { norm: string; productName: string; productId: string }[] = []
    for (const r of ckMatchRows) {
      if (r.resolution === "ignore") continue
      if (r.resolution === "external") {
        lines.push({
          line_id: makeLineId(),
          category: "外购系统",
          product_line: "",
          product_name: r.norm,
          module_name: "",
          module_func: "客户清单要求，公司暂无对应产品",
          unit: "套",
          qty: 1,
          unit_price: 0,
          source: "external",
          rating_hits: [],
          remark: "客户清单匹配外购",
          product_id: "",
          checked: true,
        })
        continue
      }
      const product = companyProducts.find((p) => p.id === r.product_id)
      if (!product) continue
      lines.push(productToLine(product, "company", []))
      if (r.kind === "manual") manualWrites.push({ norm: r.norm, productName: product.product_name, productId: product.id })
    }
    if (!lines.length) {
      toast.error("没有可入库的匹配结果，请为未命中条目指定产品或标外购")
      return
    }
    void saveChecklist("customer_match", lines, ckRawText).then((saved) => {
      // T2-12：清单保存失败时不写映射库、不弹成功 toast，避免「假成功」误导
      if (!saved || !manualWrites.length) return
      void Promise.all(manualWrites.map((w) => upsertMapping(w.norm, w.productName, w.productId))).then(() => {
        void loadMappings()
        toast.success(`已将 ${manualWrites.length} 条人工映射写入团队映射库，下次相似条目自动命中`)
      })
    })
  }, [ckMatchRows, ckRawText, companyProducts, loadMappings, saveChecklist, upsertMapping])

  // ------------------------------ 清单详情编辑 ------------------------------
  const activeChecklist = useMemo(
    () => myChecklists.find((c) => c.id === activeChecklistId) ?? null,
    [myChecklists, activeChecklistId],
  )

  // 保存状态徽标：idle=已保存 / saving=保存中 / error=保存失败（点击重试）
  const [checklistSaveState, setChecklistSaveState] = useState<"idle" | "saving" | "error">("idle")
  const ckSaveTimerRef = useRef<number | null>(null)
  const ckPendingSaveRef = useRef<{ rec: ChecklistRecord; patch: Partial<ChecklistRecord> } | null>(null)
  const ckFailedSaveRef = useRef<{ rec: ChecklistRecord; patch: Partial<ChecklistRecord> } | null>(null)

  const runChecklistPersistOnce = useCallback(async (rec: ChecklistRecord, patch: Partial<ChecklistRecord>) => {
    try {
      setChecklistSaveState("saving")
      await apiFetch(`/api/checklists/${rec.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      ckFailedSaveRef.current = null
      setChecklistSaveState("idle")
    } catch {
      ckFailedSaveRef.current = { rec, patch }
      setChecklistSaveState("error")
      toast.error("清单保存失败，可点击「保存失败」徽标重试")
    }
  }, [])

  // 循环 9 A1：整包覆盖 PATCH 在飞串行 + coalesce——有在飞请求时只存最新快照，settle 后自动续发一次
  const ckInflightRef = useRef<Promise<void> | null>(null)
  const ckPendingNextRef = useRef<{ rec: ChecklistRecord; patch: Partial<ChecklistRecord> } | null>(null)
  const persistChecklist = useCallback(
    (rec: ChecklistRecord, patch: Partial<ChecklistRecord>): Promise<void> => {
      const start = (r: ChecklistRecord, pt: Partial<ChecklistRecord>): Promise<void> => {
        const p = runChecklistPersistOnce(r, pt).then(() => {
          if (ckInflightRef.current === p) ckInflightRef.current = null
          const next = ckPendingNextRef.current
          if (next) {
            ckPendingNextRef.current = null
            void start(next.rec, next.patch)
          }
        })
        ckInflightRef.current = p
        return p
      }
      if (ckInflightRef.current) {
        ckPendingNextRef.current = { rec, patch }
        return ckInflightRef.current
      }
      return start(rec, patch)
    },
    [runChecklistPersistOnce],
  )

  const retryChecklistSave = useCallback(() => {
    const failed = ckFailedSaveRef.current
    if (!failed) {
      setChecklistSaveState("idle")
      return
    }
    void persistChecklist(failed.rec, failed.patch)
  }, [persistChecklist])

  // B4：直发落库前取消行编辑的 500ms 防抖快照——增/删行直发 persistChecklist 时，
  // 若不清 timer/pending，旧全量快照会在 500ms 后迟到覆盖，导致删除行复活/新增行丢失。
  // 直发路径的 items 基于最新本地 state（updateActiveLine 已同步更新）构造，天然包含防抖中的编辑内容，
  // 因此丢弃 pending 快照不会丢数据。
  const cancelCkPendingLineSave = useCallback(() => {
    if (ckSaveTimerRef.current) {
      window.clearTimeout(ckSaveTimerRef.current)
      ckSaveTimerRef.current = null
    }
    ckPendingSaveRef.current = null
  }, [])

  const updateActiveLine = useCallback(
    (lineId: string, patch: Partial<ChecklistLine>) => {
      const cur = activeChecklist
      if (!cur) return
      const items = (cur.items ?? []).map((l) => (l.line_id === lineId ? { ...l, ...patch } : l))
      const next = { ...cur, items, total_amount: calcTotal(items) }
      setMyChecklists((prev) => prev.map((c) => (c.id === cur.id ? next : c)))
      // 500ms 防抖归并：行内表格连续键入不再每键 PATCH，本地 state 立即更新
      ckPendingSaveRef.current = { rec: next, patch: { items, total_amount: next.total_amount } }
      setChecklistSaveState("saving")
      if (ckSaveTimerRef.current) window.clearTimeout(ckSaveTimerRef.current)
      ckSaveTimerRef.current = window.setTimeout(() => {
        ckSaveTimerRef.current = null
        const pending = ckPendingSaveRef.current
        ckPendingSaveRef.current = null
        if (pending) void persistChecklist(pending.rec, pending.patch)
      }, 500)
    },
    [activeChecklist, persistChecklist],
  )

  const addActiveLineFromProduct = useCallback(
    (productId: string) => {
      const cur = activeChecklist
      const p = companyProducts.find((c) => c.id === productId)
      if (!cur || !p) return
      const items = [...(cur.items ?? []), productToLine(p, "company", [])]
      const next = { ...cur, items, total_amount: calcTotal(items) }
      setMyChecklists((prev) => prev.map((c) => (c.id === cur.id ? next : c)))
      // B4：直发前清掉行编辑防抖快照，防旧快照迟到覆盖新增行
      cancelCkPendingLineSave()
      void persistChecklist(next, { items, total_amount: next.total_amount })
    },
    [activeChecklist, cancelCkPendingLineSave, companyProducts, persistChecklist],
  )

  const addActiveExternalLine = useCallback(() => {
    const cur = activeChecklist
    if (!cur) return
    const line: ChecklistLine = {
      line_id: makeLineId(),
      category: "外购系统",
      product_line: "",
      product_name: "新外购系统",
      module_name: "",
      module_func: "",
      unit: "套",
      qty: 1,
      unit_price: 0,
      source: "external",
      rating_hits: [],
      remark: "",
      product_id: "",
      checked: true,
    }
    const items = [...(cur.items ?? []), line]
    const next = { ...cur, items, total_amount: calcTotal(items) }
    setMyChecklists((prev) => prev.map((c) => (c.id === cur.id ? next : c)))
    // B4：直发前清掉行编辑防抖快照，防旧快照迟到覆盖新增行
    cancelCkPendingLineSave()
    void persistChecklist(next, { items, total_amount: next.total_amount })
  }, [activeChecklist, cancelCkPendingLineSave, persistChecklist])

  const removeActiveLine = useCallback(
    (lineId: string) => {
      const cur = activeChecklist
      if (!cur) return
      const line = (cur.items ?? []).find((l) => l.line_id === lineId)
      requestConfirm({
        title: "删除清单条目",
        description: `确定删除「${line?.product_name ?? "该条目"}」吗？`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          const items = (cur.items ?? []).filter((l) => l.line_id !== lineId)
          const next = { ...cur, items, total_amount: calcTotal(items) }
          setMyChecklists((prev) => prev.map((c) => (c.id === cur.id ? next : c)))
          // B4：确认删除落库前清掉行编辑防抖快照（确认可能发生在 500ms 窗口内），防删除行复活
          cancelCkPendingLineSave()
          void persistChecklist(next, { items, total_amount: next.total_amount })
        },
      })
    },
    [activeChecklist, cancelCkPendingLineSave, persistChecklist, requestConfirm],
  )

  const deleteChecklist = useCallback(
    (id: string) => {
      const target = myChecklists.find((c) => c.id === id)
      requestConfirm({
        title: "删除建设清单",
        description: `确定删除「${target?.checklist_name ?? "该清单"}」吗？删除后不可恢复。`,
        tone: "danger",
        confirmText: "删除",
        action: () => {
          void (async () => {
            try {
              await apiFetch(`/api/checklists/${id}`, { method: "DELETE" })
              setMyChecklists((prev) => prev.filter((c) => c.id !== id))
              if (activeChecklistId === id) setActiveChecklistId(null)
              toast.success("清单已删除")
            } catch {
              toast.error("删除失败，请稍后重试")
            }
          })()
        },
      })
    },
    [activeChecklistId, myChecklists, requestConfirm],
  )

  const openChecklistDetail = useCallback((id: string) => setActiveChecklistId(id), [])
  const closeChecklistDetail = useCallback(() => setActiveChecklistId(null), [])

  return {
    // 统一确认对话框 / 保存状态
    confirmRequest,
    closeConfirmRequest,
    runConfirmRequest,
    checklistSaveState,
    retryChecklistSave,
    // 产品库
    products,
    productsLoading,
    seeding,
    companyProducts,
    industryProducts,
    productDialogOpen,
    productDraft,
    setProductDraft,
    productDraftId,
    productSaving,
    openAddCompanyProduct,
    openAddIndustryProduct,
    openEditProduct,
    closeProductDialog,
    saveProductDraft,
    deleteProduct,
    adoptIndustryRow,
    importProductRows,
    importBusy,
    // 技术参数库（轮次 E-3）
    paramDialogOpen,
    paramProduct,
    paramDraft,
    paramDirty,
    openParamEditor,
    requestCloseParamEditor,
    setParamRow,
    addParamRow,
    removeParamRow,
    moveParamRow,
    paramSelectMode,
    toggleParamSelectMode,
    selectedProductIds,
    toggleProductSelect,
    exportSelectedTechParams,
    // 清单列表 / 详情
    myChecklists,
    checklistsLoading,
    activeChecklist,
    openChecklistDetail,
    closeChecklistDetail,
    deleteChecklist,
    updateActiveLine,
    addActiveLineFromProduct,
    addActiveExternalLine,
    removeActiveLine,
    // 向导
    ckWizardOpen,
    openChecklistWizard,
    closeChecklistWizard,
    ckStep,
    setCkStep,
    ckTargets,
    toggleTarget,
    applyAutoCheck,
    ckLines,
    toggleLineChecked,
    updateWizardLine,
    removeWizardLine,
    addWizardLineFromProduct,
    ckRawText,
    setCkRawText,
    startCustomerMatch,
    ckMatchRows,
    ckMatchBusy,
    setMatchProduct,
    setMatchResolution,
    ckName,
    setCkName,
    ckHospital,
    setCkHospital,
    ckSaving,
    saveRatingChecklist,
    saveMatchChecklist,
    // 全站技能带入
    matchSkills,
  }
}

export type UseChecklist = ReturnType<typeof useChecklist>
