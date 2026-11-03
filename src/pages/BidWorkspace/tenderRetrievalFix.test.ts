import { describe, expect, it } from "vitest"
import { splitForRetrieval, retrieveTenderFragments } from "./bidTypes"

// ---------------------------------------------------------------------------
// 招标原文检索修复验收测试（2026-10-31）
//
// 真实缺陷（在真实项目上实测发现）：
//   「安徽中医药大学第一附属医院一体化核心」的 152,240 字招标正文，
//   被原实现 splitParagraphs(text, 40, 2000) 切成 **1 个段落**（PDF 转出无空行），
//   于是检索只能取到这 1 个巨型段落、被 maxChars 截断，
//   结果「培训方案」检索到 **0 字**——而原文实际有 10 处「培训」和明确的培训评分项。
//
// 这直接导致：生成培训方案/实施方案/应急方案时，模型看不到招标原文里的对应要求，
// 只能凭通用模板写——正文针对性差。
//
// 本测试锁住两件事：
//   ① 无空行/短行的 PDF 式文本也能切出有语义的检索单元（不丢内容）
//   ② 检索能真正命中章节主题
// ---------------------------------------------------------------------------

/** 模拟 PDF 转出的招标正文：无空行、每行都很短 */
function pdfLikeText(): string {
  const lines: string[] = []
  lines.push("政府采购项目公开招标文件示范文本（服务类）")
  lines.push("项 目 名 称 ： 某某医院一体化核心业务系统建设")
  lines.push("项 目 编 号 ： 2026BFAFZ50845")
  lines.push("第五章 培训要求")
  lines.push("投标人须提供完整的培训方案，包括培训计划、培训内容、培训师资。")
  lines.push("培训对象包括医院信息科人员、临床科室骨干、系统管理员。")
  lines.push("培训方式采用现场集中培训与线上远程培训相结合的方式。")
  lines.push("培训完成后须提供培训教材与考核记录，培训费用包含在投标总价中。")
  lines.push("第六章 实施要求")
  lines.push("项目实施周期为 12 个月，须分阶段实施并提交实施计划。")
  lines.push("实施阶段包括需求调研、系统设计、开发测试、上线试运行、验收。")
  lines.push("投标人须配备专职项目经理负责实施全过程管理。")
  lines.push("第七章 应急与运维")
  lines.push("系统须具备应急响应能力，故障响应时间不超过 30 分钟。")
  lines.push("运维服务包括日常巡检、故障处理、性能优化、版本升级。")
  lines.push("质保期内提供 7x24 小时运维保障服务。")
  return lines.join("\n")
}

describe("splitForRetrieval：PDF 式文本的检索切分", () => {
  const text = pdfLikeText()

  it("短行会被合并，而不是被丢弃（原实现丢 96%）", () => {
    const paras = splitForRetrieval(text)
    expect(paras.length).toBeGreaterThan(0)
    // 覆盖率应接近 100%（允许去掉空白）
    const total = paras.reduce((n, p) => n + p.length, 0)
    const meaningful = text.replace(/\s/g, "").length
    expect(total / meaningful).toBeGreaterThan(0.85)
  })

  it("每段不超过上限（便于打分与截断）", () => {
    const paras = splitForRetrieval(text)
    for (const p of paras) expect(p.length).toBeLessThanOrEqual(620)
  })

  it("关键内容没有被切碎丢字", () => {
    const joined = splitForRetrieval(text).join("")
    expect(joined).toContain("培训方案")
    expect(joined).toContain("实施周期")
    expect(joined).toContain("应急响应")
  })

  it("超长单行按句切分（不产生巨型段）", () => {
    const longLine = "这是第一句话内容比较长需要被切分的测试文本。".repeat(30)
    const paras = splitForRetrieval(longLine)
    expect(paras.length).toBeGreaterThan(1)
    for (const p of paras) expect(p.length).toBeLessThanOrEqual(620)
  })

  it("空文本/空白安全", () => {
    expect(splitForRetrieval("")).toEqual([])
    expect(splitForRetrieval("   \n\n  ")).toEqual([])
  })
})

describe("retrieveTenderFragments：真实检索命中", () => {
  const text = pdfLikeText()

  it("「培训方案」能检索到培训相关内容（修复前是 0 字）", () => {
    const frag = retrieveTenderFragments(text, { title: "培训方案", sections: [], clauses: [] }, 8000, 24)
    expect(frag.length).toBeGreaterThan(0)
    expect(frag).toContain("培训")
  })

  it("「实施计划」能检索到实施相关内容", () => {
    const frag = retrieveTenderFragments(text, { title: "项目实施与管理", sections: [], clauses: [] }, 8000, 24)
    expect(frag.length).toBeGreaterThan(0)
    expect(frag).toContain("实施")
  })

  it("「应急方案」能检索到应急相关内容", () => {
    const frag = retrieveTenderFragments(text, { title: "应急与运维方案", sections: [], clauses: [] }, 8000, 24)
    expect(frag.length).toBeGreaterThan(0)
    expect(/应急|运维/.test(frag)).toBe(true)
  })

  it("返回内容不超过 maxChars", () => {
    const frag = retrieveTenderFragments(text, { title: "培训方案", sections: [], clauses: [] }, 500, 10)
    expect(frag.length).toBeLessThanOrEqual(500 + 50) // 允许少量换行开销
  })

  it("空原文返回空串（调用方静默降级）", () => {
    expect(retrieveTenderFragments("", { title: "培训方案", sections: [], clauses: [] })).toBe("")
  })

  it("无关查询不会硬凑内容（宁可返回少也不塞噪声）", () => {
    const frag = retrieveTenderFragments(text, { title: "量子计算机采购", sections: [], clauses: [] }, 8000, 24)
    // 允许返回空或极少内容，但不能整篇返回
    expect(frag.length).toBeLessThan(text.length)
  })
})
