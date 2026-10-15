import { describe, expect, it } from "vitest"
import {
  DEFAULT_SELF_REFERENCE,
  REQUIRED_DEDICATED_SECTIONS,
  WRITING_VOICE_RULES_FIXED,
  checkCaptionNumbering,
  checkDedicatedSections,
  checkFileName,
  findIdentityLeaks,
  findPronounHits,
  findVagueParamHits,
  resolveVoiceRules,
  scanChapterText,
  suggestSelfReferences,
  writingVoiceRules,
} from "./bidWritingRules"

// 公司编写规范的本地可判定口径网（来源：2026.09.17 编写规范 / 智业文档规范V2.1 / 第一期培训）。
// 断的是"机械可判"的那部分：人称（按项目自称，不写死）、模糊参数、身份泄漏、必备专用件、图表编号、命名。

const LINES = (...ls: string[]) => ls.join("\n")

describe("人称口径（自称按项目设置，不写死）", () => {
  it("未设置时回落默认自称；默认下口语第一人称命中并给行号", () => {
    expect(resolveVoiceRules().allowed).toContain(DEFAULT_SELF_REFERENCE)
    const hits = findPronounHits(LINES("第一行正常", "我们已完成部署", "我方承诺三年服务", "本公司资质齐全"))
    expect(hits.map((h) => h.word)).toEqual(["我们", "我方", "本公司"])
    expect(hits.map((h) => h.line)).toEqual([2, 3, 4])
  })

  it("按招标文件设置自称后，用它不再算违规（这就是「不限制死」）", () => {
    const supplier = resolveVoiceRules("供应商")
    expect(supplier.allowed).toEqual(["供应商"])
    expect(supplier.banned).toContain("我方")
    expect(findPronounHits("供应商已部署该模块", { selfReference: "供应商" })).toEqual([])
    expect(findPronounHits("我方已部署该模块", { selfReference: "供应商" })).toHaveLength(1)

    // 用户若把「我方」设为正式自称，则它被豁免（彻底不限制死）
    expect(resolveVoiceRules("我方").banned).not.toContain("我方")
    expect(findPronounHits("我方承诺三年运维", { selfReference: "我方" })).toEqual([])
  })

  it("支持多个自称，提示词口径随之生成（检查侧与生成侧同源）", () => {
    const r = resolveVoiceRules("本投标人、供应商")
    expect(r.allowed).toEqual(["本投标人", "供应商"])
    expect(r.promptLine).toContain("本投标人")
    expect(r.promptLine).toContain("供应商")
    expect(writingVoiceRules("供应商")[0]).toContain("供应商")
    expect(writingVoiceRules()[0]).toContain(DEFAULT_SELF_REFERENCE)
  })

  it("从招标原文抽候选（本地词频，供设置界面一键选用）", () => {
    const sugg = suggestSelfReferences("本项目供应商应满足…供应商须提供…投标人应编制…供应商承诺")
    expect(sugg[0]).toEqual({ word: "供应商", count: 3 })
    expect(sugg.find((x) => x.word === "投标人")?.count).toBe(1)
    expect(suggestSelfReferences("")).toEqual([])
  })
})

describe("参数表述口径（禁模糊比较）", () => {
  it("不予低于/相当于这类词放过", () => {
    const hits = findVagueParamHits(LINES("响应时间不低于3秒", "性能相当于同类产品", "并发能力左右"))
    expect(hits.map((h) => h.word)).toEqual(["不低于", "相当于", "左右"])
  })

  it("具体数值不报", () => {
    expect(findVagueParamHits("响应时间≤3秒，并发≥2000")).toEqual([])
  })
})

describe("身份泄漏（暗标/脱敏）", () => {
  it("按传入的标记词命中公司名/产品名", () => {
    const hits = findIdentityLeaks("本方案采用智业HIS系统，由某某科技有限公司承建", ["智业", "某某科技"])
    expect(hits.map((h) => h.word)).toEqual(["智业", "某某科技"])
  })

  it("未传标记词时不报（避免误杀）", () => {
    expect(findIdentityLeaks("任意文本", [])).toEqual([])
  })
})

describe("必备专用件（承诺函/偏离表）", () => {
  it("缺失即违规，并带规范原文口径提示", () => {
    const issues = checkDedicatedSections([{ title: "技术方案" }, { title: "售后服务" }])
    expect(issues.map((i) => i.label)).toEqual(["承诺函", "偏离表"])
    expect(issues[0].hint).toContain("单独响应")
  })

  it("存在但层级过深（>3 级）违规", () => {
    const issues = checkDedicatedSections([
      { title: "实质性条款响应承诺函", level: 4 },
      { title: "技术偏离表", level: 2 },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain("层级过低")
  })

  it("一级标题即承诺函/偏离表时通过", () => {
    expect(checkDedicatedSections([{ title: "投标承诺函", level: 1 }, { title: "技术偏离表", level: 1 }])).toEqual([])
  })

  it("规范口径常量本身不为空（提示词与本检查同源）", () => {
    expect(REQUIRED_DEDICATED_SECTIONS.every((s) => s.hint.length > 8)).toBe(true)
    expect(WRITING_VOICE_RULES_FIXED.length).toBeGreaterThanOrEqual(5)
  })
})

describe("图表题注编号（断号/重号）", () => {
  it("重号与断号都能报出", () => {
    const issues = checkCaptionNumbering(LINES("图1-1 架构", "图1-1 架构（重复）", "图1-3 流程", "表2-1 清单"))
    expect(issues.join("；")).toContain("图1-1 编号重复")
    expect(issues.join("；")).toContain("断号")
  })

  it("连续编号不报", () => {
    expect(checkCaptionNumbering(LINES("图1-1 架构", "图1-2 流程", "表1-1 清单", "表1-2 清单"))).toEqual([])
  })
})

describe("文件命名（日期+标题+版本）", () => {
  it("三要素齐全通过；缺日期或缺版本报错", () => {
    expect(checkFileName("2026.09.17-某医院投标文件-V2.1.docx").ok).toBe(true)
    expect(checkFileName("某医院投标文件-V2.1.docx").reason).toContain("日期")
    expect(checkFileName("2026.09.17-某医院投标文件.docx").reason).toContain("版本号")
    expect(checkFileName("投标文件.docx").reason).toContain("日期与版本号")
  })
})

describe("scanChapterText 汇总", () => {
  it("一次扫出三类命中", () => {
    const r = scanChapterText("我们提供的智业系统响应时间不低于3秒", { identityMarkers: ["智业"] })
    expect(r.pronouns).toHaveLength(1)
    expect(r.vagueParams).toHaveLength(1)
    expect(r.identityLeaks).toHaveLength(1)
  })
})
