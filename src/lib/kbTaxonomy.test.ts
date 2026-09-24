import { describe, expect, it } from "vitest"
import {
  KB_TRACKS,
  KB_BUCKETS,
  deriveTrack,
  deriveBucket,
  deriveTaxonomy,
  isKbTrack,
  isKbBucket,
} from "./kbTaxonomy"

// ---------------------------------------------------------------------------
// 知识库「赛道 × 用途桶」分类法：组装层第一期的唯一真相源
// 锁死点：deriveTrack 打分选最佳 / 通用兜底；deriveBucket 竞品目录硬规则优先
// ---------------------------------------------------------------------------

describe("kbTaxonomy 词表", () => {
  it("赛道 13 档、用途桶 9 档", () => {
    expect(KB_TRACKS).toHaveLength(13)
    expect(KB_BUCKETS).toHaveLength(9)
    expect(KB_TRACKS).toContain("电子病历评级")
    expect(KB_TRACKS).toContain("互联互通评级")
    expect(KB_BUCKETS).toContain("标书弹药")
    expect(KB_BUCKETS).toContain("竞品情报")
  })
})

describe("deriveTrack", () => {
  it("电子病历评级：命中评级/过级/分级语境", () => {
    expect(deriveTrack("电子病历五级评级升级项目")).toBe("电子病历评级")
  })
  it("互联互通评级：标准化成熟度测评", () => {
    expect(deriveTrack("医院信息互联互通标准化成熟度测评")).toBe("互联互通评级")
  })
  it("DRG-DIP医保：多关键词累加命中", () => {
    expect(deriveTrack("DRG付费与DIP病种分值管理")).toBe("DRG-DIP医保")
  })
  it("数据安全：等级保护 / 网络安全", () => {
    expect(deriveTrack("医院网络安全等级保护方案")).toBe("数据安全")
  })
  it("信创改造 / 智慧医院", () => {
    expect(deriveTrack("国产化麒麟统信适配改造")).toBe("信创改造")
    expect(deriveTrack("智慧医院智慧管理智慧服务")).toBe("智慧医院")
  })
  it("无命中回退通用", () => {
    expect(deriveTrack("今天会议记录了办公用品采购")).toBe("通用")
    expect(deriveTrack("")).toBe("通用")
  })
  it("多档命中取命中数最多者（智慧医院 3 命中压过单命中赛道）", () => {
    expect(deriveTrack("智慧医院智慧管理智慧服务，附带一些电子病历系统")).toBe("智慧医院")
  })
})

describe("deriveBucket", () => {
  it("竞品目录硬规则优先：友商公司产品即便文件名含「响应/应答」也归竞品情报", () => {
    expect(deriveBucket("售前知识库/友商公司产品/卫宁应急响应方案.docx")).toBe("竞品情报")
    expect(deriveBucket("08-公司标准库/攻防话术/对比东软.docx")).toBe("竞品情报")
  })
  it("普通标书目录归标书弹药", () => {
    expect(deriveBucket("售前知识库/标书弹药/某医院投标技术偏离表.docx")).toBe("标书弹药")
  })
  it("演示文稿归 PPT演示", () => {
    expect(deriveBucket("售前知识库/述标演示文稿.pptx")).toBe("PPT演示")
  })
  it("客户相关路径归客户与项目", () => {
    expect(deriveBucket("售前知识库/客户画像/安徽省客户情况.md")).toBe("客户与项目")
  })
  it("无法归类回退其他", () => {
    expect(deriveBucket("随手笔记/xyz.txt")).toBe("其他")
  })
})

describe("deriveTaxonomy", () => {
  it("赛道取自 trackText、桶取自 pathName，各自独立", () => {
    expect(
      deriveTaxonomy({
        trackText: "电子病历五级评级改造",
        pathName: "售前知识库/友商公司产品/某应答.docx",
      }),
    ).toEqual({ track: "电子病历评级", bucket: "竞品情报" })
  })
})

describe("isKbTrack / isKbBucket", () => {
  it("合法枚举为 true，兜底值/非法值为 false", () => {
    expect(isKbTrack("智慧医院")).toBe(true)
    expect(isKbTrack("通用")).toBe(false) // 通用是兜底，不在 KB_TRACKS 内
    expect(isKbTrack(undefined)).toBe(false)
    expect(isKbBucket("标书弹药")).toBe(true)
    expect(isKbBucket("其他")).toBe(false) // 其他是兜底，不在 KB_BUCKETS 内
  })
})
