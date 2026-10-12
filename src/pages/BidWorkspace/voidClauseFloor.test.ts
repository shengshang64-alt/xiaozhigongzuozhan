// R-026③（R257）废标条数下限报警 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import { MIN_VOID_CLAUSES, splitVoidClauses, voidClauseFloorWarning } from "./voidClauseFloor"

describe("R-026③ 废标条数下限报警（R257）", () => {
  it("达下限（≥3 条）不报", () => {
    const ok = "未按要求密封\n未按规定盖章\n投标报价超过预算\n资格审查不通过"
    expect(voidClauseFloorWarning(ok)).toBeNull()
  })

  it("抽到但少于下限（1~2 条）报警，含条数与下限", () => {
    const few = voidClauseFloorWarning("未按要求密封\n报价超预算")
    expect(few).not.toBeNull()
    expect(few).toContain("仅解析到 2 条")
    expect(few).toContain(String(MIN_VOID_CLAUSES))
    const one = voidClauseFloorWarning("未按要求密封")
    expect(one).toContain("仅解析到 1 条")
  })

  it("0 条 / 原文未提及 / AI 降级占位不报（防误伤合理缺席）", () => {
    expect(voidClauseFloorWarning("")).toBeNull()
    expect(voidClauseFloorWarning("   \n  \n")).toBeNull()
    expect(voidClauseFloorWarning("原文未提及")).toBeNull()
    expect(voidClauseFloorWarning("〔系统降级〕检索原文占位")).toBeNull()
  })

  it("splitVoidClauses 去行首编号与空行（与 runVoidCheck 同口径 /^\\d+[.、]\\s*/）", () => {
    const lines = splitVoidClauses("1. 未密封\n2、未盖章\n\n3. 超预算\n")
    expect(lines).toEqual(["未密封", "未盖章", "超预算"])
  })
})
