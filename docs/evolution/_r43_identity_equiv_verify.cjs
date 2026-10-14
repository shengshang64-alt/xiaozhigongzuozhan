// R43 独立行为等价复核 v2
//  - 修正 v1 的 UTF-8 分片解码伪影（Buffer.concat 后再 decode）
//  - 三pass：pre(HEAD 182副本) / post(工作区中间件) / post2(同 post，第二次)
//    post vs post2 的差异 = 本次实验的「噪声地板」（DB 数组顺序等非确定性）
//    pre  vs post  的差异 - 噪声地板 = 真正由本次改动引入的差异
const fs = require("fs"), path = require("path"), http = require("http"), net = require("net")
const { spawn, execSync } = require("child_process")

const ROOT = process.cwd()
const BIN = path.join(ROOT, "vibex-local", "bin", "windows", "pocketbase.exe")
const V = path.join(ROOT, ".probe", "r43v2")
const DATA = path.join(ROOT, ".probe", "pb-smoke", "data")
const POST_HOOKS = path.join(ROOT, "pocketbase", "pb_hooks")
const PRE_HOOKS = path.join(V, "hooks-pre")
const MIG = path.join(ROOT, "pocketbase", "pb_migrations")
const PORT = 7095

const PATHS = ["/api/todos","/api/quotes","/api/solutions","/api/customers","/api/kb_docs","/api/format_templates","/api/check_mappings","/api/check_products","/api/assistant_sessions","/api/assistant_messages","/api/assistant_skills","/api/assistant_memory","/api/checklists","/api/material_library","/api/qual_certs","/api/competitors","/api/competitor_evidence","/api/opportunities","/api/follow_records","/api/projects","/api/ppt_decks","/api/bid_projects","/api/bid_stage_snapshots","/api/intel_items","/api/intel_stars","/api/intel_views","/api/intel_prefs","/api/intel_sources","/api/kb_qa_pairs","/api/product_library","/api/doc_templates","/api/model_configs"]
const REAL_UID = "local-user", OTHER_UID = "zzz-nonexistent-user", LONG_UID = "z".repeat(70), CTRL_UID = "u\u0001x"
const MODES = [["noHdr", undefined], ["real", REAL_UID], ["other", OTHER_UID], ["long", LONG_UID], ["ctrl", CTRL_UID]]

function readBody(res) {
  return new Promise((resolve) => {
    const chunks = []
    res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}
function get(pathname, uid) {
  return new Promise((resolve) => {
    const headers = uid === undefined ? {} : { "X-Rh-User-Id": uid }
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method: "GET", headers, timeout: 20000 }, async (res) => resolve({ status: res.statusCode, body: await readBody(res) }))
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }))
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    req.end()
  })
}
function rawGet(pathname, headerValue) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, "127.0.0.1")
    const chunks = []
    sock.setTimeout(20000)
    sock.on("connect", () => sock.write("GET " + pathname + " HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Rh-User-Id: " + headerValue + "\r\nConnection: close\r\n\r\n"))
    sock.on("data", (d) => chunks.push(d))
    sock.on("end", () => {
      const buf = Buffer.concat(chunks)
      const idx = buf.indexOf("\r\n\r\n")
      const head = buf.slice(0, idx).toString("latin1")
      const status = Number(((head.split("\r\n")[0] || "").split(" ")[1]) || 0)
      let body = buf.slice(idx + 4)
      // 解 chunked
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        const out = []; let p = 0
        while (p < body.length) {
          const nl = body.indexOf("\r\n", p); if (nl < 0) break
          const size = parseInt(body.slice(p, nl).toString("latin1"), 16); if (!size) break
          out.push(body.slice(nl + 2, nl + 2 + size)); p = nl + 2 + size + 2
        }
        body = Buffer.concat(out)
      }
      resolve({ status, body: body.toString("utf8") })
    })
    sock.on("error", (e) => resolve({ status: 0, body: String(e.message) }))
    sock.on("timeout", () => { sock.destroy(); resolve({ status: 0, body: "timeout" }) })
  })
}

async function run(label, hooksDir) {
  const logFd = fs.openSync(path.join(V, "pb-" + label + ".log"), "a")
  const proc = spawn(BIN, ["serve", "--http=127.0.0.1:" + PORT, "--dir=" + DATA, "--hooksDir=" + hooksDir, "--migrationsDir=" + MIG], { cwd: ROOT, stdio: ["ignore", logFd, logFd], windowsHide: true })
  let up = false
  for (let i = 0; i < 80; i++) { if ((await get("/api/health")).status === 200) { up = true; break } await new Promise((r) => setTimeout(r, 400)) }
  const out = { up }
  if (up) {
    for (const p of PATHS) {
      const cases = {}
      for (const [name, uid] of MODES) {
        const r = name === "ctrl" ? await rawGet(p, uid) : await get(p, uid)
        cases[name] = { status: r.status, body: r.body }
      }
      out[p] = cases
    }
  }
  try { proc.kill() } catch {}
  await new Promise((r) => setTimeout(r, 1500))
  try { proc.kill("SIGKILL") } catch {}
  fs.writeFileSync(path.join(V, label + ".json"), JSON.stringify(out))
  console.log(label, "health:", up)
  return out
}

// ---- 归一化比较 ----
function normalize(v, sortArrays) {
  if (Array.isArray(v)) { const a = v.map((x) => normalize(x, sortArrays)); return sortArrays ? a.slice().sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) : a }
  if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach((k) => (o[k] = normalize(v[k], sortArrays))); return o }
  return v
}
function stable(v) { return JSON.stringify(normalize(v, false)) }
function compare(A, B) {
  const diffs = []
  for (const p of PATHS) for (const [name] of MODES) {
    const a = A[p][name], b = B[p][name]
    if (a.status !== b.status) { diffs.push({ where: p + "/" + name, kind: "status", a: a.status, b: b.status }); continue }
    let ja = null, jb = null
    try { ja = JSON.parse(a.body) } catch {}
    try { jb = JSON.parse(b.body) } catch {}
    if (ja === null || jb === null) { if (a.body !== b.body) diffs.push({ where: p + "/" + name, kind: "raw" }); continue }
    if (stable(ja) === stable(jb)) continue
    if (stable(normalize(ja, true)) === stable(normalize(jb, true))) { diffs.push({ where: p + "/" + name, kind: "array-order-only" }); continue }
    diffs.push({ where: p + "/" + name, kind: "content" })
  }
  return diffs
}

;(async () => {
  fs.mkdirSync(V, { recursive: true })
  fs.rmSync(PRE_HOOKS, { recursive: true, force: true }); fs.mkdirSync(PRE_HOOKS, { recursive: true })
  const files = fs.readdirSync(POST_HOOKS).filter((f) => f.endsWith(".pb.js"))
  let g = 0
  for (const f of files) { fs.writeFileSync(path.join(PRE_HOOKS, f), execSync(`git show HEAD:pocketbase/pb_hooks/${f}`, { encoding: "utf8", maxBuffer: 1 << 28 })); g++ }
  console.log("hooks-pre from HEAD:", g, "files")
  const pre = await run("pre", PRE_HOOKS)
  const post = await run("post", POST_HOOKS)
  const post2 = await run("post2", POST_HOOKS)
  const noise = compare(post, post2)
  const signal = compare(pre, post)
  const noiseKeys = new Set(noise.map((d) => d.where + "|" + d.kind))
  const realSignal = signal.filter((d) => !noiseKeys.has(d.where + "|" + d.kind))
  const byKind = (arr) => arr.reduce((m, d) => ((m[d.kind] = (m[d.kind] || 0) + 1), m), {})
  console.log("\n=== 噪声地板 post vs post2 ===", noise.length, JSON.stringify(byKind(noise)))
  console.log("=== pre vs post 全部差异 ===", signal.length, JSON.stringify(byKind(signal)))
  console.log("=== 扣除噪声后仍存在的差异 ===", realSignal.length)
  realSignal.slice(0, 20).forEach((d) => console.log("  REAL " + JSON.stringify(d)))
  fs.writeFileSync(path.join(V, "verdict.json"), JSON.stringify({ noise, signal, realSignal }, null, 1))
})().catch((e) => { console.error("FATAL", e); process.exit(1) })
