import { describe, it, expect } from "vitest"
import { cleanOutlineResidue, residueReason } from "./outlineResidue"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const mk = (title: string, children: OutlineNode[] = [], part?: "biz" | "tech"): OutlineNode => ({
  id: title,
  title,
  children,
  part,
})

// 建阳区样例：这些「章节名」实测是残句 / 评分说明，必须被判为残句
const RESIDUES = [
  "质保期满后系统的维修保养服务内容投标人在",
  "评分项提及在3年的免费质保期基础上",
  "小时内未解决的",
  "必须针对本系统软件及采用的相关技术等提出",
  "收到现场服务通知后4小时内到达现场",
  "培训对象分为普通业务操作员、系统管理员",
  "培训内容包括应用软件操作、操作系统、后台",
  "必须为所有被培训人员进行现场培训",
  "业务系统操作培训工作应在系统终验合格之前",
  "与培训相关的费用应一并计算在投标报价中",
  "保证提供有经验的教员",
  "交货条件为经采购人验收合格",
  "所有系统均需通过信创符合性测试",
  "根据当地网络安全主管部门规定",
]

// 合法章节名，绝不能误伤
const VALID = [
  "质保期", "项目理解与需求分析", "总体建设方案", "集成平台详细设计方案",
  "接口对接详细设计方案", "项目实施组织与进度计划", "质量保障与测试验收方案",
  "信创符合性测试", "技术和服务要求响应表", "标的说明一览表", "投标函",
  "投标保证金", "开标一览表", "商务条件响应表",
]

describe("R-021 residueReason", () => {
  it("flags every建阳区 residue sample", () => {
    for (const t of RESIDUES) expect(residueReason(t), t).not.toBe("")
  })
  it("never flags a valid chapter title", () => {
    for (const t of VALID) expect(residueReason(t), t).toBe("")
  })
})

describe("R-021 cleanOutlineResidue", () => {
  it("removes every residue from the top level", () => {
    const nodes = RESIDUES.map((t) => mk(t))
    const out = cleanOutlineResidue(nodes)
    for (const n of out.nodes) expect(residueReason(n.title), n.title).toBe("")
    expect(out.residueCount).toBeGreaterThanOrEqual(1)
    expect(out.fixes.length).toBeGreaterThanOrEqual(1)
  })

  it("merges术语 redundant sibling chapters into one", () => {
    const nodes = [
      mk("术语管理", [mk("术语定义")]),
      mk("术语维护管理"),
      mk("术语细项管理"),
      mk("术语校验管理"),
    ]
    const out = cleanOutlineResidue(nodes)
    expect(out.mergedGroups).toBeGreaterThanOrEqual(3)
    expect(out.nodes.some((n) => n.title === "术语管理")).toBe(true)
  })

  it("preserves leaf content (no node dropped, only re-nested)", () => {
    const nodes = [mk("小时内未解决的"), mk("总体建设方案")]
    const before = nodes.length
    const out = cleanOutlineResidue(nodes)
    const leafCount = (list: OutlineNode[]): number =>
      list.reduce((acc, n) => acc + (n.children && n.children.length ? leafCount(n.children) : 1), 0)
    expect(leafCount(out.nodes)).toBeGreaterThanOrEqual(leafCount(nodes))
    expect(before).toBeGreaterThan(0)
  })

  it("keeps a valid outline untouched", () => {
    const nodes = VALID.map((t) => mk(t))
    const out = cleanOutlineResidue(nodes)
    expect(out.residueCount).toBe(0)
    expect(out.mergedGroups).toBe(0)
    expect(out.fixes.length).toBe(0)
    expect(out.nodes.map((n) => n.title)).toEqual(VALID)
  })
})
