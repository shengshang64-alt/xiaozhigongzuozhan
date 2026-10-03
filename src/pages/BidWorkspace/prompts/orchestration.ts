// ---------------------------------------------------------------------------
// R68 提示词搬迁第四批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { ScoringItem, TechLeafRef } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 改造 2.1：预编排批量 prompt——正文编排助手口径、克制判断，输出每叶 {table, figure} JSON。
 * 循环 2 批 2-1：输入增全局事实表行与评分项清单，输出增 facts（本节必守事实，从输入事实行挑选）/
 * writing_focus（一句话写作焦点+对应评分点）/ figure.caption（图注）；缺省不传时行为与现状一致。
 * T16：opts.knowledgeCandidates 提供知识库候选时输出增 knowledge（从候选 ref 挑选）；opts.mermaidEnabled
 * 时 figure.type 白名单加 "mermaid"——均为条件块，不传时输出与快照锁字逐字节一致。
 * T17：opts.aiImageEnabled 时白名单加 "ai"（AI 位图），ai 型输出增 image_style（engineering_diagram/
 * realistic_photo）与 scene（≤80 字画面场景，取自本节正文主题）。
 */
export function buildOrchestrationMessages(
  batch: TechLeafRef[],
  projectBrief: string,
  opts?: {
    factsLines?: string[]
    scoringItems?: ScoringItem[]
    knowledgeCandidates?: { ref: string; text: string }[]
    mermaidEnabled?: boolean
    aiImageEnabled?: boolean
  },
): LlmMessage[] {
  const factsLines = (opts?.factsLines ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 40)
  const scoringItems = (opts?.scoringItems ?? []).slice(0, 40)
  const knowledgeCandidates = (opts?.knowledgeCandidates ?? []).slice(0, 12)
  const baseSystem = [
    "你是投标文件正文编排助手，负责在动笔前为技术标大纲的每个叶子节点做克制的版面编排判断：这一节正文放一个表格是否真能提升清晰度、这一节是否值得配一张架构图/流程图/界面示意图，并为这一节挑选必守事实、给出写作焦点。",
    "编排铁律（克制优先，宁缺毋滥）：",
    "1. table.needed=true 仅当该节内容天然是多维对照信息（参数对照、配置清单、人员分工、进度计划、指标承诺、设备清单等）、表格确实能提升评标专家阅读清晰度时才给；纯论述、纯方案描述一律 needed=false、purpose 留空；",
    "2. figure.needed=true 仅当该节是具象工程场景（系统架构、业务流程、界面功能布局）且一张图能让评标专家快速理解时才给；抽象论述（项目理解、需求分析、保障措施、管理制度等）一律 needed=false；",
    "3. figure.priority 取 3-5 的整数（5=最该配图）；priority 低于 3 的一律置 needed=false，禁止为凑数抬高优先级；",
    "4. figure.type 按内容选 architecture/flow/demo；figure.title 用「××架构图 / ××流程图 / ××界面示意」式具体命名（≤20 字）；reason ≤30 字说明配图价值；table.purpose ≤40 字说明表格呈现什么；",
    "5. 只依据叶子标题、上级章、项目概述与给定的事实表行、评分项清单判断，禁止编造输入里没有的内容；拿不准就 needed=false；",
    "6. facts：从下面【全局事实表行】里挑选本节正文写作必须遵守的事实行（原样照抄整行，≤5 条；只挑与本节主题直接相关的，禁止改写数值、禁止编造；没有可挑的输出空数组）；",
    "7. writing_focus：一句话（≤50 字）点明本节的写作焦点与对应评分点——对照下面【评分项清单】写出对应评分项名，没有对应评分点时聚焦本节标题的实质性响应；",
    "8. figure.needed=true 时必须同时给 figure.caption：图注（≤40 字），说明这张图呈现什么、如何支撑本节正文；",
    "9. 相邻小节不连续同类型图：清单中相邻的两个叶子都值得配图时，figure.type 尽量错开（architecture/flow/demo 交替），程序选定后还会做邻接同类型查重。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（items 与输入叶子清单一一对应，node_id 原样回填）：",
    '{"items":[{"node_id":"叶子ID","facts":["事实行1"],"writing_focus":"写作焦点（对应评分点）","table":{"needed":false,"purpose":""},"figure":{"needed":true,"type":"architecture","title":"图名","caption":"图注","priority":4,"reason":"理由"}}]}',
  ].join("\n")
  // T16 条件块：mermaid 图型与知识库定向引用（不传 opts 时以上文本与快照锁字逐字节一致）
  const extraRules: string[] = []
  if (opts?.mermaidEnabled) {
    extraRules.push(
      "10. figure.type 增加可选值 \"mermaid\"（关系图）：内容是流程、层级、职责/接口等简单关系、且能用不超过 12 个节点的 mermaid 流程图表达时优先选 mermaid；复杂架构/界面示意仍用 architecture/demo；",
    )
  }
  // T17 条件块：AI 位图（具象场景照片/工程示意图，补图阶段异步生成）
  if (opts?.aiImageEnabled) {
    extraRules.push(
      "11. figure.type 增加可选值 \"ai\"（AI 配图）：该节描写具象的机房建设、数据中心、网络部署、现场实施、运维服务等场景，且一张示意图/实景风格配图能提升评审观感时选 ai；ai 型必须同时输出 image_style（\"engineering_diagram\"=工程图示 或 \"realistic_photo\"=实景照片，场景落地类选实景、方案概念类选工程图示）和 scene（≤80 字的画面场景描述，只取本节标题与项目概述能支撑的具象内容，禁止编造设备型号与人数）。",
    )
  }
  if (knowledgeCandidates.length) {
    extraRules.push(
      "11. knowledge：从下面【知识库候选素材】里挑选本节写作最应参考的素材 ref 编号（≤3 个，按相关度排序；候选与本节无关就输出空数组），程序会把对应素材段定向注入本节写作；禁止编造候选清单里没有的 ref。",
    )
  }
  const system = extraRules.length ? `${baseSystem}\n${extraRules.join("\n")}` : baseSystem
  const knowledgeBlock = knowledgeCandidates.length
    ? `【知识库候选素材（knowledge 只能从这里选 ref，禁止编造）】\n${knowledgeCandidates.map((k) => `${k.ref}｜${k.text}`).join("\n")}`
    : ""
  const user = [
    projectBrief ? `【项目概述】\n${projectBrief}` : "",
    factsLines.length
      ? `【全局事实表行（facts 只能从这里原样挑选，禁止编造）】\n${factsLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
      : "",
    scoringItems.length
      ? `【评分项清单（writing_focus 对应评分点从这里选）】\n${scoringItems
          .map((s, i) => `${i + 1}. ${s.item}（${s.score} 分）`)
          .join("\n")}`
      : "",
    knowledgeBlock,
    `【本批叶子清单（共 ${batch.length} 个，逐个判断；相邻叶子配图类型尽量错开）】\n${batch
      .map((l, i) => `${i + 1}. node_id=${l.nodeId}｜标题：${l.title}｜上级章：${l.chapter}`)
      .join("\n")}`,
    "请为清单中每个叶子输出编排判断 JSON（node_id 原样回填，漏判按 needed=false、facts 空数组处理）。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 单批编排输出清洗：只收本批合法 nodeId；table 无 purpose 视为不需要；figure priority<3 或无标题强制 needed=false；facts ≤5 条、writing_focus/caption 截断保留 */
