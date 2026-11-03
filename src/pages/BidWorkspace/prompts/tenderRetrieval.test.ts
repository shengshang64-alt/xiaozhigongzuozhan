import { describe, expect, it } from "vitest"

import {
  RETRIEVAL_BUDGET_CHARS,
  RETRIEVAL_CHUNK_SIZE,
  buildDegradedSectionContent,
  chunkTenderByHeading,
  isMissingSectionResult,
  isRateLimitError,
  scoreChunkForSection,
  selectRelevantChunks,
} from "./tenderRetrieval"

// 造一份超预算全文：每章 约 1200 字 × N，空行分段
function makeTender(chapters: Array<{ heading: string; body: string }>): string {
  return chapters.map((c) => `${c.heading}\n${c.body}`).join("\n\n")
}

describe("chunkTenderByHeading 标题归属分块", () => {
  it("按空行分段、块不超 1.5 倍块宽、块记录归属标题", () => {
    const segs: string[] = []
    segs.push("第一章 投标公告\n" + "公告内容。".repeat(50))
    for (let i = 0; i < 30; i++) segs.push(`段落${i}\n${"填充正文内容示例一二三。".repeat(60)}`)
    const text = segs.join("\n\n")
    const chunks = chunkTenderByHeading(text)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(RETRIEVAL_CHUNK_SIZE * 1.5 + 10)
    expect(chunks[0].heading).toContain("第一章")
    // index 连续
    chunks.forEach((c, i) => expect(c.index).toBe(i))
  })

  it("空文本返回空数组", () => {
    expect(chunkTenderByHeading("")).toEqual([])
    expect(chunkTenderByHeading("   \n\n  ")).toEqual([])
  })
})

describe("scoreChunkForSection 关键词打分", () => {
  it("长词（≥3字）按 2 倍计，短词 1 倍，标题命中另加 5", () => {
    const chunk = { heading: "第四章 评标方法", text: "评标方法说明，评分标准如下。", index: 0 }
    const s = scoreChunkForSection(chunk, ["评标方法", "评分标准"])
    // 评标方法：text 1  hit×2 + heading 命中 +5 = 7；评分标准：1 hit×2 = 2 → 9
    expect(s).toBe(9)
    expect(scoreChunkForSection(chunk, [])).toBe(0)
  })
})

describe("selectRelevantChunks 三模式选块", () => {
  it("全文 ≤ 预算 → full 模式整段透传", () => {
    const r = selectRelevantChunks("短文本招标内容", "tech_score")
    expect(r.mode).toBe("full")
    expect(r.text).toBe("短文本招标内容")
  })

  it("超预算且命中 → retrieval：按原文顺序、片段标头、预算内", () => {
    const filler = "其他章节正文填充。".repeat(900) // ~8100 字/章
    const chapters = [
      { heading: "第一章 公告", body: filler },
      { heading: "第二章 投标人须知", body: filler },
      { heading: "第四章 评标方法和标准", body: `技术评分表如下。${"总体方案理解深刻得5分，未提供方案的不得分。评分标准细化说明。".repeat(80)}` },
      { heading: "第五章 合同条款", body: filler },
    ]
    const text = makeTender(chapters)
    expect(text.length).toBeGreaterThan(RETRIEVAL_BUDGET_CHARS)
    const r = selectRelevantChunks(text, "tech_score")
    expect(r.mode).toBe("retrieval")
    expect(r.selected.length).toBeGreaterThan(0)
    expect(r.totalChunks).toBeGreaterThan(1)
    expect(r.text).toContain("【原文片段 1/")
    expect(r.text).toContain("章节：第四章")
    // 按原文顺序
    const idx = r.selected.map((c) => c.index)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    // 评分表块必被选中（关键词高分）
    expect(r.text).toContain("总体方案理解深刻")
  })

  it("超预算且无命中（无表项/词不沾边）→ truncated 首尾截断", () => {
    const filler = "纯正文没有任何评分相关词的内容段落。".repeat(1200)
    const r = selectRelevantChunks(filler, "unknown_key")
    expect(r.mode).toBe("truncated")
    expect(r.text).toContain("[中间内容因篇幅限制省略]")
    const r2 = selectRelevantChunks(filler, "tech_score")
    expect(r2.mode).toBe("truncated")
  })
})

describe("buildDegradedSectionContent AI 降级交付", () => {
  it("retrieval 降级：说明行含原因 + 全部片段按原序列出", () => {
    const src = {
      mode: "retrieval" as const,
      text: "",
      selected: [
        { heading: "第四章 评标方法", text: "技术评分：总体方案 5 分。", index: 3 },
        { heading: "附件2 评分表", text: "培训方案 4 分。", index: 7 },
      ],
      totalChunks: 12,
    }
    const out = buildDegradedSectionContent("tech_score", src, "请求超时")
    expect(out).toContain("系统降级")
    expect(out).toContain("请求超时")
    expect(out).toContain("检索自全文 12 个分块")
    expect(out).toContain("总体方案 5 分")
    expect(out).toContain("培训方案 4 分")
  })

  it("truncated 降级：给出原文摘录段", () => {
    const src = { mode: "truncated" as const, text: "首段原文……", selected: [], totalChunks: 5 }
    const out = buildDegradedSectionContent("void_items", src, "429 Too Many Requests")
    expect(out).toContain("原文摘录")
    expect(out).toContain("首段原文……")
  })
})

describe("isRateLimitError 限流识别", () => {
  it.each([["HTTP 429", true], ["TPM limit reached", true], ["rate limit exceeded", true], ["触发限流", true], ["连接超时", false], ["Invalid API key", false]])(
    "%s → %s",
    (msg, expected) => {
      expect(isRateLimitError(msg)).toBe(expected)
    },
  )
})

// T12b：用户实报场景——PDF/Word 提取件全文无空行（单换行流），旧实现整文本一段、标题归属全丢
describe("T12b 无空行提取件的标题行分组回退", () => {
  it("单换行超长文：分块恢复标题归属，评分表可被 tech_score 检索命中", () => {
    const noise = Array.from(
      { length: 900 },
      (_, i) => `第${i}行采购公告正文说明文字，与本项检索无关的通用条款描述。`,
    ).join("\n")
    const table = [
      "第三章 评标办法",
      "2.2 技术评分明细表",
      "总体技术解决方案（5 分）：优得5分，良得3分，一般得1分",
      "数据治理方案（5 分）：完整可落地得5分",
      "售后服务方案（4 分）：本地化团队响应得4分",
    ].join("\n")
    const text = `第一章 招标公告\n${noise}\n${table}\n${noise}`
    const chunks = chunkTenderByHeading(text)
    expect(chunks.length).toBeGreaterThan(2)
    // 至少一个块的归属标题不再是「文首」（旧实现整文本一段全丢标题）
    expect(chunks.some((c) => c.heading !== "文首")).toBe(true)
    const src = selectRelevantChunks(text, "tech_score")
    expect(src.mode).toBe("retrieval")
    expect(src.text).toContain("技术评分明细表")
    expect(src.text).toContain("总体技术解决方案（5 分）")
  })

  it("单换行短文本（预算内）仍走 full 模式不受回退影响", () => {
    const text = "第一章 总则\n本项目采购HIS系统一套。\n第二章 需求\n投标人应具备资质。"
    const src = selectRelevantChunks(text, "tech_score")
    expect(src.mode).toBe("full")
  })
})

// T12b3：真实 158k PDF 提取件实弹暴露的检索盲区回归
describe("T12b3 竖线空格归一化与文首保底", () => {
  it("封面「采 | 购 | 人」竖线拆字写法仍可被 purchaser_info 关键词命中", () => {
    const head = ["第一章 招标公告", "采 | 购 | 人 ： 安徽理工大学第一附属医院 （盖章）", "项目编号： 2026CG0095"].join("\n")
    const noise = Array.from({ length: 900 }, (_, i) => `第${i}行与采购主体无关的通用流程说明文字描述。`).join("\n")
    const text = `${head}\n${noise}\n${noise}`
    const src = selectRelevantChunks(text, "purchaser_info")
    expect(src.mode).toBe("retrieval")
    expect(src.text).toContain("安徽理工大学第一附属医院")
  })

  it("弱信号项即使文首块关键词得分低，也强制包含文首块", () => {
    const head = "封面\n" + "项目基本信息页，无高频关键词。".repeat(30)
    const hot = Array.from({ length: 1500 }, () => "采购人 采购人 采购人 采购人 采购人。").join("\n")
    const src = selectRelevantChunks(`${head}\n${hot}`, "purchaser_info")
    expect(src.selected.some((c) => c.index === 0)).toBe(true)
  })
})

  // T14b（Q24）：泛词「目录」盲区回归——数据标准表高频出现「目录」不得挤占真正的「投标文件格式」章节
  it("keeps the tender-format chapter ahead of generic 目录 noise (Q24)", () => {
    const noise = "1 | 数据元目录 | 人口基本信息 | 应有\n2 | 术语目录 | 疾病分类目录代码 | 必须\n".repeat(600)
    const text = noise + "\n\n第七章 投标文件格式\n一、投标函\n二、开标一览表\n三、投标分项报价表\n"
    const src = selectRelevantChunks(text, "bid_outline_req")
    expect(src.mode).toBe("retrieval")
    expect(src.selected.length).toBeGreaterThan(0)
    expect(src.text).toContain("投标文件格式")
  })

// Q26 切片A：泛词盲区回归——compliance/qualification 不得被技术参数区泛词（完整性/有效性/偏离）挤占
describe("Q26 降级选块错位修复（compliance/qualification/purchase_list）", () => {
  it("compliance 素材命中符合性审查章，不被含『数据完整性/负偏离』的技术参数噪声挤占", () => {
    const techNoise = Array.from(
      { length: 900 },
      (_, i) => `${i} 临床数据管理支持数据完整性校验、有效性验证，出现负偏离视为未响应。`,
    ).join("\n")
    const complianceChapter =
      "第二章 投标人须知\n12.2 符合性检查\n符合性审查表要求对实质性条款逐条响应，偏差表完整填写，实质性响应审查。"
    const src = selectRelevantChunks(techNoise + "\n\n" + complianceChapter, "compliance")
    expect(src.mode).toBe("retrieval")
    expect(src.text).toContain("符合性审查")
    expect(src.text).toContain("实质性响应")
    // 噪声区有 5+ 个块，新词表下它们得分 0 不被选，仅符合性章所在块入选（旧词表会选入大量噪声块）
    expect(src.selected.length).toBeLessThanOrEqual(2)
  })

  it("qualification 素材命中资格性审查章", () => {
    const noise = Array.from({ length: 900 }, (_, i) => `${i} 系统需具备高可用与容灾能力，接口响应时间不超过 3 秒。`).join("\n")
    const qualChapter = "一、资格性审查\n投标人须具备营业执照、法定代表人授权、缴纳社保、税收证明、无重大违法记录承诺。"
    const src = selectRelevantChunks(noise + "\n\n" + qualChapter, "qualification")
    expect(src.mode).toBe("retrieval")
    expect(src.text).toContain("资格性审查")
    expect(src.text).toContain("法定代表人授权")
  })

  it("purchase_list 命中真实采购清单表，不再误报空", () => {
    const noise = Array.from({ length: 900 }, (_, i) => `${i} 评标委员会由 7 人组成，其中技术经济专家不少于三分之二。`).join("\n")
    const listTable = "第三章 采购需求\n采购清单：\n1 | 服务器 | 规格型号 R4900 | 数量 10 | 分项报价\n2 | 交换机 | 48 口千兆 | 数量 20"
    const src = selectRelevantChunks(noise + "\n\n" + listTable, "purchase_list")
    expect(src.mode).toBe("retrieval")
    expect(src.text).toContain("采购清单")
    expect(src.text).toContain("服务器")
  })
})

// Q26 切片A：降级交付封顶去重
describe("Q26 buildDegradedSectionContent 封顶去重", () => {
  it("大量片段时总长度封顶、重复片段去重、给出未展示提示", () => {
    const big = "原文片段内容示例，包含资格审查相关表述。".repeat(200)
    const selected = Array.from({ length: 10 }, (_, i) => ({
      heading: `章节${i}`,
      text: i < 5 ? big : big + `尾部区分${i}`,
      index: i,
    }))
    const src = { mode: "retrieval" as const, text: "", selected, totalChunks: 61 }
    const out = buildDegradedSectionContent("qualification", src, "HTTP 429")
    expect(out.length).toBeLessThanOrEqual(3500)
    expect(out).toContain("段原文未展示")
    expect(out).toContain("系统降级")
  })

  it("短片段全部展示，不触发封顶提示", () => {
    const src = {
      mode: "retrieval" as const,
      text: "",
      selected: [
        { heading: "第二章", text: "资格性审查：营业执照。", index: 1 },
        { heading: "第四章", text: "符合性审查：实质性响应。", index: 2 },
      ],
      totalChunks: 3,
    }
    const out = buildDegradedSectionContent("qualification", src, "超时")
    expect(out).not.toContain("段原文未展示")
    expect(out).toContain("营业执照")
    expect(out).toContain("实质性响应")
  })
})

// Q27 切片A：整项无结果语义判定（伪空触发重跑 / 真实内容与降级交付不误杀）
describe("Q27 isMissingSectionResult 伪空判定", () => {
  it("契约标记与伪空变体判真", () => {
    expect(isMissingSectionResult("原文未提及")).toBe(true)
    expect(isMissingSectionResult("  原文未提及  ")).toBe(true)
    expect(isMissingSectionResult("")).toBe(true)
    expect(isMissingSectionResult("   \n  ")).toBe(true)
    expect(isMissingSectionResult("本项目未提及")).toBe(true)
    expect(isMissingSectionResult("招标文件未提及相关内容")).toBe(true)
    expect(isMissingSectionResult("相关内容未提及")).toBe(true)
    expect(isMissingSectionResult("原文中未提及本项")).toBe(true)
    // 口径备注：「原文没有提及」不含子串「未提及」，不在 prompt 契约标记内——不按伪空处理（与 sectionStatus 保持一致）
    expect(isMissingSectionResult("原文没有提及")).toBe(false)
  })

  it("系统降级交付判假（可人工核对，不属可重跑伪空）", () => {
    const degraded = "〔系统降级〕AI 解析失败：HTTP 429\n【检索原文】第四章 评标方法\n总体方案 5 分。"
    expect(isMissingSectionResult(degraded)).toBe(false)
  })

  it("正常提取内容判假：长短文、含『未提及』字样的有效正文均不误杀", () => {
    expect(isMissingSectionResult("项目名称：某某医院HIS系统采购")).toBe(false)
    const real = Array.from(
      { length: 8 },
      (_, i) => `${i + 1} | 服务器 | 规格R4900 | 数量10 | 未提及品牌限价`,
    ).join("\n")
    expect(real.length).toBeGreaterThanOrEqual(60)
    expect(isMissingSectionResult(real)).toBe(false)
    // 多行内容即便每行都含「未提及」，整体超 30 字也判假（局部缺失≠整项无结果）
    const multi = "评分项A（5 分）：未提及具体档位\n评分项B（3 分）：未提及计算公式"
    expect(isMissingSectionResult(multi)).toBe(false)
  })

  it("30 字边界：恰含『未提及』的短句判真，31 字判假", () => {
    const at30 = "未" + "提" + "及" + "。".repeat(27) // 「未提及」+填充=30 字
    expect(at30.length).toBe(30)
    expect(isMissingSectionResult(at30)).toBe(true)
    expect(isMissingSectionResult(at30 + "。")).toBe(false)
  })
})
