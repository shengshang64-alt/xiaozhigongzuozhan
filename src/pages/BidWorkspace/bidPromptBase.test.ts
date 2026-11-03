import { describe, expect, it } from "vitest"
import {
  BID_PROMPT_VERSION,
  COMPLIANCE_MODE_LABEL,
  COMMON_OUTPUT_RULES,
  TRUTH_IRON_RULES,
  buildBidChapterMessages,
  buildBidContinueMessages,
  buildBidOutlineMessages,
  buildBidRefineMessages,
  buildBidSectionMessages,
  buildTenderParseMessages,
  clampParseSectionContent,
  complianceModeRule,
  defaultParseConfig,
  truthPreamble,
} from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// R30（prompt-merge-v1）：《标书智能体提示词·优化合并稿 v1.0》底座的行为锈死网
// 锁死点：铁律公共块全链注入、三档模式规则全非空（2026-09-22 用户拍板全量切换）、
// 占位符统一【待填写】口径（防与 meta_leftover 检查器打架）、解析出处回指截断豁免
const chapters = [{ title: "总体建设方案", sections: ["总体架构", "技术路线"] }] as unknown as Chapter[]

describe("truthPreamble（真实性铁律公共块）", () => {
  it("六条铁律 + 三条通用输出要求，逐字稳定（缓存友好）", () => {
    expect(TRUTH_IRON_RULES).toHaveLength(6)
    expect(COMMON_OUTPUT_RULES).toHaveLength(3)
    expect(truthPreamble()).toBe(truthPreamble())
    expect(truthPreamble()).toContain("【真实性铁律】（最高优先级")
    expect(truthPreamble()).toContain("回指到原文出处")
  })

  it("占位符统一走既有【待填写】约定，不出现会被检查器拦截的「待补充」", () => {
    const all = [...TRUTH_IRON_RULES, ...COMMON_OUTPUT_RULES].join("\n")
    expect(all).toContain("【待填写】")
    expect(all).not.toContain("待补充")
  })

  it("R32 矛盾修复：解析版 preamble 弱化铁律3（缺失省略、由系统统一汇总），写作版保留标注", () => {
    const parse = truthPreamble("parse")
    const write = truthPreamble("write")
    // 两版都是铁律块、都保留出处回指（缓存友好，仅替换铁律3 一条）
    expect(parse).toContain("【真实性铁律】")
    expect(write).toContain("【真实性铁律】")
    // 解析版与 cleanParseSectionContent 下游对齐：缺失由系统汇总，禁模型自行插未提及行
    expect(parse).toContain("缺失汇总由系统统一生成")
    expect(parse).not.toContain("明确标注「原文未提及」")
    // 写作版仍逐字保留铁律3（正文未提及要显式标注）
    expect(write).toContain("明确标注「原文未提及」")
  })

  it("五个生成器 system 全量注入铁律块（解析/大纲/章/小节/续写/改写）", () => {
    const parse = buildTenderParseMessages("测试招标文件全文", defaultParseConfig())
    const outline = buildBidOutlineMessages("项目", "医院", null, false, 3, undefined)
    const chapter = buildBidChapterMessages("项目", "医院", null, [], chapters, 0, () => "", {
      wordBudget: 800,
      figures: false,
    })
    const section = buildBidSectionMessages("项目", "医院", null, [], chapters, 0, () => "", {
      wordBudget: 400,
      figures: false,
      sectionName: "总体架构",
      sectionNo: "1.1",
      sectionIndex: 0,
      sectionCount: 2,
    })
    const cont = buildBidContinueMessages("项目", "医院", null, "总体建设方案", 1, "已写正文", 600)
    const refine = buildBidRefineMessages("rewrite", "项目", "医院", "总体建设方案", 1, "原文内容")
    for (const msgs of [parse, outline, chapter, section, cont, refine]) {
      expect(msgs[0].role).toBe("system")
      expect(msgs[0].content).toContain("【真实性铁律】")
    }
  })

  it("版本号存在（提示词语义变更需同步更新并台账留证）", () => {
    expect(BID_PROMPT_VERSION).toContain("merged-v1.0")
  })
})

describe("complianceModeRule（合并稿三档写作模式，R30 全量切换）", () => {
  it("三档与缺省均返回非空规则块——strict/缺省 也注入严格响应块", () => {
    for (const mode of [undefined, "strict", "moderate", "full"] as const) {
      expect(complianceModeRule(mode).length).toBeGreaterThan(50)
    }
  })

  it("严格档锚点：只做对标响应、响应句式改写、禁止扩展", () => {
    const r = complianceModeRule("strict")
    expect(r).toContain("生成模式=严格响应")
    expect(r).toContain("我公司具备")
    expect(r).toContain("禁止扩展")
    expect(r).toContain("篇幅从简")
  })

  it("扩展档锚点：骨架先行 + 场景描述 30%~50%", () => {
    const r = complianceModeRule("moderate")
    expect(r).toContain("生成模式=场景扩展")
    expect(r).toContain("先按严格响应完成")
    expect(r).toContain("30%~50%")
  })

  it("大量档锚点：通用充实材料 + 编造红线（不得包装成本项目事实、不虚构金额证书）", () => {
    const r = complianceModeRule("full")
    expect(r).toContain("生成模式=大量充实")
    expect(r).toContain("通用能力描述")
    expect(r).toContain("严禁把通用材料包装成本项目已发生的事实")
    expect(r).toContain("严禁虚构具体事实")
  })

  it("正文 builder 默认即带严格模式块；切 moderate 注入扩展块", () => {
    const base = { wordBudget: 800, figures: false }
    const def = buildBidChapterMessages("项目", "医院", null, [], chapters, 0, () => "", { ...base })
    expect(def[0].content).toContain("生成模式=严格响应")
    const mod = buildBidChapterMessages("项目", "医院", null, [], chapters, 0, () => "", {
      ...base,
      complianceMode: "moderate",
    })
    expect(mod[0].content).toContain("生成模式=场景扩展")
    expect(mod[0].content).not.toContain("生成模式=严格响应")
  })

  it("UI 标签与三档口径对齐（严格响应/场景扩展/大量充实）", () => {
    expect(COMPLIANCE_MODE_LABEL).toEqual({ strict: "严格响应", moderate: "场景扩展", full: "大量充实" })
  })
})

// r287（bid-l2-verbatim-compare 切片2·预防）：引号照录纪律进生成提示词——引号内只许逐字原文，
// 转述必须出引号；与体检 quote_rewrite 口径闭环（改写=0 的生成侧根因治理）
describe("r287 引号照录纪律（B类·生成侧改写抑制）", () => {
  it("章/小节 system 均含引号照录规则句（逐字照录 + 间接转述两个锚点）", () => {
    const base = { wordBudget: 800, figures: false }
    const chapter = buildBidChapterMessages("项目", "医院", null, [], chapters, 0, () => "", { ...base })
    const section = buildBidSectionMessages("项目", "医院", null, [], chapters, 0, () => "", {
      ...base,
      sectionName: "总体架构",
      sectionNo: "1.1",
      sectionIndex: 0,
      sectionCount: 2,
    })
    for (const msgs of [chapter, section]) {
      expect(msgs[0].content).toContain("正文引号只用于逐字照录招标原文")
      expect(msgs[0].content).toContain("去掉引号改为间接转述")
      expect(msgs[0].content).toContain("禁止在引号内改写、缩略、概括")
    }
  })
})

describe("解析出处回指（R30）", () => {
  it("解析 system 含出处回指要求", () => {
    const msgs = buildTenderParseMessages("全文", defaultParseConfig())
    expect(msgs[0].content).toContain("出处回指")
    expect(msgs[0].content).toContain("禁止臆造出处")
  })

  it("带（出处：…）后缀的超长行豁免长度截断——出处被截会产生幻觉页码", () => {
    // Issue 1：概览上限放宽到 600 字/条；用超 600 的行同时验证「无出处截断 / 有出处整行豁免」
    const plain = `要点：${"内容".repeat(400)}`
    expect(plain.length).toBeGreaterThan(600)
    expect(clampParseSectionContent("overview", plain)).not.toBe(plain)
    // 对照组：带出处后缀的更长行整行豁免（出处被截会产生幻觉页码）
    const long = `${plain}（出处：第三章3.2）`
    expect(clampParseSectionContent("overview", long)).toBe(long)
  })
})
