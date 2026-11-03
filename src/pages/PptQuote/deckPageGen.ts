// ---------------------------------------------------------------------------
// 逐页生成器（2026-10-30）
//
// 为什么单独立这个文件：
//   `usePptQuote.ts` 已经 99KB，不宜再塞大段生成逻辑；且这个模块是**纯逻辑**，
//   不依赖 React，可以直接单测（页面级重试、Schema 校验、并发控制都能断言）。
//
// 解决的三个原有缺陷：
//   ① 原实现 8 页/批，一页坏整批重试 → 现改为按页独立生成与重试；
//   ② 原实现只手写容错解析，非法字段被静默吞掉 → 现改为 Zod 校验后再入编辑器；
//   ③ 原实现 batch 覆盖不全（模型少返回就少页）→ 现以大纲为准逐页对齐，
//      缺页补占位，不会整段丢失。
// ---------------------------------------------------------------------------

import type { LlmMessage } from "@/lib/llm"
import type { Slide, SlidePlan } from "./pptQuoteTypes"
import { normalizeSlides } from "./pptQuoteTypes"
import { safeParse, SlideContentListSchema, type SlideContentZ } from "./deckSchema"

export type PageGenResult =
  | { plan: SlidePlan; slide: Slide; attempts: number }
  | { plan: SlidePlan; slide: null; error: string; attempts: number }

export type PageGenOptions = {
  plan: SlidePlan[]
  /** 全册标题（传给提示词做上下文） */
  allTitles: string[]
  /** 并发页数；默认 2（本地模型网关限流较严，>2 容易 429） */
  concurrency?: number
  /** 单页尝试上限（含首试）；默认 2 */
  maxAttempts?: number
  /** 构造单页提示词 */
  buildMessages: (plan: SlidePlan) => LlmMessage[]
  /** 调用模型（由调用方注入，便于测试替身） */
  callLlm: (messages: LlmMessage[]) => Promise<string>
  /** 进度回调：done=已完成页数；retrying=本次是否为重试 */
  onProgress?: (done: number, total: number, title: string, retrying: boolean) => void
}

/** 简易并发池：保持顺序，逐页独立，单页异常不影响其他页 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 把「单页内容 JSON」转成编辑器使用的 Slide。
 *
 * 关键：**以大纲的 kind 为准**（问题 3 要求的"kind 不得被模型改回 bullets"）。
 * 如果模型返回的 kind 与大纲不一致，以大纲为准并记录到 pendingFields，
 * 这样用户能在页面上看到"这页模型想改类型但被拦下了"。
 */
export function contentToSlide(content: SlideContentZ, plan: SlidePlan): Slide {
  const kindMismatch = content.kind !== plan.kind
  // 组装成 normalizeSlides 认识的结构（保持单一转换入口，避免两套映射逻辑）
  const raw = {
    title: content.title || plan.title,
    bullets: content.bullets ?? [],
    notes: content.notes ?? "",
    role: content.role ?? plan.role,
    chart: content.chart ?? null,
    kpi: content.kpi ?? null,
    ...(content.table
      ? {
          figures: [
            {
              type: "table" as const,
              title: content.title.slice(0, 20),
              columns: content.table.columns,
              rows: content.table.rows,
              variant: content.table.variant,
            },
          ],
        }
      : {}),
    ...(content.flow
      ? { figures: [{ type: "flow" as const, title: content.title.slice(0, 20), steps: content.flow.steps, ...(content.flow.branches ? { branches: content.flow.branches } : {}) }] }
      : {}),
    ...(content.architecture
      ? {
          figures: [
            {
              type: "architecture" as const,
              title: content.title.slice(0, 20),
              layers: content.architecture.layers,
              ...(content.architecture.crossCutting ? { crossCutting: content.architecture.crossCutting } : {}),
            },
          ],
        }
      : {}),
    ...(content.imageHint ? { imageHint: content.imageHint } : {}),
  }
  const [slide] = normalizeSlides([raw], [plan])
  const extraPending = kindMismatch ? [`原计划为 ${plan.kind}，模型返回 ${content.kind}，已按大纲渲染`] : []
  return {
    ...slide,
    // 用大纲的 kind 推导布局（renderContent 侧按 layout 分流）
    layout: layoutOfKind(plan.kind),
    ...(plan.sourceRefs?.length ? { sourceRefs: plan.sourceRefs } : {}),
    ...(content.pendingFields?.length || extraPending.length
      ? { pendingFields: [...(content.pendingFields ?? []), ...extraPending].slice(0, 10) }
      : {}),
  }
}

/** kind → 渲染布局（与 deckExports 的 renderContentSlide 分流对齐） */
export function layoutOfKind(kind: SlidePlan["kind"]): Slide["layout"] {
  switch (kind) {
    case "cover":
    case "agenda":
      return "bullets"
    case "section":
      return "section"
    case "kpi":
      return "kpi"
    case "chart":
      return "chart"
    case "table":
    case "flow":
    case "architecture":
      return "image-right"
    case "image":
      return "image-right"
    case "summary":
      return "bullets"
    default:
      return "bullets"
  }
}

/** 从模型返回文本里抽出单页内容并校验 */
function extractContent(text: string): { ok: true; data: SlideContentZ } | { ok: false; message: string } {
  let raw: unknown
  try {
    const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
    raw = JSON.parse(t)
  } catch {
    // 宽松兜底：抓第一个 {...}
    const m = /\{[\s\S]*\}/.exec(String(text ?? ""))
    if (!m) return { ok: false, message: "模型返回的不是合法 JSON" }
    try {
      raw = JSON.parse(m[0])
    } catch {
      return { ok: false, message: "模型返回的 JSON 无法解析" }
    }
  }
  const parsed = safeParse(SlideContentListSchema, raw)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const first = parsed.data.slides[0]
  if (!first) return { ok: false, message: "模型没有返回任何页面" }
  return { ok: true, data: first }
}

/**
 * 逐页生成：每页独立调用、独立校验、独立重试。
 *
 * 失败语义：某页尝试完 maxAttempts 仍不合法 → 该页 slide=null（调用方补占位），
 * 其余页不受影响。**绝不因为一页坏而丢整册。**
 */
export async function generateSlidesByPage(opts: PageGenOptions): Promise<PageGenResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 2)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)
  let done = 0
  return mapWithConcurrency(opts.plan, concurrency, async (plan) => {
    let lastError = "未知错误"
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      opts.onProgress?.(done, opts.plan.length, plan.title, attempt > 0)
      try {
        const text = await opts.callLlm(opts.buildMessages(plan))
        const got = extractContent(text)
        if (got.ok) {
          done += 1
          return { plan, slide: contentToSlide(got.data, plan), attempts: attempt + 1 }
        }
        lastError = got.message
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    done += 1
    return { plan, slide: null, error: lastError, attempts: maxAttempts }
  })
}
