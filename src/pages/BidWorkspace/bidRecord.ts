/**
 * 标书项目**记录层**：库列归一化 + 大纲草稿本地留档（纯函数 / 零 React / 零 hook 状态）。
 *
 * R1（整仓重构 · 标书内核拆分）从 `useBidWorkspace.ts` 原样搬出，**行为逐字不变**：
 * 这四块此前只能靠人眼在 1 万行里复核，搬出来才能被单测直接钉住。
 *
 * 搬家纪律（R1 红线）：
 *   · 只搬迁与封装，不改判定口径、不改文案、不改导出 API —— 调用点仍从
 *     `@/pages/BidWorkspace/useBidWorkspace` 取（那边保留了同名 re-export）。
 *   · 本模块**不引入 React**：`useBidWorkspace` 是 UI 编排层，这里是数据契约层。
 *   · 库列归一化必须「宽容缺列」：存量项目缺新列时给默认值，绝不能让归档页白屏
 *     （2026-10-27 `proj.bid_chapters.filter is not a function` 事故）。
 */
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { OpportunityRow } from "@/pages/CustomerManagement/customerTypes"
import {
  normalizeAiReview,
  normalizeBasisExtra,
  normalizeBasisStyle,
  normalizeBidDefense,
  normalizeDeviationTable,
  normalizeFormatCheckItems,
  normalizeFormatSettings,
  normalizeGenOptions,
  normalizeOrchestration,
  normalizeParseReport,
  normalizeStageGates,
  normalizeSubmissionCheck,
  normalizeTextAudit,
  normalizeVoidCheck,
  scoringItemsFromReport,
  type BidProjectRecord,
  type BidResult,
  type BidStage,
  type ClauseGranularity,
} from "./bidTypes"
import { normalizeTenderFiles } from "./tenderFiles"

/**
 * 数组类 JSON 列的安全取值（2026-10-27 事故：打开已归档项目报
 * `proj.bid_chapters.filter is not a function`）。
 *
 * 成因：PocketBase 的 json 列正常会返回已解析的数组；但当列里存的是**空字符串**
 * （例如运维脚本把列置空、或历史数据被清成 `''`）时，它不是合法 JSON，
 * PocketBase 原样返回字符串，于是 `rec.bid_chapters ?? []` 的兜底不生效
 * ——`??` 只挡 null/undefined，挡不住 `''`——下游 `.filter/.map/.length` 全部炸。
 *
 * 这里统一收口：非数组一律归一为 `[]`（字符串 `'[]'` 也顺手解析），
 * 保证进到 UI 的这三列永远是数组。
 */
export function asArrayField<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === "string") {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed: unknown = JSON.parse(s)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// 2026-11-03：未确认的大纲草稿本地留档（纯 localStorage，零 collection 变更）。
//
// 背景：AI 生成的大纲在用户点「确认大纲」之前只存在于 React 内存，刷新/切页即丢，
// 等于要重新付费生成一次。这里按项目 id 落一份草稿：
//   · 非空且与项目已确认大纲（bid_outline）不一致 → 写草稿（= 还没确认的那一份）；
//   · 为空、或已与 bid_outline 完全一致（= 已入库，含「确认大纲」与「重置项目」）→ 清草稿。
// 读写全部 try/catch：隐私模式 / 超配额时静默降级为只在内存，绝不阻断大纲编辑。
// ---------------------------------------------------------------------------
const OUTLINE_DRAFT_KEY_PREFIX = "xz.bid.outlineDraft."

/** 读回未确认的大纲草稿；无草稿 / 解析失败 / 存储不可用一律返回 null。 */
export function readOutlineDraft(projectId: string | null | undefined): OutlineNode[] | null {
  if (!projectId) return null
  try {
    const raw = window.localStorage.getItem(OUTLINE_DRAFT_KEY_PREFIX + projectId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return null
    return parsed as OutlineNode[]
  } catch {
    return null
  }
}

/** 落一份未确认的大纲草稿（存储不可用时静默降级，不阻断编辑）。 */
export function writeOutlineDraft(projectId: string | null | undefined, nodes: OutlineNode[]): void {
  if (!projectId) return
  try {
    window.localStorage.setItem(OUTLINE_DRAFT_KEY_PREFIX + projectId, JSON.stringify(nodes))
  } catch {
    /* 存储不可用：草稿只在内存，不阻断编辑 */
  }
}

/** 清掉指定项目的草稿（确认大纲 / 重置项目 / 草稿已入库时调用）。 */
export function clearOutlineDraft(projectId: string | null | undefined): void {
  if (!projectId) return
  try {
    window.localStorage.removeItem(OUTLINE_DRAFT_KEY_PREFIX + projectId)
  } catch {
    /* 同上 */
  }
}

/**
 * 库记录 → 页面记录：把每个可能缺列的字段归一成页面可直接消费的形状。
 *
 * 逐字段的本轮改造注释保留在下方：它们记录的是**哪一轮为什么加这一列**，
 * 删掉会让后来者看不出「这个默认值是被事故逼出来的」。
 */
export function normalizeRecord(rec: BidProjectRecord): BidProjectRecord {
  const resultRaw = (rec.bid_result ?? "") as BidResult
  const amountRaw = Number(rec.bid_amount)
  // 第五轮改造 1：生成设置字段（老项目缺列时容错为默认值：页数 null / 级数 0 / 配图按记录 / 维度按系统 / 小节字数 null→800）
  const pagesRaw = Number(rec.target_pages)
  const levelRaw = Number(rec.outline_level)
  const sectionWordsRaw = Number(rec.section_words)
  const granRaw = String(rec.clause_granularity ?? "")
  // 第九轮改造 2：解析报告先归一化，交卷体检 severity 推导需要评分项分值
  const parseReport = normalizeParseReport(rec.parse_report)
  return {
    ...rec,
    tender_no: rec.tender_no ?? "",
    hospital: rec.hospital ?? "",
    bid_open_date: rec.bid_open_date ?? "",
    stage: (rec.stage as BidStage) ?? "pending_parse",
    tender_text: rec.tender_text ?? "",
    // 2026-10-21：多份招标文件清单（存量项目缺列容错为空数组=单段文本，行为不变）
    tender_files: normalizeTenderFiles(rec.tender_files),
    parse_report: parseReport,
    parse_config: rec.parse_config ?? null,
    bid_outline: asArrayField(rec.bid_outline),
    bid_chapters: asArrayField(rec.bid_chapters),
    response_map: normalizeDeviationTable(rec.response_map),
    dup_report: rec.dup_report ?? null,
    // 第九轮改造 2：旧 void_check（verdict 三态）容错映射到新 status 契约
    void_check: normalizeVoidCheck(rec.void_check),
    // 第九轮改造 3：旧 ai_review 没有三路字段时容错为空数组（自动归技术路）
    ai_review: normalizeAiReview(rec.ai_review),
    manual_review: rec.manual_review ?? null,
    // 第四轮改造新增字段：存量老项目没有这些列，统一给默认空值防崩
    opportunity_id: rec.opportunity_id ?? "",
    bid_result: resultRaw === "won" || resultRaw === "lost" || resultRaw === "pending" ? resultRaw : "",
    bid_amount: Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null,
    lost_reason: rec.lost_reason ?? "",
    result_synced_at: rec.result_synced_at ?? "",
    // 第五轮改造新增字段：存量老项目没有这些列，统一给默认值防崩
    target_pages: Number.isFinite(pagesRaw) && pagesRaw > 0 ? Math.min(9999, Math.round(pagesRaw)) : null,
    outline_level: levelRaw === 1 || levelRaw === 2 || levelRaw === 3 ? levelRaw : 0,
    figures_enabled: typeof rec.figures_enabled === "boolean" ? rec.figures_enabled : true,
    clause_granularity: granRaw === "l2" || granRaw === "l3" ? (granRaw as ClauseGranularity) : "system",
    section_words:
      Number.isFinite(sectionWordsRaw) && sectionWordsRaw >= 400 && sectionWordsRaw <= 5000
        ? Math.round(sectionWordsRaw)
        : null,
    // 第十三轮改造 3：存量项目没有 gen_options 列时容错为全 false（行为与现状一致）
    gen_options: normalizeGenOptions(rec.gen_options),
    // 第十六轮 B1 改造 1.1：存量项目没有 global_facts 列时容错为空串（回退本地自动抽取，行为与现状一致）
    global_facts: typeof rec.global_facts === "string" ? rec.global_facts : "",
    // 第十六轮 B2 改造 2.1：存量项目没有 orchestration / max_figures 列时容错（null=未编排走旧逻辑 / 留空=不限）
    orchestration: normalizeOrchestration(rec.orchestration),
    max_figures:
      rec.max_figures !== null && rec.max_figures !== undefined && Number.isFinite(Number(rec.max_figures))
        ? Math.min(99, Math.max(0, Math.round(Number(rec.max_figures))))
        : null,
    // 第十七轮 17B：存量项目没有 compilation_basis_extra / basis_style 列时容错（null=未补选 / ""=未设置样式，消费侧默认 table）
    compilation_basis_extra: normalizeBasisExtra(rec.compilation_basis_extra),
    basis_style: normalizeBasisStyle(rec.basis_style),
    // 第十七轮 17C：存量项目没有 format_settings / format_check_items 列时容错（null=导出走现状默认 / 检查项视为全开）
    format_settings: normalizeFormatSettings(rec.format_settings),
    format_check_items: normalizeFormatCheckItems(rec.format_check_items),
    // 第十七轮 17D：存量项目没有 ref_template_text / ref_materials_text 列时容错为空串（未导入，消费侧静默降级）
    ref_template_text: typeof rec.ref_template_text === "string" ? rec.ref_template_text : "",
    ref_materials_text: typeof rec.ref_materials_text === "string" ? rec.ref_materials_text : "",
    // 循环 2 批 1-4：存量项目没有 identity_words 列时容错为空串（未设置身份词，暗标脱敏只走通用规则）
    identity_words: typeof rec.identity_words === "string" ? rec.identity_words : "",
    // 第六轮改造：存量项目没有 bid_defense 列时容错为空结构
    bid_defense: normalizeBidDefense(rec.bid_defense),
    // 第七轮改造 5：存量项目没有 submission_check 列时容错为 null（第九轮扩展 severity/核销字段）
    submission_check: normalizeSubmissionCheck(rec.submission_check, scoringItemsFromReport(parseReport)),
    // T18：存量项目没有 text_audit 列时容错为 null
    text_audit: normalizeTextAudit(rec.text_audit),
    // 第九轮改造 1：存量项目没有 stage_gates 列时容错为 {gates:[]}
    stage_gates: normalizeStageGates(rec.stage_gates),
    // 第十一轮改造 1：存量项目没有 archived / deleted_at 列时容错（false / 空串=未删）
    archived: rec.archived === true,
    deleted_at: typeof rec.deleted_at === "string" ? rec.deleted_at : "",
  }
}

/** 商机下拉排序：客户医院名与项目医院模糊互含的排前面，其余按更新时间倒序 */
export function sortOppsByHospital(list: OpportunityRow[], hospital: string): OpportunityRow[] {
  const hosp = hospital.trim()
  const matched: OpportunityRow[] = []
  const rest: OpportunityRow[] = []
  for (const o of list) {
    const name = (o.customer_name ?? "").trim()
    if (hosp && name && (name.includes(hosp) || hosp.includes(name))) matched.push(o)
    else rest.push(o)
  }
  const byUpdated = (a: OpportunityRow, b: OpportunityRow) => (b.updated ?? "").localeCompare(a.updated ?? "")
  return [...matched.sort(byUpdated), ...rest.sort(byUpdated)]
}
