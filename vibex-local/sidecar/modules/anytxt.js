// ---------------------------------------------------------------------------
// sidecar · AnyTXT 本机全文搜索接入（2026-10-29）
//
// 为什么接 AnyTXT：
//   系统现有的知识库/素材库只能搜「已入库」的内容；用户电脑里大量历史标书、
//   方案、资质扫描件、培训 PDF 从未入库，写标书/方案时翻不到。AnyTXT 是离线
//   全文搜索引擎（100+ 格式，增强版含图片与扫描件 OCR），在本机 9920 端口
//   暴露 JSON-RPC 2.0 服务，正好补上这块能力。
//
// 为什么挂在 sidecar 而不是 PocketBase：
//   PocketBase 是 goja（非 Node），装不了 ESM 依赖；sidecar 已是模块化 Node 服务
//   （server.mjs 的 loadModules 就是为这类接入准备的）。
//
// 协议（来自官方论坛，见 docs/anytxt-integration-plan.md）：
//   POST http://127.0.0.1:9920
//   {"id":1,"jsonrpc":"2.0","method":"ATRpcServer.Searcher.V1.GetResult",
//    "params":{"input":{"pattern":"...","filterDir":"*","filterExt":"*",
//                       "lastModifyBegin":0,"lastModifyEnd":2147483647,
//                       "limit":300,"offset":0,"order":0}}}
//   返回 {result:{data:{output:{count,files:[[fid,...],...]}}}}
//
// 设计原则（与 sidecar 一致）：
//   1. 失败可降级：AnyTXT 没开时快速失败（短超时），不拖住前端
//   2. 归一化：前端不用懂 JSON-RPC 的嵌套结构
//   3. 只监听本机；不加鉴权（与 sidecar 现状一致）
//
// ---------------------------------------------------------------------------
// 2026-10-29 从 ATGUI.exe 静态字符串中提取到的完整方法清单（官方文档未公开）
//
//   ATRpcServer.Searcher.V1.Search             全文搜索
//   ATRpcServer.Searcher.V1.GetResult          取搜索结果（分页）
//   ATRpcServer.Searcher.V1.IsSearchEngineStarted  引擎是否就绪（比健康探测准）
//   ATRpcServer.Searcher.V1.GetFragment        取命中片段（单条）
//   ATRpcServer.Searcher.V1.GetFragmentAll     取全部命中片段
//   ATRpcServer.Searcher.V1.GetRawTextByFID    按 fid 取文件全文  ★官方未提
//   ATRpcServer.Searcher.V1.SyncIndex          触发索引同步/重建 ★官方论坛说没有，实际有
//   ATRpcServer.Searcher.V1.OCR                对文件做 OCR 识别 ★增强版能力
//   ATRpcServer.Indexer                        索引管理域
//   ATRpcServer.OCR                            OCR 服务域
//   ATRpcServer.GUI                            GUI 域
//
// 配置键（QSettings，从二进制串 IndexPathStorageFileMonitorRangePreferRichPreview
// 与 ApiE/ApiB/ApiP/ApiS、McpE/McpB/McpP/McpS 提取）：
//   ApiE  启用 API（bool）
//   ApiB  API 绑定地址（string，如 127.0.0.1）
//   ApiP  API 端口（int，官方默认 9920）
//   ApiS  API 状态/开关
//   McpE/McpB/McpP/McpS  MCP 协议同名四项
//
// 注意：这些配置项**只在用户于 GUI「设置 → API / MCP」里保存过一次后**才会落盘，
// 未保存过时读不到任何配置（实测注册表与磁盘均无）。因此首次启用必须人工在
// GUI 点一次「开启」并保存，之后本模块才能通过 9920 调用。
// ---------------------------------------------------------------------------

import { request as httpRequest } from "node:http"
import { accessSync, constants as fsConstants } from "node:fs"

const ANYTXT_HOST = process.env.ZX_ANYTXT_HOST || "127.0.0.1"
const ANYTXT_PORT = Number(process.env.ZX_ANYTXT_PORT || 9920)
const ANYTXT_URL = `http://${ANYTXT_HOST}:${ANYTXT_PORT}`
/** 探测超时：AnyTXT 未启动时要快速失败，不能把前端请求挂住 */
const PROBE_TIMEOUT_MS = 1500
/** 搜索超时：索引命中通常在毫秒级，给 5s 足够 */
const SEARCH_TIMEOUT_MS = 5000

/** 单次 JSON-RPC 调用（带超时，永不抛出到调用方之外） */
function rpc(method, input, timeoutMs = SEARCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params: { input },
    })
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let req
    try {
      req = httpRequest(
        { host: ANYTXT_HOST, port: ANYTXT_PORT, path: "/rpc", method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(payload) } },
        (res) => {
          const chunks = []
          res.on("data", (c) => chunks.push(c))
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            try {
              done({ ok: true, body: JSON.parse(text) })
            } catch {
              done({ ok: false, error: "invalid_json", raw: text.slice(0, 300) })
            }
          })
        },
      )
    } catch (e) {
      done({ ok: false, error: "request_failed", message: String(e?.message ?? e) })
      return
    }
    req.setTimeout(timeoutMs, () => {
      try { req.destroy() } catch { /* ignore */ }
      done({ ok: false, error: "timeout", message: `AnyTXT 响应超时 ${timeoutMs}ms` })
    })
    req.on("error", (e) => {
      done({ ok: false, error: "connect_failed", message: `连不上 AnyTXT（${ANYTXT_URL}）：${e?.code ?? e?.message ?? e}` })
    })
    req.write(payload)
    req.end()
  })
}

/**
 * 多盘并发搜索（2026-10-30 实测驱动）
 *
 * AnyTXT 的 filterDir 只认**单个盘符**（如 "D:"，不能带反斜杠、不能多值、不能用 "*"）；
 * 省略该字段时它会默认填成 "C:"，导致只搜 C 盘。
 * 因此这里改为：对系统每个盘符各发一次查询，再按 bm25 之外的原始顺序合并。
 *
 * 实测：C: 与 D: 均已建索引（count>0）；filterDir="D:\" 或 "*" 都返回 0。
 */
function searchAllDrives(pattern, filterExt, limit, offset, order) {
  var drives = []
  try {
    // Node 侧用 fs 枚举盘符（Windows）
    for (var i = 67; i <= 90; i++) { // C..Z
      var letter = String.fromCharCode(i)
      try { accessSync(letter + ":\\"); drives.push(letter + ":") } catch (_) {}
    }
  } catch (_) {}
  if (!drives.length) drives = ["C:"]
  // 每个盘各取 limit 条，最后合并截断（宁可多取再截，避免某盘结果被挤掉）
  return Promise.all(
    drives.map(function (d) {
      return rpc("ATRpcServer.Searcher.V1.GetResult", {
        pattern: pattern,
        filterDir: d,
        filterExt: filterExt || "*",
        lastModifyBegin: 0,
        lastModifyEnd: 2147483647,
        limit: limit,
        offset: offset || 0,
        order: order || 0,
      })
    })
  ).then(function (results) {
    var all = []
    var total = 0
    for (var i = 0; i < results.length; i++) {
      var out = pickOutput(results[i])
      if (!out) continue
      total += Number(out.count || 0)
      var fs2 = Array.isArray(out.files) ? out.files : []
      for (var j = 0; j < fs2.length; j++) all.push(fs2[j])
    }
    return { ok: true, count: total, raw: all }
  })
}

/** 从 JSON-RPC 响应里取 output（结构：result.data.output） */
function pickOutput(res) {
  if (!res?.ok) return null
  const out = res.body?.result?.data?.output
  return out && typeof out === "object" ? out : null
}

/**
 * files 的每一行是什么结构？
 * 官方示例只取 file[0] 当 fid，其余字段未文档化。
 * 因此这里做「尽力解析」：取第一个字符串当 fid，再把剩余字符串里
 * 像路径的、像文件名的分别挑出来，绝不因为字段顺序变化而崩掉。
 */
function parseFileRow(row) {
  if (!Array.isArray(row)) return null
  const strs = row.filter((x) => typeof x === "string" && x.trim())
  if (!strs.length) return null
  const fid = strs[0]
  // 找到第一个像 Windows/Unix 绝对路径的串
  const path = strs.find((s) => /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("/")) || ""
  const name = path ? path.split(/[\\/]/).pop() || "" : strs.find((s) => /\.[A-Za-z0-9]{1,6}$/.test(s)) || ""
  return { id: fid, name, path }
}

export function register({ route, readJson, send }) {
  // ---------------------------------------------------------------------------
  // 健康探测：前端用它判断「AnyTXT 装了没 / 开了没」，没开就走降级路径
  // ---------------------------------------------------------------------------
  route("GET", "/anytxt/health", async (_req, res) => {
    const t0 = Date.now()
    // 优先用官方的引擎状态方法（比拿搜索当探针更轻）
    const started = await rpc("ATRpcServer.Searcher.V1.IsSearchEngineStarted", {}, PROBE_TIMEOUT_MS)
    if (started.ok) {
      const out = pickOutput(started)
      send(res, 200, {
        ok: true,
        online: true,
        target: ANYTXT_URL,
        latencyMs: Date.now() - t0,
        engineStarted: Boolean(out?.result ?? out ?? true),
        method: "IsSearchEngineStarted",
      })
      return
    }
    // 回退：用极短搜索探针
    const probe = await rpc("ATRpcServer.Searcher.V1.GetResult", {
      pattern: "__health_probe__",
      filterDir: "",
      filterExt: "*",
      lastModifyBegin: 0,
      lastModifyEnd: 2147483647,
      limit: 1,
      offset: 0,
      order: 0,
    }, PROBE_TIMEOUT_MS)
    const online = probe.ok || probe.error === "timeout" // 超时说明端口通了但响应慢，也算在线
    send(res, 200, {
      ok: true,
      online,
      target: ANYTXT_URL,
      latencyMs: Date.now() - t0,
      ...(online
        ? {}
        : {
            message:
              "AnyTXT 未运行或未启用 API。请在 AnyTXT 里「设置 → API / MCP」把 API 打开、" +
              "绑定 127.0.0.1、端口 9920，保存后重试（首次启用必须在 GUI 里保存一次）。",
            reason: probe.error,
          }),
    })
  })

  // ---------------------------------------------------------------------------
  // 全文搜索：转发 GetResult 并归一化
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/search", async (req, res) => {
    const body = await readJson(req, 64 * 1024)
    const pattern = String(body?.pattern ?? "").trim()
    if (!pattern) {
      send(res, 400, { ok: false, error: "pattern_required", message: "缺少搜索关键词 pattern" })
      return
    }
    const limit = Math.min(Number(body?.limit ?? 100) || 100, 500)
    const offset = Number(body?.offset ?? 0) || 0
    const order = Number(body?.order ?? 0) || 0
    const filterExt = String(body?.filterExt ?? "*")
    // 用户显式指定目录时只查该目录；否则多盘并发（AnyTXT 不认 "*" 与多值，见 searchAllDrives 注释）
    const explicitDir = String(body?.filterDir ?? "").trim()
    const multi = explicitDir
      ? await rpc("ATRpcServer.Searcher.V1.GetResult", {
          pattern, filterDir: explicitDir, filterExt,
          lastModifyBegin: Number(body?.lastModifyBegin ?? 0),
          lastModifyEnd: Number(body?.lastModifyEnd ?? 2147483647),
          limit, offset, order,
        }).then((x) => { const o = pickOutput(x); return o ? { ok: true, count: Number(o.count || 0), raw: o.files || [] } : { ok: false, error: x.error, message: x.message, raw: [] } })
      : await searchAllDrives(pattern, filterExt, limit, offset, order)
    const out = multi.ok ? { count: multi.count, files: multi.raw } : null
    if (!out) {
      send(res, 200, {
        ok: false,
        error: "no_output",
        message: "AnyTXT 未返回结果（服务可能未启动或未启用 API）",
      })
      return
    }
    const files = Array.isArray(out.files) ? out.files.map(parseFileRow).filter(Boolean) : []
    send(res, 200, {
      ok: true,
      pattern,
      count: Number(out.count ?? files.length),
      files,
    })
  })

  // ---------------------------------------------------------------------------
  // 命中片段：转发 GetFragment
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/fragment", async (req, res) => {
    const body = await readJson(req, 64 * 1024)
    const fid = String(body?.fid ?? "").trim()
    const pattern = String(body?.pattern ?? "").trim()
    if (!fid) {
      send(res, 400, { ok: false, error: "fid_required", message: "缺少文件 id（fid）" })
      return
    }
    const r = await rpc("ATRpcServer.Searcher.V1.GetFragment", { fid, pattern })
    const out = pickOutput(r)
    if (!out) {
      send(res, 200, { ok: false, error: r.error ?? "no_output", message: r.message ?? "取片段失败" })
      return
    }
    send(res, 200, { ok: true, fid, text: String(out.text ?? "") })
  })

  // ---------------------------------------------------------------------------
  // 组合接口：搜一次 + 并发取前 N 个片段（前端最常用，一次拿全）
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/context", async (req, res) => {
    const body = await readJson(req, 64 * 1024)
    const pattern = String(body?.pattern ?? "").trim()
    if (!pattern) {
      send(res, 400, { ok: false, error: "pattern_required", message: "缺少搜索关键词 pattern" })
      return
    }
    const topN = Math.min(Number(body?.topN ?? 5) || 5, 20)
    const explicitDir = String(body?.filterDir ?? "").trim()
    const ctxLimit = Math.min(Number(body?.limit ?? 50) || 50, 200)
    const ctxExt = String(body?.filterExt ?? "*")
    const multiRes = explicitDir
      ? await rpc("ATRpcServer.Searcher.V1.GetResult", {
          pattern, filterDir: explicitDir, filterExt: ctxExt,
          lastModifyBegin: 0, lastModifyEnd: 2147483647,
          limit: ctxLimit, offset: 0, order: 0,
        }).then((x) => { const o = pickOutput(x); return o ? { ok: true, count: Number(o.count || 0), raw: o.files || [] } : { ok: false, error: x.error, message: x.message, raw: [] } })
      : await searchAllDrives(pattern, ctxExt, ctxLimit, 0, 0)
    const out = multiRes.ok ? { count: multiRes.count, files: multiRes.raw } : null
    if (!out) {
      send(res, 200, {
        ok: false,
        error: "no_output",
        message: "AnyTXT 未返回结果",
      })
      return
    }
    const files = (Array.isArray(out.files) ? out.files.map(parseFileRow).filter(Boolean) : []).slice(0, topN)
    // 并发取片段（AnyTXT 本地服务，N ≤ 20 可接受）
    const fragments = await Promise.all(
      files.map(async (f) => {
        const fr = await rpc("ATRpcServer.Searcher.V1.GetFragment", { fid: f.id, pattern })
        const fo = pickOutput(fr)
        return { ...f, text: fo ? String(fo.text ?? "") : "" }
      }),
    )
    send(res, 200, { ok: true, pattern, count: Number(out.count ?? fragments.length), items: fragments })
  })

  // ---------------------------------------------------------------------------
  // 按 fid 取整篇正文（ATRpcServer.Searcher.V1.GetRawTextByFID）
  //
  // 用途：把本机历史标书/方案整篇读出来喂给 AI（对照表、章节复用、事实核对）。
  // 这个方法官方论坛没提，是从 ATGUI.exe 字符串表里挖出来的。
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/rawtext", async (req, res) => {
    const body = await readJson(req, 64 * 1024)
    const fid = String(body?.fid ?? "").trim()
    if (!fid) {
      send(res, 400, { ok: false, error: "fid_required", message: "缺少文件 id（fid）" })
      return
    }
    const r = await rpc("ATRpcServer.Searcher.V1.GetRawTextByFID", { fid }, 20000)
    const out = pickOutput(r)
    if (!out) {
      send(res, 200, { ok: false, error: r.error ?? "no_output", message: r.message ?? "取正文失败" })
      return
    }
    // output 可能是 {text} 也可能直接是字符串，两种都兼容
    const text = typeof out === "string" ? out : String(out.text ?? out.raw ?? "")
    send(res, 200, { ok: true, fid, text, length: text.length })
  })

  // ---------------------------------------------------------------------------
  // 触发索引同步/重建（ATRpcServer.Searcher.V1.SyncIndex）
  //
  // 官方论坛有人问「能否通过 API 重建索引」未获答复；实际该方法存在。
  // 注意：索引范围（哪些目录）仍需在 GUI「设置 → 索引管理」里配置，
  // 本接口只触发已配置范围的重新扫描。
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/syncindex", async (req, res) => {
    const body = await readJson(req, 16 * 1024).catch(() => ({}))
    const input = body && Object.keys(body).length ? body : {}
    const r = await rpc("ATRpcServer.Searcher.V1.SyncIndex", input, 120000)
    const out = pickOutput(r)
    if (!out) {
      send(res, 200, { ok: false, error: r.error ?? "no_output", message: r.message ?? "索引同步请求失败" })
      return
    }
    send(res, 200, { ok: true, result: out })
  })

  // ---------------------------------------------------------------------------
  // OCR 识别（ATRpcServer.Searcher.V1.OCR）——仅增强版可用
  //
  // 用于扫描版招标文件/图片里的文字提取，弥补普通解析拿不到文字的缺口。
  // ---------------------------------------------------------------------------
  route("POST", "/anytxt/ocr", async (req, res) => {
    const body = await readJson(req, 64 * 1024)
    const fid = String(body?.fid ?? "").trim()
    const path = String(body?.path ?? "").trim()
    if (!fid && !path) {
      send(res, 400, { ok: false, error: "fid_or_path_required", message: "需要文件 id（fid）或绝对路径（path）" })
      return
    }
    const input = fid ? { fid } : { path }
    const r = await rpc("ATRpcServer.Searcher.V1.OCR", input, 60000)
    const out = pickOutput(r)
    if (!out) {
      send(res, 200, {
        ok: false,
        error: r.error ?? "no_output",
        message: r.message ?? "OCR 失败（基础版不支持 OCR，需增强版）",
      })
      return
    }
    const text = typeof out === "string" ? out : String(out.text ?? "")
    send(res, 200, { ok: true, text, length: text.length })
  })
}
