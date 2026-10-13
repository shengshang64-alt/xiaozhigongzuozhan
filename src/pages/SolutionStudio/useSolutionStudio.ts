import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
// R147（解除 r124-solutionstudio-docx-defer）：docx 运行时符号改由 exportWord 点击链动态导入，
// 此处仅保留编译期擦除的类型引用，SolutionStudio 路由 chunk 不再静态打包 docx。
import type { Paragraph, Table, TableOfContents } from "docx"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import { modelRefKey, resolveAvailableModels, type ModelRef } from "@/lib/modelGateway"
import {
  searchKbDocs,
  tokenizeText,
  visibleKbDocs,
  type KbDocRow,
  type KbSearchHit,
} from "@/lib/kbCore"
import { assembleKbContext, getCachedVisibleDocs, invalidateKbCache, prewarmKbCache } from "@/lib/kbAssemble"
import { deriveSection, deriveTrack } from "@/lib/kbTaxonomy"
import { contextSnippetOf } from "@/lib/kbPolicy"
import { listKbQaPairs, matchQaPair, visibleQaPairs, type KbQaPairRow } from "@/lib/kbQa"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import {
  DEFAULT_FORMAT_SETTINGS,
  chapterWordBudgets,
  normalizeFormatSettings,
  parseChapterOutput,
  sanitizeChapterText,
  stripOverlap,
  trimToBudget,
  type FormatSettings,
} from "@/pages/BidWorkspace/bidTypes"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { skillCostSuffix } from "@/lib/skillCore"
import { currentStudioCostText, llmGenerate, setStudioModelRef } from "./studioLlm"
import { formatFailedChapterList, isBlankChapterOutput } from "./chapterGenGuard"
import { BLANK_OUTPUT_REASON, describeGenFailure } from "./genFailureNote"
import { runBulkPool } from "@/lib/bulkPool"
import { buildSelfCheckOverview } from "./solSelfCheckOverview"
import { DEFAULT_EXPORT_TEMPLATE, buildExportFrontMatter, readSolutionExportTemplate, writeSolutionExportTemplate, type SolutionExportTemplate } from "./exportTemplate"
import { useChecklist } from "./checklistLogic"
import { snapshotFromChecklist, type ChecklistRecord } from "./checklistTypes"
import { checklistToOutlineSkeleton } from "./checklistToOutline"
import { bulkResumeNotice, deriveSolutionDocStatus, shouldRecoverStaleGenerating } from "./bulkResume"
import {
  addChildToTree,
  buildChapterMessages,
  buildSolContinueMessages,
  buildChapterReviewMessages,
  buildOutlineMessages,
  buildRefineMessages,
  deepCopyOutline,
  DOC_STATUS_LABEL,
  makeUid,
  moveNodeInTree,
  normalizeOutline,
  outlineToText,
  parseChapterReview,
  parseOutlineJson,
  removeNodeFromTree,
  renameNodeInTree,
  SOLUTION_TYPES,
  SOL_COMPLIANCE_MODE_DEFAULT,
  normalizeSolMode,
  typeLabel,
  VERDICT_LABEL,
  type Chapter,
  type ChapterSelfCheck,
  type DocStatus,
  type FigureSpec,
  type HospitalInfo,
  type OutlineNode,
  type RefineKind,
  type SolutionComplianceMode,
  type SolutionRecord,
  type SolutionTypeKey,
} from "./solutionTypes"

// ---------------------------------------------------------------------------
// 数据请求（走 __pb 代理自定义路由，禁用 PB SDK 标准 REST）
// ---------------------------------------------------------------------------

// 轮次 F 轨 2：方案向导「关联商机」下拉的最小商机选项（字段与 opportunities collection 一致）
export type SolutionOppOption = {
  id: string
  opp_name: string
  customer_name: string
}

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

// ---------------------------------------------------------------------------
// LLM 调用封装见 ./studioLlm（方案编制与建设清单共用，统一模型网关 + 错误中文化）
// ---------------------------------------------------------------------------

const MAX_TOKENS_OUTLINE = 4096
const MAX_TOKENS_LONGFORM = 8192
const MAX_TOKENS_REVIEW = 4096

// ---------------------------------------------------------------------------
// 素材弹药面板派生类型（轮次 E-1，View 层 props 共用）
// ---------------------------------------------------------------------------

export type MaterialTab = "kb" | "ammo" | "history"

export type MaterialKbHit = KbSearchHit

/** sol5 智能推荐：按当前章节主题跨三来源本地推导的素材条目（零 AI 调用） */
export type MaterialRecoItem = {
  key: string
  source: "kb" | "ammo" | "history"
  title: string
  badge: string
  snippet: string
  text: string
  /** 插入时写入正文的「素材来源」标注 */
  label: string
}

export type MaterialHistoryBlock = {
  key: string
  solutionId: string
  solutionName: string
  chapterTitle: string
  text: string
}

// 循环 9 C2：方案导出页面格式按方案存 localStorage（零 collection 变更）；读写容错，损坏即回缺省
function ssFmtKey(id: string): string {
  return `ss_fmt_${id}`
}

function readSsFmt(id: string): FormatSettings {
  try {
    const raw = localStorage.getItem(ssFmtKey(id))
    if (!raw) return DEFAULT_FORMAT_SETTINGS
    return normalizeFormatSettings(JSON.parse(raw)) ?? DEFAULT_FORMAT_SETTINGS
  } catch {
    return DEFAULT_FORMAT_SETTINGS
  }
}

// 05 §6：方案侧三模式按方案存 localStorage（零 collection 变更）；读容错，非法回默认 moderate
function solModeKey(id: string): string {
  return `ss_mode_${id}`
}

function readSolMode(id: string): SolutionComplianceMode {
  try {
    return normalizeSolMode(localStorage.getItem(solModeKey(id)))
  } catch {
    return SOL_COMPLIANCE_MODE_DEFAULT
  }
}

// 问题1+2：生成设置（目标页数→逐章字数预算；配图开关→架构图/流程图）按方案存 localStorage（零 collection 变更）
export type SolGenSettings = { targetPages: number; figuresEnabled: boolean }

const SOL_GEN_DEFAULT: SolGenSettings = { targetPages: 0, figuresEnabled: false }

function solGenKey(id: string): string {
  return `ss_gen_${id}`
}

function normalizeTargetPages(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(200, Math.round(n)))
}

function readSolGen(id: string): SolGenSettings {
  try {
    const raw = localStorage.getItem(solGenKey(id))
    if (!raw) return SOL_GEN_DEFAULT
    const o = JSON.parse(raw) as Partial<SolGenSettings>
    return { targetPages: normalizeTargetPages(o.targetPages), figuresEnabled: o.figuresEnabled === true }
  } catch {
    return SOL_GEN_DEFAULT
  }
}

function emptyHospitalInfo(): HospitalInfo {
  return {
    hospital_level: "三级甲等",
    bed_scale: "",
    outpatient_scale: "",
    demand_departments: "",
    systems: [],
    budget_range: "300-500 万",
    special_requirements: "",
  }
}

// ---------------------------------------------------------------------------
// 主 Hook
// ---------------------------------------------------------------------------

export function useSolutionStudio() {
  const costConfirm = useCostConfirm()

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [, setAccountInfo] = useState<RhAccountInfo | null>(null)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    setUserId(account?.userId ?? decodeRhToken()?.sub ?? null)
  }, [])

  // ------------------------------ 建设清单（方案前置环节） ------------------------------
  const checklist = useChecklist({ userId, runCostConfirm: costConfirm.runWithCostConfirm })
  const [studioView, setStudioView] = useState<"checklist" | "solution">("solution")

  // ------------------------------ 全站技能带入（方案侧 3 个功能点） ------------------------------
  const outlineSkills = useScopeSkills("solution-outline", userId ?? undefined)
  const chapterSkills = useScopeSkills("solution-chapter", userId ?? undefined)
  const rewriteSkills = useScopeSkills("solution-rewrite", userId ?? undefined)

  // ------------------------------ 模型选择（统一网关） ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")

  const loadModelOptions = useCallback(async () => {
    const av = await resolveAvailableModels()
    setModelOptions(av.models)
    setSelectedModelKey((prev) =>
      prev && av.models.some((m) => modelRefKey(m) === prev)
        ? prev
        : av.defaultRef
          ? modelRefKey(av.defaultRef)
          : "",
    )
  }, [])

  useEffect(() => {
    if (userId) void loadModelOptions()
  }, [userId, loadModelOptions])

  useEffect(() => {
    setStudioModelRef(modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null)
  }, [modelOptions, selectedModelKey])

  const handleSelectModel = useCallback((key: string) => setSelectedModelKey(key), [])

  // ------------------------------ 方案列表 ------------------------------
  const [solutions, setSolutions] = useState<SolutionRecord[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState("")

  const loadSolutions = useCallback(async (uid: string) => {
    setListLoading(true)
    try {
      // R004（D-9）：服务端单页上限 200，totalItems 已改为真总数；这里按页拉全（上限 10 页防失控）
      const perPage = 200
      const first = await apiFetch<ListResponse<SolutionRecord>>(
        `/api/solutions?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=${perPage}`,
      )
      const items: SolutionRecord[] = [...(first.items ?? [])]
      const total = first.totalItems ?? items.length
      for (let page = 2; items.length < total && page <= 10; page++) {
        const next = await apiFetch<ListResponse<SolutionRecord>>(
          `/api/solutions?rh_user_id=${encodeURIComponent(uid)}&page=${page}&perPage=${perPage}`,
        )
        if (!next.items?.length) break
        items.push(...next.items)
      }
      setSolutions(items)
    } catch {
      toast.error("方案列表加载失败，请稍后重试")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (userId) void loadSolutions(userId)
    else setSolutions([])
  }, [userId, loadSolutions])

  const filteredSolutions = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase()
    if (!kw) return solutions
    return solutions.filter(
      (s) =>
        s.solution_name?.toLowerCase().includes(kw) ||
        s.hospital?.toLowerCase().includes(kw) ||
        typeLabel(s.solution_type).includes(kw),
    )
  }, [solutions, searchKeyword])

  // 方案列表统计卡（对齐原型「全部 / 编写中 / 已完成」）——始终基于未过滤的全量 solutions，
  // 不受搜索关键词影响，保证「全部方案」恒为真实总数。done=已完成，其余（大纲中/生成中/部分成稿）计入编写中。
  const solutionStats = useMemo(() => {
    const total = solutions.length
    const done = solutions.filter((s) => s.doc_status === "done").length
    return { total, done, drafting: total - done }
  }, [solutions])

  // ------------------------------ 商机选项（轮次 F 轨 2：新建方案可关联商机） ------------------------------
  const [wizardOppOptions, setWizardOppOptions] = useState<SolutionOppOption[]>([])

  useEffect(() => {
    if (!userId) {
      setWizardOppOptions([])
      return
    }
    void (async () => {
      try {
        const data = await apiFetch<ListResponse<SolutionOppOption>>(
          `/api/opportunities?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=200`,
        )
        setWizardOppOptions(data.items ?? [])
      } catch {
        // 商机选项加载失败不阻塞方案创建，下拉为空时可跳过关联
        setWizardOppOptions([])
      }
    })()
  }, [userId])

  // ------------------------------ 视图模式 ------------------------------
  const [mode, setMode] = useState<"list" | "editor">("list")
  const [activeSolution, setActiveSolution] = useState<SolutionRecord | null>(null)
  const activeSolutionRef = useRef<SolutionRecord | null>(null)
  // 循环 9 C2：当前方案的导出页面格式（纸张/边距/页码；随方案切换加载，防抖落 localStorage）
  const [ssFmt, setSsFmt] = useState<FormatSettings>(DEFAULT_FORMAT_SETTINGS)
  const ssFmtTimerRef = useRef<number | null>(null)
  // 05 §6：当前方案的生成模式（随方案切换加载，即时落 localStorage）
  const [solComplianceMode, setSolComplianceModeState] = useState<SolutionComplianceMode>(SOL_COMPLIANCE_MODE_DEFAULT)
  const solComplianceModeRef = useRef<SolutionComplianceMode>(SOL_COMPLIANCE_MODE_DEFAULT)
  // 问题1+2：当前方案的生成设置（目标页数/配图开关，随方案切换加载，即时落 localStorage）
  const [solGen, setSolGenState] = useState<SolGenSettings>(SOL_GEN_DEFAULT)
  const solGenRef = useRef<SolGenSettings>(SOL_GEN_DEFAULT)
  // R007（B-4 阶段一）：导出模板（封面/目录/页眉；随方案切换加载，即时落 localStorage）
  const [expTpl, setExpTpl] = useState<SolutionExportTemplate>(DEFAULT_EXPORT_TEMPLATE)

  const applySolutionState = useCallback((next: SolutionRecord | null) => {
    activeSolutionRef.current = next
    setActiveSolution(next)
    if (next) {
      setSolutions((prev) => prev.map((s) => (s.id === next.id ? next : s)))
      setSsFmt(readSsFmt(next.id))
      setExpTpl(readSolutionExportTemplate(next.id))
      const m = readSolMode(next.id)
      solComplianceModeRef.current = m
      setSolComplianceModeState(m)
      const g = readSolGen(next.id)
      solGenRef.current = g
      setSolGenState(g)
    }
  }, [])

  /** R007（B-4 阶段一）：导出模板补丁——乐观更新 + 即时写 localStorage（序列化失败静默降级） */
  const setExpTplPatch = useCallback((patch: Partial<SolutionExportTemplate>) => {
    const id = activeSolutionRef.current?.id
    setExpTpl((prev) => {
      const next = { ...prev, ...patch }
      if (id) writeSolutionExportTemplate(id, next)
      return next
    })
  }, [])

  /** 循环 9 C2：格式补丁——乐观更新 + 400ms 防抖写 localStorage（序列化失败静默降级） */
  const setSsFmtPatch = useCallback((patch: Partial<FormatSettings>) => {
    const id = activeSolutionRef.current?.id
    setSsFmt((prev) => {
      const nextFmt = { ...prev, ...patch }
      if (id) {
        if (ssFmtTimerRef.current) window.clearTimeout(ssFmtTimerRef.current)
        ssFmtTimerRef.current = window.setTimeout(() => {
          ssFmtTimerRef.current = null
          try {
            localStorage.setItem(ssFmtKey(id), JSON.stringify(nextFmt))
          } catch {
            /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
          }
        }, 400)
      }
      return nextFmt
    })
  }, [])

  /** 05 §6：切换生成模式——乐观更新 + 即时写 localStorage（同步 ref 供生成回调读取） */
  const setSolComplianceMode = useCallback((mode: SolutionComplianceMode) => {
    solComplianceModeRef.current = mode
    setSolComplianceModeState(mode)
    const id = activeSolutionRef.current?.id
    if (id) {
      try {
        localStorage.setItem(solModeKey(id), mode)
      } catch {
        /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
      }
    }
  }, [])

  /** 问题1+2：生成设置补丁——同步 ref 供生成回调读取 + 即时写 localStorage */
  const setSolGenPatch = useCallback((patch: Partial<SolGenSettings>) => {
    const next: SolGenSettings = {
      targetPages: patch.targetPages !== undefined ? normalizeTargetPages(patch.targetPages) : solGenRef.current.targetPages,
      figuresEnabled: patch.figuresEnabled !== undefined ? patch.figuresEnabled === true : solGenRef.current.figuresEnabled,
    }
    solGenRef.current = next
    setSolGenState(next)
    const id = activeSolutionRef.current?.id
    if (id) {
      try {
        localStorage.setItem(solGenKey(id), JSON.stringify(next))
      } catch {
        /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
      }
    }
  }, [])

  const persistSolution = useCallback(
    async (rec: SolutionRecord, patch: Partial<SolutionRecord>, quiet = false) => {
      try {
        await apiFetch(`/api/solutions/${rec.id}`, { method: "PATCH", body: JSON.stringify(patch) })
        if (quiet) {
          setAutoSaveState("saved")
          if (autoSaveResetRef.current) window.clearTimeout(autoSaveResetRef.current)
          autoSaveResetRef.current = window.setTimeout(() => setAutoSaveState("idle"), 2000)
        }
      } catch {
        if (quiet) setAutoSaveState("idle")
        if (!quiet) toast.error("保存失败，请检查网络后重试")
      }
    },
    [],
  )

  /** 更新当前方案（本地 + 远端 PATCH） */
  const updateSolution = useCallback(
    (patch: Partial<SolutionRecord>, opts?: { persist?: boolean; quiet?: boolean }) => {
      const cur = activeSolutionRef.current
      if (!cur) return
      const next: SolutionRecord = { ...cur, ...patch }
      applySolutionState(next)
      if (opts?.persist !== false) {
        const p = persistSolution(next, patch, opts?.quiet)
        lastPersistRef.current = p
        void p
      }
    },
    [applySolutionState, persistSolution],
  )

  const updateChapter = useCallback(
    (nodeId: string, patch: Partial<Chapter>, opts?: { persist?: boolean; quiet?: boolean }) => {
      const cur = activeSolutionRef.current
      if (!cur) return
      const chapters = cur.chapters.map((c) => (c.node_id === nodeId ? { ...c, ...patch } : c))
      updateSolution({ chapters }, opts)
    },
    [updateSolution],
  )

  // ------------------------------ 新建向导 ------------------------------
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [formTypeKey, setFormTypeKey] = useState<SolutionTypeKey>("planning")
  const [formChecklistId, setFormChecklistId] = useState("")
  const [formSolutionName, setFormSolutionName] = useState("")
  const [formHospital, setFormHospital] = useState("")
  const [formOpportunityId, setFormOpportunityId] = useState("")
  const [formInfo, setFormInfo] = useState<HospitalInfo>(emptyHospitalInfo)
  const [outlineDraft, setOutlineDraft] = useState<OutlineNode[]>([])
  const [outlineLoading, setOutlineLoading] = useState(false)
  // ux-01：确认大纲创建方案的在途护栏——ref 同步拦双点/连按 Enter 重复 POST，state 只驱动按钮禁用反馈
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const draftSourceRef = useRef<{ outline: OutlineNode[] } | null>(null)

  const openNewWizard = useCallback(() => {
    draftSourceRef.current = null
    setFormTypeKey("planning")
    setFormChecklistId("")
    setFormSolutionName("")
    setFormHospital("")
    setFormOpportunityId("")
    setFormInfo(emptyHospitalInfo())
    setOutlineDraft([])
    setWizardStep(1)
    setWizardOpen(true)
  }, [userId])

  const openReuseWizard = useCallback((rec: SolutionRecord) => {
    draftSourceRef.current = { outline: deepCopyOutline(rec.outline ?? []) }
    setFormTypeKey(rec.solution_type)
    // B5：与 openNewWizard 对称重置清单快照选择，防止上一次新建向导选过的
    // formChecklistId 残留，被 confirmOutline 误写进复用方案的 ref_checklist_snapshot
    setFormChecklistId("")
    setFormSolutionName(`${rec.solution_name}（底稿复用）`)
    setFormHospital(rec.hospital ?? "")
    setFormOpportunityId("")
    setFormInfo({ ...emptyHospitalInfo(), ...(rec.hospital_info ?? {}) })
    setOutlineDraft([])
    setWizardStep(2)
    setWizardOpen(true)
  }, [])

  // 商机下拉排序：客户名与已填医院模糊匹配的排前（复刻 bid-workspace 第四轮关联模式）
  const sortedWizardOppOptions = useMemo(() => {
    const kw = formHospital.trim()
    if (!kw) return wizardOppOptions
    return [...wizardOppOptions].sort((a, b) => {
      const aHit = (a.customer_name ?? "").includes(kw) ? 0 : 1
      const bHit = (b.customer_name ?? "").includes(kw) ? 0 : 1
      return aHit - bHit
    })
  }, [wizardOppOptions, formHospital])

  const closeWizard = useCallback(() => {
    setWizardOpen(false)
    setOutlineLoading(false)
  }, [])

  /** 关联建设清单：预填建设内容与医院 */
  const applyChecklistPrefill = useCallback((rec: ChecklistRecord) => {
    // R150：只取有名字的 product_name，避免 undefined 混进 systems（空清单时原实现会把 undefined 当一个系统带入）
    const systems = Array.from(
      new Set(
        (rec.items ?? [])
          .filter((l) => l.checked !== false)
          .map((l) => String(l.product_name ?? "").trim())
          .filter(Boolean),
      ),
    )
    setFormInfo((prev) => ({
      ...prev,
      systems: Array.from(new Set([...prev.systems, ...systems])),
      // R150：选清单即写快照——A5 生成大纲的 prompt（checklistScopeBlock 读 formInfo）才能拿到建设范围；
      // 原实现只在 confirmOutline 落库时写快照，大纲生成永远看不到清单
      ref_checklist_id: rec.id,
      ref_checklist_snapshot: snapshotFromChecklist(rec),
    }))
    setFormHospital((prev) => (prev.trim() ? prev : rec.hospital ?? ""))
  }, [])

  const handlePickChecklist = useCallback(
    (id: string) => {
      setFormChecklistId(id)
      const rec = checklist.myChecklists.find((c) => c.id === id)
      if (rec) applyChecklistPrefill(rec)
    },
    [applyChecklistPrefill, checklist.myChecklists],
  )

  /** 清单详情「按此清单生成方案」：切方案编制视图并开向导预填 */
  const startSolutionFromChecklist = useCallback(
    (id: string) => {
      const rec = checklist.myChecklists.find((c) => c.id === id)
      setStudioView("solution")
      openNewWizard()
      if (!rec) return
      setFormChecklistId(rec.id)
      setFormHospital(rec.hospital ?? "")
      applyChecklistPrefill(rec)
      setWizardStep(2)
    },
    [applyChecklistPrefill, checklist.myChecklists, openNewWizard],
  )

  const generateOutlineDraft = useCallback(async () => {
    setOutlineLoading(true)
    try {
      const solutionName = formSolutionName.trim() || `${formHospital.trim()}${typeLabel(formTypeKey)}`
      const text = await llmGenerate(
        buildOutlineMessages(formTypeKey, solutionName, formHospital.trim(), formInfo),
        MAX_TOKENS_OUTLINE,
        "solution-outline",
      )
      const nodes = normalizeOutline(parseOutlineJson(text))
      if (!nodes.length) throw new Error("大纲格式解析失败，请重试")
      setOutlineDraft(nodes)
      setWizardStep(3)
      toast.success("大纲已生成，可调整后确认")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "大纲生成失败，请重试")
    } finally {
      setOutlineLoading(false)
    }
  }, [formHospital, formInfo, formSolutionName, formTypeKey])

  const submitWizardInfo = useCallback(() => {
    if (!formHospital.trim()) {
      toast.error("请填写医院名称")
      return
    }
    if (!formInfo.systems.length) {
      toast.error("请至少勾选一个建设系统")
      return
    }
    if (draftSourceRef.current?.outline?.length) {
      setOutlineDraft(draftSourceRef.current.outline)
      setWizardStep(3)
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void generateOutlineDraft()
    }, `将根据项目信息生成方案大纲，${currentStudioCostText()}${skillCostSuffix("solution-outline")}`)
  }, [costConfirm, formHospital, formInfo.systems.length, generateOutlineDraft])

  // R168：按清单组装标准方案骨架（零 AI）——把清单命中的系统按方案类型标准章节铺成大纲，
  // 不走大模型、不产生费用；骨架仍可在第三步编辑，再复用既有逐章生成填正文。
  const assembleOutlineFromChecklist = useCallback(() => {
    if (!formInfo.systems.length) {
      toast.error("请至少勾选一个建设系统/产品，或先在清单里勾选后带入")
      return
    }
    setOutlineDraft(checklistToOutlineSkeleton(formInfo.systems, formTypeKey))
    setWizardStep(3)
    toast.success(`已按清单 ${formInfo.systems.length} 个系统组装标准方案骨架，可继续调整再确认`)
  }, [formInfo.systems, formTypeKey])

  // 大纲树编辑操作（向导第三步）
  const outlineRename = useCallback((id: string, title: string) => {
    setOutlineDraft((prev) => renameNodeInTree(prev, id, title))
  }, [])
  const outlineRemove = useCallback((id: string) => {
    setOutlineDraft((prev) => removeNodeFromTree(prev, id))
  }, [])
  const outlineAddChild = useCallback((parentId: string, depth: number) => {
    if (depth >= 3) return
    setOutlineDraft((prev) =>
      addChildToTree(prev, parentId, { id: makeUid(), title: "新小节（点击改名）", children: [] }),
    )
  }, [])
  const outlineAddRoot = useCallback(() => {
    setOutlineDraft((prev) => [...prev, { id: makeUid(), title: "新章节（点击改名）", children: [] }])
  }, [])
  const outlineMove = useCallback((id: string, dir: -1 | 1) => {
    setOutlineDraft((prev) => moveNodeInTree(prev, id, dir) ?? prev)
  }, [])

  const confirmOutline = useCallback(async () => {
    // ux-01：在途互斥——上一次创建未落地前直接忽略（双点/连按 Enter/网络慢时重复提交），防创建多个同名方案
    if (confirmingRef.current) return
    if (!outlineDraft.length) {
      toast.error("大纲为空，请先生成或添加章节")
      return
    }
    confirmingRef.current = true
    setConfirming(true)
    const chapters: Chapter[] = outlineDraft.map((n) => ({
      node_id: n.id,
      title: n.title,
      sections: (n.children ?? []).map((c) => c.title),
      content: "",
      gen_status: "pending" as const,
    }))
    const solutionName = formSolutionName.trim() || `${formHospital.trim()}${typeLabel(formTypeKey)}`
    const linkedChecklist = checklist.myChecklists.find((c) => c.id === formChecklistId)
    const hospitalInfoPayload = linkedChecklist
      ? {
          ...formInfo,
          ref_checklist_id: linkedChecklist.id,
          ref_checklist_snapshot: snapshotFromChecklist(linkedChecklist),
        }
      : formInfo
    try {
      const record = await apiFetch<SolutionRecord>("/api/solutions", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          solution_name: solutionName,
          solution_type: formTypeKey,
          hospital: formHospital.trim(),
          hospital_info: hospitalInfoPayload,
          outline: outlineDraft,
          chapters,
          doc_status: "outline",
        }),
      })
      setSolutions((prev) => [record, ...prev.filter((s) => s.id !== record.id)])
      setWizardOpen(false)
      applySolutionState(record)
      setActiveChapterId(record.chapters[0]?.node_id ?? null)
      setEditingContent("")
      setMode("editor")
      // 轮次 F 轨 2：选了关联商机则把商机 ref 指回本方案（商机详情即可看到关联方案）
      if (formOpportunityId) {
        try {
          await apiFetch(`/api/opportunities/${encodeURIComponent(formOpportunityId)}`, {
            method: "PATCH",
            body: JSON.stringify({ ref_type: "solution", ref_id: record.id, ref_name: solutionName }),
          })
          toast.success("方案已创建，并已关联到商机，可在客户管理的商机详情查看")
        } catch {
          toast.error("方案已创建，但商机关联失败，可在客户管理中手动关联")
        }
      } else {
        toast.success("方案已创建，可开始生成正文")
      }
    } catch {
      toast.error("方案创建失败，请稍后重试")
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }, [applySolutionState, checklist.myChecklists, formChecklistId, formHospital, formInfo, formOpportunityId, formSolutionName, formTypeKey, outlineDraft, userId])

  // ------------------------------ 编辑工作台 ------------------------------
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [editingContent, setEditingContentState] = useState("")
  const editingContentRef = useRef("")
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const autoSaveResetRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  // 最近一次「本地→远端」持久化的 Promise（persistSolution 内部自捕获，永不 reject）。
  // 写 doc_status 前先 await 它：后端 PATCH 是「读整行→改→存整行」，两笔并发会互相覆盖丢字段（R001 竞态根因）。
  const lastPersistRef = useRef<Promise<void> | null>(null)
  const [chapterBusy, setChapterBusy] = useState<string | null>(null)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 })
  const cancelBulkRef = useRef(false)
  // R276 整本批量自检：运行态 + 进度 + 取消门（与批量生成同构、相互独立）
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false)
  const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 })
  const cancelReviewRef = useRef(false)

  const activeChapter = useMemo(
    () => activeSolution?.chapters.find((c) => c.node_id === activeChapterId) ?? null,
    [activeSolution, activeChapterId],
  )

  const flushEditingContent = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const cur = activeSolutionRef.current
    const nodeId = activeChapterId
    if (!cur || !nodeId) return
    const ch = cur.chapters.find((c) => c.node_id === nodeId)
    if (ch && ch.content !== editingContentRef.current) {
      updateChapter(nodeId, { content: editingContentRef.current }, { quiet: true })
    }
  }, [activeChapterId, updateChapter])

  // Ctrl+S / Cmd+S → 强制刷保存（阻止浏览器默认另存为，立即 flush 编辑内容）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        flushEditingContent()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [flushEditingContent])

  const setEditingContent = useCallback(
    (value: string) => {
      setEditingContentState(value)
      editingContentRef.current = value
      setAutoSaveState("saving")
      if (autoSaveResetRef.current) { window.clearTimeout(autoSaveResetRef.current); autoSaveResetRef.current = null }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        flushEditingContent()
      }, 1000)
    },
    [flushEditingContent],
  )

  const selectChapter = useCallback(
    (nodeId: string) => {
      flushEditingContent()
      setActiveChapterId(nodeId)
      const ch = activeSolutionRef.current?.chapters.find((c) => c.node_id === nodeId)
      const content = ch?.content ?? ""
      editingContentRef.current = content
      setEditingContentState(content)
    },
    [flushEditingContent],
  )

  const openSolution = useCallback(
    (rec: SolutionRecord) => {
      let target = rec
      // 兜底：老记录 chapters 缺失时按大纲重建
      if ((!target.chapters || !target.chapters.length) && target.outline?.length) {
        target = {
          ...target,
          chapters: target.outline.map((n) => ({
            node_id: n.id,
            title: n.title,
            sections: (n.children ?? []).map((c) => c.title),
            content: "",
            gen_status: "pending" as const,
          })),
        }
        void persistSolution(target, { chapters: target.chapters }, true)
      }
      // R148：对齐标书 D1 中断恢复——打开方案时若持久化状态仍为「生成中」，但当前并无进行中的
      // 批量（刷新 / 崩溃 / 中途切走遗留的陈旧态），按各章 gen_status 推导真实阶段并复位，避免永久
      // 显示「生成中」徽标；存在已完成但未全的章时提示可从断点继续（继续生成正文会天然跳过已完成章）。
      if (shouldRecoverStaleGenerating(target.doc_status, false)) {
        const recovered = deriveSolutionDocStatus(target.chapters)
        if (recovered !== target.doc_status) {
          target = { ...target, doc_status: recovered }
          void persistSolution(target, { doc_status: recovered }, true)
        }
        const doneCh = target.chapters.filter((c) => c.gen_status === "done").length
        const notice = bulkResumeNotice(doneCh, target.chapters.length)
        if (notice) toast.info(notice)
      }
      applySolutionState(target)
      // R303：进方案即后台预热 KB 共享缓存。方案正文生成的关键路径是「先把全库语料拉进内存
      // （实测 33 页 ×500 条）再发模型请求」，标书侧（openProject · r89-guard-kb-cold-01）与知识库
      // 问答侧（R229）都早已利用用户操作的窗口期预热，唯独方案侧漏了——用户读大纲、挑章节、点确认
      // 运行的那几十秒全被浪费，代价直接落在首章「生成正文」的静默等待上。fire-and-forget：
      // 失败静默（共享缓存内部不留坏缓存），已热时 prewarmKbCache 自身 O(1) 跳过。
      void prewarmKbCache(userId)
      setActiveChapterId(target.chapters[0]?.node_id ?? null)
      const content = target.chapters[0]?.content ?? ""
      editingContentRef.current = content
      setEditingContentState(content)
      setMode("editor")
    },
    [applySolutionState, persistSolution, userId],
  )

  const backToList = useCallback(() => {
    flushEditingContent()
    cancelBulkRef.current = true
    setMode("list")
    setActiveSolution(null)
    activeSolutionRef.current = null
    if (userId) void loadSolutions(userId)
  }, [flushEditingContent, loadSolutions, userId])

  // 轮次 B + D2：全局搜索/活动流深链 ?solution= 消费（ref 存「已消费 id」，URL id 变化即重新消费）
  const [searchParams] = useSearchParams()
  const solutionDeepLinkIdRef = useRef<string | null>(null)
  useEffect(() => {
    const sid = searchParams.get("solution")
    if (!sid || solutionDeepLinkIdRef.current === sid || listLoading) return
    solutionDeepLinkIdRef.current = sid
    const target = solutions.find((s) => s.id === sid)
    if (target) {
      openSolution(target)
      return
    }
    void apiFetch<SolutionRecord>(`/api/solutions/${encodeURIComponent(sid)}`)
      .then((rec) => {
        if (rec?.id) openSolution(rec)
        else toast.error("未找到对应方案")
      })
      .catch(() => toast.error("未找到对应方案"))
  }, [searchParams, solutions, listLoading, openSolution])

  const deleteSolution = useCallback(
    async (rec: SolutionRecord) => {
      try {
        await apiFetch(`/api/solutions/${rec.id}`, { method: "DELETE" })
      } catch {
        toast.error("删除失败，请检查网络后重试")
        return
      }
      setSolutions((prev) => prev.filter((s) => s.id !== rec.id))
      toast.success("方案已删除")
      if (!userId) return
      // R004（D-10）：清理指向本方案的商机关联，避免商机详情出现死链。
      // opportunities list 仅支持 rh_user_id 过滤，拉 200 条后客户端筛 ref_id（与全局搜索兜底同模式）。
      try {
        const opps = await apiFetch<
          ListResponse<SolutionOppOption & { ref_type?: string; ref_id?: string }>
        >(`/api/opportunities?rh_user_id=${encodeURIComponent(userId)}&perPage=200`)
        const linked = (opps?.items ?? []).filter((o) => o.ref_type === "solution" && o.ref_id === rec.id)
        for (const o of linked) {
          await apiFetch(`/api/opportunities/${encodeURIComponent(o.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ ref_type: "", ref_id: "", ref_name: "" }),
          })
        }
      } catch {
        toast.error("方案已删除，但商机关联清理失败，可在客户管理中手动处理")
      }
    },
    [userId],
  )

  // ------------------------------ 章节 AI 操作 ------------------------------

  // 知识库自动复用（RAG）：共享可见文档缓存（kbAssemble 模块级，TTL 内不重复拉全库）
  const ensureKbCache = useCallback((): Promise<KbDocRow[]> => {
    return getCachedVisibleDocs(userId).catch(() => [] as KbDocRow[])
  }, [userId])
  // 问题 4：弹药库标准问答会话内缓存（同 kbCache 模式），正文生成时一并注入
  const qaCacheRef = useRef<KbQaPairRow[] | null>(null)
  useEffect(() => {
    qaCacheRef.current = null
  }, [userId])
  const ensureQaCache = useCallback(async (): Promise<KbQaPairRow[]> => {
    if (qaCacheRef.current) return qaCacheRef.current
    try {
      const pairs = visibleQaPairs(await listKbQaPairs(), userId).filter((r) => r.status === "approved")
      qaCacheRef.current = pairs
      return pairs
    } catch {
      return []
    }
  }, [userId])
  const buildKbRefBlock = useCallback(
    async (query: string): Promise<string> => {
      const q = query.slice(0, 600)
      const blocks: string[] = []
      try {
        const docs = await ensureKbCache()
        if (docs.length) {
          // 组装层第一期：按方案赛道（查询派生）+ 方案用途桶软加权，Top-K 5
          const { hits } = assembleKbContext(docs, {
            query: q,
            track: deriveTrack(q),
            buckets: ["方案素材", "政策法规标准", "产品资料"],
            sections: [deriveSection(q)],
            topN: 5,
          })
          if (hits.length) {
            blocks.push(
              hits
                .map(
                  (h) =>
                    `（来源：《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}）\n${contextSnippetOf(h.doc, { snippet: h.snippet })}`,
                )
                .join("\n\n"),
            )
          }
        }
      } catch {
        /* 检索失败不阻断生成，素材块置空 */
      }
      try {
        const pairs = await ensureQaCache()
        const scored: { pair: KbQaPairRow; score: number }[] = []
        for (const pair of pairs) {
          const matched = matchQaPair(q, [pair])
          if (matched) scored.push({ pair, score: matched.score })
        }
        scored.sort((a, b) => b.score - a.score)
        for (const { pair } of scored.slice(0, 2)) {
          blocks.push(`（来源：弹药库 · ${pair.question}）\n${(pair.answer ?? "").slice(0, 500)}`)
        }
      } catch {
        /* 弹药匹配失败同样不阻断 */
      }
      return blocks.join("\n\n")
    },
    [ensureKbCache, ensureQaCache],
  )

  // 问题 1：章节自动补足——低于预算 60% 时续写最多 2 轮；超写按 1.3× 预算段落边界裁剪
  const CHAPTER_MIN_RATIO = 0.6
  const CHAPTER_MAX_CONT_ROUNDS = 2
  const MAX_TOKENS_CONTINUE = 4096

  /** 单章正文生成共用链路（单章/批量同一入口）：KB 素材 → 字数预算 → 配图 JSON 契约 → 自动续写 */
  const generateChapterContent = useCallback(
    async (cur: SolutionRecord, idx: number): Promise<{ content: string; figures: FigureSpec[]; underlength: boolean }> => {
      const ch = cur.chapters[idx]
      const kbMaterial = await buildKbRefBlock([ch.title, ...(ch.sections ?? [])].filter(Boolean).join(" "))
      const { targetPages, figuresEnabled } = solGenRef.current
      const wordBudget = targetPages > 0 ? chapterWordBudgets(cur.chapters, targetPages)[idx] : 0
      const text = await llmGenerate(
        buildChapterMessages(
          {
            solution_name: cur.solution_name,
            solution_type: cur.solution_type,
            hospital: cur.hospital,
            hospital_info: cur.hospital_info,
            outline: cur.outline,
          },
          cur.chapters,
          idx,
          kbMaterial,
          solComplianceModeRef.current,
          wordBudget || undefined,
          figuresEnabled,
        ),
        MAX_TOKENS_LONGFORM,
        "solution-chapter",
      )
      const parsed = parseChapterOutput(text, figuresEnabled)
      let content = parsed.content
      for (let round = 0; wordBudget > 0 && round < CHAPTER_MAX_CONT_ROUNDS && content.length < wordBudget * CHAPTER_MIN_RATIO; round++) {
        let extra: string
        try {
          const cont = await llmGenerate(
            buildSolContinueMessages(
              {
                solution_name: cur.solution_name,
                solution_type: cur.solution_type,
                hospital: cur.hospital,
                hospital_info: cur.hospital_info,
              },
              ch.title,
              content,
              wordBudget - content.length,
              solComplianceModeRef.current,
            ),
            MAX_TOKENS_CONTINUE,
            "solution-chapter",
          )
          extra = stripOverlap(content, cont.trim())
        } catch {
          // R139：自动续写的偶发抖动不该作废已生成的正文（主调用已成功付费）——降级保留当前稿，整章不置 failed
          break
        }
        if (!extra) break
        content = `${content}\n\n${extra}`
      }
      if (wordBudget > 0) content = trimToBudget(content, Math.round(wordBudget * 1.3)).text
      return {
        content,
        figures: parsed.figures,
        underlength: wordBudget > 0 && content.length < wordBudget * CHAPTER_MIN_RATIO,
      }
    },
    [buildKbRefBlock],
  )

  const runGenerateChapter = useCallback(
    async (nodeId: string) => {
      const cur = activeSolutionRef.current
      if (!cur) return
      const idx = cur.chapters.findIndex((c) => c.node_id === nodeId)
      if (idx < 0) return
      setChapterBusy(nodeId)
      updateChapter(nodeId, { gen_status: "generating" }, { persist: false })
      try {
        const chNow = cur.chapters[idx]
        const { content, figures, underlength } = await generateChapterContent(cur, idx)
        // R139：模型空产出不得标 done（否则空章被批量按「已生成」永久跳过），与标书侧循环 8 A2 保底同口径
        // R280：失败原因随章落库（genError）——以前只在 toast 里一闪，刷新即丢，导致「11 章全 failed 查无原因」考古无门
        if (isBlankChapterOutput(content)) {
          updateChapter(nodeId, { gen_status: "failed", genError: BLANK_OUTPUT_REASON })
          toast.error("模型返回空正文，本章未标记完成，可重新生成")
          return
        }
        updateChapter(nodeId, { content, figures, underlength, gen_status: "done", genError: "" })
        if (activeChapterId === nodeId) {
          editingContentRef.current = content
          setEditingContentState(content)
        }
        await lastPersistRef.current
        const all = activeSolutionRef.current?.chapters ?? []
        if (all.length && all.every((c) => c.gen_status === "done")) {
          updateSolution({ doc_status: "done" as DocStatus })
        } else if (all.some((c) => c.gen_status === "done")) {
          updateSolution({ doc_status: "partial" as DocStatus })
        }
        toast.success(`「${chNow.title}」正文已生成（${content.length} 字${figures.length ? `，含 ${figures.length} 张配图` : ""}）`)
        if (underlength) toast.warning("本章成稿明显低于字数预算，可用「扩写」补充")
      } catch (e) {
        updateChapter(nodeId, { gen_status: "failed", genError: describeGenFailure(e, "正文生成失败，请重试") })
        toast.error(e instanceof Error ? e.message : "正文生成失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, updateChapter, updateSolution, generateChapterContent],
  )

  const generateChapter = useCallback(
    (nodeId: string) => {
      costConfirm.runWithCostConfirm(() => {
        void runGenerateChapter(nodeId)
      }, `将生成本章正文，${currentStudioCostText()}${skillCostSuffix("solution-chapter")}`)
    },
    [costConfirm, runGenerateChapter],
  )

  const runRefineChapter = useCallback(
    async (nodeId: string, kind: RefineKind, extraInstruction?: string) => {
      flushEditingContent()
      const cur = activeSolutionRef.current
      if (!cur) return
      const ch = cur.chapters.find((c) => c.node_id === nodeId)
      if (!ch || !ch.content.trim()) {
        toast.error("本章还没有正文，请先生成正文")
        return
      }
      setChapterBusy(nodeId)
      try {
        const text = await llmGenerate(
          buildRefineMessages(
            kind,
            {
              solution_name: cur.solution_name,
              solution_type: cur.solution_type,
              hospital: cur.hospital,
              hospital_info: cur.hospital_info,
            },
            ch.title,
            ch.content,
            extraInstruction,
            solComplianceModeRef.current,
          ),
          MAX_TOKENS_LONGFORM,
          "solution-rewrite",
        )
        updateChapter(nodeId, { content: text.trim() })
        if (activeChapterId === nodeId) {
          editingContentRef.current = text.trim()
          setEditingContentState(text.trim())
        }
        toast.success("章节处理完成")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "处理失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, flushEditingContent, updateChapter],
  )

  const refineChapter = useCallback(
    (nodeId: string, kind: RefineKind) => {
      costConfirm.runWithCostConfirm(() => {
        void runRefineChapter(nodeId, kind)
      }, `将调用 AI 处理本章正文，${currentStudioCostText()}${skillCostSuffix("solution-rewrite")}`)
    },
    [costConfirm, runRefineChapter],
  )

  // ------------------------------ 章节自检评分（轮次 E-4） ------------------------------

  const runChapterReview = useCallback(
    async (nodeId: string) => {
      flushEditingContent()
      const cur = activeSolutionRef.current
      if (!cur) return
      const ch = cur.chapters.find((c) => c.node_id === nodeId)
      if (!ch || !(ch.content ?? "").trim()) {
        toast.error("本章还没有正文，请先生成正文")
        return
      }
      setChapterBusy(nodeId)
      try {
        const info = cur.hospital_info
        const outlineContext = [
          `方案名称：${cur.solution_name}（${typeLabel(cur.solution_type)}）`,
          `客户医院：${cur.hospital || "未填"}`,
          info
            ? `医院等级：${info.hospital_level || "未填"}；床位规模：${info.bed_scale || "未填"}；建设系统清单：${(info.systems ?? []).join("、") || "未填"}；特殊要求：${info.special_requirements || "无"}`
            : "",
          `方案大纲：\n${outlineToText(cur.outline ?? [])}`,
        ]
          .filter(Boolean)
          .join("\n")
        const messages = buildChapterReviewMessages(ch.title, ch.content, outlineContext)
        let review: Omit<ChapterSelfCheck, "checked_at"> | null = null
        // JSON 解析失败重试一次（既有容错模式），仍失败报错不落数据
        for (let attempt = 0; attempt < 2 && !review; attempt++) {
          const text = await llmGenerate(messages, MAX_TOKENS_REVIEW)
          review = parseChapterReview(text)
        }
        if (!review) throw new Error("自检结果解析失败，请重试")
        const selfCheck: ChapterSelfCheck = { ...review, checked_at: new Date().toISOString() }
        updateChapter(nodeId, { selfCheck })
        toast.success(`自检完成：${selfCheck.total} 分 · ${VERDICT_LABEL[selfCheck.verdict]}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "自检失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [flushEditingContent, updateChapter],
  )

  const reviewChapter = useCallback(
    (nodeId: string) => {
      costConfirm.runWithCostConfirm(() => {
        void runChapterReview(nodeId)
      }, `将对本章正文做五维自检评分，${currentStudioCostText()}`)
    },
    [costConfirm, runChapterReview],
  )

  /** 评分卡「按建议优化」：把 issues 摘要拼入既有改写链路 */
  const optimizeByIssues = useCallback(
    (nodeId: string) => {
      const cur = activeSolutionRef.current
      const ch = cur?.chapters.find((c) => c.node_id === nodeId)
      if (!ch) return
      const issues = ch.selfCheck?.issues ?? []
      const extraInstruction = issues.length
        ? issues.map((i) => `- ${i.dim}：${i.problem}${i.suggestion ? `（建议：${i.suggestion}）` : ""}`).join("\n")
        : undefined
      costConfirm.runWithCostConfirm(() => {
        void runRefineChapter(nodeId, "rewrite", extraInstruction)
      }, `将按自检建议改写本章正文，${currentStudioCostText()}${skillCostSuffix("solution-rewrite")}`)
    },
    [costConfirm, runRefineChapter],
  )

  // ------------------------------ 整本批量自检（R276） ------------------------------

  const runBulkReview = useCallback(async () => {
    flushEditingContent()
    await lastPersistRef.current
    const cur = activeSolutionRef.current
    if (!cur) return
    const targets = cur.chapters.filter((c) => (c.content ?? "").trim())
    if (!targets.length) {
      toast.info("还没有已生成正文的章节，请先生成正文后再自检")
      return
    }
    cancelReviewRef.current = false
    setBulkReviewBusy(true)
    // 大纲 / 医院上下文对整本恒定，起跑前算一次复用，避免逐章重复拼接
    const info = cur.hospital_info
    const outlineContext = [
      `方案名称：${cur.solution_name}（${typeLabel(cur.solution_type)}）`,
      `客户医院：${cur.hospital || "未填"}`,
      info
        ? `医院等级：${info.hospital_level || "未填"}；床位规模：${info.bed_scale || "未填"}；建设系统清单：${(info.systems ?? []).join("、") || "未填"}；特殊要求：${info.special_requirements || "无"}`
        : "",
      `方案大纲：\n${outlineToText(cur.outline ?? [])}`,
    ]
      .filter(Boolean)
      .join("\n")
    const total = targets.length
    setReviewProgress({ current: 0, total })
    let okCount = 0
    let failCount = 0
    // 章间有限并发（2）复用 runBulkPool；各章 prompt 相互独立，updateChapter 按 node_id patch 互不覆盖
    await runBulkPool({
      total,
      concurrency: 2,
      isCancelled: () => cancelReviewRef.current,
      onTaskStart: (_i, processed) => setReviewProgress({ current: processed, total }),
      runTask: async (i) => {
        const rec = activeSolutionRef.current
        if (!rec) return
        const target = targets[i]
        const ch = rec.chapters.find((c) => c.node_id === target.node_id)
        if (!ch || !(ch.content ?? "").trim()) return
        let review: Omit<ChapterSelfCheck, "checked_at"> | null = null
        const messages = buildChapterReviewMessages(ch.title, ch.content, outlineContext)
        // JSON 解析失败重试一次（与单章自检同容错），仍失败计失败不落数据
        for (let attempt = 0; attempt < 2 && !review; attempt++) {
          const text = await llmGenerate(messages, MAX_TOKENS_REVIEW)
          review = parseChapterReview(text)
        }
        if (!review) {
          failCount += 1
          return
        }
        updateChapter(ch.node_id, { selfCheck: { ...review, checked_at: new Date().toISOString() } })
        okCount += 1
      },
    })
    await lastPersistRef.current
    setBulkReviewBusy(false)
    setReviewProgress({ current: 0, total: 0 })
    if (cancelReviewRef.current) toast.info("已暂停批量自检，可再次点击对全部成正文章节重新自检")
    else if (failCount) toast.error(`批量自检完成 ${okCount} 章，${failCount} 章解析失败，可对失败章单独重试`)
    else toast.success(`批量自检完成：${okCount} 章`)
  }, [flushEditingContent, updateChapter])

  const startBulkReview = useCallback(() => {
    const cur = activeSolutionRef.current
    if (!cur) return
    const pending = cur.chapters.filter((c) => (c.content ?? "").trim()).length
    if (!pending) {
      toast.info("还没有已生成正文的章节，请先生成正文后再自检")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void runBulkReview()
    }, `将对 ${pending} 个已生成正文的章节逐章做五维自检评分，${currentStudioCostText()}`)
  }, [costConfirm, runBulkReview])

  const cancelBulkReview = useCallback(() => {
    cancelReviewRef.current = true
  }, [])

  const selfCheckOverview = useMemo(
    () => buildSelfCheckOverview(activeSolution?.chapters ?? []),
    [activeSolution],
  )

  // ------------------------------ 素材弹药面板（轮次 E-1） ------------------------------

  const [materialTab, setMaterialTab] = useState<MaterialTab>("kb")
  const [materialQueryInput, setMaterialQueryInput] = useState("")
  const [materialQuery, setMaterialQuery] = useState("")
  const [materialKbDocs, setMaterialKbDocs] = useState<KbDocRow[]>([])
  const [materialQaPairs, setMaterialQaPairs] = useState<KbQaPairRow[]>([])
  const [materialLoading, setMaterialLoading] = useState(false)
  const materialLoadedRef = useRef(false)

  // 300ms 防抖：输入停稳后再触发检索
  useEffect(() => {
    const timer = window.setTimeout(() => setMaterialQuery(materialQueryInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [materialQueryInput])

  const loadMaterialSources = useCallback(async (force = false) => {
    if (materialLoadedRef.current && !force) return
    materialLoadedRef.current = true
    setMaterialLoading(true)
    try {
      // R303（与 R229 处置 QA 语料通道同构）：素材面板改走 kbAssemble 共享全量缓存，不再各拉各的
      // 全库。此前进入方案会同时跑起两条互不知情的全量下载（本面板 + 正文生成的检索语料），
      // 实机网络日志实测同一批 33 页 ×500 条语料被拉了两遍。共享缓存自带并发去重
      // （同一在飞 promise）、5 分钟 TTL 与经 onKbMutation 的变更失效。
      // getCachedVisibleDocs 已按 userId 过滤可见子集，下游 visibleKbDocs 再过滤一次为幂等，展示结果不变。
      if (force) invalidateKbCache() // 入库向导回填等「强制刷新」语义原样保留：显式失效后重取全量
      const [docs, pairs] = await Promise.all([getCachedVisibleDocs(userId), listKbQaPairs()])
      setMaterialKbDocs(docs)
      setMaterialQaPairs(pairs)
    } catch {
      materialLoadedRef.current = false
      toast.error("素材来源加载失败，请稍后重试")
    } finally {
      setMaterialLoading(false)
    }
  }, [userId])

  // 进入编辑工作台才拉取素材来源（列表视图不产生请求）
  useEffect(() => {
    if (mode === "editor") void loadMaterialSources()
  }, [mode, loadMaterialSources])

  const materialKbVisible = useMemo(() => visibleKbDocs(materialKbDocs, userId), [materialKbDocs, userId])

  const materialKbHits = useMemo<MaterialKbHit[]>(() => {
    if (!materialQuery) return []
    // 脱敏 / blocked 策略由 searchKbDocs + contextSnippetOf 自动生效，面板不重复实现
    return searchKbDocs(materialKbVisible, materialQuery, 8).map((h) => ({
      ...h,
      snippet: contextSnippetOf(h.doc, { snippet: h.snippet }),
    }))
  }, [materialKbVisible, materialQuery])

  const materialAmmoPairs = useMemo<KbQaPairRow[]>(() => {
    const approved = visibleQaPairs(materialQaPairs, userId).filter((r) => r.status === "approved")
    if (!materialQuery) return approved.slice(0, 30)
    const scored: { pair: KbQaPairRow; score: number }[] = []
    for (const pair of approved) {
      const matched = matchQaPair(materialQuery, [pair])
      if (matched) scored.push({ pair, score: matched.score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 20).map((s) => s.pair)
  }, [materialQaPairs, materialQuery, userId])

  // sol5 智能推荐：切到任意章节，按「章标题 + 小节名」对知识库 / 弹药库 / 历史方案本地打分推荐，
  // 与手动搜索共用同一套脱敏与可见性策略（searchKbDocs / visibleQaPairs），零 AI 调用零后端改动
  const chapterMaterialRecos = useMemo<MaterialRecoItem[]>(() => {
    const ch = activeChapter
    if (!ch || ch.part === "biz") return []
    const q = [ch.title, ...(ch.sections ?? [])].filter(Boolean).join(" ")
    if (!q.trim()) return []
    const out: MaterialRecoItem[] = []
    for (const h of searchKbDocs(materialKbVisible, q, 2)) {
      const snippet = contextSnippetOf(h.doc, { snippet: h.snippet })
      out.push({
        key: `kb:${h.doc.id}:${h.chunkStart ?? "doc"}`,
        source: "kb",
        title: h.doc.title,
        badge: h.headingPath || h.doc.folder_path || "知识库",
        snippet,
        text: snippet,
        label: `《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}`,
      })
    }
    const approved = visibleQaPairs(materialQaPairs, userId).filter((r) => r.status === "approved")
    const scoredAmmo: { pair: KbQaPairRow; score: number }[] = []
    for (const pair of approved) {
      const matched = matchQaPair(q, [pair])
      if (matched) scoredAmmo.push({ pair, score: matched.score })
    }
    scoredAmmo.sort((a, b) => b.score - a.score)
    for (const { pair } of scoredAmmo.slice(0, 2)) {
      out.push({
        key: `ammo:${pair.id}`,
        source: "ammo",
        title: pair.question,
        badge: pair.category || "标准问答",
        snippet: pair.answer,
        text: pair.answer,
        label: `弹药库 · ${pair.question}`,
      })
    }
    // 历史方案只取「其他方案」的成稿章节，避免推荐当前方案自己的本章
    const titleTokens = tokenizeText(ch.title ?? "").filter((t) => t.length >= 2)
    if (titleTokens.length) {
      const hist: { block: MaterialHistoryBlock; score: number }[] = []
      for (const sol of solutions) {
        if (sol.id === activeSolution?.id) continue
        for (const c of sol.chapters ?? []) {
          const text = (c.content ?? "").trim()
          if (!text) continue
          let hit = 0
          for (const tok of titleTokens) if ((c.title ?? "").includes(tok)) hit++
          if (hit > 0) {
            hist.push({
              block: {
                key: `${sol.id}:${c.node_id}`,
                solutionId: sol.id,
                solutionName: sol.solution_name,
                chapterTitle: c.title ?? "",
                text,
              },
              score: hit,
            })
          }
        }
      }
      hist.sort((a, b) => b.score - a.score)
      for (const { block } of hist.slice(0, 2)) {
        out.push({
          key: `history:${block.key}`,
          source: "history",
          title: `${block.solutionName} · ${block.chapterTitle}`,
          badge: "历史方案",
          snippet: block.text,
          text: block.text,
          label: `${block.solutionName} · ${block.chapterTitle}`,
        })
      }
    }
    return out.slice(0, 6)
  }, [activeChapter, materialKbVisible, materialQaPairs, userId, solutions, activeSolution?.id])

  const materialHistoryBlocks = useMemo<MaterialHistoryBlock[]>(() => {
    const blocks: MaterialHistoryBlock[] = []
    for (const sol of solutions) {
      for (const ch of sol.chapters ?? []) {
        const text = (ch.content ?? "").trim()
        if (!text) continue
        blocks.push({
          key: `${sol.id}:${ch.node_id}`,
          solutionId: sol.id,
          solutionName: sol.solution_name,
          chapterTitle: ch.title,
          text,
        })
      }
    }
    if (!materialQuery) return blocks.slice(0, 20)
    const tokens = tokenizeText(materialQuery).filter((t) => t.length >= 2)
    if (!tokens.length) return blocks.slice(0, 20)
    const filtered = blocks.filter((b) => {
      const hay = `${b.solutionName} ${b.chapterTitle} ${b.text}`.toLowerCase()
      return tokens.some((tok) => hay.includes(tok))
    })
    return filtered.slice(0, 20)
  }, [materialQuery, solutions])

  // 引用即复制：插入当前章节 textarea 光标处（无光标焦点则追加章末），绝不写源库
  const chapterTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // sol5 插入回执：编辑器绿色提示 + 撤销（仅当仍停留在插入时的章节才展示，无需 effect 清理）
  const [lastInsert, setLastInsert] = useState<{ nodeId: string; payload: string; label: string } | null>(null)

  const insertMaterialToChapter = useCallback(
    (text: string, sourceLabel: string) => {
      if (!activeChapterId) {
        toast.error("先在右侧选中章节")
        return
      }
      const payload = `> 素材来源：${sourceLabel}\n${text.trim()}`
      const cur = editingContentRef.current
      const ta = chapterTextareaRef.current
      let next: string
      if (ta && document.activeElement === ta && typeof ta.selectionStart === "number") {
        const startPos = ta.selectionStart
        const endPos = ta.selectionEnd ?? startPos
        next = cur.slice(0, startPos) + payload + cur.slice(endPos)
      } else {
        next = cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${payload}` : payload
      }
      setEditingContent(next)
      setLastInsert({ nodeId: activeChapterId, payload, label: sourceLabel })
      toast.success("已插入，记得改写融合")
    },
    [activeChapterId, setEditingContent],
  )

  // sol5 插入回执派生与撤销
  const insertNotice = lastInsert && lastInsert.nodeId === activeChapterId ? lastInsert : null

  const undoMaterialInsert = useCallback(() => {
    if (!lastInsert) return
    const cur = editingContentRef.current
    const idx = cur.indexOf(lastInsert.payload)
    if (idx >= 0) {
      setEditingContent(cur.slice(0, idx) + cur.slice(idx + lastInsert.payload.length))
      toast("已撤销插入")
    } else {
      toast.error("插入内容已被手动编辑，无法自动撤销")
    }
    setLastInsert(null)
  }, [lastInsert, setEditingContent])

  // sol5 待补充检测：章小节标题未在正文出现的项（本地字符串覆盖判定，零 AI），供编辑器橙色提醒条
  const missingChapterSections = useMemo<string[]>(() => {
    const ch = activeChapter
    if (!ch || ch.part === "biz") return []
    const sections = (ch.sections ?? []).filter(Boolean)
    if (!sections.length) return []
    const body = `${editingContent || ch.content || ""}`.replace(/\s+/g, "")
    if (!body) return [] // 尚未生成正文时不重复提醒（编辑器已有空态引导）
    return sections.filter((s) => {
      const key = s.replace(/^[0-9.、\s]+/, "").replace(/\s+/g, "")
      return key.length >= 2 && !body.includes(key)
    })
  }, [activeChapter, editingContent])

  // ------------------------------ 历史方案入素材库向导（轮次 E-2） ------------------------------

  const [kbWizardSolution, setKbWizardSolution] = useState<SolutionRecord | null>(null)

  const openSolutionToKb = useCallback((rec: SolutionRecord) => setKbWizardSolution(rec), [])
  const closeSolutionToKb = useCallback(() => setKbWizardSolution(null), [])

  /** 向导入库完成后刷新素材来源（知识库页签立即可检索到新块） */
  const handleKbWizardImported = useCallback(() => {
    void loadMaterialSources(true)
  }, [loadMaterialSources])

  // ------------------------------ 逐章批量生成 ------------------------------

  const runBulkGenerate = useCallback(async () => {
    const startRec = activeSolutionRef.current
    if (!startRec) return
    cancelBulkRef.current = false
    // 起跑前把挂起的编辑防抖落库并等它完成，再写 generating（避免并发 PATCH 丢字段，R001）
    flushEditingContent()
    await lastPersistRef.current
    setBulkGenerating(true)
    updateSolution({ doc_status: "generating" as DocStatus })
    const total = startRec.chapters.length
    setGenProgress({ current: 0, total })
    // 终态用计数器推算而非读 ref：中途离开编辑器（ref 被清空）时也能把阶段补写正确
    const initialDone = startRec.chapters.filter((c) => c.gen_status === "done").length
    let okCount = 0
    let failedCount = 0
    let firstError = ""
    // R139：登记失败/空产出章节（node_id/索引/标题/真实原因），供收口前自动补重试与逐章点名（标书侧 R126 同口径）
    const failedNodes: { nodeId: string; idx: number; title: string; reason: string }[] = []
    // 生成链路 D2 移植（标书侧 R126 同口径）：章间有限并发（2）的 worker 池。
    // 方案侧各章 prompt 相互独立——buildChapterMessages 仅注入恒定的大纲/事实基线与本章小节，
    // 不依赖前序章正文，故并发不损章间衔接质量；updateChapter 同步读 ref 最新快照、按 node_id
    // patch，不同章并发写互不覆盖；skip 扩为 done || generating 杜绝与手动单章同章双写；
    // 进度改用已派发计数（processed）保证并发下单调，收口后的失败补重试仍串行、语义不变。
    await runBulkPool({
      total,
      concurrency: 2,
      isCancelled: () => cancelBulkRef.current,
      onTaskStart: (_i, processed) => setGenProgress({ current: processed, total }),
      runTask: async (i) => {
        const cur = activeSolutionRef.current
        if (!cur) return
        const ch = cur.chapters[i]
        if (!ch || ch.gen_status === "done" || ch.gen_status === "generating") return
        updateChapter(ch.node_id, { gen_status: "generating" }, { persist: false })
        try {
          const { content, figures, underlength } = await generateChapterContent(cur, i)
          // R139：空产出一律不标 done（空章会被后续批量/补齐按「已生成」永久跳过）
          // R280：failed 落库带真实原因，收口 toast 一闪而过的原因从此可回溯
          if (isBlankChapterOutput(content)) {
            failedCount += 1
            updateChapter(ch.node_id, { gen_status: "failed", genError: BLANK_OUTPUT_REASON })
            failedNodes.push({ nodeId: ch.node_id, idx: i, title: ch.title, reason: BLANK_OUTPUT_REASON })
            return
          }
          updateChapter(ch.node_id, { content, figures, underlength, gen_status: "done", genError: "" })
          okCount += 1
          if (activeChapterId === ch.node_id) {
            editingContentRef.current = content
            setEditingContentState(content)
          }
        } catch (e) {
          failedCount += 1
          const msg = describeGenFailure(e, "生成异常")
          if (!firstError) firstError = msg
          updateChapter(ch.node_id, { gen_status: "failed", genError: msg })
          failedNodes.push({ nodeId: ch.node_id, idx: i, title: ch.title, reason: msg })
        }
      },
    })
    // R139（标书侧 R126 同口径）：偶发空返回/瞬时异常多数重试一次即可修复，收口前对失败章串行补跑一遍——
    // 成功即转 done 并扣减失败计数；仍失败落回 failed 并保留真实原因
    if (!cancelBulkRef.current && failedNodes.length) {
      const retryTargets = failedNodes.splice(0, failedNodes.length)
      for (const rt of retryTargets) {
        if (cancelBulkRef.current) break
        const ridx = startRec.chapters.findIndex((c) => c.node_id === rt.nodeId)
        if (ridx < 0) continue
        updateChapter(rt.nodeId, { gen_status: "generating" }, { persist: false })
        let retryReason: string
        try {
          const rout = await generateChapterContent(startRec, ridx)
          if (!isBlankChapterOutput(rout.content)) {
            updateChapter(rt.nodeId, {
              content: rout.content,
              figures: rout.figures,
              underlength: rout.underlength,
              gen_status: "done",
              genError: "",
            })
            okCount += 1
            failedCount = Math.max(0, failedCount - 1)
            if (activeChapterId === rt.nodeId) {
              editingContentRef.current = rout.content
              setEditingContentState(rout.content)
            }
            continue
          }
          retryReason = "重试后仍空产出"
          failedNodes.push({ ...rt, reason: retryReason })
        } catch (e) {
          retryReason = describeGenFailure(e, "重试异常")
          failedNodes.push({ ...rt, reason: retryReason })
        }
        updateChapter(rt.nodeId, { gen_status: "failed", genError: retryReason })
      }
    }
    const doneTotal = initialDone + okCount
    const nextStatus: DocStatus = total > 0 && doneTotal >= total ? "done" : doneTotal > 0 ? "partial" : "outline"
    // 等最后一笔章节 PATCH 落库后再写阶段，防止并发整行覆写把 doc_status 冲掉（R001 实测卡死「生成中」的根因）
    await lastPersistRef.current
    if (activeSolutionRef.current?.id === startRec.id) {
      updateSolution({ doc_status: nextStatus })
    } else {
      try {
        await apiFetch(`/api/solutions/${encodeURIComponent(startRec.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ doc_status: nextStatus }),
        })
      } catch {
        toast.error("方案阶段状态同步失败，可重新打开该方案后重试")
      }
    }
    setBulkGenerating(false)
    setGenProgress({ current: 0, total: 0 })
    if (cancelBulkRef.current) toast.info("已暂停，可继续生成剩余章节")
    else if (failedCount)
      toast.error(
        `生成结束，${failedCount} 个章节仍失败：${failedNodes.length ? formatFailedChapterList(failedNodes) : firstError.slice(0, 80) || "原因未知"}；可到章节列表对失败章节单独重试`,
      )
    else toast.success("全部章节正文生成完毕")
  }, [activeChapterId, flushEditingContent, updateChapter, updateSolution, generateChapterContent])

  const startBulkGenerate = useCallback(() => {
    const cur = activeSolutionRef.current
    if (!cur) return
    const pending = cur.chapters.filter((c) => c.gen_status !== "done").length
    if (!pending) {
      toast.info("全部章节已生成完毕")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void runBulkGenerate()
    }, `将逐章生成 ${pending} 个章节正文，${currentStudioCostText()}${skillCostSuffix("solution-chapter")}`)
  }, [costConfirm, runBulkGenerate])

  const cancelBulkGenerate = useCallback(() => {
    cancelBulkRef.current = true
  }, [])

  // ------------------------------ 导出 Word ------------------------------

  const [exportingWord, setExportingWord] = useState(false)

  const exportWord = useCallback(async () => {
    flushEditingContent()
    const sol = activeSolutionRef.current
    if (!sol) return
    if (!sol.chapters.some((c) => c.content.trim())) {
      toast.error("还没有任何正文内容，无法导出")
      return
    }
    // R011（D-12 方案 A）：空章节不阻断导出，但显式警告（正式交付物质量提示）
    const emptyChapters = sol.chapters.filter((c) => !c.content.trim()).length
    if (emptyChapters > 0) {
      toast.warning(`有 ${emptyChapters} 章正文为空，将导出为空章节；正式交付前请补齐或删除这些章节`)
    }
    if (exportingWord) return
    setExportingWord(true)
    try {
      // R147：导出工具链按需加载——docx 与 bidFiles（连带 pdf worker/mermaid 重依赖）在点击时才动态导入
      const { AlignmentType, HeadingLevel, ImageRun, Paragraph } = await import("docx")
      const { createFormatDocxKit, downloadDocx, figureToPng, pageOptsFromFormatSettings } = await import(
        "@/pages/BidWorkspace/bidFiles"
      )
      // 问题 3：导出全格式驱动（字体/字号/首行缩进/行距/标题/表格/配图），与投标文件导出共用 createFormatDocxKit 同一套映射
      const { fontRun, headingAt, headingPara, bodyPara, splitTableRow, buildFmtTable } = createFormatDocxKit(ssFmt)
      // R007（B-4 阶段一）：前置封面 + 目录（按模板开关），正文追加其后
      const children: (Paragraph | Table | TableOfContents)[] = [...(await buildExportFrontMatter(sol, expTpl))]
      const h0 = headingAt(0)
      children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [fontRun(sol.solution_name, { font: h0.font, size: h0.size, bold: true })],
        }),
      )
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [
            fontRun(`${sol.hospital} · ${typeLabel(sol.solution_type)}`, { font: ssFmt.body.font, size: ssFmt.body.size }),
          ],
        }),
      )
      const chapterPrefix = (idx: number) =>
        ssFmt.titleNumbering === "none" ? "" : ssFmt.titleNumbering === "chapter" ? `第${idx + 1}章 ` : `${idx + 1} `
      for (const [idx, ch] of sol.chapters.entries()) {
        children.push(headingPara(0, `${chapterPrefix(idx)}${ch.title}`, { before: 320, after: 200 }))
        const paras: (Paragraph | Table)[] = []
        let firstBodyAt = -1
        const cleanContent = sanitizeChapterText(ch.content || "")
        const contentLines = cleanContent
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
        let li = 0
        while (li < contentLines.length) {
          const line = contentLines[li]
          // 连续 ≥2 行全角空格分列视为表格块，转真正的 docx 表格（边框/单元格字体随格式设置）
          const headCols = splitTableRow(line)
          if (headCols) {
            const block: string[][] = [headCols]
            let lj = li + 1
            while (lj < contentLines.length) {
              const nextCols = splitTableRow(contentLines[lj])
              if (!nextCols) break
              block.push(nextCols)
              lj++
            }
            if (block.length >= 2) {
              if (firstBodyAt === -1) firstBodyAt = paras.length
              paras.push(buildFmtTable(block))
              li = lj
              continue
            }
          }
          const isSubHeading =
            (ch.sections ?? []).some((s) => line.startsWith(s)) || /^\d+[.、]\s*\S/.test(line) || /^\d+\.\d+/.test(line)
          const isH3 = /^（[一二三四五六七八九十]+）/.test(line)
          if (!isSubHeading && !isH3 && firstBodyAt === -1) firstBodyAt = paras.length
          paras.push(isSubHeading ? headingPara(1, line) : isH3 ? headingPara(2, line) : bodyPara(line))
          li++
        }
        // 问题 2：章节配图 SVG→PNG 插入正文首段后；单张转换失败降级「【图】标题」文字行
        const figs = ch.figures ?? []
        if (figs.length) {
          const figParas: Paragraph[] = []
          for (const spec of figs) {
            const png = await figureToPng(spec)
            const figCaption = (spec.caption ?? "").trim()
            if (png) {
              const drawW = 460
              const drawH = Math.max(40, Math.round((drawW * png.height) / png.width))
              figParas.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 160, after: 60 },
                  children: [new ImageRun({ type: "png", data: png.data, transformation: { width: drawW, height: drawH } })],
                }),
              )
            } else {
              figParas.push(bodyPara(`【图】${spec.title}`))
            }
            figParas.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: figCaption ? 40 : 160 },
                children: [fontRun(spec.title, { font: ssFmt.body.font, size: ssFmt.body.size, italics: true })],
              }),
            )
            if (figCaption) {
              figParas.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 160 },
                  children: [fontRun(figCaption, { font: ssFmt.body.font, size: ssFmt.body.size })],
                }),
              )
            }
          }
          const insertAt = firstBodyAt === -1 ? paras.length : firstBodyAt + 1
          paras.splice(insertAt, 0, ...figParas)
        }
        children.push(...paras)
      }
      // 循环 9 C2：页面级格式（纸张/边距/页码）按方案 localStorage 设置生效
      // R007（B-4 阶段一）：页眉文字与目录自动更新域按导出模板生效
      const pageOpts = pageOptsFromFormatSettings(ssFmt, { pageNumber: ssFmt.pageNumber })
      await downloadDocx(
        `${sol.solution_name}.docx`,
        children,
        {
          ...pageOpts,
          headerText: expTpl.headerText || undefined,
          updateFields: expTpl.toc || undefined,
        },
      )
      toast.success("Word 文档已导出：封面/目录/页眉按导出模板，字体/字号/行距/缩进/标题/配图按格式模板生效")
    } catch {
      toast.error("导出失败，请稍后重试")
    } finally {
      setExportingWord(false)
    }
  }, [exportingWord, expTpl, flushEditingContent, ssFmt])

  // ------------------------------ 派生数据 ------------------------------

  const doneChapterCount = useMemo(
    () => activeSolution?.chapters.filter((c) => c.gen_status === "done").length ?? 0,
    [activeSolution],
  )
  const docStatusLabel = activeSolution ? (DOC_STATUS_LABEL[activeSolution.doc_status] ?? activeSolution.doc_status) : ""

  return {
    // 登录
    userId,
    handleAccountChange,
    // 视图页签（建设清单 / 方案编制）
    studioView,
    setStudioView,
    // 建设清单
    checklist,
    formChecklistId,
    setFormChecklistId,
    handlePickChecklist,
    startSolutionFromChecklist,
    // 列表
    solutions: filteredSolutions,
    solutionStats,
    listLoading,
    searchKeyword,
    setSearchKeyword,
    openNewWizard,
    openReuseWizard,
    openSolution,
    deleteSolution,
    // 视图
    mode,
    backToList,
    // 向导
    wizardOpen,
    wizardStep,
    setWizardStep,
    closeWizard,
    solutionTypes: SOLUTION_TYPES,
    formTypeKey,
    setFormTypeKey,
    formSolutionName,
    setFormSolutionName,
    formHospital,
    setFormHospital,
    formOpportunityId,
    setFormOpportunityId,
    wizardOppOptions: sortedWizardOppOptions,
    formInfo,
    setFormInfo,
    outlineDraft,
    outlineLoading,
    confirming,
    submitWizardInfo,
    assembleOutlineFromChecklist,
    confirmOutline,
    outlineRename,
    outlineRemove,
    outlineAddChild,
    outlineAddRoot,
    outlineMove,
    // 编辑器
    activeSolution,
    activeChapter,
    activeChapterId,
    selectChapter,
    editingContent,
    setEditingContent,
    autoSaveState,
    chapterBusy,
    generateChapter,
    refineChapter,
    // 章节自检（轮次 E-4）
    reviewChapter,
    optimizeByIssues,
    // R276 整本五维自检总览 + 一键批量自检
    selfCheckOverview,
    bulkReviewBusy,
    reviewProgress,
    startBulkReview,
    cancelBulkReview,
    // 素材弹药面板（轮次 E-1）
    materialTab,
    setMaterialTab,
    materialQueryInput,
    setMaterialQueryInput,
    materialQuery,
    materialKbHits,
    materialAmmoPairs,
    materialHistoryBlocks,
    materialLoading,
    insertMaterialToChapter,
    chapterTextareaRef,
    // sol5 智能推荐 / 插入回执 / 待补充小节提醒
    chapterMaterialRecos,
    insertNotice,
    undoMaterialInsert,
    missingChapterSections,
    // 历史方案入素材库（轮次 E-2）
    kbWizardSolution,
    openSolutionToKb,
    closeSolutionToKb,
    handleKbWizardImported,
    bulkGenerating,
    genProgress,
    startBulkGenerate,
    cancelBulkGenerate,
    doneChapterCount,
    docStatusLabel,
    exportWord,
    exportingWord,
    // 循环 9 C2：方案导出格式（完整 FormatSettings：页面/正文/标题/表格/目录，按方案存 localStorage）
    ssFmt,
    setSsFmtPatch,
    // 问题1+2：生成设置（目标页数/配图开关，按方案存 localStorage）
    solGen,
    setSolGenPatch,
    // 05 §6：方案侧三模式（按方案存 localStorage）
    solComplianceMode,
    setSolComplianceMode,
    // R007（B-4 阶段一）：方案导出模板（封面/目录/页眉，按方案存 localStorage）
    expTpl,
    setExpTplPatch,
    // 计费确认
    costConfirm,
    // 模型选择（统一网关）
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    // 全站技能带入（方案侧）
    outlineSkills,
    chapterSkills,
    rewriteSkills,
  }
}

export type UseSolutionStudio = ReturnType<typeof useSolutionStudio>
