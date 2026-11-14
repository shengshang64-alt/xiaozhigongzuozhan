// 知识库 屏内 Tab 口径守卫（UX-v2：prototype/kb/ 六屏）。
// 与 customerTabs.test.ts / materialTabs.test.ts 同思路：Tab 名称/顺序是
// 「1:1 对齐原型 manifest」的口径，测试直接断言；并把「拆屏零丢失」钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { KB_TABS, kbTabHref, parseKbTab, type KbTab } from "./kbTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 kb 六屏", () => {
  it("顺序固定为 文档库 → 全文检索 → 知识原子 → 原子审核 → 问知识库 → 上传文档", () => {
    expect(KB_TABS.map((t) => t.key)).toEqual(["browse", "search", "atoms", "review", "qa", "upload"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(KB_TABS.map((t) => t.label)).toEqual(["文档库", "全文检索", "知识原子", "原子审核", "问知识库", "上传文档"])
  })

  it("每屏都有一句话 hint（屏内 Tab 右侧说明位不许空着）", () => {
    for (const t of KB_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「文档库」，旧书签行为不变", () => {
    expect(parseKbTab(null)).toBe("browse")
    expect(parseKbTab("")).toBe("browse")
    expect(parseKbTab("atoms ")).toBe("browse")
    expect(parseKbTab("../")).toBe("browse")
  })

  it("合法值原样透传", () => {
    const keys: KbTab[] = ["browse", "search", "atoms", "review", "qa", "upload"]
    for (const k of keys) expect(parseKbTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(kbTabHref("browse")).toBe("/knowledge")
    expect(kbTabHref("search")).toBe("/knowledge?tab=search")
    expect(kbTabHref("upload")).toBe("/knowledge?tab=upload")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("六屏与页面壳里都没有拆前/拆后文案", () => {
    const files = [
      "./KbBrowseScreen.tsx",
      "./KbSearchScreen.tsx",
      "./KbAtomsScreen.tsx",
      "./KbAtomReviewScreen.tsx",
      "./KbQaScreen.tsx",
      "./KbUploadScreen.tsx",
      "../../pages/Knowledge/KnowledgePage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失：既有能力全部保留并归位", () => {
  it("页面壳引用了全部六屏", () => {
    const page = readSrc("../../pages/Knowledge/KnowledgePage.tsx")
    for (const mod of [
      "KbBrowseScreen",
      "KbSearchScreen",
      "KbAtomsScreen",
      "KbAtomReviewScreen",
      "KbQaScreen",
      "KbUploadScreen",
      "KbSubtabs",
      "CostConfirmDialog",
    ]) {
      expect(page.includes(mod), `知识库拆屏丢了模块：${mod}`).toBe(true)
    }
  })

  it("阅读区没被删掉：搬进弹窗，DocReaderPanel 原样复用", () => {
    const page = readSrc("../../pages/Knowledge/KnowledgePage.tsx")
    const browse = readSrc("./KbBrowseScreen.tsx")
    expect(browse).toContain("KbDocReaderDialog")
    const dialog = readSrc("./KbDocReaderDialog.tsx")
    expect(dialog).toContain("DocReaderPanel")
    expect(page.includes("DocReaderPanel") || browse.includes("DocReaderPanel")).toBe(true)
  })

  it("列表栏整体保留：DocListPanel 的批量/导出/回收站/分类/排序能力一个没删", () => {
    const browse = readSrc("./KbBrowseScreen.tsx")
    expect(browse).toContain("DocListPanel")
    for (const cap of [
      "toggleBatchMode",
      "batchMoveToFolder",
      "batchSetCategory",
      "batchDeleteDocs",
      "setTrashOpen",
      "setCategoryFilter",
      "setSortKey",
    ]) {
      expect(browse, `文档库屏丢了列表能力：${cap}`).toContain(cap)
    }
  })

  it("本机资料（AnyTXT）检索没被删掉：收进「查看配置」弹窗", () => {
    const dialog = readSrc("./KbLocalSearchDialog.tsx")
    expect(dialog).toContain("LocalDocSearchPanel")
  })

  it("问答与上传从抽屉/弹窗升级为独立屏，但数据层没动", () => {
    const qa = readSrc("./KbQaScreen.tsx")
    expect(qa).toContain("sendQaQuestion")
    expect(qa).toContain("openCitation")
    expect(qa).toContain("reportAnswerWrong")
    const upload = readSrc("./KbUploadScreen.tsx")
    expect(upload).toContain("processUploadFiles")
    expect(upload).toContain("readKbUploadHistory")
  })

  it("原子审核复用既有 useKbReview（逻辑层零改动）", () => {
    const review = readSrc("./KbAtomReviewScreen.tsx")
    expect(review).toContain("useKbReview")
    for (const act of ["r.approve", "r.reject", "r.undo", "r.runBatch", "r.setAtomType"]) {
      expect(review, `审核屏丢了动作：${act}`).toContain(act)
    }
  })
})

describe("⑤ 硬编码色值与演示数字不许进生产", () => {
  it("新组件里没有硬编码 #RRGGBB / rgb()", () => {
    const files = [
      "./KbPrimitives.tsx",
      "./KbBrowseScreen.tsx",
      "./KbSearchScreen.tsx",
      "./KbAtomsScreen.tsx",
      "./KbAtomReviewScreen.tsx",
      "./KbQaScreen.tsx",
      "./KbUploadScreen.tsx",
      "./KbDocReaderDialog.tsx",
      "./KbLocalSearchDialog.tsx",
      "./KbAtomCiteDialog.tsx",
      "./KbSubtabs.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(/#[0-9a-fA-F]{3,6}\b/.test(src), `${rel} 有硬编码色值`).toBe(false)
      expect(/\brgba?\(/.test(src), `${rel} 有硬编码 rgb()`).toBe(false)
    }
  })

  it("没有把原型的演示数字（1,842 / 312 / 47 次）写死进界面", () => {
    const files = [
      "./KbAtomsScreen.tsx",
      "./KbBrowseScreen.tsx",
      "./KbAtomReviewScreen.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("1,842"), `${rel} 写死了演示数字 1,842`).toBe(false)
      expect(src.includes("312 条原子待审核"), `${rel} 写死了演示数字 312`).toBe(false)
    }
  })
})
