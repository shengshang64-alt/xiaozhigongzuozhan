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
 */
export function buildOrchestrationMessages(
  batch: TechLeafRef[],
  projectBrief: string,
  opts?: {
    factsLines?: string[]
    scoringItems?: ScoringItem[]
    knowledgeCandidates?: { ref: string; text: string }[]
    mermaidEnabled?: boolean
    figureCap?: number
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
  // 2026-10 易标对齐轮：条件块序号改动态编号（原硬编码 10/11/11 在组合开启时会重号）
  const extraRules: string[] = []
  const extraRuleNo = () => 10 + extraRules.length
  if (opts?.mermaidEnabled) {
    extraRules.push(
      `${extraRuleNo()}. figure.type 增加可选值 "mermaid"（关系图）：内容是流程、层级、职责/接口等简单关系、且能用不超过 12 个节点的 mermaid 流程图表达时优先选 mermaid；复杂架构/界面示意仍用 architecture/demo；`,
      // 2026-10 配图需求轮：项目实施计划类内容自动编排甘特图
      `${extraRuleNo()}. figure.type 增加可选值 "gantt"（甘特图）：该节是项目实施计划、阶段划分、进度安排或里程碑类内容（标题含「实施计划/进度/里程碑/阶段安排」等字样是强信号）时选 gantt，一张甘特图比分段文字更利于评标专家核对工期；抽象论述或非进度类内容禁止选 gantt；`,
    )
  }
  if (knowledgeCandidates.length) {
    extraRules.push(
      `${extraRuleNo()}. knowledge：从下面【知识库候选素材】里挑选本节写作最应参考的素材 ref 编号（≤3 个，按相关度排序；候选与本节无关就输出空数组），程序会把对应素材段定向注入本节写作；禁止编造候选清单里没有的 ref。`,
    )
  }
  // 2026-10-07 高配图需求模式：使用者把全文配图上限设到 20 张以上时，判定反转为「默认配图」（宁多勿漏），
  // 程序侧仍按 priority/上限/邻接类型去重全局择优——上限是供给侧约束，不该让提示词先把候选砍到 1/3。
  if ((opts?.figureCap ?? 0) >= 20) {
    extraRules.push(
      `${extraRuleNo()}. 本次全文配图上限为 ${opts?.figureCap} 张，使用者明确需要多配图，判断口径反转为「默认配图」：清单中每个叶子默认 figure.needed=true 并给出具体图名/图注，仅当该节是纯条款罗列、承诺函、资质说明等加图会显得生硬的纯文字内容时才 needed=false；宁多勿漏——程序会按优先级、上限与相邻类型查重全局择优，标记数超过上限的部分不会被采用。`,
      `${extraRuleNo()}. 本模式下 figure.priority 允许取 2-5 的整数（5=最该配图，2=可配可不配），按真实价值评级即可，禁止全部抬到 5。`,
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
