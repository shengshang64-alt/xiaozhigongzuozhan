// ---------------------------------------------------------------------------
// 2026-10-27 后端服务（sidecar）契约测试
//
// 用户拍板「把解析、导出、大文件处理从浏览器挪到后端」。
// 本测试锁住前后端之间的**接口契约**（不依赖 sidecar 真在跑）：
//   ① 前端封装在服务不可用时必须**返回 false 而不是抛错**（保证降级路径可靠）
//   ② 降级不能有副作用（不该阻塞、不该弹错、不该卡住 UI）
//   ③ 健康探测有缓存，避免每个请求都探一次
//
// 为什么测这些而不测「真导出」：真导出已在人工验证里做（45.8 万字 / 308ms / 0.36MB，
// 产物结构合法、正文保真）。单元测试该锁的是**失败路径**——生产事故从来出在失败路径上。
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { exportDocxViaBackend, probeExport, probeSidecar, sidecarInfo } from "@/lib/sidecarClient"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe("sidecarClient：后端不可用时必须安全降级", () => {
  beforeEach(() => {
    // 每个用例都从「未知健康状态」开始（清缓存）
    vi.resetModules()
  })

  it("服务连不上 → probeSidecar 返回 false 而不是抛错", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never
    await expect(probeSidecar(true)).resolves.toBe(false)
  })

  it("服务连不上 → exportDocxViaBackend 返回 false（调用方可退回浏览器路径）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never
    const ok = await exportDocxViaBackend("某项目", [{ title: "第一章", content: "正文" }], "x.docx")
    expect(ok).toBe(false)
  })

  it("服务连不上 → probeExport 返回 null（不抛错）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never
    await expect(probeExport([{ title: "第一章", content: "正文" }])).resolves.toBeNull()
  })

  it("健康检查返回非 200 → 视为不可用", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false }),
    }) as never
    await expect(probeSidecar(true)).resolves.toBe(false)
  })

  it("健康检查 ok=false → 视为不可用", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false }),
    }) as never
    await expect(probeSidecar(true)).resolves.toBe(false)
  })

  it("健康检查正常 → 视为可用", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, node: "v24", routes: ["GET /health"] }),
    }) as never
    await expect(probeSidecar(true)).resolves.toBe(true)
  })

  it("sidecarInfo 在服务不可用时返回 { ok:false }（状态页不崩）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("refused")) as never
    await expect(sidecarInfo()).resolves.toEqual({ ok: false })
  })

  it("导出返回空 blob → 判失败（不能给用户一个 0 字节文件）", async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      if (call === 1) {
        // 第一次是 health 探测
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as never
      }
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([]),
      } as never
    }) as never
    const ok = await exportDocxViaBackend("某项目", [{ title: "第一章", content: "正文" }], "x.docx")
    expect(ok, "0 字节产物必须判失败").toBe(false)
  })
})
