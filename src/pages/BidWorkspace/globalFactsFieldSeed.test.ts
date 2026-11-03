// R282 回归锈（bid-fact-refetch-failed · 门禁归责③系统可回取）：
// 全局事实表是「正文必须与之一致」的注入源，两处实测污染会让标书与封面编号对不上（评标可当场质疑）：
//   ① 报告行「（招标编号：GXKLG…）」键被全角括号污染、值带尾括号；
//   ② 报告行「招标编号：XX」把招标文件格式模板的空格当事实；
//   ③ bid_projects.tender_no（封面与 .docx 页眉在用的权威值）从来没进事实表 → 编号注入与否随解析质量抖动。
// fixture 形态取自贵港/天坛真实 parse_report，不带招标原文内容。
import { describe, expect, it } from "vitest"
import {
  buildGlobalFacts,
  effectiveGlobalFacts,
  effectiveGlobalFactsLines,
  wrapGlobalFactsBlock,
} from "./bidTypes"
import type { ParseReport } from "./bidTypes"

const report = (key: string, content: string): ParseReport =>
  ({ scope: "key", sections: [{ key, title: "项目基本信息", content }] }) as unknown as ParseReport

/** 贵港形态：编号写在括号里 + 保证金章节带「招标编号：XX」模板空格 + 项目名称带出处注记 */
const guigang = report(
  "overview",
  [
    "（招标编号：GXKLG202630843）",
    "项目名称：贵港市人民医院五六级电子病历及智慧医疗系统升级改造合作项目（出处：第一章 招标公告）",
    "资金来源：企业自筹",
  ].join("\n"),
)

describe("事实行清洗（R282 ①②）", () => {
  it("键值剥掉不成对括号壳与「（出处：…）」注记，数值一个字符都不动", () => {
    const lines = effectiveGlobalFactsLines({ global_facts: "", parse_report: guigang, tender_no: "" })
    expect(lines).toEqual([
      "招标编号=GXKLG202630843",
      "项目名称=贵港市人民医院五六级电子病历及智慧医疗系统升级改造合作项目",
      "资金来源=企业自筹",
    ])
  })

  it("格式模板空格「XX」不作为事实注入（照抄=废标级空缺）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report("bid_deposit", "招标编号：XX\n保证金金额：5万元"),
      tender_no: "",
    })
    expect(lines).toEqual(["保证金金额=5万元"])
  })

  it("编号自带成对中括号（福建/广西格式 [350703]FJXW[GK]2026009）→ 剥壳只处理不成对括号，编号不得被改坏", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report("overview", "项目编号：[350703]FJXW[GK]2026009"),
      tender_no: "[350703]FJXW[GK]2026009",
    })
    expect(lines).toEqual(["招标编号=[350703]FJXW[GK]2026009"])
  })

  it("【待填写】原样进表会被正文照抄，故丢弃", () => {
    expect(effectiveGlobalFactsLines({ global_facts: "", parse_report: report("overview", "联系人：【待填写】"), tender_no: "" })).toEqual([])
  })

  it("纯本地抽取口径同样享受清洗（buildGlobalFacts 老函数行为一致）", () => {
    expect(buildGlobalFacts(guigang)).toBe(
      wrapGlobalFactsBlock([
        "招标编号=GXKLG202630843",
        "项目名称=贵港市人民医院五六级电子病历及智慧医疗系统升级改造合作项目",
        "资金来源=企业自筹",
      ]),
    )
  })
})

describe("招标编号字段兜底（R282 ③）", () => {
  it("报告抽不出编号行（天坛形态：编号写在抬头长句里，>60 字整行丢弃）→ 字段权威值补进行首", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report(
        "overview",
        "项目编号及政府采购任务书编号详见招标公告首页抬头与政府采购计划下达函附件所示的原文表述。\n预算金额：45239200.00 元",
      ),
      tender_no: "WH23CG2026FW8950",
    })
    expect(lines[0]).toBe("招标编号=WH23CG2026FW8950")
    expect(lines).toContain("预算金额=45239200.00 元")
  })

  it("报告已抽出同值编号 → 不重复占预算（同值去重）", () => {
    expect(effectiveGlobalFactsLines({ global_facts: "", parse_report: guigang, tender_no: "GXKLG202630843" })).toEqual([
      "招标编号=GXKLG202630843",
      "项目名称=贵港市人民医院五六级电子病历及智慧医疗系统升级改造合作项目",
      "资金来源=企业自筹",
    ])
  })

  it("字段值与报告值不一致 → 两行并存不静默取舍（编号到底哪个对须人工判定，不能由代码替客户拍板）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report("overview", "项目编号：AAA-001"),
      tender_no: "BBB-002",
    })
    expect(lines).toEqual(["招标编号=BBB-002", "项目编号=AAA-001"])
  })

  it("字段为空/过短/占位 → 不产出兜底行（老项目零行为变化）", () => {
    for (const no of ["", "  ", "XX", "AB", "【待填写】"]) {
      expect(effectiveGlobalFactsLines({ global_facts: "", parse_report: null, tender_no: no })).toEqual([])
    }
  })

  it("人工编辑版事实表优先且原样（字段兜底不得静默改写已保存事实）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "招标编号=以人工为准",
      parse_report: guigang,
      tender_no: "GXKLG202630843",
    })
    expect(lines).toEqual(["招标编号=以人工为准"])
  })

  it("注入块前言不变；字段行占用计入 800 字预算，报告事实再多也挤不掉编号", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `联系人电话${i}：0599888800${i}`).join("\n")
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report("purchaser_info", filler),
      tender_no: "GXKLG202630843",
    })
    expect(lines[0]).toBe("招标编号=GXKLG202630843")
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.join("\n").length).toBeLessThanOrEqual(800)
    expect(effectiveGlobalFacts({ global_facts: "", parse_report: null, tender_no: "GXKLG202630843" })).toBe(
      wrapGlobalFactsBlock(["招标编号=GXKLG202630843"]),
    )
  })
})
