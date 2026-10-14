import { describe, expect, it } from "vitest"
import {
  FACT_CONFIRM_MARK,
  factSourceTierOf,
  normalizeFactSourceLine,
  normalizeFactSourceLines,
} from "./factSources"

// P0-2 事实来源优先级契约测试：锈死「要求类数字不得被静默落成本项目承诺」这一条业务口径。
// 旧行为（反例）：factSettings 旧第 4/7 条会产出「本项目工期：90 天」这类无标记承诺句，
// 且要求范本数值覆盖本项目口径——金额/工期/质保写错即对外交付事故。

describe("P0-2 事实行来源分层", () => {
  it("需商务拍板主题上的已定承诺形态 → 补【需人工确认】（旧行为：原样当既定事实）", () => {
    const cases = [
      "本项目工期：90 天",
      "本项目工期：90 天（满足招标不超过 90 天要求）",
      "工期：90 日历天",
      "质保期：3 年",
      "运维期：5 年",
      "响应时间：2 小时",
      "驻场人数：3 人",
      "投标报价：3480 万元",
      "实施人员：8 人",
    ]
    for (const line of cases) {
      const r = normalizeFactSourceLine(line)
      expect(r.tier, line).toBe("pending")
      expect(r.changed, line).toBe(true)
      expect(r.line, line).toBe(`${line} ${FACT_CONFIRM_MARK}`)
    }
  })

  it("招标原文比较口径保持原样——它是硬约束不是我方承诺（不得被标记）", () => {
    const cases = ["工期：不超过 90 天", "质保期：不少于 2 年", "响应时间：≤2 小时", "服务期：不低于 3 年"]
    for (const line of cases) {
      const r = normalizeFactSourceLine(line)
      expect(r.tier, line).toBe("constraint")
      expect(r.changed, line).toBe(false)
      expect(r.line, line).toBe(line)
    }
  })

  it("非需拍板主题与非事实行一字不动（回归护栏）", () => {
    const cases = [
      "招标编号=GXKLG202630843",
      "项目名称：某某市人民医院智慧医院建设项目",
      "采购人：某某市人民医院",
      "预算金额：3500万元",
      "最高限价：3600万元",
      "服务地点：采购人指定地点",
      "验收标准：满足招标文件要求",
      "项目经理：张三",
    ]
    for (const line of cases) {
      const r = normalizeFactSourceLine(line)
      expect(r.tier, line).toBe("settled")
      expect(r.changed, line).toBe(false)
      expect(r.line, line).toBe(line)
    }
  })

  it("预算金额/最高限价绝不被标记——否则 priceCeilingFromFacts 报价天花板失效", () => {
    const { lines, marked } = normalizeFactSourceLines(["预算金额：3500万元", "最高限价：3600万元", "工期：90 天"])
    expect(marked).toEqual(["工期：90 天 【需人工确认】"])
    expect(lines.filter((l) => l.includes("预算金额"))[0]).toBe("预算金额：3500万元")
    expect(lines.filter((l) => l.includes("最高限价"))[0]).toBe("最高限价：3600万元")
  })

  it("幂等：已带标记的行再规范化不变（保存过的口径不得被重复改写）", () => {
    const once = normalizeFactSourceLine("工期：90 天").line
    const twice = normalizeFactSourceLine(once)
    expect(twice.line).toBe(once)
    expect(twice.changed).toBe(false)
    expect(twice.tier).toBe("pending")
    // 全量批量往返深等价
    const { lines } = normalizeFactSourceLines([once, "不超过 90 天", "项目名称：某某医院"])
    const again = normalizeFactSourceLines(lines)
    expect(again.lines).toEqual(lines)
    expect(again.marked).toEqual([])
  })

  it("分层判定：constraint / pending / settled 三态可判（供面板与提示文案使用）", () => {
    expect(factSourceTierOf("工期：不超过 90 天")).toBe("constraint")
    expect(factSourceTierOf("工期：90 天【需人工确认】")).toBe("pending")
    expect(factSourceTierOf("采购人：某某市人民医院")).toBe("settled")
    expect(factSourceTierOf("")).toBe("settled")
  })

  it("空行与缺冒号行不抛错、不产生空标记", () => {
    expect(normalizeFactSourceLine("").line).toBe("")
    expect(normalizeFactSourceLine("   ").line).toBe("")
    const { lines, marked } = normalizeFactSourceLines(["", "  ", "无冒号的一行"])
    expect(marked).toEqual([])
    expect(lines).toEqual(["", "", "无冒号的一行"])
  })
})