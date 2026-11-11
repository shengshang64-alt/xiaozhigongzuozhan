/**
 * 导出分册收录哪些章——**纯函数、零重依赖**，供需要「导出会写入哪些章」的界面共用。
 *
 * 历史：本函数原在 `bidFiles.ts` 里。而 `bidFiles` 顶层 `import { ... } from "docx"`，
 * 于是任何组件只要想读「导出章序」就经 `bidFiles` 把 docx 静态拉回首载图，
 * 触发 R124 防回潮哨兵（docx/xlsx/pptxgenjs 必须按需 import）。
 * UX-v2 ⑦ 组卷导出要在屏上显示章序，正好踩中，故把纯函数迁到这里；
 * `bidFiles` 仍 re-export 同名函数，既有调用点与单测行为零变化。
 */
import { isBizPart, type BidScope } from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

/** R206 切片 1（R-002）：按内容范围三模式决定导出分册收录哪些章——
 *  biz 仅商务章 / tech 仅技术章 / both 全部（商务骨架章保留占位供线下填写） */
export function pickExportChapters(chapters: Chapter[], scope: BidScope): Chapter[] {
  return (chapters ?? []).filter((c) => {
    // 2026-10-14 交付物治理：**已有正文的章一律导出**，内容范围只用于筛掉空骨架章。
    // 旧口径按 part 一刀切：scope=tech（含 include_biz=false）时把 part=biz 的
    // 「实质性条款响应承诺函」整章丢弃——而该章是零 AI 自动生成（commitmentLetter.ts）、
    // 设计上「随全套文档导出」、且是 ★ 条款逐字响应与盖章的法定载体，写了却拿不到。
    if ((c.content ?? "").trim()) return true
    return scope === "biz" ? isBizPart(c) : scope === "tech" ? !isBizPart(c) : true
  })
}
