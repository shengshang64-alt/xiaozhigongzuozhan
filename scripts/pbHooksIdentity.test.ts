// R43 身份收敛回归锁：全站唯一取值处 = zx_guard.pb.js 顶部的 routerUse 中间件
//
// 背景：PocketBase 每个 handler 跑在独立 VM 隔离里，文件级 function/var 对 handler
// 不可见（探针实测：文件级 const/var/function 在 handler 内一律 ReferenceError，
// globalThis 也不跨隔离），所以此前 40 个钩子各自内联了 182 份「读 X-Rh-User-Id 头
// → 规整」的副本。R43 改为：中间件读一次并 e.set("rhUserId", ...) 注入请求上下文，
// handler 统一用 e.get("rhUserId") 读同一份值。改口径只需要改中间件一处。
//
// 本文件两道锁：
//   1) 结构锁：内联副本必须为 0；头名取值只允许出现在中间件块内；handler 侧统一 e.get。
//   2) 口径锁：抽取中间件真实代码执行，锁死头名优先级 / 控制字符 / 空白 / 截断 / 续链。
// 行为等价另有实证（非本测试职责，脚本归档为 docs/evolution/_r43_identity_equiv_verify.cjs）：
// 同一只读数据副本、同一端口（7095），参照组取 git show HEAD: 的收敛前钩子、实验组取工作区，
// 32 个受身份守卫的端点 × 5 种请求头（无头 / 真 uid / 不存在 uid / 70 字符 uid / 含控制字符 uid）
// = 160 用例，逐字节零差异；噪声地板（同代码连跑两次）亦为 0。写路由未覆盖，见轮报 §九。
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const HOOKS_DIR = join(__dirname, "..", "pocketbase", "pb_hooks")
const GUARD = join(HOOKS_DIR, "zx_guard.pb.js")
const MW_BEGIN = "// __ZX_IDENTITY_MIDDLEWARE_BEGIN__"
const MW_END = "// __ZX_IDENTITY_MIDDLEWARE_END__"
/** 头名原始字面量：收敛后全仓只允许在中间件内出现一次 */
const HEADER_LITERAL = "x_rh_user_id"
/** handler 侧统一入口 */
const READ = "e.get(\"rhUserId\")"
/** 收敛前的内联副本总数（R43 收敛盘点，见 docs/19 一稿 · 身份收敛条目） */
const INLINE_SITES_BEFORE = 182

function hookFiles(): string[] {
  return readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".pb.js"))
}

function isCommentLine(line: string): boolean {
  const s = line.trim()
  return s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")
}

/** 中间件块在 zx_guard.pb.js 里的行区间（0 基闭区间，含 BEGIN/END 标记行本身） */
function guardMiddlewareRange(lines: string[]): { start: number; end: number } {
  const start = lines.findIndex((l) => l.includes(MW_BEGIN))
  const end = lines.findIndex((l) => l.includes(MW_END))
  expect(start, "未能定位 __ZX_IDENTITY_MIDDLEWARE_BEGIN__（钩子结构可能已变，请同步本测试）").toBeGreaterThan(-1)
  expect(end, "未能定位 __ZX_IDENTITY_MIDDLEWARE_END__").toBeGreaterThan(start)
  return { start, end }
}

type FakeEvent = {
  requestInfo: () => { headers: Record<string, string | number | null> }
  set: (key: string, value: unknown) => void
  next: () => string
}

function makeEvent(headers: Record<string, string | number | null> = {}) {
  const store = new Map<string, unknown>()
  const calls = { next: 0 }
  const ev: FakeEvent = {
    requestInfo: () => ({ headers }),
    set: (key, value) => { store.set(key, value) },
    next: () => { calls.next += 1; return "NEXT" },
  }
  return { ev, store, calls }
}

/** 读取钩子源码 → 截取中间件标记区间 → 执行 → 取回 routerUse 注册的那个中间件函数 */
function loadMiddleware(): (e: FakeEvent) => unknown {
  const lines = readFileSync(GUARD, "utf8").split(/\r?\n/)
  const { start, end } = guardMiddlewareRange(lines)
  const snippet = lines.slice(start + 1, end).join("\n")
  const captured: Array<(e: FakeEvent) => unknown> = []
  const routerUse = (fn: (e: FakeEvent) => unknown): void => { captured.push(fn) }
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  new Function("routerUse", snippet)(routerUse)
  expect(captured, "中间件标记区间内未调用 routerUse（标记位置可能已错）").toHaveLength(1)
  return captured[0]!
}

describe("R43 身份收敛 · 结构锁", () => {
  it("zx_guard 顶部存在身份中间件：routerUse + e.set(\"rhUserId\") + e.next()", () => {
    const lines = readFileSync(GUARD, "utf8").split(/\r?\n/)
    const { start, end } = guardMiddlewareRange(lines)
    const block = lines.slice(start, end + 1).join("\n")
    expect(block).toContain("routerUse(")
    expect(block).toContain("e.set(\"rhUserId\"")
    expect(block).toContain("e.next()")
  })

  it("内联副本清零：非注释行里的头名取值全仓只允许出现在中间件块内", () => {
    const offenders: string[] = []
    let inMiddleware = 0
    for (const f of hookFiles()) {
      const lines = readFileSync(join(HOOKS_DIR, f), "utf8").split(/\r?\n/)
      const range = f === "zx_guard.pb.js" ? guardMiddlewareRange(lines) : null
      lines.forEach((line, i) => {
        if (!line.includes(HEADER_LITERAL) || isCommentLine(line)) return
        if (range && i >= range.start && i <= range.end) { inMiddleware += 1; return }
        offenders.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, `仍有内联身份副本——请改用 e.get("rhUserId")：\n${offenders.join("\n")}`).toEqual([])
    expect(inMiddleware, "头名取值只应剩中间件里那一行").toBe(1)
  })

  it("handler 侧统一 e.get(\"rhUserId\")，规模不低于收敛前的 182 处", () => {
    let reads = 0
    for (const f of hookFiles()) {
      const src = readFileSync(join(HOOKS_DIR, f), "utf8")
      reads += src.split(READ).length - 1
    }
    // 新增路由会让读数继续增长；此处只锁「不能回退到内联副本」的下界。
    expect(reads).toBeGreaterThanOrEqual(INLINE_SITES_BEFORE)
  })
})

describe("R43 身份收敛 · 口径锁（执行中间件真实代码）", () => {
  const mw = loadMiddleware()

  it("无头 → 空串（等价未登录，由各路由自行 401），且 e.next() 被调用一次", () => {
    const { ev, store, calls } = makeEvent()
    expect(mw(ev)).toBe("NEXT")
    expect(store.get("rhUserId")).toBe("")
    expect(calls.next).toBe(1)
  })

  it("三种头名写法均可识别：X-Rh-User-Id / x-rh-user-id / x_rh_user_id", () => {
    expect(makeEventStore({ "X-Rh-User-Id": "u-cap" }, mw)).toBe("u-cap")
    expect(makeEventStore({ "x-rh-user-id": "u-low" }, mw)).toBe("u-low")
    expect(makeEventStore({ "x_rh_user_id": "u-under" }, mw)).toBe("u-under")
  })

  it("头名优先级：x_rh_user_id > X-Rh-User-Id > x-rh-user-id", () => {
    expect(makeEventStore({ "x_rh_user_id": "a", "X-Rh-User-Id": "b", "x-rh-user-id": "c" }, mw)).toBe("a")
    expect(makeEventStore({ "X-Rh-User-Id": "b", "x-rh-user-id": "c" }, mw)).toBe("b")
  })

  it("规整口径：trim 空白、去控制字符（\\u0000-\\u001f / \\u007f）、截断到 64 字符", () => {
    expect(makeEventStore({ "X-Rh-User-Id": "  u2  " }, mw)).toBe("u2")
    expect(makeEventStore({ "X-Rh-User-Id": "u\u0001\u001f\u007f3" }, mw)).toBe("u3")
    const long = "z".repeat(70)
    const got = makeEventStore({ "X-Rh-User-Id": long }, mw)
    expect(got).toHaveLength(64)
    expect(got).toBe(long.slice(0, 64))
  })

  it("空串头 → 空串（不得把空身份当成已登录）", () => {
    expect(makeEventStore({ "X-Rh-User-Id": "" }, mw)).toBe("")
    expect(makeEventStore({ "x_rh_user_id": "   " }, mw)).toBe("")
  })

  it("注入的一定是字符串（非字符串头值也归一）", () => {
    expect(makeEventStore({ "X-Rh-User-Id": 12345 }, mw)).toBe("12345")
  })
})

/** 跑一次中间件并返回写入请求上下文里的 rhUserId */
function makeEventStore(
  headers: Record<string, string | number | null>,
  mw: (e: FakeEvent) => unknown,
): unknown {
  const { ev, store } = makeEvent(headers)
  mw(ev)
  return store.get("rhUserId")
}
