// ---------------------------------------------------------------------------
// 内置公司模板：加载与降级（2026-11-05）
//
// 核心约束（这条是真会被踩到的）：模板 4.93 MB > localStorage 上限 3 MB，
// 所以**不能**沿用「用户上传模板 → base64 塞 localStorage」的通道，
// 否则 encodeTemplateBytes 返回 null、母版保真被静默关闭。
// 本文件锁定：选内置模板时走 fetch + 内存缓存，且失败必须如实报错、不许假装成功。
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BUILTIN_DECK_TEMPLATES,
  __clearBuiltinTemplateCache,
  findBuiltinTemplate,
  loadBuiltinTemplateBytes,
} from "./builtinTemplates"

/** 造一个最小合法 pptx 魔数（PK\x03\x04 + 任意内容） */
function fakePptx(n = 64): Uint8Array {
  const b = new Uint8Array(n)
  b[0] = 0x50
  b[1] = 0x4b
  b[2] = 0x03
  b[3] = 0x04
  return b
}

afterEach(() => {
  __clearBuiltinTemplateCache()
  vi.unstubAllGlobals()
})

describe("内置模板清单", () => {
  it("提供了智业浅色母版，且路径指向 public 下的真实文件", () => {
    const t = findBuiltinTemplate("zoe-light-internal")
    expect(t).not.toBeNull()
    expect(t!.label).toContain("智业")
    expect(t!.path).toBe("/ppt-templates/zoe-light-internal.pptx")
    expect(t!.layouts).toContain("封面")
    expect(t!.layouts).toContain("内页1")
    expect(t!.layouts).toContain("封底")
  })

  it("未知 key 返回 null（不抛错）", () => {
    expect(findBuiltinTemplate("nope")).toBeNull()
    expect(findBuiltinTemplate(null)).toBeNull()
    expect(findBuiltinTemplate(undefined)).toBeNull()
  })

  it("主题令牌是 6 位 hex（导出层直接拼 #，非法值会渲染成黑块）", () => {
    for (const t of BUILTIN_DECK_TEMPLATES) {
      expect(t.theme.accents.length).toBeGreaterThan(0)
      for (const a of t.theme.accents) expect(a).toMatch(/^[0-9A-F]{6}$/)
    }
  })
})

describe("loadBuiltinTemplateBytes", () => {
  it("正常下载 → 返回字节", async () => {
    const bytes = fakePptx()
    const fetchImpl = vi.fn(async () => new Response(bytes.buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect("bytes" in r).toBe(true)
    if ("bytes" in r) expect(r.bytes.length).toBe(bytes.length)
  })

  it("第二次调用命中缓存，不重复下载（4.93MB 重复拉会明显卡）", async () => {
    const fetchImpl = vi.fn(async () => new Response(fakePptx().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("HTTP 404 → 返回 failure，不返回空字节假成功", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect("failure" in r).toBe(true)
    if ("failure" in r) expect(r.failure).toContain("404")
  })

  it("返回的不是 pptx（例如 SPA 的 index.html）→ 明确失败，不把 HTML 喂给引擎", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new TextEncoder().encode("<!doctype html><html></html>"), { status: 200 }),
    ) as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect("failure" in r).toBe(true)
    if ("failure" in r) expect(r.failure).toContain("不是有效的 pptx")
  })

  it("空文件 → 明确失败", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })) as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect("failure" in r).toBe(true)
  })

  it("网络异常 → 捕获并返回 failure（不向上抛，避免打断向导）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("zoe-light-internal", fetchImpl)
    expect("failure" in r).toBe(true)
    if ("failure" in r) expect(r.failure).toContain("network down")
  })

  it("未知 key → failure", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const r = await loadBuiltinTemplateBytes("bad-key", fetchImpl)
    expect("failure" in r).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
