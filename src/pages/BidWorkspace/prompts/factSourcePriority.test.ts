import { describe, expect, it } from "vitest"
import { buildFactSettingsMessages, PROMPT_VERSION } from "./factSettings"
import { FACT_CONFIRM_MARK, TENDER_CONSTRAINT_VALUE_RE } from "../factSources"

// P0-2 提示词契约：锁住「范本不得覆盖本项目事实」「要求类数字不得落成已定承诺」两条口径，
// 并保证提示词里承诺的标记/比较口径与 factSources.ts 的判定口径同源（改一边不改另一边必红）。

const systemOf = (text = "第三章 采购需求：工期 90 天，响应时间 2 小时。"): string => {
  const c = buildFactSettingsMessages(text)[0]?.content
  return typeof c === "string" ? c : ""
}

describe("P0-2 事实来源优先级提示词契约", () => {
  it("PROMPT_VERSION 已升版（1 → 2）", () => {
    expect(PROMPT_VERSION).toBe(2)
  })

  it("来源优先级显式分层，且招标硬约束排在历史范本之前", () => {
    const s = systemOf()
    expect(s).toContain("事实来源优先级")
    expect(s).toContain("硬性要求")
    expect(s).toContain("写法与表述范式")
    expect(s.indexOf("本项目招标文件原文")).toBeGreaterThan(-1)
    expect(s.indexOf("本项目招标文件原文")).toBeLessThan(s.indexOf("历史标书范本"))
  })

  it("禁止范本口径覆盖本项目（旧第 7 条的『优先采用范本』必须消失）", () => {
    const s = systemOf()
    expect(s).not.toContain("优先采用范本")
    expect(s).toMatch(/禁止用范本数值或表述覆盖本项目/)
  })

  it("要求类数字只能保留比较口径或带确认标记（旧第 4 条的承诺化改写必须消失）", () => {
    const s = systemOf()
    expect(s).not.toContain("本项目工期：90 天（满足招标不超过 90 天要求）")
    expect(s).toMatch(/禁止改写成「本项目工期：90 天」/)
    // 提示词给的比较口径样例必须真的被 factSources 判定为 constraint（同源守卫）
    expect(s).toContain("工期：不超过 90 天")
    expect(TENDER_CONSTRAINT_VALUE_RE.test("不超过 90 天")).toBe(true)
    expect(s).toContain(`${FACT_CONFIRM_MARK}`)
  })

  it("需拍板项的范围覆盖工期/报价/人员/质保与响应时限，且要求缺失时用确认标记", () => {
    const s = systemOf()
    expect(s).toMatch(/工期\/交货期、报价\/金额、人员数量、质保与响应时限/)
    expect(s).toMatch(/找不到明确依据时必须写「【需人工确认】」/)
    expect(s).toMatch(/严禁编造天数、金额、人数或日期/)
  })

  it("输出格式契约未变（一行一条「主题：统一口径」+ 纯文本无围栏）", () => {
    const msgs = buildFactSettingsMessages("【第三章 采购需求】工期 90 天")
    expect(msgs).toHaveLength(2)
    expect(msgs[0]?.role).toBe("system")
    expect(msgs[1]?.role).toBe("user")
    expect(msgs[1]?.content).toContain("【招标文件解析报告关键节】")
    expect(msgs[1]?.content).toContain("请输出全局事实设定清单（一行一条「主题：统一口径」）。")
    expect(msgs[0]?.content).toContain("直接输出清单纯文本")
    expect(msgs[0]?.content).toContain("输出 10-30 条")
  })

  it("空报告输入仍有兜底文案（不回退到旧口径）", () => {
    const msgs = buildFactSettingsMessages("")
    expect(msgs[1]?.content).toContain("（解析报告为空）")
    expect(msgs[0]?.content).not.toContain("优先采用范本")
  })
})