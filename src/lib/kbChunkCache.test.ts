// R87 回归：chunkKbDoc 缓存失效 + slim→全文补拉后检索恢复。
// 背景：slim 列表 content 为空串，loadDocContent 补拉正文回填时 updated 不变；
// 旧缓存只校验 updated → 空 chunks 永久缓存 → 文档静默退出全文检索（知识库问答 0/20 评测坐实）。
import { describe, expect, it } from "vitest"

import { chunkKbDoc, searchKbDocs, type KbDocRow } from "@/lib/kbCore"

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
