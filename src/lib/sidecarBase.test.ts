/** @vitest-environment jsdom */
/**
 * R2（整仓重构 · 部署壳）**回归网**：增强服务出口可达性 + 「不再写死 127.0.0.1」。
 *
 * 为什么这组测试值得留——R2 修的不是「功能坏了」，而是**坏得很安静**：
 * 同事在自己电脑打开 `http://<上盛机器IP>:8000` 时，浏览器里的 `127.0.0.1`
 * 指的是**同事自己那台机器**。四条增强功能（导出/解析/本机搜索/AI 生图/渲染质检）
 * 全部悄悄退回浏览器路径，界面只显示「已完成」，没人知道跑的是降级版。
 *
 * 所以这里钉三件事，全部围绕「静默」这个失败形态：
 *   ① 地址口径：远程页面**绝不**把 127.0.0.1 当候选（这是本 bug 的根因）
 *   ② 出口口径：dev 与 preview 都用同一份 proxy 定义，两条前缀都在（否则 build 路径又静默 404）
 *   ③ 降级口径：真不可达时**能说人话**，且三种原因（没配出口/服务没起/配错地址）不混为一谈
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SIDECAR_DEFAULT_PORT,
  SIDECAR_PROXY_PREFIX,
  describeSidecarUnavailable,
  isLoopbackHost,
  isRemotePage,
  resetSidecarBase,
  sidecarBase,
  sidecarBaseCandidates,
  sidecarFetch,
  sidecarUrl,
} from "@/lib/sidecarBase"
import { buildProxy } from "../../vite.proxy"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.unstubAllEnvs()
  resetSidecarBase()
  vi.restoreAllMocks()
})

beforeEach(() => {
  resetSidecarBase()
})

/** 模拟「页面来自某台机器」（jsdom 的 location 不能直接改，用 spy 换 hostname）。 */
function pretendHost(hostname: string): void {
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hostname } as Location)
}

describe("① 地址口径：远程页面不许把 127.0.0.1 当候选（本 bug 的根因）", () => {
  it("回环地址判定覆盖 localhost / IPv4 / IPv6", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]) {
      expect(isLoopbackHost(h), h).toBe(true)
    }
    for (const h of ["192.168.1.3", "10.0.0.8", "xz-workstation", "example.com"]) {
      expect(isLoopbackHost(h), h).toBe(false)
    }
  })

  it("本机页面：默认同源 /__sc，并允许回落 127.0.0.1", () => {
    pretendHost("127.0.0.1")
    expect(isRemotePage()).toBe(false)
    const list = sidecarBaseCandidates()
    expect(list[0]).toBe(SIDECAR_PROXY_PREFIX)
    expect(list).toContain(`http://127.0.0.1:${SIDECAR_DEFAULT_PORT}`)
  })

  it("**同事机**（页面来自内网 IP）：只剩同源 /__sc，绝不出现 127.0.0.1", () => {
    pretendHost("192.168.1.3")
    expect(isRemotePage()).toBe(true)
    const list = sidecarBaseCandidates()
    expect(list).toEqual([SIDECAR_PROXY_PREFIX])
    expect(
      list.some((b) => b.includes("127.0.0.1")),
      "远程页面把 127.0.0.1 当候选 = 连到同事自己的电脑，正是 R2 要根治的静默降级",
    ).toBe(false)
  })

  it("显式配置 VITE_SIDECAR_BASE 时只用它，不再猜（部署方已明确指定）", () => {
    vi.stubEnv("VITE_SIDECAR_BASE", "http://10.0.0.9:7001/")
    expect(sidecarBaseCandidates()).toEqual(["http://10.0.0.9:7001"])
  })

  it("sidecarUrl 拼接：相对基址与绝对基址都不能出现双斜杠", () => {
    expect(sidecarUrl("/health", "/__sc")).toBe("/__sc/health")
    expect(sidecarUrl("health", "/__sc")).toBe("/__sc/health")
    expect(sidecarUrl("/health", "http://10.0.0.9:7001/")).toBe("http://10.0.0.9:7001/health")
  })
})

describe("② 出口口径：dev 与 preview 共用一份 proxy，两条前缀都在", () => {
  const proxy = buildProxy()

  it("两条前缀都存在，且都能剥前缀（PB 只认 /api/x，sidecar 只认 /health）", () => {
    expect(Object.keys(proxy).sort()).toEqual(["/__pb", "/__sc"])
    expect(proxy["/__pb"].rewrite("/__pb/api/health")).toBe("/api/health")
    expect(proxy["/__sc"].rewrite("/__sc/health")).toBe("/health")
  })

  it("目标端口与 sidecar/PB 默认端口同源（防止改了端口忘了改代理）", () => {
    expect(proxy["/__sc"].target).toBe(`http://127.0.0.1:${SIDECAR_DEFAULT_PORT}`)
    expect(proxy["/__pb"].target).toContain(":7000")
  })

  it("增强服务是长任务：反代超时必须 ≥ 渲染/导出的上限，否则前端看到假降级", () => {
    expect(proxy["/__sc"].timeout).toBeGreaterThanOrEqual(240_000)
    expect(proxy["/__sc"].proxyTimeout).toBeGreaterThanOrEqual(240_000)
  })

  it("**dev 与 preview 两个配置都接了同一份 proxy**（build 路径不许静默 404）", async () => {
    // 这是 R2 的真实坑：只给 start-local 那份加 /__sc，`vite build` + preview 就会 404。
    const root = await import("../../vite.config")
    const local = await import("../../vibex-local/vite.local.config")
    for (const [name, cfg] of [
      ["根 vite.config", root.default],
      ["vibex-local 配置", local.default],
    ] as const) {
      const c = cfg as { server?: { proxy?: Record<string, unknown> }; preview?: { proxy?: Record<string, unknown> } }
      expect(Object.keys(c.server?.proxy ?? {}), `${name} 的 server.proxy`).toEqual(
        expect.arrayContaining(["/__pb", "/__sc"]),
      )
      expect(Object.keys(c.preview?.proxy ?? {}), `${name} 的 preview.proxy`).toEqual(
        expect.arrayContaining(["/__pb", "/__sc"]),
      )
    }
  })
})

describe("③ 降级口径：真不可达时说人话，三种原因分得开", () => {
  it("本机页面 + 服务没起：告诉用户跑 start-local，并说明会退到浏览器本地版本", () => {
    pretendHost("127.0.0.1")
    const msg = describeSidecarUnavailable()
    expect(msg).toContain("未启动")
    expect(msg).toContain(String(SIDECAR_DEFAULT_PORT))
    expect(msg).toMatch(/浏览器本地版本/)
  })

  it("同事机：说的是「出口没配」，不是「你没启动」——这两件事的修法完全不同", () => {
    pretendHost("192.168.1.3")
    const msg = describeSidecarUnavailable()
    expect(msg).toContain("192.168.1.3")
    expect(msg).toContain(SIDECAR_PROXY_PREFIX)
    expect(msg).toMatch(/出口/)
    expect(msg, "远程页面不该让用户去自己电脑上找 sidecar").not.toContain("本机 7001 端口")
  })

  it("显式配置了地址：直接点名那个地址配错了，别让用户猜", () => {
    pretendHost("127.0.0.1")
    vi.stubEnv("VITE_SIDECAR_BASE", "http://10.0.0.9:7001")
    const msg = describeSidecarUnavailable()
    expect(msg).toContain("10.0.0.9:7001")
    expect(msg).toContain("VITE_SIDECAR_BASE")
  })
})

describe("④ 候选梯子：只有「地址不对」才换下一个，服务真报错不重试", () => {
  it("同源 404 → 自动换到 127.0.0.1 并记下可用基址", async () => {
    pretendHost("127.0.0.1")
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).startsWith("/__sc")) return { ok: false, status: 404 } as never
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as never
    }) as never

    const res = await sidecarFetch("/health", undefined, { timeoutMs: 1000 })
    expect(res.status).toBe(200)
    expect(calls).toEqual(["/__sc/health", `http://127.0.0.1:${SIDECAR_DEFAULT_PORT}/health`])
    // 记住可用基址后，后续请求不再先试错
    expect(sidecarBase()).toBe(`http://127.0.0.1:${SIDECAR_DEFAULT_PORT}`)
  })

  it("服务端 500（请求已落地）不换地址重试——生图/导出是花钱接口，重打一遍等于付两次", async () => {
    pretendHost("127.0.0.1")
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url))
      return { ok: false, status: 500 } as never
    }) as never

    const res = await sidecarFetch("/ai-image/generate", { method: "POST" })
    expect(res.status).toBe(500)
    expect(calls).toHaveLength(1)
  })

  it("全部候选都连不上 → 抛错（调用方据此降级），错误里带的是最后一个真因", async () => {
    pretendHost("127.0.0.1")
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never
    await expect(sidecarFetch("/health", undefined, { timeoutMs: 500 })).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe("⑤ 源码哨兵：四个客户端模块不许再各自写死地址", () => {
  /** 只看**代码行**：注释里提到旧地址（解释为什么不能写死）是允许且有益的。 */
  const codeLines = (src: string): string[] =>
    src
      .split("\n")
      .filter((line) => {
        const t = line.trim()
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
      })

  it("lib/sidecarClient、lib/anytxtClient、aiImageProvider、deckRenderClient 里没有硬编码 127.0.0.1:7001", async () => {
    const { sourceText } = await import("@/testing/hookSources")
    for (const rel of [
      "src/lib/sidecarClient.ts",
      "src/lib/anytxtClient.ts",
      "src/pages/PptQuote/aiImageProvider.ts",
      "src/pages/PptQuote/deckRenderClient.ts",
    ]) {
      const code = codeLines(sourceText(rel))
      const offenders = code.filter((line) => /http:\/\/127\.0\.0\.1:7001/.test(line))
      expect(offenders, `${rel} 又写死了服务地址——同事机会连到他自己电脑：\n${offenders.join("\n")}`).toEqual([])
      // 同目录模块用 "./sidecarBase"，跨目录用 "@/lib/sidecarBase"；两种都算接入。
      expect(sourceText(rel), `${rel} 应经 lib/sidecarBase 取地址`).toMatch(/from "(?:@\/lib|\.)\/sidecarBase"/)
    }
  })
})
