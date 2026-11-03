// ---------------------------------------------------------------------------
// 2026-10-26：导出文件名三要素（日期-标题-版本号）
//
// 为什么要有：公司《投标文件编写规范》要求文件名含「日期、文档标题、版本号」，
// 校验函数 bidWritingRules.checkFileName 早已写好，但**生产代码从没调用过它**——
// 所有导出都是 `${project_name}-投标文件.docx`，用户下载多个版本后无法区分新旧。
// 本测试锁住两件互相咬合的事：
//   ① buildExportFileName 生成的名字必须能通过 checkFileName 校验（否则等于白改）；
//   ② 非法字符被清洗（Windows 不允许 \ / : * ? " < > |）。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { buildExportFileName } from "./bidFiles"
import { checkFileName } from "./bidWritingRules"

const AT = new Date(2026, 8, 17, 14, 30) // 2026-09-17 14:30（月份 0 起）

describe("buildExportFileName：按公司规范生成 日期-标题-版本号", () => {
  it("生成的名字必须能通过 checkFileName 校验（这是接线是否真生效的判据）", () => {
    const name = buildExportFileName("安庆市第二人民医院智慧医院信息化系统项目", "投标文件", AT)
    expect(name).toBe("2026.09.17-安庆市第二人民医院智慧医院信息化系统项目-投标文件-V20260917.1430.docx")
    const check = checkFileName(name)
    expect(check.ok, `生成的文件名未通过规范校验：${check.reason}`).toBe(true)
  })

  it("日期在前、版本号在扩展名前，三段齐全", () => {
    const name = buildExportFileName("某院", "技术偏离表", AT)
    expect(name.startsWith("2026.09.17-")).toBe(true)
    expect(name).toContain("技术偏离表")
    expect(name.endsWith(".docx")).toBe(true)
    // 版本号在最后（扩展名前）
    expect(/-V\d{8}\.\d{4}\.docx$/.test(name)).toBe(true)
  })

  it("Windows 非法字符被清洗成下划线", () => {
    const name = buildExportFileName('某院/项目:一期*测试?"<>|', "投标文件", AT)
    expect(/[\\/:*?"<>|]/.test(name.replace(/^\d{4}\.\d{2}\.\d{2}-/, ""))).toBe(false)
    expect(name).toContain("某院_项目_一期_测试_")
    expect(checkFileName(name).ok).toBe(true)
  })

  it("项目名为空时只留标题（仍带日期与版本号）", () => {
    const name = buildExportFileName("", "投标文件", AT)
    expect(name).toBe("2026.09.17-投标文件-V20260917.1430.docx")
    expect(checkFileName(name).ok).toBe(true)
  })

  it("不同时刻导出得到不同版本号（用户能按文件名分出新旧）", () => {
    const a = buildExportFileName("某院", "投标文件", new Date(2026, 8, 17, 14, 30))
    const b = buildExportFileName("某院", "投标文件", new Date(2026, 8, 17, 15, 5))
    expect(a).not.toBe(b)
    expect(a).toContain("V20260917.1430")
    expect(b).toContain("V20260917.1505")
  })

  it("月份/日期/时分补零（1 月 1 日 3 点 5 分也要是 2026.01.01 与 0305）", () => {
    const name = buildExportFileName("某院", "投标文件", new Date(2026, 0, 1, 3, 5))
    expect(name.startsWith("2026.01.01-")).toBe(true)
    expect(name).toContain("V20260101.0305")
    expect(checkFileName(name).ok).toBe(true)
  })
})
