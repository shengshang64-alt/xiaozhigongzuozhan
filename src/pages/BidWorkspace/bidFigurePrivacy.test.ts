import { describe, expect, it } from "vitest"
import {
  MASK_POLICY,
  MODULE_GROUP,
  groupOf,
  maskedFields,
  mosaicCss,
  omittedFields,
  sanitizeDemoSidebar,
} from "./bidFigurePrivacy"

// 界面示意图的"真实性 + 隐私打码"口径网（用户 2026-10-15）。
// 断的是口径本身：什么必打码、什么不许出现、同屏模块必须同组——这三条错一条，图片就是穿帮的。

describe("打码口径", () => {
  it("个人与机构信息必须打码（姓名/手机/身份证/医院/医生），且不留白", () => {
    const masked = maskedFields()
    for (const f of ["patient_name", "patient_phone", "patient_id_card", "doctor_name", "hospital_name"]) {
      expect(masked, f).toContain(f)
    }
  })

  it("公司名称/LOGO/地址必须整字段不出现", () => {
    const omitted = omittedFields()
    for (const f of ["company_name", "company_logo", "company_address"]) {
      expect(omitted, f).toContain(f)
    }
  })

  it("每个策略键都有明确处置，不允许「没规定」的字段（防漏打码）", () => {
    for (const [k, v] of Object.entries(MASK_POLICY)) {
      expect(["mosaic", "omit"], k).toContain(v)
    }
    expect(maskedFields().length + omittedFields().length).toBe(Object.keys(MASK_POLICY).length)
  })

  it("马赛克样式是「打码」不是「隐藏」：必须有效果、不得 display:none/visibility:hidden", () => {
    const css = mosaicCss(7)
    expect(css).toContain("blur(")
    expect(css).not.toContain("display:none")
    expect(css).not.toContain("visibility:hidden")
    expect(css).not.toContain("opacity:0")
    // 同 seed 稳定（可复现），不同 seed 错开网格（整屏不同纹）
    expect(mosaicCss(7)).toBe(css)
    expect(mosaicCss(8)).not.toBe(css)
  })
})

describe("左侧功能栏的同屏可辨识性", () => {
  it("用户举的例子：门诊医生工作站与住院护士工作站不得同屏", () => {
    const r = sanitizeDemoSidebar(["门诊医生工作站", "住院护士工作站", "门诊收费"])
    expect(r.kept).not.toContain("住院护士工作站")
    expect(r.dropped).toContain("住院护士工作站")
    expect(r.reason).toContain("跨场景")
    // 保留项必须是同一场景分组（不足 4 项会用同组模块补齐，保持真实侧栏观感）
    expect(r.kept.every((m) => groupOf(m) === "outpatient")).toBe(true)
    expect(r.kept).toContain("门诊医生工作站")
    expect(r.kept.length).toBeGreaterThanOrEqual(4)
  })

  it("同场景模块整组保留（挂号/医生站/收费是真实同居一屏的组合）", () => {
    const r = sanitizeDemoSidebar(["门诊挂号", "门诊医生工作站", "门诊收费"])
    for (const m of ["门诊挂号", "门诊医生工作站", "门诊收费"]) expect(r.kept, m).toContain(m)
    expect(r.dropped).toEqual([])
    expect(r.kept.every((m) => groupOf(m) === "outpatient")).toBe(true)
  })

  it("药事与门诊分属不同角色视角：医生站同屏不画药房（按角色不是按科室）", () => {
    const r = sanitizeDemoSidebar(["门诊医生工作站", "门诊药房"])
    expect(r.dropped).toEqual(["门诊药房"])
    expect(r.kept).not.toContain("门诊药房")
    expect(r.kept.every((m) => groupOf(m) === "outpatient")).toBe(true)
  })

  it("未收录分组的模块一律不上屏（不确定的宁可不画）", () => {
    const r = sanitizeDemoSidebar(["某某智能助手", "门诊医生工作站"])
    expect(r.kept).not.toContain("某某智能助手")
    expect(r.dropped).toContain("某某智能助手")
    expect(r.kept.every((m) => groupOf(m) === "outpatient")).toBe(true)
  })

  it("分组数量不足时用同组模块补齐（保持「功能成组」的真实观感）", () => {
    const r = sanitizeDemoSidebar(["检验管理"], { minKeep: 4 })
    expect(r.kept.length).toBe(4)
    expect(r.kept.every((m) => groupOf(m) === "medtech")).toBe(true)
  })

  it("整栏都不可识别时整体不画（宁可不上屏也不画错系统）", () => {
    const r = sanitizeDemoSidebar(["未知模块", "某某助手"])
    expect(r.kept).toEqual([])
    expect(r.reason).toContain("可识别")
  })

  it("个别未收录模块排在最前时，锚点自动落到第一个可识别模块（不因一个新模块整屏不画）", () => {
    const r = sanitizeDemoSidebar(["某某智能助手", "门诊医生工作站", "门诊收费"])
    expect(r.kept).toContain("门诊医生工作站")
    expect(r.dropped).toContain("某某智能助手")
  })

  it("词表自身自洽：分组值都在允许集合内，无空模块名", () => {
    const groups = new Set(["outpatient", "inpatient", "medtech", "pharmacy", "management", "platform", "emr", "internet"])
    for (const [name, g] of Object.entries(MODULE_GROUP)) {
      expect(name.trim().length, name).toBeGreaterThan(0)
      expect(groups.has(g as string), `${name} -> ${g}`).toBe(true)
    }
  })
})
