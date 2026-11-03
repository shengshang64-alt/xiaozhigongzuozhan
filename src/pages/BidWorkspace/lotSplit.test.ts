import { describe, expect, it } from "vitest"
import { extractLotsFromText, lotNumberCnToInt, lotsSectionFrom } from "./bidTypes"

// R74/C-lot-splitting：标包本地扫描单测（真实政采公告常见形态）
describe("extractLotsFromText · 标包划分本地扫描（R74）", () => {
  it("「第1包/第2包」形态：逐包成条，预算就近归属", () => {
    const text = [
      "项目划分如下：",
      "第1包：一体化核心业务系统",
      "预算金额 1500 万元",
      "包含 HIS、EMR、LIS 等子系统建设",
      "第2包：检验设备采购",
      "预算金额 300 万元",
    ].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(2)
    expect(lots[0]).toContain("第1包")
    expect(lots[0]).toContain("预算/限价 1500万元")
    expect(lots[0]).toContain("HIS、EMR")
    expect(lots[1]).toContain("第2包")
    expect(lots[1]).toContain("预算/限价 300万元")
  })

  it("「标段一/标段2」形态可识别", () => {
    const text = ["标段一：数据中心建设", "最高限价 800 万元", "标段2：网络安全改造"].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots.length).toBe(2)
  })

  it("未划分标包的文本返回空数组", () => {
    expect(extractLotsFromText("本项目不划分标包，投标人应对全部内容投标。")).toEqual([])
    expect(extractLotsFromText("")).toEqual([])
  })
})

describe("lotNumberCnToInt · 编号归一（R74）", () => {
  it("数字与常见汉字编号", () => {
    expect(lotNumberCnToInt("3")).toBe(3)
    expect(lotNumberCnToInt("一")).toBe(1)
    expect(lotNumberCnToInt("十")).toBe(10)
    expect(lotNumberCnToInt("二十三")).toBe(23)
  })
})

describe("lotsSectionFrom · 分区组装（R74）", () => {
  it("有标包时产出 lots 分区，无标包返回 null", () => {
    const sec = lotsSectionFrom(["第1包：核心系统", "第2包：设备"])
    expect(sec?.key).toBe("lots")
    expect(sec?.snippet).toContain("共 2 包")
    expect(lotsSectionFrom([])).toBeNull()
  })
})


describe("extractLotsFromText · 真实表格行形态（R78 池州校准）", () => {
  it("「N 标包X 名称 预算」表格行逐包识别，保证金引用行剔除、同号合并不重复", () => {
    const text = [
      "1.2采购内容及标包划分情况：",
      "序号 标包名称 采购内容 预算",
      "1 标包一 一体化智慧医院、住院、电子病历、医技、药房等系统升级改造，三年质保 853.30 1名",
      "2 标包二 急救、三中心、手麻、血透等系统升级改造，三年质保 766.98 1名",
      "3 标包三 货物：银医自助、PDA、移动护理等硬件，三年质保 592.48 1名",
      "1.2.2本项目划分3个标包，每个标包中标人数量均为1名",
      "标包一：人民币50000元；",
      "标包二：人民币40000元；",
    ].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(3)
    expect(lots[0]).toContain("853.30")
    expect(lots[0]).toContain("一体化智慧医院")
    expect(lots.join("|")).not.toContain("50000")
    expect(lots[2]).not.toContain("标包一：")
  })
})

// Q26/切片C：多标包识别形态扩展 + 按包归属（【第N包】）
describe("extractLotsFromText · 多标包识别形态扩展（Q26 切片C）", () => {
  it("「包1/包2」裸形识别，且 ≥2 包统一前缀【第N包】", () => {
    const text = [
      "本项目采购内容如下：",
      "包1 一体化核心业务系统",
      "预算金额 1500 万元",
      "包2 检验设备采购",
      "最高限价 300 万元",
    ].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(2)
    expect(lots[0]).toContain("【第1包】")
    expect(lots[0]).toContain("一体化核心业务系统")
    expect(lots[0]).toContain("预算/限价 1500万元")
    expect(lots[1]).toContain("【第2包】")
  })

  it("「第1-3包」区间展开为 3 个包块", () => {
    const text = ["第1-3包：信息化系统建设", "预算金额 900 万元"].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(3)
    expect(lots.map((l) => l.slice(0, 5))).toEqual(["【第1包】", "【第2包】", "【第3包】"])
  })

  it("仅计数声明「本项目划分为 N 个标包」时落一条计数提示", () => {
    const text = ["第二章 投标人须知", "1.1.5 标包划分：本项目划分为 4 个标包", "采购需求见第三章。"].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(1)
    expect(lots[0]).toContain("4 个标包")
  })

  it("「☑不划分标包」语境零误报：返回空", () => {
    const text = [
      "1.1.5 | 标包划分 | ☑不划分标包",
      "1.1.6 | 项目预算 | 82144000.00 元",
      "5.2 | 评标委员会的组建 | 评标委员会构成：7 人或以上单数",
    ].join("\n")
    expect(extractLotsFromText(text)).toEqual([])
  })

  it("竖线标包表格表头「标包号|标包名称|预算」逐行成包", () => {
    const text = [
      "标包号 | 标包名称 | 预算",
      "1 | HIS 系统升级 | 500 万元",
      "2 | LIS 检验系统 | 300 万元",
    ].join("\n")
    const lots = extractLotsFromText(text)
    expect(lots).toHaveLength(2)
    expect(lots[0]).toContain("【第1包】")
    expect(lots[0]).toContain("HIS 系统升级")
    expect(lots[1]).toContain("【第2包】")
  })
})
