import { describe, expect, it } from "vitest"
import { extractTenderMeta, tenderMetaHits } from "./tenderMeta"

// 抽取口径见 tenderMeta.ts 头部注释。样本按真实招标公告的常见排版构造：
// 标签行/值行分行、全角冒号、一行塞多字段、只有标题没有标签，各覆盖一条。
describe("extractTenderMeta", () => {
  it("抽取标准招标公告的四要素（同行为值）", () => {
    const text = [
      "XX市第一人民医院智慧医院信息化建设项目",
      "公开招标公告",
      "一、项目基本情况",
      "项目编号：HXZB2026-0912",
      "项目名称：XX市第一人民医院智慧医院信息化建设项目",
      "预算金额：1200万元",
      "采购人：XX市第一人民医院",
      "四、提交投标文件截止时间、开标时间和地点",
      "开标时间：2026年9月12日9时30分（北京时间）",
    ].join("\n")

    const meta = extractTenderMeta(text)
    expect(meta.projectName).toBe("XX市第一人民医院智慧医院信息化建设项目")
    expect(meta.tenderNo).toBe("HXZB2026-0912")
    expect(meta.hospital).toBe("XX市第一人民医院")
    expect(meta.bidOpenDate).toBe("2026-09-12")
  })

  it("标签与值分行（表格转文本）+ 全角冒号 + 全角空格也能取到", () => {
    const text = [
      "招标公告",
      "项目名称：",
      "XX县中医院医疗设备采购项目",
      "招标编号：",
      "ZYY-2026-0007",
      "采购人名称： XX县中医院（以下简称采购人）",
      "投标截止时间： 2026-09-30 09:30",
    ].join("\n")

    const meta = extractTenderMeta(text)
    expect(meta.projectName).toBe("XX县中医院医疗设备采购项目")
    expect(meta.tenderNo).toBe("ZYY-2026-0007")
    expect(meta.hospital).toBe("XX县中医院")
    expect(meta.bidOpenDate).toBe("2026-09-30")
  })

  it("没有标签时用标题行 + 正文医院名兜底", () => {
    const text = [
      "YY市妇幼保健院智慧病房建设项目招标文件",
      "第一章 招标公告",
      "本项目为YY市妇幼保健院智慧病房建设，预算 800 万元。",
      "投标人应于 2026年10月8日 前提交投标文件。",
    ].join("\n")

    const meta = extractTenderMeta(text)
    expect(meta.projectName).toBe("YY市妇幼保健院智慧病房建设项目")
    expect(meta.hospital).toBe("YY市妇幼保健院")
    expect(meta.bidOpenDate).toBe("2026-10-08")
    expect(meta.tenderNo).toBe("")
  })

  it("一行塞多个字段时按下一个标签截断", () => {
    const text = "项目名称: ZZ市人民医院检验设备采购  招标编号: JY-2026-11  采购人: ZZ市人民医院"

    const meta = extractTenderMeta(text)
    expect(meta.projectName).toBe("ZZ市人民医院检验设备采购")
    expect(meta.tenderNo).toBe("JY-2026-11")
    expect(meta.hospital).toBe("ZZ市人民医院")
  })

  it("日期格式与合法性：斜杠日期可识别，不存在的日期不猜", () => {
    expect(extractTenderMeta("开标时间：2026/9/12 09:30").bidOpenDate).toBe("2026-09-12")
    expect(extractTenderMeta("开标时间：2026-09-12").bidOpenDate).toBe("2026-09-12")
    expect(extractTenderMeta("开标时间：2026年2月30日").bidOpenDate).toBe("")
    expect(extractTenderMeta("开标时间：另行通知").bidOpenDate).toBe("")
  })

  it("编号像样的才留，占位符不落字段", () => {
    expect(extractTenderMeta("招标编号：详见招标文件").tenderNo).toBe("")
    expect(extractTenderMeta("招标编号：/").tenderNo).toBe("")
    expect(extractTenderMeta("招标编号：ZB-2026-0912-01").tenderNo).toBe("ZB-2026-0912-01")
    // 真实脱敏样张里的占位编号（实测踩过：会取到「XXXX」）
    expect(extractTenderMeta("项目编号：XXXX号。").tenderNo).toBe("")
    expect(extractTenderMeta("招标编号：XXXX").tenderNo).toBe("")
    // 公文里带方括号/「号」的真实写法要认
    expect(extractTenderMeta("项目编号：[350000]SMZC[GK]2026-0912号").tenderNo).toBe("[350000]SMZC[GK]2026-0912号")
  })

  it("采购人不是医院时不硬塞进客户医院", () => {
    const text = ["项目名称：某信息化服务项目", "采购人：某某招标代理有限公司", "开标时间：2026年9月1日"].join("\n")

    const meta = extractTenderMeta(text)
    expect(meta.projectName).toBe("某信息化服务项目")
    expect(meta.hospital).toBe("")
    expect(meta.bidOpenDate).toBe("2026-09-01")
  })

  it("乱码/空文本不产生假命中", () => {
    expect(extractTenderMeta("")).toEqual({ projectName: "", tenderNo: "", hospital: "", bidOpenDate: "" })
    const junk = extractTenderMeta("第 1 页 共 3 页\n\n目录\n一、招标公告 ...... 1")
    expect(junk.projectName).toBe("")
    expect(junk.tenderNo).toBe("")
    expect(junk.hospital).toBe("")
    expect(junk.bidOpenDate).toBe("")
  })

  it("tenderMetaHits 只报非空字段", () => {
    expect(tenderMetaHits({ projectName: "A", tenderNo: "", hospital: "B", bidOpenDate: "" })).toEqual([
      "项目名称",
      "客户医院",
    ])
  })
})
