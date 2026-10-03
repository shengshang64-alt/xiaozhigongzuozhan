import { describe, expect, it } from "vitest"
import { extractRequirementStructureFromText, reqStructureSectionFrom } from "./bidTypes"

// Q26/切片B：采购需求结构本地扫描单测（依据 13131 真实「定制软件开发清单」表形态）
const SOFT_LIST_TABLE = [
  "第三章 采购需求",
  "序号 | 大类 | 建设内容",
  "1 | 智慧互联 | 医院集成平台",
  "2 | 临床数据中心",
  "3 | 运营数据中心",
  "4 | 主数据管理",
  "5 | 患者主索引管理",
  "6 | 运维监控管理",
  "7 | 统一门户系统",
  "8 | 智慧医疗 | HIS 系统",
  "9 | EMR 系统",
  "10 | 临床护理系统",
  "11 | 移动护理系统",
  "12 | 临床辅助决策支持系统 | √",
  "13 | 移动查房系统",
  "14 | LIS 检验管理系统",
  "15 | PACS 影像管理系统",
  "16 | 手术麻醉管理系统",
  "17 | 重症监护管理系统 | √",
  "18 | 输血管理系统",
  "19 | 心电信息系统",
  "20 | 血液透析系统",
  "21 | 康复治疗系统 | √",
  "22 | 体检信息系统",
  "23 | 消毒供应管理系统",
  "24 | 智慧药学系统",
  "25 | 智慧管理 | 临床路径管理系统",
  "26 | 不良事件管理系统 | √",
  "27 | 传染病报卡管理系统",
  "28 | 医院感染综合监控系统",
  "29 | 临床危急值管理系统",
  "30 | 医务管理系统",
  "31 | 护理管理系统 | √",
  "33 | 单病种管理系统",
  "34 | 病案管理系统",
  "35 | 病案翻拍系统",
  "36 | 闭环管理系统",
  "37 | HRP 管理系统 | √",
  "38 | 营养膳食管理系统 | √",
  "40 | 医疗系统智慧化科教平台 | √",
  "41 | 智慧服务 | 统一检查预约系统",
  "42 | 排队叫号系统",
  "43 | 自助机服务系统",
  "44 | 智慧病房系统 | √",
  "45 | 个性化需求 | 中医专科诊疗系统",
  "46 | 妇幼专科诊疗系统",
  "47 | 特殊人群关爱服务平台",
  "48 | 互联网护理服务系统 | √",
  "49 | 市中医院与曙光总院系统互联互通相关系统",
].join("\n")

const DETAIL_REGION = [
  "服务技术参数要求",
  "医院集成平台",
  "具体功能详细描述如下：",
  "（一）医院服务总线",
  "提供准实时的业务交互，实现各业务系统与平台的集成对接。",
  "（二）集成资源管理",
  "支持业务分类新增、修改、删除，支持平台资源统计展示。",
  "（三）集成配置管理",
  "系统集成管理支持开启系统接入平台权限验证。",
  "HIS 系统",
  "（一）物价管理",
  "（二）门急诊挂号",
  "（三）门急诊收费",
  "（四）住院登记",
].join("\n")

// 正文噪声 + 硬件表行（小数序号 + 非系统后缀），不应进入结构清单
const NOISE = [
  "2.1 | 15.6 寸床旁交互屏 | 300 | 台",
  "2.2 | 床旁伸缩支臂 | 300 | 个",
  "系统可以编制带量食谱、采购清单。自动生成营养分析报告。",
  "1、按照服务性质将科室划分为临床服务类、医疗技术类、医疗辅助类、行政后勤类。",
].join("\n")

describe("extractRequirementStructureFromText · 采购需求结构本地扫描（Q26 切片B）", () => {
  const out = extractRequirementStructureFromText(
    [SOFT_LIST_TABLE, DETAIL_REGION, NOISE, SOFT_LIST_TABLE].join("\n\n"),
  )

  it("列出 ≥40 个子系统（真实清单表规模）", () => {
    expect(out.length).toBeGreaterThanOrEqual(40)
  })

  it("无重复：同名系统跨表块去重", () => {
    // 清单表被拼了两遍：若去重失效，同一系统会多行。以行内含系统名的唯一性校验。
    expect(out.filter((l) => l.includes("医院集成平台")).length).toBe(1)
    expect(out.filter((l) => l.includes("HIS 系统")).length).toBe(1)
    expect(out.filter((l) => l.includes("EMR 系统")).length).toBe(1)
    // 无整行重复
    expect(new Set(out).size).toBe(out.length)
  })

  it("无正文噪声行：硬件小数序号/散文句不入清单", () => {
    const joined = out.join("\n")
    expect(joined).not.toContain("床旁交互屏")
    expect(joined).not.toContain("带量食谱")
    expect(joined).not.toContain("临床服务类")
  })

  it("大类归属正确继承（智慧医疗下的 HIS）", () => {
    const his = out.find((l) => l.includes("HIS 系统"))
    expect(his).toContain("智慧医疗")
  })

  it("统计详情区（一）（二）功能模块数", () => {
    const bus = out.find((l) => l.includes("医院集成平台"))
    expect(bus).toContain("3 项功能模块")
    const his = out.find((l) => l.includes("HIS 系统"))
    expect(his).toContain("4 项功能模块")
  })

  it("空文本返回空数组", () => {
    expect(extractRequirementStructureFromText("")).toEqual([])
    expect(extractRequirementStructureFromText("本项目不含子系统清单表。")).toEqual([])
  })
})

describe("reqStructureSectionFrom · 分区组装（Q26 切片B）", () => {
  it("有系统时产出 req_structure 分区，无系统返回 null", () => {
    const sec = reqStructureSectionFrom(["智慧互联 · 医院集成平台 · 3 项功能模块", "智慧医疗 · HIS 系统"])
    expect(sec?.key).toBe("req_structure")
    expect(sec?.title).toBe("采购需求结构")
    expect(sec?.snippet).toContain("共 2 个系统")
    expect(reqStructureSectionFrom([])).toBeNull()
  })
})
