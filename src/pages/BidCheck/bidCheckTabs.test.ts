// 标书检查 屏内 Tab 口径守卫（UX-v2：prototype/check/ 四屏）。
// 与其余模块的 tabs 守卫同思路：Tab 名称/顺序对齐原型 manifest；拆屏零丢失 + 派生兜底钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { BID_CHECK_TABS, bidCheckTabHref, parseBidCheckTab, type BidCheckTab } from "./bidCheckTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 check 四屏", () => {
  it("顺序固定为 新建检查 → 检查中 → 检查报告 → 历史报告", () => {
    expect(BID_CHECK_TABS.map((t) => t.key)).toEqual(["upload", "running", "report", "history"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(BID_CHECK_TABS.map((t) => t.label)).toEqual(["新建检查", "检查中", "检查报告", "历史报告"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of BID_CHECK_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省返回 null，由页面按会话派生（running→检查中、有结果→报告、否则新建检查）", () => {
    expect(parseBidCheckTab(null)).toBeNull()
    expect(parseBidCheckTab("")).toBeNull()
    expect(parseBidCheckTab("report ")).toBeNull()
    expect(parseBidCheckTab("../")).toBeNull()
  })

  it("合法值原样透传", () => {
    const keys: BidCheckTab[] = ["upload", "running", "report", "history"]
    for (const k of keys) expect(parseBidCheckTab(k)).toBe(k)
  })

  it("地址形状：新建检查不带参数位，其余屏带 ?tab=", () => {
    expect(bidCheckTabHref("upload")).toBe("/bid-check")
    expect(bidCheckTabHref("report")).toBe("/bid-check?tab=report")
    expect(bidCheckTabHref("history")).toBe("/bid-check?tab=history")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与子屏组件里都没有拆前/拆后文案", () => {
    const files = ["./BidCheckSubtabs.tsx", "./BidCheckPage.tsx"]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失", () => {
  it("页面壳引用了全部既有能力（一个不删，只重新归位）", () => {
    const page = readSrc("./BidCheckPage.tsx")
    for (const mod of [
      "BidCheckSubtabs",
      "ReadingView",
      "RulesListPanel",
      "BidCheckConfigDialog",
      "exportHtmlReport",
      "exportChecklistToExcel",
      "exportAnnotatedDocx",
      "runSemanticReview",
      "pickFile",
      "pickProject",
      "tryExport",
      "writeRecentCheck",
      "readRecentChecks",
    ]) {
      expect(page.includes(mod), `标书检查拆屏丢了模块/能力：${mod}`).toBe(true)
    }
  })

  it("双 Tab（检查结果/规则清单）已被四屏取代；规则开关归「新建检查」折叠区", () => {
    const page = readSrc("./BidCheckPage.tsx")
    expect(page).toContain("BidCheckSubtabs")
    expect(page).toContain("规则包清单")
    expect(page.includes('type Tab = "result" | "rules"')).toBe(false)
    // 旧双 Tab 的 pill（BookOpenCheck 图标 + result/rules 切换）已整体拆除
    expect(page.includes("BookOpenCheck")).toBe(false)
  })

  it("缺省派生：running→检查中、有结果→报告（点开始检查不写地址也走完流程）", () => {
    const page = readSrc("./BidCheckPage.tsx")
    expect(page).toContain('const derivedTab: BidCheckTab = running ? "running" : result ? "report" : "upload"')
    // 检查中屏不画假进度条：进行中/已完成/空闲三态如实
    expect(page).toContain("正在按当前规则包逐条扫描")
    expect(page).toContain("检查完成")
    expect(page).toContain("当前没有进行中的检查")
  })

  it("历史报告如实标注「完整报告属当次会话」，不伪造对比统计", () => {
    const page = readSrc("./BidCheckPage.tsx")
    expect(page).toContain("本机记录")
    expect(page).toContain("完整报告属当次会话")
  })
})
