// 知识库 Logic 层：文档 CRUD、目录树、上传解析入库、本地检索问答（费用确认）。
// View（KnowledgePage 与 src/components/knowledge/*）只消费本 hook 返回的 props。

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "@/lib/useDebounce"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  resolveAvailableModels,
  type ModelRef,
} from "@/lib/modelGateway"
import type { LlmMessage } from "@/lib/llm"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { injectSkillBlock, skillBlockFor } from "@/lib/skillCore"
import { mapAssistantLlmError } from "@/lib/assistantCore"
import { ShellAccountContext } from "@/components/shell/WorkbenchShell"
import {
  createKbDoc,
  deleteKbDoc,
  extractKbIndex,
  KB_QA_SYSTEM_PROMPT,
  KB_LIST_MAX_PAGES,
  KB_LIST_PER_PAGE,
  getKbDoc,
  listKbDocs,
  searchKbDocs,
  updateKbDoc,
  visibleKbDocs,
  type KbDocRow,
} from "@/lib/kbCore"
import { categoryOf, contextSnippetOf, guessCategoryFromFileName, classifyKbDoc, KB_CATEGORY_POLICY } from "@/lib/kbPolicy"
import { KB_CACHE_TTL_MS, loadKbCache, saveKbCache } from "@/lib/kbDocCache"
import {
  createKbQaPair,
  deleteKbQaPair,
  listKbQaPairs,
  matchQaPair,
  qaGapDedupeKey,
  updateKbQaPair,
  visibleQaPairs,
  type KbQaPairRow,
} from "@/lib/kbQa"
import { parseUploadFile } from "./kbUpload"
import { pickAndWalkFolder, joinImportFolder, supportsFolderImport } from "./kbImport"
import { pushKbTrash, readKbTrash, removeKbTrash, type KbTrashItem } from "./kbTrash"

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type LibTab = "team" | "personal"
export type QaScope = "all" | "team" | "personal"
export type DocSortKey = "updated" | "created" | "title"

export interface FolderNode {
  path: string
  label: string
  children: FolderNode[]
  count: number
}

export interface UploadRowResult {
  fileName: string
  done: boolean
  okCount: number
  failReason?: string
}

export interface QaCitation {
  docId: string
  title: string
  snippet: string
  visibility: string
  /** 轮次 D-2：命中块在文档正文中的字符偏移（跳转定位用） */
  chunkStart?: number
}

export interface QaChatMsg {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: QaCitation[]
  /** 轮次 D-3：high = 弹药库直答（零费用）；medium = 回答采用标准答案口径 */
  qaLevel?: "high" | "medium"
  /** high 直答消息附带的原始问题，供「仍要问 AI」复用 */
  qaFollowQuestion?: string
}

/** 轮次 D-2：引用跳转后的近似定位（按块偏移比例滚动 + 片段高亮） */
export interface CitationFocus {
  docId: string
  ratio: number
  snippet: string
}

export type FolderDialogState = { mode: "create" | "rename"; parentPath: string; initialName: string } | null
export type DocActionState = { mode: "rename" | "move" | "delete"; doc: KbDocRow } | null

let localSeq = 0
function localId(prefix: string): string {
  localSeq += 1
  return `${prefix}_${Date.now()}_${localSeq}`
}

// 轮次 4 B2：qa 会话 sessionStorage 持久化（按登录用户为 key，上限 50 条，失败静默降级）
const QA_SESSION_PREFIX = "kb_qa_session_"
const QA_SESSION_LIMIT = 50

function sanitizeQaMessages(raw: unknown): QaChatMsg[] {
  if (!Array.isArray(raw)) return []
  const out: QaChatMsg[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Partial<QaChatMsg>
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content) continue
    out.push({
      id: typeof m.id === "string" && m.id ? m.id : localId("qa_restored"),
      role: m.role,
      content: m.content,
      citations: Array.isArray(m.citations) ? (m.citations as QaCitation[]) : undefined,
      qaLevel: m.qaLevel === "high" || m.qaLevel === "medium" ? m.qaLevel : undefined,
      qaFollowQuestion: typeof m.qaFollowQuestion === "string" ? m.qaFollowQuestion : undefined,
    })
  }
  return out.slice(-QA_SESSION_LIMIT)
}

function splitFolderPath(path: string): string[] {
  return (path ?? "").split("/").map((s) => s.trim()).filter(Boolean)
}

function baseNameOf(path: string): string {
  const segs = splitFolderPath(path)
  return segs.length ? segs[segs.length - 1] : ""
}

/** perf-01：按账号隔离的「最近阅读」文档 id 列表（localStorage 持久化，上限 8） */
function kbRecentKey(uid: string | null): string {
  return uid ? `kb_recent_docs_${uid}` : ""
}

function readRecentIds(uid: string | null): string[] {
  try {
    const key = kbRecentKey(uid)
    if (!key) return []
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 8) : []
  } catch {
    return []
  }
}

export function useKnowledge() {
  const costConfirm = useCostConfirm()
  const shellAccount = useContext(ShellAccountContext)

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [needsRhLogin, setNeedsRhLogin] = useState(false)
  // perf-01：最近阅读 id 列表（selectDoc 时记录，右栏空态引导用；声明提前供切账号回调重读，持久化见下方 effect）
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentIds(decodeRhToken()?.sub ?? null))
  // 轮次 F：知识库问答技能 scope 接入（选择器源暴露给 QaDrawer）
  const kbQaSkills = useScopeSkills("kb-qa", userId ?? undefined)
  const userIdRef = useRef<string | null>(userId)
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const uploaderName = useMemo(() => {
    if (shellAccount?.displayName) return shellAccount.displayName
    const uid = userId ?? ""
    return uid ? `用户${uid.slice(0, 6)}` : "我"
  }, [shellAccount, userId])
  const uploaderNameRef = useRef(uploaderName)
  useEffect(() => {
    uploaderNameRef.current = uploaderName
  }, [uploaderName])

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
    // perf-01：切账号时同步重读本账号的最近阅读，避免沿用上一账号的列表
    setRecentIds(readRecentIds(uid))
    if (uid) setNeedsRhLogin(false)
  }, [])

  const requireLogin = useCallback(() => {
    if (userIdRef.current) return true
    setNeedsRhLogin(true)
    toast.error("当前无法使用知识库，请稍后重试")
    return false
  }, [])

  // ------------------------------ 模型 ------------------------------
  const [models, setModels] = useState<ModelRef[]>([])
  const [activeModelKey, setActiveModelKey] = useState("")
  const activeModelRefRef = useRef<ModelRef | null>(null)
  useEffect(() => {
    let cancelled = false
    void resolveAvailableModels().then((av) => {
      if (cancelled) return
      setModels(av.models)
      const def = av.defaultRef
      setActiveModelKey(def ? modelRefKey(def) : "")
      activeModelRefRef.current = def
    })
    return () => {
      cancelled = true
    }
  }, [])
  const activeModelRef = useMemo(
    () => models.find((m) => modelRefKey(m) === activeModelKey) ?? null,
    [models, activeModelKey],
  )
  useEffect(() => {
    activeModelRefRef.current = activeModelRef
  }, [activeModelRef])
  const costText = useMemo(() => costTextForModel(activeModelRef), [activeModelRef])
  const onModelChange = useCallback((key: string) => setActiveModelKey(key), [])

  // ------------------------------ 文档数据 ------------------------------
  const [docs, setDocs] = useState<KbDocRow[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const docsRef = useRef<KbDocRow[]>([])
  useEffect(() => {
    docsRef.current = docs
  }, [docs])

  /** R80/B-01：按需补拉单篇正文并回填 docs（列表瘦身后的正文保真通道） */
  const loadDocContent = useCallback(async (docId: string): Promise<string> => {
    const cached = docsRef.current.find((d) => d.id === docId)
    if (cached && (cached.content ?? "").length > 0) return cached.content
    try {
      const full = await getKbDoc(docId)
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, content: full.content } : d)))
      docsRef.current = docsRef.current.map((d) => (d.id === docId ? { ...d, content: full.content } : d))
      return full.content
    } catch {
      return cached?.content ?? ""
    }
  }, [])

  // R87：QA 全文检索语料通道——列表是 slim 形态（content 空串），searchKbDocs 的正文通道需要全文。
  // 首次提问时懒加载一次全量 listKbDocs()（不带 slim），会话内复用；
  // refreshDocs（一切数据变更入口）失效并重取。与助手/方案工坊/竞品证据同用全量通道，行为对齐。
  const qaCorpusRef = useRef<KbDocRow[] | null>(null)
  const qaCorpusPromiseRef = useRef<Promise<void> | null>(null)
  const [qaIndexing, setQaIndexing] = useState(false)
  const ensureQaCorpus = useCallback(async (): Promise<void> => {
    if (qaCorpusRef.current) return
    if (!qaCorpusPromiseRef.current) {
      setQaIndexing(true)
      qaCorpusPromiseRef.current = listKbDocs()
        .then((rows) => {
          qaCorpusRef.current = rows
        })
        .catch(() => {
          /* 失败不缓存：本轮退回列表元数据通道，下一次提问自动重试 */
        })
        .finally(() => {
          qaCorpusPromiseRef.current = null
          setQaIndexing(false)
        })
    }
    await qaCorpusPromiseRef.current
  }, [])

  // T9 渐进直显：冷加载时首批数据到达即结束 loading 开始渲染，其余后台补齐（列表头部有同步提示）
  const [docsCalibrating, setDocsCalibrating] = useState(false)

  const refreshDocs = useCallback(async () => {
    // R87：数据变更（增删改/上传/移动）后失效 QA 全文语料，下一次提问重取，防旧正文滞留检索层
    qaCorpusRef.current = null
    try {
      // R80/B-01 性能：列表走 slim=1（服务端把 content 置空，传输量降 ~90%），正文按需单条补拉
      //（loadDocContent → /api/kb_docs/{id} 全量）。消费点保真：阅读/编辑/删除回收桶共用该通道。
      // T9：渐进更新前把已按需拉过的正文回写进新列表，避免正在读的文档内容被打回空串
      const mergeLoadedContent = (rows: KbDocRow[]) => {
        const loaded = docsRef.current.filter((d) => (d.content ?? "").length > 0)
        if (loaded.length === 0) return rows
        const map = new Map(loaded.map((d) => [d.id, d.content]))
        return rows.map((r) => (map.has(r.id) ? { ...r, content: map.get(r.id) ?? r.content ?? "" } : r))
      }
      let shownFirst = false
      const rows = await listKbDocs({
        slim: true,
        onBatch: (partial) => {
          // 仅冷启动（屏幕上还没有任何数据）时渐进直显；有缓存直显时不收缩列表，等全量一次替换
          if (shownFirst || partial.length === 0 || docsRef.current.length > 0) return
          shownFirst = true
          setDocs(partial)
          setDocsLoading(false)
          setDocsCalibrating(true)
        },
      })
      setDocsCalibrating(false)
      setDocs(mergeLoadedContent(rows))
      setDocsLoading(false)
      // kb-cap-01：命中翻页安全上限说明仍有文档未返回。旧实现只 console.warn＝对用户静默丢数据，
      // 现改为显式告知（否则「资料明明传上去了却搜不到」会被误判成没上传成功）。
      if (rows.length >= KB_LIST_MAX_PAGES * KB_LIST_PER_PAGE) {
        toast.warning(
          `知识库已达加载上限 ${rows.length} 篇，仍有文档未显示，请联系管理员扩容`,
        )
      }
      // 性能第一批：全量成功后回写本地缓存（仅当前用户可见子集，避免落他人个人笔记）。
      void saveKbCache(userIdRef.current, visibleKbDocs(rows, userIdRef.current))
    } catch {
      setDocsLoading(false)
      setDocsCalibrating(false)
      toast.error("知识库文档加载失败，请稍后重试")
    }
  }, [])

  // 性能第一批：挂载时缓存优先直显，TTL 内跳过网络；超期或无缓存才后台全量校准。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snap = await loadKbCache(userIdRef.current)
      if (cancelled) return
      if (snap) {
        setDocs(snap.docs)
        setDocsLoading(false)
        if (Date.now() - snap.syncedAt < KB_CACHE_TTL_MS) return
      }
      await refreshDocs()
    })()
    return () => {
      cancelled = true
    }
  }, [refreshDocs])

  // ------------------------------ 视图状态 ------------------------------
  const [libTab, setLibTab] = useState<LibTab>("team")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedQuery = useDebounce(searchQuery, 150)
  const [activeFolderPath, setActiveFolderPath] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<DocSortKey>("updated")
  const [editMode, setEditMode] = useState(false)
  const [editDraft, setEditDraft] = useState("")
  const [savingDoc, setSavingDoc] = useState(false)
  const [extraFolders, setExtraFolders] = useState<string[]>([])
  // 轮次 D-2：引用点击跳转后的近似定位目标（DocReaderPanel 消费）
  const [citationFocus, setCitationFocus] = useState<CitationFocus | null>(null)

  const myVisibleDocs = useMemo(() => visibleKbDocs(docs, userId), [docs, userId])

  const teamCount = useMemo(() => myVisibleDocs.filter((d) => d.visibility !== "personal").length, [myVisibleDocs])
  const personalCount = useMemo(
    () => myVisibleDocs.filter((d) => d.visibility === "personal").length,
    [myVisibleDocs],
  )

  // perf-01：最近阅读持久化（未登录不写，避免落错桶；隐私模式静默降级）
  useEffect(() => {
    const key = kbRecentKey(userId)
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(recentIds))
    } catch {
      /* 隐私模式等场景静默降级 */
    }
  }, [recentIds, userId])

  // 标题/可见性每次从当前 docs 现场解析：文档被删/失权自然从列表消失，无需额外清理
  const recentDocs = useMemo(() => {
    const out: KbDocRow[] = []
    for (const id of recentIds) {
      const hit = myVisibleDocs.find((d) => d.id === id)
      if (hit) out.push(hit)
      if (out.length >= 6) break
    }
    return out
  }, [recentIds, myVisibleDocs])

  const libDocs = useMemo(() => {
    const base = libTab === "team" ? myVisibleDocs.filter((d) => d.visibility !== "personal") : myVisibleDocs.filter((d) => d.visibility === "personal")
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return base
    // 性能第一批：列表快速筛选只扫元数据（title/summary/keywords/folder），
    // 不再对每篇 content 做全文 includes（1730 篇 × 每次按键 = 卡顿主因）；
    // 全文语义检索走问答通道（R87：scopeDocs 优先全文语料，searchKbDocs 覆盖 content）。
    return base.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.summary ?? "").toLowerCase().includes(q) ||
        (d.keywords ?? []).some((k) => String(k).toLowerCase().includes(q)) ||
        (d.folder_path ?? "").toLowerCase().includes(q),
    )
  }, [libTab, myVisibleDocs, debouncedQuery])

  const folderScopedDocs = useMemo(() => {
    if (!activeFolderPath) return libDocs
    const prefix = `${activeFolderPath}/`
    return libDocs.filter((d) => d.folder_path === activeFolderPath || (d.folder_path ?? "").startsWith(prefix))
  }, [libDocs, activeFolderPath])

  // 轮次 D-1：分类筛选（空 = 全部）
  const [categoryFilter, setCategoryFilter] = useState("")
  const categoryScopedDocs = useMemo(() => {
    if (!categoryFilter) return folderScopedDocs
    return folderScopedDocs.filter((d) => categoryOf(d) === categoryFilter)
  }, [folderScopedDocs, categoryFilter])

  const sortedDocs = useMemo(() => {
    const rows = [...categoryScopedDocs]
    rows.sort((a, b) => {
      if (sortKey === "title") return a.title.localeCompare(b.title, "zh-CN")
      if (sortKey === "created") return a.created < b.created ? 1 : -1
      return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0
    })
    return rows
  }, [categoryScopedDocs, sortKey])

  const selectedDoc = useMemo(() => docs.find((d) => d.id === selectedDocId) ?? null, [docs, selectedDocId])

  // R80/B-01：选中文档变化时按需补拉正文（阅读器/编辑器/删除回收桶共用保真通道）
  useEffect(() => {
    if (!selectedDocId) return
    void loadDocContent(selectedDocId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocId])


  // ------------------------------ 目录树 ------------------------------
  const folderTree = useMemo(() => {
    const root: FolderNode = { path: "", label: "全部文档", children: [], count: 0 }
    const ensure = (segments: string[]): FolderNode => {
      let node = root
      let acc = ""
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg
        let child = node.children.find((c) => c.label === seg)
        if (!child) {
          child = { path: acc, label: seg, children: [], count: 0 }
          node.children.push(child)
        }
        node = child
      }
      return node
    }
    for (const d of libDocs) {
      const segs = splitFolderPath(d.folder_path)
      const node = segs.length ? ensure(segs) : root
      node.count += 1
      let parentPath = node.path
      while (parentPath) {
        const idx = parentPath.lastIndexOf("/")
        parentPath = idx > 0 ? parentPath.slice(0, idx) : ""
      }
    }
    for (const p of extraFolders) {
      const segs = splitFolderPath(p)
      if (segs.length) ensure(segs)
    }
    // count 汇总：父节点计入子孙文档数
    const rollup = (node: FolderNode): number => {
      let total = node.count
      for (const c of node.children) total += rollup(c)
      node.count = total
      return total
    }
    for (const c of root.children) rollup(c)
    root.count = libDocs.length
    const sortChildren = (node: FolderNode) => {
      node.children.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
      node.children.forEach(sortChildren)
    }
    sortChildren(root)
    return root
  }, [libDocs, extraFolders])

  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    const walk = (node: FolderNode) => {
      if (node.path) paths.add(node.path)
      node.children.forEach(walk)
    }
    walk(folderTree)
    return [...paths].sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [folderTree])

  const selectFolder = useCallback((path: string | null) => {
    setActiveFolderPath(path)
    setSelectedDocId(null)
    setEditMode(false)
  }, [])

  // 循环 11 块 C：视图状态记忆（tab/目录/选中文档按账号存 sessionStorage，刷新后恢复）
  const kbViewRestoredRef = useRef(false)
  useEffect(() => {
    if (!userId) return
    try {
      sessionStorage.setItem(
        `kb_view_${userId}`,
        JSON.stringify({ tab: libTab, folder: activeFolderPath, docId: selectedDocId }),
      )
    } catch {
      /* 隐私模式静默降级 */
    }
  }, [libTab, activeFolderPath, selectedDocId, userId])
  useEffect(() => {
    if (!userId || docsLoading || kbViewRestoredRef.current) return
    kbViewRestoredRef.current = true
    try {
      const raw = sessionStorage.getItem(`kb_view_${userId}`)
      if (!raw) return
      const v = JSON.parse(raw) as { tab?: string; folder?: string | null; docId?: string | null }
      if (v.tab === "team" || v.tab === "personal") setLibTab(v.tab)
      if (typeof v.folder === "string") setActiveFolderPath(v.folder || null)
      if (v.docId && docs.some((d) => d.id === v.docId)) setSelectedDocId(v.docId)
    } catch {
      /* 损坏静默降级为默认视图 */
    }
  }, [userId, docsLoading, docs])

  const selectDoc = useCallback((doc: KbDocRow | null) => {
    setCitationFocus(null)
    if (!doc) {
      setSelectedDocId(null)
      setEditMode(false)
      return
    }
    setSelectedDocId(doc.id)
    setLibTab(doc.visibility === "personal" ? "personal" : "team")
    setEditMode(false)
    // perf-01：记录最近阅读（去重前移，上限 8；落盘由持久化 effect 完成）
    setRecentIds((prev) => [doc.id, ...prev.filter((x) => x !== doc.id)].slice(0, 8))
  }, [])

  // 轮次 B + D2：全局搜索深链 ?doc= 消费（ref 存「已消费 id」，URL id 变化即重新消费）
  const [searchParams] = useSearchParams()
  const docDeepLinkIdRef = useRef<string | null>(null)
  useEffect(() => {
    const docId = searchParams.get("doc")
    if (!docId || docDeepLinkIdRef.current === docId || docsLoading) return
    docDeepLinkIdRef.current = docId
    const target = myVisibleDocs.find((d) => d.id === docId)
    if (target) selectDoc(target)
    else toast.error("未找到对应文档或无权查看")
  }, [searchParams, docsLoading, myVisibleDocs, selectDoc])

  // ------------------------------ 文档操作 ------------------------------
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null)
  const [folderDraft, setFolderDraft] = useState("")
  const [docAction, setDocAction] = useState<DocActionState>(null)
  const [docActionDraft, setDocActionDraft] = useState("")
  const [deleteStrongStage, setDeleteStrongStage] = useState(false)

  const openCreateFolder = useCallback((parentPath: string) => {
    if (!requireLogin()) return
    setFolderDraft("")
    setFolderDialog({ mode: "create", parentPath, initialName: "" })
  }, [requireLogin])

  const openRenameFolder = useCallback((path: string) => {
    setFolderDraft(baseNameOf(path))
    setFolderDialog({ mode: "rename", parentPath: path, initialName: baseNameOf(path) })
  }, [])

  const submitFolderDialog = useCallback(async () => {
    const dlg = folderDialog
    const value = folderDraft.trim().replace(/\/+/g, "／")
    if (!dlg || !value) {
      toast.error("请输入文件夹名称")
      return
    }
    if (dlg.mode === "create") {
      const newPath = dlg.parentPath ? `${dlg.parentPath}/${value}` : value
      setExtraFolders((prev) => (prev.includes(newPath) ? prev : [...prev, newPath]))
      setFolderDialog(null)
      setActiveFolderPath(newPath)
      toast.success(`文件夹「${value}」已创建`)
      return
    }
    // rename：把该目录及其子孙下的文档 folder_path 前缀替换
    const oldPath = dlg.parentPath
    const parent = oldPath.slice(0, oldPath.lastIndexOf("/"))
    const newPath = parent ? `${parent}/${value}` : value
    if (newPath === oldPath) {
      setFolderDialog(null)
      return
    }
    const affected = docsRef.current.filter(
      (d) => d.folder_path === oldPath || (d.folder_path ?? "").startsWith(`${oldPath}/`),
    )
    try {
      await Promise.all(
        affected.map((d) =>
          updateKbDoc(d.id, { folder_path: `${newPath}${(d.folder_path ?? "").slice(oldPath.length)}` }),
        ),
      )
      setExtraFolders((prev) => prev.map((p) => (p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? `${newPath}${p.slice(oldPath.length)}` : p)))
      if (activeFolderPath === oldPath || (activeFolderPath ?? "").startsWith(`${oldPath}/`)) {
        setActiveFolderPath(`${newPath}${(activeFolderPath ?? "").slice(oldPath.length)}`)
      }
      setFolderDialog(null)
      await refreshDocs()
      toast.success(`文件夹已重命名为「${value}」`)
    } catch {
      toast.error("重命名失败，请稍后重试")
    }
  }, [folderDialog, folderDraft, activeFolderPath, refreshDocs])

  const submitDeleteFolder = useCallback(
    async (path: string) => {
      const affected = docsRef.current.filter(
        (d) => d.folder_path === path || (d.folder_path ?? "").startsWith(`${path}/`),
      )
      const parent = path.slice(0, path.lastIndexOf("/"))
      try {
        await Promise.all(affected.map((d) => updateKbDoc(d.id, { folder_path: parent })))
        setExtraFolders((prev) => prev.filter((p) => p !== path && !p.startsWith(`${path}/`)))
        if (activeFolderPath === path || (activeFolderPath ?? "").startsWith(`${path}/`)) {
          setActiveFolderPath(parent || null)
        }
        await refreshDocs()
        toast.success(`文件夹已删除，其中 ${affected.length} 篇文档已移到上级目录`)
      } catch {
        toast.error("删除文件夹失败，请稍后重试")
      }
    },
    [activeFolderPath, refreshDocs],
  )

  const openDocAction = useCallback((mode: "rename" | "move" | "delete", doc: KbDocRow) => {
    setDeleteStrongStage(false)
    setDocActionDraft(mode === "rename" ? doc.title : mode === "move" ? (doc.folder_path ?? "") : "")
    setDocAction({ mode, doc })
  }, [])

  const canEditDoc = useCallback(
    (doc: KbDocRow | null): boolean => {
      if (!doc || !userId) return false
      return doc.visibility !== "personal" || doc.rh_user_id === userId
    },
    [userId],
  )

  const startEdit = useCallback(async () => {
    if (!selectedDoc) return
    if (!canEditDoc(selectedDoc)) {
      toast.error("这篇笔记仅本人可编辑")
      return
    }
    await loadDocContent(selectedDoc.id)
    setEditDraft(selectedDoc.content ?? "")
    setEditMode(true)
  }, [selectedDoc, canEditDoc, loadDocContent])

  const cancelEdit = useCallback(() => {
    setEditMode(false)
    setEditDraft("")
  }, [])

  const saveDocEdit = useCallback(async () => {
    if (!selectedDoc) return
    const content = editDraft.trim()
    if (!content) {
      toast.error("内容不能为空")
      return
    }
    setSavingDoc(true)
    try {
      const { summary, keywords } = extractKbIndex(selectedDoc.title, content)
      await updateKbDoc(selectedDoc.id, { content, summary, keywords })
      setEditMode(false)
      await refreshDocs()
      toast.success("已保存")
    } catch {
      toast.error("保存失败，请稍后重试")
    } finally {
      setSavingDoc(false)
    }
  }, [selectedDoc, editDraft, refreshDocs])

  const submitDocAction = useCallback(async () => {
    const act = docAction
    if (!act) return
    const { mode, doc } = act
    if (mode === "rename") {
      const value = docActionDraft.trim()
      if (!value) {
        toast.error("请输入新标题")
        return
      }
      try {
        await updateKbDoc(doc.id, { title: value })
        setDocAction(null)
        await refreshDocs()
        toast.success("已重命名")
      } catch {
        toast.error("重命名失败，请稍后重试")
      }
      return
    }
    if (mode === "move") {
      try {
        await updateKbDoc(doc.id, { folder_path: docActionDraft.trim() })
        setDocAction(null)
        await refreshDocs()
        toast.success("已移动")
      } catch {
        toast.error("移动失败，请稍后重试")
      }
      return
    }
    // delete：团队文档非上传者需要二次强确认
    const isUploader = doc.rh_user_id === userIdRef.current
    if (doc.visibility !== "personal" && !isUploader && !deleteStrongStage) {
      setDeleteStrongStage(true)
      return
    }
    try {
      if ((doc.content ?? "").length === 0) await loadDocContent(doc.id)
      await deleteKbDoc(doc.id)
      // 循环 9 C1：删除成功落本地回收桶（仅本机可恢复；未登录不落桶）
      pushKbTrash(userIdRef.current, {
        doc_id: doc.id,
        title: doc.title,
        folder_path: doc.folder_path,
        content: doc.content,
        doc_format: doc.doc_format,
        visibility: doc.visibility,
        summary: doc.summary,
        keywords: doc.keywords ?? [],
        source_file_name: doc.source_file_name,
        doc_category: doc.doc_category,
      })
      setTrashItems(readKbTrash(userIdRef.current))
      if (selectedDocId === doc.id) {
        setSelectedDocId(null)
        setEditMode(false)
      }
      setDocAction(null)
      setDeleteStrongStage(false)
      await refreshDocs()
      toast.success("文档已删除")
    } catch {
      toast.error("删除失败，请稍后重试")
    }
  }, [docAction, docActionDraft, deleteStrongStage, selectedDocId, refreshDocs, loadDocContent])

  const closeDocAction = useCallback(() => {
    setDocAction(null)
    setDeleteStrongStage(false)
  }, [])

  // ------------------------------ 分类与 AI 策略（轮次 D-1） ------------------------------
  // 乐观更新 + 按 doc 累积 patch + 400ms 防抖 PATCH（照抄既有 saveTimerRef 防抖模式）
  const policyTimersRef = useRef<Map<string, number>>(new Map())
  const pendingPolicyRef = useRef<Map<string, Partial<Pick<KbDocRow, "doc_category" | "ai_context_mode" | "retrieval_weight" | "is_sensitive">>>>(new Map())

  const updateDocPolicy = useCallback(
    (doc: KbDocRow, patch: Partial<Pick<KbDocRow, "doc_category" | "ai_context_mode" | "retrieval_weight" | "is_sensitive">>) => {
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, ...patch } : d)))
      const accumulated = { ...(pendingPolicyRef.current.get(doc.id) ?? {}), ...patch }
      pendingPolicyRef.current.set(doc.id, accumulated)
      const prevTimer = policyTimersRef.current.get(doc.id)
      if (prevTimer) window.clearTimeout(prevTimer)
      const timer = window.setTimeout(() => {
        policyTimersRef.current.delete(doc.id)
        pendingPolicyRef.current.delete(doc.id)
        void updateKbDoc(doc.id, accumulated).catch(() => {
          toast.error("分类策略保存失败，已回退到服务器状态")
          void refreshDocs()
        })
      }, 400)
      policyTimersRef.current.set(doc.id, timer)
    },
    [refreshDocs],
  )

  // ------------------------------ 用户反馈轮（2026-09-17 晚）：批量整理 + 上传定位 ------------------------------
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [flashDocId, setFlashDocId] = useState<string | null>(null)
  const flashTimerRef = useRef<number | null>(null)

  const locateDoc = useCallback((docId: string) => {
    setSelectedDocId(docId)
    setFlashDocId(docId)
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlashDocId(null), 2000)
  }, [])

  const toggleBatchMode = useCallback(() => {
    setBatchMode((prev) => {
      if (prev) setBatchSelectedIds([])
      return !prev
    })
  }, [])

  const toggleBatchSelect = useCallback((docId: string) => {
    setBatchSelectedIds((prev) => (prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]))
  }, [])

  const clearBatchSelect = useCallback(() => setBatchSelectedIds([]), [])

  // 串行队列 best-effort（量小不并发，避免 PATCH 互相覆盖）；返回 [成功数, 失败数]
  const runBatchQueue = useCallback(async (ids: string[], worker: (id: string) => Promise<unknown>): Promise<[number, number]> => {
    let ok = 0
    let fail = 0
    for (const id of ids) {
      try {
        await worker(id)
        ok += 1
      } catch {
        fail += 1
      }
    }
    return [ok, fail]
  }, [])

  const batchMoveToFolder = useCallback(
    async (folderPath: string) => {
      const ids = batchSelectedIds
      if (!ids.length) return
      setBatchBusy(true)
      const [ok, fail] = await runBatchQueue(ids, (id) => updateKbDoc(id, { folder_path: folderPath }))
      setBatchBusy(false)
      setBatchSelectedIds([])
      await refreshDocs()
      toast[fail ? "error" : "success"](fail ? `已移动 ${ok} 篇，${fail} 篇失败请重试` : `已移动 ${ok} 篇到「${folderPath || "根目录"}」`)
    },
    [batchSelectedIds, runBatchQueue, refreshDocs],
  )

  const batchSetCategory = useCallback(
    async (category: string) => {
      const targets = docs.filter((d) => batchSelectedIds.includes(d.id))
      if (!targets.length) return
      setBatchBusy(true)
      for (const doc of targets) updateDocPolicy(doc, { doc_category: category })
      setBatchBusy(false)
      setBatchSelectedIds([])
      toast.success(`已修改 ${targets.length} 篇分类为「${category}」`)
    },
    [batchSelectedIds, docs, updateDocPolicy],
  )

  const batchDeleteDocs = useCallback(async () => {
    const ids = batchSelectedIds
    if (!ids.length) return
    setBatchBusy(true)
    // 循环 9 C1：记录批量删除成功的 id，删除后逐条落本地回收桶
    const okIds: string[] = []
    const [ok, fail] = await runBatchQueue(ids, async (id) => {
      const r = await deleteKbDoc(id)
      okIds.push(id)
      return r
    })
    for (const id of okIds) {
      const d = docs.find((x) => x.id === id)
      if (!d) continue
      if ((d.content ?? "").length === 0) await loadDocContent(d.id)
      pushKbTrash(userIdRef.current, {
        doc_id: d.id,
        title: d.title,
        folder_path: d.folder_path,
        content: d.content,
        doc_format: d.doc_format,
        visibility: d.visibility,
        summary: d.summary,
        keywords: d.keywords ?? [],
        source_file_name: d.source_file_name,
        doc_category: d.doc_category,
      })
    }
    if (okIds.length) setTrashItems(readKbTrash(userIdRef.current))
    setBatchBusy(false)
    setBatchSelectedIds([])
    setBatchMode(false)
    if (selectedDocId && ids.includes(selectedDocId)) {
      setSelectedDocId(null)
      setEditMode(false)
    }
    await refreshDocs()
    toast[fail ? "error" : "success"](fail ? `已删除 ${ok} 篇，${fail} 篇失败请重试` : `已删除 ${ok} 篇文档`)
  }, [batchSelectedIds, docs, loadDocContent, runBatchQueue, refreshDocs, selectedDocId])

  // ------------------------------ 循环 9 C1：最近删除本地回收桶 ------------------------------
  const [trashItems, setTrashItems] = useState<KbTrashItem[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  useEffect(() => {
    setTrashItems(readKbTrash(userId))
  }, [userId])

  /** 恢复 = 走既有 create 路由重建（新记录）+ 桶内移除 + 定位高亮 */
  const restoreTrashItem = useCallback(
    async (item: KbTrashItem) => {
      const uid = userIdRef.current
      if (!uid) return
      try {
        const created = await createKbDoc({
          rh_user_id: uid,
          title: item.title,
          folder_path: item.folder_path,
          content: item.content,
          doc_format: item.doc_format || "txt",
          visibility: item.visibility || "personal",
          summary: item.summary,
          keywords: item.keywords ?? [],
          source_file_name: item.source_file_name,
          uploader_name: uploaderNameRef.current,
          doc_category: item.doc_category,
        })
        removeKbTrash(uid, item.trashed_at)
        setTrashItems(readKbTrash(uid))
        await refreshDocs()
        if (created?.id) locateDoc(created.id)
        toast.success(`已恢复《${item.title}》`)
      } catch {
        toast.error("恢复失败，请稍后重试")
      }
    },
    [locateDoc, refreshDocs],
  )

  /** 彻底移除 = 仅桶内删除（服务端本已无此记录） */
  const purgeTrashItem = useCallback(
    (item: KbTrashItem) => {
      const uid = userIdRef.current
      if (!uid) return
      removeKbTrash(uid, item.trashed_at)
      setTrashItems(readKbTrash(uid))
    },
    [],
  )

  // ------------------------------ 上传 ------------------------------
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadVisibility, setUploadVisibility] = useState<LibTab>("team")
  const [uploadFolder, setUploadFolder] = useState("")
  const [uploadResults, setUploadResults] = useState<UploadRowResult[]>([])
  const [uploading, setUploading] = useState(false)
  // 轮次 D-1：上传分类（缺省「其他」；UploadDialog 会按文件名智能预选）
  const [uploadCategory, setUploadCategory] = useState("其他")

  const openUpload = useCallback(() => {
    if (!requireLogin()) return
    setUploadVisibility(libTab)
    setUploadFolder(activeFolderPath ?? "")
    setUploadCategory("其他")
    setUploadResults([])
    setUploadOpen(true)
  }, [requireLogin, libTab, activeFolderPath])

  const closeUpload = useCallback(() => {
    if (uploading) return
    setUploadOpen(false)
  }, [uploading])

  const processUploadFiles = useCallback(
    async (files: File[], category?: string) => {
      const uid = userIdRef.current
      if (!uid || files.length === 0) return
      setUploading(true)
      setUploadResults(files.map((f) => ({ fileName: f.name, done: false, okCount: 0 })))
      const fixedCategory = (category ?? "").trim()
      let okTotal = 0
      let firstNewId: string | null = null
      let firstNewTitle = ""
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          const items = await parseUploadFile(file, uploadFolder.trim())
          let okCount = 0
          for (const item of items) {
            const { summary, keywords } = extractKbIndex(item.title, item.content)
            const docCategory =
              fixedCategory || guessCategoryFromFileName(item.source_file_name || item.title) || "其他"
            const created = await createKbDoc({
              rh_user_id: uid,
              title: item.title,
              folder_path: item.folder_path,
              content: item.content.slice(0, 480000),
              doc_format: item.doc_format,
              visibility: uploadVisibility,
              summary,
              keywords,
              source_file_name: item.source_file_name,
              uploader_name: uploaderNameRef.current,
              doc_category: docCategory,
            })
            okCount += 1
            if (!firstNewId && created?.id) {
              firstNewId = created.id
              firstNewTitle = item.title
            }
          }
          okTotal += okCount
          setUploadResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, done: true, okCount } : r)))
        } catch (err) {
          const reason = err instanceof Error ? err.message : "解析失败"
          setUploadResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, done: true, okCount: 0, failReason: reason } : r)))
        }
      }
      setUploading(false)
      await refreshDocs()
      if (okTotal > 0) {
        toast.success(firstNewTitle ? `已入库 ${okTotal} 篇文档，已定位到《${firstNewTitle}》` : `已入库 ${okTotal} 篇文档`)
        if (firstNewId) locateDoc(firstNewId)
      }
    },
    [uploadFolder, uploadVisibility, refreshDocs, locateDoc],
  )

  // 本地文件夹导入：递归遍历所选目录，逐文件解析 + 内容感知七分类 + 摘要/关键词 + 按分类默认策略入库。
  const processUploadFolder = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) {
      requireLogin()
      return
    }
    if (uploading) return
    if (!supportsFolderImport()) {
      toast.error("当前浏览器不支持选择文件夹，请改用 Chrome / Edge，或用「选择文件」多选")
      return
    }
    const picked = await pickAndWalkFolder()
    if (!picked) return // 用户取消
    if (picked.files.length === 0) {
      toast.info("该文件夹下没有可导入的文档（支持 md/txt/docx/pdf/pptx/xlsx）")
      return
    }
    setUploading(true)
    setUploadResults(picked.files.map((f) => ({ fileName: f.file.name, done: false, okCount: 0 })))
    const base = uploadFolder.trim()
    const rootPrefix = base ? joinImportFolder(base, picked.rootName) : picked.rootName
    const existing = new Set(
      docsRef.current.map((d) => `${d.folder_path || ""}||${d.source_file_name || ""}`),
    )
    const vis = uploadVisibility
    let okTotal = 0
    let dup = 0
    let fail = 0
    const byCat: Record<string, number> = {}
    let firstNewId: string | null = null
    for (let i = 0; i < picked.files.length; i++) {
      const { file, relFolder } = picked.files[i]
      try {
        const items = await parseUploadFile(file, joinImportFolder(rootPrefix, relFolder))
        let okCount = 0
        for (const item of items) {
          const key = `${item.folder_path}||${item.source_file_name}`
          if (existing.has(key)) {
            dup += 1
            continue
          }
          const { summary, keywords } = extractKbIndex(item.title, item.content)
          const { category } = classifyKbDoc(item.source_file_name || item.title, item.content)
          const pol = KB_CATEGORY_POLICY[category] ?? KB_CATEGORY_POLICY["其他"]
          const created = await createKbDoc({
            rh_user_id: uid,
            title: item.title,
            folder_path: item.folder_path,
            content: item.content.slice(0, 480000),
            doc_format: item.doc_format,
            visibility: vis,
            summary,
            keywords,
            source_file_name: item.source_file_name,
            uploader_name: uploaderNameRef.current,
            doc_category: category,
            ai_context_mode: pol.ai_context_mode,
            retrieval_weight: pol.retrieval_weight,
            is_sensitive: pol.is_sensitive,
          })
          existing.add(key)
          byCat[category] = (byCat[category] || 0) + 1
          okCount += 1
          okTotal += 1
          if (!firstNewId && created?.id) firstNewId = created.id
        }
        if (okCount === 0) fail += 1
        setUploadResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, done: true, okCount } : r)))
      } catch (err) {
        fail += 1
        const reason = err instanceof Error ? err.message : "解析失败"
        setUploadResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, done: true, okCount: 0, failReason: reason } : r)),
        )
      }
    }
    setUploading(false)
    await refreshDocs()
    const catText = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} ${n}`)
      .join("，")
    toast.success(
      `已导入《${picked.rootName}》：入库 ${okTotal} 篇${catText ? `（${catText}）` : ""}${dup ? `，跳过重复 ${dup}` : ""}${fail ? `，失败/空 ${fail}` : ""}`,
    )
    if (firstNewId) locateDoc(firstNewId)
  }, [uploading, uploadFolder, uploadVisibility, requireLogin, refreshDocs, locateDoc])

  // ------------------------------ 问知识库 ------------------------------
  const [qaOpen, setQaOpen] = useState(false)
  const [qaScope, setQaScope] = useState<QaScope>("all")
  const [qaInput, setQaInput] = useState("")
  const [qaMessages, setQaMessages] = useState<QaChatMsg[]>([])
  const [qaSending, setQaSending] = useState(false)
  const qaMessagesRef = useRef<QaChatMsg[]>([])
  // T2.5：轮次守卫——clearQa 递增序号，在飞 LLM 落定时校验过期即丢弃，防答案复活进已清空列表
  const qaTurnSeqRef = useRef(0)
  useEffect(() => {
    qaMessagesRef.current = qaMessages
  }, [qaMessages])
  const qaScopeRef = useRef<QaScope>(qaScope)
  useEffect(() => {
    qaScopeRef.current = qaScope
  }, [qaScope])

  // 轮次 4 B2：mount / 登录态就绪时从 sessionStorage 恢复 qa 会话（未登录不读不写）
  useEffect(() => {
    if (!userId) return
    try {
      const raw = window.sessionStorage.getItem(`${QA_SESSION_PREFIX}${userId}`)
      if (!raw) return
      const restored = sanitizeQaMessages(JSON.parse(raw))
      if (restored.length === 0) return
      setQaMessages(restored)
      qaMessagesRef.current = restored
    } catch (err) {
      console.warn("知识库问答会话恢复失败", err)
    }
  }, [userId])

  // 轮次 4 B2：qaMessages 变更后防抖 ~500ms 写 sessionStorage；超配额等异常静默降级
  useEffect(() => {
    if (!userId) return
    const storageKey = `${QA_SESSION_PREFIX}${userId}`
    const timer = window.setTimeout(() => {
      try {
        if (qaMessages.length === 0) window.sessionStorage.removeItem(storageKey)
        else window.sessionStorage.setItem(storageKey, JSON.stringify(qaMessages.slice(-QA_SESSION_LIMIT)))
      } catch (err) {
        console.warn("知识库问答会话持久化失败", err)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [qaMessages, userId])

  const openQa = useCallback(() => {
    if (!requireLogin()) return
    setQaOpen(true)
  }, [requireLogin])

  const closeQa = useCallback(() => setQaOpen(false), [])

  const clearQa = useCallback(() => {
    // T2.5：先递增轮次序号，使所有在飞 executeQaTurn 落定后判定过期并丢弃结果
    qaTurnSeqRef.current += 1
    setQaMessages([])
    qaMessagesRef.current = []
    // 轮次 4 B2：同步清 sessionStorage，避免「清空后刷新又复活」
    const uid = userIdRef.current
    if (uid) {
      try {
        window.sessionStorage.removeItem(`${QA_SESSION_PREFIX}${uid}`)
      } catch (err) {
        console.warn("知识库问答会话存储清除失败", err)
      }
    }
  }, [])

  const scopeDocs = useCallback(
    (scope: QaScope): KbDocRow[] => {
      // R87：检索语料优先全文副本（slim 列表正文为空，仅元数据通道可用）；语料未就绪时退回列表
      const source = qaCorpusRef.current?.length ? qaCorpusRef.current : docsRef.current
      const rows = visibleKbDocs(source, userIdRef.current)
      if (scope === "team") return rows.filter((d) => d.visibility !== "personal")
      if (scope === "personal") return rows.filter((d) => d.visibility === "personal")
      return rows
    },
    [],
  )

  // ------------------------------ 弹药库 QA 对（轮次 D-3） ------------------------------
  const [qaPairs, setQaPairs] = useState<KbQaPairRow[]>([])
  const [qaPairsLoading, setQaPairsLoading] = useState(false)
  const qaPairsRef = useRef<KbQaPairRow[]>([])
  useEffect(() => {
    qaPairsRef.current = qaPairs
  }, [qaPairs])
  const qaPairsLoadedRef = useRef(false)

  const loadQaPairs = useCallback(async () => {
    setQaPairsLoading(true)
    try {
      const rows = await listKbQaPairs()
      setQaPairs(rows)
      qaPairsLoadedRef.current = true
    } catch {
      toast.error("弹药库数据加载失败，请稍后重试")
    } finally {
      setQaPairsLoading(false)
    }
  }, [])

  // 打开问答抽屉时拉一次（approved + pending 同表，一次取齐）
  useEffect(() => {
    if (qaOpen && !qaPairsLoadedRef.current) void loadQaPairs()
  }, [qaOpen, loadQaPairs])

  const approvedQaPairs = useMemo(
    () => visibleQaPairs(qaPairs, userId).filter((p) => p.status === "approved"),
    [qaPairs, userId],
  )
  const pendingQaPairs = useMemo(
    () => visibleQaPairs(qaPairs, userId).filter((p) => p.status === "pending"),
    [qaPairs, userId],
  )

  const createQaPair = useCallback(
    async (question: string, answer: string, category: string, visibility: string): Promise<boolean> => {
      const uid = userIdRef.current
      if (!uid) {
        setNeedsRhLogin(true)
        toast.error("当前无法维护弹药库，请稍后重试")
        return false
      }
      const q = question.trim()
      const a = answer.trim()
      if (!q || !a) {
        toast.error("请填写问题和答案")
        return false
      }
      try {
        const row = await createKbQaPair({
          rh_user_id: uid,
          question: q.slice(0, 1000),
          answer: a.slice(0, 20000),
          category,
          status: "approved",
          source: "manual",
          visibility: visibility === "personal" ? "personal" : "team",
        })
        setQaPairs((prev) => [row, ...prev])
        toast.success("已加入弹药库")
        return true
      } catch {
        toast.error("保存失败，请稍后重试")
        return false
      }
    },
    [],
  )

  const updateQaPair = useCallback(
    async (
      row: KbQaPairRow,
      patch: Partial<Pick<KbQaPairRow, "question" | "answer" | "category" | "visibility">>,
    ): Promise<boolean> => {
      const q = (patch.question ?? row.question ?? "").trim()
      const a = (patch.answer ?? row.answer ?? "").trim()
      if (!q || !a) {
        toast.error("问题和答案都不能为空")
        return false
      }
      try {
        const updated = await updateKbQaPair(row.id, { ...patch, question: q.slice(0, 1000), answer: a.slice(0, 20000) })
        setQaPairs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        toast.success("问答对已更新")
        return true
      } catch {
        toast.error("更新失败，请稍后重试")
        return false
      }
    },
    [],
  )

  const deleteQaPair = useCallback(async (row: KbQaPairRow): Promise<void> => {
    try {
      await deleteKbQaPair(row.id)
      setQaPairs((prev) => prev.filter((p) => p.id !== row.id))
      toast.success("已删除")
    } catch {
      toast.error("删除失败，请稍后重试")
    }
  }, [])

  const approveQaPending = useCallback(
    async (row: KbQaPairRow, answer: string, category: string): Promise<boolean> => {
      const a = answer.trim()
      if (!a) {
        toast.error("请先填写答案")
        return false
      }
      try {
        const updated = await updateKbQaPair(row.id, { answer: a.slice(0, 20000), category, status: "approved" })
        setQaPairs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        toast.success("已入弹药库")
        return true
      } catch {
        toast.error("入库失败，请稍后重试")
        return false
      }
    },
    [],
  )

  /** 待补答入队核心：同用户同问题 pending 去重（轮次 4 B1：检索 0 命中与「答得不对」负反馈共用） */
  const enqueueQaGapCore = useCallback(
    async (question: string, opts: { source: string; announce: boolean }): Promise<boolean> => {
      const uid = userIdRef.current
      if (!uid) return false
      const q = question.trim()
      if (!q) return false
      const norm = qaGapDedupeKey(q)
      const dup = qaPairsRef.current.some(
        (p) => p.status === "pending" && p.rh_user_id === uid && qaGapDedupeKey(p.question) === norm,
      )
      if (dup) {
        if (opts.announce) toast.info("已在待补答队列")
        return true
      }
      try {
        const row = await createKbQaPair({
          rh_user_id: uid,
          question: q.slice(0, 1000),
          answer: "",
          category: "",
          status: "pending",
          source: opts.source,
          visibility: qaScopeRef.current === "personal" ? "personal" : "team",
        })
        setQaPairs((prev) => [row, ...prev])
        if (opts.announce) toast.success("已加入待补答队列")
        return true
      } catch {
        // announce=false（检索 0 命中路径）保持静默，不打断拒绝话术
        if (opts.announce) toast.error("反馈失败，请稍后重试")
        return false
      }
    },
    [],
  )

  /** 检索 0 命中时自动入待补答队列（同用户同问题 pending 去重，失败静默） */
  const enqueueQaGap = useCallback(
    (question: string) => {
      void enqueueQaGapCore(question, { source: "qa_gap", announce: false })
    },
    [enqueueQaGapCore],
  )

  /**
   * 轮次 4 B1：回答卡「答得不对」负反馈——把当轮用户提问以 source=user_feedback 入待补答队列。
   * 只入队，不调用任何模型；返回 true 表示问题已进入（或本就在）待补答队列。
   */
  const reportAnswerWrong = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!requireLogin()) return false
      const msgs = qaMessagesRef.current
      const idx = msgs.findIndex((m) => m.id === messageId)
      if (idx < 0) return false
      // 直答卡自带原始提问；LLM 引用回答卡回溯最近一条用户消息
      let question = (msgs[idx].qaFollowQuestion ?? "").trim()
      if (!question) {
        for (let i = idx - 1; i >= 0; i -= 1) {
          if (msgs[i].role === "user") {
            question = msgs[i].content.trim()
            break
          }
        }
      }
      if (!question) {
        toast.error("无法定位这轮的提问")
        return false
      }
      return enqueueQaGapCore(question, { source: "user_feedback", announce: true })
    },
    [requireLogin, enqueueQaGapCore],
  )

  const executeQaTurn = useCallback(
    async (question: string, hits: ReturnType<typeof searchKbDocs>, qaPair: KbQaPairRow | null) => {
      // T2.5：捕获本轮序号，落定时若已被 clearQa 递增则丢弃结果（不入 state、不随防抖写存储）
      const turnSeq = qaTurnSeqRef.current
      setQaSending(true)
      const citations: QaCitation[] = hits.map((h) => ({
        docId: h.doc.id,
        title: h.doc.title,
        // D-1 执行点②：脱敏摘要文档的引用摘录只给 summary，不出现 content 原文
        snippet: contextSnippetOf(h.doc, h),
        visibility: h.doc.visibility,
        chunkStart: h.chunkStart,
      }))
      const contextBlock = hits
        .map((h, i) => `【资料 ${i + 1}】《${h.doc.title}》（${h.doc.visibility === "personal" ? "个人笔记" : "团队知识库"}${h.doc.folder_path ? ` / ${h.doc.folder_path}` : ""}${h.headingPath ? ` / ${h.headingPath}` : ""}）\n${contextSnippetOf(h.doc, h)}`)
        .join("\n\n")
      // D-3 medium：QA 对作为最高优先「标准答案」注入 contextBlock 顶部
      const stdBlock = qaPair
        ? `【标准答案】（团队弹药库已审批口径，优先采用）\n问题：${qaPair.question}\n答案：${qaPair.answer}\n\n`
        : ""
      const priorMsgs: LlmMessage[] = qaMessagesRef.current
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }))
      const messages: LlmMessage[] = [
        { role: "system", content: KB_QA_SYSTEM_PROMPT },
        ...priorMsgs,
        { role: "user", content: `从知识库检索到的相关资料：\n\n${stdBlock}${contextBlock}\n\n用户问题：${question}` },
      ]
      try {
        const res = await chatViaGateway({
          modelRef: activeModelRefRef.current,
          messages: injectSkillBlock(messages, skillBlockFor("kb-qa")),
          page: "knowledge",
          max_tokens: 4096,
          // 降耗：同模型 + 同完整 messages（含检索资料与历史）才命中，重复提问直接返回、不再出站计费。
          cacheable: true,
        })
        if (res.needsLogin) {
          setNeedsRhLogin(true)
          throw new Error("rh_login_required")
        }
        if (!res.ok || res.status !== "success") {
          throw new Error(res.error || "failed")
        }
        const answer = res.text?.trim() || "这轮没有返回有效内容，请换个问法或稍后重试。"
        if (qaTurnSeqRef.current === turnSeq) {
          setQaMessages((prev) => [
            ...prev,
            { id: localId("qa_ai"), role: "assistant", content: answer, citations, qaLevel: qaPair ? "medium" : undefined },
          ])
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : undefined
        toast.error(mapAssistantLlmError(raw))
        // T2.5：qa_err 同受轮次守卫——清空后落定的失败消息不复活
        if (qaTurnSeqRef.current === turnSeq) {
          setQaMessages((prev) => [
            ...prev,
            { id: localId("qa_err"), role: "assistant", content: mapAssistantLlmError(raw), citations },
          ])
        }
      } finally {
        setQaSending(false)
      }
    },
    [],
  )

  // T2.4：用户消息统一经此 helper 追加——同步更新 ref，保证 executeQaTurn 读到的上下文一致
  const pushQaUserMsg = useCallback((content: string) => {
    const msg: QaChatMsg = { id: localId("qa_me"), role: "user", content }
    qaMessagesRef.current = [...qaMessagesRef.current, msg]
    setQaMessages(qaMessagesRef.current)
  }, [])

  const sendQaQuestion = useCallback(
    async (text?: string) => {
      const question = (text ?? qaInput).trim()
      if (!question || qaSending || qaIndexing) return
      if (!requireLogin()) return
      setQaInput("")

      // D-3：先匹配弹药库——high 置信直答（不调 LLM、不弹费用确认）
      const approved = visibleQaPairs(qaPairsRef.current, userIdRef.current).filter(
        (p) => p.status === "approved" && (p.answer ?? "").trim(),
      )
      const match = matchQaPair(question, approved)
      if (match && match.level === "high") {
        pushQaUserMsg(question)
        setQaMessages((prev) => [
          ...prev,
          {
            id: localId("qa_hit"),
            role: "assistant",
            content: match.pair.answer,
            qaLevel: "high",
            qaFollowQuestion: question,
          },
        ])
        return
      }

      // R87：冷启动先备好全文语料再检索（首次有网络等待，qaIndexing 期间入口已禁用）
      await ensureQaCorpus()
      const hits = searchKbDocs(scopeDocs(qaScopeRef.current), question, 5)
      if (hits.length === 0) {
        // D-3：检索 0 命中自动入待补答队列
        void enqueueQaGap(question)
        pushQaUserMsg(question)
        setQaMessages((prev) => [
          ...prev,
          {
            id: localId("qa_none"),
            role: "assistant",
            content:
              "知识库中没找到与这个问题相关的内容。可以先上传相关文档（支持 md/docx/pdf/zip），或切换检索范围再试；我不会编造知识库里没有的资料。\n\n已记入待补答队列，团队补充答案后下次直接命中。",
          },
        ])
        return
      }
      // T2.4：用户消息改为费用确认通过后再 push——取消确认时聊天区不留悬空提问
      costConfirm.runWithCostConfirm(() => {
        pushQaUserMsg(question)
        void executeQaTurn(question, hits, match ? match.pair : null)
      }, costText)
    },
    [qaInput, qaSending, qaIndexing, requireLogin, scopeDocs, costConfirm, costText, executeQaTurn, enqueueQaGap, pushQaUserMsg, ensureQaCorpus],
  )

  /** high 直答后用户点「仍要问 AI」：跳过弹药库，走原检索 + LLM 流程 */
  const askAiAnyway = useCallback(
    async (question: string) => {
      const q = (question ?? "").trim()
      if (!q || qaSending || qaIndexing) return
      if (!requireLogin()) return
      await ensureQaCorpus()
      const hits = searchKbDocs(scopeDocs(qaScopeRef.current), q, 5)
      if (hits.length === 0) {
        pushQaUserMsg(q)
        setQaMessages((prev) => [
          ...prev,
          {
            id: localId("qa_none"),
            role: "assistant",
            content: "知识库中没找到与这个问题相关的内容，我不会编造知识库里没有的资料。可以先上传相关文档再试。",
          },
        ])
        return
      }
      // T2.4：同上——费用确认取消后不留悬空用户消息
      costConfirm.runWithCostConfirm(() => {
        pushQaUserMsg(q)
        void executeQaTurn(q, hits, null)
      }, costText)
    },
    [qaSending, qaIndexing, requireLogin, scopeDocs, costConfirm, costText, executeQaTurn, pushQaUserMsg, ensureQaCorpus],
  )

  const openCitation = useCallback(
    (citation: QaCitation) => {
      const doc = docsRef.current.find((d) => d.id === citation.docId) ?? null
      if (!doc) {
        toast.error("该文档可能已被删除")
        return
      }
      setActiveFolderPath(null)
      setSearchQuery("")
      selectDoc(doc)
      // D-2：带块偏移时按 chunkStart/总长比例近似定位 + 片段高亮
      const total = (doc.content ?? "").length
      const chunkStart = citation.chunkStart ?? 0
      setCitationFocus({
        docId: doc.id,
        ratio: total > 0 && chunkStart > 0 ? Math.min(1, chunkStart / total) : 0,
        snippet: citation.snippet,
      })
      setQaOpen(false)
    },
    [selectDoc],
  )

  return {
    // 登录
    userId,
    needsRhLogin,
    handleAccountChange,
    // 技能 scope 源（QaDrawer 选择器用）
    kbQaSkills,
    // 模型
    models,
    activeModelKey,
    onModelChange,
    costText,
    costConfirm,
    // 数据
    docs,
    docsLoading,
    docsCalibrating,
    refreshDocs,
    teamCount,
    personalCount,
    libTab,
    setLibTab,
    searchQuery,
    setSearchQuery,
    activeFolderPath,
    selectFolder,
    sortedDocs,
    selectedDoc,
    selectDoc,
    recentDocs,
    sortKey,
    setSortKey,
    folderTree,
    allFolderPaths,
    canEditDoc,
    // 分类与 AI 策略（D-1）
    categoryFilter,
    setCategoryFilter,
    updateDocPolicy,
    citationFocus,
    // 用户反馈轮（2026-09-17 晚）：批量整理 + 上传定位
    batchMode,
    batchSelectedIds,
    batchBusy,
    toggleBatchMode,
    toggleBatchSelect,
    clearBatchSelect,
    batchMoveToFolder,
    batchSetCategory,
    batchDeleteDocs,
    flashDocId,
    locateDoc,
    // 循环 9 C1：最近删除本地回收桶
    trashItems,
    trashOpen,
    setTrashOpen,
    restoreTrashItem,
    purgeTrashItem,
    // 目录操作
    folderDialog,
    folderDraft,
    setFolderDraft,
    openCreateFolder,
    openRenameFolder,
    submitFolderDialog,
    submitDeleteFolder,
    closeFolderDialog: () => setFolderDialog(null),
    // 文档操作
    editMode,
    editDraft,
    setEditDraft,
    savingDoc,
    startEdit,
    cancelEdit,
    saveDocEdit,
    docAction,
    docActionDraft,
    setDocActionDraft,
    deleteStrongStage,
    openDocAction,
    submitDocAction,
    closeDocAction,
    // 上传
    uploadOpen,
    uploadVisibility,
    setUploadVisibility,
    uploadFolder,
    setUploadFolder,
    uploadCategory,
    setUploadCategory,
    uploadResults,
    uploading,
    openUpload,
    closeUpload,
    processUploadFiles,
    processUploadFolder,
    supportsFolderImport: supportsFolderImport(),
    // 问答
    qaOpen,
    qaScope,
    setQaScope,
    qaInput,
    setQaInput,
    qaMessages,
    qaSending,
    qaIndexing,
    openQa,
    closeQa,
    clearQa,
    sendQaQuestion,
    askAiAnyway,
    openCitation,
    // 轮次 4 B1：回答卡「答得不对」负反馈入待补答队列
    reportAnswerWrong,
    // 弹药库（D-3）
    approvedQaPairs,
    pendingQaPairs,
    qaPairsLoading,
    createQaPair,
    updateQaPair,
    deleteQaPair,
    approveQaPending,
  }
}
