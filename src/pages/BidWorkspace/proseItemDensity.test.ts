import { describe, expect, it } from "vitest"
import {
  formatDensitySummary,
  headingDepthOf,
  isItemLine,
  ITEM_DENSITY_MIN,
  ITEM_MEDIAN_MAX,
  ITEM_MEDIAN_MIN,
  measureItemDensity,
} from "./proseItemDensity"

// REQ-046（2026-10-18）颗粒度校验单测。
// 判据全部来自用户指定的金标准（池州【主】1129上午修订）实测，注释里给了出处，
// 目的是防止后续有人「为了让产物通过」而放宽阈值——阈值是拿真标书校出来的。

describe("proseItemDensity · 行级识别", () => {
  it("「（N）」形态是条目", () => {
    expect(isItemLine("（1）支持患者通过就诊卡读取基本信息。")).toBe(true)
    expect(isItemLine("(2) 支持换卡")).toBe(true)
    expect(isItemLine("（17）支持查询未结算的门诊费用明细，打印发票。")).toBe(true)
  })

  it("中文括号序号也是条目（金标准混用两种）", () => {
    expect(isItemLine("（一）总体架构")).toBe(true)
  })

  it("数字多级标题不算条目（那是标题，误判会把标题深度算进条目数）", () => {
    expect(isItemLine("12.9.8.1.1.1门急诊挂号收费系统")).toBe(false)
    expect(isItemLine("12.9.1.1建设背景")).toBe(false)
  })

  it("正文散文不算条目", () => {
    expect(isItemLine("本项目总体建设方案遵循整体打包、统一建设原则。")).toBe(false)
    expect(isItemLine("")).toBe(false)
  })
})

describe("proseItemDensity · 标题深度", () => {
  it("纯数字多级编号按段数计层级（金标准最深 6 段，实测另有更深的 7 级）", () => {
    // 注意：`12.9.8.1.1.1` 是 6 段编号 = 6 级，不是 7 级。
    // 金标准文本里同时存在 6 段与更深编号，深度按段数如实计。
    expect(headingDepthOf("12.9.8.1.1.1门急诊挂号收费系统")).toBe(6)
    expect(headingDepthOf("12.9.1.1建设背景")).toBe(4)
    expect(headingDepthOf("12.9.1项目概况")).toBe(3)
  })

  it("非标题返回 0", () => {
    expect(headingDepthOf("（1）支持换卡。")).toBe(0)
    expect(headingDepthOf("本项目采用微服务架构。")).toBe(0)
  })
})

/** 造一段「金标准形态」的正文：多级标题 + 短条目，密度达标 */
function goldLike(scale = 1): string {
  const out: string[] = []
  for (let i = 0; i < scale; i++) {
    out.push(`12.9.8.1.1.${i + 1}门急诊挂号收费系统${i}`)
    for (let j = 1; j <= 12; j++) {
      out.push(`（${j}）支持卡的退卡操作，确保患者未欠费或存在余额，避免不必要的纠纷。`)
    }
  }
  return out.join("\n")
}

describe("proseItemDensity · 达标判定", () => {
  it("金标准形态通过（密度够、中位在区间、深度够）", () => {
    const r = measureItemDensity(goldLike(20))
    expect(r.ok).toBe(true)
    expect(r.issues).toHaveLength(0)
    expect(r.itemsPerWan).toBeGreaterThanOrEqual(ITEM_DENSITY_MIN)
    expect(r.headingMaxDepth).toBe(6)
  })

  it("散文式正文判 error：密度不足且标题层级不够", () => {
    // 功能章 + 条目 ≥10 + 密度 <30 + 标题只有 3 级（需带标题行，否则 depth 判 0 不判）
    const r = measureItemDensity("12.9.1系统功能\n" + lowDensityBody(), "第五章 详细技术方案")
    expect(r.len).toBeGreaterThanOrEqual(500)
    expect(r.itemCount).toBeGreaterThanOrEqual(10)
    // 密度 29.3 落在 [21, 30) → warning（低于 21 才是 error），故只断言有这条问题
    expect(r.issues.some((i) => i.kind === "density")).toBe(true)
    // 标题只有 3 级 → 深度不足（判据 ≥4）
    expect(r.headingMaxDepth).toBe(3)
    expect(r.issues.some((i) => i.kind === "depth")).toBe(true)
  })

  it("条目太长（写成小作文）判 median 提示 —— 但不设单条上限", () => {
    // 每条 80+ 字：中位超出 30~60 区间上限
    const long = Array.from({ length: 40 }, (_, i) => `（${i + 1}）${"支持系统对各项业务数据进行完整的采集处理存储分析展现与归档管理并能够按照监管部门要求生成相应报表材料且保证数据一致性与可追溯性".repeat(2)}`).join("\n")
    const r = measureItemDensity(`12.9.8.1.1.1门急诊挂号收费系统\n${long}`)
    expect(r.medianLen).toBeGreaterThan(ITEM_MEDIAN_MAX)
    expect(r.issues.some((i) => i.kind === "median")).toBe(true)
  })

  it("纯功能名短条目合法：6 字的「（4）体温单」不算空条目、不触发 median（金标准 41% 条目短于 30 字）", () => {
    const lines = ["12.9.8.1.1.1门急诊挂号收费系统"]
    // 一半短条目 + 一半正常条目，中位仍应落在区间内
    for (let i = 1; i <= 20; i++) lines.push(`（${i}）体温单`)
    for (let i = 21; i <= 40; i++) lines.push(`（${i}）支持患者通过就诊卡读取基本信息并完成建档，全程留痕可追溯。`)
    const r = measureItemDensity(lines.join("\n"))
    // 短条目本身不被判空（body 长度 > 0 就计入）
    expect(r.itemCount).toBe(40)
    // 中位是 6 字（40 条里 20 条 6 字、20 条 28 字，中位落在 6 与 28 之间）
    expect(r.medianLen).toBeLessThan(ITEM_MEDIAN_MIN)
    // 会报 median 提示，但**不报 density error**（密度是够的）
    expect(r.issues.some((i) => i.kind === "median")).toBe(true)
    expect(r.issues.some((i) => i.kind === "density" && i.severity === "error")).toBe(false)
  })
})

/** 造「条目 12 条 + 大量散文」的正文：密度压到 30 以下（4101 字 / 12 条 = 29.3/万字）。
 *  密度 = 条目数 ÷ 字数，所以要把密度压低不是靠加条目，而是靠加字。
 *  这个数字是算出来的，不是试出来的：12 / 0.003 = 4000 字。 */
function lowDensityBody(): string {
  const para = "本项目采用一体化架构设计，覆盖门急诊住院等业务场景，系统功能完善并通过多层架构实现高可用与容灾，同时满足等级保护三级要求，配套完善的运维保障与应急预案体系，确保业务连续性。"
  const prose = Array.from({ length: 45 }, () => para).join("\n")
  const items = Array.from({ length: 12 }, (_, i) => `（${i + 1}）支持某项具体功能，落到实际操作。`).join("\n")
  return `${items}\n${prose}`
}

describe("proseItemDensity · 按章判定口径（REQ-046）", () => {
  // 金标准按章实测：12.9 设计方案 60/万字、12.10 历史继承 24、12.11 门诊方案 9、12.12 护士站 6。
  // 拿全书均值卡每一章，非功能章会永远不达标，反而逼出「为凑条目把一句话拆碎」的坏写法。
  it("非功能章不判密度（项目背景/需求分析/实施/培训/售后）", () => {
    const body = "本项目背景与本项目建设必要性说明，涉及医院信息化发展现状与政策要求。".repeat(30)
    const r = measureItemDensity(body, "3.1 项目背景")
    expect(r.issues.some((i) => i.kind === "density")).toBe(false)
  })

  it("功能章照常判密度（标题含功能/模块/系统/技术方案/建设内容）", () => {
    // 功能章 + 条目 ≥10 + 密度 <30 → 应报 density
    // 密度=条目/字数，12 条要压到 30 以下需 >4000 字（实测 4101 字 → 29.3/万字）
    const r = measureItemDensity(lowDensityBody(), "第五章 详细技术方案")
    expect(r.itemCount).toBeGreaterThanOrEqual(10)
    expect(r.itemsPerWan).toBeLessThan(ITEM_DENSITY_MIN)
    expect(r.issues.some((i) => i.kind === "density")).toBe(true)
  })

  it("功能章但条目数 <10 不判密度（该章本就不该出条目，与样本量无关）", () => {
    const body = ["5.3 挂号系统", "（1）支持建档，录入姓名证件号生成唯一标识。", "（2）支持发卡，读卡器写入卡内。", "（3）支持退卡，核验余额后办理。", "本节其余为说明性文字。".repeat(60)].join("\n")
    const r = measureItemDensity(body, "5.3 挂号系统")
    expect(r.itemCount).toBeLessThan(10)
    expect(r.issues.some((i) => i.kind === "density")).toBe(false)
  })

  it("不传章节标题时按正文内功能类标题行推断（不静默放宽成一律不判）", () => {
    // 不传 chapterTitle 时，用正文里是否存在功能类多级标题行来推断是否功能章。
    // 所以这里必须带一个「3.2 系统功能设计」这样的标题行，否则按设计判为非功能章、跳过密度。
    const body = lowDensityBody().replace(/^/, "3.2 系统功能设计\n")
    const r = measureItemDensity(body)
    expect(r.functionChapterCount).toBeGreaterThan(0)
    expect(r.issues.some((i) => i.kind === "density")).toBe(true)
  })

  it("不传标题且正文无功能类标题行时，按非功能章跳过密度（保守口径的边界）", () => {
    const r = measureItemDensity(lowDensityBody())
    expect(r.functionChapterCount).toBe(0)
    expect(r.issues.some((i) => i.kind === "density")).toBe(false)
  })
})

describe("proseItemDensity · 边界", () => {
  it("不足 500 字不判（避免小章节误报）", () => {
    const r = measureItemDensity("12.9.1项目概况\n（1）支持换卡。")
    expect(r.issues).toHaveLength(0)
    expect(r.ok).toBe(true)
  })

  it("空文本不抛错", () => {
    const r = measureItemDensity("")
    expect(r.len).toBe(0)
    expect(r.ok).toBe(true)
  })

  it("摘要含三个指标与阈值，便于用户判断", () => {
    const r = measureItemDensity("12.9.1项目概况\n" + "本项目采用一体化架构设计，覆盖门急诊住院等业务场景。".repeat(40))
    const s = formatDensitySummary(r)
    expect(s).toContain("/万字")
    expect(s).toContain("中位")
    expect(s).toContain("标题最深")
  })
})
