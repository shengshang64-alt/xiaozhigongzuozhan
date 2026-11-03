// 解析报告「内容混乱、没重点」的回归测试（2026-10-27 用户截图反馈）
//
// 用户原话：「我截图这些是解析的内容，看的让人头皮发麻！！内容混乱，没有重点，
// 解析的重点是突出重点信息，关键项，这些内容是干嘛的？为啥要体现出来」
//
// 逐张截图定位出 4 个真实缺陷，本文件逐条锁死：
//   ① 截图5「原文总分：0.5」——真实总分 100。成因：逐条计分行「每增加 1 名…得 0.5 分」
//      被当成全表总分（RE_PERUNIT 遇到中间的数字就断，判不出逐条计量）。
//   ② 截图5「报告漏抽 31 / 66 项」与「委进行评议并评分 9.6 分」——本地扫描把正文里
//      「每次扣 1 分」的扣分条款断片当成了评分项；三明实测 29 条里 28 条是残片。
//   ③ 截图3「同一条差异歧视卡重复 4 次」——去重 key 用 excerpt 前 40 字，
//      而重复行差异恰好落在 40 字之后（或只是一个空格 / 上标）。
//   ④ 截图3/截图5「合规风险红7黄56 = 63 条」——「包括但不限于」命中 44 次，
//      全是技术参数表里的功能点描述，摊成 44 张黄卡淹掉真风险。
//   ⑤ 截图2「隐式硬约束 40 条」——混入 RAID/SSL/芯片/内存等产品规格，不是投标形式约束。
import { describe, expect, it } from "vitest"
import { scanScoreItems } from "./scoreItemsScan"
import { riskFingerprint, scanTenderComplianceRisk } from "./tenderComplianceRisk"
import { extractImplicitConstraints, groupImplicitConstraints } from "./bidTypes"

describe("① 原文总分不再被逐条计分行冒充", () => {
  it("「每增加 1 名…得 0.5 分，满分 1 分」不充当总分（真实三明 L2538）", () => {
    // 原实现 RE_PERUNIT 的 [^0-9]{0,6} 遇到「1 名」里的数字即断，判不出逐条计量，
    // 该行落进总分分支，把 0.5 记成「原文总分」（真实 100 分制）。
    const text = [
      "项目验收后两年维保期现场运维人员不少于 6 名，在此",
      "基础上每增加 1 名驻点运维人员得 0.5 分，满分 1 分。",
    ].join("\n")
    expect(scanScoreItems(text).total.value).toBeNull()
  })

  it("公式式总分声明「=100 分（满分时）」能被认出（真实三明 L2356）", () => {
    // 该行不含「合计/总分」字样，原判据完全认不出，导致总分恒为 null 或错值。
    const text = "因素所占的权重， A1+A2+A3=1 、 F1×A1 ＋ F2×A2 ＋ F3×A3=100 分（满分时） 。"
    expect(scanScoreItems(text).total.value).toBe(100)
  })

  it("逐条上限「满分15分」「得满分10分」仍不被当总分（回归护栏）", () => {
    expect(scanScoreItems("每个5分，满分15分").total.value).toBeNull()
    expect(scanScoreItems("技术条款响应，得满分10分").total.value).toBeNull()
  })
})

describe("② 扣分条款断片不再被当成评分项", () => {
  it("「时扣 1 分；」这类残片不入项（真实三明实测 RAW）", () => {
    const text = "巡检结果每次扣 1 分。\n维护人员未按时到场，每超时 10 分钟扣 1 分；"
    const r = scanScoreItems(text)
    for (const it of r.items) {
      expect(it.name).not.toMatch(/^(时扣|扣|每次|到场|超)$/)
    }
  })

  it("含「扣N分」的行整行不入评分项", () => {
    const text = "因处置不及时造成影响导致投诉的，每次扣 2 分。"
    expect(scanScoreItems(text).items).toHaveLength(0)
  })

  it("真评分项仍正常抽取（回归护栏）", () => {
    // 注意：不能写成「技术评分要求：总体技术方案（10 分）…」——
    // 「技术评分要求」会被类目标题规则命中，整行按类目头跳过（这是既有且正确的行为，用于归类下文）。
    // 这里用不带类目前缀的真实形态验证项名抽取本身没被残片过滤器误伤。
    const text = "总体技术方案（10 分）：方案完整可行得满分。"
    const r = scanScoreItems(text)
    expect(r.items.length).toBeGreaterThan(0)
    expect(r.items[0].name).toBe("总体技术方案")
    expect(r.items[0].score).toBe(10)
  })

  it("「同类项目业绩：每个5分，满分15分」项名在冒号前，不被切掉（回归护栏）", () => {
    const r = scanScoreItems("同类项目业绩：每个5分，满分15分")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("同类项目业绩")
    expect(r.items[0].score).toBe(15)
  })
})

describe("③ 合规风险去重不再被「第 40 字之后才不同」的重复行绕过", () => {
  it("同一份声明重复出现（仅空格/上标差异）只保留一条", () => {
    const a = "⼊为 | 万元，资产总额为 | 万元 ¹ ，属于（中型企业、⼩型企业、微型企业）；"
    const b = "⼊为 | 万元，资产总额为 | 万元，属于（中型企业、⼩型企业、微型企业）；"
    const c = "⼊为 | 万元，资产总额为 | 万元 ，属于（中型企业、⼩型企业、微型企业）；"
    expect(riskFingerprint("DIS-scale", a)).toBe(riskFingerprint("DIS-scale", b))
    expect(riskFingerprint("DIS-scale", b)).toBe(riskFingerprint("DIS-scale", c))
  })

  it("实质不同的条款（收入 vs 营业收入）不会被误合并", () => {
    const a = "⼊为 | 万元，资产总额为 | 万元 ¹ ，属于（中型企业、⼩型企业、微型企业）；"
    const b = "业收⼊为 | 万元，资产总额为 | 万元 ，属于（中型企业、⼩型企业、微型企业）；"
    expect(riskFingerprint("DIS-scale", a)).not.toBe(riskFingerprint("DIS-scale", b))
  })
})

describe("④「包括但不限于」不再在技术参数表里刷出几十条黄卡", () => {
  it("功能点描述里的「包括但不限于」不算范围蔓延风险", () => {
    const text = "对包括但不限于Oracle、MySQL、SQL Server、Sqlmate 等数据库的访问行为进行审计。"
    const hits = scanTenderComplianceRisk(text).filter((f) => f.ruleId === "RL-scope")
    expect(hits).toHaveLength(0)
  })

  it("履约语境下的「服务范围包括但不限于」仍能命中（回归护栏）", () => {
    const text = "本项目服务范围包括但不限于系统集成、接口改造与三年运维。"
    const hits = scanTenderComplianceRisk(text).filter((f) => f.ruleId === "RL-scope")
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe("⑤ 隐式硬约束剔除产品规格、保留投标形式要求", () => {
  it("RAID / SSL / 芯片 / 内存 等规格句不进隐式硬约束", () => {
    const text = [
      "配置RAID卡(带≥4GB缓存，含超级电容)，至少支持RAID0/1/5/6模式；",
      "SSL每秒新建连接数不小于10000个/秒，SSL加解密吞吐率不低于3Gbps；",
      "至少在一种国产芯片+一种国产操作系统组合下通过TPC-C测试。",
    ].join("\n")
    expect(extractImplicitConstraints(text)).toHaveLength(0)
  })

  it("投标形式约束即便含技术词也保留（「份数…副本」实测踩坑）", () => {
    const text = "投标文件份数不得少于正本一份副本四份。"
    expect(extractImplicitConstraints(text)).toHaveLength(1)
  })

  it("带明确废标后果的句子一律保留", () => {
    const text = "配置清单未完全满足要求的，视为未实质性响应招标文件要求，作废标处理。"
    expect(extractImplicitConstraints(text)).toHaveLength(1)
  })

  it("按「废标 / 格式 / 其他」分组，废标项排在最前", () => {
    const items = [
      "商务符合性审查不合格，作无效投标处理。",
      "投标文件的份数：详见第二章。",
      "投标保证金不得超过采购项目预算金额的2%。",
    ]
    const g = groupImplicitConstraints(items)
    expect(g.void).toHaveLength(1)
    expect(g.format).toHaveLength(1)
    expect(g.other).toHaveLength(1)
    expect(g.void[0]).toContain("无效投标")
  })
})
