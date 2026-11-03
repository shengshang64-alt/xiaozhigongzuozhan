// 情报中心「发布时间被抽成未来日期」的回归测试（2026-10-27）
//
// 实测背景：库内 688 条情报里有 3 条 published_at 是未来日期（2027-04-29 / 2027-01-03），
// 全部来自 HIT专家网。原因不是抓取端「没守卫」——后端 __intelValidDate 早在 2026-10-20
// 就补了未来守卫；真正的问题是**界面上的「修复数据」永远修不到它们**：
//   runIntelEnrich 的筛选条件只看「缺摘要 / 摘要是垃圾 / 缺区域」，
//   而 3 条里有 2 条摘要区域都正常 → 不进待修集合 → 后端 recompute_crawl 分支
//   （唯一会清未来日期的地方）根本不会被触发。
// 于是那些 2027 会一直挂在列表最上面（列表按 -published_at 排序）。
//
// 本测试锁两件事：
//   ① 未来日期的条目必须进待修集合；
//   ② 一旦本批含未来日期，请求体必须带 region_mode='recompute_crawl'
//      （fill 模式只补空不覆盖，带了也不会清）。
//
// 提取方式沿用项目既有惯例（见 scripts/modelGatewayReasoning.test.ts）：
// 直接读源码切片求值，保证测的就是生产实现，实现改了而测试没跟上时立刻红。
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const SRC_PATH = join(__dirname, "..", "..", "pages", "IntelCenter", "useIntelCenter.ts")
const src = readFileSync(SRC_PATH, "utf8")

/**
 * 从源码抽出「待修条目筛选」那段循环并求值。
 * 锚点用 todayStamp 声明与本段独有注释，结构变动时立刻失败而不是静默测错地方。
 */
function loadTodoPicker() {
  const beginAnchor = "const todayStamp = new Date(Date.now() + 86400000)"
  const begin = src.indexOf(beginAnchor)
  expect(begin, "未能定位 todayStamp（筛选逻辑可能已改，请同步本测试）").toBeGreaterThan(-1)
  // 取到「queue = todo」之前的 if (todo.length === 0) 判断为止
  const endAnchor = "if (todo.length === 0) {"
  const end = src.indexOf(endAnchor, begin)
  expect(end, "未能定位筛选段终点").toBeGreaterThan(begin)

  // 把整段包成一个函数体：注入 apiFetch / ItemsResponse 之外的最小依赖
  const section = src.slice(begin, end)
  const body = [
    "const todo = [];",
    section.replace("const todo: string[] = []", ""),
    "return { todo, hasFuturePub };",
  ].join("\n")
  // TS 类型标注在这段里不影响运行，但 `as` / 泛型需要剥掉——本段只有 apiFetch<ItemsResponse> 这一处泛型
  const jsBody = body.replace(/apiFetch<ItemsResponse>/g, "apiFetch")
  return {
    section: jsBody,
    hasFuturePubLine: section.includes("hasFuturePub"),
    todoVarDeclaredInSection: section.includes("const todo: string[] = []"),
  }
}

/** 用给定条目集合驱动筛选逻辑，返回 { todo, hasFuturePub } */
function runPicker(items: Array<Record<string, unknown>>, todayStamp: string) {
  const { section } = loadTodoPicker()
  // 把「今天」替换成用例给定的日期：源码里的 todayStamp 是真实时钟，不替换则边界用例随日期漂移
  const patched = section.replace(
    /const todayStamp = new Date\(Date\.now\(\) \+ 86400000\)\.toISOString\(\)\.slice\(0, 10\)/,
    `const todayStamp = ${JSON.stringify(todayStamp)}`,
  )
  expect(patched, "todayStamp 初始化未按预期替换").not.toContain("Date.now()")
  // 直接复用生产那段代码；把 apiFetch 换成回放桩，只返回一页
  const apiFetch = async (url: string) => {
    void url
    return { items }
  }
  // 这段源码本身含 await（apiFetch 是异步的）→ 必须包进 async 函数体，不能用普通 Function 体
  const fn = new Function("apiFetch", "enrichAttemptedRef", `return (async () => { ${patched} })()`)
  // 2026-11-03 新增「同会话已尝试不重抓」依赖：测试每次给一份空 Set，和生产首轮行为一致
  return fn(apiFetch, { current: new Set<string>() }) as Promise<{ todo: string[]; hasFuturePub: boolean }>
}

describe("情报中心待修条目筛选（未来发布日期）", () => {
  const TODAY = "2026-10-28" // 今天 + 1 天容差，与实现口径一致

  it("发布日在未来的条目必须进待修集合（即使摘要与区域都正常）", async () => {
    // 这正是实测里漏掉的形态：摘要 103 字、区域「北京」、只有日期错
    const r = await runPicker(
      [
        { id: "bad-future", summary: "x".repeat(103), region: "北京", published_at: "2027-01-03" },
        { id: "healthy", summary: "正常摘要", region: "上海", published_at: "2026-10-01" },
      ],
      TODAY,
    )
    expect(r.todo).toContain("bad-future")
    expect(r.todo).not.toContain("healthy")
    expect(r.hasFuturePub).toBe(true)
  })

  it("缺摘要 / 缺区域的条目照旧入选（既有行为不回退）", async () => {
    const r = await runPicker(
      [
        { id: "no-summary", summary: "", region: "广东", published_at: "2026-09-01" },
        { id: "no-region", summary: "有摘要", region: "", published_at: "2026-09-02" },
        { id: "junk-summary", summary: '<a href="http://x">链接</a>', region: "浙江", published_at: "2026-09-03" },
      ],
      TODAY,
    )
    expect(r.todo).toEqual(["no-summary", "no-region", "junk-summary"])
    expect(r.hasFuturePub).toBe(false)
  })

  it("发布日等于今天或过去的条目不算未来（边界不外扩）", async () => {
    const r = await runPicker(
      [
        { id: "today", summary: "摘要", region: "北京", published_at: "2026-10-27" },
        { id: "edge", summary: "摘要", region: "北京", published_at: "2026-10-28" },
        { id: "tomorrow", summary: "摘要", region: "北京", published_at: "2026-10-29" },
      ],
      TODAY,
    )
    expect(r.todo).not.toContain("today")
    expect(r.todo).not.toContain("edge") // 等于容差日不算未来
    expect(r.todo).toContain("tomorrow")
  })
})

describe("修复请求体必须带 recompute_crawl", () => {
  it("有未来日期时带 region_mode，没有时不带（避免无谓改动存量）", () => {
    // fill 模式只补空不覆盖，未来日期清不掉 —— 这是本次修复的关键前提，故锁死源码形态
    const hasConditional = /hasFuturePub\s*\n?\s*\?\s*\{[^}]*region_mode:\s*"recompute_crawl"/.test(src)
    expect(hasConditional, "本批含未来日期时必须传 region_mode='recompute_crawl'").toBe(true)
    const hasFallback = /\?\s*\{[^}]*region_mode[^}]*\}\s*:\s*\{\s*item_ids:\s*batch,\s*budget_ms:\s*95000\s*\}/.test(src)
    expect(hasFallback, "无未来日期时应保持原请求体（不带 region_mode）").toBe(true)
  })
})
