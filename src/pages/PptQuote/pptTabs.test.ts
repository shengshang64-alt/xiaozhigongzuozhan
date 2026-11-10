// PPT 与报价 屏内 Tab 口径守卫（UX-v2：prototype/ppt/ 五屏）。
// 与其余模块的 tabs 守卫同思路：Tab 名称/顺序对齐原型 manifest；拆屏零丢失 + URL/会话同步钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PPT_QUOTE_TABS, parsePptQuoteTab, pptQuoteTabHref, type PptQuoteTab } from "./pptTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 ppt 五屏", () => {
  it("顺序固定为 汇报 PPT → PPT 编辑器 → 报价清单 → 报价编辑 → 报价单预览", () => {
    expect(PPT_QUOTE_TABS.map((t) => t.key)).toEqual([
      "deck-list",
      "deck-editor",
      "quote-list",
      "quote-editor",
      "quote-preview",
    ])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(PPT_QUOTE_TABS.map((t) => t.label)).toEqual([
      "汇报 PPT",
      "PPT 编辑器",
      "报价清单",
      "报价编辑",
      "报价单预览",
    ])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of PPT_QUOTE_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省返回 null，由页面按会话状态派生当前屏（旧链接行为不变）", () => {
    expect(parsePptQuoteTab(null)).toBeNull()
    expect(parsePptQuoteTab("")).toBeNull()
    expect(parsePptQuoteTab("deck-list ")).toBeNull()
    expect(parsePptQuoteTab("../")).toBeNull()
  })

  it("合法值原样透传", () => {
    const keys: PptQuoteTab[] = ["deck-list", "deck-editor", "quote-list", "quote-editor", "quote-preview"]
    for (const k of keys) expect(parsePptQuoteTab(k)).toBe(k)
  })

  it("地址形状：列表屏不带参数位，其余屏带 ?tab=", () => {
    expect(pptQuoteTabHref("deck-list")).toBe("/ppt-quote")
    expect(pptQuoteTabHref("deck-editor")).toBe("/ppt-quote?tab=deck-editor")
    expect(pptQuoteTabHref("quote-preview")).toBe("/ppt-quote?tab=quote-preview")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与新屏组件里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/ppt-quote/QuoteSubtabs.tsx",
      "../../components/ppt-quote/QuotePreviewScreen.tsx",
      "./PptQuotePage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失 + 会话同步", () => {
  it("页面壳引用了全部既有组件与能力（一个不删，只重新归位）", () => {
    const page = readSrc("./PptQuotePage.tsx")
    for (const mod of [
      "DeckListPanel",
      "DeckEditorWorkspace",
      "NewDeckWizard",
      "QuoteListPanel",
      "QuoteEditor",
      "PptStatsRow",
      "QuoteToolbar",
      "NewQuoteDialog",
      "QuoteDraftDialog",
      "CheckProductPickerDialog",
      "ChecklistImportDialog",
      "exportQuoteExcel",
      "exportQuoteWord",
      "exportPptx",
      "saveQuoteNow",
      "saveDeckNow",
    ]) {
      expect(page.includes(mod), `PPT 与报价拆屏丢了模块/能力：${mod}`).toBe(true)
    }
  })

  it("切 Tab 同时归位会话（回列表走 backTo*List，防 URL 与 activeView 串屏）", () => {
    const page = readSrc("./PptQuotePage.tsx")
    expect(page).toContain("if (next === \"deck-list\" && p.deckMode !== \"list\") p.backToDeckList()")
    expect(page).toContain("if (next === \"quote-list\" && p.quoteMode !== \"list\") p.backToQuoteList()")
  })

  it("编辑/预览屏无会话时给指向列表的空态，不渲染死白页、不自动弹表单", () => {
    const page = readSrc("./PptQuotePage.tsx")
    expect(page).toContain("还没打开讲稿")
    expect(page).toContain("还没有打开报价单")
    expect((page.match(/还没有打开报价单/g) ?? []).length).toBe(2) // 编辑屏与预览屏各一
  })

  it("预览屏为只读：接真实导出，不伪造用印/发送记录", () => {
    const preview = readSrc("../../components/ppt-quote/QuotePreviewScreen.tsx")
    expect(preview).toContain("onExportXlsx")
    expect(preview).toContain("onExportWord")
    expect(preview).toContain("quoteTotalUpper")
    expect(preview.includes("发送记录")).toBe(true) // 以「未提供」口径出现，而非假列表
  })
})
