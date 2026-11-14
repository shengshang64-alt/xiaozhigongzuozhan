// 2026-11-11 标书工作台 UX 整治回归网（源码哨兵 + 行为断言）。
//
// 这一轮修的都是「页面照样能打开、但用户真实受损」的问题，退化方式都很隐蔽，所以逐条钉住：
//   ① 列表页同屏两个 h1（PageHeader「标书工作」+ 卡片 hero「投标项目」）+ 复盘条渲染两遍；
//   ② 「投标复盘 →」是 <a href="/review"> 死链（仓内无该路由），且裸 <a> 会整页刷新丢保活状态；
//   ③ 数据条「已归档 / 回收站」恒为 0（拿已被 listView 过滤的列表当分母）；
//   ④ 卡片字数走两遍 draftCharCount（O(全文) 重复扫描）；
//   ⑤ 卡片 role="button" 里嵌真 <button>（非法 ARIA，读屏语义错乱）；
//   ⑥ 隐藏标签页传 inert=""（React 19 当 false，隐藏面板仍可被 Tab 聚焦）；
//   ⑦ 标签栏被 overflow-hidden 包成滚动容器 → sticky 失效，滚动后标签栏滚出视口；
//   ⑧ 页内工具条 sticky top-14(56px) 与实测顶栏 60px 不符，且多标签时被 38px 标签栏盖住；
//   ⑨ 作战室资质核验 error 态自激重试（每轮 effect 重新发请求，永远停不下来）。
import { describe, expect, it } from "vitest"
import { hookSources, sourceText } from "@/testing/hookSources"

/**
 * 去掉注释后的源码文本。
 * 这一轮的修复全部**带注释说明「原写法为什么错」**，注释里会原样出现 `href="/review"`、
 * `inert: ""`、`qualState === "done"` 等被禁写法。直接对整份源码断言「不含某串」会全部假红，
 * 所以断言一律跑在去注释文本上——测的是代码，不是注释。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .replace(/^\s*\/\/.*$/gm, "") // 整行行注释
    .replace(/([;{}(,])\s*\/\/[^\n]*/g, "$1") // 行尾注释（保留前导语法字符）
}

const PAGE = stripComments(sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx"))
// God Hook 的路径口径只能走单一入口（hookSources()）——不得在本文件再写死 hook 文件名，
// 否则 src/testing/hookSourcesConvergence.test.ts 的边界①会红（搬簇时会被漏掉）。
const HOOK = stripComments(hookSources())
const LIST = stripComments(sourceText("src/components/bid-workspace/BidProjectList.tsx"))
const REVIEW = stripComments(sourceText("src/components/bid-workspace/BidReviewSummary.tsx"))
const WAR_ROOM = stripComments(sourceText("src/components/bid-workspace/BidWarRoom.tsx"))
const TABS = stripComments(sourceText("src/components/shell/WorkspaceTabs.tsx"))
const OUTLET = stripComments(sourceText("src/components/shell/TabbedOutlet.tsx"))
const SHELL = stripComments(sourceText("src/components/shell/WorkbenchShell.tsx"))

describe("① 列表页只剩一个 h1 / 一条复盘", () => {
  it("页面壳不再渲染 PageHeader（标题由列表 hero 唯一承载）", () => {
    expect(PAGE.includes("<PageHeader")).toBe(false)
    expect(PAGE.includes('title="标书工作"')).toBe(false)
  })

  it("页面壳不再渲染第二次 BidReviewSummary（列表内已有一次）", () => {
    expect(PAGE.includes("<BidReviewSummary")).toBe(false)
    expect(LIST.includes("<BidReviewSummary")).toBe(true)
  })

  it("列表 hero 的 h1 仍是「投标项目」（页面唯一一级标题）", () => {
    expect(LIST).toContain('<h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold')
    expect(LIST).toContain("投标项目")
  })
})

describe("② 投标复盘入口不再是死链", () => {
  it("用 react-router Link + homeTabHref(\"review\")，不手写 /review", () => {
    expect(REVIEW).toContain('import { Link } from "react-router-dom"')
    expect(REVIEW).toContain('import { homeTabHref } from "@/pages/Home/homeTabs"')
    expect(REVIEW).toContain('to={homeTabHref("review")}')
    expect(REVIEW.includes('href="/review"')).toBe(false)
  })

  it("口径与工作台 Tab 真源一致（?tab=review）", () => {
    const homeTabs = sourceText("src/pages/Home/homeTabs.ts")
    expect(homeTabs).toContain('`/?tab=${tab}`')
  })
})

describe("③ 列表数据条按全量统计", () => {
  it("hook 额外导出 allProjects（未过滤全量），projects 仍是过滤后的", () => {
    expect(HOOK).toContain("projects: filteredProjects,")
    expect(HOOK).toContain("allProjects: projects,")
  })

  it("页面把 allProjects 传给列表组件，数据条因此不再恒为 0", () => {
    expect(PAGE).toContain("allProjects={p.allProjects}")
    expect(LIST).toContain("const all = p.allProjects ?? p.projects")
  })
})

describe("④ 卡片字数只算一次", () => {
  it("draftCharCount 在卡片里只调用一次（提到组件顶部）", () => {
    const body = LIST.slice(LIST.indexOf("function ProjectCard("), LIST.indexOf("export function BidProjectList("))
    const calls = body.match(/draftCharCount\(proj\)/g) ?? []
    expect(calls).toHaveLength(1)
    expect(body).toContain("const draftChars = view === \"trash\" ? 0 : draftCharCount(proj)")
    expect(body).toContain("draftChars > 0 ?")
  })
})

describe("⑤ 卡片不再嵌套交互控件", () => {
  it("article 不再冒充按钮（无 role=\"button\" / tabIndex={0}）", () => {
    expect(LIST.includes('role="button"')).toBe(false)
    expect(LIST.includes("tabIndex={0}")).toBe(false)
  })

  it("键盘入口改为标题处的真 <button>（Enter 可开项目）", () => {
    const body = LIST.slice(LIST.indexOf("function ProjectCard("), LIST.indexOf("export function BidProjectList("))
    expect(body).toContain("<button")
    expect(body).toContain("onOpen(proj)")
    // 内层按钮点击不能冒泡触发整卡 onClick（否则一次点击开两次）
    expect(body).toContain("e.stopPropagation()")
  })
})

describe("⑥ 隐藏标签页的 inert 是真布尔", () => {
  it("传 inert: true，不再传空字符串", () => {
    expect(OUTLET).toContain("inert: true")
    expect(OUTLET.includes('inert: ""')).toBe(false)
    expect(OUTLET.includes("as unknown as boolean")).toBe(false)
  })
})

describe("⑦ 标签栏 sticky 生效且与顶栏不重叠", () => {
  it("包一层的兜底容器不再单独承担 sticky（合并到同一层）", () => {
    expect(TABS).toContain('<div className="sticky top-[60px] z-30 min-w-0 max-w-full overflow-x-clip">')
    // 内层只负责横向滚动，不再自带 sticky
    expect(TABS).toContain('className="flex h-[38px] min-w-0 max-w-full items-stretch gap-1 overflow-x-auto')
  })

  it("不再用会建立滚动容器、让 sticky 失效的 overflow-hidden 包裹", () => {
    // 只看标签栏那一层（右键菜单的 overflow-hidden 是圆角裁切，与本议题无关）
    const wrapper = TABS.slice(TABS.indexOf("min-w-0 max-w-full"), TABS.indexOf("role=\"tablist\""))
    expect(wrapper.includes("overflow-hidden")).toBe(false)
    expect(TABS).toContain("overflow-x-clip")
  })
})

describe("⑧ 页内工具条粘性层高与真实顶栏/标签栏对齐", () => {
  const toolbars = [
    "src/components/bid-workspace/BidToolbar.tsx",
    "src/components/customer-management/CrmToolbar.tsx",
    "src/components/solution-studio/StudioToolbar.tsx",
    "src/components/intel-center/IntelToolbar.tsx",
    "src/components/ppt-quote/QuoteToolbar.tsx",
  ]

  it("五个工具条统一用 calc(60px + --xz-tabs-h)，不再硬编码 top-14", () => {
    for (const rel of toolbars) {
      const src = sourceText(rel)
      expect(src, `${rel} 仍硬编码 top-14`).not.toContain("sticky top-14 ")
      expect(src, `${rel} 未接入 --xz-tabs-h`).toContain("sticky top-[calc(60px+var(--xz-tabs-h,0px))]")
    }
  })

  it("壳层按标签数量下发 --xz-tabs-h（单标签 0px、多标签 38px）", () => {
    expect(SHELL).toContain('"--xz-tabs-h": tabs.items.length > 1 ? "38px" : "0px"')
  })
})

describe("⑨ 作战室资质核验不再自激重试", () => {
  it("只有 idle 才发起请求；error 态由「点击重试」显式置回 idle", () => {
    expect(WAR_ROOM).toContain('if (qualState !== "idle") return')
    expect(WAR_ROOM.includes('if (qualState === "done") return')).toBe(false)
    expect(WAR_ROOM).toContain('setQualState("idle")')
  })
})
