import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// R304(r303-kb-cache-bypass-sites) 行为契约：助手取数与竞品事实聚合两条通道收敛到
// kbAssemble 共享缓存之后，用 fetch 桩驱动真实的 kbCore + kbAssemble（不是把缓存本身 mock 掉，
// mock 掉就只能证明「调了个函数」，证不到缓存语义）。钉住四件事：
//   1) 跨通道共用一次全库下载——旧的各拉各会按通道数翻倍（真实规模 35 页/次）；
//   2) 可见性口径为「团队库 + 本人个人文档」，他人个人笔记不再被喂进 AI 原文；
//   3) 本地入库经 onKbMutation 即时失效，下一次取数就能看到新文档（旧竞品缓存要等自己的 TTL）；
//   4) 取数失败仍按各通道原契约降级（助手回中文提示、竞品回空数组），不崩。
// ---------------------------------------------------------------------------

const BASE = "http://pb.test"
const UID = "u1"

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => BASE }))
vi.mock("@/lib/rhLogin", () => ({
  vibexAuthHeaders: () => ({ "X-Rh-User-Id": UID }),
  decodeRhToken: () => ({ sub: UID, nickName: "测试员" }),
}))

import { createKbDoc } from "@/lib/kbCore"
import { getCachedVisibleDocs, invalidateKbCache, isKbCacheWarm } from "@/lib/kbAssemble"
import { fetchSiteData } from "@/lib/assistantCore"
import { buildKbEvidence } from "@/pages/Competitors/competitorEvidence"

type Seed = {
  id: string
  title: string
  content: string
  rh_user_id: string
  visibility: string
}

const SEEDS: Seed[] = [
  { id: "team1", title: "卫宁健康数据治理方案", content: "本方案建设数据治理平台，卫宁健康为存量厂商", rh_user_id: "other", visibility: "team" },
  { id: "mine", title: "我的替换评估笔记", content: "卫宁健康替换为自家平台的评估", rh_user_id: UID, visibility: "personal" },
  { id: "other-personal", title: "他人内部报价", content: "卫宁健康内部报价 13800138000", rh_user_id: "other", visibility: "personal" },
]

let seeds: Seed[] = [...SEEDS]
let listCalls = 0
let failList = false

function toRow(s: Seed) {
  return {
    ...s,
    doc_format: "text",
    folder_path: "售前知识库",
    doc_category: "技术方案",
    ai_context_mode: "original",
    summary: "",
    keywords: [] as string[],
    source_file_name: "",
    uploader_name: "t",
    created: "2026-01-01 00:00:00",
    updated: "2026-01-01 00:00:00",
  }
}

function stubNetwork() {
  seeds = [...SEEDS]
  listCalls = 0
  failList = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = String(input)
      const path = url.split("?")[0]
      const method = (init?.method ?? "GET").toUpperCase()
      if (path.endsWith("/api/kb_docs") && method === "GET") {
        if (failList) return { ok: false, status: 500, json: async () => ({}) }
        listCalls += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: seeds.map(toRow), perPage: 200, totalItems: seeds.length }),
        }
      }
      if (path.endsWith("/api/kb_docs") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        const row = toRow({
          id: "new1",
          title: String(body.title ?? "新文档"),
          content: String(body.content ?? ""),
          rh_user_id: String(body.rh_user_id ?? UID),
          visibility: String(body.visibility ?? "personal"),
        })
        seeds = [...seeds, row]
        return { ok: true, status: 200, json: async () => row }
      }
      // kb_qa_pairs 等其它 list 路由：一页不满即收敛
      return { ok: true, status: 200, json: async () => ({ items: [], perPage: 200 }) }
    }),
  )
}

beforeEach(() => {
  invalidateKbCache()
  stubNetwork()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("R304 全库语料共享缓存跨通道契约", () => {
  it("助手取数 + 竞品证据 + 直接调用共用同一次全库下载", async () => {
    const text = await fetchSiteData("kb_docs", UID, "卫宁健康 数据治理")
    expect(text).toContain("卫宁健康数据治理方案")
    expect(listCalls).toBe(1)
    expect(isKbCacheWarm(UID)).toBe(true)

    const ev = await buildKbEvidence(["卫宁健康"])
    expect(ev.length).toBeGreaterThan(0)
    const docs = await getCachedVisibleDocs(UID)
    expect(docs).toHaveLength(2)
    // 三条通道共用一次下载：改回各拉各时这里会跳到 3 次以上
    expect(listCalls).toBe(1)
  })

  it("他人个人文档不再被喂进竞品 AI 证据（与方案/标书/问答同可见性口径）", async () => {
    const ev = await buildKbEvidence(["卫宁健康", "内部报价"])
    expect(ev.some((e) => e.docId === "other-personal")).toBe(false)
    expect(ev.some((e) => e.docId === "team1" || e.docId === "mine")).toBe(true)
  })

  it("本地入库经 onKbMutation 即时失效，下一次取数就看到新文档", async () => {
    await getCachedVisibleDocs(UID)
    expect(listCalls).toBe(1)
    await createKbDoc({
      rh_user_id: UID,
      title: "数据治理新规范",
      folder_path: "售前知识库",
      content: "卫宁健康新证据",
      doc_format: "text",
      visibility: "personal",
      summary: "",
      keywords: [],
      source_file_name: "",
      uploader_name: "t",
    })
    const docs = await getCachedVisibleDocs(UID)
    expect(listCalls).toBe(2)
    expect(docs.some((d) => d.title === "数据治理新规范")).toBe(true)
  })

  it("取数失败按各通道原契约降级：助手回中文提示、竞品回空数组", async () => {
    failList = true
    const text = await fetchSiteData("kb_docs", UID, "卫宁健康")
    expect(text).toContain("暂时读取失败")
    expect(await buildKbEvidence(["卫宁健康"])).toEqual([])
    // 失败不留坏缓存，下一次调用会重新取
    expect(isKbCacheWarm(UID)).toBe(false)
    failList = false
    expect(await getCachedVisibleDocs(UID)).toHaveLength(2)
  })
})
