// ---------------------------------------------------------------------------
// T16：mermaid 修复提示词（易标 prepareRenderableMermaid 的回传修复口径）——
// 只修语法不改内容：节点文字与图意保持不变，仅修正导致渲染失败的语法问题。
// ---------------------------------------------------------------------------

import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** mermaid 渲染失败修复：输入原源码 + 渲染错误，输出修复后的完整 mermaid 源码（裸代码，无围栏） */
export function buildMermaidRepairMessages(title: string, badCode: string, error: string): LlmMessage[] {
  const system = [
    "你是 mermaid 图表语法修复器。用户给你一段渲染失败的 mermaid 源码与错误信息，你只修复语法问题，保持图表内容与结构意图不变。",
    "修复规则：",
    "1. 只修语法不改内容：节点文字、步骤顺序、图意一律保持原样，禁止增删业务节点、禁止改写文案；",
    "2. 常见修复手段：中文或含特殊字符的节点标签补双引号（A[\"标签\"]）、修正箭头/连线写法、移除不支持的分号与子图嵌套错误、换用合法的图型声明；",
    "3. 约束：节点总数不超过 12 个、每个节点标签不超过 16 字；只输出修复后的完整 mermaid 源码，禁止解释、禁止 markdown 代码围栏；",
    "4. 第一行必须是图型声明（flowchart/graph/sequenceDiagram/stateDiagram 等合法关键字）。",
  ].join("\n")
  const user = `【图题】${title || "流程/关系图"}\n\n【渲染失败的源码】\n${badCode}\n\n【渲染错误】\n${error.slice(0, 300)}\n\n请输出修复后的完整 mermaid 源码。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
