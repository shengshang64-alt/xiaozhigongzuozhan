// A1/A2：QA 语料快照的纯函数口径——游标计算/新鲜度判定/增量合并（IO 层不进单测，浏览器 E2E 覆盖）。
import { describe, expect, it } from "vitest"
import { computeCorpusCursor, isCorpusFresh } from "@/lib/kbDocCache"
import { mergeCorpusRows, type KbDocRow } from "@/lib/kbCore"

function row(id: string, updated: string, title = `文档${id}`): KbDocRow {
  return { id, updated, title } as unknown as KbDocRow
}

describe("computeCorpusCursor（A1）", () => {
  it("取最大 updated（时间序比较，非字典序陷阱）", () => {
    const docs = [
      { updated: "2026-10-24 10:00:00.000Z" },
      { updated: "2026-11-02 08:00:00.000Z" }, // 月份更大但字典序更小（"11" < "2..."）
      { updated: "2026-09-15 12:00:00.000Z" },
    ]
    expect(computeCorpusCursor(docs)).toBe("2026-11-02 08:00:00.000Z")
  })
  it("空语料 / 全空 updated → 空串", () => {
    expect(computeCorpusCursor([])).toBe("")
    expect(computeCorpusCursor([{ updated: "" }, { updated: undefined as unknown as string }])).toBe("")
  })
  it("非法时间回退字典序，且不覆盖已命中的时间戳最大值", () => {
    expect(computeCorpusCursor([{ updated: "not-a-date-zzz" }, { updated: "not-a-date-aaa" }])).toBe("not-a-date-zzz")
    expect(computeCorpusCursor([{ updated: "not-a-date-zzz" }, { updated: "2026-01-01 00:00:00.000Z" }])).toBe(
      "2026-01-01 00:00:00.000Z",
    )
  })
})

describe("isCorpusFresh（A1）", () => {
  it("游标一致 → 新鲜；不一致 → 失效", () => {
    expect(isCorpusFresh("2026-10-24 10:00:00.000Z", "2026-10-24 10:00:00.000Z")).toBe(true)
    expect(isCorpusFresh("2026-10-24 10:00:00.000Z", "2026-10-25 09:00:00.000Z")).toBe(false)
  })
  it("双方皆空（空库对空库）→ 新鲜；一方有一方无 → 失效", () => {
    expect(isCorpusFresh("", "")).toBe(true)
    expect(isCorpusFresh("2026-10-24 10:00:00.000Z", "")).toBe(false)
    expect(isCorpusFresh("", "2026-10-24 10:00:00.000Z")).toBe(false)
  })
})

describe("mergeCorpusRows 增量合并（A2）", () => {
  it("已有 id 整行替换（取最新版），新 id 追加，未提及的保留", () => {
    const local = [row("a", "t1", "旧A"), row("b", "t1", "B")]
    const merged = mergeCorpusRows(local, [row("a", "t2", "新A"), row("c", "t2", "C")])
    expect(merged).toHaveLength(3)
    expect(merged.find((d) => d.id === "a")?.title).toBe("新A")
    expect(merged.find((d) => d.id === "a")?.updated).toBe("t2")
    expect(merged.find((d) => d.id === "b")?.title).toBe("B")
    expect(merged.find((d) => d.id === "c")?.title).toBe("C")
  })
  it("incoming 为空 → 原样返回同一引用（不触发语料重建）", () => {
    const local = [row("a", "t1")]
    expect(mergeCorpusRows(local, [])).toBe(local)
  })
  it("返回新数组引用（供 scopeDocs 记忆化按新语料失效）", () => {
    const local = [row("a", "t1")]
    expect(mergeCorpusRows(local, [row("a", "t2")])).not.toBe(local)
  })
  it("P1-4 墓碑：incoming 行带 deleted_at → 该 id 从语料移除（删除经增量传播）", () => {
    const local = [row("a", "t1", "A"), row("b", "t1", "B")]
    const tombstone = { ...row("a", "t2", "A"), deleted_at: "2026-10-25 01:00:00.000Z" }
    const merged = mergeCorpusRows(local, [tombstone] as unknown as KbDocRow[])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe("b")
  })
  it("P1-4：墓碑行 id 不在语料中 → 仍返回等价语料", () => {
    const local = [row("b", "t1")]
    const merged = mergeCorpusRows(local, [{ ...row("zz", "t2"), deleted_at: "x" } as unknown as KbDocRow])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe("b")
  })
})
