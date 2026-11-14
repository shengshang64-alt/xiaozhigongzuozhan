import {
  maskInstitutionName,
  type ModuleChapterDraft,
  type StandardChapterPreview,
} from "@/pages/SolutionStudio/standardChapters"
import type { SlidePlan } from "./pptQuoteTypes"
import type { SourceRefZ } from "./deckSchema"

// ---------------------------------------------------------------------------
// 把 t142 标准章节预览整理成 PPT SlidePlan。纯函数、零模型。
// 已整理 / 素材偏少：只用章节里已有的标题、要点和来源，不编造。
// 缺项：单独成页并标缺，正文只说明需补齐素材，禁止当作可送给模型的内容。
// ---------------------------------------------------------------------------

export const GAP_SLIDE_BODY =
  "知识库暂无足够依据，需补齐素材后再生成该页。未用模型编造正文。"

const MAX_BULLETS = 6
const MAX_BULLET_CHARS = 80
const MAX_REFS = 8

export function isGapSlidePlan(plan: Pick<SlidePlan, "title" | "gap"> | null | undefined): boolean {
  if (!plan) return false
  if (plan.gap) return true
  return /缺项/.test(plan.title || "")
}

/** 从章节正文/来源抽出要点，只用已有句子，不另写新意。 */
export function bulletsFromChapter(mod: ModuleChapterDraft, max = MAX_BULLETS): string[] {
  const raw: string[] = []
  for (const s of mod.sources ?? []) {
    const text = maskInstitutionName((s.body || s.quote || "").replace(/\s+/g, " ").trim())
    if (text.length >= 8) raw.push(text)
  }
  if (!raw.length && mod.body) {
    for (const line of mod.body.split(/\n+/)) {
      const t = maskInstitutionName(line.replace(/^（来源\s*\d+）/, "").replace(/^【.*?】/, "").trim())
      if (t.length >= 8 && !t.startsWith("资料来源")) raw.push(t)
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const bullet = t.length > MAX_BULLET_CHARS ? t.slice(0, MAX_BULLET_CHARS).trimEnd() + "…" : t
    if (seen.has(bullet)) continue
    seen.add(bullet)
    out.push(bullet)
    if (out.length >= max) break
  }
  return out
}

function refsFromChapter(mod: ModuleChapterDraft): SourceRefZ[] {
  const refs: SourceRefZ[] = []
  for (const s of mod.sources ?? []) {
    const chunkId = (s.id || s.anchor || s.title || `src-${refs.length + 1}`).slice(0, 120)
    if (!chunkId) continue
    refs.push({
      chunkId,
      materialName: maskInstitutionName(s.docName || s.title || "").slice(0, 200),
      excerpt: maskInstitutionName((s.body || s.quote || "").replace(/\s+/g, " ").trim()).slice(0, 400),
      kind: "content",
    })
    if (refs.length >= MAX_REFS) break
  }
  return refs
}

function safeId(prefix: string, key: string, idx: number): string {
  const raw = `${prefix}-${key || idx}`.replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 40)
  return raw || `${prefix}-${idx}`
}

export function defaultPptTopic(title?: string): string {
  const t = maskInstitutionName((title || "").trim())
  return t || "建设清单汇报"
}

export function standardChaptersToDeckPlan(
  preview: StandardChapterPreview,
  opts?: { topic?: string },
): { topic: string; plan: SlidePlan[] } {
  const topic = defaultPptTopic(opts?.topic || preview?.title)
  const plan: SlidePlan[] = [
    {
      id: "cover",
      title: topic,
      intent: "建设清单汇报封面",
      kind: "cover",
    },
  ]
  const modules = preview?.modules ?? []
  if (modules.length) {
    plan.push({
      id: "agenda",
      title: "建设内容大纲",
      intent: modules.map((m) => m.moduleTitle).join("、").slice(0, 200),
      kind: "agenda",
    })
  }
  modules.forEach((mod, idx) => {
    if (mod.status === "missing") {
      plan.push({
        id: safeId("gap", mod.moduleKey, idx),
        title: `${mod.moduleTitle}（缺项）`,
        intent: (mod.gapReason || GAP_SLIDE_BODY).slice(0, 200),
        kind: "bullets",
        gap: true,
      })
      return
    }
    const bullets = bulletsFromChapter(mod)
    const refs = refsFromChapter(mod)
    plan.push({
      id: safeId("mod", mod.moduleKey, idx),
      title: mod.moduleTitle || `模块 ${idx + 1}`,
      intent: (bullets[0] || "根据已审核素材整理的模块要点").slice(0, 200),
      kind: "bullets",
      ...(refs.length ? { sourceRefs: refs } : {}),
    })
  })
  return { topic, plan }
}
