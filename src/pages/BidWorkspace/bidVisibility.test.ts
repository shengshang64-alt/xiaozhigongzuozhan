// R50（P0-3 长文可见性）行为单测：证据包选取 / 可见性报告 / 提示词接线 / 未知态不落地。
// 断言对象是行为（模式、覆盖章、命中与否、注入文本内容、丢失字数），不是「不抛错」。
import { describe, expect, it } from "vitest"
import {
  BID_VISIBILITY_BUDGET_CHARS,
  bidEvidenceBlock,
  chunkBidText,
  deriveClauseTerms,
  describeBidVisibility,
  parseBidTextBlocks,
  selectBidEvidence,
  selectEvidenceChunks,
  BID_VISIBILITY_CONTRACT_DEVIATION,
  BID_VISIBILITY_CONTRACT_VOID,
} from "./bidVisibility"
import { buildDeviationMapMessages } from "./prompts/deviationMap"
import { buildVoidCheckMessages } from "./prompts/voidCheck"
import { buildVoidScopeMessages } from "./prompts/voidCheckRounds"
import {
  deviationCommitHits,
  deviationExportSummary,
  deviationStats,
  markInvisibleDeviationRows,
  sanitizeDeviationRows,
  type DeviationRow,
  type RequirementClause,
} from "./bidTypes"

/** 造章：第 N 章 + 若干正文行 */
const chap = (n: number, title: string, body: string) => `第${n}章 ${title}\n${body}`
/** 重复到指定字数（内容含 keyword，便于检索命中） */
const fill = (keyword: string, times: number) => Array.from({ length: times }, () => `本公司在${keyword}方面的响应说明：${keyword}已按要求完整响应并提供证明材料。`).join("\n")

describe("P0-3 §1 输入可见性报告：短文本=全文完整注入", () => {
  const text = chap(3, "资质证明", "本公司持有 ISO9001 质量管理体系认证证书，编号 CN-2001-0007。")
  const pack = selectBidEvidence(text, ["投标人须提供 ISO9001 质量管理体系认证证书"])

  it("mode=full / input_complete=true / 注入文本与原文逐字相同", () => {
    expect(pack.report.mode).toBe("full")
    expect(pack.report.input_complete).toBe(true)
    expect(pack.report.omitted_chars).toBe(0)
    expect(pack.text).toBe(text.trim())
    expect(text.length).toBeLessThanOrEqual(BID_VISIBILITY_BUDGET_CHARS)
  })

  it("可见性说明块如实写「输入完整：是」——程序生成、非模型推断", () => {
    expect(pack.note).toContain("输入完整：是")
    expect(pack.note).toContain("程序生成，非模型推断")
    expect(pack.note).toContain("全文完整注入")
  })

  it("user 消息里素材段 = 说明块 + 正文，且带【投标文件正文】标题", () => {
    const block = bidEvidenceBlock(pack)
    expect(block.startsWith(pack.note)).toBe(true)
    expect(block).toContain("【投标文件正文】")
    expect(block).toContain("CN-2001-0007")
    expect(bidEvidenceBlock(pack, "投标文件正文（按条款定向检索注入的片段）")).toContain("按条款定向检索")
  })

  it("toast 文案：完整注入时不得暗示有未注入内容", () => {
    const s = describeBidVisibility(pack, "废标自查")
    expect(s).toBe(`废标自查：投标正文全文 ${text.trim().length} 字已完整注入模型`)
  })
})

describe("P0-3 §2 输入可见性报告：超预算=定向检索，且未注入范围必须写明", () => {
  const longText = [
    chap(1, "投标函", fill("投标函与法定代表人身份证明", 40)),
    chap(2, "资质证明", fill("ISO9001 质量管理体系认证证书", 40)),
    chap(3, "技术方案", fill("技术方案与国产化适配", 40)),
  ].join("\n")
  const budget = 6000
  const pack = selectBidEvidence(longText, [{ id: "c2", text: "投标人须提供 ISO9001 质量管理体系认证证书" }], budget)

  it("超预算即 mode=retrieval + input_complete=false（不得再声称输入完整）", () => {
    expect(longText.length).toBeGreaterThan(budget)
    expect(pack.report.mode).toBe("retrieval")
    expect(pack.report.input_complete).toBe(false)
    expect(pack.report.omitted_chars).toBeGreaterThan(0)
    expect(pack.report.selected_chunks).toBeGreaterThan(0)
    expect(pack.report.selected_chunks).toBeLessThan(pack.report.total_chunks)
  })

  it("注入片段带稳定来源标识（第N章/块K），与分块口径同源", () => {
    const chunkIds = chunkBidText(longText).map((c) => c.id)
    expect(pack.text).toContain("【投标签片段 1/")
    expect(pack.text).toContain("来源：")
    for (const src of pack.clauses.flatMap((c) => c.sources)) expect(chunkIds).toContain(src)
    const chapterRefs = parseBidTextBlocks(longText).map((b) => b.ref)
    for (const ref of pack.report.covered_chapters) expect(chapterRefs).toContain(ref)
  })

  it("命中的条款指向对的那一章（资质条款→第2章 资质证明）", () => {
    expect(pack.report.covered_chapters).toEqual(["第2章 资质证明"])
    expect(pack.clauses[0].hit).toBe(true)
    expect(pack.clauses[0].sources.join()).toContain("第2章 资质证明")
    expect(pack.text).toContain("ISO9001 质量管理体系认证证书")
  })

  it("说明块逐条列出「本次检索不到证据」的条款并要求降级为 partial", () => {
    const p2 = selectBidEvidence(longText, [{ id: "c1", text: "提供 ISO9001 认证" }, { id: "c9", text: "提供量子加密卫星链路标的检测报告" }], budget)
    const missed = p2.clauses.filter((c) => !c.hit).map((c) => c.ref)
    expect(missed).toEqual(["c9"])
    expect(p2.note).toContain("输入完整：否")
    expect(p2.note).toContain("本次注入范围内检索不到对应证据：c9")
    expect(p2.note).toContain("不得判 non_compliant")
    expect(p2.note).toContain("需人工核对未注入部分")
    expect(describeBidVisibility(p2, "废标自查")).toContain("条款 c9 无可见证据，已降级为待人工核对")
  })

  it("纯函数：同输入两次调用完全一致（无时间/随机依赖）", () => {
    expect(selectBidEvidence(longText, [{ id: "c2", text: "ISO9001 认证证书" }], budget)).toEqual(
      selectBidEvidence(longText, [{ id: "c2", text: "ISO9001 认证证书" }], budget),
    )
  })
})

describe("P0-3 §3 条款轮转：预算紧张时后面的条款也必须有可见证据", () => {
  // 第1条条款的关键词铺满 4 章，第2条只出现在第5章——按分排序「取前 N 块」会让第2条永远无可见证据
  const text = [
    chap(1, "需求理解", fill("国产化操作系统适配", 20)),
    chap(2, "总体设计", fill("国产化操作系统适配", 20)),
    chap(3, "功能清单", fill("国产化操作系统适配", 20)),
    chap(4, "实施计划", fill("国产化操作系统适配", 20)),
    chap(5, "商务报价", fill("投标报价未超过最高限价 1200 万元", 20)),
  ].join("\n")
  const clauses = [
    { id: "c1", text: "系统须支持国产化操作系统适配" },
    { id: "c2", text: "投标报价不得超过最高限价 1200 万元" },
  ]
  const pack = selectBidEvidence(text, clauses, 2600)

  it("预算只够 2 段时，第2条条款仍被选中（轮转而非贪心）", () => {
    expect(pack.report.selected_chunks).toBe(2)
    expect(pack.clauses[1].hit).toBe(true)
    expect(pack.clauses[1].sources.join()).toContain("第5章 商务报价")
    expect(pack.report.covered_chapters).toContain("第5章 商务报价")
  })
})

describe("P0-3 §4 检索无命中：回退首尾节选，且绝不产出「确定不存在」", () => {
  const text = Array.from({ length: 400 }, (_, i) => `第${i}行：本页为无关内容占位。`).join("\n")
  const clauses = ["提供量子纠缠加密卫星链路的第三方检测报告"]

  it("mode=truncated + 首尾截断标记 + 全部条款 hit=false", () => {
    const pack = selectBidEvidence(text, clauses, 3000)
    expect(pack.report.mode).toBe("truncated")
    expect(pack.report.input_complete).toBe(false)
    expect(pack.report.selected_chunks).toBe(0)
    expect(pack.report.covered_chapters).toEqual([])
    expect(pack.text).toContain("[中间内容因篇幅限制省略]")
    expect(pack.clauses.every((c) => !c.hit)).toBe(true)
    expect(pack.report.warnings.join()).toContain("按条款检索无命中")
    expect(pack.report.warnings.join()).toContain("一律降级为待人工核对")
  })

  it("空文本不伪装成证据：素材段给显式占位符", () => {
    const pack = selectBidEvidence("   ", clauses)
    expect(pack.text).toBe("")
    expect(pack.note).toBe("")
    expect(bidEvidenceBlock(pack)).toContain("（本次无可注入的投标文件正文）")
  })
})

describe("P0-3 §5 检索召回：PDF 字间空格/竖线与「提供+名词」粘词不得系统性漏召回", () => {
  const body = [
    "第1章 项目理解",
    "采 | 购 | 人 名称：某某中医院。",
    "采 | 购 | 人 联系人：张工。",
    "验收证明：见附件三，已随投标文件提交。",
  ].join("\n")
  const filler = "\n" + "与本条无关的填充说明。".repeat(300)
  const clauses = [
    { id: "c1", text: "投标人须提供采购人的验收证明" },
    { id: "c2", text: "采购人名称须与营业执照一致" },
  ]
  const pack = selectBidEvidence(body + filler, clauses, 2000)

  it("字间空格/竖线（「采 | 购 | 人」）经归一化后仍能命中", () => {
    expect(pack.report.mode).toBe("retrieval")
    expect(pack.clauses.map((c) => c.hit)).toEqual([true, true])
  })

  it("「提供采购人」式粘词要拆出「采购人」——否则整条条款永远检索不到证据", () => {
    expect(deriveClauseTerms("投标人须提供采购人的验收证明")).toContain("采购人")
    expect(deriveClauseTerms("投标人须提供采购人的验收证明")).toContain("验收证明")
  })

  it("停止词自身不得被当关键词收进来（只扩召回，不引噪声）", () => {
    const terms = deriveClauseTerms("投标人须提供招标文件要求的资质证书")
    expect(terms).not.toContain("要求")
    expect(terms).not.toContain("提供")
    expect(terms).toContain("资质证书")
  })
})

describe("P0-3 §6 提示词接线：同一证据包 → 三份提示词，语义四处一致", () => {
  const clauses = ["未按招标文件要求盖章的投标无效"]
  const evidence = selectBidEvidence("第2章 投标函\n本投标文件已加盖公章并签字。", clauses)
  const sysOf = (m: { content: unknown }[]) => (typeof m[0].content === "string" ? m[0].content : "")
  const userOf = (m: { content: unknown }[]) => (typeof m[1].content === "string" ? m[1].content : "")

  it("废标单轮：system 含可见性契约，user 含程序生成的【输入可见性】块", () => {
    const msgs = buildVoidCheckMessages(clauses, evidence)
    expect(sysOf(msgs)).toContain(BID_VISIBILITY_CONTRACT_VOID)
    expect(userOf(msgs)).toContain("【输入可见性｜程序生成，非模型推断】")
    expect(userOf(msgs)).toContain("已加盖公章并签字")
  })

  it("废标三轮第一轮同样带契约与可见性块（三轮不得各自拼素材）", () => {
    const msgs = buildVoidScopeMessages(clauses, evidence, "【★实质性条款】★1 系统响应速度15分")
    expect(sysOf(msgs)).toContain(BID_VISIBILITY_CONTRACT_VOID)
    expect(userOf(msgs)).toContain("【输入可见性｜程序生成，非模型推断】")
    expect(userOf(msgs)).toContain("★1 系统响应速度15分")
  })

  it("偏离表：system 含偏离侧契约，绑定顺序不变（大纲树在证据前）", () => {
    const msgs = buildDeviationMapMessages(
      [{ id: "c1", source: "招标第三章", text: "系统响应时间不超过 3 秒" }],
      [{ id: "n1", title: "第五章 安全设计", children: [], part: "tech" }],
      evidence,
      "【全局事实】本项目工期：90 天",
    )
    const user = userOf(msgs)
    expect(sysOf(msgs)).toContain(BID_VISIBILITY_CONTRACT_DEVIATION)
    expect(user).toContain("【输入可见性｜程序生成，非模型推断】")
    expect(user.indexOf("【投标文件大纲树（带章-节编号）】")).toBeLessThan(user.indexOf("【投标文件正文（按条款定向检索注入的片段）】"))
    expect(user).toContain("【全局事实】本项目工期：90 天")
  })

  it("模型漏答的条款补「部分响应」而非「偏离」（与废标侧未知态口径一致）", () => {
    const cls: RequirementClause[] = [{ id: "c1", text: "系统响应时间不超过 3 秒", source: "招标第三章" }]
    const rows = sanitizeDeviationRows({ rows: [] }, cls)
    expect(rows).toHaveLength(1)
    expect(rows[0].response_level).toBe("partial")
    expect(rows[0].response_summary).toContain("需人工核对")
  })
})

describe("P0-3 §7 不可见条款：面板 / 体检 / 导出三处口径一致", () => {
  const rowOf = (over: Partial<DeviationRow> = {}): DeviationRow =>
    ({
      clause_id: "c1",
      clause_text: "投标人须提供三年免费质保",
      source: "招标技术要求",
      response_node: "第五章 售后服务",
      response_level: "partial",
      response_summary: "本次注入范围内无可见证据，需人工核对未注入部分",
      bid_ref: "",
      needs_review: true,
      ...over,
    }) as DeviationRow

  it("markInvisibleDeviationRows 只标本次不可见的条款，AI 写的实质摘要不被覆盖", () => {
    const rows = [rowOf({ response_summary: "" }), rowOf({ clause_id: "c2", response_summary: "已承诺三年免费质保", needs_review: undefined })]
    const marked = markInvisibleDeviationRows(rows, ["c1"])
    expect(marked[0].needs_review).toBe(true)
    expect(marked[0].response_summary).toContain("需人工核对")
    expect(marked[1].needs_review).toBeUndefined()
    expect(marked[1].response_summary).toBe("已承诺三年免费质保")
  })

  it("不可见清单为空 → 不无中生有造标记", () => {
    const rows = [rowOf({ needs_review: undefined })]
    expect(markInvisibleDeviationRows(rows, [])[0].needs_review).toBeUndefined()
  })

  it("deviationStats 数得出待核对条数，且不重复计入其它档位之外的总数", () => {
    const st = deviationStats({
      split_dim: "system",
      generated_at: "",
      rows: [rowOf(), rowOf({ clause_id: "c2", needs_review: undefined, response_level: "full" })],
    })
    expect(st.total).toBe(2)
    expect(st.partial).toBe(1)
    expect(st.needs_review).toBe(1)
  })

  it("导出取摘要：内部兜底文案换对外口径，AI 写的实质摘要照常导出", () => {
    expect(deviationExportSummary(rowOf())).toBe("响应内容详见投标文件正文对应章节")
    expect(deviationExportSummary(rowOf({ response_summary: "" }))).toBe("响应内容详见投标文件正文对应章节")
    expect(deviationExportSummary(rowOf({ response_summary: "已承诺三年免费质保" }))).toBe("已承诺三年免费质保")
    // 标记缺失但文案仍是内部口径（模型原样抄回）→ 照样不外泄
    expect(deviationExportSummary(rowOf({ needs_review: undefined }))).toBe("响应内容详见投标文件正文对应章节")
  })

  it("待核对行进交卷体检：报 deviation_invisible_review（warn），不冒充负偏离", () => {
    const hits = deviationCommitHits({ split_dim: "system", generated_at: "", rows: [rowOf()] })
    expect(hits.some((h) => h.rule === "deviation_invisible_review" && h.level === "warn")).toBe(true)
    expect(hits.some((h) => h.rule === "deviation_undercommit")).toBe(false)
  })
})

describe("R63 选块分配器：两阶段最大覆盖（纯函数直测，不经文本切块）", () => {
  // scores[i][k] = 第 i 条条款在第 k 块上的得分；sizes[k] = 第 k 块字数
  it("阶段①按「每字新增覆盖」选块：词密的大块不得把预算吃光、让后面的条款永远无证据", () => {
    // 条款0 只命中 5000 字的块0；条款1/2/3 各自只命中 500 字的块1/2/3
    const picked = selectEvidenceChunks({
      sizes: [5000, 500, 500, 500],
      scores: [
        [10, 0, 0, 0],
        [0, 5, 0, 0],
        [0, 0, 5, 0],
        [0, 0, 0, 5],
      ],
      budget: 1600,
      maxChunks: 12,
    })
    // 预算 1600 装不下块0（5000），但装得下另外三块 → 三条条款都有证据，而不是只服务得分最高的条款0
    expect(picked).toEqual([1, 2, 3])
  })

  it("阶段②覆盖饱和后，用剩余预算把条款自己的最强块补进来", () => {
    // 块0 对两条条款都有证据（覆盖已饱和），但条款0 的最强块是块2
    const picked = selectEvidenceChunks({
      sizes: [100, 100, 100],
      scores: [
        [10, 3, 50],
        [10, 0, 0],
      ],
      budget: 200,
      maxChunks: 12,
    })
    expect(picked).toEqual([0, 2])
  })

  it("确定性：同输入必得同输出，且同分按块序号取先出现的", () => {
    const input = { sizes: [100, 100, 100], scores: [[5, 5, 5]], budget: 1000, maxChunks: 12 }
    expect(selectEvidenceChunks(input)).toEqual([0])
    expect(selectEvidenceChunks(input)).toEqual(selectEvidenceChunks(input))
  })

  it("块数上限生效：maxChunks 之后不再追加", () => {
    const sizes = Array.from({ length: 10 }, () => 100)
    const scores = Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 }, (_, k) => (k === i ? 5 : 0)))
    const picked = selectEvidenceChunks({ sizes, scores, budget: 10000, maxChunks: 3 })
    expect(picked).toEqual([0, 1, 2])
  })

  it("全条款零分 → 返回空（绝不靠「随便塞一块」制造假证据，交由首尾节选兜底）", () => {
    expect(selectEvidenceChunks({ sizes: [100, 100], scores: [[0, 0]], budget: 1000, maxChunks: 12 })).toEqual([])
    expect(selectEvidenceChunks({ sizes: [], scores: [], budget: 1000, maxChunks: 12 })).toEqual([])
  })

  it("第一块允许超预算：与改前口径一致，至少给出一段正文", () => {
    expect(selectEvidenceChunks({ sizes: [5000], scores: [[3]], budget: 100, maxChunks: 12 })).toEqual([0])
  })
})
