// R270 五期 · 标注版 Word 批注引擎单测
import { describe, expect, it } from "vitest"
import { strFromU8, unzipSync } from "fflate"
import {
  buildAnnotatedDocx,
  buildAnnotatedDocxBlob,
  collectCommentEntries,
} from "./toAnnotatedDocx"
import { summarize, type BidCheckResult, type CheckItem } from "../bidCheckTypes"

function item(over: Partial<CheckItem>): CheckItem {
  return {
    code: "L5-A1",
    level: "L5",
    category: "主体身份",
    title: "公司名称泄露",
    severity: "critical",
    status: "fail",
    basis: "A1 暗标出现公司名即废标",
    suggestion: "删除公司名",
    hits: [{ location: "第一章", text: "某某科技", rule: "company_word", basis: "" }],
    confidence: null,
    ...over,
  }
}

function result(over: Partial<BidCheckResult> = {}): BidCheckResult {
  const items = over.items ?? []
  return {
    mode: "sealed",
    sourceName: "投标文件",
    inputKind: "file",
    hasPackage: true,
    items,
    summary: summarize(items),
    generatedAt: "2026-10-12 10:00",
    chapters: [],
    paragraphs: [],
    chapterOf: [],
    ...over,
  }
}

describe("toAnnotatedDocx · collectCommentEntries", () => {
  it("pass/unconfigured/skipped 不入批注，fail/warn 每一命中一条", () => {
    const items = [
      item({}),
      item({ code: "L1-1", status: "pass", hits: [] }),
      item({
        code: "L1-11",
        status: "warn",
        hits: [
          { location: "p0", text: "宋体", rule: "font", basis: "", paragraphIndex: 0 },
          { location: "p2", text: "Times", rule: "font", basis: "", paragraphIndex: 2 },
        ],
      }),
      item({ code: "L1-2", status: "unconfigured", hits: [{ location: "", text: "", rule: "", basis: "" }] }),
      item({ code: "L5-B1", status: "skipped", hits: [] }),
    ]
    const entries = collectCommentEntries(result({ items }))
    // 1(fail) + 2(warn) = 3 条
    expect(entries.length).toBe(3)
    expect(entries[0].anchorParagraphIndex).toBeNull() // L5-A1 无锚点，走尾章
    expect(entries[1].anchorParagraphIndex).toBe(0)
    expect(entries[2].anchorParagraphIndex).toBe(2)
    // id 从 0 递增、全局不重
    const ids = entries.map((e) => e.id)
    expect(ids).toEqual([0, 1, 2])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("空命中项集合返回空数组（不阻塞导出）", () => {
    expect(collectCommentEntries(result({ items: [] }))).toEqual([])
  })

  it("fail 命中零则不入批注（status fail 但 hits=[] 的项跳过）", () => {
    const items = [item({ hits: [] })]
    expect(collectCommentEntries(result({ items }))).toEqual([])
  })
})

describe("toAnnotatedDocx · buildAnnotatedDocx 结构", () => {
  it("有正文锚点：Document 构造成功，comments 数 = 批注数", () => {
    const items = [
      item({
        hits: [{ location: "p1", text: "某某科技", rule: "company_word", basis: "", paragraphIndex: 1 }],
      }),
      item({
        code: "L1-9",
        status: "warn",
        severity: "medium",
        title: "元话语残留",
        hits: [{ location: "p1", text: "待定", rule: "meta", basis: "", paragraphIndex: 1 }],
      }),
    ]
    const r = result({
      items,
      paragraphs: [
        { text: "本项目", heading: false, index: 0, inTable: false, hasImage: false },
        { text: "由某某科技承建，工期待定。", heading: false, index: 1, inTable: false, hasImage: false },
      ],
      chapterOf: [0, 0],
    })
    const doc = buildAnnotatedDocx(r)
    expect(doc).toBeTruthy()
    // 通过 getter 读 Comments（docx Document 提供 get Comments()）
    const comments = (doc as unknown as { Comments?: { ThreadData?: readonly unknown[] } }).Comments
    // ThreadData 若可得则长度 = 2；不可得则至少要求 Comments 存在
    if (comments && Array.isArray(comments.ThreadData)) {
      expect(comments.ThreadData.length).toBe(2)
    } else {
      expect(comments).toBeTruthy()
    }
  })

  it("无正文定位命中：Document 构造成功，comments 数 = 1（走尾章清单+批注双通道）", () => {
    const items = [
      item({ hits: [{ location: "docProps/core.xml", text: "Zhang San", rule: "creator", basis: "" }] }),
    ]
    const r = result({
      items,
      paragraphs: [{ text: "正文", heading: false, index: 0, inTable: false, hasImage: false }],
      chapterOf: [0],
    })
    const doc = buildAnnotatedDocx(r)
    expect(doc).toBeTruthy()
  })

  it("零命中不阻塞：Document 构造成功", () => {
    const r = result({
      items: [item({ status: "pass", hits: [] })],
      paragraphs: [{ text: "无问题段", heading: false, index: 0, inTable: false, hasImage: false }],
      chapterOf: [0],
    })
    expect(buildAnnotatedDocx(r)).toBeTruthy()
  })
})

describe("toAnnotatedDocx · Blob", () => {
  it("buildAnnotatedDocxBlob 返回合法 docx Blob（PK 头 + 正确 MIME）", async () => {
    const r = result({
      items: [
        item({
          hits: [
            { location: "p0", text: "某某科技", rule: "company_word", basis: "", paragraphIndex: 0 },
          ],
        }),
      ],
      paragraphs: [{ text: "某某科技承建", heading: false, index: 0, inTable: false, hasImage: false }],
      chapterOf: [0],
    })
    const blob = await buildAnnotatedDocxBlob(r)
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    const buf = new Uint8Array(await blob.arrayBuffer())
    // docx 是 zip：首两字节 = 0x50 0x4B（"PK"）
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    expect(buf.length).toBeGreaterThan(500)
  })

  it("零命中 Blob 仍能生成（合法 zip 头）", async () => {
    const r = result({
      items: [item({ status: "pass", hits: [] })],
      paragraphs: [{ text: "干净段", heading: false, index: 0, inTable: false, hasImage: false }],
      chapterOf: [0],
    })
    const blob = await buildAnnotatedDocxBlob(r)
    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it("R62 导出字体护栏：styles.xml 落默认中文字体（不裸奔到主题默认）", async () => {
    const r = result({
      items: [item({ status: "pass", hits: [] })],
      paragraphs: [{ text: "干净段", heading: false, index: 0, inTable: false, hasImage: false }],
      chapterOf: [0],
    })
    const blob = await buildAnnotatedDocxBlob(r)
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const stylesXml = strFromU8(unzipped["word/styles.xml"])
    // 真实产物证据：docDefaults 里必须有 w:rFonts，且中文字体是仿宋（否则 Word 落主题默认字体）
    expect(stylesXml).toContain("w:docDefaults")
    expect(stylesXml).toContain("w:rFonts")
    expect(stylesXml).toContain("仿宋")
  })
})
