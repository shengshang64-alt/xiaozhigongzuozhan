// R229(r219-kbqa-coldstart-perf)：QA 全文语料通道改走 getCachedVisibleDocs 共享缓存。
// 本文件锁定该复用成立所依赖的三条缓存契约——并发去重（同批只拉一次全量，冷启动不再
// 重复下载 300MB）、失效重取（变更后能拿到最新全量）、可见性过滤（只返回当前用户可见子集）。
// 这三条正是「QA 不再裸调 listKbDocs」的性能与正确性前提，属回归护栏。
import { describe, expect, it, vi, beforeEach } from "vitest"

const { listKbDocsMock } = vi.hoisted(() => ({ listKbDocsMock: vi.fn() }))

vi.mock("./kbCore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kbCore")>()
  return { ...actual, listKbDocs: listKbDocsMock }
})

import { getCachedVisibleDocs, invalidateKbCache, isKbCacheWarm } from "./kbAssemble"
import type { KbDocRow } from "./kbCore"

function doc(over: Partial<KbDocRow> & { id: string; visibility: string; rh_user_id: string }): KbDocRow {
  return {
    title: over.id,
    folder_path: "x",
    content: "c",
    doc_format: "md",
    summary: "",
    keywords: [],
    source_file_name: `${over.id}.md`,
    uploader_name: "t",
    created: "2026-01-01 00:00:00.000Z",
    updated: "2026-01-01 00:00:00.000Z",
    ...over,
  } as KbDocRow
}

const ROWS: KbDocRow[] = [
  doc({ id: "team1", visibility: "team", rh_user_id: "u1" }),
  doc({ id: "mine", visibility: "personal", rh_user_id: "u1" }),
  doc({ id: "other", visibility: "personal", rh_user_id: "u2" }),
]

beforeEach(() => {
  listKbDocsMock.mockReset()
  listKbDocsMock.mockResolvedValue(ROWS.map((r) => ({ ...r })))
  // 模块级缓存跨用例残留，先失效保证每条用例从冷缓存起步
  invalidateKbCache()
})

describe("getCachedVisibleDocs · R229 共享缓存契约", () => {
  it("并发调用只拉一次全量（去重：冷启动不重复下载大语料）", async () => {
    const [a, b] = await Promise.all([getCachedVisibleDocs("u1"), getCachedVisibleDocs("u1")])
    expect(listKbDocsMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b) // 复用同一 promise → 同一数组引用
  })

  it("TTL 内二次调用命中缓存，不再发网络请求", async () => {
    await getCachedVisibleDocs("u1")
    expect(isKbCacheWarm("u1")).toBe(true)
    await getCachedVisibleDocs("u1")
    expect(listKbDocsMock).toHaveBeenCalledTimes(1)
  })

  it("invalidateKbCache 后重取最新全量（变更失效语义）", async () => {
    await getCachedVisibleDocs("u1")
    invalidateKbCache()
    await getCachedVisibleDocs("u1")
    expect(listKbDocsMock).toHaveBeenCalledTimes(2)
  })

  it("只返回当前用户可见子集：他人 personal 笔记被过滤掉", async () => {
    const visible = await getCachedVisibleDocs("u1")
    const ids = visible.map((d) => d.id)
    expect(ids).toContain("team1")
    expect(ids).toContain("mine")
    expect(ids).not.toContain("other")
  })

  it("拉取失败不留缓存，下次调用自动重试", async () => {
    listKbDocsMock.mockRejectedValueOnce(new Error("net"))
    await expect(getCachedVisibleDocs("u1")).rejects.toThrow()
    expect(isKbCacheWarm("u1")).toBe(false)
    await getCachedVisibleDocs("u1")
    expect(listKbDocsMock).toHaveBeenCalledTimes(2)
  })
})
