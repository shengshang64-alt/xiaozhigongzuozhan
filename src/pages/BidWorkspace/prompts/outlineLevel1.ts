// ---------------------------------------------------------------------------
// R68 提示词搬迁第四批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { BID_OUTLINE_REQ_KEY, ParseReport, STAR_CLAUSE_SECTION, clipText, combinedScoringText, sectionText } from "../bidTypes"
import type { BidScope } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 3

/**
 * 分步大纲 call1：只生成顶层章清单——商务骨架章（含一级小节）+ 技术章（仅标题、children 为空）。
 * 商务章仍由模型按招标要求增删（与单次生成同口径），技术章的章内展开交给 call2 逐章做。
 */
export function buildOutlineLevel1Messages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  opts?: {
    globalFacts?: string
    implicitConstraints?: string[]
    techChapterHint?: number
    /** 用户反馈轮项 3：是否输出商务标骨架章（缺省 true；false 时商务段整体替换为「不输出任何商务章节」） */
    includeBiz?: boolean
    /** R206 切片 1（R-002）：内容范围三模式；缺省时由 includeBiz 派生 */
    scope?: BidScope
  },
): LlmMessage[] {
  const scope: BidScope = opts?.scope ?? (opts?.includeBiz === false ? "tech" : "both")
  const includeBiz = scope !== "tech"
  const includeTech = scope !== "biz"
  const scoringText = combinedScoringText(report)
  const bizText = sectionText(report, "biz_score")
  const respText = sectionText(report, "response_req")
  const qualText = sectionText(report, "qualification")
  const starText = sectionText(report, STAR_CLAUSE_SECTION.key).trim()
  // 2026-09-23 用户反馈轮（目录不一致）：分步大纲 call1 同步接入招标目录要求锚点（与整份生成路径同源同口径）
  const outlineReqTextL1 = sectionText(report, BID_OUTLINE_REQ_KEY).trim()
  const implicitList = opts?.implicitConstraints ?? []
  const techHint = Math.max(4, Math.min(16, Math.round(opts?.techChapterHint ?? 8)))
  const numbered: string[] = scope === "both"
    ? [
        "顶层章分「商务部分」与「技术部分」两组：商务章在前、技术章在后，每个顶层章对象必须带 part 字段（\"biz\"=商务章、\"tech\"=技术章）；",
        "商务部分输出 6-10 个骨架章（part=\"biz\"）：投标函及报价、法定代表人授权、资质与证照证明、财务审计报告、同类项目业绩、商务条款响应/偏离表、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删；商务章 children 只列一级小节名（不展开三级），正文由投标人线下填写；",
      ]
    : scope === "tech"
      ? [
          "顶层章全部为技术部分：每个顶层章对象必须带 part 字段（一律 \"tech\"）；",
          "本次不输出任何商务部分章节（part=\"biz\"），大纲仅含技术标章节；投标函、资质证照、商务偏离表等商务内容由投标人线下自行处理，禁止为其安排任何章节；",
        ]
      : [
          "顶层章全部为商务部分：每个顶层章对象必须带 part 字段（一律 \"biz\"）；",
          "本次仅编制商务标，输出 8-12 个商务章（part=\"biz\"）：投标函、法定代表人身份证明、授权委托书、报价一览表、分项报价表、商务条款响应偏离表、资格证明文件、财务审计报告、同类项目业绩、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删；本次为分步生成第一步，商务章 children 可含一级小节名；",
          "本次不输出任何技术部分章节（part=\"tech\"），技术方案等由技术标单独编制，禁止为其安排任何章节；",
        ]
  if (includeTech)
    numbered.push(
    `技术部分（part="tech"）输出 ${techHint} 个左右的顶层章、children 一律为空数组（章内小节由后续步骤逐章展开，本次禁止展开）：以评分办法为纲，把下面技术评分的重要评分项分组成章，章与章之间范围互斥、合起来覆盖全部技术评分项与响应文件要求；`,
    "技术章常规骨架参考：项目理解与需求分析、总体建设方案、详细技术方案（可按系统拆多章）、项目实施组织与进度计划、质量保障与测试验收、培训方案、售后服务与运维保障、应急预案；再按本招标文件增删；",
    "标题只写名称、不带编号、不以标点结尾；章标题必须具体（主题词+落点词），禁止「概述/说明/介绍/相关内容/其他」式空泛命名；",
    // 2026-09-23 用户反馈轮（目录幻觉）：与整份生成路径同口径的事实来源排他条款
    "事实来源排他（防幻觉）：顶层章的主题与顺序只能来自下面【技术评分办法】【商务评分办法】【响应文件要求】【招标文件规定的投标文件目录】【★/▲ 重点条款】等注入内容与常规骨架参考；禁止编造注入内容中不存在的评分项、分值、条款编号或目录要求；招标已规定响应目录时，技术/商务顶层章必须遵循其顺序与层级，禁止另起炉灶；无注入依据的方面用常规骨架命名，不得假称招标要求；",
  )
  else
    numbered.push(
    "标题只写名称、不带编号、不以标点结尾；章标题必须具体（主题词+落点词），禁止「概述/说明/介绍/相关内容/其他」式空泛命名；",
    "事实来源排他（防幻觉）：商务顶层章的主题与顺序只能来自下面【商务评分办法】【响应文件要求】【资质要求】【招标文件规定的投标文件目录】等注入内容与常规商务骨架参考；禁止编造注入内容中不存在的要求、分值或条款编号；无注入依据的方面用常规商务骨架命名，不得假称招标要求；",
  )
  // R207 切片 2（R-003）：无底稿兜底——解析到「响应文件组成」时强制顶层章逐项映射其顺序与命名
  if (respText) {
    numbered.push(
      "响应文件组成硬约束：下面【响应文件要求】中「响应文件组成」列出的每个组成部分，必须逐项映射为对应的顶层章，顺序与命名保持一致，不允许合并或改名；组成未列出但编制必需的常规章可在末尾补充；",
    )
  }
  if (starText) {
    numbered.push(
      `下面【★/▲ 重点条款】为实质性响应条款，任何一条未响应都可能直接废标：必须让每条重点条款都有明确的顶层章落点${
        includeBiz ? "（商务类落商务章、技术类落技术章）" : "（一律落技术章）"
      }，禁止只靠通用章笼统带过；`,
    )
  }
  if (implicitList.length) {
    numbered.push(
      `下面【招标隐式硬约束】共 ${implicitList.length} 条（如页数/份数/装订/格式等刚性要求），任何一条被违反都可能废标，必须有对应顶层章落点；`,
    )
  }
  numbered.push(
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[]}]}',
  )
  const system = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，擅长按评分办法组织技术标结构。当前任务：为投标项目「${projectName}」（采购人：${hospital || "未填写"}）生成响应大纲的【顶层章清单】（本次只到章一级）。`,
    "硬性要求：",
    ...numbered.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n")
  const stableParts = [
    `【技术评分办法（逐项分值）】\n${scoringText || "（未解析到技术评分）"}`,
    // 用户反馈轮项 3：不含商务章时商务评分办法不再注入（避免误导模型输出商务章）
    ...(includeBiz ? [`【商务评分办法】\n${bizText || "（未解析到商务评分）"}`] : []),
    `【响应文件要求】\n${respText || "（未解析到响应要求）"}`,
    `【资质要求】\n${qualText || "（无）"}`,
  ]
  if (opts?.globalFacts) stableParts.push(opts.globalFacts)
  if (implicitList.length) {
    stableParts.push(
      `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  if (starText) stableParts.push(`【★/▲ 重点条款（实质性响应条款，每条必须有顶层章落点）】\n${clipText(starText, 6000)}`)
  if (outlineReqTextL1) {
    stableParts.push(`【招标文件规定的投标文件目录（顶层章必须遵循其顺序与层级）】\n${clipText(outlineReqTextL1, 4000)}`)
  }
  return [
    { role: "system", content: system },
    { role: "user", content: stableParts.join("\n\n") },
    {
      role: "user",
      content:
        scope === "biz"
          ? "请输出这份投标文件响应大纲的顶层章清单 JSON（全部为商务章，顶层章 part 一律为 biz，不输出任何技术章节）。"
          : includeBiz
            ? "请输出这份投标文件响应大纲的顶层章清单 JSON（商务骨架章在前且含一级小节，技术章在后且 children 为空数组，顶层章带 part 字段）。"
            : "请输出这份投标文件响应大纲的顶层章清单 JSON（全部为技术章且 children 为空数组，顶层章 part 一律为 tech，不输出任何商务章节）。",
    },
  ]
}
