// R50（P0-3 长文可见性）接线守卫：手册与代码同源 + 旧「静默截断」口径在源码里彻底消失 + 证据包真的接进了业务入口。
// 动机：升级文档 P0-3 明确「先做输入可见性报告」，而可见性报告只有真接进废标/偏离表才有效——手册漂移或只改提示词不改调用都必须变红。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { buildDeviationMapMessages } from "./prompts/deviationMap"
import { buildVoidCheckMessages } from "./prompts/voidCheck"
import { selectBidEvidence } from "./bidVisibility"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ROOT = path.resolve(SRC, "..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")
const readRoot = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8")
const MASTER = "docs/系统提示词分类手册.md"
const DERIVED = "docs/提示词手册/01-标书工作台.md"

/** 取文档中某标题后第一个三反引号代码块的逐字内容（行尾统一按 LF 比较） */
function codeBlockAfter(file: string, header: string): string {
  const s = readRoot(file).replace(/\r\n/g, "\n")
  const i = s.indexOf(header)
  expect(i, `未找到标题：${header}`).toBeGreaterThan(-1)
  const start = s.indexOf("```\n", i)
  expect(start, `标题后未找到代码块：${header}`).toBeGreaterThan(-1)
  const end = s.indexOf("\n```", start + 4)
  expect(end).toBeGreaterThan(start)
  return s.slice(start + 4, end)
}

const sysOf = (m: { content: unknown }[]) => (typeof m[0].content === "string" ? m[0].content : "")

describe("P0-3 手册与提示词同源（改代码不改手册必红）", () => {
  const sampleClauses = ["未按招标文件要求盖章的投标无效"]
  const evidence = selectBidEvidence("第2章 投标函\n本投标文件已加盖公章。", sampleClauses)

  it("分类手册 §2.13 == buildVoidCheckMessages 的 system", () => {
    expect(codeBlockAfter(MASTER, "## 2.13")).toBe(sysOf(buildVoidCheckMessages(sampleClauses, evidence)))
  })

  it("分类手册 §2.11 == buildDeviationMapMessages 的 system", () => {
    const sys = sysOf(
      buildDeviationMapMessages([{ id: "c1", source: "招标第三章", text: "系统响应时间不超过 3 秒" }], [], evidence),
    )
    expect(codeBlockAfter(MASTER, "## 2.11")).toBe(sys)
  })

  it("派生手册 §2.11 / §2.13 与母手册逐字一致（split-prompts 产物不漂移）", () => {
    expect(codeBlockAfter(DERIVED, "## 2.11")).toBe(codeBlockAfter(MASTER, "## 2.11"))
    expect(codeBlockAfter(DERIVED, "## 2.13")).toBe(codeBlockAfter(MASTER, "## 2.13"))
  })
})

describe("P0-3 旧口径（静默截断）在源码里彻底消失", () => {
  it("三份提示词不再自行 clipText/MAX_BID_CHARS 截断素材", () => {
    for (const rel of [
      "pages/BidWorkspace/prompts/voidCheck.ts",
      "pages/BidWorkspace/prompts/voidCheckRounds.ts",
      "pages/BidWorkspace/prompts/deviationMap.ts",
    ]) {
      const src = read(rel)
      expect(src, rel).not.toContain("MAX_BID_CHARS")
      expect(src, rel).not.toMatch(/clipText\s*\(/)
      expect(src, rel).toContain("bidEvidenceBlock")
    }
  })

  it("偏离表不再用「每章前 300 字摘要」充当正文", () => {
    expect(read("pages/BidWorkspace/prompts/deviationMap.ts")).not.toContain("slice(0, 300)")
  })
})

describe("P0-3 证据包真的接进了业务入口", () => {
  const hook = read("pages/BidWorkspace/useBidWorkspace.ts")

  it("废标自查：正式三轮与降级单轮共用同一个证据包，不再传裸正文", () => {
    const start = hook.indexOf("const runVoidCheck = useCallback")
    expect(start).toBeGreaterThan(-1)
    const seg = hook.slice(start, hook.indexOf("}, [", start))
    expect(seg).toContain("const evidence = selectBidEvidence(bidText, clauses)")
    expect(seg).toContain("runVoidCheckThreeRounds(clauses, evidence, starBlock)")
    expect(seg).toContain("buildVoidCheckMessages(clauses, evidence, starBlock)")
    expect(seg).not.toMatch(/clipText\s*\(/)
  })

  it("偏离表：素材改证据包，且与条款 id 绑定（人工可对号入座）", () => {
    const start = hook.indexOf("const runDeviationTable = useCallback")
    expect(start).toBeGreaterThan(-1)
    const seg = hook.slice(start, hook.indexOf("}, [", start))
    expect(seg).toContain("selectBidEvidence(resolveBidText(cur), clauses.map((c) => ({ id: c.id, text: c.text })))")
    expect(seg).toContain("buildDeviationMapMessages(clauses, cur.bid_outline, deviationEvidence")
  })

  it("输入不完整必须出现在界面（toast 里看得见，而不是藏在日志）", () => {
    expect(hook).toContain('describeBidVisibility(evidence, "废标自查")')
    expect(hook).toContain('describeBidVisibility(deviationEvidence, "技术偏离表")')
    const seg = hook.slice(hook.indexOf("const runVoidCheck = useCallback"))
    expect(seg.slice(0, seg.indexOf("}, ["))).toContain("if (!evidence.report.input_complete)")
  })

  it("快捷工具版废标检查同样走证据包（工具版不得留旧截断路径）", () => {
    expect(hook).toContain("selectBidEvidence(chaptersToTextStub(toolBidText), clauses)")
  })
})
