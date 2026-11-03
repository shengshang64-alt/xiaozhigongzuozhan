import { describe, expect, it } from "vitest"
import {
  appendTenderFile,
  composeTenderText,
  inferTenderFileRole,
  moveTenderFile,
  normalizeTenderFiles,
  parseTextForItem,
  removeTenderFile,
  setTenderFileRole,
  splitTenderText,
  tenderFilesInSync,
} from "./tenderFiles"

const MAIN = "第一章 招标公告\n本项目为三明市中西医结合医院信息化整体提升项目。"
const TECH = "第三章 技术需求\n1. 系统应支持并发 500 用户。\n2. 数据库须支持国产化。"
const SCORING = "评分办法\n技术分 60 分：方案完整性 20 分，响应程度 40 分。"

/** 造一个「正文 + 技术附件 + 评分办法」的三份合并文本 */
function threeFiles() {
  let state = { text: "", files: [] as ReturnType<typeof appendTenderFile>["files"] }
  state = appendTenderFile(state.text, { name: "招标正文.docx", role: "main", text: MAIN })
  state = appendTenderFile(state.text, { name: "技术需求书.docx", role: "tech", text: TECH })
  state = appendTenderFile(state.text, { name: "评分办法.docx", role: "scoring", text: SCORING })
  return state
}

describe("合并 / 拆分", () => {
  it("无标记文本切成单个未跟踪块，拼回与原文字节一致（存量项目零变化）", () => {
    const blocks = splitTenderText(MAIN)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].tracked).toBe(false)
    expect(composeTenderText(blocks)).toBe(MAIN)
  })

  it("三份文件合并后每份都有来源标记，清单与块一一对应", () => {
    const { text, files } = threeFiles()
    expect(files.map((f) => f.name)).toEqual(["招标正文.docx", "技术需求书.docx", "评分办法.docx"])
    expect(files.map((f) => f.role)).toEqual(["main", "tech", "scoring"])
    expect(text).toContain("〖附件2｜技术附件｜技术需求书.docx〗")
    expect(text).toContain("〖附件3｜评分办法｜评分办法.docx〗")
    expect(files.map((f) => f.chars)).toEqual([MAIN.length, TECH.length, SCORING.length])
  })

  it("切→拼→切 幂等（清单变更后反复重建不会漂移）", () => {
    const { text } = threeFiles()
    const once = composeTenderText(splitTenderText(text), { renumber: true })
    const twice = composeTenderText(splitTenderText(once), { renumber: true })
    expect(twice).toBe(once)
  })

  it("同名文件再传一次视为新版本：就地替换，不产生重复块", () => {
    const base = appendTenderFile("", { name: "技术需求书.docx", role: "tech", text: TECH })
    const next = appendTenderFile(base.text, { name: "技术需求书.docx", role: "tech", text: `${TECH}\n3. 新增条款。` })
    expect(next.replaced).toBe(true)
    expect(next.files).toHaveLength(1)
    expect(next.text).toContain("3. 新增条款。")
    expect(next.text.match(/〖附件/g)).toHaveLength(1)
  })

  it("删除中间一份后剩余文件重排序号", () => {
    const { text } = threeFiles()
    const next = removeTenderFile(text, 1)
    expect(next.files.map((f) => f.name)).toEqual(["招标正文.docx", "评分办法.docx"])
    expect(next.text).toContain("〖附件2｜评分办法｜评分办法.docx〗")
    expect(next.text).not.toContain("技术需求书")
  })

  it("上移/下移只换文件块次序，块内正文原样", () => {
    const { text } = threeFiles()
    const next = moveTenderFile(text, 0, 1)
    expect(next.files.map((f) => f.name)).toEqual(["技术需求书.docx", "招标正文.docx", "评分办法.docx"])
    expect(next.text.indexOf("第三章 技术需求")).toBeLessThan(next.text.indexOf("第一章 招标公告"))
    expect(next.text).toContain(TECH)
  })

  it("改角色只改标记行，块内正文一字不动", () => {
    const base = appendTenderFile("", { name: "需求书.docx", role: "tech", text: TECH })
    const next = setTenderFileRole(base.text, 0, "drawing")
    expect(next.files[0].role).toBe("drawing")
    expect(next.text).toContain("〖附件1｜清单/图纸｜需求书.docx〗")
    expect(next.text).toContain(TECH)
  })

  it("粘贴正文（标记之外）永远保留原位，不被排序打乱", () => {
    const pasted = "【手工补充】开标时间：2026-11-02"
    const { text } = threeFiles()
    const mixed = `${pasted}\n\n${text}`
    const moved = moveTenderFile(mixed, 0, 1)
    expect(moved.text.startsWith(pasted)).toBe(true)
  })

  it("块内手工修订在删除另一份文件后仍然保留", () => {
    const { text } = threeFiles()
    const edited = text.replace("并发 500 用户", "并发 800 用户")
    const next = removeTenderFile(edited, 2)
    expect(next.text).toContain("并发 800 用户")
  })

  it("清单与合并文本不一致时 tenderFilesInSync 返回 false（界面提示按文本重建）", () => {
    const { text, files } = threeFiles()
    expect(tenderFilesInSync(text, files)).toBe(true)
    expect(tenderFilesInSync(`${text}\n\n又手工补了一段`, files)).toBe(true) // 标记之外的新增不影响清单口径
    expect(tenderFilesInSync(text.replace("〖附件2｜技术附件｜", "〖附件2｜商务/资格｜"), files)).toBe(false)
  })
})

describe("解析按角色路由", () => {
  it("没有清单（存量项目）时逐字返回原文", () => {
    const { text } = threeFiles()
    expect(parseTextForItem(text, [], "tech_score")).toBe(text)
    expect(parseTextForItem(text, null, "tech_score")).toBe(text)
    expect(parseTextForItem(text, undefined, "delivery_req")).toBe(text)
  })

  it("文件全是招标正文时逐字返回原文（等价改造前的单文件行为）", () => {
    const base = appendTenderFile("", { name: "招标文件.docx", role: "main", text: MAIN })
    expect(parseTextForItem(base.text, base.files, "tech_score")).toBe(base.text)
  })

  it("技术附件只进技术类解析项，不进资格性审查", () => {
    const { text, files } = threeFiles()
    expect(parseTextForItem(text, files, "delivery_req")).toContain("并发 500 用户")
    expect(parseTextForItem(text, files, "purchase_list")).toContain("国产化")
    expect(parseTextForItem(text, files, "qualification")).not.toContain("并发 500 用户")
  })

  it("评分办法只进评分类解析项，不进项目概述", () => {
    const { text, files } = threeFiles()
    expect(parseTextForItem(text, files, "tech_score")).toContain("方案完整性 20 分")
    expect(parseTextForItem(text, files, "biz_score")).toContain("评分办法")
    expect(parseTextForItem(text, files, "overview")).not.toContain("方案完整性 20 分")
  })

  it("招标正文在任何解析项里都不会被路由掉", () => {
    const { text, files } = threeFiles()
    for (const key of ["tech_score", "qualification", "delivery_req", "overview", "void_items"]) {
      expect(parseTextForItem(text, files, key)).toContain("三明市中西医结合医院")
    }
  })

  it("粘贴在标记之外的正文在所有解析项里都会保留", () => {
    const pasted = "【手工补充】开标时间：2026-11-02"
    const { text, files } = threeFiles()
    const mixed = `${pasted}\n\n${text}`
    expect(parseTextForItem(mixed, files, "qualification")).toContain("开标时间")
  })

  it("来源标记被删干净时不做猜测，回退全文", () => {
    const { text, files } = threeFiles()
    const noMarker = text.replace(/〖附件[^\n]*〗\n/g, "")
    expect(parseTextForItem(noMarker, files, "qualification")).toBe(noMarker)
  })

  it("路由后仍保留来源标记，模型能看出条款出自哪份文件", () => {
    const { text, files } = threeFiles()
    const routed = parseTextForItem(text, files, "delivery_req")
    expect(routed).toContain("〖附件2｜技术附件｜技术需求书.docx〗")
    expect(routed).not.toContain("〖附件3｜评分办法｜评分办法.docx〗")
  })

  it("未知解析项（本地产出项）不做路由", () => {
    const { text, files } = threeFiles()
    expect(parseTextForItem(text, files, "star_clauses")).toBe(text)
    expect(parseTextForItem(text, files, "req_structure")).toBe(text)
  })
})

describe("角色推断与脏数据容错", () => {
  it("按文件名推断角色，商务评分先命中评分而不是商务", () => {
    expect(inferTenderFileRole("商务评分办法.docx")).toBe("scoring")
    expect(inferTenderFileRole("附件2：技术需求书.pdf")).toBe("tech")
    expect(inferTenderFileRole("工程量清单.xlsx")).toBe("drawing")
    expect(inferTenderFileRole("合同条款.docx")).toBe("commercial")
    expect(inferTenderFileRole("招标文件正文.docx")).toBe("main")
  })

  it("normalizeTenderFiles 丢弃脏数据并容错角色", () => {
    expect(normalizeTenderFiles(null)).toEqual([])
    expect(normalizeTenderFiles([{ name: "" }, null, "x"])).toEqual([])
    expect(normalizeTenderFiles([{ name: "a.docx", role: "不存在的角色", chars: "12" }])).toEqual([
      { name: "a.docx", role: "main", chars: 12 },
    ])
  })
})
