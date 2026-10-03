import { clipText, MAX_BID_CHARS } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 废标自查 prompt（R65 提示词搬迁第一批，自 bidTypes.ts 原样搬迁：只搬不改字）
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 2

/** 第九轮改造 2：输出契约升级——双向定位（source_location/response_location）+ severity + suggestion + evidence */
export function buildVoidCheckMessages(clauses: string[], bidText: string, starBlock?: string): LlmMessage[] {
  const clauseLines = clauses.map((c, i) => `${i + 1}. ${c}`).join("\n")
  const system = [
    "你是资深开标评审专家，负责投标前的废标风险合规自查。对每条废标条款，在投标文件中查找对应响应或满足证据，并输出合规核销矩阵条目：",
    "clause 照抄条款原文；source_location 写该条款在招标文件中的位置描述（如「第三章 评标办法 2.1 条」，不超过 30 字）；response 摘录投标文件中的对应响应原文摘要（不超过 80 字）；response_location 写响应所在的投标章节位置（如「第2章 资质证明」，不超过 30 字，找不到响应时留空）；",
    "status 取 compliant（已明确响应/满足）/ partial（有响应但不完整或存疑）/ non_compliant（未找到任何响应或明确不满足）；",
    "severity 取 critical / major / minor——废标条款默认 severity=critical，仅当条款本身属轻微程序性要求（如份数、装订、封面格式类）才可降档为 major 或 minor；",
    "suggestion 给出不超过 60 字的可操作整改建议（status=compliant 时可留空）；evidence 摘录支撑判定的投标文件原文（不超过 120 字）。",
    "防误报硬规则：",
    "1. 每条 partial / non_compliant 判定必须附证据：evidence 字段摘录投标文件中支撑该判定的原文（不超过 120 字）；找不到任何可摘录的原文依据时，不得输出该条的风险判定；",
    "2. 投标文件中存在「章节标题 / 目录项 / 附件清单 / 表格条目」等结构性文本线索提到相应材料（证书、报告、授权书、证明材料等）时，不得判 non_compliant——文本解析看不到图片与扫描件附件，此类情况判 compliant 并在 suggestion 中注明「依据目录/附件清单线索，需人工核对原件」；",
    "3. 每条条款都必须输出一行结果（含 compliant），禁止遗漏；判定要保守：拿不准就标 partial，宁可多提醒。",
    "4. 证照有效期判定先看归属主体：投标文件中出现的制造商授权书、分包商营业执照等第三方证照有效期≠投标人自身证照，不得因此判 non_compliant；",
    "5. 业绩表中出现多个不同客户名称属正常多项目列举，不得判为「公司名称不一致」；公司名称一致性仅比对投标人落款/授权代表签章与营业执照名称；",
    "6. 编号/名称比对须整段核对，禁止把 PDF 解析切分噪声（括号换行、前后句截断、空格差异）当作实质性差异输出；",
    "7. 「待确认/待定/待填」出现在流程描述正文或方案阐述中属正常行文表述，仅当出现在明确标注为待填字段位置（如表格空格、下划线后无内容）才视为模板残留；",
    "同义词检索规则：当某条款关键词在投标文件正文中检索不到对应响应时，不得立即判 non_compliant——须自动用同义词组再搜一轮（业绩≈类似项目≈工程实例≈项目经验≈案例；资质≈证书≈执照≈许可；授权≈委托≈代理；保证金≈押金≈质保金），检索到同义表述后按命中结果判定。",
    // 公司招投标培训（第一期）④电子标技能培训：公司真实废标案例补查
    "公司经验补查（电子标实际废标案例总结）：若投标文件正文出现下列硬伤，额外输出条款以「【公司经验】」开头的检查项——①模板占位文字残留（如「请填入您的内容」「复制内容后右键只保留文本」等模板指引语）；②投标金额大小写数字不符；③分项报价合计与总价不符；同样受防误报硬规则约束（必须附 evidence 原文摘录，找不到依据不得输出）；未发现问题时不必输出这些额外项。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"items":[{"clause":"条款原文","source_location":"","response":"","response_location":"","status":"compliant","severity":"critical","suggestion":"","evidence":""}]}',
  ].join("\n")
  const user = `【废标条款清单】\n${clauseLines}\n\n${starBlock && starBlock.trim() ? `${starBlock.trim()}\n\n` : ""}【投标文件正文】\n${clipText(bidText, MAX_BID_CHARS)}\n\n请逐条比对并输出 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
