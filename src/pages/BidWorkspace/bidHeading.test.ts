import { describe, expect, it } from "vitest"
import { isRealSectionHeading } from "./bidTypes"

// 问题3（2026-10-12）：导出时正文句不得被误判为小节标题（Heading 2）。
// 用建阳投标文件真实「误判行 / 正例行」回归。
const sections = ["项目背景与目标", "集成平台架构总体设计", "接口对接与协同保障方案", "交付与验收路径规划"]

describe("isRealSectionHeading（问题3 标题判定）", () => {
  it("真小节标题（N.M 名）识别为标题", () => {
    expect(isRealSectionHeading("2.2 集成平台架构总体设计", sections, 2)).toBe(true)
    expect(isRealSectionHeading("2.3 接口对接与协同保障方案", sections, 2)).toBe(true)
  })
  it("全角空格分隔仍识别", () => {
    expect(isRealSectionHeading("2.2　集成平台架构总体设计", sections, 2)).toBe(true)
  })
  it("无编号但整行精确等于小节标题识别为标题", () => {
    expect(isRealSectionHeading("交付与验收路径规划", sections, 2)).toBe(true)
  })
  it("合法三级子标题（N.M.K 短）识别", () => {
    expect(isRealSectionHeading("2.2.1 逻辑架构", sections, 2)).toBe(true)
  })
  it("以小节名作主语的正文句不得升级为标题（startsWith 误伤回归）", () => {
    expect(isRealSectionHeading("集成平台架构总体设计的范围覆盖多个子系统", sections, 2)).toBe(false)
    expect(isRealSectionHeading("接口对接与协同保障方案覆盖全部接口清单", sections, 2)).toBe(false)
  })
  it("数字开头的长正文/带句末标点行不得升级（14.2.1 误伤回归）", () => {
    expect(
      isRealSectionHeading(
        "2.2.1 总体设计的岗位职责分工与值守机制的具体人员姓名及到岗计划详见【待填写】，上述内容与后续小节保持一致。",
        sections,
        2,
      ),
    ).toBe(false)
  })
  it("编号首段非本章号一律当正文", () => {
    expect(isRealSectionHeading("3.2 集成平台架构总体设计", sections, 2)).toBe(false)
  })
  it("N.M 越界小节数或名称不符（如「2.5 万元设备」）当正文", () => {
    expect(isRealSectionHeading("2.9 交付说明", sections, 2)).toBe(false)
    expect(isRealSectionHeading("2.1 万元设备采购预算", sections, 2)).toBe(false)
  })
  it("超长行（>40 字）当正文", () => {
    const long = "2.2 " + "集".repeat(45)
    expect(isRealSectionHeading(long, sections, 2)).toBe(false)
  })
})
