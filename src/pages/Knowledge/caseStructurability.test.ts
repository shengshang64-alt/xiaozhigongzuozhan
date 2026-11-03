// 案例结构化可行性评估 · 抽取器回归（DS-R02）
//
// 背景：对标基线差距 #8「案例结构化库」。本轮不新建数据模型（跨模块大改造需用户确认），
// 只做只读评估工具，为后续是否投产提供数据依据。
//
// 本文件守两件事：
//   ① 三个抽取器（金额/年份/医院）的基本正确性；
//   ② **医院名不许误报通用表述** —— 这条是实测踩出来的：
//      朴素正则把「包含医院」「互联网医院」「安徽省评级过级医院」当成机构名，
//      这类脏值进结构化字段后，生成标书会写出「服务过包含医院」这种废句。
//      按本项目真实性红线：宁可抽不到留空，也不能抽错。
import { describe, expect, it } from "vitest"
import {
  extractAmountWan,
  extractHospitals,
  extractYears,
  assessCaseDoc,
  summarizeCaseStructurability,
} from "./caseStructurability"

describe("extractAmountWan · 合同金额（万元）", () => {
  it("「N 万元」直接取", () => {
    expect(extractAmountWan("项目合同金额 1204.3 万元")).toBe(1204.3)
    expect(extractAmountWan("中标价 860 万元整")).toBe(860)
  })

  it("「N 元」换算成万元", () => {
    expect(extractAmountWan("合同价 8600000 元")).toBe(860)
  })

  it("没有金额返回 null（不瞎猜）", () => {
    expect(extractAmountWan("本项目不涉及金额")).toBeNull()
    expect(extractAmountWan("")).toBeNull()
  })
})

describe("extractYears · 年份", () => {
  it("抽 2020-2030 之间的年份，去重升序", () => {
    expect(extractYears("2023年上线，2024年验收，2023年二期")).toEqual([2023, 2024])
  })

  it("越界年份不收", () => {
    expect(extractYears("2019年 2031年")).toEqual([])
  })

  it("无年份返回空数组", () => {
    expect(extractYears("没有年份")).toEqual([])
  })
})

describe("extractHospitals · 医院名（防误报是重点）", () => {
  it("真医院名能抽到", () => {
    const r = extractHospitals("服务过蚌埠医学院第一附属医院、安徽医科大学第二附属医院")
    expect(r).toContain("蚌埠医学院第一附属医院")
    expect(r.length).toBeGreaterThan(0)
  })

  it("通用表述不许当医院名（实测误报清单）", () => {
    const dirty = [
      "包含医院",
      "互联网医院",
      "安徽省评级过级医院",
      "三甲综合医院",
      "省互联互通四级甲等及以上医院",
      "该医院",
      "各家医院",
    ]
    for (const d of dirty) {
      expect(extractHospitals(d), `「${d}」不该被当成医院名`).toEqual([])
    }
  })

  it("混合文本里只保留真名，脏词剔除", () => {
    const r = extractHospitals("包含医院、互联网医院、太和县人民医院、三甲综合医院")
    expect(r).toContain("太和县人民医院")
    expect(r.some((x) => x.includes("包含"))).toBe(false)
    expect(r.some((x) => x.includes("互联网"))).toBe(false)
  })

  it("以「及以上/等/的」收尾的不收", () => {
    expect(extractHospitals("覆盖二级及以上医院")).toEqual([])
  })
})

describe("assessCaseDoc / summarizeCaseStructurability", () => {
  it("单条评估四项字段齐全", () => {
    const c = assessCaseDoc({
      id: "k1",
      title: "某医院智慧医院项目案例",
      content: "2023年签约，合同额 1204.3 万元，服务太和县人民医院",
    })
    expect(c.amountWan).toBe(1204.3)
    expect(c.years).toEqual([2023])
    expect(c.hospitals).toContain("太和县人民医院")
  })

  it("汇总：空数组安全", () => {
    const r = summarizeCaseStructurability([])
    expect(r.caseDocCount).toBe(0)
    expect(r.extractableRate).toBe(0)
    expect(r.samples).toEqual([])
  })

  it("汇总：抽取率与字段命中统计正确", () => {
    const docs = [
      { id: "a", title: "案例A", content: "2023年 合同额 100 万元" },
      { id: "b", title: "案例B", content: "服务某医院" },
      { id: "c", title: "案例C", content: "无任何结构化信息可用" },
    ]
    const r = summarizeCaseStructurability(docs)
    expect(r.caseDocCount).toBe(3)
    expect(r.fieldHits.amount).toBe(1)
    expect(r.fieldHits.year).toBe(1)
    // 「服务某医院」命中医院（某医院 长度 3，含「医院」但不短于 4 → 不收）
    expect(r.extractable).toBeGreaterThanOrEqual(1)
    expect(r.extractableRate).toBeGreaterThan(0)
  })
})
