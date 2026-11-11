import { describe, expect, it } from "vitest"
import { GATE_STATUS_LABEL, buildCheckModel, type BuildInput } from "./checkGateModel"
import { DEFAULT_FORMAT_SETTINGS, type BidProjectRecord, type VoidItem } from "./bidTypes"
import type { Chapter } from "../SolutionStudio/solutionTypes"

// UX-v2 ⑥ 交卷自查四闸门：本屏唯一不能错的是**「没跑过」不能显示成「已通过」**
// （本仓假绿红线：format_check_not_run 就是为这个加的）。这组测试逐闸门锁三态，
// 并锁问题清单的排序与级别（阻断 > 警告 > 提示）。

const chapter = (title: string, content: string): Chapter => ({
  node_id: title,
  title,
  sections: [],
  content,
  gen_status: "done",
})

const voidItem = (over: Partial<VoidItem>): VoidItem => ({
  id: over.id ?? "v1",
  clause: over.clause ?? "未按格式密封的，按无效投标处理",
  source_location: over.source_location ?? "第 20 条",
  response: "",
  response_location: "",
  status: over.status ?? "compliant",
  severity: over.severity ?? "critical",
  suggestion: "",
  evidence: "",
  reason: "",
  manual_checked: over.manual_checked ?? false,
  manual_status: over.manual_status ?? "",
  review_status: over.review_status ?? "pending",
  skip_reason: "",
  ...over,
})

const project = (over: Partial<BidProjectRecord> = {}): BuildInput["project"] =>
  ({
    void_check: null,
    bid_chapters: [],
    submission_check: null,
    format_settings: null,
    identity_words: "",
    ...over,
  }) as BuildInput["project"]

const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  project: project(),
  format: DEFAULT_FORMAT_SETTINGS,
  deviationUncovered: 0,
  deviationTotal: 0,
  ...over,
})

describe("空项目：四闸门全部「未运行」，绝不显示为通过", () => {
  it("四道闸门都在，状态全是 not_run，allPass=false", () => {
    const m = buildCheckModel(base())
    expect(m.gates.map((g) => g.id)).toEqual(["void", "consistency", "sealed", "format"])
    expect(m.gates.every((g) => g.status === "not_run")).toBe(true)
    expect(m.allPass).toBe(false)
    expect(m.hasNotRun).toBe(true)
    expect(m.issues).toHaveLength(0)
  })

  it("三态文案齐全（通过 / 未通过 / 未运行）", () => {
    expect(GATE_STATUS_LABEL).toEqual({ pass: "通过", fail: "未通过", not_run: "未运行" })
  })
})

describe("① 废标闸门", () => {
  it("critical 未核销 → fail 并进问题清单（阻断级）", () => {
    const m = buildCheckModel(
      base({
        project: project({
          void_check: {
            items: [voidItem({ status: "non_compliant", review_status: "pending" })],
            checked_at: "2026-11-11",
          },
        }),
      }),
    )
    const gate = m.gates.find((g) => g.id === "void")!
    expect(gate.status).toBe("fail")
    expect(m.blockCount).toBe(1)
    expect(m.issues[0].category).toBe("废标")
    expect(m.issues[0].level).toBe("block")
    expect(m.issues[0].step).toBe(5)
  })

  it("全部合规应答 + 偏离表全应答 → pass", () => {
    const m = buildCheckModel(
      base({
        project: project({
          void_check: {
            items: [voidItem({ status: "compliant", review_status: "addressed" })],
            checked_at: "2026-11-11",
          },
        }),
        deviationTotal: 10,
        deviationUncovered: 0,
      }),
    )
    const gate = m.gates.find((g) => g.id === "void")!
    expect(gate.status).toBe("pass")
    expect(gate.headline).toContain("1 / 1")
  })

  it("废标合规但偏离表有未应答 → fail（两件都算这个闸门）", () => {
    const m = buildCheckModel(
      base({
        project: project({
          void_check: { items: [voidItem({ status: "compliant" })], checked_at: "x" },
        }),
        deviationTotal: 10,
        deviationUncovered: 3,
      }),
    )
    const gate = m.gates.find((g) => g.id === "void")!
    expect(gate.status).toBe("fail")
    // 未应答同时进问题清单（提示级）
    expect(m.issues.some((i) => i.category === "偏离表" && i.level === "info")).toBe(true)
  })
})

describe("② 一致性闸门", () => {
  it("跨章同指标多值 → fail，并在清单里列出两个值", () => {
    const m = buildCheckModel(
      base({
        project: project({
          bid_chapters: [
            chapter("技术方案", "系统可用性：99.9%\n响应时间：2 小时"),
            chapter("运维方案", "系统可用性：99.5%"),
          ],
        }),
      }),
    )
    const gate = m.gates.find((g) => g.id === "consistency")!
    expect(gate.status).toBe("fail")
    expect(gate.headline).toContain("1 处不一致")
    const issue = m.issues.find((i) => i.category === "一致性")!
    expect(issue.title).toContain("99.9%")
    expect(issue.title).toContain("99.5%")
  })

  it("有正文且跨章无数值冲突 → 本地扫描子项通过；但事实核对没跑过，整闸门仍是「未运行」", () => {
    const m = buildCheckModel(base({ project: project({ bid_chapters: [chapter("技术方案", "系统可用性：99.9%")] }) }))
    const gate = m.gates.find((g) => g.id === "consistency")!
    // 本地跨章扫描零成本、随正文自动跑：这一项可以判「一致」
    const local = gate.checks.find((c) => c.label.includes("跨章指标"))!
    expect(local.ok).toBe(true)
    expect(local.verdict).toBe("一致")
    // 但「与招标事实核对」要交卷体检才跑；没跑就不能让整闸门显示「通过」
    expect(gate.status).toBe("not_run")
  })

  it("交卷体检跑过且事实核对返回 []（无矛盾）→ 整闸门通过", () => {
    const m = buildCheckModel(
      base({
        project: project({
          bid_chapters: [chapter("技术方案", "系统可用性：99.9%")],
          submission_check: { items: [], checked_at: "x", fact_conflicts: [] } as never,
        }),
      }),
    )
    expect(m.gates.find((g) => g.id === "consistency")!.status).toBe("pass")
  })

  it("有正文但事实核对没跑过（fact_conflicts=null）→ 子项显示未运行，不当成一致", () => {
    const m = buildCheckModel(base({ project: project({ bid_chapters: [chapter("技术方案", "正文")] }) }))
    const gate = m.gates.find((g) => g.id === "consistency")!
    const factCheck = gate.checks.find((c) => c.label.includes("招标事实"))!
    expect(factCheck.ok).toBeNull()
    expect(factCheck.verdict).toBe("未运行")
  })
})

describe("③ 暗标闸门", () => {
  it("未开暗标也未设身份词 → not_run（不假装查过）", () => {
    const m = buildCheckModel(base())
    expect(m.gates.find((g) => g.id === "sealed")!.status).toBe("not_run")
  })

  it("开了暗标且 format_report 无 identity_leak 命中 → pass", () => {
    const m = buildCheckModel(
      base({
        format: { ...DEFAULT_FORMAT_SETTINGS, sealed: true },
        project: project({
          format_settings: { ...DEFAULT_FORMAT_SETTINGS, sealed: true },
          submission_check: { items: [], checked_at: "x", format_report: { hits: [], checked_at: "x" } } as never,
        }),
      }),
    )
    expect(m.gates.find((g) => g.id === "sealed")!.status).toBe("pass")
  })
})

describe("④ 格式闸门", () => {
  it("format_report 缺失 → not_run（不是 pass）", () => {
    const m = buildCheckModel(base())
    expect(m.gates.find((g) => g.id === "format")!.status).toBe("not_run")
  })

  it("format_check_not_run 留痕 → 视为未运行，且不混进问题清单", () => {
    const m = buildCheckModel(
      base({
        project: project({
          submission_check: {
            items: [],
            checked_at: "x",
            format_report: {
              hits: [{ chapter: "（全文）", rule: "format_check_not_run", quote: "检查项全部关闭", level: "warn" }],
              checked_at: "x",
            },
          } as never,
        }),
      }),
    )
    const gate = m.gates.find((g) => g.id === "format")!
    expect(gate.status).toBe("not_run")
    expect(m.issues).toHaveLength(0)
  })

  it("废标级格式规则命中 → 阻断级；普通规则命中 → 警告级", () => {
    const m = buildCheckModel(
      base({
        project: project({
          submission_check: {
            items: [],
            checked_at: "x",
            format_report: {
              hits: [
                { chapter: "第 3 章", rule: "star_quote_fidelity", quote: "★条款引文被删节", level: "warn" },
                { chapter: "第 4 章", rule: "markdown_residue", quote: "**加粗** 残留", level: "warn" },
              ],
              checked_at: "x",
            },
          } as never,
        }),
      }),
    )
    const gate = m.gates.find((g) => g.id === "format")!
    expect(gate.status).toBe("fail")
    const fatal = m.issues.find((i) => i.title.includes("引文保真"))!
    expect(fatal.level).toBe("block")
    const warn = m.issues.find((i) => i.title.includes("Markdown"))!
    expect(warn.level).toBe("warn")
  })

  it("全部规则无命中 → pass", () => {
    const m = buildCheckModel(
      base({
        project: project({
          submission_check: { items: [], checked_at: "x", format_report: { hits: [], checked_at: "x" } } as never,
        }),
      }),
    )
    expect(m.gates.find((g) => g.id === "format")!.status).toBe("pass")
  })
})

describe("问题清单排序与汇总", () => {
  it("阻断在前、警告次之、提示最后；三类计数正确", () => {
    const m = buildCheckModel(
      base({
        project: project({
          void_check: { items: [voidItem({ id: "v", status: "non_compliant" })], checked_at: "x" },
          bid_chapters: [chapter("A", "系统可用性：99.9%"), chapter("B", "系统可用性：99.5%")],
          submission_check: {
            items: [],
            checked_at: "x",
            format_report: {
              hits: [{ chapter: "C", rule: "markdown_residue", quote: "**x**", level: "warn" }],
              checked_at: "x",
            },
          } as never,
        }),
        deviationTotal: 5,
        deviationUncovered: 2,
      }),
    )
    expect(m.issues[0].level).toBe("block")
    expect(m.issues[m.issues.length - 1].level).toBe("info")
    expect(m.blockCount + m.warnCount + m.infoCount).toBe(m.issues.length)
    expect(m.warnCount).toBeGreaterThanOrEqual(2)
  })

  it("四闸门全绿时 allPass=true 且无问题", () => {
    const sealedFmt = { ...DEFAULT_FORMAT_SETTINGS, sealed: false }
    const m = buildCheckModel({
      project: project({
        void_check: { items: [voidItem({ status: "compliant" })], checked_at: "x" },
        bid_chapters: [chapter("A", "系统可用性：99.9%")],
        // 事实核对跑过且无矛盾（[] 而非 null）
        submission_check: { items: [], checked_at: "x", format_report: { hits: [], checked_at: "x" }, fact_conflicts: [] } as never,
        identity_words: "",
      }),
      format: sealedFmt,
      deviationTotal: 5,
      deviationUncovered: 0,
    })
    expect(m.blockCount).toBe(0)
    expect(m.warnCount).toBe(0)
    expect(m.infoCount).toBe(0)
    // 暗标闸门在「未开暗标 + 无身份词」时是 not_run，所以整体不是 allPass——这是刻意的
    expect(m.gates.find((g) => g.id === "sealed")!.status).toBe("not_run")
    expect(m.allPass).toBe(false)
    expect(m.hasNotRun).toBe(true)
  })
})
