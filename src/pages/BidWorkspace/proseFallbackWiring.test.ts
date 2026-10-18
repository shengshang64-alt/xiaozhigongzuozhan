// 散文兜底接线守卫（2026-10-15 用户实测「标书大纲一直生成不了」的修复）。
//
// 根因：推理型模型有时把答案写成英文分析过程（"Let me analyze this task carefully…"）而不是 JSON。
// 它既不是空回复（F1 空回复阶梯不命中）也不是超时（R177 降级阶梯不命中），且当时不记任何证据，
// 于是同一条请求每次都以同样的散文失败——用户看到的就是"一直生成不了"。
//
// 修的是一条链，缺一环就复发，所以断在源码上（与 promptVisibilityWiring 同类接线守卫）：
//   ① llmGenerate 消费 expectJson；
//   ② 期望 JSON 却拿到无 JSON 候选时：记证据（同模型后续首调关思考）+ 立刻关思考重试；
//   ③ withJsonRepair 的散文分支也记证据（兜住未标 expectJson 的调用点）；
//   ④ 大纲流程的调用点真的带上了 expectJson（否则不会自动重试，又回到"要点两次"）。
import { countMatches, hookSources } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

// 源码读取走 src/testing/hookSources 单一入口（R57 · 审计 §3.1）：路径口径、行尾归一（CRLF→LF）
// 与「读不到时会喊」都收敛在那一处——本文件不再自带 readFileSync / fileURLToPath。
const HOOK = hookSources()

describe("散文兜底（模型返回分析文本而非 JSON）接线守卫", () => {
  it("llmGenerate 消费 expectJson，并在散文时记证据 + 关思考重试", () => {
    expect(HOOK).toContain("opts?.expectJson")
    expect(HOOK).toContain("noteThinkingEmptyReply(latencyKey)")
    // 重试必须真的关掉思考（否则重试仍会写出同一段散文）
    const retryBlock = HOOK.slice(HOOK.indexOf("opts?.expectJson"), HOOK.indexOf("opts?.expectJson") + 1400)
    expect(retryBlock).toContain("disableThinking: true")
    expect(retryBlock).toContain("extractJsonCandidate(r.text)")
  })

  it("withJsonRepair 的散文分支把证据记到当前模型（兜住未标 expectJson 的调用点）", () => {
    const proseBranchStart = HOOK.indexOf("模型未按 JSON 格式返回")
    expect(proseBranchStart).toBeGreaterThan(-1)
    const before = HOOK.slice(Math.max(0, proseBranchStart - 900), proseBranchStart)
    expect(before).toContain("noteThinkingEmptyReply(activeModelRef")
  })

  it("大纲流程的每个 JSON 调用点都标了 expectJson（缺一个就少一处自愈）", () => {
    // 大纲流程的 llmGenerate 调用 = scope 行 "bid-outline"（注意按整行匹配：useScopeSkills("bid-outline")
    // 是技能池调用，不是生成调用，不能被数进来）+ opts 里 role 为 outline 的修复调用
    // 行锚保留 \r?\n 作为第二道保险：读取侧（hookSources）已把行尾归一为 LF，两道保险不冲突；
    // 历史上只写 \n 时曾在 CRLF 检出下静默匹配 0 处，把「接线完好」误判成「接线缺失」——即假红。
    const outlineCalls =
      countMatches(HOOK, /\r?\n\s*"bid-outline",\r?\n/g) + countMatches(HOOK, /role: "outline"/g)
    const tagged = countMatches(HOOK, /expectJson: true/g)
    expect(outlineCalls).toBe(7) // 5 处 scope=bid-outline + 2 处 role=outline（结构修复 / 门禁修复）
    expect(tagged).toBeGreaterThanOrEqual(outlineCalls)
  })
})
