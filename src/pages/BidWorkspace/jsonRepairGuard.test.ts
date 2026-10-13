import { describe, expect, it } from "vitest"
import { extractJsonCandidate } from "@/lib/jsonTolerant"

// R290：模型返回「散文式推理」而非 JSON 时的处置。
// 本测试锁定的是判定依据 extractJsonCandidate 的行为契约（无 JSON 候选 → 返回 null），
// 以及 withJsonRepair 据此走的「直接抛可读错误、不做无意义语法修复」分支所依赖的前提。
// 不锁定活数据、不锁定具体模型输出。

describe("extractJsonCandidate：无 JSON 时的判定", () => {
  it("纯英文推理散文 → 无候选（实测 bailing/Ling-3.1-flash 的真实输出形态）", () => {
    const prose = `Let me analyze the requirements carefully:

1. **商务部分 (biz)**: 6-10 skeleton chapters with one-level children.
   - 一 投标函
   - 二 服务报价表

Wait, the directory is:
一 投标函
二 服务报价表

响应文件组成：投标函、服务报价表、服务方案。`
    expect(extractJsonCandidate(prose)).toBeFalsy()
  })

  it("空字符串 / 纯空白 → 无候选", () => {
    expect(extractJsonCandidate("")).toBeFalsy()
    expect(extractJsonCandidate("   \n\t  ")).toBeFalsy()
  })

  it("被 markdown 围栏包裹的合法 JSON → 有候选（该情形仍应走语法修复路径）", () => {
    const fenced = '```json\n{"outline":[{"title":"第一章"}]}\n```'
    expect(extractJsonCandidate(fenced)).toBeTruthy()
  })

  it("裸 JSON 数组 → 有候选", () => {
    expect(extractJsonCandidate('[{"title":"第一章"}]')).toBeTruthy()
  })
})

describe("R290 缺陷复现：散文输出喂给 JSON 语法修复必然失败", () => {
  // 实测证据（安庆二院真实招标文件 CG-AQ-2021-5149，2026-10-13）：
  //   首次调用 67774ms → 返回 3000+ 字符英文散文，无任何 JSON
  //   修复调用  1665ms → 返回 226 字节
  //     {"ok":true,"text":"{\"note\":\"原始输出为纯散文式分析文本，不含任何 JSON 结构，
  //      无法在不编造内容的前提下修复为合法 JSON\"}","usage":{"completion_tokens":28}}
  // 最终大纲为空，界面无任何报错。
  // 本测试把「散文里没有 JSON 可修」这一根因固化为可回归的判定。

  it("模型对散文给出的「修复」结果同样不含 JSON —— 二次解析必然再次失败", () => {
    const proseRepairOutput =
      '{"note":"原始输出为纯散文式分析文本，不含任何 JSON 结构，无法在不编造内容的前提下修复为合法 JSON"}'
    // 修复输出本身是一个 note 包裹的 JSON，不是 outline 数组/对象
    const candidate = extractJsonCandidate(proseRepairOutput)
    expect(candidate).toBeTruthy() // 确实有 JSON
    const parsed = JSON.parse(candidate as string)
    // 但既没有 outline 也没有 chapters → parseOutlineJson 会抛「大纲格式解析失败」
    expect(Array.isArray(parsed.outline)).toBe(false)
    expect(Array.isArray(parsed.chapters)).toBe(false)
    // 故：把散文喂修复器这条路在原理上就产不出可用大纲，必须在源头拦截
  })
})
