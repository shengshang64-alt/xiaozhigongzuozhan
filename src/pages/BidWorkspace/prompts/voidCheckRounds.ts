import { clipText, MAX_BID_CHARS } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// R-028（R254）废标检查「真三轮递进」（易标 bid-analysis「分析→检查→定稿」方式恢复）。
// 与 prompts/voidCheck.ts 单轮版并存：单轮版仍受 promptsSnapshot 锁、用于快捷工具路径与三轮失败降级；
// 本三轮用于项目正式废标检查（用户授权 3 次模型调用）。逐轮收窄、逐轮先定位后比对，降漏检与误报。
// 条款分类对齐易标 check_engine L1/L2：invalidBid=违反即整份投标无效（实质/资格/格式强制项）；
// rejectionItem=单项评审要求、不满足作单项否决/扣分（不必然废标）。
// ---------------------------------------------------------------------------

export const VOID_ROUNDS_PROMPT_VERSION = 1 // 新建（R254）：定位分类 / 逐条初检 / 定稿去误报 三轮拆分

/** 三轮共享稳定系统前缀 */
const VOID_SYSTEM_BASE = [
  "你是资深开标评审专家，负责投标前的废标风险合规自查。",
  "始终使用简体中文；只依据给定材料判断，禁止编造。",
].join("\n")

/** 第一轮·定位与分类：为每条废标条款输出应然响应位置 + 同义词组 + kind（本阶段不判合规） */
export function buildVoidScopeMessages(clauses: string[], bidText: string, starBlock?: string): LlmMessage[] {
  const clauseLines = clauses.map((c, i) => `${i + 1}. ${c}`).join("\n")
  const system = [
    VOID_SYSTEM_BASE,
    "本阶段为「定位与分类」，不判定合规与否：对每条废标条款，输出它在投标文件中应当出现响应的位置线索（where）、需要检索的同义词组（synonyms），并对条款分类：",
    "kind=invalidBid：违反后将导致整份投标文件被否决/废标的条款（资格性、实质性响应、密封签章、报价超最高限价、工期/质保等强制要求）；",
    "kind=rejectionItem：仅针对某一单项评审要求、不满足时作单项否决/扣分处理、不必然导致整份废标的条款。",
    "定位口径：涉及材料齐全性的条款定位到资质证明/业绩/授权书/报价/技术响应/服务承诺等章节与目录、附件清单位置；同义词组覆盖 业绩≈类似项目≈工程实例≈案例、资质≈证书≈执照≈许可、授权≈委托≈代理、保证金≈押金≈质保金。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"scope":[{"clause":"条款原文","kind":"invalidBid","where":"应在投标文件中出现响应的位置线索","synonyms":["同义词1","同义词2"]}]}',
  ].join("\n")
  const user = `【废标条款清单】\n${clauseLines}\n\n${starBlock && starBlock.trim() ? `${starBlock.trim()}\n\n` : ""}【投标文件正文】\n${clipText(bidText, MAX_BID_CHARS)}\n\n请逐条输出定位与分类 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 第二轮·逐条初检：带第一轮定位线索逐条比对，输出 status/response/evidence/locations，kind 透传 */
export function buildVoidInitialCheckMessages(plan: unknown, bidText: string): LlmMessage[] {
  const system = [
    VOID_SYSTEM_BASE,
    "上一阶段已给出每条废标条款的定位与分类，本阶段据此逐条初检（先定位后比对）：",
    "在投标文件中找到对应响应→status=compliant；有响应但不完整或存疑→partial；带定位线索仍检索不到任何响应→non_compliant；",
    "每条必须输出：clause 照抄；kind 沿用上一阶段分类（invalidBid/rejectionItem）；source_location 该条款在招标文件中的位置（≤30 字）；response 响应原文摘要（≤80 字）；response_location 响应所在投标章节（≤30 字，找不到留空）；evidence 支撑判定的投标原文摘录（≤120 字）；",
    "结构性线索降级（禁止无证据自动转合规）：投标文件「章节标题/目录项/附件清单/表格条目」仅提到相应材料（证书、报告、授权书、证明材料）而无正文实质响应时，不得判 compliant 也不得判 non_compliant——文本解析看不到图片与扫描件附件，此类情况判 partial 并在 suggestion 注明「需人工核对原件」；",
    "每条条款都要输出一行，拿不准标 partial。",
    "输出严格 JSON，禁止 markdown 围栏，格式：",
    '{"items":[{"clause":"","kind":"invalidBid","source_location":"","response":"","response_location":"","status":"compliant","evidence":""}]}',
  ].join("\n")
  const user = `【第一阶段定位与分类】\n${JSON.stringify(plan)}\n\n【投标文件正文】\n${clipText(bidText, MAX_BID_CHARS)}\n\n请逐条初检并输出 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 第三轮·定稿去误报：复核初检 partial/non_compliant，强制证据剔误报，补 severity/suggestion，输出定稿矩阵 */
export function buildVoidFinalizeMessages(initial: unknown, bidText: string): LlmMessage[] {
  const system = [
    VOID_SYSTEM_BASE,
    "本阶段为「定稿复核」，对上一阶段初检结果逐条复核、优先剔除误报后输出定稿合规核销矩阵：",
    "1. 每条 non_compliant 判定必须附 evidence（投标文件原文摘录 ≤120 字）；partial 中属于「未找到响应/附件不可见/输入不完整」的条目允许 evidence 为空，但 suggestion 必须写明待人工核对的具体对象；",
    "1b. 找不到任何可摘录依据时，该条保留为 partial（待人工核对），禁止据此改判 compliant 或删除该条风险——没检索到不等于已经合规；",
    "2. 证照有效期看归属主体：制造商授权书/分包商营业执照等第三方证照有效期≠投标人自身证照，不得因此判 non_compliant；",
    "3. 业绩表出现多个不同客户名称属正常多项目列举，不得判「公司名称不一致」；名称一致性仅比对投标人落款/授权代表签章与营业执照；",
    "4. 编号/名称比对整段核对，禁止把 PDF 解析切分噪声（括号换行/前后句截断/空格差异）当实质差异；",
    "5.「待确认/待定/待填」出现在流程描述或方案阐述正文属正常行文，仅在明确待填字段位置（表格空格/下划线后无内容）才算模板残留；",
    "6. 依赖目录/附件清单线索的判定，suggestion 注明「需人工核对原件」；",
    "在初检每条基础上补 severity（critical/major/minor——invalidBid 类默认 critical，仅轻微程序性要求如份数/装订/封面格式可降档；rejectionItem 类默认 major）与 suggestion（≤60 字可操作整改建议，compliant 可留空）；kind 沿用初检分类。",
    "输出严格 JSON，禁止 markdown 围栏，格式：",
    '{"items":[{"clause":"","kind":"invalidBid","source_location":"","response":"","response_location":"","status":"compliant","severity":"critical","suggestion":"","evidence":""}]}',
  ].join("\n")
  const user = `【第二阶段初检结果】\n${JSON.stringify(initial)}\n\n【投标文件正文】\n${clipText(bidText, MAX_BID_CHARS)}\n\n请复核并输出定稿 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
