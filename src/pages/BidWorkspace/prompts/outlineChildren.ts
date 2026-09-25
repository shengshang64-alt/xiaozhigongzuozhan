// ---------------------------------------------------------------------------
// R68 提示词搬迁第四批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { ParseReport, clipText, combinedScoringText, numberScoringItems, numberedScoringDetailLines, sectionText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 分步大纲 call2：为单个技术章展开章内节/条（最多两层，输出即该章 children）。
 * 注入该章标题 + 评分相关节 + 其余技术章标题（防跨章重复）+ 叶子配额（全局目标均分，±2 容差）。
 */
export function buildOutlineChildrenMessages(
  chapterTitle: string,
  otherChapterTitles: string[],
  report: ParseReport | null,
  opts: { quota: number; level: 0 | 1 | 2 | 3; sectionWords: number; globalFacts?: string },
): LlmMessage[] {
  const scoringText = combinedScoringText(report)
  // R31：编号技术评分项注入，章内叶子用 [响应:Rx] 标注承接（与整份大纲 prompt 同一编号源）
  const numberedTechItems = numberScoringItems(report).filter((s) => s.category === "tech")
  const numberedScoringText = numberedTechItems.length ? numberedScoringDetailLines(numberedTechItems) : scoringText
  const techText = sectionText(report, "delivery_req")
  const quota = Math.max(1, Math.round(opts.quota))
  const lo = Math.max(1, quota - 2)
  const hi = quota + 2
  const depthRule =
    opts.level === 2
      ? "层级硬约束：本章恰好一层子节点（章—节），只输出节节点、每个节节点 children 为空数组，禁止第三层；"
      : opts.level === 3
        ? "层级硬约束：本章恰好两层子节点（章—节—条），每个节下至少 1 个条级节点，条节点 children 为空数组；"
        : "层级自定（一层「节」或两层「节—条」，最多到条为止）：按本章内容复杂度决定，节必须有、条可选；"
  const numbered: string[] = [
    depthRule,
    `叶子规模配额：本章叶子节点（无子节点的末端节点）总数必须落在 ${lo}-${hi} 个（配额 ${quota} 个），每个叶子将承载约 ${opts.sectionWords} 字正文；不足时按系统/模块/阶段/保障维度拆分补足，超出时合并相近叶子；`,
    "内容以评分办法为纲：下面技术评分中与本章主题相关的评分项，每项都要落到具体节/条标题；与本章无关的评分项不要抢写（由其他章承担）；",
    // R31：分步大纲同步承接标注，保证覆盖矩阵对长标书同样可对账
    numberedTechItems.length
      ? "承接标注（R31）：每个叶子节点（无 children 的节/条）必须在 description 字段标注其承接的评分编号，格式 `[响应:R1]` 或 `[响应:R1,R3]`（多个逗号分隔，编号取自下面【技术评分办法】行首 [Rx]）；非叶子节点不标注；不承接任何评分项的叶子可省略 description；"
      : "",
  ]
  if (otherChapterTitles.length) {
    numbered.push(
      `其他技术章标题如下，本章的节/条标题禁止与它们或它们的职责范围重复：${otherChapterTitles.map((t) => `「${t}」`).join("、")}；`,
    )
  }
  numbered.push(
    "标题只写名称、不带编号、不以标点结尾；节/条标题必须用具体响应式命名：主题词+落点词（设计/范围/保障/机制/流程等），形如「设备兼容性设计」「知识更新机制」；禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
    `输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（outline 数组即本章的 children，不要输出章节点本身；叶子节点带 description 承接标注${numberedTechItems.length ? "，形如 \"description\":\"[响应:R2]\"" : ""}）：`,
    numberedTechItems.length
      ? '{"outline":[{"title":"节标题","children":[{"title":"条标题","children":[],"description":"[响应:R2,R5]"}]}]}'
      : '{"outline":[{"title":"节标题","children":[{"title":"条标题","children":[]}]}]}',
  )
  const system = [
    "你是资深投标顾问，正在为医疗信息化投标文件的某一个技术章展开章内大纲（节/条两级以内）。整份大纲的顶层章已定，本次只展开当前章。",
    `当前要展开的技术章：「${chapterTitle}」。`,
    "硬性要求：",
    ...numbered.filter((x) => x !== "").map((t, i) => `${i + 1}. ${t}`),
  ].join("\n")
  const user = [
    `【技术评分办法（编号逐项分值，只取与本章相关的展开）】\n${clipText(numberedScoringText, 4000) || "（未解析到技术评分）"}`,
    `【技术需求与交货服务要求】\n${clipText(techText, 4000) || "（未解析）"}`,
    opts.globalFacts ?? "",
    `请为技术章「${chapterTitle}」输出章内节/条大纲 JSON（叶子 ${lo}-${hi} 个，outline 数组即本章 children）。`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
