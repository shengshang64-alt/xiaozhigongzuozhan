// R38（B12）价格分测算接线哨兵：钉住「算法层（priceScoreModel）→ 视图模型（priceScoreBrief）→
// 第 6 步面板（PriceScorePanel）→ 页面挂载」这条链，并锁死四条口径纪律：
// ① 面板零写入（会话内 state，不 PATCH、不落库、零新 collection）；
// ② 对手报价不自动带入（竞对情报存的是中标金额，不是投标报价）；
// ③ 算分口径只在视图模型一处实现，JSX 里不得再写第二套；
// ④ 无 effect 内同步 setState（级联渲染），换项目的输入重置由调用方 key 重挂载完成。
// 风格同 deckLintPanel.test.ts / quoteDiscount.test.ts（源码扫描，无需 jsdom）。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const MODEL = new URL("./priceScoreModel.ts", import.meta.url)
const BRIEF = new URL("./priceScoreBrief.ts", import.meta.url)
const PANEL = new URL("../../components/bid-workspace/PriceScorePanel.tsx", import.meta.url)
const PAGE = new URL("./BidWorkspacePage.tsx", import.meta.url)
const USE = new URL("./useBidWorkspace.ts", import.meta.url)

// R47：源码扫描哨兵与工作区换行解耦——本机 core.autocrlf=true，同一份文件在不同
// 检出状态可能是 CRLF 或 LF；下面的正则哨兵按 LF 书写，读入时统一归一，避免「换行
// 变了就红」这种与行为无关的假失败（useBidWorkspace.ts 实测两种状态都存在过）。
const read = (u: URL) => readFileSync(u, "utf-8").replace(/\r\n/g, "\n")

describe("priceScoreModel 增口（R38）", () => {
  it("listPriceScoringCandidates 复用同一 PRICE_ITEM_RE 与 parsePriceFormula，不另立口径", () => {
    const code = read(MODEL)
    expect(code).toContain("export function listPriceScoringCandidates")
    const fn = code.slice(code.indexOf("export function listPriceScoringCandidates"))
    expect(fn).toContain("PRICE_ITEM_RE.test(")
    expect(fn).toContain("parsePriceFormula(it.criteria, it.score)")
  })

  it("findPriceScoringItem 行为不变（仍可算才返回），两函数并存不互相改写", () => {
    const code = read(MODEL)
    expect(code).toContain("export function findPriceScoringItem(items: ScoringItem[])")
  })
})

describe("视图模型 → 面板（R38）", () => {
  it("面板只调 buildPriceScoreView，不自算基准价/得分（口径单源）", () => {
    const code = read(PANEL)
    expect(code).toContain("buildPriceScoreView(")
    expect(code).toContain('from "@/pages/BidWorkspace/priceScoreBrief"')
    expect(code).not.toContain("priceScoreModel")
    expect(code).not.toMatch(/baseline\s*[*/-]\s*100/)
  })

  it("评分项与事实行走既有单源函数，不新造取数路径", () => {
    const code = read(PANEL)
    expect(code).toContain("scoringItemsFromReport(")
    expect(code).toContain("effectiveGlobalFactsLines(")
    expect(code).toContain("pickLatestQuoteTotals(")
  })

  it("零写入：面板不 PATCH、不落库、不引 AI 通道，输入只活在会话里", () => {
    const code = read(PANEL)
    for (const forbidden of ["apiFetch", "PATCH", "applySetting", "llmGenerate", "localStorage"]) {
      expect(code, forbidden).not.toContain(forbidden)
    }
  })

  it("报价单默认值用「override」派生而非 effect 回填（无级联渲染）", () => {
    const code = read(PANEL)
    expect(code).not.toContain("useEffect")
    expect(code).toContain("ourPriceOverride")
    expect(code).toContain("ourPriceOverride ??")
  })

  it("对手报价明示「必手填」，并点破竞对情报不可冒用", () => {
    const code = read(PANEL)
    expect(code).toContain("必手填")
    expect(code).toContain("中标金额")
    expect(code).not.toContain("competitorEvidence")
  })

  it("没出数的每个阶段都渲染 note，不得用 0 分占位", () => {
    const code = read(PANEL)
    expect(code).toContain('view.phase === "computed"')
    expect(code).toContain("{view.note}")
  })
})

describe("页面挂载与取数（R38）", () => {
  it("面板挂在第 6 步模拟评标之下，取 activeProject + 报价单快照，并按项目重挂载", () => {
    const code = read(PAGE)
    expect(code).toContain('import { PriceScorePanel } from "@/components/bid-workspace/PriceScorePanel"')
    const step6 = code.slice(code.indexOf("p.activeStep === 6"))
    const at = step6.indexOf("<PriceScorePanel")
    expect(at).toBeGreaterThan(step6.indexOf("<MockEvalPanel"))
    expect(step6.slice(at, at + 420)).toContain('key={p.activeProject?.id ?? "none"}')
    expect(step6.slice(at, at + 420)).toContain("activeProject={p.activeProject}")
    expect(step6.slice(at, at + 420)).toContain("quoteRefs={p.quoteRefs}")
    expect(step6.slice(at, at + 420)).toContain("goParseStep={p.goParseStep}")
  })

  it("hook 把报价单快照并置 state 并导出（ref 只服务同步体检，渲染层读不到）", () => {
    const code = read(USE)
    expect(code).toContain("const [quoteRefs, setQuoteRefs] = useState<QuoteTotalRef[]>([])")
    expect(code).toContain("quoteRefsRef.current = next")
    expect(code).toContain("setQuoteRefs(next)")
    expect(code).toMatch(/\n {4}quoteRefs,\n/)
  })

  it("视图模型侧天花板取数沿用 R42 硬限价优先口径，人工覆盖才改来源", () => {
    const code = read(BRIEF)
    expect(code).toContain("priceCeilingFromFacts(")
    expect(code).toContain('src: "人工填写"')
  })
})
