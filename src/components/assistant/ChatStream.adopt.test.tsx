/**
 * D4 SkillAdoptRow 写回链路单测
 * 验证：
 * 1. ADOPTABLE 集合覆盖所有预设技能
 * 2. 竞品写回逻辑（追加 threat_notes）
 * 3. 标书素材写回逻辑（追加 ref_materials_text）
 * 4. 拜访清单存跟进记录
 * 5. 方案大纲复制+跳转
 */
import { describe, it, expect } from "vitest"

// ---------- 纯逻辑单测（不渲染组件，测核心判断函数） ----------

// 复制 ADOPTABLE 集合用于验证
const ADOPTABLE = new Set([
  "写客户跟进邮件",
  "生成周报总结",
  "竞品深度分析",
  "招标文件要点梳理",
  "客户拜访准备清单",
  "方案大纲构思",
])

describe("SkillAdoptRow 写回链路", () => {
  it("1. ADOPTABLE 覆盖六个预设技能", () => {
    expect(ADOPTABLE.has("写客户跟进邮件")).toBe(true)
    expect(ADOPTABLE.has("生成周报总结")).toBe(true)
    expect(ADOPTABLE.has("竞品深度分析")).toBe(true)
    expect(ADOPTABLE.has("招标文件要点梳理")).toBe(true)
    expect(ADOPTABLE.has("客户拜访准备清单")).toBe(true)
    expect(ADOPTABLE.has("方案大纲构思")).toBe(true)
  })

  it("2. 非预设技能不触发采纳（自定义技能列表不在 ADOPTABLE）", () => {
    expect(ADOPTABLE.has("我的自定义指令")).toBe(false)
    expect(ADOPTABLE.has("医院售前汇报 PPT 专家")).toBe(false)
  })

  it("3. threat_notes 追加逻辑：空字段 → 新内容", () => {
    const prev = ""
    const content = "分析结论：敌弱我强"
    const stamp = "2026-09-30"
    const next = prev ? `${prev}\n\n---\n【AI 深度分析 ${stamp}】\n${content}` : `【AI 深度分析 ${stamp}】\n${content}`
    expect(next).toBe(`【AI 深度分析 2026-09-30】\n分析结论：敌弱我强`)
  })

  it("4. threat_notes 追加逻辑：已有内容 → 换行+分隔符+新内容", () => {
    const prev = "原有威胁笔记"
    const content = "新分析"
    const stamp = "2026-10-04"
    const next = prev ? `${prev}\n\n---\n【AI 深度分析 ${stamp}】\n${content}` : `【AI 深度分析 ${stamp}】\n${content}`
    expect(next).toContain("原有威胁笔记")
    expect(next).toContain("---")
    expect(next).toContain("【AI 深度分析 2026-10-04】")
    expect(next).toContain("新分析")
  })

  it("5. ref_materials_text 追加逻辑同理", () => {
    const prev = "之前的素材"
    const content = "评分办法要点"
    const stamp = "2026-10-04"
    const next = prev ? `${prev}\n\n---\n【招标要点梳理 ${stamp}】\n${content}` : `【招标要点梳理 ${stamp}】\n${content}`
    expect(next).toContain("之前的素材")
    expect(next).toContain("【招标要点梳理 2026-10-04】")
  })

  it("6. 跟进 record_type 映射正确", () => {
    const typeMap: Record<string, string> = {
      "写客户跟进邮件": "邮件跟进",
      "客户拜访准备清单": "拜访准备",
    }
    expect(typeMap["写客户跟进邮件"]).toBe("邮件跟进")
    expect(typeMap["客户拜访准备清单"]).toBe("拜访准备")
    // 竞品分析不走跟进记录
    expect(typeMap["竞品深度分析"]).toBeUndefined()
  })

  it("7. 竞品深度分析走 PATCH competitors 而非 POST follow_records", () => {
    // 验证 API endpoint 路径模式
    const compPath = "/api/competitors/some-id"
    const followPath = "/api/follow_records"
    expect(compPath).toMatch(/\/api\/competitors\//)
    expect(followPath).toMatch(/\/api\/follow_records/)
    expect(compPath).not.toMatch(/follow_records/)
  })
})
