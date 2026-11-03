import { describe, expect, it } from "vitest"
import {
  OUTLINE_DIAG_DEDUPE_MS,
  buildOutlineDiag,
  classifyOutlineFailure,
  describeOutlineDiag,
  formatCharCount,
  isSameOutlineDiag,
  outlineDiagLabel,
  parseOutlineDiag,
  shouldRecordOutlineDiag,
  type OutlineDiag,
} from "./outlineDiagnostics"
import { SNAPSHOT_DIAG_KEY, type ParseReport, type ParseSection } from "./bidTypes"

const section = (key: string, content: string, status?: ParseSection["status"]): ParseSection =>
  ({ key, title: key, content, status }) as ParseSection

const report = (sections: ParseSection[]): ParseReport => ({ sections }) as ParseReport

describe("R56（B27）失败分类：判据全部取自本仓真实报文", () => {
  it("登录失效按类名判定（AuthRequiredError 是 hook 内私有类，故按 name 而非 instanceof）", () => {
    const e = new Error("登录状态已失效，请重新登录")
    e.name = "AuthRequiredError"
    expect(classifyOutlineFailure(e).kind).toBe("auth")
  })

  it("模型返回散文 → non_json；返回空内容 → empty_reply（withJsonRepair 的两条专门报文）", () => {
    const prose = new Error(
      "模型未按 JSON 格式返回（本次返回的是非结构化文本，如「好的，我来分析这份招标文件…」），已中止而非生成空结果。请重试；若反复出现，请在「模型配置」切换其他模型，或减少本次生成的输入规模。",
    )
    expect(classifyOutlineFailure(prose).kind).toBe("non_json")
    const empty = new Error("模型未按 JSON 格式返回（本次返回的是空内容），已中止而非生成空结果。请重试")
    expect(classifyOutlineFailure(empty).kind).toBe("empty_reply")
  })

  it("大纲结构类失败：格式解析失败 / 结果为空 / 分步未产出技术章", () => {
    expect(classifyOutlineFailure(new Error("大纲格式解析失败，请重试")).kind).toBe("json_parse")
    expect(
      classifyOutlineFailure(new Error("大纲生成结果为空，未产出任何章节，请重试；若反复出现请切换模型或减少输入规模")).kind,
    ).toBe("empty_outline")
    expect(classifyOutlineFailure(new Error("分步大纲未产出技术章，请重试")).kind).toBe("empty_outline")
  })

  it("传输/网关类失败：超时 / 网络 / 限流额度", () => {
    expect(classifyOutlineFailure(new Error("请求超时（120s）")).kind).toBe("timeout")
    expect(classifyOutlineFailure(new Error("Failed to fetch")).kind).toBe("network")
    expect(classifyOutlineFailure(new Error("HTTP 503 Service Unavailable")).kind).toBe("network")
    expect(classifyOutlineFailure(new Error("429 Too Many Requests：额度不足")).kind).toBe("model_api")
  })

  it("认不出来的报文归 unknown，但必须保留原始报文（截断 200 字）供排障", () => {
    const cls = classifyOutlineFailure(new Error("x".repeat(400)))
    expect(cls.kind).toBe("unknown")
    expect(cls.detail).toHaveLength(200)
    expect(classifyOutlineFailure(undefined).kind).toBe("unknown")
  })
})

describe("R56（B27）诊断记录：把「多大、多久、哪一步」留成证据", () => {
  it("字数展示：≥1 万转万字（与审计文档口径一致）", () => {
    expect(formatCharCount(0)).toBe("0 字")
    expect(formatCharCount(9999)).toBe("9999 字")
    expect(formatCharCount(103474)).toBe("10.3 万字")
    expect(formatCharCount(762209)).toBe("76.2 万字")
  })

  it("解析规模与覆盖率口径同源：parseChars = 各分区正文非空白字符合计", () => {
    const d = buildOutlineDiag({
      kind: "timeout",
      report: report([section("tech_score", "评 分 办 法", "ok"), section("void_items", "  ", "ok")]),
      tenderChars: 762209,
      startedAt: 1_000,
      at: 129_400,
    })
    expect(d.parseChars).toBe(4)
    expect(d.durationMs).toBe(128_400)
    expect(d.reason).toBe("模型请求超时")
    expect(d.at).toBe("1970-01-01T00:02:09.400Z")
  })

  it("拦截类记录带上缺项 key 与中文标题，且标题判据与判定同源（空态占位也要给得出名字）", () => {
    // 真实数据 313131 的形状：bid_outline_req 分区存在、content 是空态占位「原文未提及」、无 status。
    // 旧实现用 missingSectionTitles 取中文名 → 名单为空，红字提示变成「关键解析项缺失：」。
    const rep = report([section("tech_score", "评分办法正文", "ok"), section("bid_outline_req", "原文未提及")])
    const d = buildOutlineDiag({
      kind: "blocked_critical",
      reason: "关键解析项缺失：投标文件目录要求",
      report: rep,
      tenderChars: 762209,
      criticalMissing: ["bid_outline_req"],
      coveragePct: 8,
    })
    expect(d.criticalMissing).toEqual(["bid_outline_req"])
    expect(d.criticalMissingTitles).toEqual(["投标文件目录要求"])
    expect(outlineDiagLabel(d)).toBe("大纲生成被拦：关键解析项缺失：投标文件目录要求（招标 76.2 万字 · 判缺 投标文件目录要求）")
    expect(describeOutlineDiag(d)).toContain("解析覆盖率：8%")
  })

  it("失败类 label 用「失败」措辞，拦截类用「被拦」措辞，两者都不含正文片段", () => {
    const failed = buildOutlineDiag({ kind: "empty_outline", report: null, tenderChars: 231917, staged: true })
    expect(outlineDiagLabel(failed)).toBe("大纲生成失败：模型返回的大纲为空（无任何章节）（招标 23.2 万字 · 分步生成）")
    expect(outlineDiagLabel(failed)).not.toContain("正文")
    const blocked = buildOutlineDiag({ kind: "blocked_no_report", report: null, tenderChars: 0 })
    expect(outlineDiagLabel(blocked).startsWith("大纲生成被拦：")).toBe(true)
  })
})

describe("R56（B27）同因连点抑制：跨时间的重复失败必须留证", () => {
  const at = (ms: number): OutlineDiag =>
    buildOutlineDiag({ kind: "empty_outline", report: null, tenderChars: 100, at: ms })

  it("第一次必记；同因 5 秒内视为连点丢弃；超过窗口如实记录", () => {
    const first = at(1_000_000)
    expect(shouldRecordOutlineDiag(null, first)).toBe(true)
    expect(isSameOutlineDiag(first, at(1_000_000 + OUTLINE_DIAG_DEDUPE_MS - 1))).toBe(true)
    expect(shouldRecordOutlineDiag(first, at(1_000_000 + OUTLINE_DIAG_DEDUPE_MS - 1))).toBe(false)
    expect(shouldRecordOutlineDiag(first, at(1_000_000 + OUTLINE_DIAG_DEDUPE_MS))).toBe(true)
    expect(shouldRecordOutlineDiag(first, at(1_000_000 + 60_000))).toBe(true)
  })

  it("原因不同（哪怕同类）照样记", () => {
    const a = buildOutlineDiag({ kind: "blocked_critical", report: null, tenderChars: 1, criticalMissing: ["void_items"], at: 5_000 })
    const b = buildOutlineDiag({ kind: "blocked_critical", report: null, tenderChars: 1, criticalMissing: ["bid_outline_req"], at: 5_100 })
    expect(isSameOutlineDiag(a, b)).toBe(false)
    expect(shouldRecordOutlineDiag(a, b)).toBe(true)
  })
})

describe("R56（B27）读回：payload 里的 diag 可被解析，坏数据不炸", () => {
  it("往返一致", () => {
    const d = buildOutlineDiag({
      kind: "blocked_critical",
      report: report([section("void_items", "原文未提及")]),
      tenderChars: 103474,
      criticalMissing: ["void_items"],
      coveragePct: 12,
      at: 42,
    })
    const back = parseOutlineDiag({ [SNAPSHOT_DIAG_KEY]: JSON.parse(JSON.stringify(d)) as unknown })
    expect(back).toEqual(d)
  })

  it("无 diag / 形状不对一律返回 null（面板据此回退到普通摘要）", () => {
    expect(parseOutlineDiag(null)).toBeNull()
    expect(parseOutlineDiag({})).toBeNull()
    expect(parseOutlineDiag({ [SNAPSHOT_DIAG_KEY]: "不是对象" })).toBeNull()
    expect(parseOutlineDiag({ [SNAPSHOT_DIAG_KEY]: { reason: "缺 kind" } })).toBeNull()
  })
})
