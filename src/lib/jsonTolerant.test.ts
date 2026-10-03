import { describe, expect, it } from "vitest"
import { escapeControlCharsInStrings, parseJsonTolerant, repairJsonStructure } from "./jsonTolerant"

// R120：AI 生成 JSON 的跨模块容错解析（标书 / 方案 / PPT 共用）此前无独立单测。
// 锁死点：合法 JSON 结果与直接 JSON.parse 完全等价（第一尝试命中，修复级绝不篡改正确数据）；
// 缺省结构修复器能兜住模型被截断（max token 切断）与裸控制字符两类高频脏输出。

describe("escapeControlCharsInStrings", () => {
  it("字符串值内的裸换行/制表符转义为 \\n / \\t", () => {
    const raw = '{"a":"一线\n二线\tb"}'
    const out = escapeControlCharsInStrings(raw)
    expect(out).toBe('{"a":"一线\\n二线\\tb"}')
    expect(() => JSON.parse(out)).not.toThrow()
    expect(JSON.parse(out)).toEqual({ a: "一线\n二线\tb" })
  })

  it("结构区（引号外）的换行/空格原样保留", () => {
    const pretty = '{\n  "a": 1\n}'
    expect(escapeControlCharsInStrings(pretty)).toBe(pretty)
  })

  it("已有合法转义不被二次转义", () => {
    const ok = '{"a":"已转义\\n换行"}'
    expect(escapeControlCharsInStrings(ok)).toBe(ok)
  })

  it("其它 0x00-0x1F 裸字节转 \\uXXXX", () => {
    const out = escapeControlCharsInStrings('{"a":"x\u0001y"}')
    expect(out).toBe('{"a":"x\\u0001y"}')
  })
})

describe("repairJsonStructure", () => {
  it("补全未闭合对象/数组括号（按栈逆序）", () => {
    expect(JSON.parse(repairJsonStructure('{"a":[1,2'))).toEqual({ a: [1, 2] })
  })

  it("去掉 } ] 前的尾逗号", () => {
    expect(repairJsonStructure("{\"x\":1,\"y\":2,}")).toBe('{"x":1,"y":2}')
  })

  it("停在字符串中补闭合引号", () => {
    expect(JSON.parse(repairJsonStructure('{"a":"半截文字'))).toEqual({ a: "半截文字" })
  })

  it("合法 JSON 幂等（结构修复不改变可解析结果）", () => {
    const good = '{"a":[{"b":1}],"c":"d"}'
    expect(JSON.parse(repairJsonStructure(good))).toEqual(JSON.parse(good))
  })
})

describe("parseJsonTolerant", () => {
  it("合法 JSON：第一尝试命中，与 JSON.parse 完全等价", () => {
    const good = '{"a":1,"b":[1,2,3]}'
    expect(parseJsonTolerant(good)).toEqual(JSON.parse(good))
  })

  it("缺省修复：模型被截断的 JSON 也能兜底解析", () => {
    expect(parseJsonTolerant('{"list":[{"n":"甲"},{"n":"乙"}')).toEqual({
      list: [{ n: "甲" }, { n: "乙" }],
    })
  })

  it("缺省修复：尾逗号脏输出可解析", () => {
    expect(parseJsonTolerant('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 })
  })

  it("裸控制字符 + 截断叠加：转义与结构修复组合兜底", () => {
    const dirty = '{"note":"第一行\n第二行\t制表","items":[{"t":"x"'
    expect(parseJsonTolerant(dirty)).toEqual({
      note: "第一行\n第二行\t制表",
      items: [{ t: "x" }],
    })
  })

  it("显式 repair 覆盖缺省（行为与传参一致）", () => {
    let called = 0
    const spy = (s: string) => {
      called++
      return s
    }
    expect(() => parseJsonTolerant("{bad", spy)).toThrow("AI 返回内容不是有效 JSON，请重试")
    expect(called).toBeGreaterThan(0)
  })

  it("彻底乱码：抛可读错误而非裸 SyntaxError", () => {
    expect(() => parseJsonTolerant("完全不是 JSON{{{")).toThrow(
      "AI 返回内容不是有效 JSON，请重试",
    )
  })

  it("数组顶层候选被截断：补闭合括号后解析", () => {
    expect(parseJsonTolerant('[{"a":1},{"b":2},')).toEqual([{ a: 1 }, { b: 2 }])
  })
})
