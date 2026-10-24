// R87 回归：chunkKbDoc 缓存失效 + slim→全文补拉后检索恢复。
// 背景：slim 列表 content 为空串，loadDocContent 补拉正文回填时 updated 不变；
// 旧缓存只校验 updated → 空 chunks 永久缓存 → 文档静默退出全文检索（知识库问答 0/20 评测坐实）。
import { describe, expect, it } from "vitest"

import { chunkEntriesOf, chunkKbDoc, searchKbDocs, type KbDocRow } from "@/lib/kbCore"

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

describe("chunkKbDoc 缓存失效（R87）", () => {
  it("content 空→非空且 updated 不变：重新切块，全文检索可召回", () => {
    const slim = mkDoc("cache-inv-1", "")
    expect(chunkKbDoc(slim)).toHaveLength(0)
    // 模拟 loadDocContent 补拉后回填：同一 id、同一 updated，content 出现正文
    const full = mkDoc("cache-inv-1", "急性胰腺炎患者的肠内营养支持路径与监测要点详细说明")
    expect(chunkKbDoc(full).length).toBeGreaterThan(0)
    const hits = searchKbDocs([full], "肠内营养支持", 5)
    expect(hits.some((h) => h.doc.id === "cache-inv-1")).toBe(true)
  })

  it("content 与 updated 均未变：复用缓存（同一 chunks 引用）", () => {
    const d = mkDoc("cache-hit-1", "静脉血栓栓塞症的风险评估与预防护理流程标准化文件汇编")
    const a = chunkKbDoc(d)
    const b = chunkKbDoc({ ...d })
    expect(a).toBe(b)
  })

  it("updated 变化：重切块（原有语义不回退）", () => {
    const d1 = mkDoc("cache-upd-1", "第一段正文关于糖尿病随访管理的要点")
    chunkKbDoc(d1)
    const d2 = { ...d1, updated: "2026-02-02 00:00:00", content: "重写后的正文关于高血压分级诊疗路径" }
    expect(chunkKbDoc(d2)).not.toBe(chunkKbDoc(d1))
  })
})

describe("chunkEntriesOf 预小写条目缓存（A0）", () => {
  it("与 chunkKbDoc 同源缓存：重复调用返回同一 entries 引用，chunk 引用也一致", () => {
    const d = mkDoc("entries-hit-1", "## 标题A\n电子病历五级评审的核心要求与准备要点正文")
    const a = chunkEntriesOf(d)
    const b = chunkEntriesOf({ ...d })
    expect(b).toBe(a)
    expect(a[0].chunk).toBe(chunkKbDoc(d)[0])
  })

  it("lowerText/dl 预计算正确（小写化；dl 取小写后长度且 ≥1）", () => {
    const d = mkDoc("entries-lower-1", "包含English Words与大写ABC的正文内容")
    const entries = chunkEntriesOf(d)
    for (const e of entries) {
      expect(e.lowerText).toBe(e.chunk.text.toLowerCase())
      expect(e.lowerHeading).toBe((e.chunk.headingPath ?? "").toLowerCase())
      expect(e.dl).toBe(Math.max(1, e.chunk.text.toLowerCase().length))
    }
  })

  it("slim→全文回填（R87 场景）对 entries 同样生效", () => {
    const slim = mkDoc("entries-inv-1", "")
    expect(chunkEntriesOf(slim)).toHaveLength(0)
    const full = mkDoc("entries-inv-1", "补拉回填后的静脉血栓栓塞症预防护理正文")
    expect(chunkEntriesOf(full).length).toBeGreaterThan(0)
  })
})
