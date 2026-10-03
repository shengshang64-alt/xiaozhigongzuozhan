// R104 回归：kb_docs 变更事件广播 → 共享组装缓存即时失效。
// 背景：invalidateKbCache 文档写明「入库/删除/编辑后调用」但曾全项目零调用，
// 标书/方案组装用的 getCachedVisibleDocs 在知识库变更后最长 5 分钟读旧语料。
// 本测试锁定两层：①kbCore 三变更函数成功即广播、失败不广播；②kbAssemble
// 已注册监听，端到端保证「变更后下一次组装重新拉全库」。
import { afterEach, describe, expect, it, vi } from "vitest"

import { createKbDoc, deleteKbDoc, onKbMutation, updateKbDoc } from "@/lib/kbCore"
import { getCachedVisibleDocs } from "@/lib/kbAssemble"

const BASE_DOC = {
  id: "d1",
  rh_user_id: "u1",
  title: "数据治理方案",
  folder_path: "售前知识库",
  content: "数据治理平台建设内容",
  doc_format: "md",
  visibility: "team",
  summary: "",
  keywords: [] as string[],
  source_file_name: "d1.md",
  uploader_name: "test",
  created: "2026-01-01 00:00:00",
  updated: "2026-01-01 00:00:00",
}

/** createKbDoc 入参形态（无 id/时间戳，由服务端签发） */
const CREATE_BODY = {
  rh_user_id: "u1",
  title: "数据治理方案",
  folder_path: "售前知识库",
  content: "数据治理平台建设内容",
  doc_format: "md",
  visibility: "team",
  summary: "",
  keywords: [] as string[],
  source_file_name: "d1.md",
  uploader_name: "test",
}

/** 最小 fetch 桩：GET list → 一页不满即收敛；POST/PATCH/DELETE → 成功回显 */
function stubFetch() {
  let listCalls = 0
  const fn = vi.fn(async (_input: string, init?: { method?: string }) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (method === "GET") {
      listCalls += 1
      return { ok: true, status: 200, json: async () => ({ items: [{ ...BASE_DOC }], perPage: 200 }) }
    }
    return { ok: true, status: 200, json: async () => ({ ...BASE_DOC }) }
  })
  vi.stubGlobal("fetch", fn)
  return {
    fn,
    get listCalls() {
      return listCalls
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("kbCore 变更广播（R104）", () => {
  it("create/update/delete 成功后各通知一次监听", async () => {
    stubFetch()
    const spy = vi.fn()
    const off = onKbMutation(spy)
    try {
      await createKbDoc(CREATE_BODY)
      expect(spy).toHaveBeenCalledTimes(1)
      await updateKbDoc("d1", { title: "改名" })
      expect(spy).toHaveBeenCalledTimes(2)
      await deleteKbDoc("d1")
      expect(spy).toHaveBeenCalledTimes(3)
    } finally {
      off()
    }
  })

  it("取消函数生效：off 之后不再收到通知", async () => {
    stubFetch()
    const spy = vi.fn()
    onKbMutation(spy)()
    await deleteKbDoc("d1")
    expect(spy).not.toHaveBeenCalled()
  })

  it("请求失败（非 2xx）不广播，避免把未生效的变更当已变更", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    const spy = vi.fn()
    const off = onKbMutation(spy)
    try {
      await expect(deleteKbDoc("d1")).rejects.toThrow()
      await expect(updateKbDoc("d1", { title: "x" })).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })
})

describe("kbAssemble 缓存联动（端到端）", () => {
  it("组装缓存 TTL 内复用；知识库一变更新，下一次组装重新拉全库", async () => {
    const stub = stubFetch()
    const before = stub.listCalls
    const docs = await getCachedVisibleDocs("u1")
    expect(docs.length).toBeGreaterThan(0)
    const afterFirst = stub.listCalls
    expect(afterFirst).toBeGreaterThan(before)
    // 第二次组装：TTL 内命中缓存，不再拉库
    await getCachedVisibleDocs("u1")
    expect(stub.listCalls).toBe(afterFirst)
    // 知识库入库（走 kbCore 唯一变更入口）→ 广播失效
    await createKbDoc({ ...CREATE_BODY, title: "新沉淀的方案素材" })
    // 第三次组装：缓存已被监听失效，重新拉全库（变更即时可见，不等 5 分钟）
    await getCachedVisibleDocs("u1")
    expect(stub.listCalls).toBeGreaterThan(afterFirst)
  })
})
