import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { AlignmentType, HeadingLevel, Paragraph, TextRun } from "docx"
import { getPocketBaseUrl } from "@/lib/pb"
import { decodeRhToken, vibexAuthHeaders, type RhAccountInfo } from "@/lib/rhLogin"
import { modelRefKey, resolveAvailableModels, type ModelRef } from "@/lib/modelGateway"
import {
  listKbDocs,
  searchKbDocs,
  tokenizeText,
  visibleKbDocs,
  type KbDocRow,
  type KbSearchHit,
} from "@/lib/kbCore"
import { contextSnippetOf } from "@/lib/kbPolicy"
import { listKbQaPairs, matchQaPair, visibleQaPairs, type KbQaPairRow } from "@/lib/kbQa"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { downloadDocx, pageOptsFromFormatSettings } from "@/pages/BidWorkspace/bidFiles"
import { DEFAULT_FORMAT_SETTINGS, normalizeFormatSettings, type FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { skillCostSuffix } from "@/lib/skillCore"
import { currentStudioCostText, llmGenerate, setStudioModelRef } from "./studioLlm"
import { useChecklist } from "./checklistLogic"
import { snapshotFromChecklist, type ChecklistRecord } from "./checklistTypes"
import {
  addChildToTree,
  buildChapterMessages,
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
  typeLabel,
  VERDICT_LABEL,
  type Chapter,
  type ChapterSelfCheck,
  type DocStatus,
  type HospitalInfo,
  type OutlineNode,
  type RefineKind,
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
      const data = await apiFetch<ListResponse<SolutionRecord>>(
        // B6：perPage 提到 200，避免服务端缺省 50 静默截断方案列表
        `/api/solutions?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`,
      )
      setSolutions(data.items ?? [])
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

  const applySolutionState = useCallback((next: SolutionRecord | null) => {
    activeSolutionRef.current = next
    setActiveSolution(next)
    if (next) {
      setSolutions((prev) => prev.map((s) => (s.id === next.id ? next : s)))
      setSsFmt(readSsFmt(next.id))
    }
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

  const persistSolution = useCallback(
    async (rec: SolutionRecord, patch: Partial<SolutionRecord>, quiet = false) => {
      try {
        await apiFetch(`/api/solutions/${rec.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      } catch {
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
  }, [])

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
    const systems = Array.from(
      new Set((rec.items ?? []).filter((l) => l.checked !== false).map((l) => l.product_name)),
    )
    setFormInfo((prev) => ({ ...prev, systems: Array.from(new Set([...prev.systems, ...systems])) }))
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
    if (!outlineDraft.length) {
      toast.error("大纲为空，请先生成或添加章节")
      return
    }
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
    }
  }, [applySolutionState, checklist.myChecklists, formChecklistId, formHospital, formInfo, formOpportunityId, formSolutionName, formTypeKey, outlineDraft, userId])

  // ------------------------------ 编辑工作台 ------------------------------
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [editingContent, setEditingContentState] = useState("")
  const editingContentRef = useRef("")
  const saveTimerRef = useRef<number | null>(null)
  // 最近一次「本地→远端」持久化的 Promise（persistSolution 内部自捕获，永不 reject）。
  // 写 doc_status 前先 await 它：后端 PATCH 是「读整行→改→存整行」，两笔并发会互相覆盖丢字段（R001 竞态根因）。
  const lastPersistRef = useRef<Promise<void> | null>(null)
  const [chapterBusy, setChapterBusy] = useState<string | null>(null)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 })
  const cancelBulkRef = useRef(false)

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

  const setEditingContent = useCallback(
    (value: string) => {
      setEditingContentState(value)
      editingContentRef.current = value
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
      applySolutionState(target)
      setActiveChapterId(target.chapters[0]?.node_id ?? null)
      const content = target.chapters[0]?.content ?? ""
      editingContentRef.current = content
      setEditingContentState(content)
      setMode("editor")
    },
    [applySolutionState, persistSolution],
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
        setSolutions((prev) => prev.filter((s) => s.id !== rec.id))
        toast.success("方案已删除")
      } catch {
        toast.error("删除失败，请稍后重试")
      }
    },
    [],
  )

  // ------------------------------ 章节 AI 操作 ------------------------------

  const runGenerateChapter = useCallback(
    async (nodeId: string) => {
      const cur = activeSolutionRef.current
      if (!cur) return
      const idx = cur.chapters.findIndex((c) => c.node_id === nodeId)
      if (idx < 0) return
      setChapterBusy(nodeId)
      updateChapter(nodeId, { gen_status: "generating" }, { persist: false })
      try {
        const text = await llmGenerate(
          buildChapterMessages(
            {
              solution_name: cur.solution_name,
              solution_type: cur.solution_type,
              hospital: cur.hospital,
              hospital_info: cur.hospital_info,
              outline: cur.outline,
            },
            activeSolutionRef.current?.chapters ?? cur.chapters,
            idx,
          ),
          MAX_TOKENS_LONGFORM,
          "solution-chapter",
        )
        updateChapter(nodeId, { content: text.trim(), gen_status: "done" })
        if (activeChapterId === nodeId) {
          editingContentRef.current = text.trim()
          setEditingContentState(text.trim())
        }
        await lastPersistRef.current
        const all = activeSolutionRef.current?.chapters ?? []
        if (all.length && all.every((c) => c.gen_status === "done")) {
          updateSolution({ doc_status: "done" as DocStatus })
        } else if (all.some((c) => c.gen_status === "done")) {
          updateSolution({ doc_status: "partial" as DocStatus })
        }
        toast.success(`「${cur.chapters[idx].title}」正文已生成`)
      } catch (e) {
        updateChapter(nodeId, { gen_status: "failed" })
        toast.error(e instanceof Error ? e.message : "正文生成失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, updateChapter, updateSolution],
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
      const [docs, pairs] = await Promise.all([listKbDocs(), listKbQaPairs()])
      setMaterialKbDocs(docs)
      setMaterialQaPairs(pairs)
    } catch {
      materialLoadedRef.current = false
      toast.error("素材来源加载失败，请稍后重试")
    } finally {
      setMaterialLoading(false)
    }
  }, [])

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
      toast.success("已插入，记得改写融合")
    },
    [activeChapterId, setEditingContent],
  )

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
    for (let i = 0; i < total; i++) {
      if (cancelBulkRef.current) break
      const cur = activeSolutionRef.current
      if (!cur) break
      const ch = cur.chapters[i]
      if (!ch || ch.gen_status === "done") {
        setGenProgress({ current: i + 1, total })
        continue
      }
      setGenProgress({ current: i + 1, total })
      updateChapter(ch.node_id, { gen_status: "generating" }, { persist: false })
      try {
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
            i,
          ),
          MAX_TOKENS_LONGFORM,
          "solution-chapter",
        )
        updateChapter(ch.node_id, { content: text.trim(), gen_status: "done" })
        okCount += 1
        if (activeChapterId === ch.node_id) {
          editingContentRef.current = text.trim()
          setEditingContentState(text.trim())
        }
      } catch {
        failedCount += 1
        updateChapter(ch.node_id, { gen_status: "failed" })
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
    else if (failedCount) toast.error(`生成结束，${failedCount} 个章节失败，可单独重试`)
    else toast.success("全部章节正文生成完毕")
  }, [activeChapterId, flushEditingContent, updateChapter, updateSolution])

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
    if (exportingWord) return
    setExportingWord(true)
    try {
      const children: Paragraph[] = []
      children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: sol.solution_name, bold: true, size: 44 })],
        }),
      )
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [new TextRun({ text: `${sol.hospital} · ${typeLabel(sol.solution_type)}`, size: 24 })],
        }),
      )
      sol.chapters.forEach((ch, idx) => {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 320, after: 200 },
            children: [new TextRun({ text: `第${idx + 1}章 ${ch.title}`, bold: true, size: 32 })],
          }),
        )
        const lines = (ch.content || "").split("\n")
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue
          const isSubHeading =
            ch.sections.some((s) => line.startsWith(s)) || /^\d+[.、]\s*\S/.test(line) || /^\d+\.\d+/.test(line)
          children.push(
            new Paragraph({
              heading: isSubHeading ? HeadingLevel.HEADING_2 : undefined,
              spacing: { after: 120 },
              children: [new TextRun({ text: line, bold: isSubHeading, size: isSubHeading ? 26 : 24 })],
            }),
          )
        }
      })
      // 循环 9 C2：页面级格式（纸张/边距/页码）按方案 localStorage 设置生效；正文样式保持现状
      await downloadDocx(
        `${sol.solution_name}.docx`,
        children,
        pageOptsFromFormatSettings(ssFmt, { pageNumber: ssFmt.pageNumber }),
      )
      toast.success("Word 文档已导出，纸张与页边距按本页格式设置生效")
    } catch {
      toast.error("导出失败，请稍后重试")
    } finally {
      setExportingWord(false)
    }
  }, [exportingWord, flushEditingContent, ssFmt])

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
    submitWizardInfo,
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
    chapterBusy,
    generateChapter,
    refineChapter,
    // 章节自检（轮次 E-4）
    reviewChapter,
    optimizeByIssues,
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
    // 循环 9 C2：方案导出页面格式（按方案存 localStorage）
    ssFmt,
    setSsFmtPatch,
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
