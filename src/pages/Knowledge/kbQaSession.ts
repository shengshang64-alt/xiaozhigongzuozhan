/**
 * 知识库问答会话的**本地持久化**（纯函数 + 存储助手，零 React）。
 *
 * R4（整仓重构 · 巨型 hook 再拆一轮）从 `useKnowledge.ts` 搬出。搬出来的理由不是洁癖：
 * 这段逻辑是「刷新后问答还在」的唯一保障，而它有三处**静默失效**风险，混在 hook 的
 * useEffect 里根本测不到：
 *   ① 反序列化必须**逐字段校验**：sessionStorage 里的东西可能是上个版本写的、或被人手改过，
 *      脏数据直接塞进渲染会让问答面板整块白屏（role 不是 user/assistant、content 不是字符串）；
 *   ② 上限必须**硬截断**：会话不封顶会一直长（每轮问答两条消息），存到超配额时
 *      setItem 抛异常——旧实现吞掉异常，表现为「这轮问答刷新后没了」且毫无提示；
 *   ③ 清空必须**真的清存储**：只清内存的话，刷新后旧消息会「复活」，
 *      用户会以为清空没生效（这个 bug 本仓修过一次）。
 *
 * 所以这里把「读」「写」「清」都做成可单测的函数，hook 里只留 useEffect 的时序。
 */
import type { QaChatMsg, QaCitation } from "./useKnowledge"

/** sessionStorage 键前缀（按用户分桶：同一台机器多人用时不串会话） */
export const QA_SESSION_PREFIX = "kb_qa_session_"

/** 会话保留上限（条）。超出的丢弃最旧的——保留最近对话比保留全部更有用，也更省配额。 */
export const QA_SESSION_LIMIT = 50

/** 本地序号：给「恢复出来的、缺 id 的」消息补一个稳定且不重复的 id */
let localSeq = 0
function localId(prefix: string): string {
  localSeq += 1
  return `${prefix}_${Date.now()}_${localSeq}`
}

/**
 * 反序列化问答会话：**逐字段校验**，丢弃任何形状不对的条目。
 *
 * 不做「整个 JSON.parse 成功就信任」——那是白屏事故的标准成因。
 * 也不抛错：存储里的脏数据不该让整个问答面板挂掉。
 */
export function sanitizeQaMessages(raw: unknown): QaChatMsg[] {
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

/** 读回某用户的问答会话；无数据 / 存储不可用 / 脏数据一律返回空数组（绝不抛错）。 */
export function loadQaSession(userId: string | null | undefined): QaChatMsg[] {
  if (!userId) return []
  try {
    const raw = window.sessionStorage.getItem(`${QA_SESSION_PREFIX}${userId}`)
    if (!raw) return []
    return sanitizeQaMessages(JSON.parse(raw))
  } catch (err) {
    // 隐私模式 / 配额 / 脏 JSON：降级为「没有历史会话」，不影响本轮问答
    console.warn("知识库问答会话恢复失败", err)
    return []
  }
}

/** 落盘某用户的问答会话（超上限截断；空会话直接清键，避免留一条空数组）。 */
export function saveQaSession(userId: string | null | undefined, messages: QaChatMsg[]): void {
  if (!userId) return
  try {
    const key = `${QA_SESSION_PREFIX}${userId}`
    if (messages.length === 0) {
      window.sessionStorage.removeItem(key)
      return
    }
    window.sessionStorage.setItem(key, JSON.stringify(messages.slice(-QA_SESSION_LIMIT)))
  } catch (err) {
    // 超配额 / 隐私模式：静默降级（会话仍在内存里，本轮问答不受影响）
    console.warn("知识库问答会话持久化失败", err)
  }
}

/** 清空某用户的问答会话（内存清空时必须同时调它，否则刷新后旧消息会「复活」）。 */
export function clearQaSession(userId: string | null | undefined): void {
  if (!userId) return
  try {
    window.sessionStorage.removeItem(`${QA_SESSION_PREFIX}${userId}`)
  } catch (err) {
    console.warn("知识库问答会话存储清除失败", err)
  }
}
