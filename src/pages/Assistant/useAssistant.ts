import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
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
import {
  appendFailedMsg,
  assistantApiFetch,
  buildSystemPrompt,
  clearFailedMsgs,
  DATA_SOURCES,
  failedMsgsToChatMsgs,
  failedPendingBucket,
  mergeFloatPendingIntoPending,
  migrateFailedMsgs,
  readFailedMsgs,
  removeFailedMsg,
  removeFailedMsgsByUserText,
  extractTemplateSlots,
  fetchSiteData,
  fillTemplate,
  LAST_BIZ_PATH_KEY,
  mapAssistantLlmError,
  memoryRowsDedupeKey,
  pageLabel,
  parseAssistantReply,
  sessionTitle,
  sortSessions,
  type AssistantListResponse,
  type ChatMsg,
  type MemoryGroup,
  type MemoryRow,
  type MessageRow,
  type SessionRow,
  type SkillRow,
} from "@/lib/assistantCore"
import { KB_QA_DIRECT_PREFIX } from "@/lib/kbQa"

export interface UseAssistantOptions {
  /** 悬浮迷你聊天窗模式：新会话默认命名「快捷会话」，页面上下文跟随当前路由 */
  floatMode?: boolean
}

export interface SkillFillState {
  skillName: string
  template: string
  slots: string[]
  values: Record<string, string>
}

let localSeq = 0
function localId(prefix: string): string {
  localSeq += 1
  return `${prefix}_${Date.now()}_${localSeq}`
}

/** B6：会话列表每页条数（首屏减负，满页即认为可能还有下一页） */
const SESSIONS_PER_PAGE = 50

export function useAssistant(options?: UseAssistantOptions) {
  const floatMode = options?.floatMode ?? false
  const costConfirm = useCostConfirm()
  const loc = useLocation()

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [needsRhLogin, setNeedsRhLogin] = useState(false)
  const userIdRef = useRef<string | null>(userId)
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
    if (uid) setNeedsRhLogin(false)
  }, [])

  const requireLogin = useCallback(() => {
    if (userIdRef.current) return true
    setNeedsRhLogin(true)
    toast.error("当前会话不可用，请稍后重试")
    return false
  }, [])

  // ------------------------------ 模型选择 ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")
  const activeModelRef = useMemo(
    () => modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null,
    [modelOptions, selectedModelKey],
  )
  const costText = useMemo(() => costTextForModel(activeModelRef), [activeModelRef])
  const activeModelRefRef = useRef<ModelRef | null>(activeModelRef)
  useEffect(() => {
    activeModelRefRef.current = activeModelRef
  }, [activeModelRef])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const av = await resolveAvailableModels()
        if (cancelled) return
        setModelOptions(av.models)
        setSelectedModelKey((prev) =>
          prev && av.models.some((m) => modelRefKey(m) === prev)
            ? prev
            : av.defaultRef
              ? modelRefKey(av.defaultRef)
              : "",
        )
      } catch {
        /* 模型列表加载失败时静默回退平台默认模型 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  // ------------------------------ 页面联动上下文 ------------------------------
  const [contextPath, setContextPath] = useState<string | null>(() => {
    if (floatMode) return loc.pathname
    try {
      return window.sessionStorage.getItem(LAST_BIZ_PATH_KEY)
    } catch {
      return null
    }
  })
  const [contextEnabled, setContextEnabled] = useState(true)
  const contextPathRef = useRef<string | null>(contextPath)
  useEffect(() => {
    contextPathRef.current = contextPath
  }, [contextPath])

  useEffect(() => {
    if (!floatMode) return
    setContextPath(loc.pathname)
    contextPathRef.current = loc.pathname
    setContextEnabled(true)
  }, [floatMode, loc.pathname])

  const contextLabel = useMemo(
    () => (contextEnabled ? pageLabel(contextPath) : null),
    [contextEnabled, contextPath],
  )
  const contextLabelRef = useRef<string | null>(contextLabel)
  useEffect(() => {
    contextLabelRef.current = contextLabel
  }, [contextLabel])

  const closeContext = useCallback(() => setContextEnabled(false), [])

  // ------------------------------ 会话 / 消息 ------------------------------
  // B6：会话分页——陷阱：assistant_sessions 路由的 totalItems 是本页条数不是总数，
  // hasMore 只能用「满页判定」（items.length === perPage），禁止依赖 totalItems
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false)
  const sessionsPageRef = useRef(1)
  // B1：建会话意图序号——用户每次显式切换/新建会话递增；在飞的建会话请求落定时
  // 校验序号未变才绑定 UI，避免顶掉用户刚选中的会话导致后续消息串写
  const sessionIntentSeqRef = useRef(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const [convMessages, setConvMessages] = useState<ChatMsg[]>([])
  const convMessagesRef = useRef<ChatMsg[]>([])
  useEffect(() => {
    convMessagesRef.current = convMessages
  }, [convMessages])

  const [draftInput, setDraftInput] = useState("")
  const [composerFocusTick, setComposerFocusTick] = useState(0)
  const [sendState, setSendState] = useState<"idle" | "sending" | "fetching">("idle")
  const [fetchBadge, setFetchBadge] = useState("")
  const sendingRef = useRef(false)
  // p1-ux：本轮 chatViaGateway 的取消句柄；用户点「取消」时 abort，
  // 服务端 fetch 会立即断开；已发出的一轮 LLM 调用不可撤回，但可停止后续
  // fetchSiteData/下一轮 LLM，用户体感为「停止思考、回到输入态」
  const sendAbortRef = useRef<AbortController | null>(null)
  const [sendElapsedTick, setSendElapsedTick] = useState(0)
  useEffect(() => {
    if (sendState === "idle") {
      setSendElapsedTick(0)
      return
    }
    const timer = window.setInterval(() => setSendElapsedTick((t) => t + 1), 1000)
    return () => window.clearInterval(timer)
  }, [sendState])
  const cancelSend = useCallback(() => {
    if (!sendAbortRef.current) return
    sendAbortRef.current.abort()
  }, [])
  // A2-9：会话列表加载态 + 最近一次提问（失败重试用）
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const lastUserTextRef = useRef("")

  const [deleteTargetSession, setDeleteTargetSession] = useState<SessionRow | null>(null)

  // 轮次 B：全局搜索深链 ?q= 消费——预填输入框并聚焦（不自动发送，费用与意图由用户确认）。
  // 悬浮迷你窗（floatMode）不消费，避免与页面版重复预填。
  const qPrefillHandledRef = useRef(false)
  useEffect(() => {
    if (floatMode || qPrefillHandledRef.current) return
    const q = new URLSearchParams(loc.search).get("q")
    if (!q) return
    qPrefillHandledRef.current = true
    setDraftInput(q)
    setComposerFocusTick((t) => t + 1)
  }, [loc.search, floatMode])

  // B1：挂载时恢复「尚未建会话」桶里的失败消息（首问即失败场景），刷新后仍可见可重试。
  // 整页模式先把悬浮窗 pending 桶单向并入整页 pending 桶（float 侧不动），float 失败在整页也可见可重试。
  const pendingRestoredRef = useRef(false)
  useEffect(() => {
    if (!userId || pendingRestoredRef.current) return
    pendingRestoredRef.current = true
    if (activeSessionIdRef.current) return
    if (!floatMode) mergeFloatPendingIntoPending(userId)
    const entries = readFailedMsgs(userId, failedPendingBucket(floatMode))
    if (entries.length === 0) return
    setConvMessages(failedMsgsToChatMsgs(entries))
    lastUserTextRef.current = entries[entries.length - 1].userText ?? ""
  }, [userId, floatMode])

  // ------------------------------ 记忆 ------------------------------
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([])
  const memoryRowsRef = useRef<MemoryRow[]>([])
  useEffect(() => {
    memoryRowsRef.current = memoryRows
  }, [memoryRows])

  // ------------------------------ 技能 ------------------------------
  const [customSkills, setCustomSkills] = useState<SkillRow[]>([])
  const [skillFill, setSkillFill] = useState<SkillFillState | null>(null)

  // ------------------------------ 左栏页签 ------------------------------
  const [leftTab, setLeftTab] = useState<"sessions" | "memory" | "skills">("sessions")

  // ------------------------------ 初始加载 ------------------------------
  const loadAll = useCallback(async (uid: string) => {
    const enc = encodeURIComponent(uid)
    setSessionsLoading(true)
    const [sessRes, memRes, skillRes] = await Promise.all([
      assistantApiFetch<AssistantListResponse<SessionRow>>(`/api/assistant_sessions?rh_user_id=${enc}&page=1&perPage=${SESSIONS_PER_PAGE}`).catch(() => null),
      assistantApiFetch<AssistantListResponse<MemoryRow>>(`/api/assistant_memory?rh_user_id=${enc}&page=1&perPage=200`).catch(() => null),
      assistantApiFetch<AssistantListResponse<SkillRow>>(`/api/assistant_skills?rh_user_id=${enc}&page=1&perPage=100`).catch(() => null),
    ])
    const sessItems = sessRes?.items ?? []
    sessionsPageRef.current = 1
    setSessions(sortSessions(sessItems))
    setSessionsHasMore(sessItems.length === SESSIONS_PER_PAGE)
    setMemoryRows(memRes?.items ?? [])
    setCustomSkills(skillRes?.items ?? [])
    setSessionsLoading(false)
  }, [])

  // B6：加载更多会话（满页判定 hasMore；追加按 id 去重后整体重排——置顶优先+时间倒序与首屏一致）
  const loadMoreSessions = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid || sessionsLoadingMore) return
    setSessionsLoadingMore(true)
    const nextPage = sessionsPageRef.current + 1
    try {
      const data = await assistantApiFetch<AssistantListResponse<SessionRow>>(
        `/api/assistant_sessions?rh_user_id=${encodeURIComponent(uid)}&page=${nextPage}&perPage=${SESSIONS_PER_PAGE}`,
      )
      const items = data.items ?? []
      sessionsPageRef.current = nextPage
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id))
        return sortSessions([...prev, ...items.filter((it) => !seen.has(it.id))])
      })
      setSessionsHasMore(items.length === SESSIONS_PER_PAGE)
    } catch {
      toast.error("加载更多会话失败，请稍后重试")
    } finally {
      setSessionsLoadingMore(false)
    }
  }, [sessionsLoadingMore])

  useEffect(() => {
    if (!userId) {
      setSessions([])
      setMemoryRows([])
      setCustomSkills([])
      return
    }
    void loadAll(userId)
  }, [userId, loadAll])

  // ------------------------------ 会话操作 ------------------------------
  const selectSession = useCallback(async (sessionId: string) => {
    const uid = userIdRef.current
    if (!uid || sendingRef.current) return
    // B1：建会话请求在飞时也允许切换（切换即放弃绑定），递增意图序号让落定闭包不再抢焦点
    sessionIntentSeqRef.current += 1
    setActiveSessionId(sessionId)
    activeSessionIdRef.current = sessionId
    try {
      const data = await assistantApiFetch<AssistantListResponse<MessageRow>>(
        `/api/assistant_messages?rh_user_id=${encodeURIComponent(uid)}&session_id=${encodeURIComponent(sessionId)}&page=1&perPage=200`,
      )
      // B1：后端成功消息与本地持久化的失败消息按时间合并显示（失败条目带用户提问气泡与重试上下文）
      type TimedMsg = ChatMsg & { atMs: number }
      const backendMsgs: TimedMsg[] = (data.items ?? []).map((m) => ({
        id: m.id,
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
        atMs: Date.parse(m.created) || 0,
      }))
      const storedFailed = readFailedMsgs(uid, sessionId)
      const restoredMsgs: TimedMsg[] = []
      for (const e of storedFailed) {
        if (e.userText) restoredMsgs.push({ id: `${e.id}_user`, role: "user", content: e.userText, atMs: e.at - 1 })
        restoredMsgs.push({ id: e.id, role: "assistant", content: e.content, failed: true, atMs: e.at })
      }
      const msgs: ChatMsg[] = [...backendMsgs, ...restoredMsgs]
        .sort((a, b) => a.atMs - b.atMs)
        .map((m) => ({ id: m.id, role: m.role, content: m.content, ...(m.failed ? { failed: true } : {}) }))
      setConvMessages(msgs)
      convMessagesRef.current = msgs
      // B1：恢复最近一次失败提问作为重试上下文，刷新后仍可重发
      if (storedFailed.length) lastUserTextRef.current = storedFailed[storedFailed.length - 1].userText ?? ""
    } catch {
      toast.error("会话消息加载失败，请稍后重试")
    }
  }, [])

  const newSession = useCallback(() => {
    if (sendingRef.current) return
    // B1：显式新建会话同样使在飞建会话的绑定意图作废
    sessionIntentSeqRef.current += 1
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    // B1：显式开新会话时同步释放建会话互斥，避免复用上一会话的已决 Promise
    sessionCreatingRef.current = null
    setConvMessages([])
    convMessagesRef.current = []
    // B1：清空会话同步清——pending 桶失败消息不随刷新复活
    const uid = userIdRef.current
    if (uid) clearFailedMsgs(uid, failedPendingBucket(floatMode))
  }, [floatMode])

  const togglePinSession = useCallback(async (row: SessionRow) => {
    try {
      const updated = await assistantApiFetch<SessionRow>(`/api/assistant_sessions/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !row.pinned }),
      })
      setSessions((prev) => sortSessions(prev.map((s) => (s.id === updated.id ? updated : s))))
    } catch {
      toast.error("置顶操作失败，请稍后重试")
    }
  }, [])

  const requestDeleteSession = useCallback((row: SessionRow) => setDeleteTargetSession(row), [])
  const cancelDeleteSession = useCallback(() => setDeleteTargetSession(null), [])

  const confirmDeleteSession = useCallback(async () => {
    const target = deleteTargetSession
    const uid = userIdRef.current
    setDeleteTargetSession(null)
    if (!target || !uid) return
    try {
      const enc = encodeURIComponent(uid)
      const data = await assistantApiFetch<AssistantListResponse<MessageRow>>(
        `/api/assistant_messages?rh_user_id=${enc}&session_id=${encodeURIComponent(target.id)}&page=1&perPage=200`,
      ).catch(() => null)
      await Promise.all([
        assistantApiFetch(`/api/assistant_sessions/${target.id}`, { method: "DELETE" }),
        ...(data?.items ?? []).map((m) =>
          assistantApiFetch(`/api/assistant_messages/${m.id}`, { method: "DELETE" }).catch(() => undefined),
        ),
      ])
      // B1：删除会话同步清——该会话的失败消息不随刷新复活
      clearFailedMsgs(uid, target.id)
      setSessions((prev) => prev.filter((s) => s.id !== target.id))
      if (activeSessionIdRef.current === target.id) {
        setActiveSessionId(null)
        activeSessionIdRef.current = null
        setConvMessages([])
        convMessagesRef.current = []
      }
      toast.success("会话已删除")
    } catch {
      toast.error("删除失败，请稍后重试")
    }
  }, [deleteTargetSession])

  // ------------------------------ 记忆操作 ------------------------------
  const persistAutoMemories = useCallback(
    async (items: { group: MemoryGroup; content: string }[]) => {
      const uid = userIdRef.current
      if (!uid || items.length === 0) return
      const existing = new Set(
        memoryRowsRef.current.map((m) => memoryRowsDedupeKey(m.memory_group, m.content)),
      )
      const fresh = items.filter((m) => !existing.has(memoryRowsDedupeKey(m.group, m.content)))
      if (fresh.length === 0) return
      const created: MemoryRow[] = []
      for (const m of fresh.slice(0, 3)) {
        try {
          const row = await assistantApiFetch<MemoryRow>("/api/assistant_memory", {
            method: "POST",
            body: JSON.stringify({ rh_user_id: uid, memory_group: m.group, content: m.content, source: "auto" }),
          })
          created.push(row)
        } catch {
          /* 单条记忆写入失败静默跳过 */
        }
      }
      if (created.length) setMemoryRows((prev) => [...created, ...prev])
    },
    [],
  )

  const addMemory = useCallback(
    async (group: MemoryGroup, content: string) => {
      const uid = userIdRef.current
      if (!requireLogin()) return false
      const text = content.trim()
      if (!text) {
        toast.error("记忆内容不能为空")
        return false
      }
      if (
        memoryRowsRef.current.some(
          (m) => memoryRowsDedupeKey(m.memory_group, m.content) === memoryRowsDedupeKey(group, text),
        )
      ) {
        toast.info("这条记忆已经存在")
        return false
      }
      try {
        const row = await assistantApiFetch<MemoryRow>("/api/assistant_memory", {
          method: "POST",
          body: JSON.stringify({ rh_user_id: uid, memory_group: group, content: text, source: "manual" }),
        })
        setMemoryRows((prev) => [row, ...prev])
        toast.success("已添加记忆")
        return true
      } catch {
        toast.error("记忆保存失败，请稍后重试")
        return false
      }
    },
    [requireLogin],
  )

  const updateMemory = useCallback(async (row: MemoryRow, group: MemoryGroup, content: string) => {
    const text = content.trim()
    if (!text) {
      toast.error("记忆内容不能为空")
      return false
    }
    try {
      const updated = await assistantApiFetch<MemoryRow>(`/api/assistant_memory/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ memory_group: group, content: text, source: "manual" }),
      })
      setMemoryRows((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      toast.success("记忆已更新")
      return true
    } catch {
      toast.error("记忆更新失败，请稍后重试")
      return false
    }
  }, [])

  const deleteMemory = useCallback(async (row: MemoryRow) => {
    try {
      await assistantApiFetch(`/api/assistant_memory/${row.id}`, { method: "DELETE" })
      setMemoryRows((prev) => prev.filter((m) => m.id !== row.id))
      toast.success("记忆已删除")
    } catch {
      toast.error("记忆删除失败，请稍后重试")
    }
  }, [])

  // ------------------------------ 自定义技能操作 ------------------------------
  const addCustomSkill = useCallback(
    async (skillName: string, template: string, scopes: string[], description: string) => {
      const uid = userIdRef.current
      if (!requireLogin()) return false
      if (!skillName.trim() || !template.trim()) {
        toast.error("请填写指令名称和提示词模板")
        return false
      }
      try {
        const row = await assistantApiFetch<SkillRow>("/api/assistant_skills", {
          method: "POST",
          body: JSON.stringify({
            rh_user_id: uid,
            skill_name: skillName.trim(),
            prompt_template: template.trim(),
            applicable_scopes: scopes.length ? scopes : ["assistant"],
            description: description.trim(),
          }),
        })
        setCustomSkills((prev) => [row, ...prev])
        toast.success("自定义指令已添加")
        return true
      } catch {
        toast.error("指令保存失败，请稍后重试")
        return false
      }
    },
    [requireLogin],
  )

  const updateCustomSkill = useCallback(async (row: SkillRow, skillName: string, template: string, scopes: string[], description: string) => {
    if (!skillName.trim() || !template.trim()) {
      toast.error("请填写指令名称和提示词模板")
      return false
    }
    try {
      const updated = await assistantApiFetch<SkillRow>(`/api/assistant_skills/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          skill_name: skillName.trim(),
          prompt_template: template.trim(),
          applicable_scopes: scopes.length ? scopes : ["assistant"],
          description: description.trim(),
        }),
      })
      setCustomSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      toast.success("自定义指令已更新")
      return true
    } catch {
      toast.error("指令更新失败，请稍后重试")
      return false
    }
  }, [])

  const deleteCustomSkill = useCallback(async (row: SkillRow) => {
    try {
      await assistantApiFetch(`/api/assistant_skills/${row.id}`, { method: "DELETE" })
      setCustomSkills((prev) => prev.filter((s) => s.id !== row.id))
      toast.success("自定义指令已删除")
    } catch {
      toast.error("指令删除失败，请稍后重试")
    }
  }, [])

  // ------------------------------ 一轮对话（含取数回填 + 记忆抽取） ------------------------------
  // B1：建会话互斥——快速连发两轮时第一轮 persistTurn 尚未回写 sessionId，
  // 第二轮复用同一个建会话 Promise，避免并发建出两个会话导致消息分裂
  const sessionCreatingRef = useRef<Promise<string> | null>(null)

  const persistTurn = useCallback(
    async (uid: string, userText: string, aiText: string) => {
      try {
        let sid = activeSessionIdRef.current
        if (!sid) {
          if (!sessionCreatingRef.current) {
            // B1：捕获发起时的意图快照——落定时序号已变（用户切走/新建会话）则只完成持久化，
            // 消息仍写入新建的会话行，但不抢 UI 焦点不切换 activeSessionId
            const intentSeq = sessionIntentSeqRef.current
            const creating = (async () => {
              const row = await assistantApiFetch<SessionRow>("/api/assistant_sessions", {
                method: "POST",
                body: JSON.stringify({
                  rh_user_id: uid,
                  session_title: sessionTitle(userText, floatMode),
                  pinned: false,
                  context_path: contextPathRef.current ?? "",
                }),
              })
              setSessions((prev) => sortSessions([row, ...prev]))
              // B1：会话已建立，pending 桶里的失败消息迁入会话桶（重选会话时仍可见可重试）
              migrateFailedMsgs(uid, failedPendingBucket(floatMode), row.id)
              if (intentSeq === sessionIntentSeqRef.current && activeSessionIdRef.current === null) {
                activeSessionIdRef.current = row.id
                setActiveSessionId(row.id)
              }
              return row.id
            })()
            sessionCreatingRef.current = creating
            // 建会话失败时释放互斥：rejected Promise 被本 catch 消费后置空 ref，
            // 下一轮 persistTurn 见 ref 为 null 重新发起建会话，不会再 await 已失败的旧 Promise
            // （同轮在飞的第二轮 await 该 Promise 会 reject 并由外层 catch 静默放弃本轮持久化，属既有语义）
            creating.catch(() => {
              if (sessionCreatingRef.current === creating) sessionCreatingRef.current = null
            })
          }
          sid = await sessionCreatingRef.current
          // B1：本轮已成功，迁入后同会话内相同提问的旧失败条目同步清掉（被替代的提问不再复现）
          removeFailedMsgsByUserText(uid, sid, userText)
        }
        await Promise.all([
          assistantApiFetch("/api/assistant_messages", {
            method: "POST",
            body: JSON.stringify({ rh_user_id: uid, session_id: sid, role: "user", content: userText }),
          }),
          assistantApiFetch("/api/assistant_messages", {
            method: "POST",
            body: JSON.stringify({ rh_user_id: uid, session_id: sid, role: "assistant", content: aiText }),
          }),
        ])
      } catch {
        /* 持久化失败不阻断本轮对话 */
      }
    },
    [floatMode],
  )

  const executeTurn = useCallback(
    async (userText: string) => {
      const uid = userIdRef.current
      if (!uid) return
      sendingRef.current = true
      setSendState("sending")
      lastUserTextRef.current = userText
      // p1-ux：本轮独立的取消句柄；finally 里清 null 避免二次 cancel 打到下轮
      const ctrl = new AbortController()
      sendAbortRef.current = ctrl
      const working: LlmMessage[] = convMessagesRef.current
        .filter((m) => !m.failed)
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }))
      let fetchCount = 0
      let finalDisplay: string
      let finalMemories: { group: MemoryGroup; content: string }[]
      try {
        for (;;) {
          if (ctrl.signal.aborted) throw new Error("user_cancelled")
          const systemPrompt = buildSystemPrompt(memoryRowsRef.current, contextLabelRef.current)
          const res = await chatViaGateway({
            modelRef: activeModelRefRef.current,
            messages: [{ role: "system", content: systemPrompt }, ...working],
            page: "assistant",
            max_tokens: 4096,
            signal: ctrl.signal,
          })
          if (res.error === "user_cancelled" || ctrl.signal.aborted) {
            throw new Error("user_cancelled")
          }
          if (res.needsLogin) {
            setNeedsRhLogin(true)
            throw new Error("rh_login_required")
          }
          if (!res.ok || res.status !== "success") {
            // B2：裸 "failed" 兜底中文化，mapAssistantLlmError 对中文串直接透传
            throw new Error(res.error || "小智这轮回答失败了，请稍后重试")
          }
          const parsed = parseAssistantReply(res.text)
          if (parsed.fetchKeys.length > 0 && fetchCount < 2) {
            const key = parsed.fetchKeys[0]
            setSendState("fetching")
            setFetchBadge(DATA_SOURCES[key].badge)
            working.push({ role: "assistant", content: res.text })
            const digest = await fetchSiteData(key, uid, userText)
            // 轮次 D-3：弹药库 high 置信直答——跳过后续 LLM 调用，零费用收尾
            if (digest.startsWith(KB_QA_DIRECT_PREFIX)) {
              finalDisplay = digest.slice(KB_QA_DIRECT_PREFIX.length).trim()
              finalMemories = []
              setFetchBadge("")
              setSendState("sending")
              break
            }
            working.push({
              role: "user",
              content: `[站内数据回填] 数据源：${DATA_SOURCES[key].label}\n${digest}\n请基于以上真实数据继续回答用户的问题。如仍需其他数据可再发一条取数指令（本轮最多 2 次），否则直接给出最终回答，并按记忆抽取协议在末尾附记忆块。`,
            })
            fetchCount += 1
            setFetchBadge("")
            setSendState("sending")
            continue
          }
          finalDisplay = parsed.display || "这轮小智没有返回有效内容，请换个问法或稍后重试。"
          finalMemories = parsed.memories
          break
        }
        const aiMsg: ChatMsg = { id: localId("ai"), role: "assistant", content: finalDisplay }
        setConvMessages((prev) => [...prev, aiMsg])
        convMessagesRef.current = [...convMessagesRef.current, aiMsg]
        if (finalMemories.length) void persistAutoMemories(finalMemories)
        // B1：成功后清除当前桶内同 userText 的旧失败条目（忽略失败继续问、重试成功后旧红泡不再复现；
        // persistTurn 建新会话迁移后的清理由 persistTurn 内部接力）
        removeFailedMsgsByUserText(uid, activeSessionIdRef.current ?? failedPendingBucket(floatMode), userText)
        void persistTurn(uid, userText, finalDisplay)
      } catch (err) {
        const raw = err instanceof Error ? err.message : undefined
        // p1-ux：用户主动取消 — 静默收尾，不 toast、不入失败桶、不占重试位；
        // 已在存储层的旧失败条目也不动，保留其原时间线位置
        if (raw === "user_cancelled") {
          // 什么都不做，让 finally 复位状态
        } else {
          const message = mapAssistantLlmError(raw)
          toast.error(message)
          // A2-9：登录过期走登录横幅，其余失败在消息流里插入可重试的失败消息
          if (raw !== "rh_login_required") {
            const failMsg: ChatMsg = { id: localId("ai"), role: "assistant", content: message, failed: true }
            setConvMessages((prev) => [...prev, failMsg])
            convMessagesRef.current = [...convMessagesRef.current, failMsg]
            // B1：失败消息（错误文案 + 提问原文）按会话桶持久化到 localStorage，刷新后仍可见可重试
            appendFailedMsg(uid, activeSessionIdRef.current ?? failedPendingBucket(floatMode), {
              id: failMsg.id,
              userText,
              content: message,
              at: Date.now(),
            })
          }
        }
      } finally {
        setFetchBadge("")
        setSendState("idle")
        sendingRef.current = false
        sendAbortRef.current = null
      }
    },
    [persistAutoMemories, persistTurn, floatMode],
  )

  const sendMessage = useCallback(
    (text?: string, skillName?: string) => {
      const content = (text ?? draftInput).trim()
      if (!content || sendingRef.current) return
      if (!requireLogin()) return
      setDraftInput("")
      const userMsg: ChatMsg = { id: localId("me"), role: "user", content, skillName: skillName || undefined }
      setConvMessages((prev) => [...prev, userMsg])
      convMessagesRef.current = [...convMessagesRef.current, userMsg]
      costConfirm.runWithCostConfirm(() => {
        void executeTurn(content)
      }, costText)
    },
    [draftInput, requireLogin, costConfirm, costText, executeTurn],
  )

  // A2-9 + B1：失败消息重试——只移除被重试的那条（占位 + 配对用户气泡），
  // 其余失败条目保留在时间线与存储里，由 TTL / 单条消除治理
  const retryLast = useCallback(() => {
    if (sendingRef.current) return
    const msgs = convMessagesRef.current
    let retriedId = ""
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].failed) {
        retriedId = msgs[i].id
        break
      }
    }
    // 提问原文优先取该失败条目配对的用户气泡，找不到再退回最近一次提问
    const pairedUser = retriedId ? msgs.find((m) => m.id === `${retriedId}_user`) : undefined
    const text = (pairedUser?.content ?? lastUserTextRef.current).trim()
    if (!text) return
    if (!requireLogin()) return
    const removeIds = retriedId ? new Set([retriedId, `${retriedId}_user`]) : null
    const nextMsgs = removeIds ? msgs.filter((m) => !removeIds.has(m.id)) : msgs.filter((m) => !m.failed)
    setConvMessages(nextMsgs)
    convMessagesRef.current = nextMsgs
    // B1：存储只删被重试那条（若再次失败会重新写入），不再清整桶
    const uid = userIdRef.current
    if (uid && retriedId) removeFailedMsg(uid, retriedId)
    costConfirm.runWithCostConfirm(() => {
      void executeTurn(text)
    }, costText)
  }, [requireLogin, costConfirm, costText, executeTurn])

  // B1：失败气泡单条「×」消除——时间线与存储同步移除该条（含配对用户气泡）
  const dismissFailedMsg = useCallback((msgId: string) => {
    const removeIds = new Set([msgId, `${msgId}_user`])
    const nextMsgs = convMessagesRef.current.filter((m) => !removeIds.has(m.id))
    setConvMessages(nextMsgs)
    convMessagesRef.current = nextMsgs
    const uid = userIdRef.current
    if (uid) removeFailedMsg(uid, msgId)
  }, [])

  // ------------------------------ 技能调用 ------------------------------
  const invokeSkill = useCallback(
    (skillName: string, template: string) => {
      if (!requireLogin()) return
      const slots = extractTemplateSlots(template)
      if (slots.length > 0) {
        setSkillFill({ skillName, template, slots, values: {} })
        return
      }
      sendMessage(template)
    },
    [requireLogin, sendMessage],
  )

  const setSkillFillValue = useCallback((slot: string, value: string) => {
    setSkillFill((prev) => (prev ? { ...prev, values: { ...prev.values, [slot]: value } } : prev))
  }, [])

  const confirmSkillFill = useCallback(() => {
    const fill = skillFill
    if (!fill) return
    const missing = fill.slots.some((s) => !(fill.values[s] ?? "").trim())
    if (missing) {
      toast.error("请把空位都填一下再发送")
      return
    }
    setSkillFill(null)
    sendMessage(fillTemplate(fill.template, fill.values), fill.skillName)
  }, [skillFill, sendMessage])

  const cancelSkillFill = useCallback(() => setSkillFill(null), [])

  return {
    // 登录态
    userId,
    needsRhLogin,
    handleAccountChange,
    // 会话
    sessions,
    sessionsLoading,
    sessionsHasMore,
    sessionsLoadingMore,
    loadMoreSessions,
    activeSessionId,
    selectSession,
    newSession,
    togglePinSession,
    requestDeleteSession,
    deleteTargetSession,
    confirmDeleteSession,
    cancelDeleteSession,
    // 消息流
    convMessages,
    draftInput,
    setDraftInput,
    composerFocusTick,
    sendState,
    fetchBadge,
    sendMessage,
    retryLast,
    dismissFailedMsg,
    // p1-ux：本轮取消 + 已用秒数（供 ChatComposer/ChatStream 消费）
    cancelSend,
    sendElapsedTick,
    // 页面联动
    contextLabel,
    contextEnabled,
    closeContext,
    // 模型与费用
    modelOptions,
    selectedModelKey,
    setSelectedModelKey,
    costText,
    costConfirm,
    // 记忆
    memoryRows,
    addMemory,
    updateMemory,
    deleteMemory,
    // 技能
    customSkills,
    addCustomSkill,
    updateCustomSkill,
    deleteCustomSkill,
    invokeSkill,
    skillFill,
    setSkillFillValue,
    confirmSkillFill,
    cancelSkillFill,
    // 布局
    leftTab,
    setLeftTab,
    isFloatMode: floatMode,
  }
}
