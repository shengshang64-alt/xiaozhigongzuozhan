import { describe, expect, it } from "vitest"
import { decideOutlineDraft, sameOutline } from "./outlineDraft"

const OUTLINE_A = [
  { id: "n1", title: "第1章 总体方案", children: [{ id: "n1-1", title: "1.1 架构", children: [] }] },
  { id: "n2", title: "第2章 实施", children: [] },
]
// 深拷贝后改一个标题：模拟「重新生成 / 手改过、还没确认」的那一份
const OUTLINE_B = JSON.parse(JSON.stringify(OUTLINE_A)) as typeof OUTLINE_A
OUTLINE_B[0]!.title = "第1章 总体技术方案（改）"

describe("sameOutline", () => {
  it("同内容同序判等（含嵌套）", () => {
    expect(sameOutline(OUTLINE_A, JSON.parse(JSON.stringify(OUTLINE_A)))).toBe(true)
  })
  it("改一个标题即不等", () => {
    expect(sameOutline(OUTLINE_A, OUTLINE_B)).toBe(false)
  })
  it("空值归一：null / undefined / [] 互相判等", () => {
    expect(sameOutline(null, [])).toBe(true)
    expect(sameOutline(undefined, [])).toBe(true)
    expect(sameOutline([], null)).toBe(true)
  })
})

describe("decideOutlineDraft：打开项目时恢复还是清草稿", () => {
  it("没有草稿 → none（不动内存）", () => {
    expect(decideOutlineDraft(null, OUTLINE_A)).toBe("none")
    expect(decideOutlineDraft(undefined, null)).toBe("none")
    expect(decideOutlineDraft([], OUTLINE_A)).toBe("none")
  })

  it("库里无大纲 + 有草稿 → restore（2026-11-03 起的老行为，必须保持）", () => {
    expect(decideOutlineDraft(OUTLINE_A, [])).toBe("restore")
    expect(decideOutlineDraft(OUTLINE_A, null)).toBe("restore")
  })

  it("草稿与库里大纲完全一致 → clear（已入库，草稿是残渣）", () => {
    expect(decideOutlineDraft(OUTLINE_A, JSON.parse(JSON.stringify(OUTLINE_A)))).toBe("clear")
  })

  // ↓↓ 本条即 2026-11-04 修的缺陷：旧实现这里走 else 分支把草稿删掉 ↓↓
  it("库里有旧大纲 + 草稿是新的未确认稿 → restore（不能当残渣删掉）", () => {
    expect(decideOutlineDraft(OUTLINE_B, OUTLINE_A)).toBe("restore")
  })

  it("库里有大纲、草稿更短（用户删了章还没确认）→ 仍然 restore", () => {
    expect(decideOutlineDraft([OUTLINE_A[0]], OUTLINE_A)).toBe("restore")
  })

  it("脏数据不崩：非数组一律当没有草稿", () => {
    expect(decideOutlineDraft("不是数组" as unknown as unknown[], OUTLINE_A)).toBe("none")
    expect(decideOutlineDraft({ a: 1 } as unknown as unknown[], OUTLINE_A)).toBe("none")
  })
})
