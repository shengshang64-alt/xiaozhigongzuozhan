// 技能注入端到端契约（2026-11-04，任务书第 4 项验证沉淀）
//
// 任务书要求：「改技能文案或默认勾选后，对话/生成请求里能看到技能块」。
// 这条链路是 skillCore 的模块级 registry —— 页面 hook 注册 getter，各生成函数按 scope 取块。
// 它不在任何单一函数的调用图里，所以常规组件测试覆盖不到；本文件把**整条链路**钉住：
//   注册 → 取块 → 注入 system → 计费文案 → 注销 → 不污染其它 scope
//
// 另附一个真实页面上的端到端实测（浏览器内动态 import skillCore 执行，2026-11-04）：
//   before=""（未注册）｜afterLen=19｜sysHasBlock=true｜userIntact=true
//   cost="，带入 1 个技能"｜afterUnreg=""｜otherScope=""
import { describe, expect, it, afterEach } from "vitest"
import {
  skillBlockFor,
  skillCountFor,
  skillCostSuffix,
  injectSkillBlock,
  registerScopeSkills,
  unregisterScopeSkills,
  type SkillScope,
} from "./skillCore"

const SCOPE: SkillScope = "solution-outline"
const FAKE_BLOCK = "## 用户指定工作技能\n- 测试技能：先讲业务痛点再讲技术"

function makeSource(block = FAKE_BLOCK, count = 1) {
  return { getBlock: () => block, getCount: () => count }
}

afterEach(() => {
  unregisterScopeSkills(SCOPE, makeSource() as never)
})

describe("技能注入链路：注册 → 取块 → 注入 → 计费 → 注销", () => {
  it("未注册时取块为空、计数为 0、计费无后缀（不制造假技能）", () => {
    expect(skillBlockFor(SCOPE)).toBe("")
    expect(skillCountFor(SCOPE)).toBe(0)
    expect(skillCostSuffix(SCOPE)).toBe("")
  })

  it("注册后能取到技能块，计费文案带「带入 n 个技能」", () => {
    const src = makeSource()
    registerScopeSkills(SCOPE, src)
    expect(skillBlockFor(SCOPE)).toBe(FAKE_BLOCK)
    expect(skillCountFor(SCOPE)).toBe(1)
    expect(skillCostSuffix(SCOPE)).toBe("，带入 1 个技能")
    unregisterScopeSkills(SCOPE, src)
  })

  it("注入到第一条 system 消息末尾，保留原提示词、不改 user 消息", () => {
    const src = makeSource()
    registerScopeSkills(SCOPE, src)
    const msgs = [
      { role: "system", content: "你是方案写作助手。" },
      { role: "user", content: "请写大纲" },
    ]
    const injected = injectSkillBlock(msgs, skillBlockFor(SCOPE))
    const sys = String(injected.find((m) => m.role === "system")!.content)
    expect(sys).toContain("你是方案写作助手")
    expect(sys).toContain("测试技能")
    expect(injected.find((m) => m.role === "user")!.content).toBe("请写大纲")
    // 原数组不被就地修改（调用方可能复用）
    expect(msgs[0]!.content).toBe("你是方案写作助手。")
    unregisterScopeSkills(SCOPE, src)
  })

  it("没有 system 消息时在头部补一条（不能把技能块塞进 user）", () => {
    const injected = injectSkillBlock([{ role: "user", content: "U" }], FAKE_BLOCK)
    expect(injected[0]!.role).toBe("system")
    expect(String(injected[0]!.content)).toContain("测试技能")
    expect(injected[1]!.content).toBe("U")
  })

  it("注销后恢复为空，不污染其它 scope（多页面并发注册时互不干扰）", () => {
    const src = makeSource()
    registerScopeSkills(SCOPE, src)
    expect(skillBlockFor(SCOPE)).not.toBe("")
    unregisterScopeSkills(SCOPE, src)
    expect(skillBlockFor(SCOPE)).toBe("")
    expect(skillBlockFor("bid-chapter")).toBe("")
  })

  it("注销只在「同一个 source 实例」时生效（避免 A 页面卸载误删 B 页面刚注册的）", () => {
    const srcA = makeSource("BLOCK-A")
    const srcB = makeSource("BLOCK-B")
    registerScopeSkills(SCOPE, srcA)
    registerScopeSkills(SCOPE, srcB) // B 覆盖 A（后注册者生效）
    expect(skillBlockFor(SCOPE)).toBe("BLOCK-B")
    unregisterScopeSkills(SCOPE, srcA) // 用过期实例注销，不该误删 B
    expect(skillBlockFor(SCOPE)).toBe("BLOCK-B")
    unregisterScopeSkills(SCOPE, srcB)
    expect(skillBlockFor(SCOPE)).toBe("")
  })

  it("空技能块注入是恒等操作（没选技能时不改变请求）", () => {
    const msgs = [{ role: "system", content: "S" }]
    expect(injectSkillBlock(msgs, "")).toBe(msgs)
  })
})
