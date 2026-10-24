// A1：IDF 持久化的纯函数口径——peek 只读不构建 / seed 仅注入不覆盖 / 脏值防御。
// 配对消费方：useKnowledge（快照载入 seed、检索后 peek 落库）。
import { describe, expect, it } from "vitest"
import { peekIdf, searchKbDocs, seedIdf, type KbDocRow } from "@/lib/kbCore"

const BASE = {
  rh_user_id: "u1",
  folder_path: "",
  doc_format: "md",
  visibility: "team",
  summary: "",
  source_file_name: "",
  uploader_name: "",
  created: "2026-01-01 00:00:00",
  updated: "2026-01-01 00:00:00",
  keywords: [],
  doc_category: "",
}

function mkDoc(id: string, content: string): KbDocRow {
  return { ...BASE, id, title: `文档${id}`, content } as unknown as KbDocRow
}

describe("peekIdf / seedIdf（A1）", () => {
  it("peek：未构建返回 null（绝不触发构建）；构建后可取回且与检索一致", () => {
    const docs = [mkDoc("i1", "电子病历分级评价的标准要求与评审要点"), mkDoc("i2", "互联互通测评的交互规范")]
    expect(peekIdf(docs)).toBeNull()
    searchKbDocs(docs, "电子病历评审要点", 5) // 触发构建
    const snap = peekIdf(docs)
    expect(snap).not.toBeNull()
    expect(snap!.N).toBe(2)
    // 不锁分词器内部形态，只锁「df 非空且条目形态正确」
    expect(snap!.df.length).toBeGreaterThan(0)
    expect(snap!.df.every(([tok]) => typeof tok === "string")).toBe(true)
    expect(snap!.df.every(([, n]) => n >= 1 && n <= 2)).toBe(true)
  })

  it("seed：注入后同数组检索不再重建（peek 引用命中），且不覆盖已存在的缓存", () => {
    const a = [mkDoc("s1", "静脉血栓栓塞症的预防护理流程")]
    const b = [mkDoc("s1", "静脉血栓栓塞症的预防护理流程")]
    searchKbDocs(a, "预防护理", 5)
    const fromA = peekIdf(a)
    expect(fromA).not.toBeNull()
    // b 数组 seed 自 a 的快照
    expect(seedIdf(b, fromA!)).toBe(true)
    expect(peekIdf(b)).not.toBeNull()
    // 再 seed 不同值：不覆盖（幂等保护）
    expect(seedIdf(b, { N: 999, df: [["x", 1]] })).toBe(true)
    expect(peekIdf(b)!.N).toBe(fromA!.N)
  })

  it("seed：脏值整体拒绝（N 非数 / df 非数组 / 空映射）", () => {
    const docs = [mkDoc("d1", "内容")]
    expect(seedIdf(docs, { N: "x" as unknown as number, df: [] })).toBe(false)
    expect(seedIdf(docs, { N: 1, df: "no" as unknown as [] })).toBe(false)
    expect(seedIdf(docs, { N: 1, df: [[123, 1] as unknown as [string, number]] })).toBe(false) // 全脏条目→空映射
    expect(peekIdf(docs)).toBeNull()
    // 部分脏条目：好条目保留
    expect(seedIdf(docs, { N: 1, df: [["好词", 2], [null as unknown as string, 3]] })).toBe(true)
    expect(peekIdf(docs)!.df).toEqual([["好词", 2]])
  })
})
