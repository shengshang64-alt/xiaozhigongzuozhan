// ---------------------------------------------------------------------------
// 知识原子抽取服务（2026-10-30 知识库 P0-4）
//
// 依据《知识库改造需求文档 v1.0》§6 入库流水线 + 附录 A 抽取提示词。
//
// 流程（严格按文档六阶段）：
//   raw → parsed（切段建 anchor）→ extracted（调用 LLM 抽原子）→ pending（入库待审）
//
// 关键设计：
//   ① 分段抽取：一次只喂 1-2 个段落，避免长文注意力衰减（实测 600 字段落最佳）
//   ② 逐段容错：某段抽取失败只跳过该段，不影响整篇（与 PPT 单页重试同口径）
//   ③ Schema + 质量双重校验：先 Zod 校验结构，再 checkAtomQuality 校验业务规则
//   ④ **不硬凑**：抽不出合格原子就返回空，绝不为"数量好看"放宽标准
// ---------------------------------------------------------------------------

import { parseExtractionResult, sanitizeExtraction, type ExtractedAtom } from "./kbAtoms"
import { LOW_CONFIDENCE } from "./kbAtoms"
import type { ParsedParagraph } from "./kbParse"
import { splitWithAnchor } from "./kbParse"
import type { LlmMessage } from "@/lib/llm"
import { redactPii } from "@/lib/piiRedact"

/** 抽取版本号（变更提示词时递增，用于"按新提示词全量重跑"） */
export const EXTRACT_VERSION = "v1.0-2026-10-30"

/** 单段最多抽多少条（附录 A 硬约束 6） */
const MAX_ATOMS_PER_SEGMENT = 40
/** 单篇最多抽多少条（防止一篇超长标书出几千条） */
const MAX_ATOMS_PER_DOC = 200

// ===========================================================================
// 一、提示词（附录 A 原文 + 段落上下文）
// ===========================================================================

export const EXTRACTION_SYSTEM_PROMPT = `你是知识抽取器。从给定文档片段中抽取「知识原子」。

【原子类型】
fact                稳定事实（公司规模、成立时间、合作厂商）
metric              带数值的指标（必须有数值+单位+口径+年份）
case                项目案例（必须有具体客户名+建设内容）
qualification       资质证书（证书名+等级/编号）
policy              政策条款（发文号或标准号+条款）
product_capability  产品能力（模块 + 具体功能；有版本号更好，不强求）
play                打法（某类客户的推进路径）
script              话术（异议应答、价值主张）

【什么该抽（正例）】
- "系统支持结构化病历书写、智能质控、CDSS辅助决策" → product_capability（模块=电子病历，功能=结构化书写/智能质控）
- "病案系统实现病案编码管理、流通功能、纸质病历管理" → product_capability（模块=病案管理，功能=编码/流通/纸质病历）
- "支持从标准 DICOM 3.0 接口的影像设备获取影像资料" → product_capability（模块=影像，功能=DICOM获取）
- "2018年8月国卫办医发〔2018〕20号文要求三级医院达到互联互通4级" → policy（发文号+要求）
- "系统可用性≥99.9%，故障响应≤15分钟" → metric（数值+单位+口径）

【绝对不抽】
- 公司简介、企业愿景、组织架构文字
- "随着医疗信息化的发展"类背景铺垫
- 免责声明、版权声明、目录、页眉页脚
- 纯过渡句、无信息量的形容词堆叠
- 空白占位、XXX、待补充、待定

【输出格式】严格 JSON，不要任何解释文字：
{
  "atoms": [
    {
      "atom_type": "metric",
      "title": "电子病历应用水平达 5 级",
      "body": "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
      "subject_key": "metric:电子病历应用水平分级|国家卫健委评测",
      "attributes": { "value": 5, "unit": "级", "year": 2021, "scope": "国家卫健委评测", "polarity": "positive" },
      "source_quote": "……原文摘录，≤200 字，必须逐字来自片段……",
      "confidence": 0.92,
      "valid_from": "2021-01-01",
      "valid_until": null
    }
  ]
}

【硬约束】
1. title 必须是完整陈述句，禁止"电子病历分级情况"这类名词短语
2. body 不得包含任何套话，只写事实本身
3. source_quote 必须逐字来自原文，不得改写、不得拼接
4. subject_key 必须严格按格式：{类型}:{主体}|{限定}，主体和限定都用原文中的规范名称
5. 抽不出符合条件的内容时返回 {"atoms": []}，不要硬凑
6. 单篇最多 40 条
7. 数值必须有明确出处，推算出来的不抽`

/** 构造单段抽取消息 */
export function buildExtractionMessages(p: {
  /** 段落文本 */
  text: string
  /** 文档标题（给模型一点上下文，但要求只从 text 抽） */
  docTitle: string
  /** 段落序号（1 基）与总数，让模型知道这是片段 */
  index: number
  total: number
}): LlmMessage[] {
  const system = [
    EXTRACTION_SYSTEM_PROMPT,
    "",
    `【本次任务】这是《${p.docTitle}》的第 ${p.index}/${p.total} 个片段。`,
    "只从这个片段里抽原子，不要引入片段外的知识；抽不出就返回 {\"atoms\": []}。",
  ].join("\n")
  const user = [`【文档片段】`, p.text].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ===========================================================================
// 二、解析模型输出
// ===========================================================================

export type ExtractOneResult =
  | { ok: true; atoms: ExtractedAtom[]; dropped: { atom: ExtractedAtom; reasons: string[] }[] }
  | { ok: false; reason: string }

/**
 * 解析单段抽取结果：JSON 提取 → Zod 校验 → 质量过滤 → 归一化。
 *
 * 三道关：
 *   ① JSON 能否解析（模型偶尔输出带解释文字）
 *   ② Zod 结构校验（类型/长度/枚举）
 *   ③ 业务质量校验（套话/名词标题/缺数值/source_quote 是否逐字来自原文）
 */
export function parseSegmentExtraction(raw: string, sourceText: string): ExtractOneResult {
  const text = String(raw ?? "").trim()
  if (!text) return { ok: false, reason: "模型返回为空" }

  // 提取 JSON（容忍 ```json 包裹与前后解释文字）
  let parsed: unknown
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
    parsed = JSON.parse(cleaned)
  } catch {
    const m = /\{[\s\S]*\}/.exec(text)
    if (!m) return { ok: false, reason: "返回内容里没有 JSON" }
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return { ok: false, reason: "JSON 无法解析" }
    }
  }

  const schemaResult = parseExtractionResult(parsed)
  if (!schemaResult.ok) return { ok: false, reason: schemaResult.message }

  // 质量过滤 + 归一化（sanitizeExtraction 内部会做 subject_key 归一与 source_quote 校验）
  const sanitized = sanitizeExtraction({ atoms: schemaResult.data.atoms.slice(0, MAX_ATOMS_PER_SEGMENT) }, sourceText)
  return { ok: true, atoms: sanitized.atoms, dropped: sanitized.dropped }
}

// ===========================================================================
// 三、逐段抽取编排
// ===========================================================================

export type DocExtractResult = {
  /** 抽出的合格原子 */
  atoms: ExtractedAtom[]
  /** 被丢弃的（含原因，供审计"为什么这条没进库"） */
  dropped: { atom: ExtractedAtom; reasons: string[] }[]
  /** 段落统计 */
  segments: { total: number; succeeded: number; failed: number; empty: number }
  /** 失败段的错误（最多留 5 条，避免刷屏） */
  errors: string[]
}

export type DocExtractOptions = {
  /** 文档标题 */
  docTitle: string
  /**
   * 调用模型（由调用方注入，便于测试替身）。
   * 返回模型原始文本。
   */
  callLlm: (messages: LlmMessage[]) => Promise<string>
  /** 单段最多尝试次数（含首试），默认 2 */
  maxAttempts?: number
  /** 进度回调 */
  onProgress?: (done: number, total: number, info: { atoms: number; failed: boolean }) => void
  /** 只处理前 N 段（试跑用） */
  maxSegments?: number
  /**
   * 2026-10-31 优化：由调用方指定要抽的段落（而不是内部从头切）。
   *
   * 为什么需要：实测大文档（6-12 万字）的前 8 段往往是封面/目录/背景铺垫，
   * 提示词明令「绝对不抽」，导致整篇抽出 0 条原子。调用方可先用
   * kbParagraphValue.pickValuableParagraphs 挑出高价值段再传入。
   */
  paragraphs?: ParsedParagraph[]
}

/**
 * 整篇文档抽取：切段 → 逐段调模型 → 校验 → 汇总。
 *
 * 容错语义（与 PPT 逐页生成同口径）：
 *   某段失败只跳过该段；最终若**全部**失败才认为整篇失败。
 *   "抽不出内容"（空结果）不算失败——很多段落确实没有可抽的知识。
 */
export async function extractAtomsFromDoc(content: string, opts: DocExtractOptions): Promise<DocExtractResult> {
  // 2026-10-31：优先用调用方筛好的段落（跳过封面/目录/背景），否则内部切段
  const paragraphs = opts.paragraphs?.length ? opts.paragraphs : splitWithAnchor(content)
  if (!paragraphs.length) {
    return { atoms: [], dropped: [], segments: { total: 0, succeeded: 0, failed: 0, empty: 0 }, errors: ["文档没有可抽取的段落（正文为空或全是短行）"] }
  }

  const list = opts.maxSegments ? paragraphs.slice(0, opts.maxSegments) : paragraphs
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)

  const atoms: ExtractedAtom[] = []
  const dropped: { atom: ExtractedAtom; reasons: string[] }[] = []
  const errors: string[] = []
  let succeeded = 0
  let failed = 0
  let empty = 0

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i]
    let segOk = false
    let lastErr = ""
    for (let attempt = 0; attempt < maxAttempts && !segOk; attempt += 1) {
      try {
        // 2026-11-04（隐私巡检）：知识库可能存有合同/资质原文，这里把整段正文发往第三方云模型。
        // 全站口径是「原文进 AI 前一律 redactPii」，此处此前漏了。
        //
        // 两边统一用同一份脱敏文本（发送 + 逐字比对 + 落库引用都取自 safeText）：
        // 实测确认「只脱敏发送侧、比对用原文」并不会导致抽取失败（sanitizeExtraction 的逐字
        // 校验是子串包含，脱敏只让文本变短、不破坏未掩码部分的连续性），所以这里统一两边
        // 不是为了防丢数据，而是为了保证**落库的 source_quote/正文与模型看到的文本一致**，
        // 不出现「模型看掩码、库里存原文」这种无法解释的差异。
        const safeText = redactPii(p.text)
        const messages = buildExtractionMessages({ text: safeText, docTitle: opts.docTitle, index: i + 1, total: list.length })
        const raw = await opts.callLlm(messages)
        const parsed = parseSegmentExtraction(raw, safeText)
        if (!parsed.ok) {
          lastErr = parsed.reason
          continue
        }
        segOk = true
        if (parsed.atoms.length === 0) empty += 1
        else {
          succeeded += 1
          // 把 anchor 写进原子（供追溯；ExtractedAtom 本身不含 anchor，由调用方补）
          for (const a of parsed.atoms) {
            atoms.push(a)
            if (atoms.length >= MAX_ATOMS_PER_DOC) break
          }
          dropped.push(...parsed.dropped)
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (!segOk) {
      failed += 1
      if (errors.length < 5) errors.push(`第 ${i + 1} 段：${lastErr}`)
    }
    opts.onProgress?.(i + 1, list.length, { atoms: atoms.length, failed: !segOk })
    if (atoms.length >= MAX_ATOMS_PER_DOC) break
  }

  // 全部段落都失败（且一条都没抽到）才算整篇失败
  if (failed === list.length && atoms.length === 0) {
    return { atoms: [], dropped: [], segments: { total: list.length, succeeded: 0, failed, empty: 0 }, errors }
  }

  return {
    atoms,
    dropped,
    segments: { total: list.length, succeeded, failed, empty },
    errors,
  }
}

// ===========================================================================
// 四、入库前整理
// ===========================================================================

/** 入库用的原子（带 anchor 与来源） */
export type AtomForInsert = ExtractedAtom & {
  source_doc_id: string
  source_anchor: string
  /** 低置信标记（§4.2：<0.55 强制 pending 且标记） */
  lowConfidence: boolean
}

/**
 * 把抽出的原子配上 anchor，并标记低置信。
 *
 * ⚠️ 注意：**anchor 的精确匹配需要知道"这条来自哪个段落"**。
 * 当前实现按 source_quote 在全文里回找位置（可靠但 O(n*m)），
 * 生产可优化为抽取时就把段落 anchor 带回来——但那样要改提示词输出结构，
 * 会让模型输出变复杂、准确率下降。**这里选择"回找"，宁可慢一点也要准**。
 */
export function prepareAtomsForInsert(
  atoms: ExtractedAtom[],
  content: string,
  sourceDocId: string,
  paragraphs?: ParsedParagraph[],
): AtomForInsert[] {
  const paras = paragraphs ?? splitWithAnchor(content)
  return atoms.map((a) => {
    // 在段落里找包含该 source_quote 的那一段（取第一段匹配）
    const quoteHead = a.source_quote.replace(/[…\s]/g, "").slice(0, 30)
    const hit = paras.find((p) => p.text.replace(/\s/g, "").includes(quoteHead))
    return {
      ...a,
      source_doc_id: sourceDocId,
      source_anchor: hit?.anchor ?? "",
      lowConfidence: a.confidence < LOW_CONFIDENCE,
    }
  })
}

/** 抽取结果摘要（给用户看） */
export function extractSummary(r: DocExtractResult): string {
  const s = r.segments
  const bits = [`${s.total} 段`]
  if (s.succeeded) bits.push(`${s.succeeded} 段抽出内容`)
  if (s.empty) bits.push(`${s.empty} 段无可抽内容`)
  if (s.failed) bits.push(`${s.failed} 段失败`)
  bits.push(`共 ${r.atoms.length} 条原子`)
  if (r.dropped.length) bits.push(`${r.dropped.length} 条未通过质量校验`)
  return bits.join(" · ")
}
