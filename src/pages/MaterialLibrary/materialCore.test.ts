import { describe, expect, it } from "vitest"
import {
  parseNameFromFileName,
  parseTagsFromFileName,
  guessOrientation,
  dataUrlBytes,
  dataUrlToBytes,
  sha256HexFromDataUrl,
  extractQueryTokens,
  matchMaterials,
  formatBytes,
} from "./materialCore"
import type { MaterialItem } from "./materialTypes"

// 1x1 红色像素 PNG 的 dataURL
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function item(partial: Partial<MaterialItem>): MaterialItem {
  return {
    id: "m1",
    name: "",
    category: "03_现场照片",
    tags: [],
    source: "manual",
    sourceUrl: "",
    license: "",
    licenseChecked: true,
    width: 0,
    height: 0,
    bytes: 0,
    sha256: "",
    orientation: "landscape",
    photographer: "",
    usage: 0,
    note: "",
    created: "2026-10-08T00:00:00Z",
    ...partial,
  }
}

describe("parseNameFromFileName · 命名规范 来源_内容_日期", () => {
  it("去掉扩展名与尾部 8 位日期", () => {
    expect(parseNameFromFileName("pexels_医院走廊_20261008.jpg")).toBe("pexels 医院走廊")
  })
  it("无日期时整体保留", () => {
    expect(parseNameFromFileName("HIS架构图.png")).toBe("HIS架构图")
  })
  it("空名兜底", () => {
    expect(parseNameFromFileName(".png")).toBe("未命名素材")
  })
})

describe("parseTagsFromFileName · 文件名标签", () => {
  it("丢日期与单字符，保内容词", () => {
    expect(parseTagsFromFileName("pexels_医院走廊_20261008.jpg")).toEqual(["pexels", "医院走廊"])
  })
  it("最多 6 个", () => {
    expect(parseTagsFromFileName("a_bb_cc_dd_ee_ff_gg_hh.jpg").length).toBe(6)
  })
})

describe("guessOrientation / formatBytes", () => {
  it("横竖方三档", () => {
    expect(guessOrientation(1920, 1080)).toBe("landscape")
    expect(guessOrientation(1080, 1920)).toBe("portrait")
    expect(guessOrientation(1000, 1000)).toBe("square")
    expect(guessOrientation(0, 0)).toBe("landscape")
  })
  it("字节数可读化", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB")
  })
})

describe("dataUrlBytes / dataUrlToBytes / sha256", () => {
  it("1px PNG 字节数与解码一致", () => {
    const bytes = dataUrlToBytes(PNG_1PX)
    expect(bytes.length).toBeGreaterThan(0)
    expect(dataUrlBytes(PNG_1PX)).toBe(bytes.length)
  })
  it("sha256 稳定且 64 位 hex", async () => {
    const h1 = await sha256HexFromDataUrl(PNG_1PX)
    const h2 = await sha256HexFromDataUrl(PNG_1PX)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("extractQueryTokens · 检索词抽取", () => {
  it("中文二元组 + 拉丁词", () => {
    const tokens = extractQueryTokens("医院走廊", "HIS 门诊", "")
    expect(tokens).toContain("医院")
    expect(tokens).toContain("走廊")
    expect(tokens).toContain("his")
    expect(tokens).toContain("门诊")
  })
})

describe("matchMaterials · 本地命中打分", () => {
  const library = [
    item({ id: "a", name: "医院走廊 实景", tags: ["医院", "走廊", "明亮"], category: "03_现场照片" }),
    item({ id: "b", name: "HIS 系统架构图", tags: ["HIS", "架构图"], category: "01_架构图" }),
    item({ id: "c", name: "机房 UPS", tags: ["机房", "设备"], category: "03_现场照片" }),
  ]
  it("imageHint 直中 name+tags 的排最前", () => {
    const picks = matchMaterials("医院走廊", "封面", "", library)
    expect(picks[0]?.item.id).toBe("a")
    expect(picks[0]!.score).toBeGreaterThanOrEqual(3)
  })
  it("标题词也能命中架构图", () => {
    const picks = matchMaterials("", "HIS 系统总体架构", "", library)
    expect(picks[0]?.item.id).toBe("b")
  })
  it("无关词不硬凑", () => {
    expect(matchMaterials("数据中心机房", "监控大屏", "", library).map((p) => p.item.id)).toContain("c")
  })
  it("空检索词返回空", () => {
    expect(matchMaterials("", "", "", library)).toEqual([])
  })
  it("trashed 不参与命中", () => {
    const lib = [item({ id: "x", name: "医院走廊", trashed: true })]
    expect(matchMaterials("医院走廊", "", "", lib)).toEqual([])
  })
})
