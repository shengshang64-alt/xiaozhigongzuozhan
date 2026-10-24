import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// P1-3 缺陷修复配套测试：kb_docs 列表路由的「过滤条件派生 + 总数计数」。
// 回归价值：原实现每次列表请求都全量加载 6998 条记录（含 500KB/篇的正文）只为了数个数，
// 单请求 5.48s、35 页累计 25s+。本文件从 pocketbase/pb_hooks/kb_docs.pb.js 提取
// __KB_PARAMS_BEGIN__ → __KB_COUNT_END__ 之间的真实代码执行（非复制品，防实现与测试漂移），锁死：
//   ① 无过滤热路径走 $app.countRecords("kb_docs")，一次 findRecordsByFilter 都不发
//   ② 纯精确过滤走 countRecords + $dbx.hashExp/and 表达式（表达式内容与 eqs 一致）
//   ③ q 搜索（含 q+精确组合）刻意走 load-and-count，且 filter/params 与分页同源
//   ④ countRecords 异常/非法返回、$dbx 表达式构建失败 → 一律回落 load-and-count
//   ⑤ 两条路都失败 → 异常向上抛（由路由外层 catch 兜底）
// 实现依据（2026-10-13 真实运行时实测）：countRecords+hashExp 与原 load-and-count
// 在 7 组过滤条件下结果完全一致；$dbx.exp+params 静默返回 0、LikeExp.Escape 未绑定，
// 故 q 搜索不走表达式计数（语义一致性优先）。
const HOOK_PATH = "pocketbase/pb_hooks/kb_docs.pb.js"
const PARAMS_BEGIN = "// __KB_PARAMS_BEGIN__"
const PARAMS_END = "// __KB_PARAMS_END__"
const COUNT_BEGIN = "// __KB_COUNT_BEGIN__"
const COUNT_END = "// __KB_COUNT_END__"

interface CountCall {
  coll: string
  expr: unknown
}
interface FindCall {
  filter: string
  params: Record<string, string>
  sort: string
  limit: number
  offset: number
}
interface Expr {
  kind: string
  pair?: Record<string, string>
  a?: Expr
  b?: Expr
}

interface RunInit {
  query: Record<string, string>
  sort?: string
  itemsLength?: number
}
interface Stub {
  run: (init: RunInit) => number
  countCalls: CountCall[]
  findCalls: FindCall[]
}

/** 从钩子源文件提取两段标记区间代码，注入桩作用域执行 */
function load(
  opts: {
    /** countRecords 返回值；传函数可按 expr 定制；默认 6998 */
    countReturns?: number | ((expr: unknown) => number)
    countThrows?: boolean
    hashExpThrows?: boolean
    findReturns?: number
    findThrows?: boolean
  } = {},
): Stub {
  const src = readFileSync(HOOK_PATH, "utf8")
  const pBegin = src.indexOf(PARAMS_BEGIN)
  const pEnd = src.indexOf(PARAMS_END)
  const cBegin = src.indexOf(COUNT_BEGIN)
  const cEnd = src.indexOf(COUNT_END)
  expect(pBegin, "未能定位 __KB_PARAMS_BEGIN__（钩子结构可能已变，请同步本测试）").toBeGreaterThan(-1)
  expect(pEnd, "未能定位 __KB_PARAMS_END__").toBeGreaterThan(pBegin)
  expect(cBegin, "未能定位 __KB_COUNT_BEGIN__").toBeGreaterThan(pEnd)
  expect(cEnd, "未能定位 __KB_COUNT_END__").toBeGreaterThan(cBegin)
  // 从标记行尾开始取，避开标记注释本体
  const paramsSection = src.slice(src.indexOf("\n", pBegin) + 1, pEnd)
  const countSection = src.slice(src.indexOf("\n", cBegin) + 1, cEnd)

  const countCalls: CountCall[] = []
  const findCalls: FindCall[] = []
  const $app = {
    countRecords: (coll: string, expr?: unknown) => {
      countCalls.push({ coll, expr })
      if (opts.countThrows) throw new Error("countRecords 炸了")
      // 用 hasOwnProperty 区分「未提供」（默认合法 6998）与「显式提供的非法值」（原样返回供回落断言）
      const hasCustom = Object.prototype.hasOwnProperty.call(opts, "countReturns")
      const v = hasCustom
        ? typeof opts.countReturns === "function"
          ? opts.countReturns(expr)
          : opts.countReturns
        : 6998
      return v
    },
    findRecordsByFilter: (
      coll: string,
      filter: string,
      sort: string,
      limit: number,
      offset: number,
      params: Record<string, string>,
    ) => {
      findCalls.push({ filter, params: params || {}, sort, limit, offset })
      if (opts.findThrows) throw new Error("find 失败")
      return new Array(opts.findReturns ?? 6998)
    },
  }
  const $dbx = {
    hashExp: (pair: Record<string, string>): Expr => {
      if (opts.hashExpThrows) throw new Error("hashExp 炸了")
      return { kind: "hashExp", pair }
    },
    and: (a: Expr, b: Expr): Expr => ({ kind: "and", a, b }),
  }

  const factory = new Function(
    "$app",
    "$dbx",
    "query",
    "sort",
    "itemsLength",
    paramsSection +
      "\nvar totalItems = itemsLength;\n" +
      countSection +
      "\nreturn { totalItems: totalItems, filter: filter, params: params, eqs: eqs, qKw: qKw };",
  ) as (app: unknown, dbx: unknown, query: unknown, sort: unknown, itemsLength: number) => {
    totalItems: number
    filter: string
    params: Record<string, string>
    eqs: Array<{ field: string; value: string }>
    qKw: string
  }

  return {
    countCalls,
    findCalls,
    run: (init: RunInit) => {
      countCalls.length = 0
      findCalls.length = 0
      const r = factory($app, $dbx, init.query, init.sort ?? "-updated", init.itemsLength ?? 50)
      // totalItems 由 factory 返回值带出；findCalls/countCalls 已重置后重新累计
      return r.totalItems
    },
  }
}

describe("P1-3 kb_docs 列表计数（不得全量加载记录；派生与路径选择同源锁定）", () => {
  it("无过滤热路径：走 countRecords 全表计数，一次 findRecordsByFilter 都不发", () => {
    const s = load()
    expect(s.run({ query: {} })).toBe(6998)
    expect(s.countCalls).toEqual([{ coll: "kb_docs", expr: undefined }])
    expect(s.findCalls.length, "SQL count 可用时不得回落全量加载").toBe(0)
  })

  it("纯精确过滤：走 countRecords + hashExp 表达式，不发 findRecordsByFilter", () => {
    const s = load({ countReturns: (expr) => (expr as Expr).kind === "hashExp" ? 731 : -1 })
    expect(s.run({ query: { kb_track: "HIS系统" } })).toBe(731)
    expect(s.countCalls.length).toBe(1)
    expect(s.countCalls[0].expr).toEqual({ kind: "hashExp", pair: { kb_track: "HIS系统" } })
    expect(s.findCalls.length).toBe(0)
  })

  it("多精确过滤：表达式为 and 链，字段与值逐一对齐 eqs（字段序=路由固定检查序）", () => {
    const s = load({ countReturns: () => 237 })
    expect(s.run({ query: { kb_track: "HIS系统", kb_bucket: "方案素材", visibility: "team" } })).toBe(237)
    expect(s.countCalls.length).toBe(1)
    const expr = s.countCalls[0].expr as Expr
    expect(expr.kind).toBe("and")
    // 收集 and 链叶子，校验三个条件全部在树中（顺序为路由固定检查序：visibility → kb_track → kb_bucket）
    const leaves: Expr[] = []
    const walk = (e: Expr) => (e.kind === "and" ? (walk(e.a!), walk(e.b!)) : leaves.push(e))
    walk(expr)
    expect(leaves).toEqual([
      { kind: "hashExp", pair: { visibility: "team" } },
      { kind: "hashExp", pair: { kb_track: "HIS系统" } },
      { kind: "hashExp", pair: { kb_bucket: "方案素材" } },
    ])
    expect(s.findCalls.length).toBe(0)
  })

  it("q 搜索：刻意不走 SQL count，回落 load-and-count 且 filter/params 与分页同源", () => {
    const s = load({ findReturns: 2998 })
    expect(s.run({ query: { q: "医院" } })).toBe(2998)
    expect(s.countCalls.length, "q 搜索不得走表达式计数").toBe(0)
    expect(s.findCalls.length).toBe(1)
    expect(s.findCalls[0]).toEqual({
      filter: "(title ~ {:q_kw} || source_file_name ~ {:q_kw2})",
      params: { q_kw: "%医院%", q_kw2: "%医院%" },
      sort: "-updated",
      limit: 100000,
      offset: 0,
    })
  })

  it("q + 精确过滤组合：回落 load-and-count，组合 filter 顺序稳定（精确字段在前、q 在后）", () => {
    const s = load({ findReturns: 42 })
    expect(s.run({ query: { visibility: "team", q: "医院" } })).toBe(42)
    expect(s.countCalls.length).toBe(0)
    expect(s.findCalls[0].filter).toBe("visibility = {:visibility} && (title ~ {:q_kw} || source_file_name ~ {:q_kw2})")
    expect(s.findCalls[0].params).toEqual({ visibility: "team", q_kw: "%医院%", q_kw2: "%医院%" })
  })

  it("eqs → filter 派生：七个精确字段全部生成占位符与同名参数（防漏字段）", () => {
    const s = load({ countReturns: () => 7 })
    s.run({
      query: {
        rh_user_id: "local-user",
        visibility: "team",
        folder_path: "本地材料导入/客户情况库",
        doc_format: "md",
        kb_track: "HIS系统",
        kb_bucket: "方案素材",
        kb_section: "设计方案",
      },
    })
    expect(s.countCalls.length).toBe(1)
    const expr = s.countCalls[0].expr as Expr
    const leaves: Expr[] = []
    const walk = (e: Expr) => (e.kind === "and" ? (walk(e.a!), walk(e.b!)) : leaves.push(e))
    walk(expr)
    expect(leaves.map((l) => Object.keys(l.pair!)[0])).toEqual([
      "rh_user_id", "visibility", "folder_path", "doc_format", "kb_track", "kb_bucket", "kb_section",
    ])
  })

  it("countRecords 抛异常（无过滤）：回落 load-and-count，结果不变", () => {
    const s = load({ countThrows: true, findReturns: 6998 })
    expect(s.run({ query: {} })).toBe(6998)
    expect(s.countCalls.length).toBe(1)
    expect(s.findCalls.length).toBe(1)
    expect(s.findCalls[0]).toMatchObject({ filter: "", limit: 100000, offset: 0 })
  })

  it("countRecords 返回非法值（负数/NaN/null/字符串）：回落 load-and-count", () => {
    for (const bad of [-1, Number.NaN, null, "6998", undefined]) {
      const s = load({ countReturns: bad as unknown as number, findReturns: 6998 })
      expect(s.run({ query: {} }), `非法返回 ${String(bad)} 必须回落`).toBe(6998)
      expect(s.findCalls.length).toBe(1)
    }
  })

  it("countRecords 抛异常（精确过滤）：回落时用同一 filter 与 params", () => {
    const s = load({ countThrows: true, findReturns: 217 })
    expect(s.run({ query: { kb_track: "HIS系统" } })).toBe(217)
    expect(s.findCalls[0]).toEqual({
      filter: "kb_track = {:kb_track}",
      params: { kb_track: "HIS系统" },
      sort: "-updated",
      limit: 100000,
      offset: 0,
    })
  })

  it("$dbx.hashExp 构建失败：回落 load-and-count（不静默使用错误总数）", () => {
    const s = load({ hashExpThrows: true, findReturns: 731 })
    expect(s.run({ query: { kb_track: "HIS系统" } })).toBe(731)
    expect(s.countCalls.length, "表达式构建失败时不得调用 countRecords").toBe(0)
    expect(s.findCalls.length).toBe(1)
  })

  it("两条路径都失败：异常向上抛（由路由外层 catch 兜底，语义与原版一致）", () => {
    const s = load({ countThrows: true, findThrows: true })
    expect(() => s.run({ query: {} })).toThrow("find 失败")
  })

  it("q 搜索两条路都失败：异常同样向上抛", () => {
    const s = load({ findThrows: true })
    expect(() => s.run({ query: { q: "医院" } })).toThrow("find 失败")
  })

  it("sort 参数透传：回落 load-and-count 使用调用方 sort", () => {
    const s = load({ countThrows: true, findReturns: 10 })
    s.run({ query: { kb_track: "HIS系统" }, sort: "-created" })
    expect(s.findCalls[0].sort).toBe("-created")
  })

  // A2（2026-10-25）：增量同步游标 since —— range 条件进 filter/params，计数刻意走
  // load-and-count 回落（dbx 等值快速路径不覆盖范围过滤），语义与分页同源。
  it("since 增量游标：filter 含 updated > {:since} 且 params.since 透传", () => {
    const s = load({ findReturns: 3 })
    s.run({ query: { since: "2026-10-25 00:00:00.000Z" } })
    expect(s.findCalls).toHaveLength(1)
    expect(s.findCalls[0].filter).toContain("updated > {:since}")
    expect(s.findCalls[0].params.since).toBe("2026-10-25 00:00:00.000Z")
  })
  it("since 不走 countRecords 快速路径（连无 eqs 时也回落 load-and-count）", () => {
    const s = load({ findReturns: 0 })
    const total = s.run({ query: { since: "2026-10-26 00:00:00.000Z" } })
    expect(s.countCalls).toHaveLength(0)
    expect(total).toBe(0)
  })
  it("since + 精确过滤组合：回落 load-and-count，filter 为 等值+range 组合", () => {
    const s = load({ findReturns: 5 })
    s.run({ query: { rh_user_id: "u1", since: "2026-10-25 00:00:00.000Z" } })
    expect(s.countCalls).toHaveLength(0)
    expect(s.findCalls[0].filter).toContain("rh_user_id = {:rh_user_id}")
    expect(s.findCalls[0].filter).toContain("updated > {:since}")
  })
  it("无 since 时行为与旧版完全一致（不出现 updated 占位符）", () => {
    const s = load()
    s.run({ query: { rh_user_id: "u1" } })
    expect(s.findCalls).toHaveLength(0) // 纯精确过滤仍走 countRecords 快速路径
    expect(s.countCalls).toHaveLength(1)
  })
})
