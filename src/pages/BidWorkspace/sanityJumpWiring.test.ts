// R55（2026-10-16）接线哨兵：钉死「丢字检测可定位 + 标记随正文失效」的契约。
// 背景：R-301 的丢字检测只有一条不可点击的 tooltip（「丢字?"」红字），而 R-302 的文风 lint
//   已经做到了"命中入库 → 徽标 → 一键跳到命中字符"。同一个成稿自检里两个检测器体验不一致，
//   且丢字**只给一句总结、不给位置**，用户面对 3 万字正文无从下手。
// 另外 R-301/R-302 注释都写了"人工修订后清空"，但实现只在重新生成时清空——人工改完正文，
//   徽标永远红着、offset 还锚在旧正文上（跳到错位置比不跳更坏）。
// 本哨兵防止后人只改一层（改检测器不接徽标 / 删跳转 / 忘了清空）而悄悄回归。
// 风格同 proseLintWiring.test.ts（源码扫描，无需 jsdom；只用 toContain/region，不吃换行符差异）。
import { hookSources, sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

// 路径统一为**仓库相对 POSIX 路径**，读取走单一入口（R57 · 审计 §3.1）：
// 行尾由 hookSources 归一为 LF，本文件不再自带 readFileSync；God Hook 只用 hookSources() 读，
// 路径字面量 `useBidWorkspace.ts` 全仓只允许出现在 src/testing/hookSources.ts。
const COMPOSE = "src/components/bid-workspace/ComposeStep.tsx"
const SOL_TYPES = "src/pages/SolutionStudio/solutionTypes.ts"
const PAGE = "src/pages/BidWorkspace/BidWorkspacePage.tsx"
const SANITY = "src/pages/BidWorkspace/bidTextSanity.ts"

/** 截取 startMarker 之后 len 个字符（源码扫描只按字符位置，不依赖换行符） */
function region(code: string, startMarker: string, len: number): string {
  const i = code.indexOf(startMarker)
  expect(i, `源码里找不到锚点：${startMarker}`).toBeGreaterThanOrEqual(0)
  return code.slice(i, i + len)
}

describe("R55 第①层：检测器给出可定位的锚点", () => {
  it("detectLostChars 的命中自带 offset（跳转的唯一依据），且 summary 的「最严重」= hits[0]", () => {
    const code = sourceText(SANITY)
    expect(code).toContain("offset: m.index ?? 0")
    // R55 之前 short_line 的文案里印着未替换的占位符「第 N 行」
    expect(code).toContain("第 ${lineNumberAt(scanText, m.index)} 行过短")
    expect(code).not.toContain("第 N 行过短")
    // 注释里承诺的接口用法必须与真实字段名一致（R-301 初稿注释写的是 genError，早已改成 sanityWarning）
    expect(code).toContain("updateChapter(nodeId, { sanityWarning: r.summary")
    expect(code).not.toContain("updateChapter(nodeId, { genError: r.summary })")
  })
})

describe("R55 第②层：Chapter 落库两个字段 + hook 双向写入/清空", () => {
  it("Chapter 类型有文案字段与跳转锚点字段", () => {
    const code = sourceText(SOL_TYPES)
    expect(code).toContain("sanityWarning?: string")
    expect(code).toContain("sanityFirstHit?: { offset: number; excerpt: string }")
  })

  it("applyAutoRepair：命中写 summary + firstHit，修好后两者一起清空", () => {
    const code = hookSources()
    expect(code).toContain('from "./bidTextSanity"')
    // REQ-025（2026-10-17）：丢字检测改为检查 fixedContent（长段落重排后的文本）。
    // 重排只动换行不动字，但它改变了 offset——检测与被落库的必须是同一份文本。
    expect(code).toContain("detectLostChars(fixedContent)")
    expect(code).toContain("sanityWarning: r.summary")
    expect(code).toContain("sanityFirstHit: { offset: first.offset, excerpt: first.excerpt }")
    expect(code).toContain("sanityWarning: undefined, sanityFirstHit: undefined")
    // 失败归因字段不许被丢字检测污染：genError 是 R280「生成失败原因」，
    // composeGates A2 用「failed 且无 genError」判违规，复用会让两次失败归因互相覆盖。
    const sanityBlock = region(code, "detectLostChars(fixedContent)", 700)
    expect(sanityBlock).not.toContain("genError")
  })

  it("人工改正文即作废两类本地标记（丢字 / 版式），offset 不会留在旧正文上", () => {
    const code = hookSources()
    const flush = region(code, "const flushEditingContent = useCallback(", 1600)
    expect(flush).toContain("ch.content !== editingContentRef.current")
    expect(flush).toContain("sanityWarning: undefined")
    expect(flush).toContain("sanityFirstHit: undefined")
    expect(flush).toContain("proseLintWarning: undefined")
    expect(flush).toContain("proseLintFirstHit: undefined")
    // 只有真的存在标记时才写补丁（避免每次编辑都往 chapters json 里塞 4 个 undefined）
    expect(flush).toContain("const stale =")
  })
})

describe("R55 第③层：徽标可点击 → 切编辑态 → 跳到命中字符", () => {
  it("页面把 focusPositionInChapter 透传给 ComposeStep（否则点击无声失败）", () => {
    expect(sourceText(PAGE)).toContain("focusPositionInChapter={p.focusPositionInChapter}")
  })

  it("「丢字?」从不可点击的 span 变成 button，并与「版式?」共用同一条跳转通道", () => {
    const code = sourceText(COMPOSE)
    expect(code).toContain("丢字?")
    expect(code).not.toContain("丢字?</span>")
    // 两个徽标各自调用一次跳转（同一行代码出现 2 次 = 同一通道）
    const calls = code.split("p.focusPositionInChapter(ch.node_id, hit.offset, hit.excerpt)").length - 1
    expect(calls).toBe(2)
    // 丢字徽标区块：读 sanityFirstHit + 预览态先切编辑态 + 无锚点时的兜底
    const block = region(code, "{ch.sanityWarning && (", 1200)
    expect(block).toContain("ch.sanityFirstHit")
    expect(block).toContain('setViewMode("edit")')
    expect(block).toContain("p.focusPositionInChapter(ch.node_id, hit.offset, hit.excerpt)")
    expect(block).toContain("p.selectChapter(ch.node_id)")
    // 定位原语只能有一个真源（禁止在组件里内联 setSelectionRange）
    expect(code).not.toContain("el.setSelectionRange(safeOffset")
  })
})
