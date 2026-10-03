// ---------------------------------------------------------------------------
// R69 提示词搬迁第五批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { isBizPart } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** 第五轮改造 2：大纲本地校验不符时的一次「结构修复」调用（费用含在同一次生成确认内）；第十三轮：修复契约带 part，叶子规模只按技术章计算；OpenBidKit 借鉴：保留叶子 [响应:Rx] 承接标注，承接缺口并入同一次修复（评审→修复闭环，不新增调用）；T15：门禁评审循环复用本 builder，opts.lockTopLevel 时追加顶层章身份锁定约束（易标 captureLockedTopLevelItems 语义——评审循环只调结构不改章名） */
export function buildOutlineFixMessages(
  nodes: OutlineNode[],
  level: 0 | 1 | 2 | 3,
  leafTarget: number,
  sectionWords: number,
  issues: string[],
  opts?: { lockTopLevel?: boolean },
): LlmMessage[] {
  const slim = (list: OutlineNode[], depth = 1): unknown =>
    list.map((n) => ({
      title: n.title,
      ...(depth === 1 ? { part: isBizPart(n) ? "biz" : "tech" } : {}),
      ...(n.description?.trim() ? { description: n.description.trim() } : {}),
      children: slim(n.children ?? [], depth + 1),
    }))
  const leafLo = Math.max(1, Math.ceil(leafTarget * 0.8))
  const leafHi = Math.max(leafLo, Math.floor(leafTarget * 1.2))
  const structureRule =
    level === 1
      ? "目标结构为一级（只按技术章计算）：技术章只保留章节点、children 为空数组；商务骨架章（part=\"biz\"）保留其一级小节。"
      : level === 2
        ? "目标结构为两级（只按技术章计算）：每个技术章下有节，节节点的 children 一律为空数组；商务骨架章固定为章+一级小节。"
        : level === 3
          ? "目标结构为三级（只按技术章计算）：每个技术章下有节，每节下至少 1 个条级节点，条节点的 children 为空数组；商务骨架章仍只列一级小节。"
          : "保持层级合理（最多三级），不强行增删级数；商务骨架章保持章+一级小节。"
  const systemLines = [
    "你是资深投标顾问，负责修复投标文件响应大纲（商务部分骨架 + 技术部分详细大纲）的结构。给你现有大纲 JSON 与问题清单，请输出修复后的完整大纲 JSON。",
    "修复规则：",
    `1. 逐条解决问题清单：${issues.join("；")}；`,
    `2. ${structureRule}`,
    "3. 顶层章必须保留 part 字段（\"biz\"=商务骨架章、\"tech\"=技术章），商务章在前、技术章在后，禁止改变章的归属；",
    `4. 技术章叶子节点（无子节点的末端节点，商务章叶子不计入）总数必须落在 ${leafLo}-${leafHi} 个区间（目标 ${leafTarget} 个，每叶子承载约 ${sectionWords} 字正文）：不足时按系统/模块/阶段/保障维度合理拆分补足叶子，超出时合并相近叶子；`,
    "5. 尽量保留现有标题文字与层级归属，只做结构补足、拆分或合并，不重写无关内容；标题只写名称、不带编号、不以标点结尾；节/条标题必须用具体响应式命名（主题词+设计/范围/保障/机制/流程等落点词，形如「设备兼容性设计」「知识更新机制」），现有标题若为「概述/说明/介绍/相关内容/其他」式空泛命名必须改为具体响应式命名；",
    "6. 叶子节点 description 中的 [响应:Rx] 承接标注是评分覆盖对账依据：现有标注必须原样保留、禁止丢失；问题清单标明的「评分项未承接」编号，逐个挂到语义最相关的技术叶子 description（与已有标注合并写 [响应:Rx,Ry]），确无可挂叶子时才可新增对应叶子；商务章不标注、不新增承接；",
    "7. 输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（顶层章必须带 part 字段；技术叶子节点带 description 承接标注；无承接的叶子不带 description 字段）：",
    '{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[],"description":"[响应:R1,R3]"}]}]}]}',
  ]
  // T15：门禁评审循环复用本 builder 时追加顶层章身份锁定约束（易标 captureLockedTopLevelItems 语义——评审循环只调结构不改章名）；
  // 不传 opts 时输出与既往逐字节一致（promptsSnapshot 快照锁字不受影响）
  if (opts?.lockTopLevel) {
    systemLines.splice(
      3,
      0,
      "★ 顶层章身份锁定：现有顶层章的数量、顺序、标题与 part 归属一律保持不变，禁止新增/删除/合并/改名任何顶层章、禁止调整章序；本次只允许在各章内部做节/条级的拆分、合并、补充与命名修正。",
    )
  }
  const system = systemLines.join("\n")
  const user = `【现有大纲 JSON】\n${JSON.stringify({ outline: slim(nodes ?? []) })}\n\n请输出修复后的完整大纲 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
