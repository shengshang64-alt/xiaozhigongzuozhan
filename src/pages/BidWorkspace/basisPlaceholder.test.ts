// ---------------------------------------------------------------------------
// R283 回归锈：编制依据表「编号」列的无编号占位规整（交付门禁「系统可回取」误报的主簇）
//
// 现象（真实库内原文，非构造）：建阳 2 个项目共 15 处判为致命的【待填写】，
// 绝大多数不是「漏填事实」，而是**无编号依据**（项目初设文件、原则性政策表述）
// 被模型按「四列必须有值」硬填了编号列占位 —— 例：
//   1  建阳区边远山区乡镇卫生院灾后重建项目总医院设备及信息化建设初步设计与概算  【待填写】  项目依据；
// 正确写法：编号列填「／」（不适用）。本文件锁定 normalizeBasisPlaceholders 的三道判据。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import {
  BASIS_NO_CODE_TABLE_TOKEN,
  basisStyleRule,
  normalizeBasisPlaceholders,
} from "./bidTypes"

/** 建阳真实形态：一条项目依据（无编号）+ 一条行业标准（有编号占位符的只有前者） */
const JIANYANG_LINE =
  "编制依据如下（序号  名称  编号  类型）：1  建阳区边远山区乡镇卫生院灾后重建项目总医院设备及信息化建设初步设计与概算  【待填写】  项目依据；2  数据互联互通平台建设包招标文件  [350703]FJXW[GK]2026009  采购文件；3  电子病历基本数据集  国家卫健委现行有效版本  行业标准；4  国家及行业现行有效的相关政策与标准（含互联互通测评、电子病历分级评价、网络安全等级保护、商用密码应用相关标准）  【待填写】  政策标准。"

describe("normalizeBasisPlaceholders 依据表编号列规整", () => {
  it("无编号依据（项目依据/政策标准）的编号列占位 → 「／」，有编号的条目一字不动", () => {
    const out = normalizeBasisPlaceholders(JIANYANG_LINE)
    // 两条无编号依据被规整
    expect(out).toContain(`初步设计与概算  ${BASIS_NO_CODE_TABLE_TOKEN}  项目依据`)
    expect(out).toContain(`相关标准）  ${BASIS_NO_CODE_TABLE_TOKEN}  政策标准`)
    // 有编号条目原样保留（编号与名称都没被碰）
    expect(out).toContain("[350703]FJXW[GK]2026009  采购文件")
    expect(out).toContain("电子病历基本数据集  国家卫健委现行有效版本  行业标准")
    // 全句不再残留该两处占位（其余条目本就没有占位符）
    expect(out.split("【待填写】").length - 1).toBe(0)
  })

  it("判据③保护：名称里已含标准编号却仍留空 → 属真漏填，保留占位暴露问题", () => {
    const line = "5  GB/T 22239  【待填写】  强制性国家标准；"
    expect(normalizeBasisPlaceholders(line)).toBe(line)
  })

  it("判据①保护：承诺数值类占位（类型词不匹配）不被动", () => {
    const line = "重大故障时驻场人员在【待填写】分钟内响应，【待填写】小时内到场处理。"
    expect(normalizeBasisPlaceholders(line)).toBe(line)
  })

  it("判据①保护：材料清单类占位（类型词不匹配）不被动", () => {
    const line = "相关产品技术白皮书及检测机构检测报告【待填写】。"
    expect(normalizeBasisPlaceholders(line)).toBe(line)
  })

  it("长词优先：「推荐性国家标准」不被「国家标准」截断", () => {
    const line = "2  信息安全技术  信息系统密码应用基本要求  【待填写】  推荐性国家标准"
    expect(normalizeBasisPlaceholders(line)).toContain(`【待填写】  推荐性国家标准`.replace("【待填写】", BASIS_NO_CODE_TABLE_TOKEN))
  })

  it("幂等：规整后再跑一次结果不变", () => {
    const once = normalizeBasisPlaceholders(JIANYANG_LINE)
    expect(normalizeBasisPlaceholders(once)).toBe(once)
  })

  it("空值/无占位/非依据文本 → 原样返回", () => {
    expect(normalizeBasisPlaceholders("")).toBe("")
    expect(normalizeBasisPlaceholders("本章无编制依据。")).toBe("本章无编制依据。")
    const noPlaceholder = "3  电子病历基本数据集  国家卫健委现行有效版本  行业标准；"
    expect(normalizeBasisPlaceholders(noPlaceholder)).toBe(noPlaceholder)
  })
})

describe("basisStyleRule 规则句补全（防未来生成复发）", () => {
  it("table / group 样式携带「无编号填 ／、禁写【待填写】」约定", () => {
    for (const s of ["table", "group"] as const) {
      const rule = basisStyleRule(s)
      expect(rule).toContain("／")
      expect(rule).toContain("禁止写「【待填写】」")
    }
  })

  it("numbered 样式携带「不凑编号、禁写【待填写】」约定", () => {
    const rule = basisStyleRule("numbered")
    expect(rule).toContain("不得为其凑编号")
    expect(rule).toContain("禁止写「【待填写】」")
  })
})
