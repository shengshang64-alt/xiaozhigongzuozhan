// R48（P0-2 事实来源优先级）消费侧接线守卫。
// 纯函数层（factSources.ts）与提示词层（prompts/factSourcePriority.test.ts）已各有单测，本文件补三类「接线」断言：
//   ① 手册与代码同源 —— docs/系统提示词分类手册.md §2.22 的逐字块必须等于 buildFactSettingsMessages 的 system，
//      派生手册 docs/提示词手册/01-标书工作台.md 与母手册逐字一致（改代码不改手册必红）；
//   ② 生成链路真的调了规范化 —— runGenerateFactSettings 必须经 normalizeFactSourceLines 再 setFactDraft；
//   ③ 旧口径的承诺句在源码里彻底消失（「同主题事实优先采用范本口径」「本项目工期：90 天」式模板）。
// 纯 node fs，无需 jsdom。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { buildFactSettingsMessages } from "./prompts/factSettings"
import { FACT_CONFIRM_MARK, normalizeFactSourceLines } from "./factSources"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..") // src/
const ROOT = path.resolve(SRC, "..") // 仓库根（docs/ 在这层）
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")
const readRoot = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8")

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

const systemOf = (text = ""): string => {
  const c = buildFactSettingsMessages(text)[0]?.content
  return typeof c === "string" ? c : ""
}

describe("P0-2 手册与提示词同源（改代码不改手册必红）", () => {
  it("分类手册 §2.22 的逐字块 == buildFactSettingsMessages 的 system", () => {
    expect(codeBlockAfter("docs/系统提示词分类手册.md", "## 2.22")).toBe(systemOf())
  })

  it("派生手册 §2.22 与母手册逐字一致（split-prompts 产物不漂移）", () => {
    expect(codeBlockAfter("docs/提示词手册/01-标书工作台.md", "## 2.22 全局事实设定生成")).toBe(
      codeBlockAfter("docs/系统提示词分类手册.md", "## 2.22"),
    )
  })
})

describe("P0-2 生成链路接线（范本不得覆盖本项目 / 要求类数字不得静默落定）", () => {
  const hook = read("pages/BidWorkspace/useBidWorkspace.ts")
  const start = hook.indexOf("const runGenerateFactSettings = useCallback")
  const seg = hook.slice(start, hook.indexOf("}, [", start))

  it("runGenerateFactSettings 必须经 normalizeFactSourceLines 再落编辑态草稿", () => {
    expect(start).toBeGreaterThan(-1)
    expect(seg).toContain("normalizeFactSourceLines(rawLines)")
    expect(seg).toContain("setFactDraft(lines)")
    expect(seg.indexOf("normalizeFactSourceLines")).toBeLessThan(seg.indexOf("setFactDraft("))
  })

  it("范本摘录标签不得再承诺「同主题事实优先采用范本口径」（旧第 7 条的落点）", () => {
    expect(hook).not.toContain("同主题事实优先采用范本口径")
    expect(hook).toContain("仅写法与表述参考，不得覆盖本项目招标要求与我方事实")
  })

  it("标记条数进 toast —— 待商务拍板的取值必须让用户看见", () => {
    expect(seg).toContain("FACT_CONFIRM_MARK")
    expect(seg).toContain("marked.length")
  })

  it("事实面板如实说明「需人工确认」口径（用户看得见）", () => {
    const panel = read("components/bid-workspace/GlobalFactsPanel.tsx")
    expect(panel).toContain(FACT_CONFIRM_MARK)
    expect(panel).toContain("待商务拍板")
    expect(panel).toContain("不是已定承诺")
  })

  it("端到端口径：已定承诺句被标记、招标比较口径不被标记", () => {
    const { lines, marked } = normalizeFactSourceLines(["本项目工期：90 天", "工期：不超过 90 天"])
    expect(marked).toEqual([`本项目工期：90 天 ${FACT_CONFIRM_MARK}`])
    expect(lines[1]).toBe("工期：不超过 90 天")
  })
})
