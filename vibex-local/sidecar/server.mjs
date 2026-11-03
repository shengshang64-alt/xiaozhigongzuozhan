// ---------------------------------------------------------------------------
// 售前工作站 · 后端服务（sidecar）
//
// 为什么需要它（2026-10-27 用户拍板：「把解析、导出、大文件处理从浏览器挪到后端」）：
//   前端硬扛的三类活碰到了浏览器/架构硬限制，代码里能直接看到：
//     wholeParse.ts:24   WHOLE_FILE_LIMIT = 60000     整文通道 6 万字上限
//     wholeParse.ts:38   PARSE_MAX_SEGMENTS = 20       切段最多 20 段
//     tenderStructure:206 SCORING_MATERIAL_MAX_SECTION = 60000
//     tenderStructure:207 SCORING_MATERIAL_MAX_TOTAL   = 120000
//   真标书动辄 30-60 万字（天坛 39.2 万、蚌埠 61.8 万），全部超限 → 只能切段 → 丢素材。
//
// 为什么是独立 Node 服务而不是塞进 PocketBase 的 pb_hooks：
//   PocketBase v0.40 的 JSVM 是嵌入的 goja 引擎，官方文档明确「不是 Node.js 环境，
//   依赖 fs/fetch/buffer 的模块可能无法工作，且只支持 CommonJS」。
//   而 docx / mammoth / pdfjs-dist 都是 ESM + Node API → **装不进 pb_hooks**。
//   所以用独立 Node 进程（复用项目已有 node_modules，零新增依赖）。
//
// 设计原则：
//   1. 只做「重活」：解析、导出、大文件；业务逻辑与数据仍归 PocketBase
//   2. 无状态：不碰数据库，只接收文本/文件 → 返回结果
//   3. 失败可降级：前端调不通时退回原浏览器路径（不阻断用户）
//   4. 只监听 127.0.0.1：本机工具，不对外暴露
// ---------------------------------------------------------------------------

import { createServer } from "node:http"
import { randomUUID } from "node:crypto"

const PORT = Number(process.env.ZX_SIDECAR_PORT || 7001)
const HOST = "127.0.0.1"
const STARTED_AT = Date.now()

/** 已注册的路由：方法 + 路径 → handler */
const routes = new Map()

function route(method, path, handler) {
  routes.set(`${method} ${path}`, handler)
}

/** 统一响应 */
function send(res, status, body, headers = {}) {
  const isBuffer = body instanceof Uint8Array
  const payload = isBuffer ? Buffer.from(body) : Buffer.from(JSON.stringify(body), "utf8")
  res.writeHead(status, {
    "Content-Type": isBuffer ? headers["Content-Type"] || "application/octet-stream" : "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    // 只允许本机前端调用；这个服务不对外
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Rh-User-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  })
  res.end(payload)
}

/** 读请求体（带大小上限，防内存打爆） */
async function readBody(req, maxBytes = 200 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > maxBytes) throw new Error(`请求体超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`)
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes)
  if (!buf.length) return {}
  return JSON.parse(buf.toString("utf8"))
}

// ---------------------------------------------------------------------------
// 健康检查：前端用它判断「后端服务在不在」，不在就降级回浏览器路径
// ---------------------------------------------------------------------------
route("GET", "/health", async (_req, res) => {
  send(res, 200, {
    ok: true,
    service: "zx-sidecar",
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    routes: [...routes.keys()].sort(),
  })
})

// ---------------------------------------------------------------------------
// 模块注册：各功能模块自己挂路由（保持本文件只做骨架）
// ---------------------------------------------------------------------------
async function loadModules() {
  const modules = [
    // 导出后端化（第一批）
    "./modules/export.js",
    // 大文件解析（第二批：切段不再受前端 20 段/6 万字限制）
    "./modules/parse.js",
    // AnyTXT 本机全文搜索接入（2026-10-29：补上「搜本地盘历史资料」的能力）
    "./modules/anytxt.js",
    // PPT 渲染质检（2026-10-30：导出后把 pptx 渲染成图，检查真实效果）
    "./modules/pptRender.js",
    // AI 绘图 Provider（2026-10-30：密钥只在服务端环境变量，前端不碰）
    "./modules/aiImage.js",
  ]
  const loaded = []
  for (const m of modules) {
    try {
      const mod = await import(new URL(m, import.meta.url))
      if (typeof mod.register === "function") {
        mod.register({ route, readJson, readBody, send })
        loaded.push(m)
      }
    } catch (e) {
      // 单模块失败不影响整体启动
      console.error(`[sidecar] 模块加载失败 ${m}: ${e?.message ?? e}`)
    }
  }
  return loaded
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`)
  const path = url.pathname
  const reqId = randomUUID().slice(0, 8)

  if (req.method === "OPTIONS") {
    send(res, 204, {})
    return
  }

  const key = `${req.method} ${path}`
  const handler = routes.get(key)
  if (!handler) {
    send(res, 404, { error: "not_found", path, method: req.method, hint: "调 GET /health 看已注册路由" })
    return
  }

  const t0 = Date.now()
  try {
    await handler(req, res, { url, reqId })
    const ms = Date.now() - t0
    if (ms > 1000) console.log(`[sidecar] ${key} ${ms}ms`)
  } catch (e) {
    const msg = e?.message ?? String(e)
    console.error(`[sidecar] ${key} 失败: ${msg}`)
    if (!res.headersSent) send(res, 500, { error: "internal", message: msg, reqId })
  }
})

const loaded = await loadModules()

server.listen(PORT, HOST, () => {
  console.log(`[sidecar] 已启动 http://${HOST}:${PORT}`)
  console.log(`[sidecar] Node ${process.version}，已挂模块：${loaded.join(", ") || "（无）"}`)
  console.log(`[sidecar] 已注册 ${routes.size} 条路由`)
})

// 优雅退出
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[sidecar] 收到 ${sig}，正在退出`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000)
  })
}
