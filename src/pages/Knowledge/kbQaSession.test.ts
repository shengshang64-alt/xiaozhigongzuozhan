/** @vitest-environment jsdom */
/**
 * R4（整仓重构 · 巨型 hook 再拆一轮）**问答会话持久化回归网**。
 *
 * 这段逻辑从 `useKnowledge` 的 useEffect 里搬出来（原来混在 1800 行 hook 中，测不到）。
 * 它有三处**静默失效**，都是用户真的会撞上的：
 *
 *   ① 脏数据白屏：sessionStorage 里的内容可能是上个版本写的、或被人手改过。
 *      只要 `role` 不是 user/assistant 或 `content` 不是字符串就整条丢弃——
 *      旧实现信任 JSON.parse 的结果，脏数据进渲染会让问答面板直接崩。
 *   ② 上限必须硬截断：会话不封顶会一直长（每轮两条），超配额时 setItem 抛异常。
 *      旧实现吞掉异常 → 表现为「这轮问答刷新后没了」且零提示。
 *   ③ 清空必须真清存储：只清内存的话刷新后旧消息「复活」，
 *      用户会以为「清空」按钮坏了（本仓修过一次这个 bug）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  QA_SESSION_LIMIT,
  QA_SESSION_PREFIX,
  clearQaSession,
  loadQaSession,
  sanitizeQaMessages,
  saveQaSession,
} from "./kbQaSession"
import type { QaChatMsg } from "./useKnowledge"

const msg = (over: Partial<QaChatMsg> = {}): QaChatMsg => ({
  id: over.id ?? "m1",
  role: over.role ?? "user",
  content: over.content ?? "问题",
  ...over,
})

beforeEach(() => {
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("sanitizeQaMessages：逐字段校验（脏数据不该让面板白屏）", () => {
  it("非数组一律空", () => {
    expect(sanitizeQaMessages(null)).toEqual([])
    expect(sanitizeQaMessages("x")).toEqual([])
    expect(sanitizeQaMessages({ a: 1 })).toEqual([])
  })

  it("role 不合法 / content 非字符串 / 空 content 全部丢弃", () => {
    const out = sanitizeQaMessages([
      { role: "system", content: "不该出现" },
      { role: "user", content: 123 },
      { role: "assistant", content: "" },
      null,
      "字符串",
      { role: "user", content: "保留我" },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe("保留我")
  })

  it("缺 id 的条目补一个 id（不能渲染出无 key 的列表项）", () => {
    const out = sanitizeQaMessages([{ role: "user", content: "无 id" }])
    expect(out[0].id).toBeTruthy()
    expect(typeof out[0].id).toBe("string")
  })

  it("非法 qaLevel 归一为 undefined（不把脏值透传给渲染层）", () => {
    const out = sanitizeQaMessages([
      { role: "assistant", content: "x", qaLevel: "高" },
      { role: "assistant", content: "y", qaLevel: "high" },
    ])
    expect(out[0].qaLevel).toBeUndefined()
    expect(out[1].qaLevel).toBe("high")
  })

  it("超出上限时保留**最近**的，丢弃最旧的", () => {
    const many = Array.from({ length: QA_SESSION_LIMIT + 10 }, (_, i) => ({
      role: "user",
      content: `第${i}条`,
    }))
    const out = sanitizeQaMessages(many)
    expect(out).toHaveLength(QA_SESSION_LIMIT)
    expect(out[out.length - 1].content).toBe(`第${QA_SESSION_LIMIT + 9}条`)
  })
})

describe("save / load / clear：按用户分桶，异常不连累问答", () => {
  it("写入后能原样读回", () => {
    const list = [msg({ id: "a", content: "问题一" }), msg({ id: "b", role: "assistant", content: "回答一" })]
    saveQaSession("u1", list)
    expect(loadQaSession("u1")).toEqual(list)
  })

  it("不同用户互不串会话（同机器多人用）", () => {
    saveQaSession("u1", [msg({ id: "a", content: "u1 的问题" })])
    saveQaSession("u2", [msg({ id: "b", content: "u2 的问题" })])
    expect(loadQaSession("u1")[0].content).toBe("u1 的问题")
    expect(loadQaSession("u2")[0].content).toBe("u2 的问题")
  })

  it("**清空必须真清存储**（只清内存的话刷新后会复活）", () => {
    saveQaSession("u1", [msg()])
    clearQaSession("u1")
    expect(window.sessionStorage.getItem(`${QA_SESSION_PREFIX}u1`)).toBeNull()
    expect(loadQaSession("u1")).toEqual([])
  })

  it("空会话直接删键，不留一条空数组", () => {
    saveQaSession("u1", [msg()])
    saveQaSession("u1", [])
    expect(window.sessionStorage.getItem(`${QA_SESSION_PREFIX}u1`)).toBeNull()
  })

  it("未登录（空 userId）读写都安全、不落任何键", () => {
    saveQaSession(null, [msg()])
    expect(loadQaSession(null)).toEqual([])
    clearQaSession(undefined)
    expect(window.sessionStorage.length).toBe(0)
  })

  it("存储里是坏 JSON：读回空数组而不是抛错", () => {
    window.sessionStorage.setItem(`${QA_SESSION_PREFIX}u1`, "{不是 JSON")
    expect(() => loadQaSession("u1")).not.toThrow()
    expect(loadQaSession("u1")).toEqual([])
  })

  it("超配额（setItem 抛错）时静默降级，不把异常抛给页面", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(() => saveQaSession("u1", [msg()])).not.toThrow()
  })

  it("上限在写入侧也生效（不只是读取侧）", () => {
    const many = Array.from({ length: QA_SESSION_LIMIT + 5 }, (_, i) => msg({ id: `m${i}`, content: `第${i}条` }))
    saveQaSession("u1", many)
    const raw = JSON.parse(window.sessionStorage.getItem(`${QA_SESSION_PREFIX}u1`) ?? "[]") as unknown[]
    expect(raw).toHaveLength(QA_SESSION_LIMIT)
  })
})
