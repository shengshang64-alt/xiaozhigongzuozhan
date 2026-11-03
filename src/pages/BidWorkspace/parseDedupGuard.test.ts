import { describe, expect, it } from "vitest"
import {
  cleanParseSectionContent,
  complianceModeRule,
  dedupeAcrossSections,
  ensureSubjectiveScoringChapters,
  type NumberedScoringItem,
  type ParseReport,
  type ParseSection,
} from "./bidTypes"
import { lintProse } from "./bidProseLinter"
import { REAL_OVERVIEW_BUILD_CONTENT, REAL_PROJECT_INFO_BUILD_CONTENT } from "./parseDedupRealFixture"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// 2026-10-21 用户反馈三连（解析重复 / 目录错乱 / 正文 AI 味）的回归防护。
// 每条用例都取自真实项目 2026BFAFZ50845 的实测产物，不是构造出来的假数据。

const section = (key: string, content: string): ParseSection => ({ key, title: key, content })
const report = (sections: ParseSection[]): ParseReport => ({ scope: "full", sections })

describe("解析清洗：PDF 版式噪声行", () => {
  it("页眉「政府采购项目公开招标文件示范文本（服务类）」与页脚「第 N 页 共 256 页」整行丢弃", () => {
    const raw = [
      "条款：投标文件未按要求签署盖章的投标无效。",
      "政府采购项目公开招标文件示范文本（服务类）",
      "第 8 页 共 256 页",
      "重点补充：本项目为电子标，须自行确认 CA 证书有效期。",
    ].join("\n")
    const out = cleanParseSectionContent(raw)
    expect(out).toContain("条款：投标文件未按要求签署盖章的投标无效。")
    expect(out).toContain("重点补充：本项目为电子标")
    expect(out).not.toContain("示范文本")
    expect(out).not.toContain("共 256 页")
  })

  it("带冒号的真实字段行不被误杀（「招标文件：……」必须保留）", () => {
    const out = cleanParseSectionContent("招标文件：政府采购项目公开招标文件示范文本\n评标方法：综合评分法")
    expect(out).toContain("招标文件：政府采购项目公开招标文件示范文本")
    expect(out).toContain("评标方法：综合评分法")
  })
})

describe("解析去重：画像型分区的近重复行", () => {
  // 真实数据：overview「建设内容」与 project_info「建设内容概况」是同源改写的两段长文本
  const buildContent =
    "建设内容：包含门诊服务、急诊服务、住院服务、临床辅助、医疗运营、医疗质量、药库管理、药房管理、智能用药管理、医疗辅助等功能模块；建设业务中台、数据中台、数据应用平台、AI智能体、集成服务引擎、临床服务、医疗运营、医疗质量、药事服务、AI创新应用、中医特色系统、旧系统数据导入、无纸化、国内产品、其他单招系统对接、院内利旧旧系统对接"
  const buildContentAlt =
    "建设内容概况：项目包含门诊服务、急诊服务、住院服务、临床辅助、医疗运营、医疗质量、药库管理、药房管理、智能用药管理、医疗辅助等功能模块；建设业务中台、数据中台、数据应用平台、AI智能体、集成服务引擎、临床服务、医疗运营、医疗质量、药事服务、AI创新应用、中医特色系统、旧系统数据导入、无纸化、国内产品、其他单招系统对接、院内利旧旧系统对接"

  it("同源改写的长段落后出现者被丢弃，首个分区保留一份", () => {
    const r = dedupeAcrossSections(
      report([
        section("overview", buildContent),
        section("project_info", ["项目背景：本项目为公开招标项目。", buildContentAlt].join("\n")),
      ]),
    )
    const ov = r.sections.find((s) => s.key === "overview")!.content
    const pi = r.sections.find((s) => s.key === "project_info")!.content
    expect(ov).toContain("建设内容：包含门诊服务")
    expect(pi).not.toContain("建设内容概况")
  })

  it("两个分区内容确实不同时都保留（防误删）", () => {
    const other =
      "工期要求：合同签订之日起36个月；免费质保期为项目整体验收合格之日起3年。卖方应于合同签字生效后开始计算的规定日内完成合同规定的服务内容，由买方组织验收小组按验收表格逐项验收。"
    const r = dedupeAcrossSections(report([section("overview", buildContent), section("project_info", other)]))
    expect(r.sections.find((s) => s.key === "project_info")!.content).toContain("工期要求")
  })

  it("真实语料：安中医 2026BFAFZ50845 的 overview / project_info 两段 1186·1172 字同源建设内容只留一份", () => {
    const r = dedupeAcrossSections(
      report([
        section("overview", REAL_OVERVIEW_BUILD_CONTENT),
        section(
          "project_info",
          [
            "项目背景：本项目为安徽中医药大学第一附属医院一体化核心业务系统建设，采购方式为公开招标，采用综合评分法评标。",
            REAL_PROJECT_INFO_BUILD_CONTENT,
            "工期要求：合同签订之日起36个月；免费质保期为项目整体验收合格之日起3年。",
          ].join("\n"),
        ),
      ]),
    )
    const ov = r.sections.find((s) => s.key === "overview")!.content
    const pi = r.sections.find((s) => s.key === "project_info")!.content
    expect(ov.startsWith("建设内容：")).toBe(true)
    expect(pi).not.toContain("建设内容概况")
    expect(pi).toContain("工期要求")
  })

  it("必选分区不会被清空：只剩一条同源行时宁可留重复，也不能变空分区（否则误报必选项解析失败）", () => {
    const r = dedupeAcrossSections(
      report([section("overview", REAL_OVERVIEW_BUILD_CONTENT), section("project_info", REAL_PROJECT_INFO_BUILD_CONTENT)]),
    )
    expect(r.sections.find((s) => s.key === "project_info")!.content).not.toBe("")
  })

  it("清单型分区（delivery_req）不参与近重复丢弃——同构的功能要求行必须保留", () => {
    const a =
      "资产模型管理：支持展示资产目录层级及目录下的资产模型层级关系，可模糊检索目录及模型；支持模型新增/编辑功能，包括资产模型的基本信息（模型编码、模型名称、描述、归属产品线、使用产品线等）。"
    const b =
      "资产值域管理：支持展示资产目录层级及目录下的资产模型层级关系，可模糊检索目录及模型；支持模型新增/编辑功能，包括资产模型的基本信息（模型编码、模型名称、描述、归属产品线、使用产品线等）。"
    const r = dedupeAcrossSections(report([section("delivery_req", [a, b].join("\n"))]))
    expect(r.sections[0].content).toContain("资产模型管理")
    expect(r.sections[0].content).toContain("资产值域管理")
  })
})

describe("大纲：资信类评分项不再补出零子节点裸章", () => {
  const item = (over: Partial<NumberedScoringItem>): NumberedScoringItem => ({
    id: "R1",
    item: "总体技术解决方案",
    score: 5,
    criteria: "方案完整得5分",
    category: "tech",
    isSubjective: true,
    ...over,
  })

  it("「项目团队配备」这类资信项不补章（落点在商务材料，补了只是空章）", () => {
    const { added } = ensureSubjectiveScoringChapters([], [item({ id: "R13", item: "项目团队配备", score: 10 })])
    expect(added).toEqual([])
  })

  it("「履约能力 / 综合实力 / 类似项目业绩」同样不补章", () => {
    const { added } = ensureSubjectiveScoringChapters(
      [],
      [
        item({ id: "R10", item: "履约能力", score: 4 }),
        item({ id: "R11", item: "综合实力", score: 8 }),
        item({ id: "R12", item: "类似项目业绩与案例", score: 10 }),
      ],
    )
    expect(added).toEqual([])
  })

  it("方案类主观项未被覆盖时仍补章（原有行为不被削弱）", () => {
    const { added } = ensureSubjectiveScoringChapters([], [item({})])
    expect(added).toEqual(["总体技术解决方案"])
  })

  it("方案类主观项已被章节覆盖时不重复补章", () => {
    const outline: OutlineNode[] = [
      { id: "a", title: "总体技术解决方案", children: [{ id: "b", title: "项目理解与现状分析", children: [] }] },
    ]
    const { added } = ensureSubjectiveScoringChapters(outline, [item({})])
    expect(added).toEqual([])
  })
})

describe("正文文风：跨章指引授权已删除", () => {
  it("strict 模式不再授权「确需指引时只写一句『详见《第X章』」（它与禁任务分派条冲突）", () => {
    const strict = complianceModeRule("strict")
    expect(strict).not.toContain("确需指引时只写一句")
    expect(strict).toContain("技术正文一律不向其他章节做指引或分派")
  })

  it("moderate / full 同样不含该授权句", () => {
    expect(complianceModeRule("moderate")).not.toContain("确需指引时只写一句")
    expect(complianceModeRule("full")).not.toContain("确需指引时只写一句")
  })
})

describe("正文文风：应答套话检测", () => {
  it("「我公司对本条款的响应结论为」被检出（真稿 27 处的形态，旧规则一条都抓不到）", () => {
    const content =
      "我公司对本条款的响应结论为：满足招标文件要求。系统支持患者主索引自动合并与相似索引匹配规则设置，支持按业务域注册唯一识别 ID。"
    const hits = lintProse(content).hits
    expect(hits.some((h) => h.reason.includes("响应结论"))).toBe(true)
  })

  it("技术参数响应表的表头「响应结论」不误报", () => {
    const content = [
      "11.1 技术参数响应表",
      "序号  招标参数  响应值  偏离  响应结论",
      "1  支持日均门诊 15000 人次以上  满足  无偏离  满足",
      "2  支持日均住院 5000 人次以上  满足  无偏离  满足",
    ].join("\n")
    const hits = lintProse(content, "技术参数响应").hits
    expect(hits.filter((h) => h.reason.includes("响应结论"))).toEqual([])
  })
})
