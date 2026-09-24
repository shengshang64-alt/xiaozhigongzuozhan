import { describe, expect, it } from "vitest"
import { extractImplicitConstraints } from "./bidTypes"

describe("extractImplicitConstraints · 完整句提取（R51/F6）", () => {
  it("换行切断的句子接回后再提取，不再产出开头截断的碎片句", () => {
    // 模拟 PDF 在「截止时间」中间换行
    const text = "投标截\n止时间前未完成投标文件传输的，视为撤回投标文件。\n其他正文。"
    const list = extractImplicitConstraints(text)
    expect(list.some((c) => c.includes("视为撤回投标文件"))).toBe(true)
    for (const c of list) {
      expect(c.startsWith("止时间")).toBe(false)
    }
  })

  it("取完整句而非 60 字硬切，句尾不再被拦腰砍断", () => {
    const text = "中标通知书发出视为已送达，投标人应主动登录电子交易系统查询，采购人和采购代理机构不承担投标人未及时关注相关信息引发的相关损失。"
    const list = extractImplicitConstraints(text)
    expect(list).toHaveLength(1)
    expect(list[0].endsWith("相关损失。")).toBe(true)
  })

  it("超长句锚定关键词、按句内标点裁剪，两端补省略号", () => {
    const head = "第一章项目概述中采购人详细介绍了本次一体化核心业务系统建设的背景与目标，"
    const tail = "上述要求均属于实质性要求。"
    const longSentence = head + "投标文件份数不得少于正本一份副本四份，" + tail
    const list = extractImplicitConstraints(longSentence)
    expect(list).toHaveLength(1)
    expect(list[0]).toContain("份")
    expect(list[0].length).toBeLessThanOrEqual(112)
  })

  it("「备份数」中的『份数』不再误判为硬约束", () => {
    const text = "支持基于设置的表备份数规范监控各层数据表的符合情况，列表展示不符合规范的数据表信息。"
    expect(extractImplicitConstraints(text)).toHaveLength(0)
  })

  it("真实语序混排时空行与表格短行不会拼出巨段摘录", () => {
    const text = "投标文件应密封并加盖公章。\n\n序号 | 货物名称 | 数量\n1 | 服务器 | 2台\n上述份数要求见前附表。"
    const list = extractImplicitConstraints(text)
    for (const c of list) expect(c.length).toBeLessThanOrEqual(112)
  })
})
