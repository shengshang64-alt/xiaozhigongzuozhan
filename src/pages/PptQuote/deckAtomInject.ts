// ---------------------------------------------------------------------------
// PPT 页面级知识原子注入（2026-11-02）
//
// 背景（真实缺口）：
//   PPT 生成的素材来源只有**用户上传的文件**（deckMaterialStore.addMaterialFiles），
//   知识库里 8130 条已审核原子对 PPT 完全不可用。
//   实测：`src/pages/PptQuote/` 下没有任何一处调用 kbAtomAssemble / searchAtoms。
//
// 为什么必须接：
//   用户最初反馈就是「PPT 没有内容、没有配图」。产品能力类原子
//   （5000 条，占原子库 61%）正是 PPT 内容页的核心素材——
//   讲产品不讲能力讲什么。
//
// 设计要点：
//   · 与已有的「用户上传素材」**并存**（不替代）：上传的优先，原子补充
//   · 异步批量检索（一次规划里同一 deck 的所有页并发查，而不是逐页串行）
//   · 只注 2 条/页（页面篇幅有限，多了会挤占）
//   · 走服务端硬门禁（approved + 有效期 + 密级），前端不做二次判断
// ---------------------------------------------------------------------------

import { searchAtoms, type AtomHit } from "@/pages/Knowledge/kbAtomSearch"

/** 页面规划的最小字段（与 SlidePlan 兼容） */
export type PageForAtom = {
  title: string
  intent?: string
  kind?: string
}

/** 注入结果：页码/标题 → 该页的原子 */
export type PageAtomMap = Map<string, AtomHit[]>

export type AttachAtomsOptions = {
  /** 每页最多注入几条原子（默认 2） */
  topK?: number
  /** 最多并发查询数（默认 4，避免打爆网关） */
  concurrency?: number
  /** 密级上限 */
  confidentialityMax?: "public" | "internal" | "client_only" | "secret"
}

/** 把页面规划拼成检索语句：标题 + 意图 */
function queryOf(p: PageForAtom): string {
  return [p.title, p.intent].filter(Boolean).join(" ").slice(0, 200)
}

/**
 * 为整套 deck 的每一页检索知识原子。
 *
 * 返回 Map（key = 页面标题），调用方按标题取。用标题而非索引起键：
 * 页面可能被重排/增删，标题更稳定。
 */
export async function fetchAtomsForPages(
  userId: string | null,
  pages: PageForAtom[],
  opts?: AttachAtomsOptions,
): Promise<PageAtomMap> {
  const map: PageAtomMap = new Map()
  if (!userId || !pages.length) return map

  const topK = Math.max(1, Math.min(opts?.topK ?? 2, 5))
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8))

  // 只对需要内容素材的页面检索：cover/section 这类封面页通常不需要 （但保留是因为
  // 有时封面要写项目名/规模，实测注入原子后标题更具体）
  const targets = pages.filter((p) => String(p.title ?? "").trim().length >= 2)

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (page) => {
        try {
          const res = await searchAtoms(userId, {
            query: queryOf(page),
            usableFor: "ppt",
            topN: topK,
            ...(opts?.confidentialityMax ? { confidentialityMax: opts.confidentialityMax } : {}),
          })
          return { title: page.title, hits: res.hits }
        } catch {
          // 单页检索失败不影响其他页（PPT 生成不能因知识库抖动而中断）
          return { title: page.title, hits: [] as AtomHit[] }
        }
      }),
    )
    for (const r of results) if (r.hits.length) map.set(r.title, r.hits)
  }
  return map
}

/**
 * 把原子渲染成给模型的素材文本块。
 *
 * 措辞与 deckMaterials 的素材块保持一致风格（「来源 · 段落」可追溯），
 * 但标注为「已审核知识原子」，让模型知道这是可放心引用的口径。
 */
export function atomsToMaterialBlock(hits: AtomHit[]): string {
  if (!hits.length) return ""
  return hits
    .map((h) => {
      const src = h.docName ? `（来源：${h.docName}）` : ""
      return `- ${h.title}${src}\n  ${h.body}`
    })
    .join("\n")
}

/** 统计：哪些页拿到了原子（供界面/日志展示） */
export function summarizePageAtoms(map: PageAtomMap): {
  pagesWithAtoms: number
  totalAtoms: number
  byType: Record<string, number>
} {
  const byType: Record<string, number> = {}
  let totalAtoms = 0
  for (const hits of map.values()) {
    for (const h of hits) {
      totalAtoms += 1
      byType[h.atomType] = (byType[h.atomType] ?? 0) + 1
    }
  }
  return { pagesWithAtoms: map.size, totalAtoms, byType }
}

/**
 * 按项目级检索原子（用于素材读取阶段）。
 *
 * 与 fetchAtomsForPages 的区别：这里还不知道 deck 有哪些页（大纲是后续才生成的），
 * 所以先用项目名 + 几个通用主题打底，逐页检索留到 buildMessages 里按页补。
 */
export async function fetchAtomsForProject(
  userId: string | null,
  projectName: string,
): Promise<PageAtomMap> {
  const map: PageAtomMap = new Map()
  if (!userId) return map
  const probes = [
    { title: projectName, intent: "项目名称与建设内容" },
    { title: `${projectName} 总体技术架构`, intent: "技术方案与产品能力" },
    { title: `${projectName} 评级能力`, intent: "电子病历与互联互通评级" },
    { title: `${projectName} 实施运维`, intent: "实施计划与运维服务" },
    { title: `${projectName} 安全保障`, intent: "安全体系与等保合规" },
  ]
  const results = await Promise.all(
    probes.map(async (p) => {
      try {
        const res = await searchAtoms(userId, { query: `${p.title} ${p.intent}`, usableFor: "ppt", topN: 3 })
        return { title: p.title, hits: res.hits }
      } catch {
        return { title: p.title, hits: [] as AtomHit[] }
      }
    }),
  )
  for (const r of results) if (r.hits.length) map.set(r.title, r.hits)
  return map
}

/**
 * 按页组装 ctx：base 素材 + **该页自己的**原子。
 *
 * 2026-11-03 改造要点：原子不再平铺进共用素材，而是按页标题匹配。
 * 匹配策略：先精确命中同一标题，退而求其次按页标题关键词在已检索原子标题里找相似项
 * （避免「页标题被模型改过」时完全拿不到原子）。
 */
export function withPageAtoms<T extends { materialText: string }>(
  ctx: T,
  baseMaterial: string,
  atoms: PageAtomMap,
  pageTitle: string,
): T {
  const own = atoms.get(pageTitle)
  if (own?.length) {
    const block = atomsToMaterialBlock(own)
    if (block) {
      return {
        ...ctx,
        materialText: `${baseMaterial}\n\n【本页可用知识原子（我方真实能力，优先引用）】\n${block}`,
      }
    }
  }
  // 兜底：按页标题与原子标题的 bigram 相似度挑 2 条最相关
  const all = [...atoms.values()].flat()
  if (!all.length) return { ...ctx, materialText: baseMaterial }
  const target = bigramSet(pageTitle)
  const scored = all
    .map((h) => {
      const s = bigramSet(`${h.title} ${h.body}`)
      let hit = 0
      for (const g of target) if (s.has(g)) hit += 1
      return { h, score: target.size ? hit / target.size : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  if (!scored.length) return { ...ctx, materialText: baseMaterial }
  const block = atomsToMaterialBlock(scored.map((x) => x.h))
  return {
    ...ctx,
    materialText: `${baseMaterial}\n\n【本页可用知识原子（我方真实能力，优先引用）】\n${block}`,
  }
}

/** 简易 bigram 集合（与校验脚本同口径） */
function bigramSet(s: string): Set<string> {
  const t = String(s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
  const out = new Set<string>()
  for (let i = 0; i + 2 <= t.length; i += 1) out.add(t.slice(i, i + 2))
  return out
}
