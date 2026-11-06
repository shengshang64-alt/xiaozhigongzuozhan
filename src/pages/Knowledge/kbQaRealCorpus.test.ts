/**
 * R3（整仓重构 · 半残主链路收口）**真实语料命中率探针**：知识问答到底能不能命中。
 *
 * 为什么必须是真实库、而不是合成夹具：
 *   M0 §1.2 记的半残事实「知识问答『有要点说找不到』」——`searchKbDocs` 是纯函数，
 *   命中率完全取决于**真实语料 + 真实问法**。合成夹具只能证明「算法按预期跑」，
 *   证明不了「用户问一句话能不能查到」。
 *
 * 为什么放在 vitest 而不是独立脚本：
 *   本仓 `@/` 别名只由 vite/vitest 解析，`node xxx.mjs` 直接跑会被 aliased import 拦死。
 *   既有 `*RealDb.test.ts` 一族都是这个形态：**只打印数字、只断言不变量**。
 *
 * 读库方式：只读打开 `pocketbase/pb_data/data.db`（node:sqlite），
 * 与正在运行的 PocketBase 并存（readOnly 不会抢写锁）。
 * 读不到 → skip，不红；这是既有 `realDbFixture.ts` 定下的口径（「读不到 ≠ 没有」）。
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { searchKbDocs, type KbDocRow } from "@/lib/kbCore"

const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))

let docs: KbDocRow[] = []
try {
  if (existsSync(DB_PATH)) {
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    const rows = db.prepare("select id, title, content, folder_path, visibility from kb_docs").all() as {
      id: string
      title: string
      content: string
      folder_path: string
      visibility: string
    }[]
    docs = rows
      .filter((r) => (r.content ?? "").trim().length > 0)
      .map((r) => ({
        id: r.id,
        rh_user_id: "local-user",
        title: r.title ?? "",
        folder_path: r.folder_path ?? "/",
        content: r.content ?? "",
        doc_format: "",
        visibility: r.visibility ?? "team",
        summary: "",
        keywords: [],
        source_file_name: "",
        uploader_name: "",
        created: "",
        updated: "",
      }))
    db.close()
  }
} catch (e) {
  // 读不到 ≠ 没有：只提示并让下面的 describe.skipIf 跳过，绝不让测试红
  // （与 src/pages/BidWorkspace/realDbFixture.ts 的既有口径一致）
  console.warn(`[kbQaRealCorpus] 读库失败（本轮跳过，非缺陷）：${e instanceof Error ? e.message : String(e)}`)
}

const HAS_CORPUS = docs.length > 0

/**
 * 典型问法（不是关键词堆）：覆盖制度 / 技术 / 操作 / 精确术语四类，
 * 都是售前在写方案与标书时真的会问的句子。
 */
const QUESTIONS = [
  "文档编辑有什么规范要求",
  "公司文档的字体字号怎么规定",
  "评审流程分几个阶段",
  "投标文件制作有哪些注意事项",
  "系统架构怎么描述",
  "数据备份多久做一次",
  "哪些情况需要走审批",
  "编制依据包括哪些标准",
]

describe.skipIf(!HAS_CORPUS)("知识问答 · 真实语料命中率（R3 验收：已入库要点问得到）", () => {
  it(
    "典型问法整体命中率不低于 60%（低于此值说明检索对真实问法失效，而不是『库里没有』）",
    () => {
      const results = QUESTIONS.map((q) => ({ q, hits: searchKbDocs(docs, q, 5) }))
      const hit = results.filter((r) => r.hits.length > 0).length
      for (const r of results) {
        console.log(`${r.hits.length ? "✓" : "✗"} 「${r.q}」→ ${r.hits.length} 篇` + (r.hits[0] ? `：首条《${r.hits[0].doc.title}》` : ""))
      }
      console.log(`语料：${docs.length} 篇含正文；命中 ${hit}/${QUESTIONS.length}`)
      // 口径说明：这条断言的是「检索对真实问法有反应」，不是「每问必中」。
      // 60% 是实测基线（本轮现场跑出来的数字见报告），低于它说明算法退化了。
      expect(hit / QUESTIONS.length).toBeGreaterThanOrEqual(0.6)
    },
    // 7004 篇语料的 IDF 统计 + 8 次检索实测约 33s（沙盒 2 核）；默认 5s 会假红。
    120_000,
  )

  it("命中的每一条都必须带可追溯的出处（标题非空 + 有片段或偏移）", () => {
    for (const q of QUESTIONS.slice(0, 4)) {
      for (const h of searchKbDocs(docs, q, 5)) {
        expect(h.doc.title.trim().length, `命中缺少标题：${q}`).toBeGreaterThan(0)
        const traceable = (h.snippet ?? "").trim().length > 0 || typeof h.chunkStart === "number"
        expect(traceable, `命中缺少可追溯片段：${q} / ${h.doc.title}`).toBe(true)
      }
    }
  })

  it(
    "问一句完全无关的话：首条命中必须是弱相关，不能把「凑巧有共同字」当成答案",
    () => {
      // 这条不是「必须 0 命中」——实测 corpus 里 7000 篇标书，「保修」「条款」这类词
      // 到处都是，纯词面检索一定会带回某篇（第一版写成 toEqual([])，跑出 8 篇，
      // 恰恰证明「0 命中」这个期望本身是错的假设）。真正该守的是：**能不能区分强弱**。
      const realFirst = searchKbDocs(docs, "文档编辑有什么规范要求", 5)[0]?.score ?? 0
      const nonsenseHits = searchKbDocs(docs, "量子纠缠咖啡机保修条款", 5)
      if (nonsenseHits.length) {
        expect(realFirst, "无关问题的首条分数不应高于真实问法").toBeGreaterThan(nonsenseHits[0].score)
      }
    },
    60_000,
  )
})

describe.skipIf(!HAS_CORPUS)("知识问答 · 未命中与「库里没有」必须可区分（阶段 1 包 3 口径的延续）", () => {
  it("语料非空时，空问题返回空结果（不抛错、不瞎命中）", () => {
    expect(searchKbDocs(docs, "", 5)).toEqual([])
  })
})
