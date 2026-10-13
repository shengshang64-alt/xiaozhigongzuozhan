import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import { pbJsonRequest } from "@/lib/pbJson"
import { extractJsonCandidate } from "@/lib/jsonTolerant"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import type { LlmMessage } from "@/lib/llm"
import {
  chatViaGateway,
  costTextForModel,
  modelRefKey,
  nextDegradedBudget,
  personalTimeoutError,
  resolveAvailableModels,
  shouldDegradeRetry,
  TIMEOUT_RETRY_MIN_TOKENS,
  type ModelRef,
} from "@/lib/modelGateway"
// R180：按模型实测延迟自适应首轮预算（r177-followup 残项落地，会话内存零持久化零 collection）
import { noteKnownGoodBudget, noteThinkingEmptyReply, observeModelCall, suggestInitialBudget } from "@/lib/latencyBudget"
// Q28 切片F：上游 429 限流的会话内冷却闸门（并发 worker 取号错峰，见模块头注释）
import { noteCallSucceeded, noteRateLimited, waitCallSlot } from "@/lib/rateLimitGate"
// R191：长文「单次调用输出预算」分块口径（网关 120s 红线实测，见模块头注释）
import { longformCallTokens, planLongformChunks, shouldDisableThinking, stripDuplicateSectionHead } from "./longformBudget"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import { useScopeSkills } from "@/hooks/useScopeSkills"
import { injectSkillBlock, skillBlockFor, skillCostSuffix, type SkillScope } from "@/lib/skillCore"
// R159：招标文本标注符号丢失检测（素材完整性·零费用纯函数）
import { detectMarkerSymbolLoss, markerLossNotice } from "./materialIntegrity"
// R167：标书优质素材库（五类标准件）——分类基线取用与素材库读写（纯本地，零 AI）
import {
  COMPANY_DEFAULTS,
  MATERIAL_KIND_MAP,
  autoClassifyLibrary,
  baselineMarkForKind,
  composeRefMaterials,
  libraryBaselineFor,
  libraryFilledKinds,
  libraryKindFor,
  parseMaterialLibrary,
  renderMaterialLibrary,
  type MaterialKind,
  type MaterialLibrary,
} from "./materialLibrary"
import {
  addChildToTree,
  deepCopyOutline,
  makeUid,
  moveNodeInTree,
  normalizeOutline,
  outlineToText,
  parseOutlineJson,
  removeNodeFromTree,
  renameNodeInTree,
  type Chapter,
  type FigureSpec,
  type OutlineNode,
  type SolutionRecord,
} from "@/pages/SolutionStudio/solutionTypes"
import {
  aggregateAuditByChapter,
  assignClausesToChapters,
  applyFactPatchItems,
  assignScoringToChapters,
  backfillResponseTags,
  attachFigureCaptions,
  buildBidChapterMessages,
  buildBidContinueMessages,
  buildBidOutlineMessages,
  buildBidRefineMessages,
  buildBidSectionMessages,
  buildChapterDigest,
  buildCommercialSectionText,
  buildCoverageAuditMessages,
  buildReflowDirective,
  collectReflowFixItems,
  buildDefenseAnswerMessages,
  buildDefenseOutlineMessages,
  buildDefenseQuestionsMessages,
  buildDeviationMapMessages,
  buildDirectedFactsBlock,
  buildDupJudgeMessages,
  buildEvalCommercialMessages,
  buildEvalFormatMessages,
  buildEvalMessages,
  buildFactCheckMessages,
  buildFactPatchMessages,
  buildFactSettingsMessages,
  buildJsonRepairMessages,
  buildOrchestrationMessages,
  buildOutlineChildrenMessages,
  buildOutlineFixMessages,
  buildOutlineLevel1Messages,
  buildSectionParseMessages,
  buildSectionResizeMessages,
  buildSpeechNotesMessages,
  buildSubmissionCheckMessages,
  buildSubmissionDigest,
  buildVoidCheckMessages,
  chapterOrchestration,
  chapterWordBudgets,
  chaptersToText,
  clipText,
    // 循环 8 A5：单项重解析成功后清除落库的失败横幅 warnings
  clearParseWarnings,
  clauseMatchesTitle,
  CLAUSE_GRANULARITY_LABEL,
  collectCommercialParagraphs,
  collectFactEvidence,
  collectLeafTitles,
  collectTechLeafRefs,
  combinedScoringText,
  commonSubstringLen,
  COMPLIANCE_MODE_DEFAULT,
  COMPLIANCE_MODE_SECTION_WORDS,
  daysUntil,
  defaultGenOptions,
  defaultParseConfig,
  defenseRefChapterText,
  deriveStage,
  deviationStats,
  effectiveGlobalFacts,
  effectiveGlobalFactsLines,
  effectiveMaxFigures,
  effectiveTargetPages,
  effectiveVoidStatus,
  emptyBidDefense,
  emptyStageGates,
  estimatePagesFromChars,
  formatCharsPerPage,
  estimatePagesFromText,
  extractImplicitConstraints,
  extractJsonLoose,
  normalizeTextAudit,
  extractPageCap,
  extractTemplateOutlineLines,
  extractRequirementClauses,
  extractLotsFromText,
  extractRequirementStructureFromText,
  extractRequiredPoints,
  extractStarClauses,
  lotsSectionFrom,
  mergeLotsScopeOnReparse,
  reqStructureSectionFrom,
  factSettingsSourceText,
  findGateRecord,
  // R31（prompt-matrix-02）：评分细项编号大纲承接对账（纯本地零 AI）
  findUncoveredScoringIds,
  numberScoringItems,
  BID_OUTLINE_REQ_KEY,
  // 第十七轮 17B：编制依据与规范库
  BASIS_CHAPTER_TITLE_RE,
  basisItemKey,
  basisListText,
  COMPILATION_BASIS_KEY,
  mergeBasisItems,
  mergeRequiredSections,
  normalizeBasisExtra,
  normalizeBasisStyle,
  parseBasisLines,
  DEFAULT_FORMAT_SETTINGS,
  findIntraDupPairs,
  findSuspectPairs,
  INTRA_DUP_THRESHOLD_DEFAULT,
  FORMAT_CHECK_KEYS,
  formatCheckReport,
  gatesAllConfirmed,
  gatesUnconfirmedCount,
  GATE_KINDS,
  GATE_LABEL,
  hasAnySection,
  hasBidComposition,
  insertClauseIntoOutline,
  isBizPart,
  isGenTargetChapter,
  normalizeBidScope,
  leafTargetFromPages,
  makeSnippet,
  markParseSectionStatus,
  MAX_TENDER_CHARS,
  missingSectionTitles,
  normalizeAiReview,
  normalizeBidDefense,
  normalizeDeviationTable,
  normalizeExtraKeys,
  normalizeFormatCheckItems,
  normalizeFormatSettings,
  normalizeBidSourceMode,
  SECTION_SYNONYM_FALLBACK,
  type BidSourceMode,
  normalizeGenOptions,
  normalizeOrchestration,
  normalizeParseReport,
  normalizeStageGates,
  normalizeSubmissionCheck,
  normalizeVoidCheck,
  // 循环 8 A4：本地零 AI 数字口径冲突检查（事实表 × 正文）
  numberConflictHits,
  // numeric-consistency-01：同一核对扩展到结构化面（事实表 × 偏离表/大纲）
  structuredNumberConflictHits,
  // prompt-fabscan-03（子集）：偏离表负偏离 surfaced 到交卷体检（只读既有 response_map、零 AI、只 warn）
  deviationCommitHits,
  // R187（r184-bid-amount-consistency-wiring）：金额大小写一致性——R184 确定性内核接入本地格式路（零 AI、只 warn）
  amountCaseMismatchHits,
  // numeric-consistency-02（做法 A）：投标报价 vs 最高限价/预算 方向性废标核对（纯本地、零 AI、只 warn）
  overPriceCeilingHits,
  // numeric-consistency-02（做法 B）：关联商机的报价单真实总额接入同一核对（跨模块取数、后端零改动）
  quoteRecordCeilingHits,
  pickLatestQuoteTotals,
  type QuoteTotalRef,
  // content-guard-02：本地零 AI 全文一致性拦截（指标口径唯一性 / 占位与绝对化承诺残留）
  metricConflictHits,
  metaLeftoverHits,
  // R32 批次2「生成后自动定向修复」：确定性代码清洗（装饰/元话语/加码降档），零 AI 零费用
  autoRepairChapter,
  outlineReqMatchRate,
  ORCHESTRATION_BATCH_SIZE,
  orchestrationProjectBrief,
  parseChapterOutput,
  parseConfigCount,
  parseChannelOf,
  PARSE_EXTRA_SECTIONS,
  parseFactSettingsLines,
  parseScoringLines,
  parseSectionTitle,
  prevChapterSummaries,
  rebuildSectionContent,
  requestedKeys,
  sectionCheckpointable,
  resolveLeafSection,
  retrieveTenderFragments,
  resultFollowContent,
  sanitizeAiReview,
  sanitizeChapterText,
  sanitizeCommercialChecks,
  sanitizeCoverageAudit,
  sanitizeDefenseOutline,
  sanitizeDefenseQuestions,
  sanitizeDeviationRows,
  sanitizeFactConflicts,
  sanitizeFactPatches,
  sanitizeFormatIssues,
  sanitizeOrchestrationBatch,
  sanitizeOutlineCoverage,
  normalizeSectionRawText,
  sanitizeSpeechNotes,
  sanitizeSubmissionCheck,
  sanitizeVoidCheck,
  scoringItemsFromReport,
  sealedIdentityBlock,
  sectionOrchestration,
  sectionText,
  selectOrchestrationFigures,
  sliceSectionPieces,
  SNAPSHOT_CONTENT_MAX,
  SNAPSHOT_RETAIN,
  STAGED_OUTLINE_LEAF_GOAL,
  starClauseCount,
  starClausesEnabled,
  starClausesPromptBlock,
  starClauseSectionFrom,
  displayStageLabel,
  parseBackfillFields,
  stepEntryMissing,
  stripOverlap,
  summarizeOrchestration,
  techChapters,
  techOutlineNodes,
  techOutlineLeafCount,
  acceptRewrittenOutline,
  trimOutlineDepth,
  trimToBudget,
  upsertParseSection,
  dedupeAcrossSections,
  validateOutlineShape,
  wrapGlobalFactsBlock,
  writtenSectionTitles,
  type AiReview,
  type BasisStyle,
  type BidDefense,
  type BidOrchestration,
  type BidProjectRecord,
  type BidResult,
  type BidStage,
  type BodyFormat,
  type ClauseGranularity,
  type CommercialCheck,
  type CompilationBasisPrompt,
  type CoverageAuditEntry,
  type CoverageAuditLeafInput,
  type DefenseOutlinePage,
  type DefenseQuestion,
  type DefenseSpeechNotes,
  type FactConflict,
  type DeviationTable,
  type DupPair,
  type DupReport,
  type FormatCheckKey,
  type FormatCheckReport,
  type FormatIssue,
  type BidScope,
  type ComplianceMode,
  type FormatSettings,
  type GateKind,
  type GenOptions,
  type HeadingFormat,
  type IntraDupPair,
  type LeafOrchestration,
  type ManualReview,
  type MergedOrchestration,
  type OutlineCoverageItem,
  type ParseChannel,
  type TextAuditReport,
  type ParseConfig,
  type ParseReport,
  type TableFormat,
  type TechLeafRef,
  type ParseScope,
  type ParseSection,
  type RequirementClause,
  type ReviewStatus,
  type StandardItem,
  type SnapshotStage,
  type StageSnapshotRow,
  type SubmissionCheck,
  type VoidCheck,
  type VoidItem,
  type VoidStatus,

  STAR_CLAUSE_SECTION,
  bulkQueueSave, bulkQueueLoad, bulkQueueClear, reportNeedsReparse, requiredParseFailures} from "./bidTypes"
import { scanPdfForSeal, type SealScanSummary } from "./sealDetect"
import {
  splitStarClauses,
  buildCommitmentLetter,
  upsertCommitment,
  upsertCommitmentOutline,
  COMMITMENT_CHAPTER_TITLE,
} from "./commitmentLetter"
// r277 切片1（评审报告驱动）：★引文保真 / 占位台账 / 形式质量三查（本地零 AI）
import { clauseResponsePromptBlock, upgradeClausesWithTender, starQuoteFidelityHits } from "./starClauseFidelity"
// r286（bid-l2-verbatim-compare 切片1）：引文级改写核对（本地零 AI，只报不拦）
// r287（切片2·整改回注）：同文件加命中定位与整改指令拼装，回注走小节重写通道
import { buildQuoteFixDirective, quoteRewriteFixTargets, quoteRewriteHits } from "./quoteFidelity"
import { placeholderLedgerHits } from "./placeholderLedger"
import {
  markdownResidueHits,
  numberingSequenceHits,
  extractDeadlineIso,
  deadlineDateHits,
  scheduleConsistencyHits,
} from "./formQualityHits"
// R-021 残句治理：大纲收尾本地质检（零 AI、零费用）
import { cleanOutlineResidue, type ResidueFix } from "./outlineResidue"
import { buildScoreCheckup } from "./scoreCoverageCheckup"
import { applyMustWrite, judgeMustWrite } from "./bidMustWrite"
import { readRequiredTechKeywords } from "./mustWriteConfig"
import { classifyOrigins, type CatalogDiff } from "./bidOutlineOrigin"
import { buildTechParamCoverage } from "./techParamCoverage"
import { findDemoScoreNodes, isDemoScoreTitle, summarizeDemoNodes } from "./demoSection"
import { buildDemoSkeleton, scoringStrategySuggestions, DEMO_SKELETON_MARK } from "./scoringStrategyCard"
// 第十三轮改造 3：素材优先注入——复用轮次 D 知识库块级检索（本地检索零 AI，命中为空静默跳过）
import { type KbDocRow } from "@/lib/kbCore"
import { getCachedVisibleDocs, getCachedVisibleDocsNonBlocking, prewarmKbCache, assembleKbContext } from "@/lib/kbAssemble"
import { deriveSection, deriveTrack } from "@/lib/kbTaxonomy"
import type { OpportunityRow } from "@/pages/CustomerManagement/customerTypes"
// numeric-consistency-02（做法 B）：只复用 PptQuote 的类型与纯函数 quoteTotal（无副作用依赖，不拉重模块进标书 chunk）
import { quoteTotal, type QuoteRecord } from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// 数据请求（走 __pb 代理自定义路由）
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return pbJsonRequest<T>(path, init)
}

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

/** 循环 6 A3：项目本体彻底删除后级联清理其阶段工作记录快照（best-effort，失败不阻断主删除） */
async function purgeProjectSnapshots(projectId: string): Promise<void> {
  try {
    const data = await apiFetch<ListResponse<StageSnapshotRow>>(
      `/api/bid_stage_snapshots?project_id=${encodeURIComponent(projectId)}&perPage=200`,
    )
    for (const it of data.items ?? []) {
      try {
        await apiFetch(`/api/bid_stage_snapshots/${it.id}`, { method: "DELETE" })
      } catch {
        /* 单条快照清理失败不阻断，孤儿条目不影响任何业务读取 */
      }
    }
  } catch {
    /* 快照列表拉取失败静默忽略：主删除已完成，不留残余阻断点 */
  }
}

// ---------------------------------------------------------------------------
// LLM 调用封装（统一模型网关：个人模型走 /api/model-gw/chat，平台模型 poll-first 由
// callLlmWithFallback 内部处理）
// ---------------------------------------------------------------------------

class AuthRequiredError extends Error {}

// 当前页面选用的模型（由 hook 内的模型选择器同步；null = 平台内置默认）
let activeModelRef: ModelRef | null = null

function llmErrorText(r: { error?: string; text?: string }): string {
  const e = (r.error ?? "").trim()
  if (!e) return "生成失败，请稍后重试"
  // 后端已返回可读中文文案时直接透出真实错误，避免吞细节
  return /[一-龥]/.test(e) ? e : "生成失败，请稍后重试"
}

async function llmGenerate(
  messages: LlmMessage[],
  maxTokens: number,
  scope?: SkillScope,
  temperature?: number,
  opts?: { disableThinking?: boolean },
): Promise<string> {
  // R180（r177-followup 残项落地）：把 120s 红线从「首调税」变成自适应起点——同模型
  // 会话内已证实超时/贴红线偏慢时，首调直接从已验证可用档起步（无验证档按折半）并同步
  // 关闭思考；无证据模型（首调或快模型）原样放行，行为与 R177 后完全一致。成功后回写
  // 验证档（只升不降），后续同请求免交重复超时。纯会话内存，见 lib/latencyBudget.ts。
  const latencyKey = activeModelRef ? modelRefKey(activeModelRef) : "platform"
  const bidMessages = injectSkillBlock(messages, skillBlockFor(scope))
  const suggest = suggestInitialBudget(latencyKey, maxTokens)
  const effTokens = suggest.tokens
  const effDisableThinking = !!opts?.disableThinking || suggest.disableThinking
  // Q28 切片F：并发 worker 共用限流闸门取号错峰——上游 TPM 按分钟滚动，同秒并发必撞 429
  await waitCallSlot()
  const gwReq = {
    modelRef: activeModelRef,
    messages: bidMessages,
    page: "bid-workspace",
    max_tokens: effTokens,
    // docs/07 §5.2（第 19 轮）：确定性任务（解析抽取 / JSON 语法修复）显式 temperature=0 降输出方差；
    // 未传（undefined）时保持模型默认，与其余调用行为、计费口径完全不变
    temperature,
    // T13：推理型模型思考耗尽输出配额会导致空回复，解析调用关闭思考（网关按 400 回退兜底）
    disableThinking: effDisableThinking,
  }
  let t0 = Date.now()
  let r = await chatViaGateway(gwReq)
  if (r.needsLogin) throw new AuthRequiredError("请求需要重新验证，请稍后重试")
  // Q28 切片F（实测根因）：个人密钥在「2.4~2.6 万字上下文 + 章间并发 2」下被上游秒拒
  // （~0.7s 返回「接口限流或余额不足（HTTP 429）」），而 R173 的 withTransientRetry 是零间隔
  // 立即重发、必然二次命中——一次限流就把整章打成 0 字 failed（实测 9 章批量 7 章 failed）。
  // 解析链路 T12b 早就用「退避 20s 重试一次」兜住同一问题，这里把该结论补到生成链路统一入口：
  // 退避后同参重发一次（参数、预算、计费口径均不变），仍限流则按既有文案透出真实原因。
  if (!r.ok && isRateLimitError(r.error ?? "")) {
    noteRateLimited()
    await waitCallSlot()
    t0 = Date.now()
    r = await chatViaGateway(gwReq)
  }
  // 成功返回说明限流窗已过：清连击计数，冷却不再逐次叠加
  if (r.ok) noteCallSucceeded()
  // R180：只记两类延迟证据——超时（累计证据）与成功返回（耗时判偏慢/释放证据）；
  // 内容审核 / 余额等非超时明确失败不反映该档位执行能力，不记
  // R203：网关可能已把本次请求改投备用通道（actualModelRefKey）——延迟证据要记到真正出活
  // 的那一路，免得备用通道的快慢污染用户所选通道的自适应预算起点
  const obsKey = r.actualModelRefKey ?? latencyKey
  if (personalTimeoutError(r.error)) observeModelCall(latencyKey, Date.now() - t0, "timeout")
  else if (r.ok && r.status === "success") observeModelCall(obsKey, Date.now() - t0, "success")
  // 生成链路 F1（R167）：推理型/vision 模型把 max_tokens 耗在「思考」上会返回 200 但 content 空，
  // 直接抛错会让批量逐章「0 成稿」、同参重试再空（网关 §5.2/T13 已记同类问题）。故对「成功但空回复」
  // 做一次关闭思考的降级重试，把最常见的选型/瞬时空返回兜住；仍空则维持既有抛错口径与计费不变。
  // 显式已关思考的调用（解析类）不重复重试，避免额外计费。
  // R192：网关把「200 但 content 空」标成 ok:false +「返回格式异常，回复内容为空」（model_gateway.pb.js
  // doChat 口径），原 F1 条件 r.ok && !text 在其出现时恒为 false——重试实为死代码，空回复直接
  // 抛错冒泡。这里把「网关报空回复错」并入口径：未关思考的调用同样做一次关思考降级重试。
  const gwEmptyReply = !r.ok && /回复内容为空|内容为空/.test((r.error ?? "").trim())
  if (!r.needsLogin && ((r.ok && r.status === "success" && !r.text?.trim()) || gwEmptyReply) && !effDisableThinking) {
    // Q28 切片E：本次已证实「该模型开思考却返回空正文」，先记证据位——本次重试与同模型
    // 后续所有首调都直接关思考，杜绝每个小节/每个精调候选都白烧一次 85s 级空回复（并发下会连锁 429）
    noteThinkingEmptyReply(latencyKey)
    const retry = await chatViaGateway({
      modelRef: activeModelRef,
      messages: bidMessages,
      page: "bid-workspace",
      max_tokens: effTokens,
      temperature,
      disableThinking: true,
    })
    if (retry.needsLogin) throw new AuthRequiredError("请求需要重新验证，请稍后重试")
    if (retry.ok && retry.status === "success" && retry.text?.trim()) {
      // R203：验证档记到实际出活的通道（备用通道成功不能给用户所选通道记功）
      noteKnownGoodBudget(retry.actualModelRefKey ?? latencyKey, effTokens)
      return retry.text
    }
    r = retry
  }
  // R177：超时是标书「只出几页 / 根本生成不出来」的真正根因——慢模型单个长小节实测 ~81s，
  // 偶发 >120s 被服务端（model_gateway.pb.js 红线，不可改）判超时 → 章节 0 字标 failed。
  // F1 只兜「成功但空回复」，兜不住超时失败。故对超时做自动降级重试：关闭思考 + 逐次缩减单次
  // 输出预算，让同一个小节在 120s 红线内跑完；小节级串行 + 自动补足链路后续补齐长度。
  // 命中非超时的明确失败立即透出；缩到下限仍超时才抛出可执行文案。非超时调用行为完全不变。
  if (shouldDegradeRetry(r.ok, r.error)) {
    // R180：阶梯从自适应起点 effTokens 继续降（原从 maxTokens 起步）
    let budget = effTokens
    while (budget > TIMEOUT_RETRY_MIN_TOKENS) {
      budget = nextDegradedBudget(budget)
      const dT0 = Date.now()
      const degraded = await chatViaGateway({
        modelRef: activeModelRef,
        messages: bidMessages,
        page: "bid-workspace",
        max_tokens: budget,
        temperature,
        disableThinking: true,
      })
      if (degraded.needsLogin) throw new AuthRequiredError("请求需要重新验证，请稍后重试")
      if (degraded.ok && degraded.status === "success" && degraded.text?.trim()) {
        // R180：记下已验证可用档，后续同请求直接从该档起步，不再首调交超时税
        observeModelCall(latencyKey, Date.now() - dT0, "success")
        noteKnownGoodBudget(latencyKey, budget)
        return degraded.text
      }
      if (!degraded.ok && !personalTimeoutError(degraded.error)) {
        // 非超时的明确失败（内容审核 / 余额等）不再盲目重试，直接透出真实原因
        throw new Error(llmErrorText(degraded))
      }
      if (!degraded.ok) observeModelCall(latencyKey, Date.now() - dT0, "timeout")
      r = degraded
    }
  }
  if (!r.ok || r.status !== "success" || !r.text) throw new Error(llmErrorText(r))
  // R180：首调（或 F1 重试后的 r）成功返回正文，验证当前档可用
  // R203：若本次由备用通道产出，验证档记到备用通道
  noteKnownGoodBudget(r.actualModelRefKey ?? latencyKey, effTokens)
  return r.text
}

/**
 * R191：长文目标的「分次累加」执行器（配合 ./longformBudget）。
 * 网关单次请求约 120s 红线不可改，而标书正文各链路把整段缺口一次性写进 prompt 的字数预算
 * （实测单小节 5409 字、整章缺口 53849 字、一键补齐 47900 字）——目标越大越必然超时，且超时
 * 的表现是「0 字 + 标 failed」而不是「少写一点」，于是正文永远停在十来页。
 * 这里把目标拆成红线内可完成的小块依序调用、逐块累加：每块把已产出的净新增文本回喂给调用方
 * 作衔接上下文（避免后块照抄前块），块间尊重取消标志，单块抛错由调用方兜底（已落库块不丢）。
 * @param oneCall 单块执行：入参 = 该块目标字数 + 已拼接的净新增文本，返回该块净新增（可为空串）
 * @returns 全部块的拼接结果（空串 = 本轮没产出任何内容）
 */
async function generateInChunks(
  targetChars: number,
  oneCall: (chunkChars: number, acc: string) => Promise<string>,
  opts?: { maxChunks?: number; shouldStop?: () => boolean; onChunk?: (acc: string) => void },
): Promise<string> {
  const plan = planLongformChunks(targetChars, { maxChunks: opts?.maxChunks })
  let acc = ""
  for (const chunkChars of plan) {
    if (opts?.shouldStop?.()) break
    const piece = ((await oneCall(chunkChars, acc)) ?? "").trim()
    if (!piece) continue
    acc = acc ? `${acc}\n\n${piece}` : piece
    opts?.onChunk?.(acc)
  }
  return acc
}

import {
  buildDegradedSectionContent,
  isMissingSectionResult,
  isRateLimitError,
  selectRelevantChunks,
  SECTION_KEYWORDS,
  type RetrievalSource,
} from "./prompts/tenderRetrieval"
import { buildScoringMaterial } from "./prompts/tenderStructure"
import { buildWordAdjustmentMessages } from "./prompts/wordAdjust"
import { buildMermaidRepairMessages } from "./prompts/mermaidFigure"
import { repairMermaidCode } from "./mermaidFigure"
import { buildAiImagePrompt, AI_IMAGE_MODEL, AI_IMAGE_PAGE } from "./prompts/aiImage"
import { applyAiFigureToChapters, collectAiFigureTargets, leafTitleOf } from "./aiFigure"
// Q28 切片G：编排配图补齐——缺图判定 / 单图小请求提示词 / 严格解析 / 图位锚点（纯函数层，见模块注释）
import {
  applyFigureAnchors,
  buildFigureBackfillMessages,
  collectFigureBackfillTargets,
  collectFigurePlacements,
  parseFigureBackfill,
} from "./prompts/figureBackfill"
import { callAigcAndPoll, persistMediaUrl, previewAigcPrice, uploadAigcMedia } from "@/lib/aigc"
import {
  addFigureTemplate,
  figureKindFromName,
  listFigureTemplates,
  removeFigureTemplate as removeFigureTemplateRecord,
  type FigureTemplate,
  type FigureTemplateKind,
} from "./figureAssets"
import {
  buildVerifiedExcerpt,
  lineAt,
  sanitizeLogicFindings,
  sanitizeTypoFindings,
  splitAuditDoc,
  type AuditDoc,
  type LogicFinding,
  type TypoFinding,
} from "./textAudit"
import { buildLogicCheckMessages, buildTypoCheckMessages } from "./prompts/textAudit"
// D3/R89：AI 内容护栏（只报不拦）——逐章规则②量化依据/③量级自洽/④政策时效检测 + 无人值守预算闸
import {
  buildConsistencyGuardMessages,
  checkBudgetGate,
  readTodayAiUsage,
  recordAiCall,
  sanitizeConsistencyIssues,
  type ConsistencyIssue,
} from "./prompts/consistencyGuard"
import { createSubmissionTracker } from "./submissionTracker"
import { hasPendingSections, isIncompleteSectionChapter, isTrulyDoneChapter, planSectionResume, reflowStatsAfterAppend, sectionGenStatus, withTransientRetry } from "./chapterCompletion"
import { buildOutlineGateReviewMessages, sanitizeOutlineGateReview } from "./prompts/outlineGate"
import {
  adjustGranularity,
  applyWordAdjustmentOps,
  maxChangeWordsFor,
  normalizeWordAdjustmentOps,
  pickWordRefineTargets,
  validateAdjustmentResult,
} from "./wordAdjust"
import {
  buildSegmentMergeMessages,
  buildWholeParseMessages,
  flattenParseItemJson,
  isJsonParseItem,
  PARSE_SEGMENT_CHARS,
  PARSE_WARMUP_DELAY_MS,
  parseSegmentCap,
  WHOLE_FILE_LIMIT,
} from "./prompts/wholeParse"
import { splitTenderText } from "./prompts/tenderSplit"
import { buildScoringStructured, selfCheckScoringTotal, type ScoringBlockJSON } from "./parseSchemas"
import { buildVoidScopeMessages, buildVoidInitialCheckMessages, buildVoidFinalizeMessages } from "./prompts/voidCheckRounds"
import { voidClauseFloorWarning } from "./voidClauseFloor"
import { coverageLevel, coveragePercent, missingCriticalSections, parseCoverageRatio } from "./parseCoverage"
import { assessTenderParseQuality } from "./parseQuality"

const MAX_TOKENS_OUTLINE = 4096
// Q28 切片D：结构修复/门禁修复是「整树重写」调用，70 叶大纲的 JSON 远超 4096 token，
// 沿用旧值必被截断（截断后模型补全会整段丢尾部章节）；网关出站上限 16384，取 8192
const MAX_TOKENS_OUTLINE_FIX = 8192
// 生成链路 D2 配套：同一项目的 persist 串行发送——updateProject 每次携带全量快照，
// 串行链保证「较新快照必然后发」，杜绝并发批量下旧快照 PATCH 覆盖丢正文
const persistChain = new Map<string, Promise<unknown>>()

const MAX_TOKENS_LONGFORM = 8192
// Q28 切片G：单张补齐配图的小请求预算——结构化 JSON、元素 ≤8，1200 token 足够，
// 且刻意把上下文压到千字级摘录（不重烧整章），限流窗下补齐链路比正文生成容易得多
const FIGURE_BACKFILL_MAX_TOKENS = 1200
// T13：网关出站上限 16384（model_gateway.pb.js）——空回复翻倍重试的封顶值
const MAX_TOKENS_HARD_CAP = 16384

/**
 * 循环 2 批 1-2：LLM JSON 修复重试——本地宽松解析抛错后，让模型对原始输出做一次
 * 「只修语法不改内容、截断补全」的修复（buildJsonRepairMessages），再走同一解析函数；
 * 修复调用失败或二次解析仍失败时抛原错误（不掩盖原始失败原因）。
 * 费用含在各入口原有的费用确认内，不单独弹确认。
 *
 * R290（2026-10-13 真实场景实测·主导者）新增「散文输出」处置分支：
 * 实测安庆二院真实招标文件（CG-AQ-2021-5149）生成大纲时，模型 bailing/Ling-3.1-flash 首次
 * 返回的是英文推理散文（"Let me analyze the requirements carefully: …"，3000+ 字符、无任何 JSON），
 * 随后把这段散文喂给 buildJsonRepairMessages 做「JSON 语法修复」——但散文里根本没有 JSON 可修，
 * 修复调用只回 28 token 的一句话「原始输出为纯散文式分析文本，不含任何 JSON 结构，无法在不编造
 * 内容的前提下修复为合法 JSON」，二次解析仍失败，最终大纲为空。
 * 症状极坏：链路上没有任何报错透出，用户只看到「大纲为空」，既不知道失败也不知道原因，
 * 而这里恰恰是最该报错的地方（大纲是后续正文的唯一输入源）。
 * 处置：识别「输出中不存在任何 JSON 候选」这一根因后，**不再做无意义的语法修复**，
 * 改为抛出带根因与处置建议的可读错误，由调用方透出——宁可明确失败，不可静默产出空大纲。
 */
async function withJsonRepair<T>(raw: string, parseFn: (text: string) => T): Promise<T> {
  try {
    return parseFn(raw)
  } catch (origErr) {
    if (origErr instanceof AuthRequiredError) throw origErr
    // 根因判定：模型压根没给 JSON（返回了散文/推理过程/空回复）。
    // 此时「只修语法」在原理上必然失败，白花一次调用且掩盖真实原因 → 直接抛可读错误。
    if (!extractJsonCandidate(raw)) {
      const head = String(raw ?? "").trim().slice(0, 60)
      throw new Error(
        `模型未按 JSON 格式返回（本次返回的是${raw ? `非结构化文本，如「${head}…」` : "空内容"}），` +
          `已中止而非生成空结果。请重试；若反复出现，请在「模型配置」切换其他模型，或减少本次生成的输入规模。`,
      )
    }
    let repaired: string
    try {
      repaired = await llmGenerate(buildJsonRepairMessages(raw), MAX_TOKENS_LONGFORM, undefined, 0)
    } catch (repairErr) {
      if (repairErr instanceof AuthRequiredError) throw repairErr
      throw origErr
    }
    try {
      return parseFn(repaired)
    } catch {
      throw origErr
    }
  }
}

/** R-028（R254）废标检查真三轮递进（定位→初检→定稿，易标方式恢复）：三轮任一异常由调用方降级单轮；用户授权 3 次模型调用 */
async function runVoidCheckThreeRounds(clauses: string[], bidText: string, starBlock: string): Promise<VoidCheck> {
  const scopeRaw = await llmGenerate(buildVoidScopeMessages(clauses, bidText, starBlock), MAX_TOKENS_LONGFORM)
  const scope = await withJsonRepair(scopeRaw, extractJsonLoose)
  const initRaw = await llmGenerate(buildVoidInitialCheckMessages(scope, bidText), MAX_TOKENS_LONGFORM)
  const initial = await withJsonRepair(initRaw, extractJsonLoose)
  const finalRaw = await llmGenerate(buildVoidFinalizeMessages(initial, bidText), MAX_TOKENS_LONGFORM)
  return sanitizeVoidCheck(await withJsonRepair(finalRaw, extractJsonLoose), clauses)
}

/** 事实清单解析：先按逐行文本口径；为空再尝试 JSON 字符串数组（修复调用可能输出 JSON 形态） */
function factLinesFromText(text: string): string[] {
  const direct = parseFactSettingsLines(text)
  if (direct.length) return direct
  try {
    const data = extractJsonLoose(text)
    const arr = Array.isArray(data) ? data : []
    const strs = arr.map((x) => (typeof x === "string" ? x : "")).filter(Boolean)
    return strs.length ? parseFactSettingsLines(strs.join("\n")) : []
  } catch {
    return []
  }
}

// 自动补足循环：每章最多续写轮数 / 达标线（预算的 90%）/ 单轮新增低于此字数视为模型写不动，提前熔断
const MAX_SUPPLEMENT_ROUNDS = 8
// T15：字数局部精调——每个带外小节/整章的精调轮数上限（对齐易标 MAX_WORD_ADJUSTMENT_ROUNDS=3 的收敛约束）
const WORD_REFINE_ROUNDS_PER_TARGET = 2
// T18：文本审计分段字数上限（易标 rollingSegmentLimitRatio 语义的简化：段长上限按主力模型上下文保守取值）
const TEXT_AUDIT_SEGMENT_CHARS = 45000

/** T18：错别字跨段合并去重（同章+同错字+同位置保留一条；不同位置的同词错字各自保留） */
function mergeFindings(list: TextAuditReport["typos"]): TextAuditReport["typos"] {
  const seen = new Set<string>()
  const out: TextAuditReport["typos"] = []
  for (const t of list) {
    const key = `${t.docId}\u0000${t.wrongText}\u0000${t.correctText}\u0000${t.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.slice(0, 60)
}

/** T18：逻辑问题跨段合并去重（同章+同标题+同理由保留一条） */
function mergeLogic(list: TextAuditReport["logic"]): TextAuditReport["logic"] {
  const seen = new Set<string>()
  const out: TextAuditReport["logic"] = []
  for (const l of list) {
    const key = `${l.docId}\u0000${l.title}\u0000${l.fallacyReason}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out.slice(0, 60)
}
const SUPPLEMENT_TARGET_RATIO = 0.95
const SUPPLEMENT_MIN_GAIN = 200

// 第八轮改造 3：章节预算超过该字数且小节数 ≥2 时改走小节级串行生成（单次输出受 max_tokens 物理上限约束）
const SECTION_GEN_MIN_BUDGET = 4500
// 小节级生成的单小节预算下限
const SECTION_MIN_BUDGET = 600

/**
 * 第八轮改造 1：解析分段编排——文本超 MAX_TENDER_CHARS 时切块串行调用（每块同一 build 构造 prompt），
 * 单块失败重试 1 次后跳过并记入 failedChunks（1 起的段号），成功块本地合并（按块序拼接 + 行级去重）；
 * 不超长时单块单次调用，行为与现状完全一致。
 */
/**
 * T12 易标解析思路复用（2026-09-28）：单项解析 = 按项关键词检索选块 → 一次受限调用 → 纯文本直出落库。
 * 取代旧「14k 盲窗口多段 + JSON 契约 + 宽松解析/模型修复/字段正则清洗」多层有损链路（「解析有点乱」根因）；
 * AI 失败由调用方降级为本项检索原文展示（buildDegradedSectionContent），429/限流由调用方熔断剩余项。
 * T13（2026-09-28 用户反馈轮「评分办法解析不到」）：
 *  - tech_score/biz_score 主路径改为评分章节定向素材（buildScoringMaterial：前附表评标方法行 + 评分章全文），
 *    不再让设备参数表的关键词命中把评分表挤出候选；定位失败回退通用检索；
 *  - 空回复重试：推理型模型可能把 max_tokens 全花在思考上致 content 为空（网关报「回复内容为空」），
 *    翻倍输出上限重试一次（8192→16384），仍失败才交调用方降级。
 */
// Q28 切片C：同义词扩展分块检索——合并主关键词 + 回补同义词后重新选块
function selectRelevantChunksWithSynonyms(text: string, key: string, extraKeywords: string[]): RetrievalSource {
  const origList = SECTION_KEYWORDS[key] ?? []
  SECTION_KEYWORDS[key] = [...origList, ...extraKeywords]
  const result = selectRelevantChunks(text, key)
  SECTION_KEYWORDS[key] = origList
  return result
}

/** R-026（R253）：解析项落库载荷——行式文本 content + 可选评分结构化对象（仅 whole JSON 通道的 tech_score/biz_score 产出） */
type ParsePayload = { text: string; structured?: ScoringBlockJSON }

async function parseSectionViaRetrieval(text: string, key: string): Promise<ParsePayload> {
  const isScoringKey = key === "tech_score" || key === "biz_score"
  const scoringMaterial = isScoringKey ? buildScoringMaterial(text) : ""
  const src = scoringMaterial
    ? { mode: "retrieval" as const, text: scoringMaterial, selected: [], totalChunks: 0 }
    : selectRelevantChunks(text, key)
  const attempt = (maxTokens: number) =>
    llmGenerate(buildSectionParseMessages(key, src.text, { sourceMode: src.mode }), maxTokens, "bid-parse", 0, { disableThinking: true })
  let raw: string
  try {
    raw = await attempt(MAX_TOKENS_LONGFORM)
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    // 空回复（推理模型思考耗尽输出配额）→ 翻倍 max_tokens 重试一次
    if (!/回复内容为空|内容为空|返回格式异常/.test(msg)) throw e
    raw = await attempt(MAX_TOKENS_HARD_CAP)
  }
  return { text: normalizeSectionRawText(key, raw) }
}

// ---------------------------------------------------------------------------
// T14（2026-09-29）整文直读通道（易标 bid-analysis 方式移植）：
//   整文 JSON/markdown 契约 → 超限切段合并 → retrieval 兜底，路由见 parseSectionItem。
// ---------------------------------------------------------------------------

/** 整文通道单次调用：system 稳定 → user 完整文件 → user 任务（跨项同前缀吃提示词缓存）；空回复翻倍重试与检索通道同口径 */
async function parseSectionViaWholeFile(text: string, key: string): Promise<ParsePayload> {
  const attempt = (maxTokens: number) =>
    llmGenerate(buildWholeParseMessages(key, text), maxTokens, "bid-parse", 0, { disableThinking: true })
  let raw: string
  try {
    raw = await attempt(MAX_TOKENS_LONGFORM)
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (!/回复内容为空|内容为空|返回格式异常/.test(msg)) throw e
    raw = await attempt(MAX_TOKENS_HARD_CAP)
  }
  return materializeWholeParseResult(key, raw)
}

/** 整文原始输出 → 落库文本：JSON 项走宽松解析+模型修复+摊平成行式文本（下游 extractScoringFromText 等零改动）；
 *  JSON 解析彻底失败回退原文清洗（不浪费一次成功调用）；全字段「没有提及」摊平为空 → 落「原文未提及」走 miss 态。 */
async function materializeWholeParseResult(key: string, raw: string): Promise<ParsePayload> {
  if (!isJsonParseItem(key)) return { text: normalizeSectionRawText(key, raw) }
  let obj: unknown
  try {
    obj = await withJsonRepair(raw, extractJsonLoose)
  } catch {
    return { text: normalizeSectionRawText(key, raw) }
  }
  const text = flattenParseItemJson(key, obj) || "原文未提及"
  // R-026（R253）：JSON 项摊平成行式文本落 content（下游零改动），同时保留结构化对象落 structured
  return { text, structured: buildScoringStructured(key, obj) }
}

/** 超限切段通道：按自然边界切段（各项之间段一致，缓存跨项复用）→ 每段同任务并发 → AI 合并（跨块汇总）；
 *  段数上限分层（R-038 Slice B）：废标/评分关键项放宽到整文全量覆盖（跨段合并 → 评分项/废标项跨块汇总），
 *  其余项沿用通用上限、超限回落检索通道（防「单项 × N 段」费用爆炸）；单段失败不拖垮其余段（合并以成功段为准）。 */
async function parseSectionViaSegments(text: string, key: string): Promise<ParsePayload> {
  const segments = splitTenderText(text, PARSE_SEGMENT_CHARS)
  if (segments.length > parseSegmentCap(key)) return parseSectionViaRetrieval(text, key)
  if (segments.length <= 1) return parseSectionViaWholeFile(segments[0] ?? "", key)
  const total = segments.length
  const results = await Promise.all(
    segments.map(async (seg, i) => {
      try {
        const content = await llmGenerate(
          buildWholeParseMessages(key, seg, { index: i + 1, total }),
          MAX_TOKENS_LONGFORM,
          "bid-parse",
          0,
          { disableThinking: true },
        )
        return { index: i + 1, total, content }
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e
        return { index: i + 1, total, content: "" }
      }
    }),
  )
  const ok = results.filter((r) => r.content.trim())
  if (!ok.length) throw new Error("分段解析全部失败，请重试")
  const merged = await llmGenerate(
    buildSegmentMergeMessages(key, ok, isJsonParseItem(key) ? "json" : "markdown"),
    MAX_TOKENS_LONGFORM,
    "bid-parse",
    0,
    { disableThinking: true },
  )
  return materializeWholeParseResult(key, merged)
}

/** 解析素材路由：whole=整文直读（≤上限）→ 超限切段合并；retrieval=既有按项关键词检索选块 */
async function parseSectionItem(text: string, key: string, channel: ParseChannel): Promise<ParsePayload> {
  if (channel === "retrieval") return parseSectionViaRetrieval(text, key)
  if (text.length <= WHOLE_FILE_LIMIT) return parseSectionViaWholeFile(text, key)
  return parseSectionViaSegments(text, key)
}

/** T16：生成产物中的 mermaid 配图逐张校验+修复（错误回传模型一次；修复仍失败弃图，不阻塞正文落库） */
async function repairMermaidFigures(figs: FigureSpec[]): Promise<FigureSpec[]> {
  const out: FigureSpec[] = []
  for (const f of figs) {
    if (f.type !== "mermaid") {
      out.push(f)
      continue
    }
    const fixed = await repairMermaidCode({
      code: f.code,
      regenerate: (badCode, error) =>
        llmGenerate(buildMermaidRepairMessages(f.title, badCode, error), MAX_TOKENS_LONGFORM, "bid-chapter", 0, {
          disableThinking: true,
        }),
    })
    if (fixed) out.push({ ...f, code: fixed })
  }
  return out
}

/** T14：单项重解析费用文案按实际通道路径（与批量解析的通道说明一致） */
function reparseCostDesc(text: string, cfg: ParseConfig | null | undefined): string {
  if (parseChannelOf(cfg) === "retrieval") {
    return text.length > MAX_TENDER_CHARS ? "（系统按本项关键词检索相关章节片段后解析，费用按实际用量累加）" : ""
  }
  if (text.length > WHOLE_FILE_LIMIT) return "（文件超长，将按段解析后合并，费用按实际用量累加）"
  return "（整文直读，费用按实际用量累加）"
}

// ---------------------------------------------------------------------------
// 第九轮改造 3：三路模拟评标（技术符合性 / 格式规范 / 商务要素）单路执行函数。
// 评标调用不带技能块（中立性，沿用交卷体检格局）；单路失败由调用方置 null，不拖垮整体。
// ---------------------------------------------------------------------------

export type EvalPath = "tech" | "format" | "commercial"

export const EVAL_PATH_LABEL: Record<EvalPath, string> = {
  tech: "技术评分",
  format: "格式规范",
  commercial: "商务要素",
}

/** 技术路：瑕疵制逐章打分（既有 buildEvalMessages，不动） */
async function runEvalTechCall(cur: BidProjectRecord): Promise<AiReview> {
  const scoring = scoringItemsFromReport(cur.parse_report)
  const raw = await llmGenerate(
    buildEvalMessages(combinedScoringText(cur.parse_report), bidChaptersFor(cur), {
      globalFacts: effectiveGlobalFacts(cur),
      outlineText: outlineToText(cur.bid_outline),
    }),
    MAX_TOKENS_LONGFORM,
  )
  return sanitizeAiReview(extractJsonLoose(raw), scoring)
}

/** 格式路：结构完整性 / 编号连续性 / 排版惯例 / 硬约束响应（大纲树 + 标题清单 + 正文采样 + 隐式硬约束） */
async function runEvalFormatCall(cur: BidProjectRecord): Promise<FormatIssue[]> {
  const raw = await llmGenerate(
    buildEvalFormatMessages(bidChaptersFor(cur), {
      outlineText: outlineToText(cur.bid_outline),
      implicitConstraints: extractImplicitConstraints(cur.tender_text),
    }),
    MAX_TOKENS_LONGFORM,
  )
  return sanitizeFormatIssues(extractJsonLoose(raw))
}

/** 商务路：globalFacts 与正文关键商务值逐项核对（正文段落本地关键词捞取 ≤3000 字） */
async function runEvalCommercialCall(cur: BidProjectRecord): Promise<CommercialCheck[]> {
  const raw = await llmGenerate(
    buildEvalCommercialMessages(
      effectiveGlobalFacts(cur),
      buildCommercialSectionText(cur.parse_report),
      collectCommercialParagraphs(bidChaptersFor(cur)),
    ),
    MAX_TOKENS_LONGFORM,
  )
  return sanitizeCommercialChecks(extractJsonLoose(raw))
}

/** 三路结果合并进同一份 ai_review：失败的路（null）沿用上一次结果，不拖垮整体 */
function mergeAiReview(
  prev: AiReview | null,
  tech: AiReview | null,
  format: FormatIssue[] | null,
  commercial: CommercialCheck[] | null,
): AiReview {
  return {
    items: tech?.items ?? prev?.items ?? [],
    total_score: tech ? tech.total_score : prev?.total_score ?? 0,
    summary: tech?.summary ?? prev?.summary ?? "",
    reviewed_at: new Date().toISOString(),
    format_issues: format ?? prev?.format_issues ?? [],
    commercial_checks: commercial ?? prev?.commercial_checks ?? [],
  }
}

// 第五轮改造 3：全文总字数校正触发线——总字数缺口超过目标的 10% 才启动校正
const TOTAL_ADJUST_GAP_TOLERANCE = 0.1
// 校正最多扫描 3 遍（每章每遍内仍受 runSupplementLoop 的 6 轮上限与增益熔断约束）
const TOTAL_ADJUST_MAX_PASSES = 3

// 第十一轮改造 1：回收站保留策略——删除后 7 天内列表顶部可快捷撤销，超过 30 天自动彻底清除
const TRASH_UNDO_DAYS = 7
const TRASH_RETAIN_DAYS = 30

// 第十一轮改造 2：页数硬约束治理区间（±10%）
const PAGE_GOVERN_TOLERANCE = 0.1

// 第五轮改造 1：可持久化到 bid_projects 的生成设置字段（第十三轮改造 3：追加 gen_options 增强开关；第十六轮 B1：追加 global_facts；第十六轮 B2：追加 orchestration / max_figures；第十七轮 17B：追加 compilation_basis_extra / basis_style；第十七轮 17C：追加 format_settings / format_check_items；第十七轮 17D：追加 ref_template_text / ref_materials_text）
type SettingsField =
  | "target_pages"
  | "outline_level"
  | "figures_enabled"
  | "clause_granularity"
  | "section_words"
  | "gen_options"
  | "global_facts"
  | "orchestration"
  | "max_figures"
  | "compilation_basis_extra"
  | "basis_style"
  | "format_settings"
  | "format_check_items"
  | "ref_template_text"
  | "ref_materials_text"
  | "identity_words"

/**
 * 第十七轮 17B：某章的编制依据注入（章级判断，节级继承）——
 * 合并清单（解析提取 ∪ 规范库补选，去重）为空返回 undefined（存量项目行为与现状完全一致）；
 * 规则句全部章携带（style 决定列示样式，未设置默认 table），
 * 清单文本仅标题命中 /编制依据|标准|规范/ 的专章携带；技术章一律不注入（2026-10-12 问题4-A：已删除“回退首个技术章”的 fallback）。
 */
function compilationBasisOptFor(cur: BidProjectRecord, chapterIdx: number): CompilationBasisPrompt | undefined {
  const items = mergeBasisItems(
    parseBasisLines(sectionText(cur.parse_report, COMPILATION_BASIS_KEY)),
    normalizeBasisExtra(cur.compilation_basis_extra),
  )
  if (!items.length) return undefined
  // 问题4-A（2026-10-12 用户拍板）：技术章一律不注入编制依据（连表带引导句一并消失）——
  // 仅标题命中「编制依据/标准/规范」的专章保留列示；无专章则全项目不注入（删除“回退首个技术章”fallback）。
  const ch = cur.bid_chapters[chapterIdx]
  if (!ch || isBizPart(ch) || !BASIS_CHAPTER_TITLE_RE.test(ch.title ?? "")) return undefined
  const style: BasisStyle =
    cur.basis_style === "group" || cur.basis_style === "numbered" ? cur.basis_style : "table"
  return { style, listText: basisListText(items) }
}

// 第十七轮 17D：范本/资料文本字数上限（超过自动截断后落盘）
const REF_TEXT_LIMIT = 200_000

// 第十七轮 17D：写作资料注入上限（对 ref_materials_text 复用招标原文同款本地检索：≤3 段 ≤1200 字）
const REF_MATERIALS_MAX_CHARS = 1200
const REF_MATERIALS_MAX_PARAS = 3

/**
 * 第十七轮 17D：团队写作资料本地检索（零 AI）——query 与招标原文检索同口径（章/节标题+条款文本）；
 * 资料为空或检索为空返回空串（调用方静默不注入，老项目行为与现状完全一致）。
 */
function refMaterialsFor(cur: BidProjectRecord, query: Parameters<typeof retrieveTenderFragments>[1]): string {
  const text = (cur.ref_materials_text ?? "").trim()
  if (!text) return ""
  const kind = libraryKindFor(query.title, query.sections)
  const baseline = libraryBaselineFor(text, kind)
  const fragments = retrieveTenderFragments(text, query, REF_MATERIALS_MAX_CHARS, REF_MATERIALS_MAX_PARAS)
  // R167：素材库启用且本章/节命中类别时，先带该类公司标准件作为结构基线（带标记头，≤1500 字），
  // 由 builder 拆成独立提示词槽；未启用/未命中时基线为空串，注入文本与第十七轮 17D 现状逐字一致。
  return composeRefMaterials(baselineMarkForKind(baseline ? kind : null), baseline, fragments)
}

// 大纲生成依赖的解析项（任一存在即可生成，全缺则提示回解析环节）
const OUTLINE_DEPEND_KEYS = ["tech_score", "response_req", "biz_score"]

function costText(): string {
  return costTextForModel(activeModelRef)
}

function normalizeRecord(rec: BidProjectRecord): BidProjectRecord {
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
    parse_report: parseReport,
    parse_config: rec.parse_config ?? null,
    bid_outline: rec.bid_outline ?? [],
    bid_chapters: rec.bid_chapters ?? [],
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
function sortOppsByHospital(list: OpportunityRow[], hospital: string): OpportunityRow[] {
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

export type ToolKind = "parse" | "dup" | "void" | "eval"

export const TOOL_LABEL: Record<ToolKind, string> = {
  parse: "招标文件解析",
  dup: "标书查重",
  void: "废标项检查",
  eval: "模拟评标",
}

// ---------------------------------------------------------------------------
// 主 Hook
// ---------------------------------------------------------------------------

export function useBidWorkspace() {
  const costConfirm = useCostConfirm()

  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setUserId(account?.userId ?? decodeRhToken()?.sub ?? null)
  }, [])

  // ------------------------------ 模型选择（统一网关） ------------------------------
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState("")

  const loadModelOptions = useCallback(async () => {
    const av = await resolveAvailableModels()
    setModelOptions(av.models)
    setSelectedModelKey((prev) =>
      prev && av.models.some((m) => modelRefKey(m) === prev)
        ? prev
        : av.defaultRef
          ? modelRefKey(av.defaultRef)
          : "",
    )
  }, [])

  useEffect(() => {
    if (userId) void loadModelOptions()
  }, [userId, loadModelOptions])

  useEffect(() => {
    activeModelRef = modelOptions.find((m) => modelRefKey(m) === selectedModelKey) ?? null
  }, [modelOptions, selectedModelKey])

  const handleSelectModel = useCallback((key: string) => setSelectedModelKey(key), [])

  const handleLlmError = useCallback((e: unknown, fallback: string) => {
    if (e instanceof AuthRequiredError) {
      toast.error(e.message)
    } else {
      // 循环 7 A5：非中文 / 裸错误码不透出（与 llmErrorText 同口径），落到调用方的中文 fallback
      const msg = e instanceof Error ? e.message.trim() : ""
      toast.error(msg && /[一-龥]/.test(msg) ? msg : fallback)
    }
  }, [])

  const requireLogin = useCallback((): boolean => {
    if (!userId) {
      toast.error("该操作当前不可用")
      return false
    }
    return true
  }, [userId])

  // ------------------------------ 全站技能带入（标书侧 5 个功能点） ------------------------------
  const parseSkills = useScopeSkills("bid-parse", userId ?? undefined)
  const bidOutlineSkills = useScopeSkills("bid-outline", userId ?? undefined)
  const bidChapterSkills = useScopeSkills("bid-chapter", userId ?? undefined)
  const deviationSkills = useScopeSkills("bid-deviation", userId ?? undefined)
  const defenseSkills = useScopeSkills("bid-defense", userId ?? undefined)

  // ------------------------------ 顶层视图 ------------------------------
  const [mainView, setMainView] = useState<"projects" | "tools">("projects")
  const [mode, setMode] = useState<"list" | "detail">("list")
  const [activeStep, setActiveStep] = useState(1)

  // ------------------------------ 项目列表 ------------------------------
  const [projects, setProjects] = useState<BidProjectRecord[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState("")

  // D3：显式 perPage=200（hook 上限；此前缺省被模板按 50 截断），拉满 200 时列表加「仅显示最近 200 个」小字
  const [projectsCapped, setProjectsCapped] = useState(false)

  const loadProjects = useCallback(async (uid: string) => {
    setListLoading(true)
    try {
      const data = await apiFetch<ListResponse<BidProjectRecord>>(
        `/api/bid_projects?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`,
      )
      const items = data.items ?? []
      setProjects(items.map(normalizeRecord))
      setProjectsCapped(items.length >= 200)
    } catch {
      toast.error("投标项目列表加载失败，请稍后重试")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (userId) void loadProjects(userId)
    else setProjects([])
  }, [userId, loadProjects])

  // 第十一轮改造 1：列表视图切换（进行中 / 已归档 / 回收站）
  const [listView, setListView] = useState<"active" | "archived" | "trash">("active")

  const viewProjects = useMemo(() => {
    // 循环 6 A1：统一归档口径——archived 位与 stage="archived" 任一命中即视为已归档（兼容存量 stage-only 项目）
    const isArchivedRec = (p: BidProjectRecord) => p.archived === true || p.stage === "archived"
    if (listView === "trash") return projects.filter((p) => !!p.deleted_at)
    if (listView === "archived") return projects.filter((p) => !p.deleted_at && isArchivedRec(p))
    return projects.filter((p) => !p.deleted_at && !isArchivedRec(p))
  }, [listView, projects])

  const filteredProjects = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase()
    if (!kw) return viewProjects
    return viewProjects.filter(
      (p) =>
        p.project_name?.toLowerCase().includes(kw) ||
        p.tender_no?.toLowerCase().includes(kw) ||
        p.hospital?.toLowerCase().includes(kw),
    )
  }, [viewProjects, searchKeyword])

  /** 顶部撤销提醒条：近 7 天内软删的条目，按删除时间倒序 */
  const recentDeleted = useMemo(() => {
    return projects
      .filter((p) => {
        if (!p.deleted_at) return false
        const d = daysUntil(p.deleted_at)
        return d !== null && d > -TRASH_UNDO_DAYS
      })
      .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""))
  }, [projects])

  /** 进入回收站视图时，先把超过 30 天的过期条目自动彻底清除再渲染 */
  const purgeRunningRef = useRef(false)
  useEffect(() => {
    if (listView !== "trash" || purgeRunningRef.current) return
    const expired = projects.filter((p) => {
      if (!p.deleted_at) return false
      const d = daysUntil(p.deleted_at)
      return d !== null && d <= -TRASH_RETAIN_DAYS
    })
    if (!expired.length) return
    purgeRunningRef.current = true
    void (async () => {
      let removed = 0
      for (const rec of expired) {
        try {
          await apiFetch(`/api/bid_projects/${rec.id}`, { method: "DELETE" })
          void purgeProjectSnapshots(rec.id) // 循环 6 A3：过期清除同样级联清理阶段快照（best-effort）
          removed += 1
          setProjects((prev) => prev.filter((p) => p.id !== rec.id))
        } catch {
          /* 单条清除失败留待下次进入回收站再清 */
        }
      }
      purgeRunningRef.current = false
      if (removed) toast.info(`${removed} 个过期项目已自动清除`)
    })()
  }, [listView, projects])

  // ------------------------------ 商机选项（第四轮：关联商机 + 结果回流） ------------------------------
  const [oppOptions, setOppOptions] = useState<OpportunityRow[]>([])
  // D3：商机选项拉满 200（hook 上限）时下拉加「仅显示最近 200 个」小字
  const [oppOptionsCapped, setOppOptionsCapped] = useState(false)

  const loadOppOptions = useCallback(async (uid: string) => {
    try {
      const data = await apiFetch<ListResponse<OpportunityRow>>(
        `/api/opportunities?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`,
      )
      const items = data.items ?? []
      setOppOptions(items)
      setOppOptionsCapped(items.length >= 200)
    } catch {
      // 商机列表加载失败不阻塞标书主流程，下拉为空时仍可手动跳过关联
      setOppOptions([])
      setOppOptionsCapped(false)
    }
  }, [])

  useEffect(() => {
    if (userId) void loadOppOptions(userId)
    else setOppOptions([])
  }, [userId, loadOppOptions])

  // numeric-consistency-02（做法 B）：报价单快照（/ppt-quote 模块的记录）。随页面加载拉一次，
  // 失败静默置空＝交卷体检跳过报价单面不报错（与商机选项同款降级）；存 ref 供同步体检函数读取。
  const quoteRefsRef = useRef<QuoteTotalRef[]>([])
  useEffect(() => {
    if (!userId) {
      quoteRefsRef.current = []
      return
    }
    void (async () => {
      try {
        const data = await apiFetch<ListResponse<QuoteRecord>>(
          `/api/quotes?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=200`,
        )
        quoteRefsRef.current = (data.items ?? []).map((q) => ({
          name: q.quote_name ?? "",
          totalYuan: quoteTotal(q.groups),
          updated: q.updated ?? "",
          opportunityId: q.opportunity_id ?? "",
        }))
      } catch {
        quoteRefsRef.current = []
      }
    })()
  }, [userId])

  // ------------------------------ 新建 / 删除项目 ------------------------------
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [formProjectName, setFormProjectName] = useState("")
  const [formTenderNo, setFormTenderNo] = useState("")
  const [formHospital, setFormHospital] = useState("")
  const [formBidOpenDate, setFormBidOpenDate] = useState("")
  const [formOpportunityId, setFormOpportunityId] = useState("")
  const [creating, setCreating] = useState(false)

  // 新建对话框的商机下拉（按已填医院模糊匹配排前）
  const dialogOppOptions = useMemo(
    () => sortOppsByHospital(oppOptions, formHospital),
    [oppOptions, formHospital],
  )

  const openNewDialog = useCallback(() => {
    setFormProjectName("")
    setFormTenderNo("")
    setFormHospital("")
    setFormBidOpenDate("")
    setFormOpportunityId("")
    setNewDialogOpen(true)
    if (userId) void loadOppOptions(userId)
  }, [userId, loadOppOptions])

  const createProject = useCallback(async () => {
    if (!requireLogin()) return
    const projName = formProjectName.trim()
    if (!projName) {
      toast.error("请填写项目名称")
      return
    }
    setCreating(true)
    try {
      const payload: Record<string, unknown> = {
        rh_user_id: userId,
        project_name: projName,
        tender_no: formTenderNo.trim(),
        hospital: formHospital.trim(),
        stage: "pending_parse",
        tender_text: "",
        parse_report: null,
        parse_config: defaultParseConfig(),
        bid_outline: [],
        bid_chapters: [],
        response_map: null,
        dup_report: null,
        void_check: null,
        ai_review: null,
        manual_review: null,
        opportunity_id: formOpportunityId,
        bid_result: "",
        bid_amount: null,
        lost_reason: "",
        result_synced_at: "",
        submission_check: null,
        stage_gates: emptyStageGates(),
        // 第十三轮改造 3：技术章增强开关默认全关
        gen_options: defaultGenOptions(),
        // 第十六轮 B1 改造 1.1：全局事实设定默认空（回退本地自动抽取）
        global_facts: "",
        // 第十七轮 17B：编制依据规范库补选默认空、撰写样式默认未设置（消费侧默认 table）
        compilation_basis_extra: null,
        basis_style: "",
        // 第十七轮 17D：历史范本与写作资料默认空（导入区两个槽后续粘贴/上传）
        ref_template_text: "",
        ref_materials_text: "",
      }
      if (formBidOpenDate) payload.bid_open_date = formBidOpenDate
      const record = normalizeRecord(await apiFetch<BidProjectRecord>("/api/bid_projects", {
        method: "POST",
        body: JSON.stringify(payload),
      }))
      setProjects((prev) => [record, ...prev.filter((p) => p.id !== record.id)])
      setNewDialogOpen(false)
      applyProjectState(record)
      setActiveStep(1)
      setTenderDraft("")
      // 第十七轮 17D：新建项目同步清空范本与资料草稿（skipPersist，记录里本来就是空串）
      setRefTemplateDraft("", { skipPersist: true })
      setRefMaterialsDraft("", { skipPersist: true })
      setMode("detail")
      toast.success("投标项目已创建，先导入招标文件")
    } catch {
      toast.error("项目创建失败，请稍后重试")
    } finally {
      setCreating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formBidOpenDate, formHospital, formOpportunityId, formProjectName, formTenderNo, requireLogin, userId])

  /** 彻底删除（回收站内二次确认后调用）：硬删记录，不可恢复 */
  const deleteProject = useCallback(async (rec: BidProjectRecord) => {
    try {
      await apiFetch(`/api/bid_projects/${rec.id}`, { method: "DELETE" })
      void purgeProjectSnapshots(rec.id) // 循环 6 A3：删项目本体后级联清理阶段快照（best-effort，失败不阻断）
      setProjects((prev) => prev.filter((p) => p.id !== rec.id))
      toast.success(`「${rec.project_name}」已彻底删除`)
    } catch {
      toast.error("彻底删除失败，请稍后重试")
    }
  }, [])

  /** 列表级字段 patch：直接落库并同步本地列表 / 当前项目（不走 updateProject 的 stage 推导） */
  const patchProjectFields = useCallback(
    async (rec: BidProjectRecord, patch: Partial<BidProjectRecord>, okMsg: string, failMsg: string) => {
      try {
        await apiFetch(`/api/bid_projects/${rec.id}`, { method: "PATCH", body: JSON.stringify(patch) })
        const next = { ...rec, ...patch }
        setProjects((prev) => prev.map((p) => (p.id === rec.id ? next : p)))
        if (activeProjectRef.current?.id === rec.id) applyProjectState(next)
        toast.success(okMsg)
      } catch {
        toast.error(failMsg)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /** 软删：移入回收站（30 天内可还原，超期自动彻底清除） */
  const softDeleteProject = useCallback(
    async (rec: BidProjectRecord) => {
      await patchProjectFields(
        rec,
        { deleted_at: new Date().toISOString() },
        `「${rec.project_name}」已移入回收站，30 天内可还原`,
        "删除失败，请稍后重试",
      )
    },
    [patchProjectFields],
  )

  /** 还原：撤销删除（回收站「还原」与提醒条「撤销」共用） */
  const restoreProject = useCallback(
    async (rec: BidProjectRecord) => {
      await patchProjectFields(rec, { deleted_at: "" }, `「${rec.project_name}」已还原`, "还原失败，请稍后重试")
    },
    [patchProjectFields],
  )

  /** 归档 / 取消归档（列表分组；归档态项目打开后只读，见 isArchivedLocked） */
  const setProjectArchived = useCallback(
    async (rec: BidProjectRecord, archived: boolean) => {
      // 循环 6 A1：统一归档口径——取消归档时若 stage 停在 archived（归档面板路径双写过）一并复位，
      // 否则项目会因 stage 判定继续滞留已归档列表且保持只读
      const patch: Partial<BidProjectRecord> = archived
        ? { archived: true }
        : { archived: false, ...(rec.stage === "archived" ? { stage: deriveStage({ ...rec, stage: "pending_parse" }) } : {}) }
      await patchProjectFields(
        rec,
        patch,
        archived ? `「${rec.project_name}」已归档，可在「已归档」视图查看` : `「${rec.project_name}」已取消归档`,
        archived ? "归档失败，请稍后重试" : "取消归档失败，请稍后重试",
      )
    },
    [patchProjectFields],
  )

  // ------------------------------ 当前项目 ------------------------------
  const [activeProject, setActiveProject] = useState<BidProjectRecord | null>(null)
  const activeProjectRef = useRef<BidProjectRecord | null>(null)

  function applyProjectState(next: BidProjectRecord | null) {
    activeProjectRef.current = next
    setActiveProject(next)
    if (next) setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)))
  }

  const persistProject = useCallback(async (rec: BidProjectRecord, patch: Partial<BidProjectRecord>, quiet = false) => {
    const prev = persistChain.get(rec.id) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(() =>
      apiFetch(`/api/bid_projects/${rec.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    )
    persistChain.set(rec.id, run)
    try {
      await run
      if (quiet) {
        setAutoSaveState("saved")
        if (autoSaveResetRef.current) window.clearTimeout(autoSaveResetRef.current)
        autoSaveResetRef.current = window.setTimeout(() => setAutoSaveState("idle"), 2000)
      }
    } catch {
      if (quiet) setAutoSaveState("idle")
      if (!quiet) toast.error("保存失败，请检查网络后重试")
    } finally {
      if (persistChain.get(rec.id) === run) persistChain.delete(rec.id)
    }
  }, [])

  const updateProject = useCallback(
    (patch: Partial<BidProjectRecord>, opts?: { persist?: boolean; quiet?: boolean }) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const merged: BidProjectRecord = { ...cur, ...patch }
      const nextStage: BidStage = patch.stage ?? deriveStage({ ...merged, stage: cur.stage })
      const next: BidProjectRecord = { ...merged, stage: nextStage }
      applyProjectState(next)
      if (opts?.persist !== false) void persistProject(next, { ...patch, stage: nextStage }, opts?.quiet)
    },
    [persistProject],
  )

  const updateChapter = useCallback(
    (nodeId: string, patch: Partial<Chapter>, opts?: { persist?: boolean; quiet?: boolean }) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const chapters = cur.bid_chapters.map((c) => (c.node_id === nodeId ? { ...c, ...patch } : c))
      updateProject({ bid_chapters: chapters }, opts)
    },
    [updateProject],
  )

  // ------------------------------ 循环 5 A3：归档只读硬锁 ------------------------------
  /** 归档锁定：列表归档位（archived）或阶段已归档（stage=archived）任一命中即只读；导出/查看保留 */
  const isArchivedLocked = !!activeProject && (activeProject.archived === true || activeProject.stage === "archived")
  const archivedLockedRef = useRef(false)
  archivedLockedRef.current = isArchivedLocked
  /** 编辑/生成入口统一拦截：锁定时 toast 提示并返回 true（silent=逐键 setter 用，不弹提示） */
  const blockIfArchived = useCallback((silent = false): boolean => {
    if (!archivedLockedRef.current) return false
    if (!silent) toast.error("已归档项目为只读，解除归档后可编辑")
    return true
  }, [])
  /** 解除归档（横幅按钮走既有解除流程）：归档位清零 + 阶段按产物重算（deriveStage 非 archived 分支） */
  const unarchiveActiveProject = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    updateProject({ archived: false, stage: deriveStage({ ...cur, stage: "pending_parse" }) })
    toast.success(`「${cur.project_name}」已解除归档，可继续编辑`)
  }, [updateProject])

  // ------------------------------ 第十一轮改造 4：阶段工作记录快照（fire-and-forget） ------------------------------
  const [stageHistory, setStageHistory] = useState<StageSnapshotRow[]>([])
  const [stageHistoryLoading, setStageHistoryLoading] = useState(false)

  /**
   * 写一条阶段快照：失败只 toast 不阻断主流程；payload 内字符串字段与章节正文按
   * SNAPSHOT_CONTENT_MAX 截断；写入后拉列表执行保留策略（每项目最近 60 条，超删最旧非 reset 条）。
   */
  const writeStageSnapshot = useCallback(
    (stage: SnapshotStage, label: string, payload: Record<string, unknown>) => {
      const cur = activeProjectRef.current
      if (!cur || !userId) return
      const clipped: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(payload)) {
        clipped[k] = typeof v === "string" && v.length > SNAPSHOT_CONTENT_MAX ? v.slice(0, SNAPSHOT_CONTENT_MAX) : v
      }
      if (Array.isArray(clipped.chapters)) {
        clipped.chapters = (clipped.chapters as { content?: string }[]).map((c) =>
          typeof c?.content === "string" && c.content.length > SNAPSHOT_CONTENT_MAX
            ? { ...c, content: c.content.slice(0, SNAPSHOT_CONTENT_MAX) }
            : c,
        )
      }
      void (async () => {
        try {
          await apiFetch("/api/bid_stage_snapshots", {
            method: "POST",
            body: JSON.stringify({
              rh_user_id: userId,
              project_id: cur.id,
              stage,
              label: label.slice(0, 200),
              payload: clipped,
            }),
          })
          const data = await apiFetch<ListResponse<StageSnapshotRow>>(
            `/api/bid_stage_snapshots?rh_user_id=${encodeURIComponent(userId)}&project_id=${encodeURIComponent(cur.id)}&perPage=200`,
          )
          const items = data.items ?? []
          const overflow = items.slice(SNAPSHOT_RETAIN).filter((it) => it.stage !== "reset")
          for (const it of overflow) {
            try {
              await apiFetch(`/api/bid_stage_snapshots/${it.id}`, { method: "DELETE" })
            } catch {
              /* 单条清理失败留待下次写入时重试 */
            }
          }
          const overflowIds = new Set(overflow.map((o) => o.id))
          setStageHistory(items.filter((it) => !overflowIds.has(it.id)))
        } catch {
          toast.error("工作记录写入失败：本次成果已保存，但快照未留档")
        }
      })()
    },
    [userId],
  )

  const loadStageHistory = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur || !userId) {
      setStageHistory([])
      return
    }
    setStageHistoryLoading(true)
    try {
      const data = await apiFetch<ListResponse<StageSnapshotRow>>(
        `/api/bid_stage_snapshots?rh_user_id=${encodeURIComponent(userId)}&project_id=${encodeURIComponent(cur.id)}&perPage=200`,
      )
      setStageHistory((data.items ?? []).slice(0, SNAPSHOT_RETAIN + 20))
    } catch {
      // 加载失败不阻塞归档面板其余部分
      setStageHistory([])
      toast.error("工作记录加载失败，可稍后重进本环节查看")
    } finally {
      setStageHistoryLoading(false)
    }
  }, [userId])

  // ------------------------------ 第五轮改造 1：生成设置持久化 ------------------------------
  // target_pages / outline_level / figures_enabled / clause_granularity / section_words 以项目记录为
  // 唯一数据源（刷新/重进/切换项目自动恢复）；setter 做「本地记录更新 + 300ms 防抖 PATCH」双写。
  const [settingsSaving, setSettingsSaving] = useState(false)
  const settingsTimerRef = useRef<number | null>(null)
  const settingsPatchRef = useRef<{ projectId: string; patch: Partial<BidProjectRecord> } | null>(null)

  const flushSettingsPatch = useCallback(() => {
    if (settingsTimerRef.current) {
      window.clearTimeout(settingsTimerRef.current)
      settingsTimerRef.current = null
    }
    const pending = settingsPatchRef.current
    settingsPatchRef.current = null
    if (!pending || Object.keys(pending.patch).length === 0) {
      setSettingsSaving(false)
      return
    }
    void apiFetch(`/api/bid_projects/${pending.projectId}`, {
      method: "PATCH",
      body: JSON.stringify(pending.patch),
    })
      .then(() => setSettingsSaving(false))
      .catch(() => {
        setSettingsSaving(false)
        toast.error("生成设置保存失败，请重新调整")
      })
  }, [])

  const applySetting = useCallback(
    <K extends SettingsField>(field: K, value: BidProjectRecord[K]) => {
      const cur = activeProjectRef.current
      if (!cur) return
      // 循环 5 A3：归档只读——全部防抖落库设置（生成设置/格式设置/身份词/编排等）统一拦截
      if (blockIfArchived()) return
      // 切换项目时先把上一个项目的待存设置立即落库，避免写串项目
      if (settingsPatchRef.current && settingsPatchRef.current.projectId !== cur.id) flushSettingsPatch()
      applyProjectState({ ...cur, [field]: value } as BidProjectRecord)
      settingsPatchRef.current = {
        projectId: cur.id,
        patch: { ...(settingsPatchRef.current?.patch ?? {}), [field]: value },
      }
      setSettingsSaving(true)
      if (settingsTimerRef.current) window.clearTimeout(settingsTimerRef.current)
      settingsTimerRef.current = window.setTimeout(() => {
        settingsTimerRef.current = null
        flushSettingsPatch()
      }, 300)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockIfArchived, flushSettingsPatch],
  )

  // ------------------------------ A1 修复：三组粘贴防抖落盘的冲刷 ------------------------------
  // pending 变更连同所属 projectId 一起记录；flush 落盘不依赖 activeProjectRef：
  // 仍在原项目 → 走原 updateProject/applySetting 路径（本地记录同步更新）；
  // 已切换/离开项目 → 按捕获的 id 单独 PATCH，杜绝跨项目串写与 backToList/卸载时丢输入。
  const tenderSaveTimerRef = useRef<number | null>(null)
  const tenderPendingRef = useRef<{ projectId: string; value: string } | null>(null)
  const refTplSaveTimerRef = useRef<number | null>(null)
  const refTplPendingRef = useRef<{ projectId: string; value: string } | null>(null)
  const refMatSaveTimerRef = useRef<number | null>(null)
  const refMatPendingRef = useRef<{ projectId: string; value: string } | null>(null)

  const persistProjectById = useCallback(async (projectId: string, patch: Partial<BidProjectRecord>, quiet = false) => {
    try {
      await apiFetch(`/api/bid_projects/${projectId}`, { method: "PATCH", body: JSON.stringify(patch) })
    } catch {
      if (!quiet) toast.error("保存失败，请检查网络后重试")
    }
  }, [])

  const flushTenderDraft = useCallback(() => {
    if (tenderSaveTimerRef.current) {
      window.clearTimeout(tenderSaveTimerRef.current)
      tenderSaveTimerRef.current = null
    }
    const pending = tenderPendingRef.current
    tenderPendingRef.current = null
    if (!pending) return
    if (activeProjectRef.current?.id === pending.projectId) {
      updateProject({ tender_text: pending.value })
    } else {
      void persistProjectById(pending.projectId, { tender_text: pending.value })
    }
  }, [persistProjectById, updateProject])

  const flushRefTpl = useCallback(() => {
    if (refTplSaveTimerRef.current) {
      window.clearTimeout(refTplSaveTimerRef.current)
      refTplSaveTimerRef.current = null
    }
    const pending = refTplPendingRef.current
    refTplPendingRef.current = null
    if (!pending) return
    if (activeProjectRef.current?.id === pending.projectId) {
      applySetting("ref_template_text", pending.value)
    } else {
      void persistProjectById(pending.projectId, { ref_template_text: pending.value })
    }
  }, [applySetting, persistProjectById])

  const flushRefMat = useCallback(() => {
    if (refMatSaveTimerRef.current) {
      window.clearTimeout(refMatSaveTimerRef.current)
      refMatSaveTimerRef.current = null
    }
    const pending = refMatPendingRef.current
    refMatPendingRef.current = null
    if (!pending) return
    if (activeProjectRef.current?.id === pending.projectId) {
      applySetting("ref_materials_text", pending.value)
    } else {
      void persistProjectById(pending.projectId, { ref_materials_text: pending.value })
    }
  }, [applySetting, persistProjectById])

  // 组件卸载前把未落盘的设置冲刷出去；A1 修复：三组 1.2s 防抖草稿（招标原文/范本/资料）一并冲刷。
  // flushRefTpl/flushRefMat 同项目路径会经 applySetting 再排入 settingsPatchRef，故 flushSettingsPatch 放最后兜底。
  // 循环 6 A3：章节正文 1s 防抖（flushEditingContent）声明在后且依赖 activeChapterId，经 ref 转发在卸载时冲刷，
  // 避免把它加进本 effect 依赖导致每次切章都重跑卸载冲刷。
  const flushEditingContentRef = useRef<() => void>(() => {})
  useEffect(
    () => () => {
      flushEditingContentRef.current()
      flushTenderDraft()
      flushRefTpl()
      flushRefMat()
      flushSettingsPatch()
    },
    [flushTenderDraft, flushRefTpl, flushRefMat, flushSettingsPatch],
  )

  // 设置派生值（来自当前项目记录，openProject/刷新后自动恢复）
  const targetPages = activeProject?.target_pages ?? null
  const outlineLevel = (
    activeProject?.outline_level === 1 || activeProject?.outline_level === 2 || activeProject?.outline_level === 3
      ? activeProject.outline_level
      : 0
  ) as 0 | 1 | 2 | 3
  const figuresEnabled = activeProject?.figures_enabled ?? false
  // 偏离表拆分维度：按系统 / 按二级标题 / 按三级标题（持久化）
  const clauseGranularity: ClauseGranularity =
    activeProject?.clause_granularity === "l2" || activeProject?.clause_granularity === "l3"
      ? activeProject.clause_granularity
      : "system"
  // T20：每叶子字数——上限放宽到 5000（大标书每节需要 2000+ 字才有实质深度，800 字/叶只能写泛泛概述）；
  // 大标书自适应：目标 ≥50 页且用户未手动调过字数时，每叶至少 2000 字
  //（100 页 → 50000 字 ÷ 2000 = 25 个叶子，叶子少而深；避免 63 个 800 字碎片叶子导致内容浅、评分映射稀释）
  const rawSectionWords =
    activeProject?.section_words && activeProject.section_words >= 400 && activeProject.section_words <= 5000
      ? activeProject.section_words
      : 800
  const effectivePagesForWords = effectiveTargetPages(activeProject)
  const sectionWords =
    activeProject?.gen_options?.section_words_touched !== true && effectivePagesForWords >= 50 && rawSectionWords < 2000
      ? 2000
      : rawSectionWords
  const settingsSaved = !settingsSaving

  const setTargetPages = useCallback(
    (raw: string | number | null) => {
      if (raw === null || raw === "") {
        applySetting("target_pages", null)
        return
      }
      const n = Math.round(Number(raw))
      if (!Number.isFinite(n) || n < 1) {
        applySetting("target_pages", null)
        return
      }
      applySetting("target_pages", Math.min(9999, n))
    },
    [applySetting],
  )

  const setOutlineLevel = useCallback((v: 0 | 1 | 2 | 3) => applySetting("outline_level", v), [applySetting])
  const setFiguresEnabled = useCallback((v: boolean) => applySetting("figures_enabled", v), [applySetting])
  const setClauseGranularity = useCallback((v: ClauseGranularity) => applySetting("clause_granularity", v), [applySetting])
  const setSectionWords = useCallback(
    (raw: string | number | null) => {
      if (raw === null || raw === "") {
        applySetting("section_words", null)
        return
      }
      const n = Math.round(Number(raw))
      if (!Number.isFinite(n) || n < 100) {
        applySetting("section_words", null)
        return
      }
      applySetting("section_words", Math.min(5000, Math.max(400, n)))
      // 方案B 第5步：用户手动调过字数即置 touched 标记，后续切换生成模式不再自动覆盖
      const base = activeProjectRef.current?.gen_options ?? defaultGenOptions()
      if (base.section_words_touched !== true) {
        applySetting("gen_options", { ...base, section_words_touched: true })
      }
    },
    [applySetting],
  )

  // 第十六轮 B2 改造 2.1：全文配图上限（0-99，留空=不限；0=不配图；figures_enabled 仍是配图总开关）——同款 applySetting 防抖持久化
  const maxFigures = effectiveMaxFigures(activeProject?.max_figures ?? null)
  const setMaxFigures = useCallback(
    (raw: string | number | null) => {
      if (raw === null || raw === "") {
        applySetting("max_figures", null)
        return
      }
      const n = Math.round(Number(raw))
      if (!Number.isFinite(n) || n < 0) {
        applySetting("max_figures", null)
        return
      }
      applySetting("max_figures", Math.min(99, n))
    },
    [applySetting],
  )

  // 第十三轮改造 3：技术章增强开关（逐条应答强化 / 素材优先注入）——同款 applySetting 防抖持久化模式
  const genOptions: GenOptions = activeProject?.gen_options ?? defaultGenOptions()
  const setGenOption = useCallback(
    (key: "clause_response" | "material_boost" | "include_biz" | "word_refine" | "auto_consistency_audit" | "generate_demo", value: boolean) => {
      const base = activeProjectRef.current?.gen_options ?? defaultGenOptions()
      applySetting("gen_options", { ...base, [key]: value })
    },
    [applySetting],
  )
  const setClauseResponse = useCallback((v: boolean) => setGenOption("clause_response", v), [setGenOption])
  const setMaterialBoost = useCallback((v: boolean) => setGenOption("material_boost", v), [setGenOption])
  // R-019/R-024 演示分节点生成开关（默认关：不进正文生成、不计字数页数、线下准备演示）
  const setGenerateDemo = useCallback((v: boolean) => setGenOption("generate_demo", v), [setGenOption])
  // T15：字数精调 / 生成后一致性核对开关（缺省开启，旧配置兼容）
  const setWordRefine = useCallback((v: boolean) => setGenOption("word_refine", v), [setGenOption])
  const setAutoConsistencyAudit = useCallback((v: boolean) => setGenOption("auto_consistency_audit", v), [setGenOption])
  // 05 三模式（方案B）：合规严格度开关——切模式时若用户未手改字数，联动每小节字数默认（strict 800 / moderate 1000 / full 1400）
  const complianceMode: ComplianceMode = genOptions.compliance_mode ?? COMPLIANCE_MODE_DEFAULT
  const setComplianceMode = useCallback(
    (mode: ComplianceMode) => {
      const base = activeProjectRef.current?.gen_options ?? defaultGenOptions()
      applySetting("gen_options", { ...base, compliance_mode: mode })
      if (base.section_words_touched !== true) {
        applySetting("section_words", COMPLIANCE_MODE_SECTION_WORDS[mode])
      }
    },
    [applySetting],
  )
  // 用户反馈轮项 3：大纲商务标章节开关（默认包含；搭 gen_options json 列持久化，零 collection 变更）
  // 用户反馈轮：关闭开关时若存量大纲含商务章，弹确认一并移除（开启时若无商务章则提示重生成大纲才带入）
  const [bizRemoveCount, setBizRemoveCount] = useState<number | null>(null)
  const setIncludeBiz = useCallback(
    (v: boolean) => {
      setGenOption("include_biz", v)
      const chapters = activeProjectRef.current?.bid_chapters ?? []
      if (!v) {
        const bizCount = chapters.filter((c) => isBizPart(c)).length
        if (bizCount > 0) setBizRemoveCount(bizCount)
      } else if (chapters.length > 0 && !chapters.some((c) => isBizPart(c))) {
        toast.info("重新生成大纲时将按勾选带入商务标骨架章（线下填写，不生成正文）")
      }
    },
    [setGenOption],
  )
  // R206 切片 1（R-002）：内容范围三模式开关——写 gen_options.scope，并同步派生 include_biz 保持旧字段一致
  const setScope = useCallback(
    (next: BidScope) => {
      const base = activeProjectRef.current?.gen_options ?? defaultGenOptions()
      applySetting("gen_options", { ...base, scope: next, include_biz: next !== "tech" })
      if ((activeProjectRef.current?.bid_chapters ?? []).length > 0) {
        toast.info("内容范围已更新，重新生成大纲后按新范围组织章节（存量章节暂不受影响）")
      }
    },
    [applySetting],
  )
  const scope = normalizeBidScope(genOptions)
  const confirmRemoveBizChapters = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (blockIfArchived(true)) return
    const next = cur.bid_chapters.filter((c) => !isBizPart(c))
    const removed = cur.bid_chapters.length - next.length
    updateProject({ bid_chapters: next })
    setBizRemoveCount(null)
    toast.success(`已从目录移除 ${removed} 个商务标章节，后续生成与检查不再包含`)
  }, [blockIfArchived, updateProject])
  const cancelRemoveBizChapters = useCallback(() => setBizRemoveCount(null), [])
  // 循环 7 A4：章间互查相似度阈值（0.2-0.6，缺省 0.35）——搭 gen_options json 列同款 applySetting 防抖持久化
  // （bid_projects PATCH 路由为字段白名单且红线零 pb_hooks/collection 变更，故不单开列）
  const intraDupThreshold = genOptions.intra_dup_threshold ?? INTRA_DUP_THRESHOLD_DEFAULT
  const setIntraDupThreshold = useCallback(
    (v: number) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return
      const base = activeProjectRef.current?.gen_options ?? defaultGenOptions()
      applySetting("gen_options", {
        ...base,
        intra_dup_threshold: Math.min(0.6, Math.max(0.2, Math.round(n * 100) / 100)),
      })
    },
    [applySetting],
  )

  // ------------------------------ 第十七轮 17C：格式配置与格式/检查项可配置 ------------------------------
  // format_settings null=未单独配置（面板按缺省值展示，导出走现状逻辑）；任一改动即生成完整配置，
  // applySetting 防抖落库。format_check_items 存量 null 视为全开（normalizeRecord 已兜底，这里再防 undefined）。
  const formatSettings = activeProject?.format_settings ?? null
  const effectiveFormatSettings = formatSettings ?? DEFAULT_FORMAT_SETTINGS
  const formatCheckItems = activeProject?.format_check_items ?? FORMAT_CHECK_KEYS
  // 循环 2 批 1-4：自家身份词（逗号分隔，暗标脱敏与 identity_leak 检查共用；同款 applySetting 防抖持久化）
  const identityWords = activeProject?.identity_words ?? ""
  const setIdentityWords = useCallback(
    (v: string) => applySetting("identity_words", (v ?? "").slice(0, 500)),
    [applySetting],
  )
  const setFormatSettingsPatch = useCallback(
    (patch: Partial<FormatSettings>) => {
      const base = activeProjectRef.current?.format_settings ?? DEFAULT_FORMAT_SETTINGS
      applySetting("format_settings", { ...base, ...patch })
    },
    [applySetting],
  )
  const setFormatMarginsPatch = useCallback(
    (patch: Partial<FormatSettings["margins"]>) => {
      const base = activeProjectRef.current?.format_settings ?? DEFAULT_FORMAT_SETTINGS
      applySetting("format_settings", { ...base, margins: { ...base.margins, ...patch } })
    },
    [applySetting],
  )
  const setFormatHeadingLevel = useCallback(
    (level: number, patch: Partial<HeadingFormat>) => {
      const base = activeProjectRef.current?.format_settings ?? DEFAULT_FORMAT_SETTINGS
      applySetting("format_settings", {
        ...base,
        heading: base.heading.map((h, i) => (i === level ? { ...h, ...patch } : h)),
      })
    },
    [applySetting],
  )
  const setFormatBodyPatch = useCallback(
    (patch: Partial<BodyFormat>) => {
      const base = activeProjectRef.current?.format_settings ?? DEFAULT_FORMAT_SETTINGS
      applySetting("format_settings", { ...base, body: { ...base.body, ...patch } })
    },
    [applySetting],
  )
  const setFormatTablePatch = useCallback(
    (patch: Partial<TableFormat>) => {
      const base = activeProjectRef.current?.format_settings ?? DEFAULT_FORMAT_SETTINGS
      applySetting("format_settings", { ...base, table: { ...base.table, ...patch } })
    },
    [applySetting],
  )
  const toggleFormatCheckItem = useCallback(
    (key: FormatCheckKey) => {
      const cur = activeProjectRef.current?.format_check_items ?? FORMAT_CHECK_KEYS
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // 按规范清单顺序回写，数组顺序稳定
      applySetting("format_check_items", FORMAT_CHECK_KEYS.filter((k) => next.has(k)))
    },
    [applySetting],
  )
  const setAllFormatCheckItems = useCallback(
    (on: boolean) => applySetting("format_check_items", on ? [...FORMAT_CHECK_KEYS] : []),
    [applySetting],
  )
  /** 本地格式规则检查报告（零 AI）：按勾选禁则扫各章正文 + 暗标页数与 target_pages 交叉警告 */
  const buildFormatReportFor = useCallback((cur: BidProjectRecord): FormatCheckReport => {
    const report = formatCheckReport(
      cur.bid_chapters,
      cur.format_check_items ?? FORMAT_CHECK_KEYS,
      cur.format_settings ?? null,
      cur.identity_words ?? "",
    )
    const sealedPages = cur.format_settings?.sealed ? cur.format_settings.sealedPages : null
    if (sealedPages && cur.target_pages && sealedPages > cur.target_pages) {
      report.hits.push({
        chapter: "（全文）",
        rule: "sealed_pages_cross",
        quote: `暗标页数 ${sealedPages} 页大于目标页数 ${cur.target_pages} 页，请核对暗标装订范围`,
        level: "warn",
      })
    }
    // 循环 8 A4：本地数字口径冲突检查（零 AI，随体检白拿）——事实表数值口径 × 各章含主题词行的 ±1 行窗口；
    // 无事实表时静默跳过，老 format_report 数据经 normalizeFormatCheckReport 白名单自动兼容
    const factLines = effectiveGlobalFactsLines(cur)
    if (factLines.length) {
      report.hits.push(...numberConflictHits(factLines, cur.bid_chapters))
      // numeric-consistency-01：同一事实基准核对偏离表响应值与大纲标题（结构化面，独立 ≤30 上限，不挤占正文命中）
      report.hits.push(...structuredNumberConflictHits(factLines, cur.bid_outline, cur.response_map))
      // numeric-consistency-02（做法 A）：投标报价超最高限价/预算＝废标级，跨 topic 方向性核对（零 AI、只 warn、零新数据模型）
      report.hits.push(...overPriceCeilingHits(factLines, cur.bid_chapters, cur.response_map))
      // numeric-consistency-02（做法 B）：「PPT 与报价」关联商机的报价单真实总额并入同一规则核对（同口径 over_price_ceiling；
      // 未关联商机/快照未加载/无报价单时静默跳过，不阻断体检）
      if (cur.opportunity_id) {
        report.hits.push(...quoteRecordCeilingHits(factLines, pickLatestQuoteTotals(quoteRefsRef.current, cur.opportunity_id)))
      }
    }
    // content-guard-02：不依赖事实表的全文一致性拦截（只扫正文自身），随体检白拿、零 AI
    report.hits.push(...metricConflictHits(cur.bid_chapters), ...metaLeftoverHits(cur.bid_chapters))
    // prompt-fabscan-03（子集）：承诺不够（偏离表负偏离）补进交卷体检，与 param_escalation（加码）成镜像；不依赖事实表，只读既有结构化字段
    report.hits.push(...deviationCommitHits(cur.response_map))
    // R187（r184-bid-amount-consistency-wiring）：金额大小写一致性（大写与小写重述对账）随体检白拿，
    // 与 over_price_ceiling 同为经典废标项的确定性核验；不依赖事实表、零 AI、只报不拦
    report.hits.push(...amountCaseMismatchHits(cur.bid_chapters, cur.response_map))
    // r277 切片1：★/▲ 引文保真（基准优先取招标原文全量，缺失时退条款库节）+ 占位台账 + 形式质量三查；
    // 全部本地零 AI、随体检白拿、只报不拦（warn），交卷体检与战情室徽标自动呈现
    const starBaseline = (cur.tender_text ?? "").trim() || sectionText(cur.parse_report, STAR_CLAUSE_SECTION.key)
    report.hits.push(...starQuoteFidelityHits(starBaseline, cur.bid_chapters, cur.response_map))
    // r286：引文级改写核对——正文直接引语（提示词引导/★▲起头）对照招标原文逐字，未见即 warn；
    // tender_text 缺失时无基准自动跳过（不进质量闸黑名单：引号内未必真是原文，只报不拦）
    report.hits.push(...quoteRewriteHits(cur.tender_text ?? "", cur.bid_chapters))
    report.hits.push(...placeholderLedgerHits(cur.bid_chapters))
    report.hits.push(...markdownResidueHits(cur.bid_chapters), ...numberingSequenceHits(cur.bid_chapters))
    // r277 切片2：工期时序（承诺最短工期 × 最长里程碑对账，评审 A2「180天承诺 vs 240天终验」根修）
    report.hits.push(...scheduleConsistencyHits(cur.bid_chapters))
    report.hits.push(
      ...deadlineDateHits(
        cur.bid_chapters,
        extractDeadlineIso(sectionText(cur.parse_report, "bid_nodes") + "\n" + sectionText(cur.parse_report, "overview")),
      ),
    )
    return report
  }, [])

  /**
   * R32 批次2：章生成后本地体检自动回显（零 AI、不阻断）——重算 format_report 并入 submission_check
   * （保留已有 AI items / fact_conflicts），使交卷体检面板与战情室徽标即时刷新；异常静默，绝不影响生成主流程。
   */
  const refreshFormatReport = useCallback((): FormatCheckReport | null => {
    const cur = activeProjectRef.current
    if (!cur) return null
    try {
      const report = buildFormatReportFor(cur)
      const prev = cur.submission_check
      updateProject({
        submission_check: {
          items: prev?.items ?? [],
          checked_at: prev?.checked_at ?? report.checked_at,
          format_report: report,
          fact_conflicts: prev?.fact_conflicts ?? null,
          consistency_issues: prev?.consistency_issues ?? null,
        },
      })
      return report
    } catch {
      return null
    }
  }, [buildFormatReportFor, updateProject])

  // ------------------------------ 第十七轮 17B：编制依据与规范库（清单 = 解析提取 ∪ 规范库补选） ------------------------------
  // basis_style 未设置（""）时默认 table；撰写样式与补选清单都随项目持久化（applySetting 防抖落库）。
  const [standardsPickerOpen, setStandardsPickerOpen] = useState(false)
  const basisStyle: BasisStyle =
    activeProject?.basis_style === "group" || activeProject?.basis_style === "numbered"
      ? activeProject.basis_style
      : "table"
  const setBasisStyle = useCallback((v: BasisStyle) => applySetting("basis_style", v), [applySetting])
  const basisParsedItems = useMemo(
    () => parseBasisLines(sectionText(activeProject?.parse_report ?? null, COMPILATION_BASIS_KEY)),
    [activeProject?.parse_report],
  )
  const basisExtraItems = useMemo<StandardItem[]>(
    () => normalizeBasisExtra(activeProject?.compilation_basis_extra) ?? [],
    [activeProject?.compilation_basis_extra],
  )
  const basisMergedItems = useMemo(
    () => mergeBasisItems(basisParsedItems, basisExtraItems),
    [basisExtraItems, basisParsedItems],
  )
  const openStandardsPicker = useCallback(() => setStandardsPickerOpen(true), [])
  const closeStandardsPicker = useCallback(() => setStandardsPickerOpen(false), [])
  /** 规范库补选：勾选/取消勾选一条（extra 增量写回 compilation_basis_extra，解析提取项不受影响） */
  const toggleBasisStandard = useCallback(
    (item: StandardItem) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const extra = normalizeBasisExtra(cur.compilation_basis_extra) ?? []
      const key = basisItemKey(item)
      const exists = extra.some((it) => basisItemKey(it) === key)
      applySetting(
        "compilation_basis_extra",
        exists ? extra.filter((it) => basisItemKey(it) !== key) : [...extra, item],
      )
    },
    [applySetting],
  )
  /** 清空规范库补选（解析提取项保留；清单回到「仅解析提取」） */
  const clearBasisExtra = useCallback(() => applySetting("compilation_basis_extra", []), [applySetting])

  // ------------------------------ 第十六轮 B1：全局事实设定（全文一致性） ------------------------------
  // global_facts 字段非空 = 人工编辑版优先（所有注入点统一走 effectiveGlobalFacts），空 = 回退本地自动抽取。
  // 面板编辑态 factDraft 由 hook 持有；「AI 生成事实设定」结果只进编辑态，用户点保存才 PATCH 落库。
  const globalFactsSource: "auto" | "manual" = (activeProject?.global_facts ?? "").trim() ? "manual" : "auto"
  const [factDraft, setFactDraft] = useState<string[]>([])
  const [factAiBusy, setFactAiBusy] = useState(false)
  const [factCheckBusy, setFactCheckBusy] = useState(false)
  const [factCheckResult, setFactCheckResult] = useState<FactConflict[] | null>(null)
  const [factCheckOpen, setFactCheckOpen] = useState(false)

  // 切换项目 / 字段落库 / 解析报告更新时，把编辑态重置为当前生效事实（编辑中不会被打断：仅依赖项变化才触发）
  useEffect(() => {
    const cur = activeProjectRef.current
    // R282：整条记录传入——面板显示的生效事实必须与各注入点（章/节/续写/偏离表…）逐字同源，
    // 只挑两个字段会让面板少显示「招标编号」兜底行，用户据此保存反而会把事实改少
    setFactDraft(effectiveGlobalFactsLines(cur))
  }, [activeProject?.id, activeProject?.global_facts, activeProject?.parse_report])

  /** 保存事实表：空清单存 ""（回退自动抽取），非空一行一条 PATCH global_facts（applySetting 防抖落库） */
  const saveGlobalFacts = useCallback(() => {
    if (blockIfArchived()) return
    const lines = factDraft.map((l) => l.trim()).filter(Boolean)
    applySetting("global_facts", lines.join("\n"))
    toast.success(
      lines.length
        ? `已保存 ${lines.length} 条全局事实，后续大纲、正文与续写统一按此口径书写`
        : "已清空人工事实设定，回退为解析报告自动抽取口径",
    )
  }, [applySetting, blockIfArchived, factDraft])

  const runGenerateFactSettings = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const source0 = factSettingsSourceText(cur.parse_report)
    if (!source0.trim()) {
      toast.error("解析报告关键节为空，请先完成「② AI 解析报告」再生成事实设定")
      return
    }
    // 循环 2 批 1-3：范本摘录非空时并入输入（前 3000 字），同主题事实优先采用范本口径
    const tpl = (cur.ref_template_text ?? "").trim()
    const source = tpl
      ? `${source0}\n\n【历史标书范本摘录（同主题事实优先采用范本口径）】\n${tpl.slice(0, 3000)}`
      : source0
    setFactAiBusy(true)
    try {
      const raw = await llmGenerate(buildFactSettingsMessages(source), MAX_TOKENS_LONGFORM, undefined, 0)
      let lines = factLinesFromText(raw)
      // 循环 2 批 1-2：解析为空（疑似格式异常）时自动做一次语法修复重试，不单独弹费用确认
      if (!lines.length) {
        try {
          const repaired = await llmGenerate(buildJsonRepairMessages(raw), MAX_TOKENS_LONGFORM, undefined, 0)
          lines = factLinesFromText(repaired)
        } catch {
          // 修复调用失败：按原口径走下方空结果提示
        }
      }
      if (!lines.length) {
        toast.error("未能从解析报告提炼出事实设定，请检查解析结果后重试")
        return
      }
      setFactDraft(lines)
      toast.success(`已生成 ${lines.length} 条事实设定（编辑态），可继续修改，点「保存事实表」后全文生效`)
    } catch (e) {
      handleLlmError(e, "生成事实设定失败，请重试")
    } finally {
      setFactAiBusy(false)
    }
  }, [handleLlmError])

  const startGenerateFactSettings = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    if (!activeProjectRef.current?.parse_report) {
      toast.error("请先完成「② AI 解析报告」再生成事实设定")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runGenerateFactSettings()
      },
      `AI 将从解析报告关键节提炼全文统一口径的事实设定清单（一次调用，结果进入编辑态，保存后才生效；格式异常时自动修复一次），${costText()}`,
    )
  }, [blockIfArchived, costConfirm, requireLogin, runGenerateFactSettings])

  /** 改造 1.3：事实一致性核对前提——有生效事实 + 至少一章有正文（工具视图未打开项目时禁用） */
  const canFactCheck = Boolean(
    activeProject &&
      effectiveGlobalFactsLines(activeProject).length > 0 &&
      (activeProject.bid_chapters ?? []).some((c) => (c.content ?? "").trim()),
  )
  const factProjectName = activeProject?.project_name ?? ""

  const runFactCheck = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const lines = effectiveGlobalFactsLines(cur)
    if (!lines.length) {
      toast.error("当前项目没有可用的全局事实，请先在编制环节生成或填写事实表")
      return
    }
    // 本地检索零费用：每条事实取主题词在各章正文捞命中段落（每事实 ≤3 段、每段 ≤400 字）
    const evidence = collectFactEvidence(lines, cur.bid_chapters)
    setFactCheckBusy(true)
    try {
      const raw = await llmGenerate(buildFactCheckMessages(wrapGlobalFactsBlock(lines), evidence), MAX_TOKENS_LONGFORM)
      // 循环 2 批 1-2：矛盾清单 JSON 解析失败时自动做一次语法修复重试（费用含在本入口确认内）
      setFactCheckResult(await withJsonRepair(raw, sanitizeFactConflicts))
      setFactCheckOpen(true)
    } catch (e) {
      handleLlmError(e, "事实一致性核对失败，请重试")
    } finally {
      setFactCheckBusy(false)
    }
  }, [handleLlmError])

  const startFactCheck = useCallback(() => {
    if (!requireLogin()) return
    if (!activeProjectRef.current) {
      toast.error("请先在项目列表打开一个标书项目，再进行事实一致性核对")
      return
    }
    if (!canFactCheck) {
      toast.error("当前项目缺少全局事实或章节正文，请先在编制环节完成事实表与正文生成")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runFactCheck()
      },
      `AI 将逐条核对全局事实与各章命中段落是否口径一致并输出矛盾清单（一次调用，段落检索在本地完成零费用；格式异常时自动修复一次），${costText()}`,
    )
  }, [canFactCheck, costConfirm, requireLogin, runFactCheck])

  // ------------------------------ 循环 2 批 1-1：审计自动修复闭环（一键修复矛盾） ------------------------------
  const [factPatchBusy, setFactPatchBusy] = useState(false)

  /**
   * 一键修复：把当前矛盾清单 + 各矛盾所在章正文截段喂给 LLM 生成精准替换补丁
   * [{chapter, old_text, new_text}]；本地校验 old_text 在对应章正文「唯一命中」
   * （indexOf 与 lastIndexOf 同位置）才替换，否则计入跳过；按章累积后统一 updateChapter。
   * 循环 8 A3：可选 overrideConflicts——交卷体检区「一键修复」直接传体检产出的 fact_conflicts，
   * 缺省回落快捷工具的 factCheckResult state（Array.isArray 守卫，防 onClick 事件对象误入参）。
   */
  const runFactPatch = useCallback(async (overrideConflicts?: FactConflict[]) => {
    const cur = activeProjectRef.current
    if (!cur) return
    const conflicts = (Array.isArray(overrideConflicts) && overrideConflicts.length ? overrideConflicts : factCheckResult) ?? []
    if (!conflicts.length) {
      toast.error("当前没有待修复的矛盾清单，请先执行事实一致性核对")
      return
    }
    setFactPatchBusy(true)
    try {
      const raw = await llmGenerate(buildFactPatchMessages(conflicts, cur.bid_chapters), MAX_TOKENS_LONGFORM)
      const patches = await withJsonRepair(raw, sanitizeFactPatches)
      if (!patches.length) {
        toast.error("未能生成可用的修复补丁，请稍后重试或手动修改正文")
        return
      }
      const chapters = cur.bid_chapters ?? []
      const resolveNode = (nameRaw: string): Chapter | null => {
        const t = (nameRaw ?? "").trim()
        if (!t) return null
        const exact = chapters.find((c) => (c.title ?? "").trim() === t)
        if (exact) return exact
        return (
          chapters.find((c) => {
            const ct = (c.title ?? "").trim()
            return Boolean(ct) && (ct.includes(t) || t.includes(ct))
          }) ?? null
        )
      }
      // 按章累积内容：同一章多条补丁依次生效，后续补丁在前一条的结果上定位
      const contentByNode = new Map<string, string>()
      let fixed = 0
      let skipped = 0
      for (const pt of patches) {
        const node = resolveNode(pt.chapter)
        if (!node) {
          skipped += 1
          continue
        }
        const base = contentByNode.get(node.node_id) ?? node.content ?? ""
        const at = base.indexOf(pt.old_text)
        // 唯一性校验：未命中或多处命中都跳过，避免误改
        if (at < 0 || base.lastIndexOf(pt.old_text) !== at) {
          skipped += 1
          continue
        }
        contentByNode.set(node.node_id, base.slice(0, at) + pt.new_text + base.slice(at + pt.old_text.length))
        fixed += 1
      }
      for (const [nodeId, content] of contentByNode) {
        updateChapter(nodeId, { content })
      }
      if (fixed > 0) {
        toast.success(
          `一键修复完成：修复 ${fixed} 处、跳过 ${skipped} 处（未唯一定位）；建议重新「开始核对」或「交卷体检」复检`,
        )
      } else {
        toast.warning(`本次没有可自动修复的矛盾：跳过 ${skipped} 处（未唯一定位），请手动修改正文`)
      }
    } catch (e) {
      handleLlmError(e, "一键修复失败，请重试")
    } finally {
      setFactPatchBusy(false)
    }
  }, [factCheckResult, handleLlmError, updateChapter])

  const startFactPatch = useCallback((overrideConflicts?: FactConflict[]) => {
    if (!requireLogin()) return
    // 循环 8 A3：一键修复会改写章节正文——归档只读拦截（对照 startSubmissionCheck，原先缺失）
    if (blockIfArchived()) return
    if (!activeProjectRef.current) {
      toast.error("请先在项目列表打开一个标书项目，再执行一键修复")
      return
    }
    const conflicts = (Array.isArray(overrideConflicts) && overrideConflicts.length ? overrideConflicts : factCheckResult) ?? []
    if (!conflicts.length) {
      toast.error("当前没有待修复的矛盾清单，请先执行事实一致性核对")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runFactPatch(conflicts)
      },
      `AI 将根据矛盾清单生成精准替换补丁并自动修复各章正文（一次调用，仅唯一命中的原文会被替换；格式异常时自动修复一次，费用含在本次确认内），${costText()}`,
    )
  }, [blockIfArchived, costConfirm, factCheckResult, requireLogin, runFactPatch])

  // ------------------------------ T18：文本审计（错别字 + 逻辑谬误，易标 rejection-check 两路移植） ------------------------------

  const [textAuditBusy, setTextAuditBusy] = useState<"" | "typo" | "logic" | "both">("")

  /**
   * 文本审计：对检查对象（内部模式=已成稿技术章正文；外部模式=外部投标文件全文）跑
   * 错别字 + 逻辑谬误两路 AI 检查。超限文档按章内分段（段偏移还原位置校验），段间并发 2 路；
   * 错别字条目做「wrongText 原文真实存在」强校验（模型幻觉条目自动丢弃），结果落 bid_projects.text_audit。
   */
  const runTextAudit = useCallback(
    async (scope: "typo" | "logic" | "both"): Promise<void> => {
      const cur = activeProjectRef.current
      if (!cur) return
      // 检查对象：外部标书模式审外部全文（单块），内部模式审已成稿技术章
      const docs: AuditDoc[] =
        cur.bid_source_mode === "external" && (cur.bid_external_text ?? "").trim()
          ? [{ id: "external", title: "外部投标文件", content: cur.bid_external_text }]
          : techChapters(cur.bid_chapters)
              .filter((c) => (c.content ?? "").trim())
              .map((c) => ({ id: c.node_id, title: c.title, content: c.content ?? "" }))
      if (!docs.length) {
        toast.error(cur.bid_source_mode === "external" ? "请先上传外部投标文件，再进行文本审计" : "当前没有已成稿的章节正文，请先生成正文")
        return
      }
      setTextAuditBusy(scope)
      try {
        const typos: TypoFinding[] = []
        const logic: LogicFinding[] = []
        // T19：核对失败章归档（易标"核对失败的小节"口径）——AI 调用失败/超时的章记录原因，
        // 报告中单独列出，重跑只扫失败章；成功段结果照常保留。
        const failedDocs = new Map<string, string>()
        const totalSegments = docs.reduce((s, d) => s + splitAuditDoc(d, TEXT_AUDIT_SEGMENT_CHARS).length, 0)
        let doneSegments = 0
        for (const doc of docs) {
          const segments = splitAuditDoc(doc, TEXT_AUDIT_SEGMENT_CHARS)
          // 段间并发 2 路（同 generateChapterContent 的取消感知口径）
          const queue = [...segments]
          const worker = async (): Promise<void> => {
            for (;;) {
              if (cancelBulkRef.current) return
              const seg = queue.shift()
              if (!seg) return
              const chapterRefs: { no: number; title: string; content: string }[] = [{ no: 1, title: doc.title, content: seg.text }]
              const segmented = segments.length > 1
              const jobs: Promise<void>[] = []
              if (scope !== "logic") {
                jobs.push(
                  (async () => {
                    try {
                      const raw = await llmGenerate(buildTypoCheckMessages(chapterRefs), MAX_TOKENS_LONGFORM, undefined, 0, { disableThinking: true })
                      // 段内检查：以段文本为校验语料，命中位置为段内偏移，随后还原为全文偏移并重建摘录/行号
                      const found = sanitizeTypoFindings(raw, { ...doc, content: segmented ? seg.text : doc.content })
                      for (const t of found) {
                        if (segmented) {
                          const abs = seg.start + t.position
                          typos.push({ ...t, position: abs, excerpt: buildVerifiedExcerpt(doc.content, abs, t.wrongText), line: lineAt(doc.content, abs) })
                        } else {
                          typos.push(t)
                        }
                      }
                      failedDocs.delete(doc.id)
                    } catch (e) {
                      if (e instanceof AuthRequiredError) throw e
                      failedDocs.set(doc.id, `错别字检查失败：${(e as Error)?.message?.slice(0, 80) ?? "未知错误"}`) // 单段失败归档不拖垮整体
                    }
                  })(),
                )
              }
              if (scope !== "typo") {
                jobs.push(
                  (async () => {
                    try {
                      const raw = await llmGenerate(buildLogicCheckMessages(chapterRefs), MAX_TOKENS_LONGFORM)
                      logic.push(...sanitizeLogicFindings(raw, doc))
                      failedDocs.delete(`${doc.id}#logic`)
                    } catch (e) {
                      if (e instanceof AuthRequiredError) throw e
                      failedDocs.set(`${doc.id}#logic`, `逻辑检查失败：${(e as Error)?.message?.slice(0, 80) ?? "未知错误"}`)
                    }
                  })(),
                )
              }
              await Promise.all(jobs)
              doneSegments += 1
              if (totalSegments > 1) {
                toast.info(`文本审计进度：${doneSegments}/${totalSegments} 段`)
              }
            }
          }
          await Promise.all([worker(), worker()])
        }
        // 去重合并落库（保留旧报告的另半边结果：scope 单路时不清另一路）
        const prev = normalizeTextAudit(activeProjectRef.current?.text_audit)
        const prevTypos = scope === "logic" ? prev?.typos ?? [] : []
        const prevLogic = scope === "typo" ? prev?.logic ?? [] : []
        // T19：失败章合并（本轮成功清掉对应条目，仍失败的保留并向新报告归档）
        const failedList = docs
          .filter((d) => failedDocs.has(d.id) || failedDocs.has(`${d.id}#logic`))
          .map((d) => ({ docId: d.id, docTitle: d.title, reason: failedDocs.get(d.id) ?? failedDocs.get(`${d.id}#logic`) ?? "核对失败" }))
        const report: TextAuditReport = {
          typos: mergeFindings([
            ...prevTypos,
            ...typos.map((t) => ({ docId: t.docId, docTitle: t.docTitle, wrongText: t.wrongText, correctText: t.correctText, excerpt: t.excerpt, reason: t.reason, line: t.line })),
          ]),
          logic: mergeLogic([...prevLogic, ...logic]),
          checked_at: new Date().toISOString(),
          source: cur.bid_source_mode === "external" && (cur.bid_external_text ?? "").trim() ? "external" : "internal",
          failed: failedList.length ? failedList : undefined,
        }
        updateProject({ text_audit: report })
        writeStageSnapshot("chapter", `文本审计完成：错别字 ${report.typos.length} / 逻辑 ${report.logic.length}${failedList.length ? ` / 失败章 ${failedList.length}` : ""}`, {})
        const parts: string[] = []
        if (scope !== "logic") parts.push(`错别字 ${report.typos.length} 处`)
        if (scope !== "typo") parts.push(`逻辑问题 ${report.logic.length} 处`)
        if (failedList.length) parts.push(`核对失败 ${failedList.length} 章（可重跑补齐）`)
        if (report.typos.length || report.logic.length) {
          toast.warning(`文本审计完成：${parts.join("、")}（结果已存档，可到「交卷体检」逐条复核）`)
        } else if (failedList.length) {
          toast.warning(`文本审计完成：${parts.join("、")}（结果已存档）`)
        } else {
          toast.success("文本审计完成：未发现高确信的错别字或逻辑问题")
        }
      } catch (e) {
        handleLlmError(e, "文本审计失败，请重试")
      } finally {
        setTextAuditBusy("")
      }
    },
    [handleLlmError, updateProject, writeStageSnapshot],
  )

  /** 手动入口：文本审计（费用按检查对象体量说明） */
  const startTextAudit = useCallback(
    (scope: "typo" | "logic" | "both") => {
      if (!requireLogin()) return
      if (blockIfArchived()) return
      const cur = activeProjectRef.current
      if (!cur) return
      const isExternal = cur.bid_source_mode === "external" && (cur.bid_external_text ?? "").trim().length > 0
      const targetDesc = isExternal
        ? "外部投标文件全文"
        : `已成稿的 ${techChapters(cur.bid_chapters).filter((c) => (c.content ?? "").trim()).length} 个章节正文`
      costConfirm.runWithCostConfirm(() => {
        void runTextAudit(scope)
      }, `AI 将对${targetDesc}做${scope === "typo" ? "错别字" : scope === "logic" ? "逻辑谬误" : "错别字与逻辑谬误"}检查（错别字仅报高确信项且逐条经原文位置校验，幻觉条目自动丢弃；逻辑检查覆盖前后不一致与因果漏洞），超长正文自动分段检查，费用按实际用量累加，${costText()}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runTextAudit],
  )

  // T18+：错别字一键修正 / 逻辑问题跳转——声明在 activeChapterId/selectChapter 之后（见文件后部）

  // ------------------------------ 第十六轮 B2 改造 2.1：预编排（表格/配图） ------------------------------
  // 大纲确认后对技术章叶子批量做版面编排判断（哪节宜表格、哪节配一张什么图），配图按 maxFigures 全局择优；
  // 结果存 bid_projects.orchestration，正文生成（改造 2.2）按章/节映射消费。未编排项目行为与现状完全一致。
  const orchestrationSummary = useMemo(() => summarizeOrchestration(activeProject?.orchestration ?? null), [activeProject?.orchestration])
  const [orchestrationBusy, setOrchestrationBusy] = useState(false)
  const [orchestrationProgress, setOrchestrationProgress] = useState<{ current: number; total: number } | null>(null)

  const runOrchestration = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const leaves = collectTechLeafRefs(cur.bid_outline)
    if (!leaves.length) {
      toast.error("大纲里没有技术章叶子，请先确认大纲后再智能编排")
      return
    }
    const cap = effectiveMaxFigures(cur.max_figures)
    const projectBrief = orchestrationProjectBrief(cur.parse_report)
    // 循环 2 批 2-1：编排输入增事实表行 + 评分项清单（让编排为本章挑必守事实、给写作焦点、为图写图注）
    const factsLines = effectiveGlobalFactsLines(cur)
    const scoringItems = scoringItemsFromReport(cur.parse_report)
    // T16：知识库候选素材（每叶 top2 检索、批内去重编号 K1…K12）——编排期为各叶定向挑素材，失败静默降级为无候选
    // 2026-10-07：改用非阻塞缓存读取——全库 1.14 亿字，冷缓存 await 全量拉取会把整个编排挂住数分钟
    // （且 13 页 ×9MB 的 list 请求串行挤占 PB 单线程 hook），而 KB 候选只是可选增强，拉不到就该降级。
    let kbDocs: KbDocRow[] = []
    try {
      kbDocs = await getCachedVisibleDocsNonBlocking(userId)
    } catch {
      kbDocs = []
    }
    const projectTrack = deriveTrack(
      [cur.project_name, cur.hospital, (cur.tender_text ?? "").slice(0, 2000)].filter(Boolean).join(" "),
    )
    const buildBatchKnowledge = (batch: TechLeafRef[]): { candidates: { ref: string; text: string }[]; textMap: Map<string, string> } => {
      const candidates: { ref: string; text: string }[] = []
      const textMap = new Map<string, string>()
      if (!kbDocs.length) return { candidates, textMap }
      let seq = 0
      for (const leaf of batch) {
        try {
          const { hits } = assembleKbContext(kbDocs, {
            query: [leaf.chapter, leaf.title].filter(Boolean).join(" ").slice(0, 600),
            track: projectTrack,
            buckets: ["标书弹药", "产品资料", "方案素材"],
            sections: [deriveSection([leaf.chapter, leaf.title].filter(Boolean).join(" "))],
            topN: 2,
          })
          for (const h of hits) {
            if (candidates.length >= 12) break
            seq += 1
            const ref = `K${seq}`
            const text = `（来源文档：《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}）\n${clipText(h.snippet, 400)}`
            candidates.push({ ref, text })
            textMap.set(ref, text)
          }
        } catch {
          // 单叶检索失败跳过，不影响编排主流程
        }
        if (candidates.length >= 12) break
      }
      return { candidates, textMap }
    }
    // 批量调用：≤10 叶/次（规格硬约束），批间串行；单批失败重试 1 次后跳过（不让一批拖垮全局）
    const batches: TechLeafRef[][] = []
    for (let i = 0; i < leaves.length; i += ORCHESTRATION_BATCH_SIZE) {
      batches.push(leaves.slice(i, i + ORCHESTRATION_BATCH_SIZE))
    }
    setOrchestrationBusy(true)
    try {
      const acc: Record<string, LeafOrchestration> = {}
      let failedBatches = 0
      for (let b = 0; b < batches.length; b++) {
        setOrchestrationProgress({ current: b + 1, total: batches.length })
        let ok = false
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            // T16：每批独立构建知识库候选（叶主题相关，批间 ref 重新编号防串批）
            const batchKnowledge = buildBatchKnowledge(batches[b])
            const raw = await llmGenerate(
              buildOrchestrationMessages(batches[b], projectBrief, {
                factsLines,
                scoringItems,
                knowledgeCandidates: batchKnowledge.candidates,
                mermaidEnabled: cap > 0,
                aiImageEnabled: cap > 0,
                figureCap: cap,
              }),
              MAX_TOKENS_LONGFORM,
            )
            // 循环 2 批 1-2：单批 JSON 解析失败时自动做一次语法修复重试（费用含在本入口确认内）
            const idSet = new Set(batches[b].map((l) => l.nodeId))
            Object.assign(
              acc,
              await withJsonRepair(raw, (t) => sanitizeOrchestrationBatch(t, idSet, { knowledgeText: batchKnowledge.textMap, figureCap: cap })),
            )
            ok = true
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            if (attempt === 1) failedBatches += 1
          }
        }
      }
      setOrchestrationProgress(null)
      if (!Object.keys(acc).length) throw new Error("编排调用均未产出有效结果，请重试")
      // 程序全局择优：figure 候选按叶子文档顺序均分 cap 段、段内取 priority 最高者（避免配图头重脚轻）
      const selectedCount = selectOrchestrationFigures(
        leaves.map((l) => l.nodeId),
        acc,
        cap,
      )
      const tableCount = Object.values(acc).filter((e) => e.table?.needed).length
      applySetting("orchestration", { leaves: acc, generated_at: new Date().toISOString() } as BidOrchestration)
      toast.success(
        `智能编排完成：覆盖 ${Object.keys(acc).length} 个叶子，${tableCount} 节建议表格，选定 ${selectedCount} 张配图（全文上限 ${cap} 张）${
          failedBatches ? `；有 ${failedBatches} 批未产出结果，可重新编排补齐` : ""
        }，之后生成的正文自动按编排执行`,
      )
    } catch (e) {
      setOrchestrationProgress(null)
      handleLlmError(e, "智能编排失败，请重试")
    } finally {
      setOrchestrationBusy(false)
    }
  }, [applySetting, handleLlmError, userId])

  const startOrchestration = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    const cur = activeProjectRef.current
    if (!cur) {
      toast.error("请先在项目列表打开一个标书项目，再进行智能编排")
      return
    }
    if (!cur.bid_outline.length || !cur.bid_chapters.length) {
      toast.error("请先确认大纲，再进行智能编排")
      return
    }
    if (cur.figures_enabled !== true) {
      toast.error("章节配图开关已关闭，请先在「生成设置」中开启后再智能编排")
      return
    }
    const leafCount = collectTechLeafRefs(cur.bid_outline).length
    if (!leafCount) {
      toast.error("大纲里没有技术章叶子，无法编排")
      return
    }
    const batchCount = Math.ceil(leafCount / ORCHESTRATION_BATCH_SIZE)
    const cap = effectiveMaxFigures(cur.max_figures)
    costConfirm.runWithCostConfirm(
      () => {
        void runOrchestration()
      },
      `AI 将为 ${leafCount} 个技术章叶子预编排正文版面（哪节宜用表格、哪节配一张架构/流程/界面示意/关系图/AI 配图），分 ${batchCount} 次调用（每次最多 ${ORCHESTRATION_BATCH_SIZE} 个叶子），配图全局择优、总数不超过 ${cap} 张，并为每节挑选本章必守事实、给出写作焦点与配图图注；编排结果只对之后的正文生成生效（格式异常时自动修复一次），${costText()}`,
    )
  }, [costConfirm, requireLogin, runOrchestration])

  // ------------------------------ T17：AI 位图补图阶段（易标 illustration-generating AI 分支移植） ------------------------------

  const [aiFigureBusy, setAiFigureBusy] = useState(false)
  const [aiFigureProgress, setAiFigureProgress] = useState<{ current: number; total: number; title: string } | null>(null)

  /**
   * AI 位图生成（独立异步阶段，绝不进小节串行生成循环）：
   * 收集编排选中的 type=ai 配图 → 并发 2 路走 aigc 文生图（易标 prompt 口径）→ 成功后
   * persistMediaUrl 落 PocketBase → 回填 {type:"image"} 到所在章 figures。
   * 全程失败不阻塞正文：单图失败跳过并在收尾汇报；aigc 通道不可用/未登录/无余额给出明确提示。
   */
  const runAiFigures = useCallback(
    async (): Promise<{ ok: number; failed: number; skipped: boolean }> => {
      const cur = activeProjectRef.current
      if (!cur) return { ok: 0, failed: 0, skipped: true }
      const orch = cur.orchestration
      if (!orch) {
        toast.error("请先完成智能编排（编排中把具象场景节标记为「AI 配图」），再生成 AI 位图")
        return { ok: 0, failed: 0, skipped: true }
      }
      const targets = collectAiFigureTargets(orch, cur.bid_outline)
      if (!targets.length) {
        toast.info("编排里没有选中的「AI 配图」——智能编排会只为具象场景节（机房/数据中心/现场实施等）标记 AI 配图；可重新编排或先用架构/流程/mermaid 图型")
        return { ok: 0, failed: 0, skipped: true }
      }
      setAiFigureBusy(true)
      let ok = 0
      let failed = 0
      const done: { chapterNodeId: string; figure: FigureSpec }[] = []
      try {
        // 并发 2 路（对齐 aigc 生图默认并发约束），单图失败跳过不拖垮批次
        const queue = [...targets]
        const worker = async (): Promise<void> => {
          for (;;) {
            const target = queue.shift()
            if (!target) return
            if (cancelBulkRef.current) return
            const leafTitle = leafTitleOf(cur.bid_outline, target.nodeId)
            setAiFigureProgress({ current: targets.length - queue.length, total: targets.length, title: target.title })
            const chapter = cur.bid_chapters.find((c) => c.node_id === target.chapterNodeId)
            const prompt = buildAiImagePrompt({
              title: target.title,
              caption: target.caption,
              scene: target.scene || leafTitle,
              style: target.style,
              sectionText: chapter?.content ?? "",
            })
            try {
              const r = await callAigcAndPoll(AI_IMAGE_MODEL, { prompt, aspectRatio: "16:9", page: AI_IMAGE_PAGE })
              if (r.status !== "success") {
                failed += 1
                continue
              }
              const rawUrl = r.url || r.outputs?.[0]?.url
              if (!rawUrl) {
                failed += 1
                continue
              }
              // 外链落地 PB（失败返回原 URL 不阻塞），回填 image 型 FigureSpec
              const url = await persistMediaUrl(rawUrl, "bid-ai-figure")
              done.push({
                chapterNodeId: target.chapterNodeId,
                figure: {
                  type: "image",
                  title: target.title,
                  url,
                  prompt,
                  ...(target.caption ? { caption: target.caption } : {}),
                },
              })
              ok += 1
            } catch {
              failed += 1
            }
          }
        }
        await Promise.all([worker(), worker()])
        // 统一落库（按章聚合，一次 updateChapter 一章）
        const byNode = applyAiFigureToChapters(
          activeProjectRef.current?.bid_chapters ?? [],
          done,
        )
        for (const [nodeId, figures] of byNode) {
          updateChapter(nodeId, { figures })
        }
        if (ok > 0) {
          writeStageSnapshot("chapter", `AI 位图生成：${ok} 张`, {})
        }
        return { ok, failed, skipped: false }
      } finally {
        setAiFigureBusy(false)
        setAiFigureProgress(null)
      }
    },
    [updateChapter, writeStageSnapshot],
  )

  /** 手动入口：AI 位图生成（费用确认 + 单价预估；aigc 未登录/无余额的错误在结果里给中文提示） */
  const startAiFigures = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    const cur = activeProjectRef.current
    if (!cur) return
    if (bulkGeneratingRef.current) {
      toast.error("批量生成进行中，请先停止批量或等待其完成，再生成 AI 位图")
      return
    }
    if (!cur.orchestration) {
      toast.error("请先完成智能编排，再生成 AI 位图")
      return
    }
    const targetCount = collectAiFigureTargets(cur.orchestration, cur.bid_outline).length
    if (!targetCount) {
      // 配图上限为 0 时编排必然选不中任何配图——给出可操作的指引，而不是让用户误以为编排漏标
      toast.info(
        cur.figures_enabled && maxFigures === 0
          ? "全文配图上限为 0（0=不配图），编排不会选中任何配图：请在「生成设置 → 全文配图上限」调高（留空=不限），重新编排后再生成配图"
          : "编排里没有选中的「AI 配图」；智能编排只为具象场景节标记 AI 配图，可重新编排",
      )
      return
    }
    void previewAigcPrice(AI_IMAGE_MODEL, { prompt: "预算预估", aspectRatio: "16:9", page: AI_IMAGE_PAGE }).then((price) => {
      const priceText = price.ok && price.message ? `，预估单价 ${price.message}` : ""
      costConfirm.runWithCostConfirm(() => {
        setAiFigureBusy(true)
        void runAiFigures()
          .then((r) => {
            if (r.skipped) return
            if (r.ok > 0) toast.success(`AI 位图生成完成：成功 ${r.ok} 张${r.failed ? `、失败 ${r.failed} 张（可重试补齐）` : ""}，已插入对应章节`)
            else toast.error("AI 位图全部生成失败——请检查 RunningHub 登录态与余额后重试")
          })
          .catch((e) => handleLlmError(e, "AI 位图生成失败"))
          .finally(() => setAiFigureBusy(false))
      }, `将为编排选中的 ${targetCount} 处具象场景生成 AI 配图（工程图示/实景照片风格，16:9，生成后自动插入对应章节，约 ${targetCount} 次生图调用${priceText}），生成失败不阻塞正文，${costText()}`)
    })
  }, [blockIfArchived, costConfirm, handleLlmError, maxFigures, requireLogin, runAiFigures])

  // ------------------------------ Q28 切片G：编排配图补齐（figure backfill + 图位落位） ------------------------------
  // 实测缺陷（项目13 / 2026-10-07）：智能编排选定 35 张配图覆盖 27 个小节，9 章正文全部 done 后库里只有 14 张。
  // 机理是配图只随「小节首块」的 JSON 契约（{"content","figures"}）顺带产出：模型对 2000 字块直接返纯文本
  // （figures 键丢失）、mermaid 渲染校验失败弃图、断点续跑跳过已产出小节（图随首轮丢失）三条路都静默丢图，
  // 而产品侧此前唯一的补图入口「AI 配图生成」只覆盖编排里 type=ai 的位图（本项目 3 张），结构化图根本没有补口。
  // 这里补上独立后置阶段：按编排计划逐张发「千字摘录 + 单图 JSON 契约」的小请求，解析不出合法图即弃图
  // （宁缺毋滥——坏 mermaid 进暗标是废标风险），并把每张图按其小节写回图位锚点行，让导出的 Word 不再把
  // 一章 3-5 张图全挤在章首（bidFiles 早就支持「【图：标题】」按标题精确插位，但生成链路从未写过这种行）。

  const [figureBackfillBusy, setFigureBackfillBusy] = useState(false)
  const [figureBackfillProgress, setFigureBackfillProgress] = useState<{ current: number; total: number; title: string } | null>(null)

  /** 待补齐张数：编排选中却尚未落库的本地图型数量（纯本地计算，零 AI；按钮文案与禁用态用） */
  const figureBackfillPending = useMemo(
    () =>
      collectFigureBackfillTargets(
        activeProject?.orchestration ?? null,
        activeProject?.bid_outline ?? null,
        activeProject?.bid_chapters ?? null,
      ).length,
    [activeProject?.orchestration, activeProject?.bid_outline, activeProject?.bid_chapters],
  )

  /**
   * 补齐执行编排：单图单请求（关思考 + temperature=0，走切片F 限流闸门）、并发 2 路，
   * 单图失败/弃图只计数不阻塞其余；成功后按章聚合 append figures，并对全章重排图位锚点。
   * 正文只做「插入独立标记行」这一种改动：不删不改任何既有行，可重复执行（幂等）。
   */
  const runFigureBackfill = useCallback(
    async (): Promise<{ ok: number; failed: number; placed: number; skipped: boolean }> => {
      const cur = activeProjectRef.current
      const skip = { ok: 0, failed: 0, placed: 0, skipped: true }
      if (!cur?.orchestration) {
        toast.error("请先完成智能编排（配图计划来自编排结果），再补齐配图")
        return skip
      }
      const targets = collectFigureBackfillTargets(cur.orchestration, cur.bid_outline, cur.bid_chapters)
      if (!targets.length) {
        toast.info("编排选中的配图已全部落库，无需补齐")
        return skip
      }
      setFigureBackfillBusy(true)
      let ok = 0
      let failed = 0
      const added = new Map<string, FigureSpec[]>()
      try {
        const queue = [...targets]
        const worker = async (): Promise<void> => {
          for (;;) {
            const t = queue.shift()
            if (!t) return
            if (cancelBulkRef.current) return
            setFigureBackfillProgress({ current: targets.length - queue.length, total: targets.length, title: t.plan.title })
            try {
              const raw = await llmGenerate(
                buildFigureBackfillMessages({
                  projectName: cur.project_name,
                  chapterTitle: t.chapterTitle,
                  sectionTitle: t.sectionTitle,
                  plan: t.plan,
                  excerpt: t.excerpt,
                }),
                FIGURE_BACKFILL_MAX_TOKENS,
                "bid-chapter",
                0,
                { disableThinking: true },
              )
              const spec = parseFigureBackfill(raw, t.plan)
              if (!spec) {
                failed += 1
                continue
              }
              // mermaid 型逐张渲染校验（错误回传模型修一次，仍不过即弃图），本地 SVG 型原样透传
              const kept = await repairMermaidFigures([spec])
              const ch = cur.bid_chapters.find((c) => c.node_id === t.nodeId)
              const dup = kept[0] && (ch?.figures ?? []).some((f) => (f.title ?? "").trim() === kept[0].title.trim())
              if (!kept[0] || dup) {
                failed += 1
                continue
              }
              const list = added.get(t.nodeId) ?? []
              list.push(kept[0])
              added.set(t.nodeId, list)
              ok += 1
            } catch (e) {
              if (e instanceof AuthRequiredError) throw e
              failed += 1
            }
          }
        }
        await Promise.all([worker(), worker()])
        // 先在「含新图」的快照上算落位计划（新图标题即编排计划标题，既有图标题用库内实际名），再整章写回
        const withNew = (cur.bid_chapters ?? []).map((c) => {
          const extra = added.get(c.node_id)
          return extra?.length ? { ...c, figures: [...(c.figures ?? []), ...extra] } : c
        })
        const placements = collectFigurePlacements(cur.orchestration, cur.bid_outline, withNew)
        let placed = 0
        for (const c of withNew) {
          const rows = placements.filter((x) => x.nodeId === c.node_id)
          const nextContent = rows.length ? applyFigureAnchors(c.content ?? "", c.sections ?? [], rows) : c.content
          const patchObj: Partial<Chapter> = {}
          if (added.has(c.node_id)) patchObj.figures = c.figures
          if (nextContent !== c.content) {
            patchObj.content = nextContent
            placed += 1
          }
          if (Object.keys(patchObj).length) updateChapter(c.node_id, patchObj)
        }
        if (ok > 0 || placed > 0) {
          writeStageSnapshot("chapter", `编排配图补齐：新增 ${ok} 张、落位 ${placed} 章`, {})
        }
        return { ok, failed, placed, skipped: false }
      } finally {
        setFigureBackfillBusy(false)
        setFigureBackfillProgress(null)
      }
    },
    [updateChapter, writeStageSnapshot],
  )

  /** 手动入口：补齐编排配图（费用确认；只新增配图与图位标记行，不改写正文一字） */
  const startFigureBackfill = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    const cur = activeProjectRef.current
    if (!cur) return
    if (bulkGeneratingRef.current) {
      toast.error("批量生成进行中，请等待其完成再补齐配图")
      return
    }
    if (!cur.orchestration) {
      toast.error("请先完成智能编排（配图计划来自编排结果），再补齐配图")
      return
    }
    const n = collectFigureBackfillTargets(cur.orchestration, cur.bid_outline, cur.bid_chapters).length
    if (!n) {
      toast.info(
        cur.figures_enabled && maxFigures === 0
          ? "全文配图上限为 0（0=不配图），编排不会选中任何配图：请在「生成设置 → 全文配图上限」调高后重新编排"
          : "编排选中的配图已全部落库，无需补齐",
      )
      return
    }
    costConfirm.runWithCostConfirm(() => {
      setFigureBackfillBusy(true)
      void runFigureBackfill()
        .then((r) => {
          if (r.skipped) return
          const tail = r.failed ? `，${r.failed} 张未通过校验已弃图（可重试）` : ""
          if (r.ok > 0) toast.success(`配图补齐完成：新增 ${r.ok} 张${tail}，图位已按小节落位（导出 Word 时插到各自小节末尾）`)
          else toast.error(`配图补齐未成功${tail}——多是本小节正文过短或模型没按 JSON 返回，可重试`)
        })
        .catch((e) => handleLlmError(e, "配图补齐失败"))
        .finally(() => setFigureBackfillBusy(false))
    }, `将为编排选中但未落库的 ${n} 处配图各发一次小请求（约 ${n} 次调用，只新增配图与图位标记行、不改写正文，${costText()}）`)
  }, [blockIfArchived, costConfirm, handleLlmError, maxFigures, requireLogin, runFigureBackfill])

  const openProject = useCallback(    (rec: BidProjectRecord) => {
      // A1 修复：进入新项目前先按旧项目 id 冲刷三组防抖草稿，再兜底设置补丁，杜绝跨项目串写
      flushTenderDraft()
      flushRefTpl()
      flushRefMat()
      flushSettingsPatch()
      applyProjectState(rec)
      // r89-guard-kb-cold-01：进项目即后台预热 KB 缓存，护栏路免冷加载
      void prewarmKbCache(userId)
      setCoverageAudit(null) // 循环 5 A2：覆盖审计仅会话内有效，切项目即清空
      setActiveStep(rec.bid_chapters.length ? 3 : rec.parse_report ? 2 : 1)
      setTenderDraft(rec.tender_text ?? "", { skipPersist: true })
      tenderDraftRef.current = rec.tender_text ?? ""
      // 第十七轮 17D：范本与写作资料回显（skipPersist，同 tender_text 模式）
      setRefTemplateDraft(rec.ref_template_text ?? "", { skipPersist: true })
      setRefMaterialsDraft(rec.ref_materials_text ?? "", { skipPersist: true })
      setMode("detail")
      // 循环 8 A5：从落库的 parse_report.warnings 恢复分段解析失败横幅（无 warnings 的老数据清空）；
      // setter 为稳定引用，不入 deps（声明在本回调之后，入 deps 会触发 TDZ）
      setParseChunkWarnings(rec.parse_report?.warnings ?? [])
      // 生成链路 D1：会话中断（刷新/关页）遗留的 generating 态复位为 failed（批量 skip 会跳过
      // generating 章，不复位则永久跳过）；队列残留时 toast 提示可直接「继续生成正文」续跑
      if (rec.bid_chapters.some((c) => c.gen_status === "generating")) {
        void patchProjectFields(
          rec,
          { bid_chapters: rec.bid_chapters.map((c) => (c.gen_status === "generating" ? { ...c, gen_status: "failed" as const } : c)) },
          "中断章节状态已复位",
          "中断章节状态复位失败",
        )
      }
      if (rec.id && rec.bid_chapters.length && bulkQueueLoad(rec.id).some((nid) => rec.bid_chapters.some((c) => c.node_id === nid && c.gen_status !== "done"))) {
        toast.info("检测到上次批量生成尚未完成，点「继续生成正文」可从上次的章继续（已生成的章节不会重复付费）")
      }
      // 第十一轮改造 4：进项目即拉取工作记录（失败不阻塞）
      void loadStageHistory()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushRefMat, flushRefTpl, flushSettingsPatch, flushTenderDraft, loadStageHistory],
  )

  const backToList = useCallback(() => {
    flushEditingContent()
    // A1 修复：先冲刷三组防抖草稿（仍指向当前项目）再置空 activeProjectRef，避免最近 1.2s 输入丢失
    flushTenderDraft()
    flushRefTpl()
    flushRefMat()
    flushSettingsPatch()
    cancelBulkRef.current = true
    setMode("list")
    setActiveProject(null)
    activeProjectRef.current = null
    setStageHistory([])
    setCoverageAudit(null) // 循环 5 A2：回列表清空会话内覆盖审计结果
    if (userId) void loadProjects(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushRefMat, flushRefTpl, flushSettingsPatch, flushTenderDraft, loadProjects, userId])

  // 第四轮改造 + D2：客户管理「关联投标」跳转带 ?project=<id> 时自动打开该项目
  // ref 存「已消费 id」（URL id 变化即重新消费，对照 useIntelCenter 正确模式）；
  // 列表 miss 时单条 GET /api/bid_projects/{id} 兜底打开，404 才 toast
  const [searchParams] = useSearchParams()
  const deepLinkProjectIdRef = useRef<string | null>(null)
  useEffect(() => {
    const pid = searchParams.get("project")
    if (!pid || deepLinkProjectIdRef.current === pid) return
    deepLinkProjectIdRef.current = pid
    const target = projects.find((item) => item.id === pid)
    if (target) {
      setMainView("projects")
      openProject(target)
      return
    }
    void apiFetch<BidProjectRecord>(`/api/bid_projects/${encodeURIComponent(pid)}`)
      .then((rec) => {
        if (rec?.id) {
          setMainView("projects")
          openProject(normalizeRecord(rec))
        } else {
          toast.error("项目不存在或无权访问")
        }
      })
      .catch(() => toast.error("项目不存在或无权访问"))
  }, [searchParams, projects, openProject])

  // ------------------------------ ① 招标文件导入 ------------------------------
  const [tenderDraft, setTenderDraftState] = useState("")
  const tenderDraftRef = useRef("")
  const [fileBusy, setFileBusy] = useState(false)

  /** 粘贴/上传即自动落盘（1.2s 防抖）：重开项目不丢原文；skipPersist 供切换项目回显恢复用。
   * A1 修复：pending 连同所属 projectId 记录，落盘走 flushTenderDraft（不依赖 activeProjectRef）；
   * skipPersist 分支也先清旧定时器与 pending，避免回显后旧防抖把新 draft 落盘 */
  const setTenderDraft = useCallback(
    (value: string, opts?: { skipPersist?: boolean }) => {
      tenderDraftRef.current = value
      setTenderDraftState(value)
      if (tenderSaveTimerRef.current) {
        window.clearTimeout(tenderSaveTimerRef.current)
        tenderSaveTimerRef.current = null
      }
      tenderPendingRef.current = null
      if (opts?.skipPersist) return
      if (blockIfArchived(true)) return // 循环 5 A3：归档只读（silent，View 已禁用输入，防误触刷屏）
      const trimmed = value.trim()
      const projectId = activeProjectRef.current?.id ?? ""
      if (!trimmed || !projectId) return
      tenderPendingRef.current = { projectId, value: trimmed }
      tenderSaveTimerRef.current = window.setTimeout(() => {
        flushTenderDraft()
      }, 1200)
    },
    [blockIfArchived, flushTenderDraft],
  )

  const handleTenderFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      setFileBusy(true)
      try {
        const text = await extractTenderFileText(file)
        // R-029（R255）：扫描件/图片型文档检测——文字层几乎缺失时阻断并给出 OCR/粘贴指引；偏少则警告但继续
        const quality = assessTenderParseQuality(text, { bytes: file.size })
        if (quality.level === "suspect_scanned") {
          toast.error(quality.hint)
          return
        }
        if (quality.level === "low") toast.warning(quality.hint)
        setTenderDraft(text)
        toast.success(`已解析「${file.name}」，共 ${text.length} 字，确认无误后点「保存招标文件」`)
        // R159：符号丢失签名诚实提示（源文件上游损坏，系统不猜符号，只提示人工对照）
        const loss = detectMarkerSymbolLoss(text)
        if (loss.hits) toast.warning(markerLossNotice(loss))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "文件解析失败，请改用粘贴文本方式导入")
      } finally {
        setFileBusy(false)
      }
    },
    [blockIfArchived, setTenderDraft],
  )

  const saveTenderText = useCallback(() => {
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    const text = tenderDraftRef.current.trim()
    if (!text) {
      toast.error("招标文件内容为空，请先上传文件或粘贴文本")
      return
    }
    updateProject({ tender_text: text })
    toast.success("招标文件已保存到项目")
  }, [blockIfArchived, updateProject])

  // ------------------------------ 第十七轮 17D：范本与资料分离（导入区两个槽） ------------------------------
  const [refTemplateDraft, setRefTemplateDraftState] = useState("")
  const refTemplateDraftRef = useRef("")
  const [refMaterialsDraft, setRefMaterialsDraftState] = useState("")
  const refMaterialsDraftRef = useRef("")
  const [refFileBusy, setRefFileBusy] = useState(false)

  /** 超过 20 万字自动截断（范本/资料同限）：只截断落盘内容，toast 提示一次 */
  const clipRefText = useCallback((value: string): string => {
    if (value.length <= REF_TEXT_LIMIT) return value
    toast.info(`内容超过 ${REF_TEXT_LIMIT / 10000} 万字，已自动截断保存`)
    return value.slice(0, REF_TEXT_LIMIT)
  }, [])

  /** 范本粘贴/上传即自动落盘（1.2s 防抖 applySetting，同 tender_text 模式）；skipPersist 供切换项目回显恢复用。
   * A1 修复：pending 连同所属 projectId 记录，落盘走 flushRefTpl（切换项目后按捕获 id 单独 PATCH，不串写） */
  const setRefTemplateDraft = useCallback(
    (value: string, opts?: { skipPersist?: boolean }) => {
      const clipped = clipRefText(value)
      refTemplateDraftRef.current = clipped
      setRefTemplateDraftState(clipped)
      if (refTplSaveTimerRef.current) {
        window.clearTimeout(refTplSaveTimerRef.current)
        refTplSaveTimerRef.current = null
      }
      refTplPendingRef.current = null
      if (opts?.skipPersist) return
      if (blockIfArchived(true)) return // 循环 5 A3：归档只读（silent）
      const projectId = activeProjectRef.current?.id ?? ""
      if (!projectId) return
      refTplPendingRef.current = { projectId, value: clipped.trim() }
      refTplSaveTimerRef.current = window.setTimeout(() => {
        flushRefTpl()
      }, 1200)
    },
    [blockIfArchived, clipRefText, flushRefTpl],
  )

  /** 写作资料粘贴/上传即自动落盘（1.2s 防抖 applySetting，同 tender_text 模式）。A1 修复同范本槽 */
  const setRefMaterialsDraft = useCallback(
    (value: string, opts?: { skipPersist?: boolean }) => {
      const clipped = clipRefText(value)
      refMaterialsDraftRef.current = clipped
      setRefMaterialsDraftState(clipped)
      if (refMatSaveTimerRef.current) {
        window.clearTimeout(refMatSaveTimerRef.current)
        refMatSaveTimerRef.current = null
      }
      refMatPendingRef.current = null
      if (opts?.skipPersist) return
      if (blockIfArchived(true)) return // 循环 5 A3：归档只读（silent）
      const projectId = activeProjectRef.current?.id ?? ""
      if (!projectId) return
      refMatPendingRef.current = { projectId, value: clipped.trim() }
      refMatSaveTimerRef.current = window.setTimeout(() => {
        flushRefMat()
      }, 1200)
    },
    [blockIfArchived, clipRefText, flushRefMat],
  )

  /** 范本/资料文件导入：复用招标文件同款本地提取（extractTenderFileText，零上传零 AI） */
  const handleRefFile = useCallback(
    async (file: File | null | undefined, kind: "template" | "materials") => {
      if (!file) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      setRefFileBusy(true)
      try {
        const text = await extractTenderFileText(file)
        if (!text) {
          toast.error("没有从文件中提取到文字，扫描版文档请改用粘贴文本方式导入")
          return
        }
        if (kind === "template") {
          setRefTemplateDraft(text)
          toast.success(`已解析范本「${file.name}」，共 ${Math.min(text.length, REF_TEXT_LIMIT)} 字，大纲生成时将参考其目录结构`)
        } else {
          setRefMaterialsDraft(text)
          toast.success(`已解析写作资料「${file.name}」，共 ${Math.min(text.length, REF_TEXT_LIMIT)} 字，正文生成时将按需引用`)
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "文件解析失败，请改用粘贴文本方式导入")
      } finally {
        setRefFileBusy(false)
      }
    },
    [blockIfArchived, setRefTemplateDraft, setRefMaterialsDraft],
  )

  /** R167：素材库写入（五类标准件 + 自由资料）——渲染回 ref_materials_text 走同款防抖落盘，零 schema */
  const saveMaterialLibrary = useCallback(
    (sections: Partial<MaterialLibrary>) => {
      if (blockIfArchived()) return false
      const cur = activeProjectRef.current
      if (!cur) {
        toast.error("请先打开一个投标项目")
        return false
      }
      const lib = parseMaterialLibrary(refMaterialsDraftRef.current)
      const next: MaterialLibrary = { ...lib, ...sections }
      setRefMaterialsDraft(renderMaterialLibrary(next))
      const filled = libraryFilledKinds(next).length
      toast.success(
        filled
          ? `素材库已保存：${filled}/5 类标准件有内容，编制正文时按章/节类别自动带上对应基线`
          : "素材库已清空（保留的自由资料仍按原方式按需引用）",
      )
      return true
    },
    [blockIfArchived, setRefMaterialsDraft],
  )

  /** R167：一键套用公司默认标准件（只填空类，已写内容不被覆盖） */
  const applyLibraryDefaults = useCallback(
    (kinds: MaterialKind[]) => {
      if (blockIfArchived()) return false
      if (!kinds.length) return false
      const lib = parseMaterialLibrary(refMaterialsDraftRef.current)
      const next: MaterialLibrary = { ...lib }
      for (const k of kinds) {
        if ((next[k] ?? "").trim()) continue
        next[k] = COMPANY_DEFAULTS[k]
      }
      setRefMaterialsDraft(renderMaterialLibrary(next))
      toast.success(`已套用公司默认标准件（${kinds.map((k) => MATERIAL_KIND_MAP[k].label).join("、")}），请按本院口径替换占位内容`)
      return true
    },
    [blockIfArchived, setRefMaterialsDraft],
  )

  /** R167：上传公司素材并自动归类（本地按块首行命中词分入五类，未命中留在自由资料区） */
  const importLibraryFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      if (blockIfArchived()) return
      setRefFileBusy(true)
      try {
        const text = await extractTenderFileText(file)
        if (!text) {
          toast.error("没有从文件中提取到文字，扫描版文档请改用粘贴文本方式导入")
          return
        }
        const lib = parseMaterialLibrary(refMaterialsDraftRef.current)
        lib.other = [lib.other, text].filter(Boolean).join("\n\n")
        const classified = autoClassifyLibrary(lib)
        setRefMaterialsDraft(renderMaterialLibrary(classified))
        toast.success(
          `已导入「${file.name}」并自动归类：素材库 ${libraryFilledKinds(classified).length}/5 类有内容，未命中内容保留在自由资料区`,
        )
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "文件解析失败，请改用粘贴文本方式导入")
      } finally {
        setRefFileBusy(false)
      }
    },
    [blockIfArchived, setRefMaterialsDraft],
  )

  /** R167：对现有自由资料做一键归类（不改字，只按块首行命中词搬运到对应类别） */
  const classifyLibraryDraft = useCallback(() => {
    if (blockIfArchived()) return false
    const lib = parseMaterialLibrary(refMaterialsDraftRef.current)
    const next = autoClassifyLibrary(lib)
    const before = libraryFilledKinds(lib).length
    const after = libraryFilledKinds(next).length
    setRefMaterialsDraft(renderMaterialLibrary(next))
    toast.success(
      after > before ? `已归类：新增命中 ${after - before} 类标准件（未命中内容留在自由资料区）` : "已归类：本次没有新的命中块，内容保持不变",
    )
    return true
  }, [blockIfArchived, setRefMaterialsDraft])

  // ------------------------------ ② AI 解析（配置弹窗 + sections 结构） ------------------------------
  const [parseLoading, setParseLoading] = useState(false)
  // 第八轮改造 1：分段解析进度（「正在解析第 x/y 段」）与失败段提示（项目流水线 / 快捷工具各自一份）
  const [parseChunkProgress, setParseChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [parseChunkWarnings, setParseChunkWarnings] = useState<string[]>([])
  const [toolParseWarnings, setToolParseWarnings] = useState<string[]>([])
  const [parseConfigOpen, setParseConfigOpen] = useState(false)
  const [parseConfigSource, setParseConfigSource] = useState<"project" | "tool">("project")
  const [cfgScope, setCfgScope] = useState<ParseScope>("key")
  const [cfgExtras, setCfgExtras] = useState<string[]>([])
  // 第十二轮改造 2：★/▲ 重点条款本地扫描开关（缺省开启，旧配置兼容）
  const [cfgStar, setCfgStar] = useState(true)
  // T14：解析素材通道（whole 整文直读 / retrieval 关键词检索），缺省 whole
  const [cfgChannel, setCfgChannel] = useState<ParseChannel>("whole")
  const [toolParseConfig, setToolParseConfig] = useState<ParseConfig>(() => defaultParseConfig())

  const parseConfigTotal = parseConfigCount({ scope: cfgScope, extra_keys: cfgExtras })

  const openParseConfig = useCallback(
    (source: "project" | "tool") => {
      if (!requireLogin()) return
      if (source === "project") {
        const cur = activeProjectRef.current
        if (!cur) return
        const text = (tenderDraftRef.current || cur.tender_text || "").trim()
        if (!text) {
          toast.error("请先在上一步导入招标文件内容")
          return
        }
        const saved = cur.parse_config ?? defaultParseConfig()
        setCfgScope(saved.scope)
        // 循环 2 批 2-3：旧 key 配置回显前经别名归一（key_nodes→bid_nodes 等），弹窗勾选态与新清单一致
        setCfgExtras(normalizeExtraKeys(saved.extra_keys))
        setCfgStar(starClausesEnabled(saved))
        setCfgChannel(parseChannelOf(saved))
      } else {
        if (!toolMaterialRef.current.trim()) {
          toast.error("请先上传或粘贴招标文件文本")
          return
        }
        setCfgScope(toolParseConfig.scope)
        setCfgExtras(normalizeExtraKeys(toolParseConfig.extra_keys))
        setCfgStar(starClausesEnabled(toolParseConfig))
        setCfgChannel(parseChannelOf(toolParseConfig))
      }
      setParseConfigSource(source)
      setParseConfigOpen(true)
    },
    [requireLogin, toolParseConfig],
  )

  const closeParseConfig = useCallback(() => setParseConfigOpen(false), [])

  const setParseConfigScope = useCallback((scope: ParseScope) => setCfgScope(scope), [])

  const toggleParseExtra = useCallback((key: string) => {
    setCfgExtras((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }, [])

  /** 第十二轮改造 1：其他项组级全选 / 全清（三态全选框点击） */
  const setAllParseExtras = useCallback((on: boolean) => {
    setCfgExtras(on ? PARSE_EXTRA_SECTIONS.map((d) => d.key) : [])
  }, [])

  /** 第十二轮改造 2：重点条款本地扫描开关（key/full 两档均可勾） */
  const setParseConfigStar = useCallback((on: boolean) => setCfgStar(on), [])

  /** T14：解析素材通道切换（整文直读 / 关键词检索） */
  const setParseConfigChannel = useCallback((channel: ParseChannel) => setCfgChannel(channel), [])

  // 循环 2 批 2-2：空项自动重跑的取消感知序号——新一轮解析、切换/退出项目或组件卸载都会让旧重跑循环失效
  const parseRunSeqRef = useRef(0)
  useEffect(() => {
    return () => {
      parseRunSeqRef.current += 1
    }
  }, [])

  const runParseWith = useCallback(
    async (cfg: ParseConfig, source: "project" | "tool", text: string) => {
      setParseLoading(true)
      parseRunSeqRef.current += 1
      const mySeq = parseRunSeqRef.current
      const startProjectId = activeProjectRef.current?.id ?? null
      if (source === "project") setParseChunkWarnings([])
      else setToolParseWarnings([])
      // 第十二轮改造 2：★/▲ 重点条款本地扫描（零 AI 费用）；未勾选则不扫描、保留旧节不动
      const starOn = starClausesEnabled(cfg)
      // Q27/切片B：文本签名（长度+首中尾采样）——重解析判断包结构是否可能已变，决定 lots_scope 去留
      const tenderTextSig = text.length + ":" + text.slice(0, 32) + ":" + text.slice(-32)
      const starLines = starOn && text.trim() ? extractStarClauses(text) : []
      // R74/C-lot-splitting：标包划分本地扫描（零 AI 费用，随 ★ 勾选一并执行）；无划分则不落分区
      const lotsLines = starOn && text.trim() ? extractLotsFromText(text) : []
      // Q26/切片B：采购需求结构本地扫描（零 AI 费用，随 ★ 勾选一并执行）；无子系统清单则不落分区
      const reqStructLines = starOn && text.trim() ? extractRequirementStructureFromText(text) : []
      const prevReport = source === "project" ? activeProjectRef.current?.parse_report ?? null : null
      const mergeStar = (base: ParseReport, prev: ParseReport | null): ParseReport => {
        const fresh = starOn ? starClauseSectionFrom(starLines) : null
        const carried = prev?.sections.find((s) => s.key === "star_clauses" && s.content.trim()) ?? null
        const next = fresh ?? carried
        const withStar = next ? upsertParseSection(base, next) : base
        let withLocal = withStar
        // R74/C-lot-splitting：标包分区同样本地产出；AI 解析若已产出 lots 区则 AI 结果优先（base 已含）
        if (starOn && lotsLines.length && !withLocal.sections.find((s) => s.key === "lots" && s.content.trim())) {
          const lotsSection = lotsSectionFrom(lotsLines)
          if (lotsSection) withLocal = upsertParseSection(withLocal, lotsSection)
        }
        // Q26/切片B：采购需求结构分区本地扫描（列子系统清单，缓解 60+ 系统揉进单个 delivery_req）；AI 已产出则不覆盖
        if (starOn && reqStructLines.length && !withLocal.sections.find((s) => s.key === "req_structure" && s.content.trim())) {
          const reqSection = reqStructureSectionFrom(reqStructLines)
          if (reqSection) withLocal = upsertParseSection(withLocal, reqSection)
        }
        // Q27/切片B：同文重解析保留所投包件选择；文本变化（签名不同）清空，待用户重新选择
        const keptScope = mergeLotsScopeOnReparse(prev?.lots_scope, prev?.tender_text_sig, tenderTextSig)
        return keptScope ? { ...withLocal, lots_scope: keptScope } : withLocal
      }
      try {
        // T12 检索通道：逐项独立提示词 + 并发池（3 路）+ 限流熔断 + 单项降级；
        // T14 整文通道：同一编排骨架，素材改为「整文直读（≤上限）/ 切段合并（超限）」，
        //   并在首项后加提示词缓存预热等待；通道由 parseChannelOf(cfg) 决定。
        const keys = requestedKeys(cfg)
        const channel = parseChannelOf(cfg)
        const slots: (ParseSection | undefined)[] = new Array(keys.length).fill(undefined)
        const stopRef = { reason: "" }
        const degradedTitles: string[] = []
        const failedTitles: string[] = []
        const scoringSelfCheck: string[] = []
        let cursor = 0
        let completed = 0
        // Q27/切片C：逐项 checkpoint 本地累加报告（同步读改写、无 await 竞态；每写含历史已落项，PATCH 值单调增长）
        let ckptReport: ParseReport | null = null
        const parseKeyIndex = async (i: number): Promise<void> => {
          if (parseRunSeqRef.current !== mySeq) return
          if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) return
          const key = keys[i]
          const title = parseSectionTitle(key)
          // 限流熔断：检测到服务商限流后停止后续项、置空占位（不再撞墙重复请求）
          if (stopRef.reason) {
            slots[i] = { key, title, content: "" }
            failedTitles.push(title)
            completed += 1
            setParseChunkProgress({ current: completed, total: keys.length })
            return
          }
          try {
            const parsed = await parseSectionItem(text, key, channel)
            slots[i] = { key, title, content: parsed.text, ...(parsed.structured ? { structured: parsed.structured } : {}) }
            if (parsed.structured) {
              const scw = selfCheckScoringTotal(parsed.structured)
              if (scw) scoringSelfCheck.push(`${title}：${scw}`)
            }
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            let msg = e instanceof Error ? e.message : String(e)
            // T12b：单次 429 先退避 20s 重试一次（网关 TPM 窗口随时间恢复，直接熔断会让大批项置空）；
            // 重试后仍失败才置熔断停止剩余项
            if (isRateLimitError(msg)) {
              await new Promise((r) => setTimeout(r, 20000))
              if (parseRunSeqRef.current !== mySeq) return
              if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) return
              try {
                const retried = await parseSectionItem(text, key, channel)
                slots[i] = { key, title, content: retried.text, ...(retried.structured ? { structured: retried.structured } : {}) }
                if (retried.structured) {
                  const scw = selfCheckScoringTotal(retried.structured)
                  if (scw) scoringSelfCheck.push(`${title}：${scw}`)
                }
                msg = ""
              } catch (e2) {
                if (e2 instanceof AuthRequiredError) throw e2
                msg = e2 instanceof Error ? e2.message : String(e2)
              }
            }
            if (msg) {
              if (isRateLimitError(msg)) stopRef.reason = msg
              // 单项失败不留空白：写入本项关键词检索出的原文片段作降级交付（易标「兜底不破坏结果可用性」口径）
              const degraded = buildDegradedSectionContent(key, selectRelevantChunks(text, key), msg)
              slots[i] = { key, title, content: degraded }
              if (degraded) degradedTitles.push(title)
              else failedTitles.push(title)
            }
          } finally {
            // Q27/切片C：单项真成功后即增量落库（仅 source=project、未被新一轮/切项目打断时）；
            // 中断后刷新页面已完成项仍在库，「逐项重新解析」入口天然可用；尾部最终写为超集覆盖
            if (
              source === "project" &&
              parseRunSeqRef.current === mySeq &&
              (activeProjectRef.current?.id ?? null) === startProjectId
            ) {
              const slot = slots[i]
              if (slot && sectionCheckpointable(slot.content)) {
                ckptReport = upsertParseSection(ckptReport ?? { scope: cfg.scope, sections: [] }, slot)
                updateProject({ parse_report: ckptReport })
              }
            }
            completed += 1
            setParseChunkProgress({ current: completed, total: keys.length })
          }
        }
        const parseOneSlot = async (): Promise<void> => {
          for (;;) {
            if (parseRunSeqRef.current !== mySeq) return
            if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) return
            const i = cursor
            cursor += 1
            if (i >= keys.length) return
            await parseKeyIndex(i)
          }
        }
        // T14 缓存预热：整文通道先串行跑首项（requestedKeys 恒以 overview 打头）建立共享前缀缓存，
        // 首项真成功（非降级/非失败）时等 5s 供提供商登记缓存，再并发剩余项（易标 runBidAnalysisTask 同款编排）；
        // 首项失败不熔断整体（已按单项降级处理），剩余项照常并发
        if (channel === "whole" && keys.length > 1) {
          await parseKeyIndex(0)
          cursor = 1
          const firstOk = !!slots[0]?.content.trim() && sectionCheckpointable(slots[0]!.content)
          const notInterrupted =
            parseRunSeqRef.current === mySeq &&
            (source !== "project" || (activeProjectRef.current?.id ?? null) === startProjectId)
          if (firstOk && notInterrupted && keys.length > 2) {
            await new Promise((r) => setTimeout(r, PARSE_WARMUP_DELAY_MS))
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(3, Math.max(0, keys.length - cursor)) }, () => parseOneSlot()),
        )
        // 被新一轮解析/切项目打断：不保存半成品，直接退出（finally 复位进度）
        if (parseRunSeqRef.current !== mySeq) return
        if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) return
        const sections = slots.filter((s): s is ParseSection => s !== undefined)
        // T13（2026-09-28 用户反馈轮「解析内容重复」）：逐项解析路径此前从未过跨项去重——
        // sanitizeParseSections/mergeChunkReports（旧链路）都调 dedupeAcrossSections，本路径落库前补上同款
        const report: ParseReport = dedupeAcrossSections({ scope: cfg.scope, sections })
        const okCount = report.sections.filter((s) => s.content.trim() && !isMissingSectionResult(s.content)).length
        if (!okCount) {
          throw new Error("没有从招标文件中提取到有效要点，请确认文本完整后重试")
        }
        // R-030（R256）：必选项解析失败清单（缺席/空/降级/failed；「原文未提及」属正常不计），并入既有 warnings 持久化 + 报告红幅
        const requiredFail = requiredParseFailures(report.sections)
        const requiredWarn = requiredFail.length
          ? [`必选项未解析成功：${requiredFail.map((f) => f.title).join("、")}，请在报告中逐项重新解析补齐`]
          : []
        // R-026③（R257）：废标条款条数下限自检——抽到但少于下限（疑漏解析/假阴）则并入 warnings 持久提示（0 条不误报）
        const voidFloorMsg = voidClauseFloorWarning(sectionText(report, "void_items"))
        const voidFloorWarn = voidFloorMsg ? [voidFloorMsg] : []
        const warnings = [
          ...(degradedTitles.length
            ? [`${degradedTitles.length} 项 AI 解析未完成，已降级为关键词检索原文（${degradedTitles.slice(0, 3).join("、")}${degradedTitles.length > 3 ? " 等" : ""}），请人工核对，模型恢复后可逐项重新解析`]
            : []),
          ...(failedTitles.length
            ? [`${failedTitles.length} 项解析失败${stopRef.reason ? "（检测到服务商限流，已停止后续项）" : ""}，可在报告中对单项重新解析`]
            : []),
          ...scoringSelfCheck,
          ...requiredWarn,
          ...voidFloorWarn,
        ]
        if (source === "project") {
          setParseChunkWarnings(warnings)
          // 循环 8 A5：失败段 warnings 并入 finalReport 随既有 PATCH 落库（零新请求），刷新后横幅可恢复；
          // 无失败段不写 warnings 键（防正常解析键膨胀）
          const mergedReport = mergeStar(report, prevReport)
          // R-029（R255）：持久化招标文件解析质量分级（文本口径；扫描件多已在导入时阻断），供刷新后横幅恢复
          const pq = assessTenderParseQuality(text).level
          const finalReport: ParseReport = {
            ...mergedReport,
            ...(warnings.length ? { warnings: warnings.map((w) => w.slice(0, 100)).slice(0, 20) } : {}),
            tender_text_sig: tenderTextSig,
            ...(reportNeedsReparse(mergedReport.sections) ? { needs_reparse: true } : {}),
            ...(pq !== "ok" ? { parse_quality: pq } : {}),
          }
          // R45/F5（体验审计）：解析完成后自动回填空白的立项基础信息——仅当现值为空且解析正文有精确标签命中才写，
          // 绝不覆盖用户已填值；保守口径见 parseBackfillFields 注释（无命中留空、占位「某编号」不取）
          const curProject = activeProjectRef.current
          const backfill: Partial<BidProjectRecord> = {}
          let backfillToast = ""
          if (curProject) {
            const bf = parseBackfillFields(finalReport)
            const filled: string[] = []
            if (!curProject.hospital?.trim() && bf.hospital) { backfill.hospital = bf.hospital; filled.push("采购人") }
            if (!curProject.tender_no?.trim() && bf.tender_no) { backfill.tender_no = bf.tender_no; filled.push("项目编号") }
            if (!curProject.bid_open_date?.trim() && bf.bid_open_date) { backfill.bid_open_date = bf.bid_open_date; filled.push("开标日期") }
            if (filled.length) backfillToast = `，已自动回填${filled.join("、")}`
          }
          updateProject({ tender_text: text, parse_report: finalReport, parse_config: cfg, ...backfill })
          writeStageSnapshot("parse", "招标文件解析完成", { parse_report: finalReport })
          setActiveStep(2)
          toast.success(
            `解析完成：${okCount} 项成功${report.sections.length - okCount ? `，${report.sections.length - okCount} 项未解析可在报告中单独重解析` : ""}${starLines.length ? `，另本地扫描出 ★/▲ 重点条款 ${starClauseCount(starLines)} 条（零费用）` : ""}${backfillToast}，请人工核对`,
          )
          // R159：解析完成同步提示素材符号丢失签名（只提示不拦截，零新调用）
          const markerLoss = detectMarkerSymbolLoss(text)
          if (markerLoss.hits) toast.warning(markerLossNotice(markerLoss))
        } else {
          setToolParseWarnings(warnings)
          setToolParseConfig(cfg)
          setToolParseResult((prev) => mergeStar(report, prev))
        }
        if (warnings.length) {
          toast.warning(warnings[0])
        }
        // 循环 2 批 2-2：解析空项自动重跑——merge 完成后，对 requestedKeys 中 content 为空的项
        // 按既有单项重解析调用形态逐个重跑一次（串行、cancel 感知：新一轮解析/切项目/卸载即停）；
        // 结果非空则 upsert 覆盖，仍空保持空不报错；费用含在本次解析确认内，不另弹确认
        const emptyKeys = report.sections.filter((s) => isMissingSectionResult(s.content)).map((s) => s.key)
        // recovered 提升到块外：同义词回补块（下方）需要读本值——此前声明在 if 块内、块外引用是
        // 运行时 ReferenceError（每次成功解析收尾必触发），tsc 一直报错但 vite dev 不查型，顺手修正
        let recovered = 0
        if (emptyKeys.length && !stopRef.reason) {
          for (const key of emptyKeys) {
            if (parseRunSeqRef.current !== mySeq) break
            if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) break
            try {
              const parsed = await parseSectionItem(text, key, channel)
              if (!parsed.text.trim() || isMissingSectionResult(parsed.text)) continue
              const next: ParseSection = { key, title: parseSectionTitle(key), content: parsed.text, status: "ok", snippet: makeSnippet(parsed.text), human_edited: false, ...(parsed.structured ? { structured: parsed.structured } : {}) }
              recovered += 1
              if (source === "project") {
                const curNow = activeProjectRef.current
                if (curNow?.parse_report) updateProject({ parse_report: upsertParseSection(curNow.parse_report, next) })
              } else {
                setToolParseResult((prev) => (prev ? upsertParseSection(prev, next) : { scope: "full", sections: [next] }))
              }
            } catch (e) {
              if (e instanceof AuthRequiredError) throw e
              // 重跑仍空 / 失败：保持空项不报错，可在报告中手动「重新解析此项」
            }
          }
          if (parseRunSeqRef.current === mySeq) {
            toast.info(
              `${emptyKeys.length} 个空/未提及项自动重跑，补回 ${recovered} 个${
                recovered < emptyKeys.length ? `，其余 ${emptyKeys.length - recovered} 个仍为空，可在报告中「重新解析此项」` : ""
              }`,
            )
          }
        }
        // Q28 切片C：同义词回补——对 tech_score/biz_score/void_items 仍为空的分区换扩展关键词再跑一轮。
        // T14：仅检索通道有意义（同义词作用于关键词选块）；整文通道素材已是全文/全段，空项重跑（上方）即为补救
        if (channel === "retrieval" && !stopRef.reason && parseRunSeqRef.current === mySeq && recovered < emptyKeys.length) {
          const stillEmptyKeys = emptyKeys.filter((k) => SECTION_SYNONYM_FALLBACK[k]?.length)
          // Only try synonym pass for keys that have fallback definitions AND were among the still-failing set
          if (stillEmptyKeys.length) {
            let recovered2 = 0
            for (const key of stillEmptyKeys) {
              if (parseRunSeqRef.current !== mySeq) break
              if (source === "project" && (activeProjectRef.current?.id ?? null) !== startProjectId) break
              try {
                const extraKeywords = SECTION_SYNONYM_FALLBACK[key] ?? []
                const synth = selectRelevantChunksWithSynonyms(text, key, extraKeywords)
                const raw = await llmGenerate(buildSectionParseMessages(key, synth.text, { sourceMode: synth.mode }), MAX_TOKENS_LONGFORM, "bid-parse", 0, { disableThinking: true })
                const content = normalizeSectionRawText(key, raw)
                if (!content.trim() || isMissingSectionResult(content)) continue
                const next2: ParseSection = { key, title: parseSectionTitle(key), content, status: "ok", snippet: makeSnippet(content), human_edited: false }
                recovered2 += 1
                if (source === "project") {
                  const curNow = activeProjectRef.current
                  if (curNow?.parse_report) updateProject({ parse_report: upsertParseSection(curNow.parse_report, next2) })
                } else {
                  setToolParseResult((prev) => (prev ? upsertParseSection(prev, next2) : { scope: "full", sections: [next2] }))
                }
              } catch (e) {
                if (e instanceof AuthRequiredError) throw e
              }
            }
            if (recovered2 > 0 && parseRunSeqRef.current === mySeq) {
              toast.info(`已尝试同义词回补 ${stillEmptyKeys.length} 个分区，成功补回 ${recovered2} 个`)
            }
          }
        }
      } catch (e) {
        handleLlmError(e, "解析失败，请重试")
      } finally {
        setParseChunkProgress(null)
        setParseLoading(false)
      }
    },
    [handleLlmError, updateProject, writeStageSnapshot],
  )

  /** 点「AI 解析」先弹配置弹窗（回显项目已保存的配置） */
  const startParse = useCallback(() => {
    openParseConfig("project")
  }, [openParseConfig])

  const saveParseConfig = useCallback(() => {
    const cfg: ParseConfig = { scope: cfgScope, extra_keys: cfgExtras, star_clauses: cfgStar, channel: cfgChannel }
    if (parseConfigSource === "project") {
      const cur = activeProjectRef.current
      if (!cur) return
      updateProject({ parse_config: cfg })
      toast.success("解析配置已保存到项目，下次解析直接复用")
    } else {
      setToolParseConfig(cfg)
      toast.success("解析配置已保存，本次快捷工具解析将复用")
    }
    setParseConfigOpen(false)
  }, [cfgChannel, cfgExtras, cfgScope, cfgStar, parseConfigSource, updateProject])

  const confirmStartParse = useCallback(() => {
    const cfg: ParseConfig = { scope: cfgScope, extra_keys: cfgExtras, star_clauses: cfgStar, channel: cfgChannel }
    const source = parseConfigSource
    const text =
      source === "project"
        ? (tenderDraftRef.current || activeProjectRef.current?.tender_text || "").trim()
        : toolMaterialRef.current.trim()
    if (!text) {
      toast.error(source === "project" ? "请先在上一步导入招标文件内容" : "请先上传或粘贴招标文件文本")
      return
    }
    // 循环 5 A3：归档只读——项目内重新解析拦截（快捷工具解析不落项目，不拦）
    if (source === "project" && blockIfArchived()) return
    setParseConfigOpen(false)
    // T14：费用确认按通道分口径——整文直读共享前缀吃提示词缓存（首项全价、其余缓存价）；
    // 超上限自动切段合并；检索通道保持 T12 口径
    const channelDesc =
      parseChannelOf(cfg) === "whole"
        ? `系统把整篇招标文件作为共享上下文逐项解析，首项后其余项享提示词缓存价${
            text.length > WHOLE_FILE_LIMIT ? `；文件超长（${text.length} 字），将按段解析后合并` : ""
          }`
        : "系统按每项关键词检索相关章节片段后解析"
    costConfirm.runWithCostConfirm(() => {
      void runParseWith(cfg, source, text)
    }, `将按配置解析招标文件（共 ${parseConfigCount(cfg)} 项，${cfg.scope === "key" ? "只解析关键项" : "完整解析"}），${channelDesc}，费用按实际用量累加，解析后空/未提及项会自动重跑一次（费用含在本次确认内），${costText()}${skillCostSuffix("bid-parse")}`)
  }, [cfgChannel, cfgExtras, cfgScope, cfgStar, costConfirm, parseConfigSource, runParseWith])

  const updateParseReport = useCallback(
    (patch: Partial<ParseReport>) => {
      const cur = activeProjectRef.current
      if (!cur) return
      if (blockIfArchived(true)) return // 循环 5 A3：归档只读（silent，View 已禁用编辑控件）
      const base: ParseReport = cur.parse_report ?? { scope: "key", sections: [] }
      updateProject({ parse_report: { ...base, ...patch } })
    },
    [blockIfArchived, updateProject],
  )

  /** 第十二轮改造 2：解析报告右栏「重新扫描」——重跑 ★/▲ 重点条款本地扫描（零费用） */
  const rescanStarClauses = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读（本地扫描也会写解析报告）
    const text = (tenderDraftRef.current || cur.tender_text || "").trim()
    if (!text) {
      toast.error("请先在上一步导入招标文件内容")
      return
    }
    const lines = extractStarClauses(text)
    const sec = starClauseSectionFrom(lines)
    // R159：扫描前先报符号丢失签名：源文本缺标注符号时扫出的★/▲ 条款可能天然不全
    const scanLoss = detectMarkerSymbolLoss(text)
    if (scanLoss.hits) toast.warning(markerLossNotice(scanLoss))
    if (!sec) {
      toast.info("未在招标文件中发现 ★/▲ 标记条款")
      return
    }
    const base: ParseReport = cur.parse_report ?? { scope: "key", sections: [] }
    updateProject({ parse_report: upsertParseSection(base, sec) })
    toast.success(`重新扫描完成：共 ${starClauseCount(lines)} 条 ★/▲ 重点条款（本地扫描，零费用）`)
  }, [blockIfArchived, updateProject])

  // ------------------------------ ② 单项重解析（主详情右栏「重新解析此项」） ------------------------------
  const [reparseBusyKey, setReparseBusyKey] = useState<string | null>(null)

  const runReparseSection = useCallback(
    async (key: string, source: "project" | "tool", text: string) => {
      setReparseBusyKey(key)
      try {
        // T12：与批量解析同口径——本项关键词检索选块 + 纯文本直出；T14：按项目/快捷工具配置的通道路由
        // （whole 整文直读 / 超限切段合并，retrieval 检索选块），与批量解析的素材口径保持一致
        const channel =
          source === "project"
            ? parseChannelOf(activeProjectRef.current?.parse_config)
            : parseChannelOf(toolParseConfig)
        const parsed = await parseSectionItem(text, key, channel)
        const freshContent = parsed.text
        if (!freshContent.trim()) {
          throw new Error(`「${parseSectionTitle(key)}」没有解析到有效内容，请确认招标文件包含相关描述后重试`)
        }
        const fresh: ParseSection = { key, title: parseSectionTitle(key), content: freshContent, ...(parsed.structured ? { structured: parsed.structured } : {}) }
        const next: ParseSection = { ...fresh, status: "ok", snippet: makeSnippet(freshContent), human_edited: false }
        if (source === "project") {
          const cur = activeProjectRef.current
          if (!cur) return
          const base: ParseReport = cur.parse_report ?? { scope: "key", sections: [] }
          // 循环 8 A5：单项重解析成功即清除落库的失败横幅 warnings（第一版简化：任一项成功清全部）并同步清内存横幅
          updateProject({ parse_report: clearParseWarnings(upsertParseSection(base, next)) })
          setParseChunkWarnings([])
        } else {
          setToolParseResult((prev) => (prev ? upsertParseSection(prev, next) : { scope: "full", sections: [next] }))
          setToolParseWarnings([])
        }
        toast.success(`「${parseSectionTitle(key)}」重新解析完成`)
      } catch (e) {
        // 失败保留旧内容，仅置失败态
        if (source === "project") {
          const cur = activeProjectRef.current
          if (cur?.parse_report) updateProject({ parse_report: markParseSectionStatus(cur.parse_report, key, "failed") })
        } else {
          setToolParseResult((prev) => (prev ? markParseSectionStatus(prev, key, "failed") : prev))
        }
        handleLlmError(e, "重新解析失败，请重试")
      } finally {
        setReparseBusyKey(null)
      }
    },
    [handleLlmError, toolParseConfig, updateProject],
  )

  const reparseSection = useCallback(
    (key: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      const cur = activeProjectRef.current
      const text = (cur?.tender_text || tenderDraftRef.current || "").trim()
      if (!text) {
        toast.error("缺少招标文件内容，请先在「招标文件」环节导入")
        return
      }
      costConfirm.runWithCostConfirm(() => {
        void runReparseSection(key, "project", text)
      }, `将只重解析「${parseSectionTitle(key)}」一项${reparseCostDesc(text, cur?.parse_config)}，${costText()}${skillCostSuffix("bid-parse")}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runReparseSection],
  )

  const reparseToolSection = useCallback(
    (key: string) => {
      if (!requireLogin()) return
      const text = toolMaterialRef.current.trim()
      if (!text) {
        toast.error("缺少招标文件文本，请先上传或粘贴")
        return
      }
      costConfirm.runWithCostConfirm(() => {
        void runReparseSection(key, "tool", text)
      }, `将只重解析「${parseSectionTitle(key)}」一项${reparseCostDesc(text, toolParseConfig)}，${costText()}${skillCostSuffix("bid-parse")}`)
    },
    [costConfirm, requireLogin, runReparseSection, toolParseConfig],
  )

  // ------------------------------ ③ 投标文件编制 ------------------------------
  const [outlineDraft, setOutlineDraft] = useState<OutlineNode[]>([])
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importCandidates, setImportCandidates] = useState<SolutionRecord[]>([])
  const [importLoading, setImportLoading] = useState(false)
  // 目录级数 / 目标页数 / 配图开关 / 偏离表维度 / 每小节字数：第五轮改造 1 已改为持久化派生值（见上方设置区）

  // ------------------------------ 招标要求条款与大纲覆盖（本地抽取 + 本地核验，零 AI 调用） ------------------------------
  const outlineClauses = useMemo(
    () => extractRequirementClauses(activeProject?.parse_report ?? null, { limit: 60, granularity: "l3" }),
    [activeProject?.parse_report],
  )
  // AI 大纲输出的 coverage 映射（clause_id → 叶子节点标题），用于条款归章
  const [outlineCoverage, setOutlineCoverage] = useState<OutlineCoverageItem[]>([])
  // R-021 本次大纲自动修正留痕（残句归并 / 冗余兄弟章合并），供页面「原→新」对照
  const [outlineResidueFixes, setOutlineResidueFixes] = useState<ResidueFix[]>([])
  // R-020 被误标商务、但按评分办法判定为必写的技术章节（供页面纠偏提示）
  const [mustWriteRescued, setMustWriteRescued] = useState<{ title: string; reason: string }[]>([])
  // R-023 招标目录三态差异（matched/missing/extra）
  const [catalogDiff, setCatalogDiff] = useState<CatalogDiff | null>(null)

  // 覆盖核验对象：优先当前编辑中的大纲草稿，其次项目已确认大纲
  const coverageNodes = useMemo(
    () => (outlineDraft.length ? outlineDraft : activeProject?.bid_outline ?? []),
    [outlineDraft, activeProject],
  )
  const uncoveredClauses = useMemo(() => {
    if (!coverageNodes.length || !outlineClauses.length) return [] as RequirementClause[]
    // 第十三轮改造 2：条款覆盖只按技术章叶子核验（商务骨架章不背条款覆盖）
    const leaves = collectLeafTitles(techOutlineNodes(coverageNodes))
    return outlineClauses.filter((cl) => !leaves.some((t) => clauseMatchesTitle(cl.text, t)))
  }, [coverageNodes, outlineClauses])
  const coveredClauseCount = outlineClauses.length - uncoveredClauses.length

  // R-025 评分覆盖体检：技术评分项按分值统计落点/未落点（复用 R31 覆盖矩阵，零 AI）
  const scoreCheckup = useMemo(
    () => buildScoreCheckup(coverageNodes, activeProject?.parse_report ?? null),
    [coverageNodes, activeProject?.parse_report],
  )

  /** 把未响应条款补入大纲：按标题相似度挂到最相关章节下，无匹配新建章节；已确认章节时同步小节清单 */
  const addClausesToOutline = useCallback(
    (clauseIds: string[]) => {
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      const wanted = outlineClauses.filter((c) => clauseIds.includes(c.id))
      if (!wanted.length) return
      const base = outlineDraft.length ? outlineDraft : activeProject?.bid_outline ?? []
      if (!base.length) {
        toast.error("大纲为空，请先生成大纲再补入条款")
        return
      }
      let next = base
      for (const cl of wanted) next = insertClauseIntoOutline(next, cl)
      setOutlineDraft(next)
      const cur = activeProjectRef.current
      const patch: Partial<BidProjectRecord> = { bid_outline: next }
      if (cur?.bid_chapters.length) {
        patch.bid_chapters = cur.bid_chapters.map((c) => {
          const node = next.find((n) => n.id === c.node_id)
          return node ? { ...c, sections: (node.children ?? []).map((k) => k.title) } : c
        })
      }
      updateProject(patch)
      toast.success(
        wanted.length > 1
          ? `已把 ${wanted.length} 条未响应条款补入大纲，重新生成对应章节正文即可落实响应`
          : "已补入大纲，重新生成对应章节正文即可落实响应",
      )
    },
    [activeProject?.bid_outline, blockIfArchived, outlineClauses, outlineDraft, updateProject],
  )

  const addClauseToOutline = useCallback((clauseId: string) => addClausesToOutline([clauseId]), [addClausesToOutline])
  const addAllClausesToOutline = useCallback(
    () => addClausesToOutline(uncoveredClauses.map((c) => c.id)),
    [addClausesToOutline, uncoveredClauses],
  )

  /** R-025 一键补入：把未落点评分项追加为技术章节（同名跳过），重新生成正文即可拿分 */
  const addUncoveredScoringToOutline = useCallback(() => {
    if (blockIfArchived()) return
    const base = outlineDraft.length ? outlineDraft : activeProject?.bid_outline ?? []
    if (!base.length) {
      toast.error("大纲为空，请先生成大纲再补入评分项")
      return
    }
    const missing = scoreCheckup.missingRows
    if (!missing.length) {
      toast.success("评分项已全部有落点，无需补入")
      return
    }
    const existing = new Set(base.map((n) => n.title))
    const toAdd = missing.filter((m) => !existing.has(m.name.trim()))
    if (!toAdd.length) {
      toast.info("未落点评分项已有同名章节，请检查对应正文是否已编写")
      return
    }
    const add: OutlineNode[] = toAdd.map((m) => ({
      id: makeUid(),
      title: m.name.trim(),
      children: [],
      part: "tech" as const,
      description: `响应评分项 ${m.id}（${m.score} 分）`,
    }))
    const next = [...base, ...add]
    setOutlineDraft(next)
    updateProject({ bid_outline: next })
    const gained = Math.round(toAdd.reduce((a, m) => a + m.score, 0) * 10) / 10
    toast.success(`已把 ${add.length} 个未落点评分项补为技术章节（涉及 ${gained} 分），重新生成对应章节正文即可拿分`)
  }, [activeProject?.bid_outline, blockIfArchived, outlineDraft, scoreCheckup, updateProject])

  /** R-023 补入招标目录中缺失的条目为顶层章 */
  const addMissingCatalogToOutline = useCallback(() => {
    if (blockIfArchived()) return
    const base = outlineDraft.length ? outlineDraft : activeProject?.bid_outline ?? []
    if (!base.length) { toast.error('大纲为空，请先生成大纲再补入'); return }
    const missing = catalogDiff?.entries.filter((e) => e.status === 'missing') ?? []
    if (!missing.length) { toast.success('招标目录条目已全部覆盖，无需补入'); return }
    const existing = new Set(base.map((n) => n.title))
    const toAdd = missing.filter((m) => !existing.has(m.name.trim()))
    if (!toAdd.length) { toast.info('缺失条目已有同名章节'); return }
    const add: OutlineNode[] = toAdd.map((m) => ({ id: makeUid(), title: m.name.trim(), children: [], origin: 'tender' as const }))
    const next = [...base, ...add]
    setOutlineDraft(next)
    updateProject({ bid_outline: next })
    toast.success(`已补入 ${add.length} 个招标目录缺失条目为顶层章，请重新生成对应正文`)
  }, [activeProject?.bid_outline, blockIfArchived, catalogDiff, outlineDraft, updateProject])

  // 留空时的体量估算页数（仅作设置条参考小字与预算折算兜底，不再静默顶替用户已保存的页数）
  const estimatedPages = useMemo(
    () => estimatePagesFromText(activeProject?.tender_text || tenderDraft),
    [activeProject, tenderDraft],
  )

  // 第五轮改造 2：由页数与每小节字数反推的大纲目标叶子数
  const leafTarget = useMemo(
    () => leafTargetFromPages(targetPages ?? estimatedPages, sectionWords),
    [targetPages, estimatedPages, sectionWords],
  )

  const runGenerateOutline = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.parse_report) {
      toast.error("请先完成招标文件 AI 解析，再按评分办法生成大纲")
      return
    }
    if (!hasAnySection(cur.parse_report, OUTLINE_DEPEND_KEYS)) {
      toast.error(
        `大纲生成依赖「${missingSectionTitles(cur.parse_report, OUTLINE_DEPEND_KEYS).join(" / ")}」解析项，请先回到解析环节勾选并解析`,
      )
      return
    }
    // R-038（R258）解析覆盖率可见性 + R288+ 阻断判据切换。
    // R288+（2026-10-13 真实场景实测）：**阻断判据由「覆盖率」改为「关键项是否解析成功」**——
    // 覆盖率口径 = 解析产出字数 / 原文非空白字数，而产出是要点摘要（非全文），长文档天然偏低
    // （实测 38.2 万字真实标书 → 8%；R258 注释亦记 41.7 万字 → 4.4%）。原「<30% 一律阻断」
    // 使**所有大标书都无法生成**；而实测真正的病灶是「响应文件要求/投标文件目录要求解析为空」，
    // 二者恰是大纲硬依赖（OUTLINE_DEPEND_KEYS）。故此处：关键项缺失 → 阻断（真漏内容风险）；
    // 覆盖率偏低 → 仅告警（保留可见性与人工核对提示）。
    {
      const covRatio = parseCoverageRatio(cur.parse_report.sections, cur.tender_text)
      const covLvl = coverageLevel(covRatio, cur.tender_text)
      const covPct = coveragePercent(covRatio)
      const criticalMissing = missingCriticalSections(cur.parse_report.sections)
      if (criticalMissing.length) {
        toast.error(
          `关键解析项缺失：${missingSectionTitles(cur.parse_report, criticalMissing).join(" / ")}（驱动大纲编排、评分响应与废标规避），请回「AI 解析报告」逐项补齐后再生成大纲`,
        )
        return
      }
      if (covLvl !== "ok" && covPct != null) {
        toast.info(
          `解析覆盖率 ${covPct}%（长文档要点式解析的常态区间；关键项均已解析成功）：已放行生成，建议对照招标原件抽查废标与评分条款是否完整`,
        )
      }
    }
    // R207 切片 2（R-003）：无底稿兜底——缺「响应文件组成」时诚实告警但不阻断（可继续按评分办法+常规骨架兜底编排）
    if (!hasBidComposition(cur.parse_report)) {
      toast.info("未解析到「响应文件要求」的响应文件组成，大纲将按评分办法与常规骨架兜底编排；建议回到第 2 步补勾并解析该项以严格对齐招标组成要求")
    }
    setOutlineLoading(true)
    try {
      // 改造 3：注入本地抽取的招标要求条款清单，要求每条条款落到叶子节点并输出 coverage 映射
      const clauses = extractRequirementClauses(cur.parse_report, { limit: 60, granularity: "l3" })
      // 第五轮改造 2：叶子规模由页数与每小节字数反推；改造 4：注入全局事实表
      // 第十一轮改造 2：页数改用有效目标（受招标页数上限硬封顶）
      const pages = effectiveTargetPages(cur)
      const leafGoal = leafTargetFromPages(pages, sectionWords)
      const globalFacts = effectiveGlobalFacts(cur)
      const implicit = extractImplicitConstraints(cur.tender_text)
      // R206 切片 1（R-002）：内容范围三模式；用户反馈轮项 3 的 includeBiz 由 scope 派生（缺省存量零变化）
      const outlineScope = normalizeBidScope(cur.gen_options)
      const includeBiz = outlineScope !== "tech"
      // 第十六轮 B2 改造 2.3：长标书（目标叶子数 >40）自动分步——call1 只出顶层章，
      // 逐技术章 call2 展开节/条（注入其余章标题防重复 + 叶子配额=leafGoal/技术章数 ±2），
      // 程序拼装后走既有 trim/validate/fix 流程；≤40 走现状单次生成，行为不变。
      const staged = outlineScope !== "biz" && leafGoal > STAGED_OUTLINE_LEAF_GOAL
      const stagedFailed: string[] = []
      let raw = ""
      let parsed: OutlineNode[]
      if (staged) {
        const raw1 = await llmGenerate(
          buildOutlineLevel1Messages(cur.project_name, cur.hospital, cur.parse_report, {
            globalFacts,
            implicitConstraints: implicit,
            // 顶层技术章数提示：按每章将来承载约 8 个叶子折算，clamp 4-16
            techChapterHint: Math.round(leafGoal / 8),
            includeBiz,
            scope: outlineScope,
          }),
          MAX_TOKENS_OUTLINE,
          "bid-outline",
        )
        const topNodes = await withJsonRepair(raw1, (t) => normalizeOutline(parseOutlineJson(t)))
        if (!topNodes.length) throw new Error("大纲格式解析失败，请重试")
        const techTops = topNodes.filter((n) => !isBizPart(n))
        if (!techTops.length) throw new Error("分步大纲未产出技术章，请重试")
        const quota = Math.max(3, Math.round(leafGoal / techTops.length))
        toast.info(`长标书已启用分步大纲生成（${techTops.length} 章逐个展开，每章叶子配额约 ${quota} 个）`)
        for (const node of topNodes) {
          if (isBizPart(node)) continue
          // 一级目录：技术章本就不展开子节点，跳过 call2
          if (outlineLevel === 1) {
            node.children = []
            continue
          }
          try {
            const raw2 = await llmGenerate(
              buildOutlineChildrenMessages(
                node.title,
                techTops.filter((x) => x.id !== node.id).map((x) => x.title),
                cur.parse_report,
                { quota, level: outlineLevel, sectionWords, globalFacts },
              ),
              MAX_TOKENS_OUTLINE,
              "bid-outline",
            )
            let kids = await withJsonRepair(raw2, (t) => normalizeOutline(parseOutlineJson(t)))
            // 章内深度：指定级数时裁到 level-1 层；不指定时最多节+条两层（总深不超三级）
            kids = trimOutlineDepth(kids, outlineLevel > 1 ? outlineLevel - 1 : 2)
            node.children = kids
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            // 单章展开失败不拖垮整体：留空 children 交给既有结构修复或手动调整
            stagedFailed.push(node.title)
          }
        }
        parsed = topNodes
      } else {
        raw = await llmGenerate(
          buildBidOutlineMessages(cur.project_name, cur.hospital, cur.parse_report, outlineDraft.length > 0, outlineLevel, clauses, {
            leafTarget: leafGoal,
            sectionWords,
            globalFacts,
            // 第七轮改造 3：招标隐式硬约束（本地抽取，零 AI）注入大纲 prompt
            implicitConstraints: implicit,
            // 第十七轮 17D：历史范本目录结构（本地抽标题行，零 AI；未导入为空数组，builder 静默不注入）
            refTemplateOutline: extractTemplateOutlineLines(cur.ref_template_text),
            includeBiz,
            scope: outlineScope,
            // 05 三模式（§5.4）：透传合规严格度驱动骨架宽度（strict/缺省 builder 不追加，行为同现状）
            complianceMode: cur.gen_options?.compliance_mode,
            // R-017 必备技术内容清单注入大纲 prompt（可配置下限，非空才生效）
            requiredTechContents: readRequiredTechKeywords(),
          }),
          MAX_TOKENS_OUTLINE,
          "bid-outline",
        )
        parsed = await withJsonRepair(raw, (t) => normalizeOutline(parseOutlineJson(t)))
      }
      // 级数不指定时不做裁剪，由 AI 按招标要求自定；指定时 trimOutlineDepth 兜底
      let nodes = outlineLevel > 0 ? trimOutlineDepth(parsed, outlineLevel) : parsed
      // R-020：按评分办法（技术评分项名）+ 关键词/★▲/要求性表述判定必写，与 part 解耦
      const mwCtx = {
        techScoringNames: numberScoringItems(cur.parse_report).filter((i) => i.category === "tech").map((i) => i.item),
        // R-017 必备技术内容清单（可配置下限）：命中即必写，与 part 解耦
        requiredKeywords: readRequiredTechKeywords(),
      }
      // 用户反馈轮项 3 防御：关闭商务标时过滤模型违例/存量缓存产出的商务节点（开启时不过滤）
      if (outlineScope !== "both") nodes = nodes.filter((n) => (outlineScope === "biz" ? isBizPart(n) : !isBizPart(n) || judgeMustWrite(n, mwCtx).mustWrite))
      // R290：大纲为空属生成失败，绝不能落到「大纲为空，点右上角「添加章」手动搭建」的文案上 ——
      // 那会让用户以为是正常使用状态，而实际是大纲生成失败（且失败原因已由 withJsonRepair 抛出）。
      // 此处兜底仍需抛出，且文案要能被 handleLlmError 直接透出（含中文即不被降级）。
      if (!nodes.length) throw new Error("大纲生成结果为空，未产出任何章节，请重试；若反复出现请切换模型或减少输入规模")
      // 第五轮改造 2：本地结构校验，级数或叶子规模不符时自动一次结构修复（费用含在同一次确认内）；
      // OpenBidKit 借鉴（评审→修复闭环）：R31 评分承接缺口并入同一次修复调用的问题清单，不新增调用次数
      const issues = validateOutlineShape(nodes, outlineLevel, leafGoal)
      const numberedForFix = numberScoringItems(cur.parse_report)
      const uncoveredForFix = findUncoveredScoringIds(nodes, numberedForFix)
      if (uncoveredForFix.length) {
        issues.push(`评分项未承接（${uncoveredForFix.slice(0, 12).join("、")}${uncoveredForFix.length > 12 ? " 等" : ""}）`)
      }
      if (issues.length) {
        try {
          const fixRaw = await llmGenerate(
            buildOutlineFixMessages(nodes, outlineLevel, leafGoal, sectionWords, issues),
            MAX_TOKENS_OUTLINE_FIX,
          )
          const fixedParsed = await withJsonRepair(fixRaw, (t) => normalizeOutline(parseOutlineJson(t)))
          const fixed = outlineLevel > 0 ? trimOutlineDepth(fixedParsed, outlineLevel) : fixedParsed
          // Q28 切片D：整树重写防缩水——残缺树一旦整树替换会把几十叶砍成一两章，覆盖直接归零
          if (fixed.length && !acceptRewrittenOutline(nodes, fixed)) {
            toast.error(
              `大纲自动修复返回的结构较原树缩水（技术叶 ${techOutlineLeafCount(nodes)} → ${techOutlineLeafCount(fixed)}），判定为模型输出被截断，已保留原大纲树`,
            )
          } else if (fixed.length) {
            const stillIssues = validateOutlineShape(fixed, outlineLevel, leafGoal)
            const stillUncovered = findUncoveredScoringIds(fixed, numberedForFix)
            if (stillUncovered.length) {
              stillIssues.push(`评分项仍未承接：${stillUncovered.slice(0, 6).join("、")}${stillUncovered.length > 6 ? " 等" : ""}`)
            }
            nodes = fixed
            if (stillIssues.length) {
              toast.error(`大纲结构经一次自动修复后仍不完全符合设置（${stillIssues.join("；")}），已保留当前结果，请手动调整或重新生成`)
            }
          }
        } catch {
          toast.error(`大纲结构与设置不符（${issues.join("；")}），自动修复未成功，已保留当前结果供手动调整`)
        }
      }
      // T15 大纲门禁评审闭环（易标 runFinalOutlineGate 语义移植）：结构修复后（或本无问题时）加一道 AI 评审门禁——
      // 单叶子分支/层级/叶子体量/评分承接/重复空泛逐项评审；不过 → 带问题清单修复一次（顶层章身份锁定）→ 复验，
      // 最多 2 轮；评审或修复失败静默跳过，不阻塞大纲产出
      try {
        for (let gateRound = 0; gateRound < 2; gateRound++) {
          const reviewRaw = await llmGenerate(
            buildOutlineGateReviewMessages(nodes, outlineLevel, leafGoal, numberedForFix, sectionWords),
            MAX_TOKENS_OUTLINE,
            "bid-outline",
          )
          const review = await withJsonRepair(reviewRaw, sanitizeOutlineGateReview)
          if (review.passed || !review.issues.length) break
          const gateFixRaw = await llmGenerate(
            buildOutlineFixMessages(nodes, outlineLevel, leafGoal, sectionWords, review.issues, { lockTopLevel: true }),
            MAX_TOKENS_OUTLINE_FIX,
          )
          const gateParsed = await withJsonRepair(gateFixRaw, (t) => normalizeOutline(parseOutlineJson(t)))
          const gateFixed = outlineLevel > 0 ? trimOutlineDepth(gateParsed, outlineLevel) : gateParsed
          // Q28 切片D：门禁重写同样整树替换，缩水即视为截断残缺——保留现状并终止门禁轮次
          if (!gateFixed.length || !acceptRewrittenOutline(nodes, gateFixed)) break
          nodes = gateFixed
          if (outlineScope !== "both") nodes = nodes.filter((n) => (outlineScope === "biz" ? isBizPart(n) : !isBizPart(n) || judgeMustWrite(n, mwCtx).mustWrite))
        }
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e
        // 门禁评审失败不阻塞大纲产出（本地结构校验与手动调整仍在）
      }
      try {
        // 分步模式不产出 clause_id→叶子映射，coverage 置空：条款归章自动回退本地相似度分配（既有兜底路径）
        setOutlineCoverage(staged ? [] : sanitizeOutlineCoverage(extractJsonLoose(raw), clauses))
      } catch {
        setOutlineCoverage([])
      }
      // 用户反馈轮项 3 防御（兜底）：结构修复路径可能重新引入商务节点，setOutlineDraft 前再过滤一次
      if (outlineScope !== "both") nodes = nodes.filter((n) => (outlineScope === "biz" ? isBizPart(n) : !isBizPart(n) || judgeMustWrite(n, mwCtx).mustWrite))
      // R-021 残句治理（本地零 AI）：命中显式特征表的残句标题并入规范父章、术语类冗余兄弟章合并，叶子文本一律保留不删除，仅调整挂载层级与清洗标题；留痕供页面「原→新」对照
      // R-020：持久化 mustWrite 标记并回收误标商务的必写技术章（供导出闸门与页面纠偏）
      const mw = applyMustWrite(nodes, mwCtx)
      nodes = mw.nodes
      setMustWriteRescued(mw.rescued)
      if (mw.rescued.length) {
        toast.success(
          `按评分办法保留 ${mw.rescued.length} 个被判商务、实为必写的技术章节（${mw.rescued.slice(0, 3).map((x) => x.title).join('、')}${mw.rescued.length > 3 ? ' 等' : ''}）`,
        )
      }
      // R-023 按招标目录标注来源 + 三态差异
      const originResult = classifyOrigins(nodes, cur.parse_report)
      nodes = originResult.nodes
      setCatalogDiff(originResult.diff)
      const residue = cleanOutlineResidue(nodes)
      nodes = residue.nodes
      setOutlineResidueFixes(residue.fixes)
      setOutlineDraft(nodes)
      if (residue.fixes.length) toast.success(`本次大纲已自动修正 ${residue.fixes.length} 处（残句归并 ${residue.residueCount} · 冗余章合并 ${residue.mergedGroups}），可展开查看原→新对照`)
      writeStageSnapshot("outline", "大纲生成完成", { outline: nodes })
      // 本地覆盖核验：AI 声称的 coverage 不算数，以技术章叶子标题与条款文本匹配为准（商务章不计入）
      const leaves = collectLeafTitles(techOutlineNodes(nodes))
      const uncoveredCount = clauses.filter((cl) => !leaves.some((t) => clauseMatchesTitle(cl.text, t))).length
      const bizCount = nodes.filter((n) => isBizPart(n)).length
      // R31：评分点承接对账——技术编号评分项 ↔ 叶子 [响应:Rx] 标注（本地，零 AI）
      const scoringNumbered = numberScoringItems(cur.parse_report).filter((s) => s.category === "tech")
      const uncoveredScoring = findUncoveredScoringIds(nodes, numberScoringItems(cur.parse_report))
      const scoringBlock = scoringNumbered.length
        ? `；评分点承接 ${scoringNumbered.length - uncoveredScoring.length}/${scoringNumbered.length}${
            uncoveredScoring.length
              ? uncoveredScoring.length === scoringNumbered.length
                ? "（大纲未携带承接标注，重新生成大纲可自动标注）"
                : `（未承接：${uncoveredScoring.slice(0, 6).join("、")}${uncoveredScoring.length > 6 ? " 等" : ""}）`
              : "（全部评分点已有叶子承接）"
          }`
        : ""
      toast.success(
        `${
          staged
            ? `长标书分步大纲生成完成（${techOutlineNodes(nodes).length} 个技术章逐个展开${
                stagedFailed.length ? `，「${stagedFailed.join("、")}」展开失败，已交由结构修复或可手动补充` : ""
              }）；`
            : ""
        }${
          clauses.length
            ? `招标条款覆盖 ${clauses.length - uncoveredCount}/${clauses.length}${uncoveredCount ? "（未响应条款可在大纲区一键补入）" : "（全部条款已有落点）"}；`
            : ""
        }${
          bizCount > 0
            ? `大纲含商务骨架章 ${bizCount} 个（线下填写）+ 技术章叶子 ${leaves.length} 个`
            : `大纲含技术章叶子 ${leaves.length} 个（本次不含商务章节）`
        }（目标约 ${leafGoal} 个、每叶子约 ${sectionWords} 字）${
          outlineLevel > 0 ? `，技术部分 ${outlineLevel} 级目录` : "，级数按招标要求自动决定"
        }${scoringBlock}`,
      )
    } catch (e) {
      handleLlmError(e, "大纲生成失败，请重试")
    } finally {
      setOutlineLoading(false)
    }
  }, [handleLlmError, outlineDraft.length, outlineLevel, sectionWords, writeStageSnapshot])

  const generateOutline = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    const scopeForConfirm = normalizeBidScope(activeProjectRef.current?.gen_options)
    const includeBizForConfirm = scopeForConfirm !== "tech"
    costConfirm.runWithCostConfirm(() => {
      void runGenerateOutline()
    }, `将根据评分办法与响应要求生成投标文件大纲——${scopeForConfirm === "biz" ? "仅商务部分详细大纲（本次不含技术章节）" : includeBizForConfirm ? "商务部分骨架章（线下填写，不生成正文）+ 技术部分详细大纲" : "仅技术部分详细大纲（本次不含商务章节）"}，招标要求条款逐条覆盖到技术章，并按设置的页数与级数约束技术部分规模；目标叶子数超过 ${STAGED_OUTLINE_LEAF_GOAL} 的长标书自动改为分步生成（顶层章一次调用 + 技术章逐章展开，费用按实际用量累加、含在本次确认内）；结构不符时会自动做一次结构修复、格式异常时自动修复一次（费用均含在本次确认内），${costText()}${skillCostSuffix("bid-outline")}`)
  }, [blockIfArchived, costConfirm, requireLogin, runGenerateOutline])

  // 循环 5 A3：归档只读——大纲树编辑六件套统一 silent 拦截（View 层已禁用控件，此处兜底）
  const outlineRename = useCallback((id: string, title: string) => {
    if (blockIfArchived(true)) return
    setOutlineDraft((prev) => renameNodeInTree(prev, id, title))
  }, [blockIfArchived])
  const outlineRemove = useCallback((id: string) => {
    if (blockIfArchived(true)) return
    setOutlineDraft((prev) => removeNodeFromTree(prev, id))
  }, [blockIfArchived])
  const outlineAddChild = useCallback((parentId: string, depth: number) => {
    if (blockIfArchived(true)) return
    if (depth >= 3) return
    setOutlineDraft((prev) => addChildToTree(prev, parentId, { id: makeUid(), title: "新小节（点击改名）", children: [] }))
  }, [blockIfArchived])
  const outlineAddRoot = useCallback(() => {
    if (blockIfArchived(true)) return
    // 第十三轮改造 4：手动新增章默认技术章
    setOutlineDraft((prev) => [...prev, { id: makeUid(), title: "新章节（点击改名）", children: [], part: "tech" }])
  }, [blockIfArchived])
  const outlineMove = useCallback((id: string, dir: -1 | 1) => {
    if (blockIfArchived(true)) return
    setOutlineDraft((prev) => moveNodeInTree(prev, id, dir) ?? prev)
  }, [blockIfArchived])
  /** 第十三轮改造 4：章级归属切换（商务骨架章 ↔ 技术章），只作用于顶层节点 */
  const outlineSetPart = useCallback((id: string, part: "biz" | "tech") => {
    if (blockIfArchived(true)) return
    setOutlineDraft((prev) => prev.map((n) => (n.id === id ? { ...n, part } : n)))
  }, [blockIfArchived])

  const confirmOutline = useCallback(() => {
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    if (!outlineDraft.length) {
      toast.error("大纲为空，请先生成或添加章节")
      return
    }
    // T20：评分承接标注本地回填——把章↔评分点映射写回叶子 [响应:Rx]，消除「已映射但大纲无标注」。
    // 分步大纲不产标注（0/12 通病）；回填后评分点清单的承接对账与生成时的评分响应要求才有依据。
    const numbered = numberScoringItems(activeProjectRef.current?.parse_report ?? null)
    const chapterTitles = outlineDraft.map((n) => ({ title: n.title, sections: (n.children ?? []).map((c) => c.title) }))
    const filled = backfillResponseTags(outlineDraft, chapterTitles, numbered)
    if (filled !== outlineDraft) setOutlineDraft(filled)
    // 第十三轮改造 4：商务章照常构建（gen_status 固定 pending，永不参与正文生成），part 随章持久化
    const chapters: Chapter[] = filled.map((n) => ({
      node_id: n.id,
      title: n.title,
      sections: (n.children ?? []).map((c) => c.title),
      content: "",
      gen_status: "pending" as const,
      ...(n.part ? { part: n.part } : {}),
    }))
    updateProject({ bid_outline: filled, bid_chapters: chapters, response_map: null })
    writeStageSnapshot("outline", "大纲已确认并生成章节清单", { outline: outlineDraft })
    setActiveChapterId(chapters[0]?.node_id ?? null)
    setEditingContent("")
    const bizCount = chapters.filter((c) => isBizPart(c)).length
    toast.success(
      bizCount
        ? `大纲已确认（含 ${bizCount} 个商务骨架章，线下填写），可开始逐章生成技术部分正文`
        : "大纲已确认，可开始逐章生成正文",
    )
    // 第十七轮 17A：招标规定目录生效时本地核验匹配率（零 AI），<60% 仅提醒不阻断
    const outlineReqText = sectionText(activeProjectRef.current?.parse_report ?? null, BID_OUTLINE_REQ_KEY).trim()
    if (outlineReqText) {
      const techTitles = outlineDraft.filter((n) => !isBizPart(n)).map((n) => n.title)
      const matchRate = outlineReqMatchRate(outlineReqText, techTitles)
      if (matchRate !== null && matchRate < 0.6) {
        toast.warning(
          `大纲顶层技术章与招标规定目录匹配率仅 ${Math.round(matchRate * 100)}%（低于 60%），AI 提取目录可能存在幻想，请对照招标原文核对章节结构`,
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineDraft, updateProject, writeStageSnapshot])

  /** 第3轮 G3：★/▲ 实质性条款逐字承诺函（纯本地零 AI）——读 star_clauses 分区切分条款，
   *  逐字引用 + 模板承诺语生成正文，作为商务章并入投标正文与大纲（part=biz 不参与正文生成、随全套导出）。 */
  const generateCommitmentLetter = useCallback(() => {
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.bid_chapters?.length) {
      toast.error("请先确认大纲并生成章节清单，再生成承诺函")
      return
    }
    // r277 切片1 · A1 根修：条款库入库截断（600 字/4 行上限）会让承诺函照抄删节原文——
    // 生成前先用招标原文找回逐字全文（原文缺失时幂等退回条款库文本，零新依赖）
    const clauses = upgradeClausesWithTender(
      splitStarClauses(sectionText(cur.parse_report, STAR_CLAUSE_SECTION.key)),
      (cur.tender_text ?? "").trim() || sectionText(cur.parse_report, STAR_CLAUSE_SECTION.key),
    )
    if (!clauses.length) {
      toast.error("未解析到 ★/▲ 实质性条款，请回到「AI 解析报告」核对重点条款分区")
      return
    }
    const content = buildCommitmentLetter(clauses)
    const nextChapters = upsertCommitment(cur.bid_chapters, content)
    const baseOutline = outlineDraft.length ? outlineDraft : cur.bid_outline ?? []
    const { outline: nextOutline, added } = upsertCommitmentOutline(baseOutline)
    if (added) setOutlineDraft(nextOutline)
    updateProject({ bid_chapters: nextChapters, bid_outline: nextOutline })
    toast.success(
      added
        ? `已逐条引用 ${clauses.length} 项实质性条款生成承诺函，并新增「${COMMITMENT_CHAPTER_TITLE}」商务章节`
        : `已更新承诺函（逐条引用 ${clauses.length} 项实质性条款）`,
    )
  }, [blockIfArchived, outlineDraft, updateProject])

  const openImportDialog = useCallback(async () => {
    if (!requireLogin()) return
    setImportDialogOpen(true)
    setImportLoading(true)
    try {
      const data = await apiFetch<ListResponse<SolutionRecord>>(
        `/api/solutions?rh_user_id=${encodeURIComponent(userId as string)}`,
      )
      setImportCandidates(
        (data.items ?? []).filter((s) => (s.outline?.length ?? 0) > 0 || (s.chapters?.length ?? 0) > 0),
      )
    } catch {
      toast.error("方案列表加载失败，请稍后重试")
    } finally {
      setImportLoading(false)
    }
  }, [requireLogin, userId])

  const importFromSolution = useCallback(
    (sol: SolutionRecord) => {
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      const outline = deepCopyOutline(sol.outline ?? [])
      if (!outline.length) {
        toast.error("该方案没有可引入的大纲")
        return
      }
      const chapters: Chapter[] = outline.map((n) => {
        const src = (sol.chapters ?? []).find((c) => c.title === n.title)
        return {
          node_id: n.id,
          title: n.title,
          sections: (n.children ?? []).map((c) => c.title),
          content: src?.content ?? "",
          gen_status: (src?.content ? "done" : "pending") as Chapter["gen_status"],
        }
      })
      setOutlineDraft(outline)
      updateProject({ bid_outline: outline, bid_chapters: chapters, response_map: null })
      setActiveChapterId(chapters[0]?.node_id ?? null)
      setEditingContent("")
      setImportDialogOpen(false)
      toast.success(`已引入方案「${sol.solution_name}」作底稿，可按招标要求继续调整`)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [updateProject],
  )

  // 章节编辑器（与方案编制一致的形态：自动保存 + 单章生成 + 改写/扩写/精简 + 批量串行）
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)

  // ------------------------- 2026-10 配图需求轮：上传截图 / 图模板库（用户自有架构图/流程图/系统截图） -------------------------

  const [figureTemplates, setFigureTemplates] = useState<FigureTemplate[]>(() => listFigureTemplates())
  const [figureUploadBusy, setFigureUploadBusy] = useState(false)

  /** 把一张图片 URL 以 {type:"image"} 追加进当前章 figures（同名 image 图替换不堆叠；落 PB 持久化） */
  const insertImageFigure = useCallback(
    async (url: string, title: string, saveTemplateAs?: FigureTemplateKind): Promise<boolean> => {
      const cur = activeProjectRef.current
      const nodeId = activeChapterId
      if (!cur || !nodeId) {
        toast.error("请先选中要插图的技术章")
        return false
      }
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      if (!ch) {
        toast.error("未找到当前章节，请刷新后重试")
        return false
      }
      setFigureUploadBusy(true)
      try {
        // 外链落地 PB（已落地的 URL 原样返回），与 AI 位图同一条持久化链路
        const landed = await persistMediaUrl(url, "bid-figure-upload")
        const titleClean = title.trim().slice(0, 40) || "章节插图"
        const figure: FigureSpec = { type: "image", title: titleClean, url: landed }
        const figures = [...(ch.figures ?? []).filter((f) => !(f.type === "image" && f.title === titleClean)), figure]
        updateChapter(nodeId, { figures })
        if (saveTemplateAs) {
          setFigureTemplates(addFigureTemplate({ name: titleClean, url: landed, kind: saveTemplateAs }))
        }
        return true
      } catch {
        return false
      } finally {
        setFigureUploadBusy(false)
      }
    },
    [activeChapterId, updateChapter],
  )

  /** 上传本地图片（系统截图/架构图/流程图模版）→ aigc 直传 → 插入当前章 → 自动登记进模板库 */
  const uploadChapterFigure = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("请选择图片文件（PNG/JPG）")
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("图片不能超过 10MB，请压缩后再上传")
        return
      }
      const kind = figureKindFromName(file.name)
      const title = file.name.replace(/\.[^.]+$/, "").slice(0, 40)
      setFigureUploadBusy(true)
      try {
        const r = await uploadAigcMedia(file, "image")
        const url = r.downloadUrl || r.download_url || ""
        if (!url) {
          toast.error("图片上传失败：服务端未返回地址，请重试")
          return
        }
        const okFlag = await insertImageFigure(url, title, kind)
        if (okFlag) toast.success(`已插入「${title}」，并存入图模板库（${kind === "architecture" ? "架构图" : kind === "flow" ? "流程图" : "系统截图"}）`)
        else toast.error("图片已上传但插入章节失败，请重试")
      } catch (e) {
        const status = (e as { status?: number }).status
        toast.error(status === 412 ? "登录态已过期，请重新登录后再上传" : "图片上传失败，请检查网络后重试")
      } finally {
        setFigureUploadBusy(false)
      }
    },
    [insertImageFigure],
  )

  /** 从模板库插入一张图到当前章 */
  const insertFigureTemplate = useCallback(
    async (t: FigureTemplate) => {
      const okFlag = await insertImageFigure(t.url, t.name)
      if (okFlag) toast.success(`已插入模板「${t.name}」`)
    },
    [insertImageFigure],
  )

  /** 删除模板库中的一条登记（不影响已插入章节的图） */
  const removeFigureTemplateById = useCallback((id: string) => {
    setFigureTemplates(removeFigureTemplateRecord(id))
  }, [])

  const [editingContent, setEditingContentState] = useState("")
  const editingContentRef = useRef("")
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const autoSaveResetRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const [chapterBusy, setChapterBusy] = useState<string | null>(null)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 })
  const cancelBulkRef = useRef(false)
  // 循环 8 A1：批量进行中标志的 ref 镜像——单章生成/一键补齐/继续生成入口互斥判定用
  // （state 在 useCallback 闭包里会陈旧，ref 保证「取消批量后旧循环仍在飞」窗口期内入口必被拒）
  const bulkGeneratingRef = useRef(false)
  // 改造 1：自动补足循环进行中状态（章节徽标「补足中 第 n 轮」）
  const [supplementState, setSupplementState] = useState<{ nodeId: string; round: number } | null>(null)
  // 第八轮改造 3：小节级生成进行中状态（章节徽标「小节 j/k」）
  const [sectionGenState, setSectionGenState] = useState<{ nodeId: string; current: number; total: number } | null>(null)
  // R191：「一键补齐」需要复用小节断点续跑，但该能力（generateChapterContent）定义在 runFillPages
  // 之后——useCallback 的 deps 在定义时求值，直接引用会踩块级 const 的 TDZ（R172 当年正是因此退化成
  // 「跳过 + 提示」）。用 ref 桥接：赋值在能力就绪后的 useEffect 里完成，调用发生在运行时。
  const resumePendingSectionsRef = useRef<((nodeId: string, idx: number, budget: number) => Promise<number>) | null>(null)

  /**
   * 章节生成后的自动补足循环：content.length 不足预算 90% 时自动续写（复用续写 prompt + stripOverlap 合并），
   * 每章最多 6 轮；单轮新增 <200 字视为模型写不动，合并小额增量后提前熔断防死循环。
   * 费用在生成入口一次确认，循环内不再弹窗。
   */
  const runSupplementLoop = useCallback(
    async (nodeId: string, chapterNo: number, budget: number) => {
      let rounds = 0
      while (rounds < MAX_SUPPLEMENT_ROUNDS) {
        if (cancelBulkRef.current) break
        const cur = activeProjectRef.current
        if (!cur) break
        const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
        if (!ch || ch.content.length >= budget * SUPPLEMENT_TARGET_RATIO) break
        // R179：小节残缺章不做整章 blob 补足——补足只会把已有小节续长、产不出缺失的具名小节，
        // 还持续新增「done+stats 陈旧」脏记录；缺洞交由「继续生成」走小节断点续跑（R171 路由）
        if (hasPendingSections(ch)) break
        rounds += 1
        setSupplementState({ nodeId, round: rounds })
        try {
          const base = ch.content
          const remain = Math.max(400, budget - base.length)
          const contIdx = Math.max(0, chapterNo - 1)
          const contClauses = mapClausesToChapters(outlineClauses, outlineCoverage, cur.bid_chapters)[contIdx] ?? []
          // R191：整章缺口（实测 53849 字）一次性交给单次调用必撞网关 120s 红线 → 0 字。
          // 改为 ≤2000 字/块串行累加，每块即时落库（关页/取消不丢已产出，续跑从新长度接着补）。
          const grown = await generateInChunks(
            remain,
            async (chunkChars, acc) => {
              const ctx = acc ? `${base}\n\n${acc}` : base
              const raw = await llmGenerate(
                buildBidContinueMessages(
                  cur.project_name,
                  cur.hospital,
                  cur.parse_report,
                  ch.title,
                  chapterNo,
                  ctx,
                  chunkChars,
                  effectiveGlobalFacts(cur),
                  {
                    clauses: contClauses,
                    outlineText: outlineToText(cur.bid_outline),
                    scoring: assignScoringToChapters(scoringItemsFromReport(cur.parse_report), cur.bid_chapters)[contIdx] ?? [],
                    // 第八轮改造 2：续写也注入招标原文相关段（tender_text 为空时静默降级为空串）
                    tenderFragments: retrieveTenderFragments(cur.tender_text, {
                      title: ch.title,
                      sections: ch.sections ?? [],
                      clauses: contClauses.map((c) => c.text),
                    }),
                  },
                ),
                longformCallTokens(chunkChars),
                "bid-chapter",
                undefined,
                { disableThinking: shouldDisableThinking(chunkChars) },
              )
              return sanitizeChapterText(stripOverlap(ctx, raw)).trim()
            },
            {
              shouldStop: () => cancelBulkRef.current,
              onChunk: (acc) => {
                const merged = `${base.trimEnd()}\n\n${acc}`
                // R179：生产端回写 section_stats——整章补足增量按切片口径并入末节，杜绝 stats 陈旧
                const nextStats = reflowStatsAfterAppend(ch.section_stats ?? [], merged)
                updateChapter(nodeId, { content: merged, gen_status: "done", ...(nextStats ? { section_stats: nextStats } : {}) })
                if (activeChapterId === nodeId) {
                  editingContentRef.current = merged
                  setEditingContentState(merged)
                }
              },
            },
          )
          // 单轮新增太少：模型写不动了，提前熔断
          if (grown.length < SUPPLEMENT_MIN_GAIN) break
        } catch {
          // 补足轮失败：保留已生成正文，不阻断整章流程
          updateChapter(nodeId, { gen_status: "done" })
          break
        }
      }
      setSupplementState(null)
      return rounds
    },
    [activeChapterId, outlineClauses, outlineCoverage, updateChapter],
  )

  /**
   * 第十轮修复 3：章级字数预算生成后治理（单章生成与批量生成补足完成后统一收口）——
   * 实际字数 > 预算×1.2 → 段落边界裁剪至 1.2×预算落库 + toast 告知（第十一轮改造 2：阈值由 1.4 收紧到 1.2）；
   * < 预算×0.6 → 打 underlength 标记（章节区显示「偏短」徽标，扩写达标后清除）+ toast 建议扩写；
   * 介于两者之间 → 清除历史偏短标记。
   */
  const applyBudgetGovernance = useCallback(
    (nodeId: string, budget: number) => {
      const cur = activeProjectRef.current
      if (!cur || !(budget > 0)) return
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      if (!ch) return
      const len = (ch.content ?? "").length
      if (!len) return
      if (len > budget * 1.2) {
        const capped = trimToBudget(ch.content, Math.round(budget * 1.2))
        if (capped.trimmed) {
          updateChapter(nodeId, { content: capped.text, underlength: false })
          if (activeChapterId === nodeId) {
            editingContentRef.current = capped.text
            setEditingContentState(capped.text)
          }
          toast.warning(
            `本章超出字数预算，已自动裁剪至约 ${capped.text.length} 字（约 ${estimatePagesFromChars(capped.text.length, formatCharsPerPage(cur.format_settings))} 页）`,
          )
        }
        return
      }
      if (len < budget * 0.75) {
        if (!ch.underlength) updateChapter(nodeId, { underlength: true })
        toast.info(`本章实际约 ${estimatePagesFromChars(len, formatCharsPerPage(cur.format_settings))} 页低于预算，可用「扩写」补足`)
      } else if (ch.underlength) {
        updateChapter(nodeId, { underlength: false })
      }
    },
    [activeChapterId, updateChapter],
  )

  // ------------------------------ 第十一轮改造 2：页数硬约束治理 ------------------------------
  /** 招标隐式硬约束里的页数上限（null = 招标文件未限定页数） */
  const pageCap = useMemo(
    () => (activeProject ? extractPageCap(extractImplicitConstraints(activeProject.tender_text)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProject?.tender_text],
  )

  /** 有效目标页数：用户设置（缺省按招标文本估算）受招标页数上限硬封顶 */
  const activeEffectivePages = useMemo(() => effectiveTargetPages(activeProject), [activeProject])

  // R-019/R-024 演示/答辩评分节点汇总（供生成设置醒目提示线下准备 + 大纲「演示分」标记）
  const demoScoreSummary = useMemo(
    () => summarizeDemoNodes(activeProject?.bid_outline),
    [activeProject?.bid_outline],
  )

  // r277 切片4：评分策略建议卡（纯本地派生零 AI 零新字段：加分建议 + 客观项证据挂载提醒）
  const scoringSuggestions = useMemo(
    () => scoringStrategySuggestions(numberScoringItems(activeProject?.parse_report ?? null), activeProject?.bid_chapters ?? []),
    [activeProject?.parse_report, activeProject?.bid_chapters],
  )

  /** r277 切片4：一键插入演示准备骨架（纯本地零 AI）——幂等：已有骨架标记的章不重复追加 */
  const insertDemoSkeleton = useCallback(() => {
    if (blockIfArchived()) return
    const cur = activeProjectRef.current
    if (!cur) return
    const nodes = findDemoScoreNodes(cur.bid_outline)
    if (!nodes.length) {
      toast.info("当前大纲没有演示/答辩评分节点")
      return
    }
    const items = numberScoringItems(cur.parse_report)
    const chapters = cur.bid_chapters.map((c) => {
      const hit = nodes.find((n) => n.id === c.node_id)
      if (!hit) return c
      const content = c.content ?? ""
      if (content.includes(DEMO_SKELETON_MARK)) return c
      const score = items.find((it) => (it.item ?? "").includes(hit.title))?.score ?? 0
      const skeleton = buildDemoSkeleton(hit.title, score, [hit])
      return { ...c, content: content.trim() ? `${content}\n\n${skeleton}` : skeleton, gen_status: "done" as const }
    })
    updateProject({ bid_chapters: chapters })
    toast.success(`已为 ${nodes.length} 个演示节点插入准备骨架（环节内容留【待填写】占位，请按实际填实）`)
  }, [blockIfArchived, updateProject])

  /** 正文页数信息：实际 / 有效目标 / ±10% 治理区间 / 达标状态 / 距下限缺口页数（第十三轮改造 4：商务章不计字数） */
  const pageInfo = useMemo(() => {
    const totalChars = techChapters(activeProject?.bid_chapters ?? []).reduce((s, c) => s + (c.content?.length ?? 0), 0)
    const cpp = formatCharsPerPage(activeProject?.format_settings ?? null)
    const actualPages = estimatePagesFromChars(totalChars, cpp)
    const eff = activeEffectivePages
    const lower = Math.floor(eff * (1 - PAGE_GOVERN_TOLERANCE) * cpp)
    const upper = Math.ceil(eff * (1 + PAGE_GOVERN_TOLERANCE) * cpp)
    const status: "under" | "in" | "over" = totalChars < lower ? "under" : totalChars > upper ? "over" : "in"
    const gapPages = Math.max(0, Math.ceil((lower - totalChars) / cpp))
    return { totalChars, actualPages, targetPages: eff, lower, upper, status, gapPages }
  }, [activeProject, activeEffectivePages])

  /**
   * 总量治理：全文总字数超过硬上限（1.1×有效目标页×每页字数，见 DEFAULT_CHARS_PER_PAGE）时，按章字数从大到小
   * 段落边界裁剪收敛回上限内，并 toast 告知；低于下限不在此处理（由「一键补齐」负责）。
   */
  const governTotalPages = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    const eff = effectiveTargetPages(cur)
    if (eff <= 0) return
    const upper = Math.ceil(eff * (1 + PAGE_GOVERN_TOLERANCE) * formatCharsPerPage(cur.format_settings))
    // 第十三轮改造 4：字数治理只针对技术章（商务骨架章不占预算不计字数）
    const governed = techChapters(cur.bid_chapters)
    let now = governed.reduce((s, c) => s + (c.content?.length ?? 0), 0)
    if (now <= upper) return
    const order = [...governed].sort((a, b) => (b.content?.length ?? 0) - (a.content?.length ?? 0))
    let trimmedCount = 0
    for (const ch of order) {
      if (now <= upper) break
      const len = ch.content?.length ?? 0
      const keep = Math.max(600, len - (now - upper))
      const out = trimToBudget(ch.content, keep)
      if (!out.trimmed) continue
      now -= len - out.text.length
      trimmedCount += 1
      updateChapter(ch.node_id, { content: out.text })
      if (activeChapterId === ch.node_id) {
        editingContentRef.current = out.text
        setEditingContentState(out.text)
      }
    }
    if (trimmedCount) {
      toast.warning(`全文体量超出页数硬约束，已自动裁剪 ${trimmedCount} 个章节收敛到约 ${eff} 页（±10%）以内`)
    }
  }, [activeChapterId, updateChapter])

  // 一键补齐进行中（信息条按钮 busy 态）
  const [pageFillBusy, setPageFillBusy] = useState(false)

  // R32 批次2「自动修复」：生成后命中即对刚成稿章做确定性代码清洗（零 AI、零费用），
  // 返回修复动作数（0=无改动）；回写正文并同步编辑视图，体检报告随后由 refreshFormatReport 重算回显（各生成/补齐入口共用）
  // 注：定义前置到 runFillPages 之前，避免批量补齐入口的 useCallback deps 触发块级 const 暂时死区（TDZ）
  const applyAutoRepair = useCallback(
    (nodeId: string): number => {
      const cur = activeProjectRef.current
      if (!cur) return 0
      const ch = (cur.bid_chapters ?? []).find((c) => c.node_id === nodeId)
      if (!ch || !(ch.content ?? "").trim()) return 0
      try {
        const res = autoRepairChapter(
          ch.content ?? "",
          effectiveGlobalFactsLines(cur),
          cur.format_check_items ?? FORMAT_CHECK_KEYS,
        )
        if (!res.applied.length) return 0
        updateChapter(nodeId, { content: res.content })
        if (activeChapterId === nodeId) {
          editingContentRef.current = res.content
          setEditingContentState(res.content)
        }
        return res.applied.length
      } catch {
        return 0
      }
    },
    [activeChapterId, updateChapter],
  )

  // ------------------------------ T15：字数局部精调（易标字数调整阶段移植） ------------------------------

  /** 精调进行中的提示态（章节操作区按钮 busy 展示） */
  const [wordRefineState, setWordRefineState] = useState<{ nodeId: string; title: string; section: string } | null>(null)
  const [wordRefineBusy, setWordRefineBusy] = useState(false)

  /**
   * 单章字数精调：对预算带外（<0.8× 或 >1.2×目标字数）的小节/整章做「局部操作式」增删，
   * 每个候选最多 WORD_REFINE_ROUNDS_PER_TARGET 轮、每轮一次 AI 调用；应用与校验全部本地
   * （唯一定位 + 保护区间 + 方向/变化量/收敛三重校验，任一不满足该轮作废进下一轮）。
   * 小节级章节按 section_stats 切片逐节调整并重组落库；整章文本（无统计）按章预算带调整。
   */
  const runWordRefineChapter = useCallback(
    async (nodeId: string): Promise<{ adjusted: number; skipped: number }> => {
      const cur = activeProjectRef.current
      if (!cur) return { adjusted: 0, skipped: 0 }
      const idx = cur.bid_chapters.findIndex((c) => c.node_id === nodeId)
      if (idx < 0) return { adjusted: 0, skipped: 0 }
      const ch = cur.bid_chapters[idx]
      if (isBizPart(ch) || !(ch.content ?? "").trim()) return { adjusted: 0, skipped: 0 }
      const budgets = chapterWordBudgets(cur.bid_chapters, effectiveTargetPages(cur), formatCharsPerPage(cur.format_settings), cur.gen_options?.generate_demo === true)
      const chapterBudget = budgets[idx] ?? 0
      const sectionBudget = ch.sections?.length ? Math.max(SECTION_MIN_BUDGET, Math.round(chapterBudget / ch.sections.length)) : 0
      const targets = pickWordRefineTargets({
        content: ch.content ?? "",
        sections: ch.sections ?? [],
        sectionStats: ch.section_stats,
        sectionBudget,
        chapterBudget,
        maxTargets: 4,
      })
      if (!targets.length) return { adjusted: 0, skipped: 0 }
      let adjusted = 0
      let skipped = 0
      for (const target of targets) {
        let text = target.text
        let done = false
        for (let round = 0; round < WORD_REFINE_ROUNDS_PER_TARGET && !done; round++) {
          if (cancelBulkRef.current) break
          setWordRefineState({ nodeId, title: ch.title, section: target.sectionIndex >= 0 ? target.title : "整章" })
          try {
            const maxChange = maxChangeWordsFor(target.direction, text.length, target.targetWords)
            const raw = await llmGenerate(
              buildWordAdjustmentMessages({
                title: [ch.title, target.title].filter(Boolean).join(" · "),
                content: text,
                direction: target.direction,
                granularity: adjustGranularity(text.length, target.targetWords),
                targetWords: target.targetWords,
                maxChangeWords: maxChange,
              }),
              MAX_TOKENS_LONGFORM,
              "bid-chapter",
              undefined,
              // Q28 切片E：精调是「按锚点输出 JSON 局部操作」的确定性任务，提示词已锁死边界；
              // 开思考实测 85s 级空回复（配额耗在思考上），R192 关思考口径此前漏了这条路径
              { disableThinking: true },
            )
            const ops = await withJsonRepair(raw, normalizeWordAdjustmentOps)
            if (!ops.length) break
            const result = applyWordAdjustmentOps(text, ops)
            const violation = validateAdjustmentResult({
              before: text.length,
              after: result.text.length,
              direction: target.direction,
              targetWords: target.targetWords,
              maxChangeWords: maxChange,
            })
            if (violation || !result.applied) {
              skipped += result.skipped
              break // 该轮无有效改动：不重试同文本，避免重复付费
            }
            skipped += result.skipped
            text = sanitizeChapterText(result.text)
            done = true
            adjusted += 1
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            break // 单候选失败不拖垮其余候选
          }
        }
        if (!done || text === target.text) continue
        // 落库：小节级按切片重组（保留其他小节原样），整章直接写回
        if (target.sectionIndex >= 0 && ch.section_stats?.length) {
          const pieces = sliceSectionPieces(ch.content ?? "", ch.section_stats)
          pieces[target.sectionIndex] = text
          updateChapter(nodeId, { content: rebuildSectionContent(pieces), section_stats: ch.section_stats.map((s, i) => (i === target.sectionIndex ? { ...s, chars: text.length } : { ...s })) })
        } else {
          updateChapter(nodeId, { content: text })
        }
        if (activeChapterId === nodeId) {
          const now = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)?.content ?? text
          editingContentRef.current = now
          setEditingContentState(now)
        }
      }
      return { adjusted, skipped }
    },
    [activeChapterId, updateChapter],
  )

  /** 手动入口：精调全部已成稿技术章（串行、可取消，与批量生成互斥）；带外章为空时提示 */
  const runWordRefine = useCallback(
    async (): Promise<void> => {
      const cur = activeProjectRef.current
      if (!cur) return
      setWordRefineBusy(true)
      try {
        const nodeIds = techChapters(cur.bid_chapters)
          .filter((c) => (c.content ?? "").trim() && c.gen_status === "done")
          .map((c) => c.node_id)
        let totalAdjusted = 0
        let touched = 0
        for (const nodeId of nodeIds) {
          if (cancelBulkRef.current) break
          const r = await runWordRefineChapter(nodeId)
          if (r.adjusted > 0) touched += 1
          totalAdjusted += r.adjusted
        }
        if (totalAdjusted > 0) {
          governTotalPages()
          toast.success(`字数精调完成：${touched} 章 ${totalAdjusted} 处局部增删已落盘（未唯一定位的锚点已跳过）`)
        } else {
          toast.info("各章篇幅都在预算带内（或没有可精调的锚点），本次未做改动")
        }
      } finally {
        setWordRefineBusy(false)
        setWordRefineState(null)
      }
    },
    [governTotalPages, runWordRefineChapter],
  )

  const startWordRefineAll = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    if (bulkGeneratingRef.current) {
      toast.error("批量生成进行中，请先停止批量或等待其完成，再执行字数精调")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void runWordRefine()
    }, `将对全部已成稿技术章预算带外（偏离目标 20% 以上）的小节做局部字数精调（扩写补细节/缩写删冗词，锚点唯一定位、事实口径不改），每个候选最多 ${WORD_REFINE_ROUNDS_PER_TARGET} 轮，费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
  }, [blockIfArchived, costConfirm, requireLogin, runWordRefine])

  /** 单章入口（章节操作区按钮）：确认后精调本章 */
  const startWordRefineChapter = useCallback(
    (nodeId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return
      if (bulkGeneratingRef.current) {
        toast.error("批量生成进行中，请先停止批量或等待其完成，再执行字数精调")
        return
      }
      costConfirm.runWithCostConfirm(() => {
        setWordRefineBusy(true)
        void runWordRefineChapter(nodeId)
          .then((r) => {
            if (r.adjusted > 0) toast.success(`本章字数精调完成：${r.adjusted} 处局部增删已落盘`)
            else toast.info("本章篇幅在预算带内（或没有可精调的锚点），本次未做改动")
          })
          .catch((e) => handleLlmError(e, "字数精调失败，请重试"))
          .finally(() => {
            setWordRefineBusy(false)
            setWordRefineState(null)
          })
      }, `将对本章预算带外（偏离目标 20% 以上）的小节做局部字数精调（扩写补细节/缩写删冗词，锚点唯一定位、事实口径不改），每个候选最多 ${WORD_REFINE_ROUNDS_PER_TARGET} 轮，费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
    },
    [blockIfArchived, costConfirm, handleLlmError, requireLogin, runWordRefineChapter],
  )

  // ------------------------------ T15：生成后一致性自动审计（易标 auditing 阶段移植） ------------------------------

  /**
   * 单章一致性自动核对 + 限次修补：全局事实表对该章命中段落做一次 AI 核对（evidence 本地检索零费用），
   * 有矛盾时生成替换补丁自动修复一次（唯一命中校验）；结果仅 toast 汇报，不打断生成链。
   * 手动深度核对仍走「事实一致性核对」快捷工具与交卷体检。
   */
  const runChapterConsistencyAudit = useCallback(
    async (nodeId: string): Promise<{ conflicts: number; fixed: number; skipped: number }> => {
      const cur = activeProjectRef.current
      if (!cur) return { conflicts: 0, fixed: 0, skipped: 0 }
      const lines = effectiveGlobalFactsLines(cur)
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      if (!lines.length || !ch || !(ch.content ?? "").trim()) return { conflicts: 0, fixed: 0, skipped: 0 }
      try {
        const evidence = collectFactEvidence(lines, [ch])
        const raw = await llmGenerate(buildFactCheckMessages(wrapGlobalFactsBlock(lines), evidence), MAX_TOKENS_LONGFORM)
        const conflicts = await withJsonRepair(raw, sanitizeFactConflicts)
        if (!conflicts.length) return { conflicts: 0, fixed: 0, skipped: 0 }
        // T19：修复循环带提交校验退回机制（易标 createSubmissionTracker 移植）——
        // 每轮修复后重审，按"剩余矛盾数"判断进展：满 3 轮或连续两轮矛盾数未减少即停止，
        // 防"越修越糟/原地打转"的无效修复白烧钱。
        const tracker = createSubmissionTracker()
        let remaining = conflicts
        let fixed = 0
        let skipped = 0
        for (;;) {
          const patchRaw = await llmGenerate(buildFactPatchMessages(remaining, [ch]), MAX_TOKENS_LONGFORM)
          const patches = await withJsonRepair(patchRaw, sanitizeFactPatches)
          const applied = applyFactPatchItems(patches, [ch])
          fixed += applied.fixed
          skipped += applied.skipped
          for (const [nid, content] of applied.byNode) {
            updateChapter(nid, { content })
            if (activeChapterId === nid) {
              editingContentRef.current = content
              setEditingContentState(content)
            }
          }
          if (!applied.fixed) {
            // 本轮无任何替换生效：再修也是同样输入，直接收敛
            break
          }
          // 复审：修复后的章正文 vs 原矛盾清单，仍未消解的矛盾作为下一轮输入（进展按剩余数判断）
          const chNow = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
          if (!chNow) break
          const evidenceNow = collectFactEvidence(lines, [chNow])
          let recheckRaw: string
          try {
            recheckRaw = await llmGenerate(buildFactCheckMessages(wrapGlobalFactsBlock(lines), evidenceNow), MAX_TOKENS_LONGFORM)
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            break // 复审失败：保留已修复成果，不再退回
          }
          const nextConflicts = await withJsonRepair(recheckRaw, sanitizeFactConflicts)
          remaining = nextConflicts
          if (!remaining.length) break
          const error = new Error(`仍有 ${remaining.length} 处事实矛盾`) as Error & { issues?: unknown[] }
          error.issues = remaining
          if (!tracker.allowReturn(error)) {
            toast.warning(`「${ch.title}」一致性修复 ${tracker.returns} 轮后仍有 ${remaining.length} 处矛盾（${error.message.split("\n")[1] ?? "修复无进展"}），已停止自动修复，请人工复核`)
            break
          }
        }
        return { conflicts: conflicts.length, fixed, skipped }
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e
        return { conflicts: 0, fixed: 0, skipped: 0 } // 审计失败不阻塞生成链
      }
    },
    [activeChapterId, updateChapter],
  )

  /**
   * 一键补齐：缺口字数（距治理下限）按各章预算权重分配到已有正文的章节，逐章走既有
   * 续写链路（每章一次调用，串行），失败章跳过记录；全部完成后复跑一次总量治理。
   * 费用在入口一次确认覆盖整批扩写。
   */
  const runFillPages = useCallback(async () => {
    const start = activeProjectRef.current
    if (!start) return
    // 循环 8 A1：批量生成进行中入口互斥（互斥判定在 cancelBulkRef 复位之前，防止「取消批量→立刻点补齐」
    // 把取消标志复位导致旧批量循环失去取消感知、两条生成循环并发写同批章节）
    if (bulkGeneratingRef.current) {
      toast.error("批量生成进行中，请先停止批量或等待其完成，再执行一键补齐")
      return
    }
    // 循环 7 A1：非批量入口——复位陈旧的批量取消标志（backToList/停止批量置位后不清会瘫痪本循环第一轮）
    cancelBulkRef.current = false
    setPageFillBusy(true)
    const failedTitles: string[] = []
    const pendingSectionTitles: string[] = []
    let filled = 0
    let autoRepaired = 0
    // T18+：本轮补齐实际写过正文的章（精调/审计只扫这些，不重扫全项目）
    const touchedNodes = new Set<string>()
    try {
      const eff = effectiveTargetPages(start)
      const cpp = formatCharsPerPage(start.format_settings)
      const lower = Math.floor(eff * (1 - PAGE_GOVERN_TOLERANCE) * cpp)
      // 第十三轮改造 4：一键补齐只算/只补技术章（商务骨架章跳过）
      const totalChars = techChapters(start.bid_chapters).reduce((s, c) => s + (c.content?.length ?? 0), 0)
      const gap = lower - totalChars
      if (gap <= 0) {
        toast.info("正文页数已达标，无需补齐")
        return
      }
      const budgets = chapterWordBudgets(start.bid_chapters, eff, cpp, start.gen_options?.generate_demo === true)
      const cand = start.bid_chapters
        .map((c, i) => ({ node: c, idx: i }))
        .filter((x) => !isBizPart(x.node) && (x.node.content ?? "").trim().length > 0)
      if (!cand.length) {
        toast.error("还没有任何已生成正文的技术章节可补齐，请先生成正文")
        return
      }
      const weightSum = cand.reduce((s, x) => s + Math.max(1, budgets[x.idx] ?? 1500), 0)
      for (const x of cand) {
        if (cancelBulkRef.current) break
        const cur = activeProjectRef.current
        if (!cur) break
        const ch = cur.bid_chapters.find((c) => c.node_id === x.node.node_id)
        if (!ch || !ch.content.trim()) continue
        // R172 遇小节残缺章只是「跳过 + 提示用户去点继续生成」，但继续生成入口当时同样受单次调用
        // 超网关红线所困（见 longformBudget 头注释）——用户看到的是「新增约 0 字 + 让我自己点」的死循环。
        // R191：补齐链路自己闭环——小节残缺章内联走小节断点续跑（stats 对齐的已产出小节不重复付费，
        // 只补缺失小节），补齐后仍未达预算再走分块自动补足。
        if (hasPendingSections(ch)) {
          const resume = resumePendingSectionsRef.current
          // R192：断点续跑此前不在逐章 try 内——单章某个小节调用抛错（空回复/瞬时失败重抛）直接穿透
          // runFillPages 成 unhandledrejection（「系统异常：回复内容为空」），本轮其余章节连尝试都没有。
          // 与下方整章续写的 catch 同口径：记入失败清单、继续下一章；登录失效仍即时冒泡。
          try {
            const gained = resume ? await resume(ch.node_id, x.idx, Math.max(1, budgets[x.idx] ?? 1500)) : 0
            if (gained > 0) {
              filled += gained
              touchedNodes.add(ch.node_id)
            } else {
              pendingSectionTitles.push(ch.title)
            }
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
            failedTitles.push(ch.title)
          }
          continue
        }
        const remain = Math.max(300, Math.round((gap * Math.max(1, budgets[x.idx] ?? 1500)) / weightSum))
        const base = ch.content
        try {
          const contClauses = mapClausesToChapters(outlineClauses, outlineCoverage, cur.bid_chapters)[x.idx] ?? []
          // R191：缺口按章权重折算后仍是万字级（实测 47900 字），一次性交给单次调用必撞 120s 红线；
          // 改为 ≤2000 字/块串行累加、每块落库，取消即停在当前块。
          const grown = await generateInChunks(
            remain,
            async (chunkChars, acc) => {
              const ctx = acc ? `${base}\n\n${acc}` : base
              const raw = await llmGenerate(
                buildBidContinueMessages(
                  cur.project_name,
                  cur.hospital,
                  cur.parse_report,
                  ch.title,
                  x.idx + 1,
                  ctx,
                  chunkChars,
                  effectiveGlobalFacts(cur),
                  {
                    clauses: contClauses,
                    outlineText: outlineToText(cur.bid_outline),
                    scoring: assignScoringToChapters(scoringItemsFromReport(cur.parse_report), cur.bid_chapters)[x.idx] ?? [],
                    tenderFragments: retrieveTenderFragments(cur.tender_text, {
                      title: ch.title,
                      sections: ch.sections ?? [],
                      clauses: contClauses.map((c) => c.text),
                    }),
                  },
                ),
                longformCallTokens(chunkChars),
                "bid-chapter",
                undefined,
                { disableThinking: shouldDisableThinking(chunkChars) },
              )
              return sanitizeChapterText(stripOverlap(ctx, raw)).trim()
            },
            {
              shouldStop: () => cancelBulkRef.current,
              onChunk: (acc) => {
                const merged = `${base.trimEnd()}\n\n${acc}`
                // R191：本链路补齐 section_stats 回写（R179 只修了 supplement/continue 两处，
                // 这里此前直接 blob 追加不回写，仍在生产「done + stats 陈旧」脏数据）
                const nextStats = reflowStatsAfterAppend(ch.section_stats ?? [], merged)
                updateChapter(ch.node_id, {
                  content: merged,
                  gen_status: "done",
                  underlength: false,
                  ...(nextStats ? { section_stats: nextStats } : {}),
                })
                if (activeChapterId === ch.node_id) {
                  editingContentRef.current = merged
                  setEditingContentState(merged)
                }
              },
            },
          )
          if (grown) {
            touchedNodes.add(ch.node_id)
            filled += grown.length
            writeStageSnapshot("chapter", `页数补齐：${ch.title}`, {
              chapter_id: ch.node_id,
              title: ch.title,
              content: `${base.trimEnd()}\n\n${grown}`,
            })
            if (applyAutoRepair(ch.node_id)) autoRepaired += 1
          }
        } catch {
          failedTitles.push(ch.title)
        }
      }
      // 补齐完成后复跑总量治理（超出硬上限时收敛）
      governTotalPages()
      // T18+：补齐链路同样挂字数精调 + 一致性审计（与单章/批量生成同一治理闭环，只对本轮补齐过的章）
      let filledRefined = 0
      let filledAuditFixed = 0
      if (!cancelBulkRef.current) {
        for (const x of cand) {
          if (cancelBulkRef.current) break
          const touchedId = x.node.node_id
          if (!touchedNodes.has(touchedId)) continue
          try {
            filledRefined += (await runWordRefineChapter(touchedId)).adjusted
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
          }
          if (!cancelBulkRef.current) {
            try {
              filledAuditFixed += (await runChapterConsistencyAudit(touchedId)).fixed
            } catch (e) {
              if (e instanceof AuthRequiredError) throw e
            }
          }
        }
      }
      refreshFormatReport()
      const repairNote = autoRepaired ? `，已自动修正 ${autoRepaired} 章格式问题` : ""
      const refinedNote = filledRefined ? `，字数精调 ${filledRefined} 处` : ""
      const auditNote = filledAuditFixed ? `，一致性修复 ${filledAuditFixed} 处` : ""
      // R191：不再把问题推回给用户（旧文案「已跳过整章扩写，请点继续生成」是死循环来源）——
      // 汇报本轮实产字数 + 距治理下限仍差的字数/页数，缺口靠再点一次继续分块补足
      const nowRec = activeProjectRef.current
      const remainChars = nowRec
        ? Math.max(0, lower - techChapters(nowRec.bid_chapters).reduce((sum, c) => sum + (c.content?.length ?? 0), 0))
        : 0
      const remainNote =
        remainChars > 0
          ? `；距目标仍差约 ${remainChars} 字（约 ${Math.max(1, Math.ceil(remainChars / cpp))} 页），再点一次「一键补齐」会继续分块补足`
          : "，篇幅已达标"
      const pendingNote = pendingSectionTitles.length
        ? `；「${pendingSectionTitles.join("」「")}」章本轮小节续跑未产出新内容，可对它们单独「重新生成本章」`
        : ""
      if (failedTitles.length) {
        toast.error(`页数补齐结束，新增约 ${filled} 字${repairNote}${refinedNote}${auditNote}${remainNote}；「${failedTitles.join("」「")}」章补齐失败，可单独「继续生成」${pendingNote}`)
      } else {
        toast.success(`页数补齐完成，新增约 ${filled} 字${repairNote}${refinedNote}${auditNote}${remainNote}${pendingNote}`)
      }
    } finally {
      setPageFillBusy(false)
    }
  }, [activeChapterId, applyAutoRepair, governTotalPages, outlineClauses, outlineCoverage, refreshFormatReport, runChapterConsistencyAudit, runWordRefineChapter, updateChapter, writeStageSnapshot])

  const startFillPages = useCallback(() => {
    if (!requireLogin() || pageFillBusy) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    costConfirm.runWithCostConfirm(() => {
      void runFillPages()
    }, `将按各章缺口权重逐章扩写补齐约 ${pageInfo.gapPages} 页篇幅（单次调用控制在网关可完成量内，缺口按 ≤2000 字/次分块串行累加；小节未生成全的章会自动断点续跑补足小节），费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
  }, [blockIfArchived, costConfirm, pageFillBusy, pageInfo.gapPages, requireLogin, runFillPages])

  // 第五轮改造 3：全文总字数校正阶段进度（顶部显示「全文校正中 x/y 章」）
  const [totalAdjustProgress, setTotalAdjustProgress] = useState<{ current: number; total: number } | null>(null)

  /**
   * 全文总字数校正：总字数 vs 目标页数×500，缺口 >10% 时按「缺口最大的章节优先」串行续写
   * （复用 runSupplementLoop：每章 ≤6 轮、参与章数不限、连续两轮增益 <200 字的章退出），
   * 直至达标或无章可补。返回累计续写轮数（toast 汇报用）。
   */
  const runTotalWordAdjust = useCallback(async (): Promise<number> => {
    let totalRounds = 0
    const failCounts = new Map<string, number>()
    const exhausted = new Set<string>()
    for (let pass = 0; pass < TOTAL_ADJUST_MAX_PASSES; pass++) {
      if (cancelBulkRef.current) break
      const cur = activeProjectRef.current
      if (!cur) break
      // 第十一轮改造 2：校正目标页数同样受招标页数上限硬封顶
      const pages = effectiveTargetPages(cur)
      const cpp = formatCharsPerPage(cur.format_settings)
      const targetTotal = pages * cpp
      const budgets = chapterWordBudgets(cur.bid_chapters, pages, cpp, cur.gen_options?.generate_demo === true)
      // 第十三轮改造 4：全文校正只按技术章统计与续写
      const totalChars = techChapters(cur.bid_chapters).reduce((s, c) => s + (c.content?.length ?? 0), 0)
      if (totalChars >= targetTotal * (1 - TOTAL_ADJUST_GAP_TOLERANCE)) break
      const candidates = cur.bid_chapters
        .map((c, i) => ({ node: c, idx: i, gap: (budgets[i] ?? 0) - (c.content?.length ?? 0) }))
        .filter((x) => !isBizPart(x.node) && x.gap > 0 && (x.node.content ?? "").trim().length > 0 && !exhausted.has(x.node.node_id))
        .sort((a, b) => b.gap - a.gap)
      if (!candidates.length) break
      setTotalAdjustProgress({ current: 0, total: candidates.length })
      let done = 0
      for (const cand of candidates) {
        if (cancelBulkRef.current) break
        const before =
          activeProjectRef.current?.bid_chapters.find((c) => c.node_id === cand.node.node_id)?.content.length ?? 0
        totalRounds += await runSupplementLoop(cand.node.node_id, cand.idx + 1, budgets[cand.idx] ?? 1500)
        const after =
          activeProjectRef.current?.bid_chapters.find((c) => c.node_id === cand.node.node_id)?.content.length ?? 0
        const fails = after - before < SUPPLEMENT_MIN_GAIN ? (failCounts.get(cand.node.node_id) ?? 0) + 1 : 0
        failCounts.set(cand.node.node_id, fails)
        // 连续两轮增益过小：该章模型写不动了，退出校正队列
        if (fails >= 2) exhausted.add(cand.node.node_id)
        done += 1
        setTotalAdjustProgress({ current: done, total: candidates.length })
        const nowTotal = techChapters(activeProjectRef.current?.bid_chapters ?? []).reduce(
          (s, c) => s + (c.content?.length ?? 0),
          0,
        )
        if (nowTotal >= targetTotal * (1 - TOTAL_ADJUST_GAP_TOLERANCE)) break
      }
      setTotalAdjustProgress(null)
    }
    // T18+：校正循环结束后对仍带外的章做一次字数局部精调（续写增字可能把别的章挤出预算带）
    if (!cancelBulkRef.current) {
      let adjustRefined = 0
      for (const ch of techChapters(activeProjectRef.current?.bid_chapters ?? [])) {
        if (cancelBulkRef.current) break
        if (!(ch.content ?? "").trim() || ch.gen_status !== "done") continue
        try {
          adjustRefined += (await runWordRefineChapter(ch.node_id)).adjusted
        } catch (e) {
          if (e instanceof AuthRequiredError) throw e
        }
      }
      if (adjustRefined > 0) toast.info(`全文校正后已自动精调 ${adjustRefined} 处带外篇幅`)
    }
    setTotalAdjustProgress(null)
    return totalRounds
  }, [runSupplementLoop, runWordRefineChapter])

  const activeChapter = useMemo(
    () => activeProject?.bid_chapters.find((c) => c.node_id === activeChapterId) ?? null,
    [activeProject, activeChapterId],
  )

  const flushEditingContent = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const cur = activeProjectRef.current
    const nodeId = activeChapterId
    if (!cur || !nodeId) return
    const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
    if (ch && ch.content !== editingContentRef.current) {
      updateChapter(nodeId, { content: editingContentRef.current }, { quiet: true })
    }
  }, [activeChapterId, updateChapter])
  // 循环 6 A3：卸载 cleanup 经此 ref 冲刷正文编辑防抖（声明顺序见 cleanup 处注释）
  flushEditingContentRef.current = flushEditingContent

  // Ctrl+S / Cmd+S → 强制刷保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        flushEditingContent()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [flushEditingContent])

  const setEditingContent = useCallback(
    (value: string) => {
      // 循环 5 A3：归档只读——章节正文编辑 silent 拦截（View 层 Textarea 已 readOnly）
      if (blockIfArchived(true)) return
      editingContentRef.current = value
      setEditingContentState(value)
      setAutoSaveState("saving")
      if (autoSaveResetRef.current) { window.clearTimeout(autoSaveResetRef.current); autoSaveResetRef.current = null }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        flushEditingContent()
      }, 1000)
    },
    [blockIfArchived, flushEditingContent],
  )

  const selectChapter = useCallback(
    (nodeId: string) => {
      flushEditingContent()
      setActiveChapterId(nodeId)
      const ch = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
      const content = ch?.content ?? ""
      editingContentRef.current = content
      setEditingContentState(content)
    },
    [flushEditingContent],
  )

  // ------------------------------ T18+：错别字一键修正 / 逻辑问题跳转 ------------------------------

  const [fixTyposBusy, setFixTyposBusy] = useState(false)

  /**
   * 一键修正错别字：零 AI 调用（错→对替换表已由审计产出）。逐条在对应章正文唯一定位 wrongText
   * （未命中/多处命中 → 跳过留痕）后替换为 correctText；修掉的条目从报告中移除，跳过的保留供人工处理。
   * 仅内部模式可修（外部标书是只读审查对象）；错字替换长度差不构成篇幅带外，不做治理。
   */
  const runFixTypos = useCallback(async (): Promise<void> => {
    const cur = activeProjectRef.current
    if (!cur) return
    const report = normalizeTextAudit(cur.text_audit)
    if (!report?.typos.length) {
      toast.error("当前没有待修正的错别字，请先执行错别字检查")
      return
    }
    if (report.source === "external") {
      toast.error("外部标书为只读审查对象，请在源文件中按清单修正后重新上传")
      return
    }
    setFixTyposBusy(true)
    try {
      const chapters = cur.bid_chapters ?? []
      const byNode = new Map<string, string>()
      let fixed = 0
      const remaining: TextAuditReport["typos"] = []
      for (const t of report.typos) {
        const ch = chapters.find((c) => c.node_id === t.docId)
        if (!ch) {
          remaining.push(t)
          continue
        }
        const base = byNode.get(t.docId) ?? ch.content ?? ""
        const at = base.indexOf(t.wrongText)
        if (at < 0 || base.lastIndexOf(t.wrongText) !== at) {
          remaining.push(t)
          continue
        }
        byNode.set(t.docId, base.slice(0, at) + t.correctText + base.slice(at + t.wrongText.length))
        fixed += 1
      }
      for (const [nodeId, content] of byNode) {
        updateChapter(nodeId, { content })
        if (activeChapterId === nodeId) {
          editingContentRef.current = content
          setEditingContentState(content)
        }
      }
      updateProject({ text_audit: { ...report, typos: remaining } })
      if (fixed > 0) {
        toast.success(`错别字修正完成：${fixed} 处已替换${remaining.length ? `，${remaining.length} 处未唯一定位请人工处理` : ""}（建议重跑「错别字检查」复检）`)
      } else {
        toast.info(`${remaining.length} 处错别字均未能在正文中唯一定位（可能已人工修正），清单已保留供核对`)
      }
    } finally {
      setFixTyposBusy(false)
    }
  }, [activeChapterId, updateChapter, updateProject])

  const startFixTypos = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return
    void runFixTypos()
  }, [blockIfArchived, requireLogin, runFixTypos])

  /** T18+：逻辑问题跳转——切到编制环节并选中所在章（仅内部模式有 docId 可跳） */
  const jumpToAuditChapter = useCallback(
    (docId: string) => {
      const missing = stepEntryMissing(3, activeProjectRef.current)
      if (missing) {
        toast.error(missing)
        return
      }
      setActiveStep(3)
      selectChapter(docId)
    },
    [selectChapter],
  )

  // ------------------------------ 第十一轮改造 6：三级目录点击定位 ------------------------------
  /** 节/条级点击后由编制视图消费的定位指令（seq 自增保证重复点击同一标题也能再次触发） */
  const [contentFocus, setContentFocus] = useState<{ nodeId: string; title: string; seq: number } | null>(null)
  const focusSeqRef = useRef(0)

  const focusSectionInChapter = useCallback(
    (nodeId: string, title: string) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      const needle = (title ?? "").trim()
      if (!ch || !(ch.content ?? "").trim() || !needle) {
        toast.info("该小节正文尚未生成")
        return
      }
      // 正文里找首个以该标题开头的行（兼容「N.M 标题」编号前缀）
      const hit = ch.content
        .split("\n")
        .some((line) => line.trimStart().startsWith(needle) || line.trimStart().replace(/^\d+(\.\d+)*\s*/, "").startsWith(needle))
      if (!hit) {
        toast.info("该小节正文尚未生成")
        return
      }
      if (activeChapterId !== nodeId) selectChapter(nodeId)
      focusSeqRef.current += 1
      setContentFocus({ nodeId, title: needle, seq: focusSeqRef.current })
    },
    [activeChapterId, selectChapter],
  )

  /**
   * 第八轮改造 2/3：单章内容生成（单章与批量串行共用）——
   * 预算 > SECTION_GEN_MIN_BUDGET 且有 ≥2 小节时改逐小节串行生成（每小节产出即时写入章节，
   * 用户中途关页不丢已生成部分）；否则走现状单次生成。两条路径都注入招标原文相关段
   * （retrieveTenderFragments，tender_text 为空时静默降级为空串）。
   * 第十三轮改造 3/4：商务骨架章不生成正文（防御性拦截）；技术章按 gen_options 注入
   * 逐条应答强化（★/▲ 重点条款段）与素材优先注入（原文检索上限翻倍 + 知识库块级检索），零新增 LLM 调用。
   */
  const generateChapterContent = useCallback(
    async (nodeId: string, idx: number, opts?: { fresh?: boolean }): Promise<{ content: string; figures: FigureSpec[]; budget: number; title: string; sectionStats?: { title: string; chars: number }[]; cancelledMid?: boolean }> => {
      const cur = activeProjectRef.current
      if (!cur) throw new Error("项目未加载")
      const chaptersNow = cur.bid_chapters
      const ch = chaptersNow[idx]
      if (!ch) throw new Error("章节不存在")
      if (!isGenTargetChapter(ch, normalizeBidScope(cur.gen_options), cur.gen_options?.generate_demo === true))
        throw new Error(
          isDemoScoreTitle(ch.title) && cur.gen_options?.generate_demo !== true
            ? "本章为演示 / 答辩评分节点（演示分），默认不生成正文，请线下准备实机演示与讲标答辩；如需占位应答可在「生成设置」开启「演示分节点生成正文」"
            : normalizeBidScope(cur.gen_options) === "biz"
              ? "本章为技术章，不在「仅商务」生成范围内，请在生成设置切换内容范围后重试"
              : "商务骨架章不生成正文，请线下填写后随 Word 导出合并",
        )
      const budgets = chapterWordBudgets(chaptersNow, effectiveTargetPages(cur), formatCharsPerPage(cur.format_settings), cur.gen_options?.generate_demo === true)
      const budget = budgets[idx] ?? 1500
      // 改造 3：本章须响应的条款清单；第七轮改造 1：本章评分细则 + 相邻章摘要；改造 3：隐式硬约束
      const chapterClauses = mapClausesToChapters(outlineClauses, outlineCoverage, chaptersNow)[idx] ?? []
      const scoring = assignScoringToChapters(scoringItemsFromReport(cur.parse_report), chaptersNow)[idx] ?? []
      // 问题2（2026-10-12 用户拍板）：评分 criteria 里的必答要点（①…②…③…）强制补成本章独立小节，
      // 逐点各自成节展开（不再被概括带过）；与既有小节语义重复的不补、幂等（重复生成不叠加）。
      const sections = mergeRequiredSections(ch.sections ?? [], extractRequiredPoints(scoring))
      if (sections.length !== (ch.sections ?? []).length) updateChapter(nodeId, { sections })
      // 第十三轮改造 3：两个用户自选开关（只作用于技术章正文，商务章任何开关下都不注入）
      const boost = cur.gen_options?.material_boost === true
      const starBlock = cur.gen_options?.clause_response === true ? clauseResponsePromptBlock(cur.parse_report, cur.tender_text ?? "") : ""
      const fragChars = boost ? 8000 : 4000
      const fragParas = boost ? 24 : 12
      let kbDocs: KbDocRow[] = []
      if (boost) {
        try {
          kbDocs = await getCachedVisibleDocs(userId)
        } catch {
          kbDocs = [] // 知识库不可用时静默降级，不阻断正文生成
        }
      }
      // 组装层第一期：按项目赛道（项目名+医院+招标要点派生）与标书用途桶对检索结果软加权
      const projectTrack = deriveTrack(
        [cur.project_name, cur.hospital, (cur.tender_text ?? "").slice(0, 2000)].filter(Boolean).join(" "),
      )
      const kbMaterialFor = (queryParts: string[]): string => {
        if (!kbDocs.length) return ""
        const { hits } = assembleKbContext(kbDocs, {
          query: queryParts.filter(Boolean).join(" ").slice(0, 600),
          track: projectTrack,
          buckets: ["标书弹药", "产品资料", "方案素材"],
          topN: 5,
        })
        if (!hits.length) return ""
        return hits
          .map((h) => `（来源文档：《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}）\n${h.snippet}`)
          .join("\n\n")
      }
      // 第十六轮 B2 改造 2.2：预编排消费——章级视图合并该章下所有叶子的编排（figure 取章内优先级最高的选中 1 张、
      // table 取章内首个建议）；covered=false（未编排 / 编排后重生成过大纲）回退现状 figures_enabled 逻辑，老项目行为不变
      const chOrchView = cur.orchestration ? chapterOrchestration(cur.orchestration, cur.bid_outline, nodeId) : null
      const chapterOrchOpt = chOrchView?.covered ? chOrchView.merged : undefined
      const chapterFiguresOn = chOrchView?.covered ? Boolean(chOrchView.merged.figure) : figuresEnabled
      const baseOpts = {
        clauses: chapterClauses,
        globalFacts: effectiveGlobalFacts(cur),
        scoring,
        prevSummaries: prevChapterSummaries(chaptersNow, idx),
        implicitConstraints: extractImplicitConstraints(cur.tender_text),
        starBlock,
        orchestration: chapterOrchOpt,
        // 第十七轮 17B：编制依据注入（章级判断一次，小节串行循环继承同一判断）
        compilationBasis: compilationBasisOptFor(cur, idx),
        // 第十七轮 17D：团队写作资料章级检索（≤3 段 ≤1200 字；资料为空或检索为空静默不注入）
        refMaterials: refMaterialsFor(cur, {
          title: ch.title,
          sections,
          clauses: chapterClauses.map((c) => c.text),
        }),
        // 循环 2 批 1-4：暗标开启时注入身份脱敏规则条（sealed=false 为空串，builder 静默不注入）
        sealedIdentityRules: sealedIdentityBlock(cur.format_settings?.sealed === true, cur.identity_words),
        // 循环 2 批 2-1：定向事实——编排为本章挑了必守事实时，以定向事实块替代全量全局事实注入
        // （未重编排的老项目 facts 缺省，回退全量注入，行为与现状一致）
        directedFacts: chapterOrchOpt?.facts?.length ? buildDirectedFactsBlock(chapterOrchOpt.facts) : undefined,
        // 05 三模式：透传合规严格度（strict/缺省 builder 不注入，行为同现状）
        complianceMode: cur.gen_options?.compliance_mode,
        // T16：编排期定向挑选的知识库素材段（非空时章级替代检索式注入；节级视图覆盖见下方小节循环）
        directedKnowledge: chapterOrchOpt?.knowledge?.length ? chapterOrchOpt.knowledge : undefined,
      }
      if (budget > SECTION_GEN_MIN_BUDGET && sections.length >= 2) {
        // 小节级串行生成
        const k = sections.length
        const sectionBudget = Math.max(SECTION_MIN_BUDGET, Math.round(budget / k))
        // R276 细粒度断点续跑：用纯函数 planSectionResume 规划「保留种子 + 待补下标」——保留空洞之后
        // 的已产出小节（不再整体重生成、不重复付费、不冲掉手工修补），并按 R174 口径裁掉历史整章 blob
        // 追加的未跟踪尾巴防重复膨胀。全新章节 / 空正文 / title 错位 / opts.fresh → 全部待补，行为同原串行逻辑。
        const resumePlan = planSectionResume(ch.content ?? "", ch.section_stats ?? [], sections, { fresh: opts?.fresh })
        // 每小节片段（下标对齐 sections，未产出为 ""）与统计；续跑正文由 pieces 按小节序确定性重组
        const pieces = resumePlan.pieces
        const pendingSet = new Set(resumePlan.pendingIndices)
        // 第十六轮 B2：小节级配图累积（只有被编排选中的小节才产图，全文总数受编排择优约束 ≤maxFigures）
        const figs: FigureSpec[] = []
        // 第十五轮改造 2：小节级统计随生成同步累积（与 sections 顺序一致；未产出的片记 chars:0 占位保证下标对齐）
        const accStats: { title: string; chars: number }[] = resumePlan.stats
        // 循环 7 A2：配图种子——FigureSpec 无小节归属字段，按「既有 figures 全量保留 + 续跑小节新图追加」；
        // 有保留小节（pendingSet.size<k）时续跑不丢已落盘配图（最终 updateChapter 全量覆盖 figures，不种子必丢）
        if (pendingSet.size < k) figs.push(...(ch.figures ?? []))
        let cancelledMid = false
        for (let j = 0; j < k; j++) {
          if (!pendingSet.has(j)) continue // R276：已产出小节（含空洞之后的成品）不重新生成，种子已在 pieces 中
          if (cancelBulkRef.current) { cancelledMid = true; break }
          // 生成前的「已写正文」：按小节序重组当前 pieces（本小节尚为待补空片，不含自身）——供衔接与去重提示
          const acc = rebuildSectionContent(pieces)
          setSectionGenState({ nodeId, current: j + 1, total: k })
          const sectionName = sections[j]
          // 检索 query 聚焦「章标题 + 当前小节名 + 归本小节的条款」
          const sectionClauses = chapterClauses.filter((c) => clauseMatchesTitle(c.text, sectionName))
          // B2 改造 2.2：节级编排视图——按节标题匹配该章下同名二级节点、合并其下叶子编排；
          // figure 选中→本次输出契约改 JSON（content+figures），未选中且已覆盖→纯文本且不配图
          const secOrchView = cur.orchestration ? sectionOrchestration(cur.orchestration, cur.bid_outline, nodeId, sectionName) : null
          const secOrchOpt = secOrchView?.covered ? secOrchView.merged : undefined
          const fragments = retrieveTenderFragments(
            cur.tender_text,
            {
              title: ch.title,
              sections: [sectionName],
              clauses: sectionClauses.map((c) => c.text),
            },
            fragChars,
            fragParas,
          )
          // R173：小节级瞬时失败重试（见 chapterCompletion.withTransientRetry）——单小节模型调用抛错
          // （网络抖动 / 偶发超时 / 网关 5xx）自动重试 1 次，不让一次坏请求拖垮整章；登录失效即时冒泡、
          // 用户取消不再重试；重试后仍失败则上抛，交既有 catch 将整章标 failed（保留已生成小节可断点续跑）。
          // R191：单小节目标字数 = 章预算 / 小节数（实测某项目 59500/11 = 5409 字）远超网关单次可完成量
          // → 同一小节拆成 ≤2000 字的块依序生成，逐块把已产出文本回喂 writtenTail 续写；token 档同步
          // 封顶到实测可完成档（4096），超长块首调关闭思考。单块目标（预算 ≤2000）时链路形状不变。
          const secPlan = planLongformChunks(sectionBudget)
          const secNo = `${idx + 1}.${j + 1}`
          // R191：续块摘掉编排配图（保留 writing_focus/table）——配图 JSON 契约只在首块要，
          // 否则同一小节会被要求重复出图、续块输出 JSON 污染纯文本正文
          const contOrch = secOrchOpt?.figure ? { ...secOrchOpt, figure: undefined } : secOrchOpt
          let secText = ""
          const secFigs: FigureSpec[] = []
          for (let ci = 0; ci < secPlan.length; ci++) {
            if (cancelBulkRef.current) {
              cancelledMid = true
              break
            }
            const chunkChars = secPlan[ci]
            const raw = await withTransientRetry(
              () =>
                llmGenerate(
                  buildBidSectionMessages(
                    cur.project_name,
                    cur.hospital,
                    cur.parse_report,
                    cur.bid_outline,
                    chaptersNow,
                    idx,
                    outlineToText,
                    {
                      ...baseOpts,
                      // 小节级串行：节级编排视图覆盖 baseOpts 里的章级视图（一节一判断）
                      orchestration: ci === 0 ? secOrchOpt : contOrch,
                      // 循环 2 批 2-1：节级定向事实覆盖章级（无 facts 回退章级/全量口径）
                      directedFacts: secOrchOpt?.facts?.length ? buildDirectedFactsBlock(secOrchOpt.facts) : undefined,
                      // T16：节级定向知识覆盖章级（无 knowledge 回退章级/检索口径）
                      directedKnowledge: secOrchOpt?.knowledge?.length ? secOrchOpt.knowledge : undefined,
                      wordBudget: chunkChars,
                      figures: false,
                      tenderFragments: fragments,
                      kbMaterial: kbMaterialFor([ch.title, sectionName, ...sectionClauses.map((c) => c.text)]),
                      // 第十七轮 17D：节级资料检索 query 覆盖章级（章标题+当前小节名+归本小节的条款）
                      refMaterials: refMaterialsFor(cur, {
                        title: ch.title,
                        sections: [sectionName],
                        clauses: sectionClauses.map((c) => c.text),
                      }),
                      sectionName,
                      sectionNo: secNo,
                      sectionIndex: j,
                      sectionCount: k,
                      sectionClauses,
                      // R191：已写小节清单始终按「已完成小节」计（不含本小节自己），
                      // 否则同一小节的续块会被提示「该主题已写过」而跑题
                      writtenTitles: writtenSectionTitles(acc),
                      // 首块衔接上一小节结尾；续块衔接本小节已产出的结尾（分次生成靠它续写、不重复）
                      writtenTail: secText ? secText.slice(-600) : acc.slice(-600),
                    },
                  ),
                  longformCallTokens(chunkChars),
                  "bid-chapter",
                  undefined,
                  { disableThinking: shouldDisableThinking(chunkChars) },
                ),
              { isFatal: (e) => e instanceof AuthRequiredError, shouldStop: () => cancelBulkRef.current },
            )
            // B2：被编排选中配图的小节首块输出 JSON（content+figures），其余块维持纯文本契约
            const secOut =
              ci === 0 && secOrchOpt?.figure
                ? parseChapterOutput(raw, true)
                : { content: sanitizeChapterText(raw), figures: [] as FigureSpec[] }
            // T16：小节级 mermaid 配图即时校验修复（渲染错误回传模型一次；修复失败弃图，正文照常落库）
            if (secOut.figures.length) secFigs.push(...(await repairMermaidFigures(secOut.figures)))
            // R191：提示词要求每块首行都是「N.M 小节名」标题行，续块去掉重复标题行再拼接
            const body = ci === 0 ? secOut.content : stripDuplicateSectionHead(secOut.content, secNo, sectionName)
            const t = body.trim()
            if (!t) continue
            secText = secText ? `${secText}\n\n${t}` : t
          }
          const piece = trimToBudget(secText, Math.round(sectionBudget * 1.5)).text.trim()
          if (!piece) {
            // 循环 8 A2：失败小节（空产出）不 push 配图——配图 push 移到 piece 非空检查之后，
            // 从源头杜绝失败小节配图随增量落库、续跑种子全量保留后重新生成同小节又 append 的重复配图
            pieces[j] = ""
            accStats[j] = { title: sectionName, chars: 0 }
            continue
          }
          // 循环 2 批 2-1：编排图注按标题挂到本节产出的图上（导出时图注随图落盘）
          if (secFigs.length) figs.push(...attachFigureCaptions(secFigs, secOrchOpt?.figure))
          pieces[j] = piece
          accStats[j] = { title: sectionName, chars: piece.length }
          // 每小节产出即时写入章节（按小节序重组 pieces，保留种子中空洞之后的成品；第十五轮改造 2：section_stats 同步持久化）
          const accNow = rebuildSectionContent(pieces)
          updateChapter(nodeId, { content: accNow, section_stats: accStats.map((s) => ({ ...s })) })
          if (activeChapterId === nodeId) {
            editingContentRef.current = accNow
            setEditingContentState(accNow)
          }
        }
        setSectionGenState(null)
        const finalContent = rebuildSectionContent(pieces)
        if (!finalContent.trim()) throw new Error("小节生成未产出有效内容，请重试")
        // T16：mermaid 配图校验修复（渲染错误回传模型一次；修复失败弃图）
        const fixedFigs = await repairMermaidFigures(figs)
        return { content: finalContent, figures: fixedFigs, budget, title: ch.title, sectionStats: accStats, cancelledMid }
      }
      // 现状单次生成 + 招标原文相关段注入
      const fragments = retrieveTenderFragments(
        cur.tender_text,
        {
          title: ch.title,
          sections,
          clauses: chapterClauses.map((c) => c.text),
        },
        fragChars,
        fragParas,
      )
      const rawText = await llmGenerate(
        buildBidChapterMessages(
          cur.project_name,
          cur.hospital,
          cur.parse_report,
          cur.bid_outline,
          chaptersNow,
          idx,
          outlineToText,
          {
            ...baseOpts,
            wordBudget: budget,
            // B2 改造 2.2：已编排覆盖时配图开关由「本章是否有选中图」决定（选中→开、未选中→关）；未覆盖回退 figures_enabled
            figures: chapterFiguresOn,
            tenderFragments: fragments,
            kbMaterial: kbMaterialFor([ch.title, ...sections, ...chapterClauses.map((c) => c.text)]),
          },
        ),
        MAX_TOKENS_LONGFORM,
        "bid-chapter",
      )
      const out = parseChapterOutput(rawText, chapterFiguresOn)
      // T16：整章路径同样做 mermaid 配图校验修复
      const fixedFigs = await repairMermaidFigures(out.figures)
      // 循环 2 批 2-1：章级编排图注挂接（标题精确匹配优先；仅一张图时直接挂）
      return { content: out.content, figures: attachFigureCaptions(fixedFigs, chapterOrchOpt?.figure), budget, title: ch.title }
    },
    [activeChapterId, figuresEnabled, outlineClauses, outlineCoverage, targetPages, updateChapter, userId],
  )

  /**
   * R191：小节级残缺章的「断点续跑补足」——供「一键补齐」内联调用。复用 generateChapterContent 的
   * 非 fresh 分支（stats 对齐的已产出小节直接跳过，只补缺失小节），成稿后按既有口径落库
   * section_stats / gen_status；小节补齐后仍未达预算则续跑分块自动补足。
   * @returns 本轮新增字数（0 = 未产出，调用方记入待处理清单，不当作成功）
   */
  const runResumePendingSections = useCallback(
    async (nodeId: string, idx: number, budget: number) => {
      const cur = activeProjectRef.current
      const ch = cur?.bid_chapters[idx]
      if (!cur || !ch) return 0
      const before = (ch.content ?? "").length
      const out = await generateChapterContent(nodeId, idx)
      if (!out.content.trim()) return 0
      updateChapter(nodeId, {
        content: out.content,
        gen_status: sectionGenStatus({ cancelledMid: !!out.cancelledMid }),
        figures: out.figures,
        section_stats: out.sectionStats ?? [],
      })
      if (activeChapterId === nodeId) {
        editingContentRef.current = out.content
        setEditingContentState(out.content)
      }
      writeStageSnapshot("chapter", `页数补齐·小节断点续跑：${ch.title}`, { chapter_id: nodeId, title: ch.title, content: out.content })
      // 小节补齐后仍未达预算（且不再有未生成小节）→ 走自动补足循环（其内部已按 R191 分块）
      if (!out.cancelledMid && budget > 0) {
        const now = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
        if (now && !hasPendingSections(now)) await runSupplementLoop(nodeId, idx + 1, budget)
      }
      const after = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
      return Math.max(0, (after?.content.length ?? out.content.length) - before)
    },
    [activeChapterId, generateChapterContent, runSupplementLoop, updateChapter, writeStageSnapshot],
  )
  useEffect(() => {
    resumePendingSectionsRef.current = runResumePendingSections
  }, [runResumePendingSections])

  const runGenerateChapter = useCallback(
    async (nodeId: string, opts?: { fresh?: boolean }) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const idx = cur.bid_chapters.findIndex((c) => c.node_id === nodeId)
      if (idx < 0) return
      // 循环 8 A1：批量生成进行中入口互斥（互斥判定在 cancelBulkRef 复位之前，防止「取消批量→立刻点单章生成」
      // 把取消标志复位导致旧批量循环失去取消感知、两条生成循环并发写同批章节互相踩踏）
      if (bulkGeneratingRef.current) {
        toast.error("批量生成进行中，请先停止批量或等待其完成，再操作单个章节")
        return
      }
      // 循环 7 A1：非批量入口——复位陈旧的批量取消标志。backToList/停止批量置位后唯一复位点原本只在
      // runBulkGenerate 开头，取消批量→返回列表→重进项目后单章生成会在小节循环第一轮 break（瘫痪）。
      // 批量路径不经过本函数入口（runBulkGenerate 自带复位），批量中途取消能力不受影响。
      cancelBulkRef.current = false
      // 循环 7 A1 保底用快照：生成前章节内容与状态（空产出时不覆盖不标 done）
      const prevContent = cur.bid_chapters[idx]?.content ?? ""
      const prevGenStatus = cur.bid_chapters[idx]?.gen_status
      setChapterBusy(nodeId)
      updateChapter(nodeId, { gen_status: "generating" }, { persist: false })
      try {
        // 循环 6 A2：opts.fresh 透传——「重新生成本章」强制全新覆盖，失败重试/批量路径默认断点续跑
        const out = await generateChapterContent(nodeId, idx, opts)
        // 循环 7 A1 + 循环 8 A2 保底：产出为空串一律不标 done——prevContent 为空的全新生成同样置 failed，
        // 杜绝「已完成空章」被批量/一键补齐按 done 永久跳过；content 不覆盖
        if (!out.content.trim()) {
          updateChapter(nodeId, { gen_status: prevGenStatus && prevGenStatus !== "generating" ? prevGenStatus : "failed" })
          toast.error(prevContent.trim() ? "本次生成未产出内容，已保留原有正文，请稍后重试" : "本次生成未产出内容，请重试")
          return
        }
        // R170：小节级串行生成被中断（停止批量/返回列表/生成中刷新触发 cancelBulkRef）时，只产出了部分小节的章
        // 不得按 done 落库——改标 failed，保留已生成小节并让「继续生成」按断点续跑补足剩余小节。
        if (out.cancelledMid) {
          updateChapter(nodeId, { content: out.content, gen_status: "failed", figures: out.figures, section_stats: out.sectionStats ?? [] })
          if (activeChapterId === nodeId) {
            editingContentRef.current = out.content
            setEditingContentState(out.content)
          }
          toast.info(`「${out.title}」生成已中断，已保留 ${out.content.length} 字（${out.sectionStats?.length ?? 0} 个小节）；点「继续生成」或「重新生成本章」可断点续跑补足剩余小节`)
          return
        }
        // 第十五轮改造 2：小节串行分支随章持久化 section_stats；单次生成分支置空防陈旧统计误启用条级重写
        updateChapter(nodeId, { content: out.content, gen_status: sectionGenStatus({ cancelledMid: !!out.cancelledMid }), figures: out.figures, section_stats: out.sectionStats ?? [] })
        if (activeChapterId === nodeId) {
          editingContentRef.current = out.content
          setEditingContentState(out.content)
        }
        // 改造 1：未达篇幅预算自动续写补足（小节级拼接后仍 <预算 90% 时同样兜底；入口费用确认已覆盖循环，不再逐轮弹窗）
        await runSupplementLoop(nodeId, idx + 1, out.budget)
        // 第十轮修复 3：补足完成后做章级预算治理（超写裁剪 / 偏短标记）
        applyBudgetGovernance(nodeId, out.budget)
        // T15：字数局部精调（易标字数调整阶段移植，gen_options.word_refine 默认开）——
        // 治理后仍在预算带外（<0.8× 或 >1.2×预算）时，对带外小节/整章做局部操作式增删
        if (activeProjectRef.current?.gen_options?.word_refine !== false) {
          const afterGovernLen = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)?.content.length ?? 0
          if (afterGovernLen > 0 && (afterGovernLen < out.budget * 0.8 || afterGovernLen > out.budget * 1.2)) {
            try {
              const refined = await runWordRefineChapter(nodeId)
              if (refined.adjusted > 0) {
                toast.info(`已自动字数精调 ${refined.adjusted} 处（局部增删，向 ${out.budget} 字预算收敛）`)
              }
            } catch (e) {
              if (e instanceof AuthRequiredError) throw e
              // 精调失败不阻塞生成链（篇幅治理与手动精调仍可用）
            }
          }
        }
        // 第五轮改造 3：全部技术章节均已成稿时做一次全文总字数校正（缺口 >10% 才续写；商务骨架章不计入）
        const techAfter = techChapters(activeProjectRef.current?.bid_chapters ?? [])
        if (techAfter.length && techAfter.every((c) => (c.content ?? "").trim().length > 0)) {
          await runTotalWordAdjust()
        }
        // 第十一轮改造 2：生成与校正完成后做总量治理（超出硬上限自动裁剪收敛）
        governTotalPages()
        const finalCh = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
        const finalLen = finalCh?.content.length ?? out.content.length
        const reached = finalLen >= out.budget * SUPPLEMENT_TARGET_RATIO
        writeStageSnapshot("chapter", `章节正文生成：${out.title}`, {
          chapter_id: nodeId,
          title: out.title,
          content: finalCh?.content ?? out.content,
        })
        toast.success(
          `「${out.title}」正文 ${finalLen} 字 / 预算 ${out.budget} 字（约 ${Math.max(1, Math.round(finalLen / formatCharsPerPage(activeProjectRef.current?.format_settings)))} 页）${
            reached ? "，篇幅达标" : "，续写 6 轮后仍未达预算，可手动「继续生成」补足"
          }${out.figures.length ? `，含 ${out.figures.length} 张配图` : ""}`,
        )
        // R32 批次2：生成后命中即自动定向修复（确定性代码清洗，零 AI/零费用），再本地体检回显剩余需人工项
        const repairedN = applyAutoRepair(nodeId)
        const rep = refreshFormatReport()
        const chHits = rep?.hits.filter((h) => h.chapter === out.title).length ?? 0
        if (repairedN && chHits) {
          toast.warning(
            `「${out.title}」已自动修复 ${repairedN} 类问题（装饰/元话语/参数加码，零费用），另有 ${chHits} 处需人工复核，可到「交卷体检」查看明细`,
          )
        } else if (repairedN) {
          toast.success(`「${out.title}」已自动修复 ${repairedN} 类问题（装饰符号/元话语/参数加码，确定性代码、零费用）`)
        } else if (chHits) {
          toast.warning(
            `「${out.title}」本地体检发现 ${chHits} 处提示（数值/指标口径等需人工判断项，零费用），可到「交卷体检」查看明细，不影响继续生成`,
          )
        }
        // T15：生成后一致性自动审计（易标 auditing 阶段移植，gen_options.auto_consistency_audit 默认开）——
        // 有全局事实表时对新成稿章做一次事实核对 + 一次限次修补；结果 toast 汇报，不阻塞生成链
        if (activeProjectRef.current?.gen_options?.auto_consistency_audit !== false) {
          const audit = await runChapterConsistencyAudit(nodeId)
          if (audit.conflicts > 0) {
            if (audit.fixed > 0) {
              toast.warning(
                `「${out.title}」一致性核对发现 ${audit.conflicts} 处与全局事实口径不一致，已自动修复 ${audit.fixed} 处${
                  audit.skipped ? `、${audit.skipped} 处未唯一定位需人工复核` : ""
                }（可在「事实一致性核对」复检）`,
              )
            } else {
              toast.warning(
                `「${out.title}」一致性核对发现 ${audit.conflicts} 处与全局事实口径不一致，未能自动定位修复，请到「事实一致性核对」逐条处理`,
              )
            }
          }
        }
      } catch (e) {
        setSectionGenState(null)
        updateChapter(nodeId, { gen_status: "failed" })
        handleLlmError(e, "正文生成失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, applyAutoRepair, applyBudgetGovernance, generateChapterContent, governTotalPages, handleLlmError, refreshFormatReport, runChapterConsistencyAudit, runSupplementLoop, runTotalWordAdjust, runWordRefineChapter, updateChapter, writeStageSnapshot],
  )

  const generateChapter = useCallback(
    (nodeId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      costConfirm.runWithCostConfirm(() => {
        void runGenerateChapter(nodeId)
      }, `将生成本章投标正文，篇幅较大的章节将按小节分段生成，未达篇幅预算将自动续写补足（每章最多 6 轮）；成稿后自动做字数精调与事实一致性核对（可在生成设置关闭），全部章节成稿后会自动做全文总字数校正，费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runGenerateChapter],
  )

  /**
   * 第十五轮改造 4：小节级重写——复用 buildBidSectionMessages（参数同小节串行生成），
   * 产出 sanitize + trimToBudget(1.5x) 后按 section_stats 顺序切片替换第 idx 片
   * （切片依据：各片 chars + "\n\n" 2 字符连接符，确定性可切），其余片原样保留；
   * 同步更新 content / section_stats[idx].chars / 活跃章 editingContent，gen_status 保持 done。
   * 并发防护复用 chapterBusy（键 `${nodeId}#s${idx}`）；同章串行生成进行中禁止小节重写；失败 toast 不污染 content。
   */
  const runRegenerateSection = useCallback(
    async (nodeId: string, sectionIdx: number, extraRequirements?: string) => {
      const busyKey = `${nodeId}#s${sectionIdx}`
      const cur = activeProjectRef.current
      if (!cur) return
      const idx = cur.bid_chapters.findIndex((c) => c.node_id === nodeId)
      if (idx < 0) return
      const ch = cur.bid_chapters[idx]
      const stats = ch?.section_stats
      const sections = ch?.sections ?? []
      if (!ch || !stats?.length || !stats[sectionIdx] || !(ch.content ?? "").trim()) {
        toast.error("本章还没有小节统计，重新生成本章后可按条重写")
        return
      }
      const sectionName = stats[sectionIdx].title || sections[sectionIdx] || ""
      if (!sectionName) {
        toast.error("小节标题缺失，无法重写")
        return
      }
      setChapterBusy(busyKey)
      try {
        // 切片：按各片 chars + "\n\n" 连接符确定性还原各小节片段
        const pieces = sliceSectionPieces(ch.content, stats)
        const k = Math.max(1, sections.length || stats.length)
        const budgets = chapterWordBudgets(cur.bid_chapters, effectiveTargetPages(cur), formatCharsPerPage(cur.format_settings), cur.gen_options?.generate_demo === true)
        const budget = budgets[idx] ?? 1500
        const sectionBudget = Math.max(SECTION_MIN_BUDGET, Math.round(budget / k))
        const chapterClauses = mapClausesToChapters(outlineClauses, outlineCoverage, cur.bid_chapters)[idx] ?? []
        const scoring = assignScoringToChapters(scoringItemsFromReport(cur.parse_report), cur.bid_chapters)[idx] ?? []
        const boost = cur.gen_options?.material_boost === true
        const starBlock = cur.gen_options?.clause_response === true ? clauseResponsePromptBlock(cur.parse_report, cur.tender_text ?? "") : ""
        const sectionClauses = chapterClauses.filter((c) => clauseMatchesTitle(c.text, sectionName))
        const fragments = retrieveTenderFragments(
          cur.tender_text,
          { title: ch.title, sections: [sectionName], clauses: sectionClauses.map((c) => c.text) },
          boost ? 8000 : 4000,
          boost ? 24 : 12,
        )
        let kbMaterial = ""
        if (boost) {
          try {
            const kbDocs = await getCachedVisibleDocs(userId)
            if (kbDocs.length) {
              const projectTrack = deriveTrack(
                [cur.project_name, cur.hospital, (cur.tender_text ?? "").slice(0, 2000)].filter(Boolean).join(" "),
              )
              const { hits } = assembleKbContext(kbDocs, {
                query: [ch.title, sectionName, ...sectionClauses.map((c) => c.text)].filter(Boolean).join(" ").slice(0, 600),
                track: projectTrack,
                buckets: ["标书弹药", "产品资料", "方案素材"],
                topN: 5,
              })
              kbMaterial = hits
                .map((h) => `（来源文档：《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}）\n${h.snippet}`)
                .join("\n\n")
            }
          } catch {
            kbMaterial = "" // 知识库不可用时静默降级，不阻断小节重写
          }
        }
        const writtenTitles = sections.filter((_, i) => i !== sectionIdx && sections[i])
        const writtenTail = sectionIdx > 0 ? (pieces[sectionIdx - 1] ?? "").slice(-600) : ""
        // 第十六轮 B2：小节级重写保持纯文本输出契约——只注入表格编排提示；配图是章级存储、
        // 已随小节串行生成产出，单节重写不强制出图（避免 JSON 契约污染确定性切片替换）
        const rewriteOrchView = cur.orchestration ? sectionOrchestration(cur.orchestration, cur.bid_outline, nodeId, sectionName) : null
        // 循环 5 A2：补写通道——把覆盖审计漏点作为附加写作要求拼进 writing_focus；
        // 无 extraRequirements 时与现状完全一致（只透传表格编排）
        const rewriteOrchOpt: MergedOrchestration | undefined = (() => {
          const base: MergedOrchestration = {}
          if (rewriteOrchView?.covered && rewriteOrchView.merged.table) base.table = rewriteOrchView.merged.table
          if (extraRequirements) {
            const origFocus = rewriteOrchView?.covered ? rewriteOrchView.merged.writing_focus ?? "" : ""
            base.writing_focus = [origFocus, extraRequirements].filter((s) => s.trim()).join("；")
          }
          return Object.keys(base).length ? base : undefined
        })()
        // R191：小节重写的目标字数与串行生成同源（章预算/小节数，实测 5409 字）——同样分块，
        // 逐块把本节已产出文本回喂 writtenTail 续写，末块拼完再整体裁剪，避免单次调用撞 120s 红线
        const rewritePlan = planLongformChunks(sectionBudget)
        const rewriteSecNo = `${idx + 1}.${sectionIdx + 1}`
        let rewriteText = ""
        for (let ci = 0; ci < rewritePlan.length; ci++) {
          const chunkChars = rewritePlan[ci]
          const raw = await llmGenerate(
            buildBidSectionMessages(
              cur.project_name,
              cur.hospital,
              cur.parse_report,
              cur.bid_outline,
              cur.bid_chapters,
              idx,
              outlineToText,
              {
                clauses: chapterClauses,
                globalFacts: effectiveGlobalFacts(cur),
                scoring,
                prevSummaries: prevChapterSummaries(cur.bid_chapters, idx),
                implicitConstraints: extractImplicitConstraints(cur.tender_text),
                starBlock,
                orchestration: rewriteOrchOpt,
                // 循环 2 批 2-1：小节重写同口径消费节级定向事实（编排 facts 非空时替代全量全局事实注入）
                directedFacts:
                  rewriteOrchView?.covered && rewriteOrchView.merged.facts?.length
                    ? buildDirectedFactsBlock(rewriteOrchView.merged.facts)
                    : undefined,
                // 第十七轮 17B：小节重写继承章级编制依据判断（与串行生成同口径）
                compilationBasis: compilationBasisOptFor(cur, idx),
                wordBudget: chunkChars,
                figures: false,
                tenderFragments: fragments,
                kbMaterial,
                // 第十七轮 17D：小节重写同样注入写作资料（与串行生成同口径检索）
                refMaterials: refMaterialsFor(cur, {
                  title: ch.title,
                  sections: [sectionName],
                  clauses: sectionClauses.map((c) => c.text),
                }),
                // 循环 2 批 1-4：小节重写同口径注入暗标身份脱敏规则条
                sealedIdentityRules: sealedIdentityBlock(cur.format_settings?.sealed === true, cur.identity_words),
                // 05 三模式：小节重写同口径透传合规严格度
                complianceMode: cur.gen_options?.compliance_mode,
                sectionName,
                sectionNo: rewriteSecNo,
                sectionIndex: sectionIdx,
                sectionCount: k,
                sectionClauses,
                writtenTitles,
                // 首块衔接上一小节结尾；续块衔接本节已产出的结尾
                writtenTail: ci === 0 ? writtenTail : `${writtenTail}\n\n${rewriteText}`.slice(-600),
              },
            ),
            longformCallTokens(chunkChars),
            "bid-chapter",
            undefined,
            { disableThinking: shouldDisableThinking(chunkChars) },
          )
          const body = ci === 0 ? sanitizeChapterText(raw) : stripDuplicateSectionHead(sanitizeChapterText(raw), rewriteSecNo, sectionName)
          const t = body.trim()
          if (!t) continue
          rewriteText = rewriteText ? `${rewriteText}\n\n${t}` : t
        }
        const piece = trimToBudget(rewriteText, Math.round(sectionBudget * 1.5)).text.trim()
        if (!piece) throw new Error("小节重写未产出有效内容")
        // 替换第 idx 片后重组正文（其余片字符原样不变）
        const nextPieces = pieces.map((p, i) => (i === sectionIdx ? piece : p))
        const nextContent = rebuildSectionContent(nextPieces)
        const nextStats = stats.map((s, i) => (i === sectionIdx ? { title: sectionName, chars: piece.length } : { ...s }))
        updateChapter(nodeId, { content: nextContent, section_stats: nextStats, gen_status: "done" })
        if (activeChapterId === nodeId) {
          editingContentRef.current = nextContent
          setEditingContentState(nextContent)
        }
        const repaired = applyAutoRepair(nodeId)
        refreshFormatReport()
        // T18+：重写片与既有正文拼接后做一次一致性审计（新片可能与全局事实口径冲突；固定对本章）
        let auditFixed = 0
        try {
          auditFixed = (await runChapterConsistencyAudit(nodeId)).fixed
        } catch (e) {
          if (e instanceof AuthRequiredError) throw e
        }
        toast.success(
          `小节「${sectionName}」已重写：${piece.length} 字 / 目标约 ${sectionBudget} 字，其余小节未改动${repaired ? `，已自动修正 ${repaired} 处格式问题` : ""}${auditFixed ? `，一致性修复 ${auditFixed} 处` : ""}`,
        )
      } catch (e) {
        // 失败不污染 content：仅 toast，正文与统计保持原样
        handleLlmError(e, `小节「${sectionName}」重写失败，正文未改动，请重试`)
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, applyAutoRepair, handleLlmError, outlineClauses, outlineCoverage, refreshFormatReport, runChapterConsistencyAudit, updateChapter, userId],
  )

  const regenerateSection = useCallback(
    (nodeId: string, sectionIdx: number, extraRequirements?: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      // 同章串行生成 / 其他任务进行中禁止小节重写（chapterBusy 复用为并发锁）
      if (chapterBusy) {
        toast.error("正文生成进行中，请等待完成后再重写小节")
        return
      }
      costConfirm.runWithCostConfirm(() => {
        void runRegenerateSection(nodeId, sectionIdx, extraRequirements)
      }, extraRequirements
        ? `将按覆盖审计漏点补写该小节（漏点作为附加写作要求注入，其余小节内容保持不变），费用按一次生成计，${costText()}${skillCostSuffix("bid-chapter")}`
        : `仅重写该小节，其余小节内容保持不变，费用按一次生成计，${costText()}${skillCostSuffix("bid-chapter")}`)
    },
    [blockIfArchived, chapterBusy, costConfirm, requireLogin, runRegenerateSection],
  )

  // ------------------------------ 循环 5 A1：小节级局部扩写 / 缩写 ------------------------------
  /**
   * 复用条级重写的确定性切片替换路径：sliceSectionPieces 切出第 idx 片 →
   * buildSectionResizeMessages 只对给定片段扩写（≈1.5x）/ 缩写（≈0.6x）→
   * sanitize + trimToBudget 净化 → rebuildSectionContent 原位替换 → section_stats 字数刷新。
   * 并发锁复用 chapterBusy（键 `${nodeId}#s${idx}`）；失败 toast 不动原文。
   */
  const runResizeSection = useCallback(
    async (nodeId: string, sectionIdx: number, mode: "expand" | "shrink") => {
      const busyKey = `${nodeId}#s${sectionIdx}`
      const cur = activeProjectRef.current
      if (!cur) return
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      const stats = ch?.section_stats
      if (!ch || !stats?.length || !stats[sectionIdx] || !(ch.content ?? "").trim()) {
        toast.error("本章还没有小节统计，重新生成本章后可扩缩写")
        return
      }
      const sectionName = stats[sectionIdx].title || (ch.sections ?? [])[sectionIdx] || ""
      const pieces = sliceSectionPieces(ch.content, stats)
      const pieceText = (pieces[sectionIdx] ?? "").trim()
      if (!pieceText) {
        toast.error(`小节「${sectionName}」还没有正文，请先重写该小节再扩缩写`)
        return
      }
      const targetChars = Math.max(100, Math.round(pieceText.length * (mode === "expand" ? 1.5 : 0.6)))
      setChapterBusy(busyKey)
      try {
        const raw = await llmGenerate(
          buildSectionResizeMessages(sectionName, pieceText, mode, targetChars),
          MAX_TOKENS_LONGFORM,
          "bid-chapter",
        )
        const piece = trimToBudget(sanitizeChapterText(raw), Math.round(targetChars * 1.3) + 100).text.trim()
        if (!piece) throw new Error(mode === "expand" ? "扩写未产出有效内容" : "缩写未产出有效内容")
        const nextPieces = pieces.map((p, i) => (i === sectionIdx ? piece : p))
        const nextContent = rebuildSectionContent(nextPieces)
        const nextStats = stats.map((s, i) => (i === sectionIdx ? { title: sectionName, chars: piece.length } : { ...s }))
        updateChapter(nodeId, { content: nextContent, section_stats: nextStats, gen_status: "done" })
        if (activeChapterId === nodeId) {
          editingContentRef.current = nextContent
          setEditingContentState(nextContent)
        }
        const repaired = applyAutoRepair(nodeId)
        refreshFormatReport()
        toast.success(
          `小节「${sectionName}」已${mode === "expand" ? "扩写" : "缩写"}：${pieceText.length} 字 → ${piece.length} 字（目标约 ${targetChars} 字），其余小节未改动${repaired ? `，已自动修正 ${repaired} 处格式问题` : ""}`,
        )
      } catch (e) {
        handleLlmError(e, `小节「${sectionName}」${mode === "expand" ? "扩写" : "缩写"}失败，正文未改动，请重试`)
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, applyAutoRepair, handleLlmError, refreshFormatReport, updateChapter],
  )

  const resizeSection = useCallback(
    (nodeId: string, sectionIdx: number, mode: "expand" | "shrink") => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      if (chapterBusy) {
        toast.error("正文生成进行中，请等待完成后再扩缩写小节")
        return
      }
      costConfirm.runWithCostConfirm(
        () => {
          void runResizeSection(nodeId, sectionIdx, mode)
        },
        mode === "expand"
          ? `仅对该小节扩写至约当前篇幅的 1.5 倍（基于已有内容展开、事实口径不变），其余小节内容保持不变，费用按一次生成计，${costText()}${skillCostSuffix("bid-chapter")}`
          : `仅对该小节缩写至约当前篇幅的 6 成（保留硬指标与承诺要点），其余小节内容保持不变，费用按一次生成计，${costText()}${skillCostSuffix("bid-chapter")}`,
      )
    },
    [blockIfArchived, chapterBusy, costConfirm, requireLogin, runResizeSection],
  )

  const runRefineChapter = useCallback(
    async (nodeId: string, kind: "rewrite" | "expand" | "condense") => {
      flushEditingContent()
      const cur = activeProjectRef.current
      if (!cur) return
      const ch = cur.bid_chapters.find((c) => c.node_id === nodeId)
      if (!ch || !ch.content.trim()) {
        toast.error("本章还没有正文，请先生成正文")
        return
      }
      setChapterBusy(nodeId)
      try {
        // 第七轮改造 2：改用投标文件口径的改写 prompt（含全局事实 + 本章评分细则 + 文风硬条款）
        const idx = cur.bid_chapters.findIndex((c) => c.node_id === nodeId)
        const scoringPerChapter = assignScoringToChapters(scoringItemsFromReport(cur.parse_report), cur.bid_chapters)
        // 第八轮改造 2：改写/扩写/精简也注入招标原文相关段（tender_text 为空时静默降级）
        const refineClauses = mapClausesToChapters(outlineClauses, outlineCoverage, cur.bid_chapters)[idx] ?? []
        const text = await llmGenerate(
          buildBidRefineMessages(kind, cur.project_name, cur.hospital, ch.title, idx + 1, ch.content, {
            globalFacts: effectiveGlobalFacts(cur),
            scoring: scoringPerChapter[idx] ?? [],
            tenderFragments: retrieveTenderFragments(cur.tender_text, {
              title: ch.title,
              sections: ch.sections ?? [],
              clauses: refineClauses.map((c) => c.text),
            }),
          }),
          MAX_TOKENS_LONGFORM,
        )
        // 第十轮修复 1/3：改写/扩写/精简输出同样净化；扩写成功后清除「偏短」标记
        const clean = sanitizeChapterText(text)
        updateChapter(nodeId, { content: clean, ...(kind === "expand" ? { underlength: false } : {}) })
        if (activeChapterId === nodeId) {
          editingContentRef.current = clean
          setEditingContentState(clean)
        }
        // 第十一轮改造 4：改写/扩写/精简成功同样留快照
        const kindLabel = kind === "rewrite" ? "改写" : kind === "expand" ? "扩写" : "精简"
        writeStageSnapshot("chapter", `章节${kindLabel}完成：${ch.title}`, { chapter_id: nodeId, title: ch.title, content: clean })
        const repaired = applyAutoRepair(nodeId)
        refreshFormatReport()
        toast.success(repaired ? `章节处理完成，已自动修正 ${repaired} 处格式问题` : "章节处理完成")
      } catch (e) {
        handleLlmError(e, "处理失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, applyAutoRepair, flushEditingContent, handleLlmError, outlineClauses, outlineCoverage, refreshFormatReport, updateChapter, writeStageSnapshot],
  )

  const refineChapter = useCallback(
    (nodeId: string, kind: "rewrite" | "expand" | "condense") => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      costConfirm.runWithCostConfirm(() => {
        void runRefineChapter(nodeId, kind)
      }, `将调用 AI 处理本章正文，${costText()}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runRefineChapter],
  )

  /** 重新生成本章：整章重写覆盖现有正文，配图重新输出（循环 6 A2：fresh=true 显式关闭断点续跑） */
  const regenerateChapter = useCallback(
    (nodeId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      costConfirm.runWithCostConfirm(() => {
        void runGenerateChapter(nodeId, { fresh: true })
      }, `将整章重写并覆盖现有正文与配图，篇幅较大的章节将按小节分段生成，未达篇幅预算将自动续写补足（每章最多 6 轮）；全部章节成稿后会自动做全文总字数校正，费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runGenerateChapter],
  )

  /** 继续生成：现有正文末尾作上下文，从断点续写补足篇幅预算，返回内容追加到末尾 */
  const runContinueChapter = useCallback(
    async (nodeId: string) => {
      // 循环 8 A1：批量生成进行中入口互斥——「继续生成」与批量循环并发写同一章会互相踩踏
      // （runSupplementLoop 为批量内部共用循环不加互斥，其用户入口即本函数与 runGenerateChapter）
      if (bulkGeneratingRef.current) {
        toast.error("批量生成进行中，请先停止批量或等待其完成，再操作单个章节")
        return
      }
      flushEditingContent()
      const cur = activeProjectRef.current
      if (!cur) return
      const idx = cur.bid_chapters.findIndex((c) => c.node_id === nodeId)
      const ch = cur.bid_chapters[idx]
      if (!ch || !ch.content.trim()) {
        toast.error("本章还没有正文，请先生成正文")
        return
      }
      const hadContent = true
      setChapterBusy(nodeId)
      updateChapter(nodeId, { gen_status: "generating" }, { persist: false })
      try {
        const budgets = chapterWordBudgets(cur.bid_chapters, effectiveTargetPages(cur), formatCharsPerPage(cur.format_settings), cur.gen_options?.generate_demo === true)
        const budget = budgets[idx] ?? 1500
        const base = ch.content
        const remain = Math.max(400, budget - base.length)
        const contClauses = mapClausesToChapters(outlineClauses, outlineCoverage, cur.bid_chapters)[idx] ?? []
        // R191：手动续写的缺口与自动补足同源（实测 53849 字）——一次性大目标必撞网关 120s 红线，
        // 表现为「续写失败 / 0 字」。改为分块串行累加、每块落库，用户实时看到篇幅上涨，取消即停在当前块。
        const grown = await generateInChunks(
          remain,
          async (chunkChars, acc) => {
            const ctx = acc ? `${base}\n\n${acc}` : base
            const raw = await llmGenerate(
              buildBidContinueMessages(
                cur.project_name,
                cur.hospital,
                cur.parse_report,
                ch.title,
                idx + 1,
                ctx,
                chunkChars,
                effectiveGlobalFacts(cur),
                {
                  clauses: contClauses,
                  outlineText: outlineToText(cur.bid_outline),
                  scoring: assignScoringToChapters(scoringItemsFromReport(cur.parse_report), cur.bid_chapters)[idx] ?? [],
                  // 第八轮改造 2：手动续写同样注入招标原文相关段
                  tenderFragments: retrieveTenderFragments(cur.tender_text, {
                    title: ch.title,
                    sections: ch.sections ?? [],
                    clauses: contClauses.map((c) => c.text),
                  }),
                },
              ),
              longformCallTokens(chunkChars),
              "bid-chapter",
              undefined,
              { disableThinking: shouldDisableThinking(chunkChars) },
            )
            return sanitizeChapterText(stripOverlap(ctx, raw)).trim()
          },
          {
            shouldStop: () => cancelBulkRef.current,
            onChunk: (acc) => {
              const merged = `${base.trimEnd()}\n\n${acc}`
              // R179：生产端回写 section_stats——续写增量按切片口径并入末节，统计不再陈旧
              const nextStats = reflowStatsAfterAppend(ch.section_stats ?? [], merged)
              updateChapter(nodeId, { content: merged, ...(nextStats ? { section_stats: nextStats } : {}) })
              if (activeChapterId === nodeId) {
                editingContentRef.current = merged
                setEditingContentState(merged)
              }
            },
          },
        )
        const merged = `${base.trimEnd()}\n\n${grown}`
        if (!grown) throw new Error("续写内容为空，请重试或改用「重新生成本章」")
        const nextStats = reflowStatsAfterAppend(ch.section_stats ?? [], merged)
        // 第十轮修复 3：手动续写达预算 60% 以上时清除「偏短」标记
        updateChapter(nodeId, {
          content: merged,
          gen_status: "done",
          ...(nextStats ? { section_stats: nextStats } : {}),
          ...(merged.length >= budget * 0.6 ? { underlength: false } : {}),
        })
        if (activeChapterId === nodeId) {
          editingContentRef.current = merged
          setEditingContentState(merged)
        }
        writeStageSnapshot("chapter", `章节续写完成：${ch.title}`, { chapter_id: nodeId, title: ch.title, content: merged })
        const repaired = applyAutoRepair(nodeId)
        refreshFormatReport()
        // R191：如实汇报本轮产出与剩余缺口（不把「没补上」包装成让用户自己找入口）
        const stillShort = Math.max(0, budget - merged.length)
        toast.success(
          `续写完成，本章新增约 ${grown.length} 字（现 ${merged.length} 字 / 预算 ${budget} 字）${
            stillShort > 0 ? `，仍差约 ${stillShort} 字，可再点一次「继续生成」` : "，篇幅已达预算"
          }${repaired ? `，已自动修正 ${repaired} 处格式问题` : ""}`,
        )
      } catch (e) {
        updateChapter(nodeId, { gen_status: hadContent ? "done" : "failed" })
        handleLlmError(e, "续写失败，请重试")
      } finally {
        setChapterBusy(null)
      }
    },
    [activeChapterId, applyAutoRepair, flushEditingContent, handleLlmError, outlineClauses, outlineCoverage, refreshFormatReport, targetPages, updateChapter, writeStageSnapshot],
  )

  const continueChapter = useCallback(
    (nodeId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      // R171：小节级章节仍有未生成小节（section_stats 未覆盖全部小节）时，「继续生成」走小节断点续跑
      // （runGenerateChapter 非 fresh：复位取消标志 + resumeFrom 跳过已产出小节 + 补足剩余小节），
      // 而非整章 blob 续写——后者只往现有正文追加、不产出缺失的具名小节，且把 section_stats 留在陈旧态、
      // 再次误标 done。全部小节均已生成、仅总长未达预算的章（hasPendingSections=false）仍走原续写补足。
      const ch = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === nodeId)
      if (hasPendingSections(ch)) {
        costConfirm.runWithCostConfirm(() => {
          void runGenerateChapter(nodeId)
        }, `本章尚有未生成的小节，将从断点续跑补足剩余小节（已生成小节不重复付费），未达篇幅预算再自动续写补足，${costText()}${skillCostSuffix("bid-chapter")}`)
        return
      }
      costConfirm.runWithCostConfirm(() => {
        void runContinueChapter(nodeId)
      }, `将从本章正文断点续写补足篇幅预算，${costText()}${skillCostSuffix("bid-chapter")}`)
    },
    [blockIfArchived, costConfirm, requireLogin, runContinueChapter, runGenerateChapter],
  )

  const runBulkGenerate = useCallback(async () => {
    const startRec = activeProjectRef.current
    if (!startRec) return
    cancelBulkRef.current = false
    bulkGeneratingRef.current = true
    setBulkGenerating(true)
    // R206 切片 1（R-002）：批量迭代按内容范围三模式（both/tech 只跑技术章、biz 只跑商务章）
    const bulkScope = normalizeBidScope(startRec.gen_options)
    const techIdx = startRec.bid_chapters.map((c, i) => ({ c, i })).filter((x) => isGenTargetChapter(x.c, bulkScope, startRec.gen_options?.generate_demo === true)).map((x) => x.i)
    const total = techIdx.length
    setGenProgress({ current: 0, total })
    let failedCount = 0
    let autoRepairedChapters = 0
    // T15：批量精调/一致性修补计数（收尾统一汇报，避免逐章 toast 刷屏）
    let bulkRefinedCount = 0
    let bulkAuditFixed = 0
    // 生成链路 D2：章间并发 2 的 worker 池（原纯串行 for 在 12 章×小节串行+续写下整本时长以小时计，
    // 是「从未完整生成过一份标书」的直接主因）；章内小节仍串行（衔接依赖前文）；
    // updateChapter 同步读 ref 最新快照、按 node_id patch，并发写不同章互不覆盖
    const BULK_CONCURRENCY = 2
    const cursor = { k: 0, done: 0 }
    const touchedNodes: string[] = []
    // R124：登记批量中失败的技术章（node_id/索引/标题/真实原因），供收口前自动补重试与原因上屏
    const failedNodes: { nodeId: string; idx: number; title: string; reason: string }[] = []
    const bulkWorker = async (): Promise<void> => {
      for (;;) {
        if (cancelBulkRef.current) return
        const k = cursor.k++
        if (k >= techIdx.length) return
        const cur = activeProjectRef.current
        if (!cur) return
        const i = techIdx[k]
        const ch = cur.bid_chapters[i]
        // 循环 8 A1：skip 条件扩为 done || generating——手动路径正在生成的章（gen_status="generating"）
        // 留给手动收尾，批量不碰，杜绝同章双写
        // R170：被历史中断误标 done、但小节未生成完整的章（section_stats 未覆盖全部小节）不跳过，纳入重跑续补
        if (!ch || (ch.gen_status === "done" && !isIncompleteSectionChapter(ch)) || ch.gen_status === "generating") {
          cursor.done += 1
          setGenProgress({ current: cursor.done, total })
          continue
        }
        cursor.done += 1
        setGenProgress({ current: cursor.done, total })
        updateChapter(ch.node_id, { gen_status: "generating" }, { persist: false })
        try {
          // 第八轮改造 2/3：批量与单章共用生成器（小节级分叉 + 招标原文片段注入在 generateChapterContent 内）
          const out = await generateChapterContent(ch.node_id, i)
        // 循环 7 A1 + 循环 8 A2 保底：产出为空串一律不标 done（与单章入口同口径），
        // prevContent 为空的全新生成同样置 failed，杜绝空章被后续批量/补齐按 done 永久跳过
        if (!out.content.trim()) {
          failedCount += 1
          updateChapter(ch.node_id, { gen_status: "failed" })
          failedNodes.push({ nodeId: ch.node_id, idx: i, title: ch.title, reason: "模型空产出" })
          continue
        }
        if (out.cancelledMid) {
          failedCount += 1
          updateChapter(ch.node_id, { content: out.content, gen_status: "failed", figures: out.figures, section_stats: out.sectionStats ?? [] })
          failedNodes.push({ nodeId: ch.node_id, idx: i, title: ch.title, reason: "已中断（可断点续跑）" })
          continue
        }
        updateChapter(ch.node_id, { content: out.content, gen_status: sectionGenStatus({ cancelledMid: !!out.cancelledMid }), figures: out.figures, section_stats: out.sectionStats ?? [] })
        if (activeChapterId === ch.node_id) {
          editingContentRef.current = out.content
          setEditingContentState(out.content)
        }
        // 改造 1：批量同样逐章自动补足篇幅（入口一次费用确认覆盖整个循环）
        if (!cancelBulkRef.current) await runSupplementLoop(ch.node_id, i + 1, out.budget)
        // 第十轮修复 3：每章补足完成后做章级预算治理（超写裁剪 / 偏短标记）
        if (!cancelBulkRef.current) applyBudgetGovernance(ch.node_id, out.budget)
        // 第十一轮改造 4：批量生成每章成稿后同样留快照
        const bulkCh = activeProjectRef.current?.bid_chapters.find((c) => c.node_id === ch.node_id)
        if (bulkCh?.content?.trim()) {
          writeStageSnapshot("chapter", `章节正文生成：${ch.title}`, {
            chapter_id: ch.node_id,
            title: ch.title,
            content: bulkCh.content,
          })
        }
        // R32 批次2：批量每章成稿后同样做确定性自动修复（零费用），修复动作计入收尾汇报
        if (!cancelBulkRef.current && applyAutoRepair(ch.node_id)) autoRepairedChapters += 1
          touchedNodes.push(ch.node_id)
        } catch (e) {
          setSectionGenState(null)
          failedCount += 1
          updateChapter(ch.node_id, { gen_status: "failed" })
          failedNodes.push({ nodeId: ch.node_id, idx: i, title: ch.title, reason: (e instanceof Error ? e.message : String(e)).slice(0, 60) || "生成异常" })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, techIdx.length) }, () => bulkWorker()))
    // 生成链路 F1（R124）：偶发空返回/瞬时异常是「从未完整生成过一份标书」的直接主因（单章重试可复现成功），
    // 故收口前对失败技术章串行补跑一次：成功即转 done 并从失败计数扣减；仍失败则保留真实原因，toast 明示逐章重试
    if (!cancelBulkRef.current && failedNodes.length) {
      const retryTargets = failedNodes.splice(0, failedNodes.length)
      for (const rt of retryTargets) {
        if (cancelBulkRef.current) break
        const rc = activeProjectRef.current?.bid_chapters[rt.idx]
        if (!rc || isBizPart(rc)) continue
        updateChapter(rt.nodeId, { gen_status: "generating" }, { persist: false })
        try {
          const rout = await generateChapterContent(rt.nodeId, rt.idx)
          if (!rout.content.trim()) {
            failedNodes.push({ nodeId: rt.nodeId, idx: rt.idx, title: rt.title, reason: "重试后仍空产出" })
            continue
          }
          if (rout.cancelledMid) {
            updateChapter(rt.nodeId, { content: rout.content, gen_status: "failed", figures: rout.figures, section_stats: rout.sectionStats ?? [] })
            failedNodes.push({ nodeId: rt.nodeId, idx: rt.idx, title: rt.title, reason: "重试中被中断（可断点续跑）" })
            continue
          }
          updateChapter(rt.nodeId, { content: rout.content, gen_status: sectionGenStatus({ cancelledMid: !!rout.cancelledMid }), figures: rout.figures, section_stats: rout.sectionStats ?? [] })
          failedCount = Math.max(0, failedCount - 1)
          if (!cancelBulkRef.current) await runSupplementLoop(rt.nodeId, rt.idx + 1, rout.budget)
          if (!cancelBulkRef.current) applyBudgetGovernance(rt.nodeId, rout.budget)
          touchedNodes.push(rt.nodeId)
        } catch (e) {
          failedNodes.push({ nodeId: rt.nodeId, idx: rt.idx, title: rt.title, reason: (e instanceof Error ? e.message : String(e)).slice(0, 60) || "重试异常" })
        }
      }
      if (failedNodes.length) {
        toast.warning(`${failedNodes.length} 章自动重试后仍失败：${failedNodes.map((f) => `${f.title.slice(0, 10)}（${f.reason}）`).join("、")}，可到「生成总览」逐章重试`)
      } else {
        toast.success("批量中失败的章节已自动重试补齐")
      }
    }
    // 生成链路 D3：字数精调/一致性审计从逐章内联改为「校正之后」统一后置——
    // 先补齐体量再局部精调，避免「精调削短→校正又续写」来回拉扯；对并发生成过的章逐一执行
    if (!cancelBulkRef.current) {
      for (const nodeId of touchedNodes) {
        if (cancelBulkRef.current) break
        const cur2 = activeProjectRef.current
        const ch2 = cur2?.bid_chapters.find((c) => c.node_id === nodeId)
        if (!cur2 || !ch2 || !(ch2.content ?? "").trim()) continue
        if (cur2.gen_options?.word_refine !== false) {
          try {
            bulkRefinedCount += (await runWordRefineChapter(nodeId)).adjusted
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
          }
        }
        if (!cancelBulkRef.current && cur2.gen_options?.auto_consistency_audit !== false) {
          try {
            bulkAuditFixed += (await runChapterConsistencyAudit(nodeId)).fixed
          } catch (e) {
            if (e instanceof AuthRequiredError) throw e
          }
        }
      }
    }
    // 第五轮改造 3：全文总字数校正阶段（缺口 >10% 时按缺口最大章优先串行续写）
    let adjustRounds = 0
    if (!cancelBulkRef.current) adjustRounds = await runTotalWordAdjust()
    // 第十一轮改造 2：批量生成收口后做总量治理（超出硬上限自动裁剪收敛）
    if (!cancelBulkRef.current) governTotalPages()
    // 生成链路 D1：正常跑完/主动停止都清队列；刷新与换页中断（本函数不再执行）时队列保留，供恢复横幅续跑
    if (startRec.id) bulkQueueClear(startRec.id)
    // R32 批次2：批量生成完成后先汇报确定性自动修复成果，再本地体检回显剩余需人工项（零费用、不阻断）
    if (!cancelBulkRef.current) {
      const rep = refreshFormatReport()
      const warnN = rep?.hits.filter((h) => h.level === "warn").length ?? 0
      if (autoRepairedChapters)
        toast.success(`批量生成完成：已对 ${autoRepairedChapters} 章做确定性自动修复（装饰/元话语/参数加码，零费用）`)
      if (bulkRefinedCount) toast.info(`批量字数精调：共 ${bulkRefinedCount} 处局部增删（向各章预算收敛）`)
      if (bulkAuditFixed) toast.warning(`批量一致性核对：已自动修复 ${bulkAuditFixed} 处与全局事实口径不一致的表述，建议到「事实一致性核对」复检`)
      if (warnN)
        toast.warning(`本地体检（零费用）共发现 ${warnN} 处提示（数值/指标口径等需人工判断项），可到「交卷体检」查看明细，不影响当前成果`)
    }
    bulkGeneratingRef.current = false
    setBulkGenerating(false)
    setGenProgress({ current: 0, total: 0 })
    // 改造 1 + 第五轮改造 3 + 第十三轮改造 4：批量结束汇报只按技术章统计总字数 / 折算总页数 / 达标章节数 / 达标率 / 校正轮数
    const finalRec = activeProjectRef.current
    let summary = ""
    if (finalRec) {
      const pages = effectiveTargetPages(finalRec)
      const cpp = formatCharsPerPage(finalRec.format_settings)
      const budgets = chapterWordBudgets(finalRec.bid_chapters, pages, cpp, finalRec.gen_options?.generate_demo === true)
      const techFinal = techChapters(finalRec.bid_chapters)
      const totalChars = techFinal.reduce((s, c) => s + (c.content?.length ?? 0), 0)
      const targetTotal = pages * cpp
      const reachedCount = finalRec.bid_chapters.filter(
        (c, i) => !isBizPart(c) && (c.content?.length ?? 0) >= (budgets[i] ?? 1500) * SUPPLEMENT_TARGET_RATIO,
      ).length
      const reachedRatio = Math.round((totalChars / Math.max(1, targetTotal)) * 100)
      summary = `技术部分共 ${totalChars} 字，约 ${Math.max(1, Math.round(totalChars / cpp))} 页，目标 ${targetTotal} 字（达标率 ${reachedRatio}%），篇幅达标章节 ${reachedCount}/${techFinal.length}${adjustRounds ? `，全文校正续写 ${adjustRounds} 轮` : ""}`
    }
    // 切片C：批量完成后页数缺口告警——若实际字数不足目标的 85%，明确提示用户可用的补全手段
    if (!cancelBulkRef.current && !failedCount && finalRec) {
      const gapPages = effectiveTargetPages(finalRec) - Math.round(
        techChapters(finalRec.bid_chapters).reduce((s, c) => s + (c.content?.length ?? 0), 0) / formatCharsPerPage(finalRec.format_settings),
      )
      if (gapPages > 2) {
        toast.warning(`生成完成但总页数仍差约 ${gapPages} 页（不足目标 85%），可用「一键补齐」或逐章「继续生成」补足`)
      }
    }
    if (cancelBulkRef.current) toast.info(`已暂停，可继续生成剩余技术章节${summary ? `；${summary}` : ""}`)
    else if (failedCount) toast.error(`生成结束，${failedCount} 个技术章节失败，可单独重试；${summary}`)
    else toast.success(`全部技术章节正文生成完毕；${summary}`)
  }, [activeChapterId, applyAutoRepair, applyBudgetGovernance, generateChapterContent, governTotalPages, refreshFormatReport, runChapterConsistencyAudit, runSupplementLoop, runTotalWordAdjust, runWordRefineChapter, updateChapter, writeStageSnapshot])

  const startBulkGenerate = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    const cur = activeProjectRef.current
    if (!cur) return
    // R206 切片 1（R-002）：待生成计数按内容范围三模式（both/tech 只算技术章、biz 只算商务章）
    const bulkScope = normalizeBidScope(cur.gen_options)
    const partLabel = bulkScope === "biz" ? "商务章节" : "技术章节"
    const pending = cur.bid_chapters.filter((c) => isGenTargetChapter(c, bulkScope, cur.gen_options?.generate_demo === true) && c.gen_status !== "done").length
    if (!pending) {
      toast.info(`全部${partLabel}已生成完毕`)
      if (cur.id) bulkQueueClear(cur.id)
      return
    }
    // 生成链路 D1：任务队列落 localStorage（刷新/换页后可恢复；正常结束与手动停止均清除）
    if (cur.id) bulkQueueSave(cur.id, cur.bid_chapters.filter((c) => isGenTargetChapter(c, bulkScope, cur.gen_options?.generate_demo === true) && c.gen_status !== "done").map((c) => c.node_id))
    costConfirm.runWithCostConfirm(() => {
      void runBulkGenerate()
    }, `将逐章生成 ${pending} 个${partLabel}的投标正文，篇幅较大的章节将按小节分段生成，未达篇幅预算的章节将自动续写补足（每章最多 6 轮）；成稿后自动做字数精调与事实一致性核对（可在生成设置关闭），生成结束后若技术部分总字数缺口超过 10%，将按缺口最大章优先自动校正续写，费用按实际用量累加，${costText()}${skillCostSuffix("bid-chapter")}`)
  }, [blockIfArchived, costConfirm, requireLogin, runBulkGenerate])

  const cancelBulkGenerate = useCallback(() => {
    cancelBulkRef.current = true
  }, [])

  // 第十三轮改造 4：done 进度只算技术章（商务骨架章无正文、不计入完成数）
  // R175：分子只算「真正完成」的章（done 且小节已补齐）——done 但小节残缺的历史虚标章不再计入，
  // 杜绝总览「完成 1/1」与实际「才几页」矛盾；残缺章改在总览以「待补小节」单列（见 ComposeStep）。
  const doneChapterCount = useMemo(
    () => activeProject?.bid_chapters.filter((c) => isGenTargetChapter(c, normalizeBidScope(activeProject?.gen_options), activeProject?.gen_options?.generate_demo === true) && isTrulyDoneChapter(c)).length ?? 0,
    [activeProject],
  )
  const techChapterTotal = useMemo(
    () => activeProject?.bid_chapters.filter((c) => isGenTargetChapter(c, normalizeBidScope(activeProject?.gen_options), activeProject?.gen_options?.generate_demo === true)).length ?? 0,
    [activeProject],
  )

  // 改造 1：各章字数预算（UI 显示「本章 X 字 / 预算 Y 字 · 约 Z 页」）；第十一轮改造 2：预算按有效目标页数
  const chapterBudgets = useMemo(() => {
    if (!activeProject?.bid_chapters.length) return [] as number[]
    return chapterWordBudgets(activeProject.bid_chapters, effectiveTargetPages(activeProject), formatCharsPerPage(activeProject.format_settings), activeProject.gen_options?.generate_demo === true)
  }, [activeProject])

  // ------------------------------ 改造 4：技术偏离表（条款拆分 + AI 响应映射） ------------------------------
  const [mapLoading, setMapLoading] = useState(false)
  // 拆分维度 clauseGranularity 已持久化（第五轮改造 1），派生值见上方设置区

  const deviationTable: DeviationTable | null = activeProject?.response_map ?? null
  const deviationSummary = useMemo(() => deviationStats(deviationTable), [deviationTable])
  const deviationClauseCount = useMemo(() => {
    const rep = activeProject?.parse_report ?? null
    if (!rep) return 0
    return extractRequirementClauses(rep, { limit: 200, granularity: clauseGranularity }).length
  }, [activeProject?.parse_report, clauseGranularity])

  // R-022 技术参数落点：第五章全部技术和服务要求参数逐条核对（进偏离表/建节点=已覆盖，零 AI）
  const techParamCoverage = useMemo(
    () => buildTechParamCoverage(coverageNodes, activeProject?.parse_report ?? null, deviationTable),
    [coverageNodes, activeProject?.parse_report, deviationTable],
  )

  /** R-022 一键补入：把未覆盖技术参数插入大纲技术章下（无匹配新建章），重新生成正文即落实响应 */
  const addUncoveredTechParamsToOutline = useCallback(() => {
    if (blockIfArchived()) return
    const base = outlineDraft.length ? outlineDraft : activeProject?.bid_outline ?? []
    if (!base.length) {
      toast.error('大纲为空，请先生成大纲再补入技术参数')
      return
    }
    const missing = techParamCoverage.uncoveredRows
    if (!missing.length) {
      toast.success('技术参数已全部有落点，无需补入')
      return
    }
    let next = base
    for (const r of missing) next = insertClauseIntoOutline(next, { id: r.id, text: r.text, source: r.source })
    setOutlineDraft(next)
    updateProject({ bid_outline: next })
    toast.success(`已把 ${missing.length} 条未覆盖技术参数补入大纲，重新生成对应章节正文即可落实响应`)
  }, [activeProject?.bid_outline, blockIfArchived, outlineDraft, techParamCoverage, updateProject])

  const runDeviationTable = useCallback(async () => {
    flushEditingContent()
    const cur = activeProjectRef.current
    if (!cur) return
    const clauses = extractRequirementClauses(cur.parse_report, { limit: 200, granularity: clauseGranularity })
    if (!clauses.length) {
      toast.error("没有从解析报告抽取到招标技术条款，请先回到解析环节完成「交货和服务要求 / 技术评分要求 / 响应文件要求」解析")
      return
    }
    if (!cur.bid_chapters.some((c) => c.content.trim())) {
      toast.error("投标文件还没有正文，请先生成或编写章节内容再做偏离表")
      return
    }
    setMapLoading(true)
    try {
      const raw = await llmGenerate(
        buildDeviationMapMessages(clauses, cur.bid_outline, cur.bid_chapters, effectiveGlobalFacts(cur)),
        MAX_TOKENS_LONGFORM,
        "bid-deviation",
      )
      const rows = sanitizeDeviationRows(extractJsonLoose(raw), clauses)
      if (!rows.length) throw new Error("偏离表解析失败，请重试")
      const table: DeviationTable = { split_dim: clauseGranularity, rows, generated_at: new Date().toISOString() }
      updateProject({ response_map: table })
      const st = deviationStats(table)
      toast.success(`技术偏离表已生成：共 ${st.total} 条，完全响应 ${st.full}、部分响应 ${st.partial}、偏离 ${st.deviation}`)
    } catch (e) {
      handleLlmError(e, "偏离表生成失败，请重试")
    } finally {
      setMapLoading(false)
    }
  }, [clauseGranularity, flushEditingContent, handleLlmError, updateProject])

  const generateDeviationTable = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读
    costConfirm.runWithCostConfirm(() => {
      void runDeviationTable()
    }, `将按所选维度（${CLAUSE_GRANULARITY_LABEL[clauseGranularity]}）拆分招标技术条款并生成技术偏离表（约 ${deviationClauseCount} 条），${costText()}${skillCostSuffix("bid-deviation")}`)
  }, [blockIfArchived, clauseGranularity, costConfirm, deviationClauseCount, requireLogin, runDeviationTable])

  // ------------------------------ 循环 5 A2：覆盖审计与补写 ------------------------------
  /**
   * 覆盖审计：把每个技术叶（标题+写作焦点+必守事实+表格计划+正文前 800 字采样）一次性发给 LLM，
   * 输出逐节 covered(full/partial/missing/over) + missing_points + suggestion；解析走既有
   * withJsonRepair（本地解析失败自动修复一次）。仅会话内 state，不落库（零 collection 变更）。
   */
  const [coverageAudit, setCoverageAudit] = useState<CoverageAuditEntry[] | null>(null)
  const [coverageAuditBusy, setCoverageAuditBusy] = useState(false)

  const runCoverageAudit = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const refs = collectTechLeafRefs(cur.bid_outline)
    if (!refs.length) {
      toast.error("还没有确认的技术章大纲，请先完成大纲确认")
      return
    }
    const chapterById = new Map(cur.bid_chapters.map((c) => [c.node_id, c]))
    const inputs: CoverageAuditLeafInput[] = []
    for (const ref of refs) {
      const resolved = resolveLeafSection(cur.bid_outline, ref.nodeId)
      const ch = resolved ? chapterById.get(resolved.chapterId) : undefined
      const leaf = cur.orchestration?.leaves[ref.nodeId]
      inputs.push({
        leaf_id: ref.nodeId,
        title: ref.title,
        chapter: ref.chapter,
        writing_focus: leaf?.writing_focus ?? "",
        facts: leaf?.facts ?? [],
        table_plan: leaf?.table?.needed ? leaf.table.purpose : "",
        body_excerpt: auditLeafExcerpt(ch, resolved?.sectionTitle ?? ""),
      })
    }
    if (!inputs.some((it) => it.body_excerpt.trim())) {
      toast.error("正文尚未生成，请先完成章节正文生成再做覆盖审计")
      return
    }
    setCoverageAuditBusy(true)
    try {
      const raw = await llmGenerate(buildCoverageAuditMessages(inputs), MAX_TOKENS_LONGFORM)
      const entries = await withJsonRepair(raw, (t) => sanitizeCoverageAudit(t, inputs))
      if (!entries.length) throw new Error("覆盖审计没有解析出有效结果，请重试")
      setCoverageAudit(entries)
      const full = entries.filter((e) => e.covered === "full").length
      const partial = entries.filter((e) => e.covered === "partial").length
      const missing = entries.filter((e) => e.covered === "missing").length
      const over = entries.filter((e) => e.covered === "over").length
      toast.success(`覆盖审计完成：共 ${entries.length} 个技术节，全部落实 ${full}、部分落实 ${partial}、未落实 ${missing}、过度承诺 ${over}`)
    } catch (e) {
      handleLlmError(e, "覆盖审计失败，请重试")
    } finally {
      setCoverageAuditBusy(false)
    }
  }, [handleLlmError])

  const startCoverageAudit = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 5 A3：归档只读（审计不写正文，但补写入口在本卡内，统一锁）
    if (!activeProjectRef.current) {
      toast.error("请先打开一个标书项目再做覆盖审计")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void runCoverageAudit()
    }, `AI 将逐节核对写作方案（写作焦点、必守事实、表格计划）是否在正文中落实，输出逐节覆盖报告、漏点与过度承诺（加码）清单（一次调用，正文按节采样截断控制费用；格式异常时自动修复一次），${costText()}`)
  }, [blockIfArchived, costConfirm, requireLogin, runCoverageAudit])

  /**
   * 补写（最小实现）：把该叶的 missing_points + suggestion 拼成附加写作要求，
   * 经 resolveLeafSection 定位到（章, 小节）后复用条级重写通道 regenerateSection（自带费用确认）；
   * 章自身即叶或定位失败时提示回编制环节整章处理。
   */
  const supplementFromAudit = useCallback(
    (leafId: string) => {
      const cur = activeProjectRef.current
      const entry = coverageAudit?.find((e) => e.leaf_id === leafId)
      if (!cur || !entry) return
      if (entry.covered === "full") {
        toast.info("该节已全部落实写作方案，无需补写")
        return
      }
      const resolved = resolveLeafSection(cur.bid_outline, leafId)
      if (!resolved || !resolved.sectionTitle) {
        toast.info("该节对应整章内容，请回「③ 投标文件编制」对该章整章重新生成或继续生成")
        return
      }
      const ch = cur.bid_chapters.find((c) => c.node_id === resolved.chapterId)
      const sectionIdx = (ch?.sections ?? []).findIndex((s) => s.trim() === resolved.sectionTitle.trim())
      if (!ch || sectionIdx < 0) {
        toast.info("未能在章节清单中定位该小节，请回「③ 投标文件编制」整章处理")
        return
      }
      // R103 口径统一：指令文案收敛到 coverageAudit.buildReflowDirective 单一来源（与按章聚合回注共用），行为等价
      const directive = buildReflowDirective(entry.covered, entry.missing_points, entry.suggestion) || undefined
      regenerateSection(resolved.chapterId, sectionIdx, directive)
    },
    [coverageAudit, regenerateSection],
  )

  /**
   * R103 按章聚合回注：把顶层章下全部问题叶的审计建议聚合，一次费用确认后按小节串行重写
   * （指令口径与单叶补写同源 buildReflowDirective，复用 runRegenerateSection 通道）；
   * 整章级叶无法小节回注，确认文案与完成提示均指引回③整章处理。
   * 会话级行为：零 collection、零提示词文本改动（PROMPT_VERSION 不动）。
   */
  const [chapterReflowBusy, setChapterReflowBusy] = useState<string | null>(null)

  const runChapterReflow = useCallback(
    async (chapterId: string) => {
      const cur = activeProjectRef.current
      if (!cur || !coverageAudit) return
      const group = aggregateAuditByChapter(coverageAudit, cur.bid_outline).find((g) => g.chapterId === chapterId)
      if (!group) return
      const chapter = cur.bid_chapters.find((c) => c.node_id === chapterId)
      const targets = collectReflowFixItems(group, cur.bid_outline, chapter)
      if (!targets.length) {
        toast.info(`章「${group.chapterTitle}」的问题节点均为整章级内容，请回「③ 投标文件编制」整章重新生成或精修`)
        return
      }
      setChapterReflowBusy(chapterId)
      try {
        for (const t of targets) {
          if (!activeProjectRef.current) break
          await runRegenerateSection(chapterId, t.sectionIdx, t.directive)
        }
        const skipped = group.problemCount - targets.length
        toast.success(
          `章「${group.chapterTitle}」按章回注执行完毕：${targets.length} 个问题小节已逐条重写（结果见各节提示）${skipped > 0 ? `；${skipped} 个整章级节点请回「③ 投标文件编制」整章处理` : ""}`,
        )
      } finally {
        setChapterReflowBusy(null)
      }
    },
    [coverageAudit, runRegenerateSection],
  )

  const reflowChapterFromAudit = useCallback(
    (chapterId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 5 A3：归档只读
      if (chapterBusy || chapterReflowBusy) {
        toast.error("正文生成或按章回注进行中，请等待完成后再操作")
        return
      }
      const cur = activeProjectRef.current
      if (!cur || !coverageAudit) return
      const group = aggregateAuditByChapter(coverageAudit, cur.bid_outline).find((g) => g.chapterId === chapterId)
      if (!group) return
      const chapter = cur.bid_chapters.find((c) => c.node_id === chapterId)
      const targets = collectReflowFixItems(group, cur.bid_outline, chapter)
      if (!targets.length) {
        toast.info(`章「${group.chapterTitle}」的问题节点均为整章级内容，请回「③ 投标文件编制」整章处理`)
        return
      }
      const skipped = group.problemCount - targets.length
      costConfirm.runWithCostConfirm(
        () => {
          void runChapterReflow(chapterId)
        },
        `将按覆盖审计建议依次重写章「${group.chapterTitle}」的 ${targets.length} 个问题小节（漏点/过度承诺收敛要求注入对应小节重写，其余小节保持不动${skipped > 0 ? `；${skipped} 个整章级节点不包含，请回「③ 投标文件编制」整章处理` : ""}），费用按 ${targets.length} 次生成合计计，${costText()}${skillCostSuffix("bid-chapter")}`,
      )
    },
    [blockIfArchived, chapterBusy, chapterReflowBusy, costConfirm, coverageAudit, requireLogin, runChapterReflow],
  )


  /**
   * r287（bid-l2-verbatim-compare 切片2·整改）：引文改写一键整改回注——把体检 quote_rewrite
   * 命中定位到（章, 小节）（quoteRewriteFixTargets 本地重算零 AI），串行注入整改指令走小节
   * 重写通道（复用 runRegenerateSection，一次费用确认），重写完成由既有 refreshFormatReport
   * 自动刷新体检；缺小节统计的章无法小节回注，提示回③整章处理。零 collection、零提示词文本
   * 改动（指令属运行时附加写作要求，同 R103 回注口径）。
   */
  const [quoteFixBusy, setQuoteFixBusy] = useState(false)

  const runQuoteRewriteFix = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const groups = quoteRewriteFixTargets(cur.tender_text ?? "", cur.bid_chapters)
    const jobs = groups.flatMap((g) => g.items.map((it) => ({ nodeId: g.chapterId, sectionIdx: it.sectionIdx, directive: buildQuoteFixDirective(it.quotes) })))
    if (!jobs.length) return
    setQuoteFixBusy(true)
    let done = 0
    try {
      for (const j of jobs) {
        if (!activeProjectRef.current) break
        await runRegenerateSection(j.nodeId, j.sectionIdx, j.directive)
        done += 1
      }
      if (done) toast.success(`引文改写整改完成：${done} 个小节已按招标原文重写引语（体检刷新后可复核余量）`)
    } finally {
      setQuoteFixBusy(false)
    }
  }, [runRegenerateSection])

  const startQuoteRewriteFix = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 归档只读（整改回注写正文）
    if (chapterBusy || chapterReflowBusy || quoteFixBusy) {
      toast.error("正文生成或整改回注进行中，请等待完成后再操作")
      return
    }
    const cur = activeProjectRef.current
    if (!cur) return
    const groups = quoteRewriteFixTargets(cur.tender_text ?? "", cur.bid_chapters)
    const sections = groups.reduce((n, g) => n + g.items.length, 0)
    if (!sections) {
      toast.info("没有可在小节级整改的引文改写命中（章缺少小节统计时请回「③ 投标文件编制」整章处理）")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runQuoteRewriteFix()
      },
      `将把体检发现的引文改写命中逐条回注整改：共 ${sections} 个小节（只最小修正疑改写引语及其所在句，其余内容保持不变；缺小节统计的章不包含，单轮封顶 12 小节），费用按 ${sections} 次生成合计计，${costText()}${skillCostSuffix("bid-chapter")}`,
    )
  }, [blockIfArchived, chapterBusy, chapterReflowBusy, costConfirm, quoteFixBusy, requireLogin, runQuoteRewriteFix])

  // ------------------------------ ④ 标书查重 ------------------------------
  const [dupLoading, setDupLoading] = useState(false)

  const runDupJudge = useCallback(
    async (pairs: DupPair[], scannedProjects: number, intraPairs: IntraDupPair[]) => {
      const cur = activeProjectRef.current
      if (!cur) return
      setDupLoading(true)
      try {
        let judged = pairs
        if (pairs.length) {
          const raw = await llmGenerate(buildDupJudgeMessages(pairs), MAX_TOKENS_OUTLINE)
          const rec = extractJsonLoose(raw) as Record<string, unknown>
          const results = Array.isArray(rec?.results) ? (rec.results as Record<string, unknown>[]) : []
          judged = pairs.map((pair, i) => {
            const hit = results.find((r) => Number(r?.index) === i + 1) ?? results[i]
            const verdictRaw = String(hit?.ai_verdict ?? "")
            const verdict = verdictRaw === "high" || verdictRaw === "medium" || verdictRaw === "low" ? verdictRaw : ""
            return { ...pair, ai_verdict: verdict as DupPair["ai_verdict"], ai_note: String(hit?.ai_note ?? "") }
          })
        }
        const report: DupReport = {
          pairs: judged,
          scanned_projects: scannedProjects,
          suspect_count: judged.length,
          checked_at: new Date().toISOString(),
          intra_pairs: intraPairs,
        }
        updateProject({ dup_report: report })
        writeStageSnapshot("check", "标书查重完成", { dup_report: report })
        setActiveStep(4)
        const intraNote = intraPairs.length ? `；本标书章间互查发现 ${intraPairs.length} 处重复段落` : ""
        if (judged.length) toast.success(`查重完成：${judged.length} 处可疑段落已交 AI 复判${intraNote}`)
        else toast.success(`查重完成：未发现明显相似段落${intraNote}`)
      } catch (e) {
        handleLlmError(e, "查重失败，请重试")
      } finally {
        setDupLoading(false)
      }
    },
    [handleLlmError, updateProject, writeStageSnapshot],
  )

  const runDupCheck = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——查重会写 dup_report
    flushEditingContent()
    const cur = activeProjectRef.current
    if (!cur) return
    const targets = cur.bid_chapters
      .filter((c) => c.content.trim())
      .map((c) => ({ nodeId: c.node_id, chapter: c.title, text: c.content }))
    if (!targets.length) {
      toast.error("投标文件还没有正文，请先完成编制再查重")
      return
    }
    // 第七轮改造 4：本标书章间互查（零 AI、零费用确认），无历史项目时也照常执行
    // 循环 7 A4：阈值可调（随项目持久化于 gen_options.intra_dup_threshold，缺省 0.35）
    const intraPairs = findIntraDupPairs(targets, intraDupThreshold)
    const others = projects.filter((p) => p.id !== cur.id && (p.bid_chapters ?? []).some((c) => c.content?.trim()))
    if (!others.length) {
      const report: DupReport = {
        pairs: [],
        scanned_projects: 0,
        suspect_count: 0,
        checked_at: new Date().toISOString(),
        intra_pairs: intraPairs,
      }
      updateProject({ dup_report: report })
      writeStageSnapshot("check", "章间互查完成", { dup_report: report })
      setActiveStep(4)
      toast.info(
        intraPairs.length
          ? `还没有可对比的历史投标项目，已完成本标书章间互查：发现 ${intraPairs.length} 处章间重复段落`
          : "还没有可对比的历史投标项目，已完成本标书章间互查：未发现明显章间重复",
      )
      return
    }
    setDupLoading(true)
    // 第一段：本地 n-gram 粗筛（免费），只把可疑段落对送 AI 复判
    const pairs = findSuspectPairs(
      targets,
      others.flatMap((o) =>
        o.bid_chapters.filter((c) => c.content?.trim()).map((c) => ({ project: o.project_name, chapter: c.title, text: c.content })),
      ),
    )
    if (!pairs.length) {
      setDupLoading(false)
      void runDupJudge([], others.length, intraPairs)
      return
    }
    setDupLoading(false)
    costConfirm.runWithCostConfirm(() => {
      void runDupJudge(pairs, others.length, intraPairs)
    }, `本地粗筛发现 ${pairs.length} 处可疑段落，将交 AI 复判相似度，${costText()}`)
  }, [blockIfArchived, costConfirm, flushEditingContent, intraDupThreshold, projects, requireLogin, runDupJudge, updateProject, writeStageSnapshot])

  const jumpToChapter = useCallback(
    (nodeId: string) => {
      setActiveStep(3)
      selectChapter(nodeId)
    },
    [selectChapter],
  )

  /** 偏离表「响应位置」点击跳章：按节点标题与章标题/小节标题相似度定位 */
  const jumpToResponseNode = useCallback(
    (nodeTitle: string) => {
      const cur = activeProjectRef.current
      const title = (nodeTitle ?? "").trim()
      if (!cur || !title || title === "未找到响应") return
      const hit = cur.bid_chapters.find(
        (c) => clauseMatchesTitle(title, c.title) || (c.sections ?? []).some((s) => clauseMatchesTitle(title, s)),
      )
      if (hit) jumpToChapter(hit.node_id)
      else toast.info("正文里没有找到对应章节，该响应节点可能只存在于大纲中")
    },
    [jumpToChapter],
  )

  // ------------------------------ ⑤ 废标项检查 ------------------------------
  // Q28 切片A：外部标书审查模式的通道状态与动作
  const [bidExternalBusy, setBidExternalBusy] = useState(false)
  // Q28 切片B：签章体检状态——PDF File 引用（session-level，不持久化）+ scan 结果
  const bidExternalPdfRef = useRef<File | null>(null)
  const [sealBusy, setSealBusy] = useState(false)
  const [sealResult, setSealResult] = useState<SealScanSummary | null>(null)
  const setBidSourceMode = useCallback(
    (mode: BidSourceMode) => {
      if (blockIfArchived()) return
      updateProject({ bid_source_mode: mode })
    },
    [blockIfArchived, updateProject],
  )
  const setBidExternalText = useCallback(
    (text: string) => {
      if (blockIfArchived(true)) return
      updateProject({ bid_external_text: text }, { quiet: true })
    },
    [blockIfArchived, updateProject],
  )
  const handleBidExternalFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      if (blockIfArchived()) return
      setBidExternalBusy(true)
      try {
        const text = await extractTenderFileText(file, { pageTag: true })
        // R-029（R255）：投标文件同款扫描件检测（与招标文件共用 assessTenderParseQuality）
        const extQuality = assessTenderParseQuality(text, { bytes: file.size })
        if (extQuality.level === "suspect_scanned") {
          toast.error(extQuality.hint)
          return
        }
        if (extQuality.level === "low") toast.warning(extQuality.hint)
        if (file.name.toLowerCase().endsWith(".pdf")) {
          bidExternalPdfRef.current = file
        } else {
          bidExternalPdfRef.current = null
          setSealResult(null)
        }
        updateProject({ bid_source_mode: "external", bid_external_text: text })
        toast.success(`已载入外部投标文件「${file.name}」，共 ${text.length} 字，可在检查环节直接对标`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "文件解析失败，请改用粘贴文本方式")
      } finally {
        setBidExternalBusy(false)
      }
    },
    [blockIfArchived, updateProject],
  )
  const startSealCheck = useCallback(async () => {
    const pdfFile = bidExternalPdfRef.current
    if (!pdfFile) {
      toast.error("当前外部投标文件不是 PDF，仅 .pdf 格式支持签章体检")
      return
    }
    setSealBusy(true)
    try {
      const result = await scanPdfForSeal(pdfFile)
      setSealResult(result)
      if (result.absentRatio > 0) {
        toast.warning(`签章体检完成：${result.results.filter((r) => r.sealAbsent).length}/${result.scannedPages} 页疑似无签章`)
      } else {
        toast.success("签章体检完成：各扫描页均检测到签章特征")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "签章体检异常")
    } finally {
      setSealBusy(false)
    }
  }, [])

  const [voidLoading, setVoidLoading] = useState(false)

  const runVoidCheck = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const clauses = sectionText(cur.parse_report, "void_items")
      .split(/\n+/)
      .map((l) => l.replace(/^\d+[.、]\s*/, "").trim())
      .filter((l) => l.length > 0)
    if (!clauses.length) {
      toast.error("该检查依赖「无效标与废标项」解析项，请先回到解析环节勾选并解析")
      return
    }
    const bidText = resolveBidText(cur)
    if (!bidText.trim()) {
      toast.error(
        isExternalBid(cur)
          ? "还没有外部投标文件正文，请先在「投标文件编制」环节上传或粘贴"
          : "投标文件还没有正文，请先完成编制再检查",
      )
      return
    }
    setVoidLoading(true)
    try {
      // 第十二轮改造 2：报告含 ★/▲ 重点条款节时给既有调用追加上下文段
      const starBlock = starClausesPromptBlock(cur.parse_report)
      // R-028（R254）：项目正式废标检查走真三轮（定位→初检→定稿）；三轮任一异常降级既有单轮，保证 AI 抖动下可用
      let check: VoidCheck
      try {
        check = await runVoidCheckThreeRounds(clauses, bidText, starBlock)
      } catch (roundErr) {
        if (roundErr instanceof AuthRequiredError) throw roundErr
        const raw = await llmGenerate(buildVoidCheckMessages(clauses, bidText, starBlock), MAX_TOKENS_LONGFORM)
        check = sanitizeVoidCheck(extractJsonLoose(raw), clauses)
      }
      updateProject({ void_check: check })
      writeStageSnapshot("check", "废标项检查完成", { void_check: check })
      setActiveStep(5)
      const risky = check.items.filter((i) => effectiveVoidStatus(i) !== "compliant").length
      toast.success(risky ? `检查完成：${risky} 条存在风险或缺失，请逐条处理` : "检查完成：全部废标条款均已响应")
    } catch (e) {
      handleLlmError(e, "废标项检查失败，请重试")
    } finally {
      setVoidLoading(false)
    }
  }, [handleLlmError, updateProject, writeStageSnapshot])

  const startVoidCheck = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——废标检查会写 void_check
    flushEditingContent()
    costConfirm.runWithCostConfirm(() => {
      void runVoidCheck()
    }, `将分三轮（定位→初检→定稿）对照废标条款 AI 比对投标文件（约 3 次调用），${costText()}`)
  }, [blockIfArchived, costConfirm, flushEditingContent, requireLogin, runVoidCheck])

  const toggleVoidManual = useCallback(
    (itemId: string) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      const cur = activeProjectRef.current
      if (!cur?.void_check) return
      const items = cur.void_check.items.map((it: VoidItem) =>
        it.id === itemId ? { ...it, manual_checked: !it.manual_checked } : it,
      )
      updateProject({ void_check: { ...cur.void_check, items } })
    },
    [blockIfArchived, updateProject],
  )

  /** 第九轮改造 2：人工改判升级为合规状态三态（compliant/partial/non_compliant） */
  const setVoidManualStatus = useCallback(
    (itemId: string, status: VoidStatus) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      const cur = activeProjectRef.current
      if (!cur?.void_check) return
      const items = cur.void_check.items.map((it: VoidItem) =>
        it.id === itemId ? { ...it, manual_status: status, manual_checked: true } : it,
      )
      updateProject({ void_check: { ...cur.void_check, items } })
    },
    [blockIfArchived, updateProject],
  )

  /** 第九轮改造 2：核销动作——标记已处理 / 跳过（须填原因留痕），review_status 写入 json items 后 PATCH 持久化 */
  const setVoidReviewStatus = useCallback(
    (itemId: string, reviewStatus: ReviewStatus, skipReason = "") => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      const cur = activeProjectRef.current
      if (!cur?.void_check) return
      const items = cur.void_check.items.map((it: VoidItem) =>
        it.id === itemId
          ? { ...it, review_status: reviewStatus, skip_reason: reviewStatus === "skipped" ? skipReason.trim() : "" }
          : it,
      )
      updateProject({ void_check: { ...cur.void_check, items } })
    },
    [blockIfArchived, updateProject],
  )

  // ------------------------------ ⑥ 模拟评标（第九轮改造 3：三路并行） ------------------------------
  const [evalLoading, setEvalLoading] = useState(false)
  // 单路忙碌标记："" 空闲 / "all" 三路整体 / 其余为对应单路重跑
  const [evalPathBusy, setEvalPathBusy] = useState<"" | EvalPath | "all">("")
  // 各路最近一次执行是否失败：失败路在评标卡内可独立重跑
  const [evalPathFailed, setEvalPathFailed] = useState<{ tech: boolean; format: boolean; commercial: boolean }>({
    tech: false,
    format: false,
    commercial: false,
  })

  const runEvalAll = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (!scoringItemsFromReport(cur.parse_report).length) {
      toast.error("该评标依赖「技术评分要求 / 商务评分要求」解析项，请先回到解析环节勾选并解析")
      return
    }
    if (!resolveBidText(cur).trim()) {
      toast.error("投标文件还没有正文，请先完成编制或上传外部标书再评标")
      return
    }
    setEvalLoading(true)
    setEvalPathBusy("all")
    const prev = cur.ai_review
    // 一次费用确认后三路并行；单路失败置 null，不拖垮整体
    const settled = await Promise.allSettled([runEvalTechCall(cur), runEvalFormatCall(cur), runEvalCommercialCall(cur)])
    const authHit = settled.find((s) => s.status === "rejected" && s.reason instanceof AuthRequiredError)
    if (authHit && authHit.status === "rejected") {
      setEvalLoading(false)
      setEvalPathBusy("")
      handleLlmError(authHit.reason, "模拟评标失败，请重试")
      return
    }
    const tech = settled[0].status === "fulfilled" ? (settled[0] as PromiseFulfilledResult<AiReview>).value : null
    const format = settled[1].status === "fulfilled" ? (settled[1] as PromiseFulfilledResult<FormatIssue[]>).value : null
    const commercial =
      settled[2].status === "fulfilled" ? (settled[2] as PromiseFulfilledResult<CommercialCheck[]>).value : null
    setEvalPathFailed({ tech: tech === null, format: format === null, commercial: commercial === null })
    if (tech === null && format === null && commercial === null) {
      setEvalLoading(false)
      setEvalPathBusy("")
      handleLlmError((settled[0] as PromiseRejectedResult).reason, "模拟评标失败，请重试")
      return
    }
    const review = mergeAiReview(prev, tech, format, commercial)
    const patch: Partial<BidProjectRecord> = { ai_review: review }
    if (tech && !cur.manual_review) {
      patch.manual_review = {
        items: tech.items.map((i) => ({ scoring_item: i.scoring_item, max_score: i.max_score, manual_score: 0, comment: "" })),
        total_score: 0,
      }
    }
    updateProject(patch)
    writeStageSnapshot("eval", "三路模拟评标完成", { ai_review: review })
    setActiveStep(6)
    setEvalLoading(false)
    setEvalPathBusy("")
    const failedNames = [
      tech === null ? EVAL_PATH_LABEL.tech : "",
      format === null ? EVAL_PATH_LABEL.format : "",
      commercial === null ? EVAL_PATH_LABEL.commercial : "",
    ].filter(Boolean)
    if (failedNames.length) {
      toast.warning(`三路模拟评标结束：「${failedNames.join("」「")}」路失败，可在评标卡内单独重跑该路`)
    } else if (tech) {
      toast.success(`三路模拟评标完成，技术路预估总分 ${review.total_score} 分`)
    } else {
      toast.success("三路模拟评标完成")
    }
  }, [handleLlmError, updateProject, writeStageSnapshot])

  const startAiReview = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——AI 评标会写 ai_review/manual_review
    flushEditingContent()
    costConfirm.runWithCostConfirm(() => {
      void runEvalAll()
    }, `三路评标：技术符合性 / 格式规范 / 商务要素，共 3 次调用，${costText()}`)
  }, [blockIfArchived, costConfirm, flushEditingContent, requireLogin, runEvalAll])

  /** 单路独立重跑（各自费用确认），结果合并进既有 ai_review，其余两路保持不动 */
  const runEvalSinglePath = useCallback(
    async (path: EvalPath) => {
      const cur = activeProjectRef.current
      if (!cur) return
      if (path === "tech" && !scoringItemsFromReport(cur.parse_report).length) {
        toast.error("技术评分路依赖「技术评分要求 / 商务评分要求」解析项，请先回到解析环节勾选并解析")
        return
      }
      if (!resolveBidText(cur).trim()) {
        toast.error("投标文件还没有正文，请先完成编制或上传外部标书再评标")
        return
      }
      setEvalPathBusy(path)
      try {
        const prev = cur.ai_review
        const patch: Partial<BidProjectRecord> = {}
        if (path === "tech") {
          const tech = await runEvalTechCall(cur)
          patch.ai_review = mergeAiReview(prev, tech, null, null)
          if (!cur.manual_review) {
            patch.manual_review = {
              items: tech.items.map((i) => ({ scoring_item: i.scoring_item, max_score: i.max_score, manual_score: 0, comment: "" })),
              total_score: 0,
            }
          }
          setEvalPathFailed((f) => ({ ...f, tech: false }))
        } else if (path === "format") {
          const issues = await runEvalFormatCall(cur)
          patch.ai_review = mergeAiReview(prev, null, issues, null)
          setEvalPathFailed((f) => ({ ...f, format: false }))
        } else {
          const checks = await runEvalCommercialCall(cur)
          patch.ai_review = mergeAiReview(prev, null, null, checks)
          setEvalPathFailed((f) => ({ ...f, commercial: false }))
        }
        updateProject(patch)
        writeStageSnapshot("eval", `「${EVAL_PATH_LABEL[path]}」路评标完成`, { ai_review: patch.ai_review })
        toast.success(`「${EVAL_PATH_LABEL[path]}」路评标完成`)
      } catch (e) {
        setEvalPathFailed((f) => ({ ...f, [path]: true }))
        handleLlmError(e, `「${EVAL_PATH_LABEL[path]}」路评标失败，可再次重跑`)
      } finally {
        setEvalPathBusy("")
      }
    },
    [handleLlmError, updateProject, writeStageSnapshot],
  )

  const startEvalPathRerun = useCallback(
    (path: EvalPath) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 6 A1：归档只读——单路重跑会写 ai_review
      flushEditingContent()
      costConfirm.runWithCostConfirm(() => {
        void runEvalSinglePath(path)
      }, `将重跑「${EVAL_PATH_LABEL[path]}」单路模拟评标（1 次调用），${costText()}`)
    },
    [blockIfArchived, costConfirm, flushEditingContent, requireLogin, runEvalSinglePath],
  )

  const initManualReview = useCallback(() => {
    if (blockIfArchived()) return // 循环 6 A1：归档只读
    const cur = activeProjectRef.current
    if (!cur) return
    const scoring = scoringItemsFromReport(cur.parse_report)
    if (!scoring.length) {
      toast.error("该打分表依赖「技术评分要求 / 商务评分要求」解析项，请先回到解析环节勾选并解析")
      return
    }
    const review: ManualReview = {
      items: scoring.map((s) => ({ scoring_item: s.item, max_score: s.score, manual_score: 0, comment: "" })),
      total_score: 0,
    }
    updateProject({ manual_review: review })
    toast.success("人工打分表已按评分办法生成")
  }, [blockIfArchived, updateProject])

  const setManualScore = useCallback(
    (idx: number, score: number) => {
      if (blockIfArchived(true)) return // 循环 6 A1：归档只读（逐键输入静默拦截，View 层 disabled 兜底）
      const cur = activeProjectRef.current
      if (!cur?.manual_review) return
      const items = cur.manual_review.items.map((it, i) =>
        i === idx ? { ...it, manual_score: Math.max(0, Math.min(it.max_score || Number.MAX_SAFE_INTEGER, score)) } : it,
      )
      updateProject(
        { manual_review: { items, total_score: Math.round(items.reduce((s, it) => s + it.manual_score, 0) * 10) / 10 } },
        { quiet: true },
      )
    },
    [blockIfArchived, updateProject],
  )

  const setManualComment = useCallback(
    (idx: number, comment: string) => {
      if (blockIfArchived(true)) return // 循环 6 A1：归档只读（逐键输入静默拦截）
      const cur = activeProjectRef.current
      if (!cur?.manual_review) return
      const items = cur.manual_review.items.map((it, i) => (i === idx ? { ...it, comment } : it))
      updateProject({ manual_review: { ...cur.manual_review, items } }, { quiet: true })
    },
    [blockIfArchived, updateProject],
  )

  // ------------------------------ 第七轮改造 5：交卷体检（实质响应覆盖审计） ------------------------------
  const [submissionLoading, setSubmissionLoading] = useState(false)
  // 审计调用失败 / 结果解析失败时为 true：面板降级显示「审计未完成」，绝不把解析失败当成全未覆盖
  const [submissionFailed, setSubmissionFailed] = useState(false)

  const runSubmissionCheck = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (!bidChaptersFor(cur).some((c) => (c.content ?? "").trim())) {
      toast.error("投标文件还没有正文，请先完成编制或上传外部标书再做交卷体检")
      return
    }
    // 第十七轮 17C：本地格式规则检查（零 AI 费用），随交卷体检执行并并入报告
    const formatReport = buildFormatReportFor(cur)
    const scoring = scoringItemsFromReport(cur.parse_report)
    const voidClauses = sectionText(cur.parse_report, "void_items")
      .split(/\n+/)
      .map((l) => l.replace(/^\d+[.、]\s*/, "").trim())
      .filter((l) => l.length > 0)
    // 循环 8 A3：第三路——全局事实一致性核对（复用快捷工具「事实核对」同款链路函数，不新造 prompt）。
    // 单独 try/catch：失败只返回 null（=未跑/失败语义，不污染 submissionFailed），跑过无矛盾返回 []；
    // 无事实表返回 null 且零调用。与第二路实质响应审计 Promise.all 并行，净增最多 1 次 LLM 调用/回。
    const factLines = effectiveGlobalFactsLines(cur)
    const runFactPath = async (): Promise<FactConflict[] | null> => {
      if (!factLines.length) return null
      try {
        const evidence = collectFactEvidence(factLines, bidChaptersFor(cur))
        const rawFact = await llmGenerate(
          buildFactCheckMessages(wrapGlobalFactsBlock(factLines), evidence),
          MAX_TOKENS_LONGFORM,
        )
        return await withJsonRepair(rawFact, sanitizeFactConflicts)
      } catch {
        return null
      }
    }
    // D3/R89：第四路——AI 内容护栏（与本地数字对账并存互补，只报不拦）。逐章一次调用（正文前 6000 字
    // + 事实表/招标片段/KB 命中各 ≤2000 字裁剪）；每章调用前过预算闸，超限章节跳过；单章失败静默继续
    // （该章视为未检查）；登录态/整体异常上抛由 Promise.all reject 走体检失败兜底，语义同 fact_conflicts：
    // null=未跑/失败，[]=跑过且无问题。
    const guardFactsBlock = wrapGlobalFactsBlock(factLines).slice(0, 2000)
    const runConsistencyGuardPath = async (): Promise<ConsistencyIssue[] | null> => {
      const filled = bidChaptersFor(cur).filter((c) => (c.content ?? "").trim())
      if (!filled.length) return null
      // r89-guard-kb-cold-01：冷缓存不阻塞（KB 作软参考，globalFacts+tenderFragment 为主）
      const kbDocs: KbDocRow[] = await getCachedVisibleDocsNonBlocking(userId)
      const projectTrack = deriveTrack(
        [cur.project_name, cur.hospital, (cur.tender_text ?? "").slice(0, 2000)].filter(Boolean).join(" "),
      )
      const out: ConsistencyIssue[] = []
      for (const ch of filled) {
        const usage = readTodayAiUsage()
        const gate = checkBudgetGate(usage.count, usage.costYuan)
        if (!gate.allowed) break // 超预算：后续章节跳过（结果仍视为已跑部分，只报不拦）
        const _kbHits = kbDocs.length
          ? assembleKbContext(kbDocs, {
              query: [ch.title, ...(ch.sections ?? [])].filter(Boolean).join(" ").slice(0, 600),
              track: projectTrack,
              buckets: ["标书弹药", "产品资料", "方案素材"],
              topN: 2,
            }).hits
          : []
        const kbContext = _kbHits
          .map((h) => `（来源文档：《${h.doc.title}》）${h.snippet}`)
          .join("\n").slice(0, 2000)
        try {
          const rawGuard = await llmGenerate(
            buildConsistencyGuardMessages({
              chapterTitle: ch.title,
              chapterBody: (ch.content ?? "").slice(0, 6000),
              globalFacts: guardFactsBlock,
              tenderFragment: retrieveTenderFragments(cur.tender_text, {
                title: ch.title,
                sections: ch.sections ?? [],
                clauses: [],
              }).slice(0, 2000),
              kbContext,
            }),
            MAX_TOKENS_LONGFORM,
          )
          recordAiCall()
          out.push(...sanitizeConsistencyIssues(extractJsonLoose(rawGuard)))
        } catch (e) {
          if (e instanceof AuthRequiredError) throw e
          // 单章失败静默：该章未检查，不拖垮整体
        }
      }
      return out
    }
    if (!scoring.length && !voidClauses.length) {
      // 缺 AI 审计依赖项时仍保留本地格式检查结果（items 空 → 闸门不放行，仅报告可见）；
      // 循环 8 A3：事实路不依赖评分/废标项，降级分支内同样执行（有事实表就跑）
      setSubmissionLoading(true)
      try {
        const [factConflicts, consistencyIssues] = await Promise.all([
          runFactPath(),
          runConsistencyGuardPath().catch(() => null),
        ])
        updateProject({
          submission_check: {
            items: [],
            checked_at: formatReport.checked_at,
            format_report: formatReport,
            fact_conflicts: factConflicts,
            consistency_issues: consistencyIssues,
          },
        })
        toast.warning(
          `格式规则检查完成：${formatReport.hits.length} 处命中${
            factConflicts?.length ? `；事实一致性核对发现 ${factConflicts.length} 处矛盾` : ""
          }；AI 实质响应审计依赖「技术评分要求 / 无效标与废标项」解析项，请先回到解析环节勾选并解析`,
        )
      } finally {
        setSubmissionLoading(false)
      }
      return
    }
    setSubmissionLoading(true)
    setSubmissionFailed(false)
    try {
      const digest = buildSubmissionDigest(bidChaptersFor(cur), scoring, voidClauses)
      // 体检调用不带技能：审计要中立，避免技能块影响判定；第十二轮改造 2：追加 ★/▲ 重点条款上下文段
      const starBlock = starClausesPromptBlock(cur.parse_report)
      // 循环 8 A3：审计路与事实路并行；事实路自吞异常（返回 null），Promise.all 的 reject 只可能来自审计路
      const [raw, factConflicts, consistencyIssues] = await Promise.all([
        llmGenerate(buildSubmissionCheckMessages(scoring, voidClauses, digest, starBlock), MAX_TOKENS_LONGFORM),
        runFactPath(),
        // D3/R89：护栏路自吞整体异常（返回 null=未跑），reject 仍只可能来自审计路
        runConsistencyGuardPath().catch(() => null),
      ])
      const check = {
        ...sanitizeSubmissionCheck(raw, scoring, voidClauses),
        format_report: formatReport,
        fact_conflicts: factConflicts,
        consistency_issues: consistencyIssues,
      }
      updateProject({ submission_check: check })
      writeStageSnapshot("check", "交卷体检完成", { submission_check: check })
      const gaps = check.items.filter((i) => !i.covered)
      const factNote = factConflicts?.length ? `；事实矛盾 ${factConflicts.length} 处` : ""
      const guardNote = consistencyIssues?.length ? `；内容护栏 ${consistencyIssues.length} 处提示` : ""
      if (gaps.length) {
        toast.warning(`交卷体检完成：${check.items.length - gaps.length}/${check.items.length} 项已实质响应，${gaps.length} 项未覆盖${factNote}${guardNote}，请逐条处理`)
      } else {
        toast.success(`交卷体检完成：全部 ${check.items.length} 项审计均已实质响应${factNote}${guardNote}`)
      }
    } catch (e) {
      setSubmissionFailed(true)
      handleLlmError(e, "交卷体检未完成，请重试或人工复核")
    } finally {
      setSubmissionLoading(false)
    }
  }, [buildFormatReportFor, handleLlmError, updateProject, userId, writeStageSnapshot])

  const startSubmissionCheck = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——交卷体检会写 submission_check
    flushEditingContent()
    costConfirm.runWithCostConfirm(() => {
      void runSubmissionCheck()
    }, `交卷前 AI 将对全部评分项与废标条款逐条做实质响应覆盖审计，并同步核对全局事实表与各章数字/承诺口径的一致性（覆盖审计 + 全局事实一致性核对 + AI 内容护栏逐章检查（护栏受每日预算闸限制，超限章节自动跳过）），${costText()}`)
  }, [blockIfArchived, costConfirm, flushEditingContent, requireLogin, runSubmissionCheck])

  /** 第九轮改造 2：未覆盖项核销动作（标记已处理 / 跳过须填原因），与废标检查同一套 review_status 模式 */
  const setSubmissionReviewStatus = useCallback(
    (index: number, reviewStatus: ReviewStatus, skipReason = "") => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      const cur = activeProjectRef.current
      if (!cur?.submission_check) return
      const items = cur.submission_check.items.map((it) =>
        it.index === index
          ? { ...it, review_status: reviewStatus, skip_reason: reviewStatus === "skipped" ? skipReason.trim() : "" }
          : it,
      )
      updateProject({ submission_check: { ...cur.submission_check, items } })
    },
    [blockIfArchived, updateProject],
  )

  /** 未覆盖清单跳最相关章节：按 label 与各章标题/小节/正文前 2000 字的最长公共子串定位 */
  const jumpToSubmissionGap = useCallback(
    (label: string) => {
      const cur = activeProjectRef.current
      const key = (label ?? "").trim()
      if (!cur || !key) return
      let bestNodeId = ""
      let bestScore = 0
      for (const c of cur.bid_chapters) {
        const score = Math.max(
          commonSubstringLen(key, c.title),
          ...(c.sections ?? []).map((s) => commonSubstringLen(key, s)),
          commonSubstringLen(key, (c.content ?? "").slice(0, 2000)),
          0,
        )
        if (score > bestScore) {
          bestScore = score
          bestNodeId = c.node_id
        }
      }
      if (bestNodeId && bestScore >= 4) jumpToChapter(bestNodeId)
      else toast.info("未能定位到最相关章节，请人工在编制环节检查对应内容")
    },
    [jumpToChapter],
  )

  // ------------------------------ ⑥ 讲标与答辩（第六轮改造） ------------------------------
  // 三块能力：专家问题池 / 讲标大纲 / 讲标稿要点。数据统一存 bid_projects.bid_defense(json)，
  // 编辑与生成结果经 updateDefense → updateProject 的防抖 PATCH 模式落库；AI 调用全部走
  // chatViaGateway（llmGenerate）+ runWithCostConfirm，重复生成前用 Dialog 二次确认。
  const navigate = useNavigate()
  const [defenseBusy, setDefenseBusy] = useState<"" | "questions" | "answer" | "outline" | "speech">("")
  const [answerBusyId, setAnswerBusyId] = useState("")
  const [pptSending, setPptSending] = useState(false)
  // 覆盖重生成的二次确认弹窗（三块共用：questions / outline / speech）
  const [defenseConfirm, setDefenseConfirm] = useState<"" | "questions" | "outline" | "speech">("")

  const defense = useMemo<BidDefense>(
    () => activeProject?.bid_defense ?? emptyBidDefense(),
    [activeProject?.bid_defense],
  )

  // 生成依赖：问题池 = 解析报告 + 标书正文；讲标大纲 = 标书大纲；讲标稿 = 讲标大纲已生成
  const defenseQuestionsReady =
    !!activeProject?.parse_report && (activeProject?.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
  const defenseOutlineReady = (activeProject?.bid_outline ?? []).length > 0
  const defenseSpeechReady = defense.defense_outline.length > 0
  const defenseAnsweredCount = defense.questions.filter((q) => q.full_answer.trim()).length

  const updateDefense = useCallback(
    (patch: Partial<BidDefense>, opts?: { quiet?: boolean }) => {
      if (blockIfArchived(true)) return // 循环 6 A1：归档只读（编辑输入静默拦截，View 层 disabled 兜底；连带覆盖问题/大纲/讲标稿三组 setter）
      const cur = activeProjectRef.current
      if (!cur) return
      const next: BidDefense = { ...cur.bid_defense, ...patch, updated_at: new Date().toISOString() }
      updateProject({ bid_defense: next }, { quiet: opts?.quiet })
    },
    [blockIfArchived, updateProject],
  )

  const runGenerateDefenseQuestions = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const scoringText = combinedScoringText(cur.parse_report)
    const voidText = sectionText(cur.parse_report, "void_items")
    const digest = buildChapterDigest(cur.bid_chapters)
    if (!cur.parse_report || (!scoringText.trim() && !voidText.trim())) {
      toast.error("问题池依赖解析报告（评分办法 / 废标条款），请先完成解析环节")
      return
    }
    if (!digest.trim()) {
      toast.error("投标文件还没有正文，请先完成编制环节再生成问题池")
      return
    }
    setDefenseBusy("questions")
    try {
      const raw = await llmGenerate(
        buildDefenseQuestionsMessages(scoringText, voidText, digest, effectiveGlobalFacts(cur)),
        MAX_TOKENS_LONGFORM,
        "bid-defense",
      )
      const questions = sanitizeDefenseQuestions(extractJsonLoose(raw))
      updateDefense({ questions })
      toast.success(`已生成 ${questions.length} 个专家问题，可逐条生成完整答案`)
    } catch (e) {
      handleLlmError(e, "生成专家问题池失败，请重试")
    } finally {
      setDefenseBusy("")
    }
  }, [handleLlmError, updateDefense])

  const startGenerateDefenseQuestions = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——问题池生成会写 bid_defense
    if (!defenseQuestionsReady) {
      toast.error("请先完成「② AI 解析报告」并在「③ 投标文件编制」生成正文，再生成问题池")
      return
    }
    if (defense.questions.length) {
      setDefenseConfirm("questions")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runGenerateDefenseQuestions()
      },
      `AI 将基于评分办法、废标条款与标书内容预判 8-15 个专家问题，${costText()}${skillCostSuffix("bid-defense")}`,
    )
  }, [blockIfArchived, costConfirm, defense.questions.length, defenseQuestionsReady, requireLogin, runGenerateDefenseQuestions])

  const runGenerateFullAnswer = useCallback(
    async (questionId: string) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const q = cur.bid_defense.questions.find((it) => it.id === questionId)
      if (!q) return
      setDefenseBusy("answer")
      setAnswerBusyId(questionId)
      try {
        const text = await llmGenerate(
          buildDefenseAnswerMessages(
            q,
            defenseRefChapterText(cur.bid_chapters, q.ref_chapters),
            effectiveGlobalFacts(cur),
          ),
          MAX_TOKENS_OUTLINE,
          "bid-defense",
        )
        const questions = cur.bid_defense.questions.map((it) =>
          it.id === questionId ? { ...it, full_answer: text.trim() } : it,
        )
        updateDefense({ questions })
        toast.success("完整答案已生成，可编辑后保存")
      } catch (e) {
        handleLlmError(e, "生成完整答案失败，请重试")
      } finally {
        setDefenseBusy("")
        setAnswerBusyId("")
      }
    },
    [handleLlmError, updateDefense],
  )

  const startGenerateFullAnswer = useCallback(
    (questionId: string) => {
      if (!requireLogin()) return
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      costConfirm.runWithCostConfirm(
        () => {
          void runGenerateFullAnswer(questionId)
        },
        `AI 将基于标书相关章节把该问题写成 200-400 字答辩口径的完整答案，${costText()}${skillCostSuffix("bid-defense")}`,
      )
    },
    [blockIfArchived, costConfirm, requireLogin, runGenerateFullAnswer],
  )

  const updateDefenseQuestion = useCallback(
    (questionId: string, patch: Partial<DefenseQuestion>) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const questions = cur.bid_defense.questions.map((it) =>
        it.id === questionId ? { ...it, ...patch, edited: true } : it,
      )
      updateDefense({ questions }, { quiet: true })
    },
    [updateDefense],
  )

  const runGenerateDefenseOutline = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.bid_outline.length) {
      toast.error("请先在「③ 投标文件编制」生成标书大纲")
      return
    }
    setDefenseBusy("outline")
    try {
      const raw = await llmGenerate(
        buildDefenseOutlineMessages(
          outlineToText(cur.bid_outline),
          combinedScoringText(cur.parse_report),
          effectiveGlobalFacts(cur),
        ),
        MAX_TOKENS_LONGFORM,
        "bid-defense",
      )
      const pages = sanitizeDefenseOutline(extractJsonLoose(raw))
      // 大纲重排后旧讲标稿的页对应关系失效，一并清空防止口径错位
      updateDefense({ defense_outline: pages, speech_notes: null })
      toast.success(`讲标大纲已生成 ${pages.length} 页，可一键送进 PPT 与报价`)
    } catch (e) {
      handleLlmError(e, "生成讲标大纲失败，请重试")
    } finally {
      setDefenseBusy("")
    }
  }, [handleLlmError, updateDefense])

  const startGenerateDefenseOutline = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读
    if (!defenseOutlineReady) {
      toast.error("讲标大纲依赖标书大纲，请先在「③ 投标文件编制」完成大纲生成")
      return
    }
    if (defense.defense_outline.length) {
      setDefenseConfirm("outline")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runGenerateDefenseOutline()
      },
      `AI 将按标书大纲与评分权重生成 10-15 页讲标 PPT 大纲，${costText()}${skillCostSuffix("bid-defense")}`,
    )
  }, [blockIfArchived, costConfirm, defense.defense_outline.length, defenseOutlineReady, requireLogin, runGenerateDefenseOutline])

  const updateDefenseOutlinePage = useCallback(
    (idx: number, patch: Partial<DefenseOutlinePage>) => {
      const cur = activeProjectRef.current
      if (!cur) return
      const defense_outline = cur.bid_defense.defense_outline.map((pg, i) => (i === idx ? { ...pg, ...patch } : pg))
      updateDefense({ defense_outline }, { quiet: true })
    },
    [updateDefense],
  )

  /** 送进 PPT 与报价：按讲标大纲创建 ppt_decks 草稿（字段结构与 ppt-quote 页 normalize 一致）后跳转 */
  const sendOutlineToPpt = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.bid_defense.defense_outline.length) {
      toast.error("请先生成讲标大纲")
      return
    }
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读——送 PPT 会创建 ppt_decks 草稿（写库）
    setPptSending(true)
    try {
      await apiFetch("/api/ppt_decks", {
        method: "POST",
        body: JSON.stringify({
          rh_user_id: userId,
          deck_name: `${cur.project_name}讲标`,
          deck_type: "topic",
          audience: "评标专家",
          duration_min: 10,
          material_ref: "",
          slides: cur.bid_defense.defense_outline.map((pg) => ({
            id: makeUid(),
            title: pg.page_title,
            bullets: pg.bullets.length ? pg.bullets : [pg.page_title],
            notes: "",
          })),
          doc_status: "draft",
        }),
      })
      toast.success("讲标大纲已送进 PPT 与报价，可在该模块继续编辑")
      navigate("/ppt-quote")
    } catch {
      toast.error("送进 PPT 与报价失败，请检查网络后重试")
    } finally {
      setPptSending(false)
    }
  }, [blockIfArchived, navigate, requireLogin, userId])

  const runGenerateSpeechNotes = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const pages = cur.bid_defense.defense_outline
    if (!pages.length) {
      toast.error("请先生成讲标大纲，讲标稿要点依赖大纲页序")
      return
    }
    setDefenseBusy("speech")
    try {
      const raw = await llmGenerate(buildSpeechNotesMessages(pages, effectiveGlobalFacts(cur)), MAX_TOKENS_LONGFORM, "bid-defense")
      const speech_notes = sanitizeSpeechNotes(extractJsonLoose(raw), pages)
      updateDefense({ speech_notes })
      toast.success("讲标稿要点已生成，可逐段编辑保存")
    } catch (e) {
      handleLlmError(e, "生成讲标稿要点失败，请重试")
    } finally {
      setDefenseBusy("")
    }
  }, [handleLlmError, updateDefense])

  const startGenerateSpeechNotes = useCallback(() => {
    if (!requireLogin()) return
    if (blockIfArchived()) return // 循环 6 A1：归档只读
    if (!defenseSpeechReady) {
      toast.error("请先生成讲标大纲，再生成讲标稿要点")
      return
    }
    if (defense.speech_notes) {
      setDefenseConfirm("speech")
      return
    }
    costConfirm.runWithCostConfirm(
      () => {
        void runGenerateSpeechNotes()
      },
      `AI 将基于讲标大纲撰写口语化讲标要点（开场/每页讲述/收尾），${costText()}${skillCostSuffix("bid-defense")}`,
    )
  }, [blockIfArchived, costConfirm, defense.speech_notes, defenseSpeechReady, requireLogin, runGenerateSpeechNotes])

  const updateSpeechNotes = useCallback(
    (patch: Partial<DefenseSpeechNotes>) => {
      const cur = activeProjectRef.current
      if (!cur?.bid_defense.speech_notes) return
      updateDefense({ speech_notes: { ...cur.bid_defense.speech_notes, ...patch } }, { quiet: true })
    },
    [updateDefense],
  )

  const confirmDefenseRegenerate = useCallback(() => {
    const kind = defenseConfirm
    setDefenseConfirm("")
    if (blockIfArchived()) return // 循环 6 A1：归档只读——覆盖重生成会写 bid_defense
    if (kind === "questions") {
      costConfirm.runWithCostConfirm(
        () => {
          void runGenerateDefenseQuestions()
        },
        `将覆盖现有问题池重新生成 8-15 个专家问题，${costText()}${skillCostSuffix("bid-defense")}`,
      )
    } else if (kind === "outline") {
      costConfirm.runWithCostConfirm(
        () => {
          void runGenerateDefenseOutline()
        },
        `将覆盖现有讲标大纲重新生成（已生成的讲标稿要点会一并清空），${costText()}${skillCostSuffix("bid-defense")}`,
      )
    } else if (kind === "speech") {
      costConfirm.runWithCostConfirm(
        () => {
          void runGenerateSpeechNotes()
        },
        `将覆盖现有讲标稿要点重新生成，${costText()}${skillCostSuffix("bid-defense")}`,
      )
    }
  }, [blockIfArchived, costConfirm, defenseConfirm, runGenerateDefenseOutline, runGenerateDefenseQuestions, runGenerateSpeechNotes])

  // ------------------------------ ⑦ 归档导出 ------------------------------
  const [exportBusy, setExportBusy] = useState<"bid" | "parse" | "check" | "eval" | "deviation" | "all" | "">("")

  // Q20（2026-09-28 资质台账配套）：导出投标文件前核验资质有效期——
  // 已过期/30 天内到期的证书若被标书引用即废标风险。核验失败静默跳过（不阻断导出主流程），
  // 有风险时 toast 长时警告列出证书名（不硬拦截：导出也可能仅供内部流转）。
  // 硬拦截开关（Q20 补全，localStorage "qual_hard_block"）：用户在资质台账页开启后，
  // 存在已过期/临期证书时直接阻断导出并提示先处理——严谨要求下宁可不能导也不能带病交付。
  const warnExpiredQuals = useCallback(async (): Promise<boolean> => {
    let hardBlock = false
    try {
      hardBlock = window.localStorage.getItem("qual_hard_block") === "1"
    } catch {
      /* localStorage 不可用时按软警告处理 */
    }
    try {
      const data = await apiFetch<{ alerts?: Array<{ cert_name: string; bucket: string; valid_to: string }> }>(
        "/api/qual_certs/summary",
      )
      const risky = (data.alerts ?? []).filter((a) => a.bucket === "expired" || a.bucket === "critical")
      if (risky.length) {
        const names = risky.map((a) => `${a.cert_name}（${a.valid_to}）`).join("、")
        if (hardBlock) {
          toast.error(`已阻断导出：${risky.length} 项证书已过期或 30 天内到期——${names}。请先到「资质台账」处理（更新有效期或关闭硬拦截）`, {
            duration: 15000,
          })
          return true
        }
        toast.warning(`资质核验：${risky.length} 项证书已过期或 30 天内到期——${names}。标书如引用请务必核实`, { duration: 12000 })
      }
    } catch {
      /* 台账未建或网络异常时静默跳过，核验失败不阻断导出 */
    }
    return false
  }, [])

  const exportBidWord = useCallback(async () => {
    flushEditingContent()
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.bid_chapters.some((c) => c.content.trim())) {
      toast.error("还没有任何正文内容，无法导出投标文件")
      return
    }
    const blocked = await warnExpiredQuals()
    if (blocked) return
    setExportBusy("bid")
    try {
      const { exportBidDocx } = await import("./bidFiles")
      await exportBidDocx(cur)
      toast.success("投标文件 Word 已导出")
    } catch {
      toast.error("导出失败，请稍后重试")
    } finally {
      setExportBusy("")
    }
  }, [flushEditingContent])

  const exportReport = useCallback(
    async (kind: "parse" | "dup_void" | "eval") => {
      const cur = activeProjectRef.current
      if (!cur) return
      setExportBusy(kind === "parse" ? "parse" : kind === "dup_void" ? "check" : "eval")
      try {
        const { exportReportDocx } = await import("./bidFiles")
        await exportReportDocx(kind, cur)
        toast.success("报告已导出")
      } catch {
        toast.error("导出失败，请稍后重试")
      } finally {
        setExportBusy("")
      }
    },
    [],
  )

  /** 改造 4：独立导出技术偏离表 Word（归档全套文档亦含该表） */
  const exportDeviationWord = useCallback(async () => {
    const cur = activeProjectRef.current
    if (!cur) return
    const table = normalizeDeviationTable(cur.response_map)
    if (!table || !table.rows.length) {
      toast.error("还没有技术偏离表，请先在「投标文件编制」环节生成")
      return
    }
    setExportBusy("deviation")
    try {
      const { exportDeviationDocx } = await import("./bidFiles")
      await exportDeviationDocx(cur)
      toast.success("技术偏离表 Word 已导出")
    } catch {
      toast.error("导出失败，请稍后重试")
    } finally {
      setExportBusy("")
    }
  }, [])

  const archiveProject = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    // 循环 6 A1：归档写入统一双口径——archived 位 + stage 同时落，列表过滤与只读锁判定才能一致
    updateProject({ archived: true, stage: "archived" })
    toast.success("项目已归档，仍可随时查看与导出全部报告")
  }, [updateProject])

  // ------------------------------ 第九轮改造 1：交卷闸门（确认留痕，不拦导航只拦导出） ------------------------------
  const stageGates = activeProject?.stage_gates ?? emptyStageGates()
  const gatesUnconfirmed = GATE_KINDS.filter((k) => !findGateRecord(stageGates, k)).length
  const allGatesConfirmed = gatesUnconfirmed === 0
  /** 闸门 check 条件附加提示用：废标检查 critical 且未核销的条数（只提示不拦确认） */
  const voidCriticalUnresolved = useMemo(() => {
    const items = activeProject?.void_check?.items ?? []
    return items.filter((it) => effectiveVoidStatus(it) !== "compliant" && it.severity === "critical" && it.review_status === "pending").length
  }, [activeProject?.void_check])

  const confirmGate = useCallback(
    (kind: GateKind, notes: string, forced: boolean) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读——闸门确认写 stage_gates
      const cur = activeProjectRef.current
      if (!cur) return
      if (forced && !notes.trim()) {
        toast.error("强制放行必须填写备注说明原因，留痕备查")
        return
      }
      const gates = cur.stage_gates.gates.filter((g) => g.gate !== kind)
      gates.push({ gate: kind, confirmed_at: new Date().toISOString(), notes: notes.trim().slice(0, 200), forced })
      updateProject({ stage_gates: { gates } })
      toast.success(forced ? `闸门「${GATE_LABEL[kind]}」已强制放行并留痕` : `闸门「${GATE_LABEL[kind]}」已确认`)
    },
    [blockIfArchived, updateProject],
  )

  const resetGate = useCallback(
    (kind: GateKind) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读
      const cur = activeProjectRef.current
      if (!cur) return
      updateProject({ stage_gates: { gates: cur.stage_gates.gates.filter((g) => g.gate !== kind) } })
      toast.success(`闸门「${GATE_LABEL[kind]}」已重置为未确认`)
    },
    [blockIfArchived, updateProject],
  )

  /** 全套导出：五闸门全部确认后才可用；按「投标文件→偏离表→解析→检查→评标」顺序导出已就绪文档 */
  const exportAllDocs = useCallback(async () => {
    flushEditingContent()
    const cur = activeProjectRef.current
    if (!cur) return
    if (!gatesAllConfirmed(cur.stage_gates)) {
      toast.error(`还有 ${gatesUnconfirmedCount(cur.stage_gates)} 个交卷闸门未确认，确认后才能导出全套文档`)
      return
    }
    setExportBusy("all")
    try {
      const { exportBidDocx, exportReportDocx, exportDeviationDocx } = await import("./bidFiles")
      if (cur.bid_chapters.some((c) => (c.content ?? "").trim())) await exportBidDocx(cur)
      const table = normalizeDeviationTable(cur.response_map)
      if (table && table.rows.length) await exportDeviationDocx(cur)
      if (cur.parse_report) await exportReportDocx("parse", cur)
      if (cur.dup_report || cur.void_check) await exportReportDocx("dup_void", cur)
      if (cur.ai_review) await exportReportDocx("eval", cur)
      toast.success("全套投标文档已导出（仅包含已就绪的部分）")
    } catch {
      toast.error("全套导出失败，请稍后重试")
    } finally {
      setExportBusy("")
    }
  }, [flushEditingContent])

  // ------------------------------ 第十一轮改造 3：步骤条按产物放行 ------------------------------
  /** 步骤导航：目标步骤的前置产物就绪即放行，否则 toast 说明缺什么（不再无差别拦截/放行） */
  const requestStep = useCallback((step: number) => {
    const missing = stepEntryMissing(step, activeProjectRef.current)
    if (missing) {
      toast.error(missing)
      return
    }
    setActiveStep(step)
  }, [])

  // ------------------------------ 第十一轮改造 4/5：快照恢复与项目重置 ------------------------------
  const [snapshotBusyId, setSnapshotBusyId] = useState("")
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  /**
   * 恢复一条历史快照：parse/outline 可按需同时清空下游产物；chapter 只替换该章正文；
   * check/eval 按 payload 里存在的报告逐项恢复；reset 恢复全量备份。
   * 恢复成功后补写一条同 stage 的「恢复自 …」快照，保证恢复动作本身也有记录。
   */
  const restoreSnapshot = useCallback(
    async (snap: StageSnapshotRow, clearDownstream: boolean) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读——快照恢复会大面积覆盖产物（必拦）
      const cur = activeProjectRef.current
      if (!cur) return
      setSnapshotBusyId(snap.id)
      try {
        const payload = (snap.payload ?? {}) as Record<string, unknown>
        const patch: Partial<BidProjectRecord> = {}
        if (snap.stage === "parse") {
          if (payload.parse_report) patch.parse_report = normalizeParseReport(payload.parse_report as ParseReport)
          if (clearDownstream) {
            patch.bid_outline = []
            patch.bid_chapters = []
            patch.response_map = null
            patch.dup_report = null
            patch.void_check = null
            patch.ai_review = null
            patch.manual_review = null
            patch.submission_check = null
            patch.stage_gates = emptyStageGates()
          }
        } else if (snap.stage === "outline") {
          if (Array.isArray(payload.outline)) patch.bid_outline = normalizeOutline(payload.outline as OutlineNode[])
          if (clearDownstream) {
            patch.bid_chapters = []
            patch.response_map = null
            patch.dup_report = null
            patch.void_check = null
            patch.ai_review = null
            patch.manual_review = null
            patch.submission_check = null
            patch.stage_gates = emptyStageGates()
          }
        } else if (snap.stage === "chapter") {
          const chId = String(payload.chapter_id ?? "")
          const content = typeof payload.content === "string" ? payload.content : ""
          if (!chId || !cur.bid_chapters.some((c) => c.node_id === chId)) {
            toast.error("该快照对应的章节已不在当前大纲中，无法恢复")
            setSnapshotBusyId("")
            return
          }
          updateChapter(chId, { content, gen_status: "done" })
          if (activeChapterId === chId) {
            editingContentRef.current = content
            setEditingContentState(content)
          }
        } else if (snap.stage === "check") {
          if (payload.dup_report) patch.dup_report = payload.dup_report as DupReport
          if (payload.void_check) patch.void_check = normalizeVoidCheck(payload.void_check as VoidCheck)
          if (payload.submission_check) {
            patch.submission_check = normalizeSubmissionCheck(
              payload.submission_check as SubmissionCheck,
              scoringItemsFromReport(cur.parse_report),
            )
          }
        } else if (snap.stage === "eval") {
          if (payload.ai_review) patch.ai_review = normalizeAiReview(payload.ai_review as AiReview)
        } else if (snap.stage === "reset") {
          if (payload.parse_report) patch.parse_report = normalizeParseReport(payload.parse_report as ParseReport)
          if (Array.isArray(payload.outline)) patch.bid_outline = normalizeOutline(payload.outline as OutlineNode[])
          if (Array.isArray(payload.chapters)) patch.bid_chapters = payload.chapters as Chapter[]
        }
        if (Object.keys(patch).length) updateProject(patch)
        if (patch.bid_outline) setOutlineDraft(patch.bid_outline)
        if (patch.bid_chapters) {
          const chapters = patch.bid_chapters as Chapter[]
          setOutlineDraft(patch.bid_outline ?? (payload.outline as OutlineNode[]) ?? [])
          setActiveChapterId(chapters[0]?.node_id ?? null)
          editingContentRef.current = ""
          setEditingContentState("")
        }
        const when = snap.created ? formatDateTimeDisplay(snap.created) : "更早时间"
        writeStageSnapshot(snap.stage as SnapshotStage, `恢复自 ${when} 快照`, payload)
        toast.success("已恢复该历史版本")
      } catch {
        toast.error("恢复失败，请稍后重试")
      } finally {
        setSnapshotBusyId("")
      }
    },
    [activeChapterId, blockIfArchived, updateChapter, updateProject, writeStageSnapshot],
  )

  /** 重置项目为初始状态：重置前自动留全量快照，清空解析/大纲/正文/全部报告与闸门 */
  const resetProject = useCallback(() => {
    const cur = activeProjectRef.current
    if (!cur) return
    if (archivedLockedRef.current) {
      // 循环 6 A1（数据损坏级）：归档项目严禁被一键重置清空——专用提示，引导先解除归档
      toast.error("已归档项目不可重置，请先解除归档")
      setResetConfirmOpen(false)
      return
    }
    setResetConfirmOpen(false)
    writeStageSnapshot("reset", "重置前全量备份", {
      parse_report: cur.parse_report,
      outline: cur.bid_outline,
      chapters: cur.bid_chapters,
    })
    updateProject({
      parse_report: null,
      bid_outline: [],
      bid_chapters: [],
      response_map: null,
      dup_report: null,
      void_check: null,
      ai_review: null,
      manual_review: null,
      submission_check: null,
      stage_gates: emptyStageGates(),
      stage: "pending_parse",
    })
    setOutlineDraft([])
    setActiveChapterId(null)
    editingContentRef.current = ""
    setEditingContentState("")
    setActiveStep(1)
    toast.success("项目已重置为初始状态，此前的工作已存入工作记录，可随时恢复")
  }, [updateProject, writeStageSnapshot])

  // ------------------------------ ⑦ 关联商机 + 投标结果登记与回流（第四轮改造） ------------------------------
  const activeOppOptions = useMemo(
    () => sortOppsByHospital(oppOptions, activeProject?.hospital ?? ""),
    [oppOptions, activeProject],
  )

  const linkedOpportunityName = useMemo(() => {
    const oid = activeProject?.opportunity_id
    if (!oid) return ""
    return oppOptions.find((o) => o.id === oid)?.opp_name ?? "已关联商机"
  }, [oppOptions, activeProject])

  /** 流水线头部选择/清除关联商机：选择即 PATCH bid_projects.opportunity_id */
  const linkOpportunity = useCallback(
    (oppId: string) => {
      if (blockIfArchived()) return // 循环 6 A1：归档只读——关联商机写 opportunity_id
      const cur = activeProjectRef.current
      if (!cur) return
      updateProject({ opportunity_id: oppId })
      setSyncFailedStep("")
      if (oppId) toast.success("已关联商机，登记中标/失单结果后将自动同步到客户管理")
      else toast.success("已取消商机关联")
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockIfArchived, updateProject],
  )

  const [resultFormOpen, setResultFormOpen] = useState(false)
  const [resultDraft, setResultDraft] = useState<BidResult>("won")
  const [bidAmountDraft, setBidAmountDraft] = useState("")
  const [resultLostReasonDraft, setResultLostReasonDraft] = useState("")
  const [resultSaving, setResultSaving] = useState(false)
  const [syncFailedStep, setSyncFailedStep] = useState<"" | "stage" | "record" | "stamp">("")

  const openResultForm = useCallback(() => {
    const cur = activeProjectRef.current
    setResultDraft(cur?.bid_result ? cur.bid_result : "won")
    setBidAmountDraft(cur?.bid_amount ? String(cur.bid_amount) : "")
    setResultLostReasonDraft(cur?.lost_reason ?? "")
    setResultFormOpen(true)
  }, [])

  const closeResultForm = useCallback(() => setResultFormOpen(false), [])

  /**
   * 回流动作（串行）：① PATCH opportunities.stage（lost 同时写 lost_reason）
   * ② POST follow_records 自动跟进记录 ③ 回写 bid_projects.result_synced_at。
   * skipFollowIfSynced=true 用于「重新同步商机」：result_synced_at 已写入说明跟进记录已落库，不重复写。
   */
  const syncResultToOpportunity = useCallback(
    async (rec: BidProjectRecord, skipFollowIfSynced: boolean): Promise<boolean> => {
      const result = rec.bid_result
      if (!rec.opportunity_id || (result !== "won" && result !== "lost")) return true
      let updatedOpp: OpportunityRow | null = null
      try {
        const patch: Record<string, unknown> = { stage: result }
        if (result === "lost") patch.lost_reason = rec.lost_reason || ""
        updatedOpp = await apiFetch<OpportunityRow>(`/api/opportunities/${rec.opportunity_id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      } catch {
        setSyncFailedStep("stage")
        toast.error("结果已保存在本项目，但同步商机阶段失败，可点「重新同步商机」重试")
        return false
      }
      if (!(skipFollowIfSynced && rec.result_synced_at)) {
        try {
          await apiFetch("/api/follow_records", {
            method: "POST",
            body: JSON.stringify({
              rh_user_id: userId,
              customer_id: updatedOpp?.customer_id ?? "",
              opportunity_id: rec.opportunity_id,
              record_type: "其他",
              content: resultFollowContent(rec.project_name, result, rec.bid_amount, rec.lost_reason),
              stage_change: "",
            }),
          })
        } catch {
          setSyncFailedStep("record")
          toast.error("商机阶段已更新，但写入跟进记录失败，可点「重新同步商机」重试")
          return false
        }
      }
      try {
        const stamp = new Date().toISOString()
        await apiFetch(`/api/bid_projects/${rec.id}`, {
          method: "PATCH",
          body: JSON.stringify({ result_synced_at: stamp }),
        })
        updateProject({ result_synced_at: stamp }, { persist: false })
      } catch {
        setSyncFailedStep("stamp")
        toast.error("回流已完成，但同步时间回写失败，可点「重新同步商机」重试")
        return false
      }
      setSyncFailedStep("")
      return true
    },
    [updateProject, userId],
  )

  const submitBidResult = useCallback(async () => {
    if (blockIfArchived()) return // 循环 6 A1：归档只读——结果登记写 bid_result 并回流商机（必拦）
    const cur = activeProjectRef.current
    if (!cur) return
    const result = resultDraft
    if (result !== "won" && result !== "lost" && result !== "pending") {
      toast.error("请选择投标结果")
      return
    }
    // A2 修复：仅当确实要改金额时才 PATCH bid_amount —— won 留空且原有金额非空 → 保留原值不动；
    // lost/pending 改判不再清空历史中标金额（供复盘统计）
    let amount: number | null = cur.bid_amount ?? null
    let includeAmount = false
    let amountKept = false
    if (result === "won") {
      if (bidAmountDraft.trim()) {
        const parsed = Number(bidAmountDraft)
        if (!Number.isFinite(parsed) || parsed < 0) {
          toast.error("中标金额请填写非负数字（单位：万元）")
          return
        }
        amount = parsed
        includeAmount = true
      } else if (cur.bid_amount !== null && cur.bid_amount !== undefined) {
        amountKept = true
      }
    }
    const reason = result === "lost" ? resultLostReasonDraft.trim() : ""
    setResultSaving(true)
    const merged: BidProjectRecord = { ...cur, bid_result: result, bid_amount: amount, lost_reason: reason }
    const patchBody: Record<string, unknown> = { bid_result: result, lost_reason: reason }
    if (includeAmount) patchBody.bid_amount = amount
    try {
      // 结果字段先落本项目：后续回流任一步失败都不影响登记本身
      await apiFetch(`/api/bid_projects/${cur.id}`, {
        method: "PATCH",
        body: JSON.stringify(patchBody),
      })
    } catch {
      toast.error("结果登记保存失败，请检查网络后重试")
      setResultSaving(false)
      return
    }
    applyProjectState(merged)
    setResultFormOpen(false)
    setSyncFailedStep("")
    // A2 修复：won 金额留空但项目已有金额 → 明确告知保留原值
    if (amountKept) toast.info("金额未改动，保留原值")
    if ((result === "won" || result === "lost") && merged.opportunity_id) {
      const ok = await syncResultToOpportunity(merged, false)
      if (ok) {
        toast.success(result === "won" ? "已登记中标，商机阶段与跟进记录已同步到客户管理" : "已登记失单，商机阶段与跟进记录已同步到客户管理")
      }
    } else if (result === "pending") {
      toast.success("已登记为待定，结果确定后可点「修改」重新登记并同步")
    } else {
      toast.success("投标结果已登记，关联商机后登记结果将自动同步到客户管理")
    }
    setResultSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidAmountDraft, blockIfArchived, resultDraft, resultLostReasonDraft, syncResultToOpportunity])

  /** 重新同步商机：以 result_synced_at 是否已写入判断是否跳过跟进记录，避免重复写 */
  const retrySyncResult = useCallback(async () => {
    if (blockIfArchived()) return // 循环 6 A1：归档只读——重新同步会改商机阶段与跟进记录
    const cur = activeProjectRef.current
    if (!cur) return
    if (!cur.opportunity_id) {
      toast.error("还没有关联商机，请先在流水线头部选择关联商机")
      return
    }
    if (cur.bid_result !== "won" && cur.bid_result !== "lost") {
      toast.error("当前结果无需同步商机")
      return
    }
    setResultSaving(true)
    const ok = await syncResultToOpportunity(cur, true)
    if (ok) toast.success("已重新同步到客户管理商机")
    setResultSaving(false)
  }, [blockIfArchived, syncResultToOpportunity])

  // ------------------------------ 快捷工具 ------------------------------
  const [toolKind, setToolKind] = useState<ToolKind>("parse")
  const [toolMaterial, setToolMaterialState] = useState("")
  const toolMaterialRef = useRef("")
  const setToolMaterial = useCallback((value: string) => {
    toolMaterialRef.current = value
    setToolMaterialState(value)
  }, [])
  const [toolBidText, setToolBidText] = useState("")
  const [toolFileBusy, setToolFileBusy] = useState(false)
  const [toolRunning, setToolRunning] = useState(false)
  const [toolParseResult, setToolParseResult] = useState<ParseReport | null>(null)
  const [toolDupResult, setToolDupResult] = useState<DupReport | null>(null)
  const [toolVoidResult, setToolVoidResult] = useState<VoidCheck | null>(null)
  const [toolEvalResult, setToolEvalResult] = useState<AiReview | null>(null)

  const switchTool = useCallback((kind: ToolKind) => {
    setToolKind(kind)
    setToolMaterial("")
    setToolBidText("")
    setToolParseResult(null)
    setToolDupResult(null)
    setToolVoidResult(null)
    setToolEvalResult(null)
  }, [])

  const handleToolFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return
    setToolFileBusy(true)
    try {
      const text = await extractTenderFileText(file)
      if (!text) {
        toast.error("没有从文件中提取到文字，扫描版文档请改用粘贴文本方式")
        return
      }
      setToolMaterial(text)
      toast.success(`已解析「${file.name}」，共 ${text.length} 字`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "文件解析失败，请改用粘贴文本方式")
    } finally {
      setToolFileBusy(false)
    }
  }, [])

  const runToolDup = useCallback(async () => {
    if (!toolMaterial.trim()) throw new Error("标书正文为空，请先粘贴或上传内容")
    const targets = [{ nodeId: "", chapter: "上传的标书正文", text: toolMaterial }]
    const others = projects.filter((p) => (p.bid_chapters ?? []).some((c) => c.content?.trim()))
    if (!others.length) throw new Error("还没有可对比的历史投标项目，请先在「投标项目」里完成至少一个标书")
    const pairs = findSuspectPairs(
      targets,
      others.flatMap((o) =>
        o.bid_chapters.filter((c) => c.content?.trim()).map((c) => ({ project: o.project_name, chapter: c.title, text: c.content })),
      ),
    )
    let judged = pairs
    if (pairs.length) {
      const raw = await llmGenerate(buildDupJudgeMessages(pairs), MAX_TOKENS_OUTLINE)
      const rec = extractJsonLoose(raw) as Record<string, unknown>
      const results = Array.isArray(rec?.results) ? (rec.results as Record<string, unknown>[]) : []
      judged = pairs.map((pair, i) => {
        const hit = results.find((r) => Number(r?.index) === i + 1) ?? results[i]
        const verdictRaw = String(hit?.ai_verdict ?? "")
        const verdict = verdictRaw === "high" || verdictRaw === "medium" || verdictRaw === "low" ? verdictRaw : ""
        return { ...pair, ai_verdict: verdict as DupPair["ai_verdict"], ai_note: String(hit?.ai_note ?? "") }
      })
    }
    setToolDupResult({ pairs: judged, scanned_projects: others.length, suspect_count: judged.length, checked_at: new Date().toISOString() })
  }, [projects, toolMaterial])

  const runToolVoid = useCallback(async () => {
    const clauses = toolMaterial
      .split(/\n+/)
      .map((l) => l.replace(/^\d+[.、]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 30)
    if (!clauses.length) throw new Error("请先在「废标条款」框里粘贴条款，每行一条")
    if (!toolBidText.trim()) throw new Error("请先粘贴或上传投标文件正文")
    const raw = await llmGenerate(buildVoidCheckMessages(clauses, chaptersToTextStub(toolBidText)), MAX_TOKENS_LONGFORM)
    setToolVoidResult(sanitizeVoidCheck(extractJsonLoose(raw), clauses))
  }, [toolBidText, toolMaterial])

  const runToolEval = useCallback(async () => {
    const scoring = parseScoringLines(toolMaterial)
    if (!scoring.length) throw new Error("请先粘贴评分办法，每行一条，格式「评分项：分值」")
    if (!toolBidText.trim()) throw new Error("请先粘贴或上传投标文件正文")
    const scoringText = scoring.map((s) => `${s.item}（${s.score} 分）：${s.criteria || "—"}`).join("\n")
    // 改造 6：工具路径把上传正文包装成单章数组（单章时按全文注入，不做 400 字摘要截断）
    const stubChapters: Chapter[] = [
      { node_id: "", title: "上传的投标文件正文", sections: [], content: toolBidText, gen_status: "done" },
    ]
    const raw = await llmGenerate(buildEvalMessages(scoringText, stubChapters), MAX_TOKENS_LONGFORM)
    setToolEvalResult(sanitizeAiReview(extractJsonLoose(raw), scoring))
  }, [toolBidText, toolMaterial])

  const runQuickToolInner = useCallback(async () => {
    setToolRunning(true)
    try {
      if (toolKind === "dup") await runToolDup()
      else if (toolKind === "void") await runToolVoid()
      else await runToolEval()
      toast.success(`${TOOL_LABEL[toolKind]}完成`)
    } catch (e) {
      handleLlmError(e, "执行失败，请重试")
    } finally {
      setToolRunning(false)
    }
  }, [handleLlmError, runToolDup, runToolEval, runToolVoid, toolKind])

  const runQuickTool = useCallback(() => {
    if (!requireLogin()) return
    // 解析工具先弹「招标文件解析配置」弹窗，确认后按勾选范围解析
    if (toolKind === "parse") {
      openParseConfig("tool")
      return
    }
    if (!toolMaterial.trim()) {
      toast.error(toolKind === "dup" ? "请先上传或粘贴待查重的标书正文" : "请先粘贴材料内容")
      return
    }
    const priceText =
      toolKind === "dup"
        ? `本地粗筛后仅将可疑段落交 AI 复判，${costText()}`
        : `将调用 AI 执行「${TOOL_LABEL[toolKind]}」，${costText()}`
    costConfirm.runWithCostConfirm(() => {
      void runQuickToolInner()
    }, priceText)
  }, [costConfirm, openParseConfig, requireLogin, runQuickToolInner, toolKind, toolMaterial])

  const saveToolAsProject = useCallback(async () => {
    if (!requireLogin()) return
    const suffix = new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace(/\//g, "")
    const projName = `${TOOL_LABEL[toolKind]}结果 ${suffix}`
    try {
      const payload: Record<string, unknown> = {
        rh_user_id: userId,
        project_name: projName,
        tender_no: "",
        hospital: "",
        stage: "pending_parse",
        tender_text: toolKind === "parse" ? toolMaterial : toolBidText || toolMaterial,
        parse_report: toolKind === "parse" ? toolParseResult : null,
        parse_config: toolKind === "parse" ? toolParseConfig : null,
        bid_outline: [],
        bid_chapters: [],
        response_map: null,
        dup_report: toolKind === "dup" ? toolDupResult : null,
        void_check: toolKind === "void" ? toolVoidResult : null,
        ai_review: toolKind === "eval" ? toolEvalResult : null,
        manual_review: null,
      }
      const record = normalizeRecord(await apiFetch<BidProjectRecord>("/api/bid_projects", {
        method: "POST",
        body: JSON.stringify(payload),
      }))
      setProjects((prev) => [record, ...prev.filter((p) => p.id !== record.id)])
      toast.success(`已另存为投标项目「${projName}」，可在项目列表继续完善`)
    } catch {
      toast.error("保存失败，请稍后重试")
    }
  }, [requireLogin, toolBidText, toolDupResult, toolEvalResult, toolKind, toolMaterial, toolParseConfig, toolParseResult, toolVoidResult, userId])

  const toolHasResult = toolKind === "parse" ? !!toolParseResult : toolKind === "dup" ? !!toolDupResult : toolKind === "void" ? !!toolVoidResult : !!toolEvalResult

  // ------------------------------ 派生数据 ------------------------------
  const stageLabel = activeProject ? displayStageLabel(activeProject) : ""

  // 下游环节依赖的解析项缺失清单（用于中文提示 + 跳转按钮，不静默失败）
  const outlineMissingTitles = useMemo(() => {
    const rep = activeProject?.parse_report ?? null
    if (!rep || hasAnySection(rep, OUTLINE_DEPEND_KEYS)) return [] as string[]
    return missingSectionTitles(rep, OUTLINE_DEPEND_KEYS)
  }, [activeProject])
  const voidMissingTitles = useMemo(() => {
    const rep = activeProject?.parse_report ?? null
    return sectionText(rep, "void_items").trim() ? ([] as string[]) : ["无效标与废标项"]
  }, [activeProject])
  const evalMissingTitles = useMemo(() => {
    const rep = activeProject?.parse_report ?? null
    return combinedScoringText(rep).trim() ? ([] as string[]) : ["技术评分要求", "商务评分要求"]
  }, [activeProject])
  const goParseStep = useCallback(() => setActiveStep(2), [])

  return {
    // 登录 / 计费
    userId,
    handleAccountChange,
    costConfirm,
    // 视图
    mainView,
    setMainView,
    mode,
    activeStep,
    setActiveStep,
    backToList,
    // 项目列表
    projects: filteredProjects,
    projectsCapped,
    listLoading,
    searchKeyword,
    setSearchKeyword,
    newDialogOpen,
    setNewDialogOpen,
    openNewDialog,
    formProjectName,
    setFormProjectName,
    formTenderNo,
    setFormTenderNo,
    formHospital,
    setFormHospital,
    formBidOpenDate,
    setFormBidOpenDate,
    creating,
    createProject,
    deleteProject,
    openProject,
    // 第十一轮改造 1：视图切换 / 软删回收站 / 归档
    listView,
    setListView,
    recentDeleted,
    softDeleteProject,
    restoreProject,
    setProjectArchived,
    // 当前项目
    activeProject,
    stageLabel,
    updateProject,
    // ① 招标文件
    tenderDraft,
    setTenderDraft,
    fileBusy,
    handleTenderFile,
    saveTenderText,
    // 第十七轮 17D：范本与资料分离（导入区两个槽）
    refTemplateDraft,
    setRefTemplateDraft,
    refMaterialsDraft,
    setRefMaterialsDraft,
    handleRefFile,
    refFileBusy,
    // R167：标书优质素材库（五类标准件）
    saveMaterialLibrary,
    applyLibraryDefaults,
    importLibraryFile,
    classifyLibraryDraft,
    // ② 解析
    parseLoading,
    parseChunkProgress,
    parseChunkWarnings,
    toolParseWarnings,
    startParse,
    updateParseReport,
    reparseSection,
    reparseToolSection,
    reparseBusyKey,
    // ② 解析配置弹窗
    parseConfigOpen,
    closeParseConfig,
    parseConfigScope: cfgScope,
    setParseConfigScope,
    parseConfigExtras: cfgExtras,
    toggleParseExtra,
    setAllParseExtras,
    parseConfigStar: cfgStar,
    setParseConfigStar,
    parseConfigChannel: cfgChannel,
    setParseConfigChannel,
    rescanStarClauses,
    parseConfigTotal,
    saveParseConfig,
    confirmStartParse,
    // ③ 编制
    outlineDraft,
    outlineLoading,
    outlineResidueFixes,
    mustWriteRescued,
    catalogDiff,
    addMissingCatalogToOutline,
    generateOutline,
    outlineLevel,
    setOutlineLevel,
    targetPages,
    setTargetPages,
    estimatedPages,
    figuresEnabled,
    setFiguresEnabled,
    // 第五轮改造 1/2：持久化设置与大纲规模
    sectionWords,
    setSectionWords,
    // 第十三轮改造 3：生成设置两个用户自选开关（随项目持久化）
    genOptions,
    setClauseResponse,
    setMaterialBoost,
    setGenerateDemo,
    demoScoreSummary,
    scoringSuggestions,
    insertDemoSkeleton,
    setWordRefine,
    setAutoConsistencyAudit,
    // 05 三模式：合规严格度（随项目持久化）
    complianceMode,
    setComplianceMode,
    // 用户反馈轮项 3：大纲商务标章节开关（随项目持久化）
    setIncludeBiz,
    // R206 切片 1（R-002）：内容范围三模式（随项目持久化）
    scope,
    setScope,
    // 用户反馈轮：关闭商务标开关时的存量章移除确认（null=不弹）
    bizRemoveCount,
    confirmRemoveBizChapters,
    cancelRemoveBizChapters,
    // 循环 7 A4：章间互查相似度阈值（随项目持久化）
    intraDupThreshold,
    setIntraDupThreshold,
    // 第十七轮 17C：格式配置与格式规则检查项（随项目持久化；null=导出走现状默认）
    formatSettings,
    effectiveFormatSettings,
    formatCheckItems,
    setFormatSettingsPatch,
    setFormatMarginsPatch,
    setFormatHeadingLevel,
    setFormatBodyPatch,
    setFormatTablePatch,
    toggleFormatCheckItem,
    setAllFormatCheckItems,
    // 第十七轮 17B：编制依据与规范库（撰写样式 / 合并清单 / 规范库补选对话框）
    basisStyle,
    setBasisStyle,
    basisParsedItems,
    basisExtraItems,
    basisMergedItems,
    toggleBasisStandard,
    clearBasisExtra,
    standardsPickerOpen,
    openStandardsPicker,
    closeStandardsPicker,
    // 第十六轮 B1：全局事实设定（面板编辑态 / AI 生成 / 保存 / 一致性核对）
    globalFactsSource,
    factDraft,
    setFactDraft,
    factAiBusy,
    startGenerateFactSettings,
    saveGlobalFacts,
    canFactCheck,
    factProjectName,
    factCheckBusy,
    factCheckResult,
    factCheckOpen,
    setFactCheckOpen,
    startFactCheck,
    // 循环 2 批 1：一键修复矛盾（补丁式替换）+ 自家身份词（暗标脱敏 / identity_leak 检查共用）
    factPatchBusy,
    startFactPatch,
    identityWords,
    setIdentityWords,
    // 第十六轮 B2：预编排（表格/配图）+ 全文配图上限设置
    maxFigures,
    setMaxFigures,
    orchestrationSummary,
    orchestrationBusy,
    orchestrationProgress,
    startOrchestration,
    settingsSaved,
    leafTarget,
    outlineMissingTitles,
    outlineRename,
    outlineRemove,
    outlineAddChild,
    outlineAddRoot,
    outlineSetPart,
    outlineMove,
    confirmOutline,
    generateCommitmentLetter,
    importDialogOpen,
    setImportDialogOpen,
    importCandidates,
    importLoading,
    openImportDialog,
    importFromSolution,
    activeChapter,
    activeChapterId,
    selectChapter,
    editingContent,
    setEditingContent,
    autoSaveState,
    chapterBusy,
    generateChapter,
    regenerateChapter,
    // 2026-10 配图需求轮：上传截图 / 图模板库（用户自有架构图/流程图/系统截图复用）
    figureTemplates,
    figureUploadBusy,
    uploadChapterFigure,
    insertFigureTemplate,
    removeFigureTemplateById,
    // 第十五轮改造 4：小节级重写（大纲树小节行入口）
    regenerateSection,
    // 循环 5 A1：小节级局部扩写 / 缩写（条级重写按钮旁入口）
    resizeSection,
    continueChapter,
    refineChapter,
    bulkGenerating,
    genProgress,
    startBulkGenerate,
    cancelBulkGenerate,
    doneChapterCount,
    techChapterTotal,
    chapterBudgets,
    supplementState,
    sectionGenState,
    totalAdjustProgress,
    // 第十一轮改造 2：页数硬约束（信息条 + 一键补齐）
    pageCap,
    activeEffectivePages,
    pageInfo,
    startFillPages,
    wordRefineBusy,
    wordRefineState,
    startWordRefineAll,
    startWordRefineChapter,
    aiFigureBusy,
    aiFigureProgress,
    startAiFigures,
    // Q28 切片G：编排配图补齐
    figureBackfillBusy,
    figureBackfillProgress,
    figureBackfillPending,
    startFigureBackfill,
    textAuditBusy,
    startTextAudit,
    fixTyposBusy,
    startFixTypos,
    jumpToAuditChapter,
    pageFillBusy,
    // 第十一轮改造 6：三级目录点击定位
    contentFocus,
    focusSectionInChapter,
    // ③ 条款覆盖（改造 3）
    outlineClauseTotal: outlineClauses.length,
    coveredClauseCount,
    uncoveredClauses,
    addClauseToOutline,
    addAllClausesToOutline,
    // R-025 评分覆盖体检（按分值）
    scoreCheckup,
    addUncoveredScoringToOutline,
    // ③ 技术偏离表（改造 4）
    mapLoading,
    generateDeviationTable,
    deviationTable,
    deviationSummary,
    // R-022 技术参数落点
    techParamCoverage,
    addUncoveredTechParamsToOutline,
    clauseGranularity,
    setClauseGranularity,
    deviationClauseCount,
    jumpToResponseNode,
    exportDeviationWord,
    // 循环 5 A2：覆盖审计与补写（交卷体检环节消费；仅会话内结果，不落库）
    coverageAudit,
    coverageAuditBusy,
    startCoverageAudit,
    supplementFromAudit,
    // R103：按章聚合回注（章级改进建议 → 串行重写问题小节，一次费用确认）
    chapterReflowBusy,
    reflowChapterFromAudit,
    // r287：引文改写一键整改回注（bid-l2-verbatim 切片2·整改）
    quoteFixBusy,
    startQuoteRewriteFix,
    // 循环 5 A3：归档只读硬锁（顶部横幅 + 编辑控件禁用 + 解除归档）
    isArchivedLocked,
    unarchiveActiveProject,
    // ④ 查重
    dupLoading,
    runDupCheck,
    jumpToChapter,
    // ⑤ 废标检查
    voidLoading,
    startVoidCheck,
    toggleVoidManual,
    setVoidManualStatus,
    setVoidReviewStatus,
    voidMissingTitles,
    // ⑥ 模拟评标
    evalLoading,
    evalPathBusy,
    evalPathFailed,
    startAiReview,
    startEvalPathRerun,
    initManualReview,
    setManualScore,
    setManualComment,
    evalMissingTitles,
    goParseStep,
    // ⑥ 交卷体检（第七轮改造 5）
    submissionLoading,
    submissionFailed,
    startSubmissionCheck,
    setSubmissionReviewStatus,
    jumpToSubmissionGap,
    // ⑥ 讲标与答辩（第六轮改造）
    defense,
    defenseBusy,
    answerBusyId,
    pptSending,
    defenseConfirm,
    setDefenseConfirm,
    confirmDefenseRegenerate,
    defenseQuestionsReady,
    defenseOutlineReady,
    defenseSpeechReady,
    defenseAnsweredCount,
    startGenerateDefenseQuestions,
    startGenerateFullAnswer,
    updateDefenseQuestion,
    startGenerateDefenseOutline,
    updateDefenseOutlinePage,
    sendOutlineToPpt,
    startGenerateSpeechNotes,
    updateSpeechNotes,
    // ⑦ 归档
    exportBusy,
    exportBidWord,
    exportReport,
    exportAllDocs,
    archiveProject,
    // ⑦ 交卷闸门（第九轮改造 1）
    gatesUnconfirmed,
    allGatesConfirmed,
    voidCriticalUnresolved,
    confirmGate,
    resetGate,
    // 第十一轮改造 3：步骤条按产物放行
    requestStep,
    // 第十一轮改造 4/5：工作记录快照与项目重置
    stageHistory,
    stageHistoryLoading,
    loadStageHistory,
    restoreSnapshot,
    snapshotBusyId,
    resetProject,
    resetConfirmOpen,
    setResetConfirmOpen,
    // ⑦ 关联商机 + 结果登记回流（第四轮改造）
    oppOptions,
    oppOptionsCapped,
    dialogOppOptions,
    activeOppOptions,
    formOpportunityId,
    setFormOpportunityId,
    linkOpportunity,
    linkedOpportunityName,
    resultFormOpen,
    openResultForm,
    closeResultForm,
    resultDraft,
    setResultDraft,
    bidAmountDraft,
    setBidAmountDraft,
    resultLostReasonDraft,
    setResultLostReasonDraft,
    resultSaving,
    submitBidResult,
    retrySyncResult,
    syncFailedStep,
    // 快捷工具
    toolKind,
    switchTool,
    toolMaterial,
    setToolMaterial,
    toolBidText,
    setToolBidText,
    bidSourceMode: activeProject ? normalizeBidSourceMode(activeProject.bid_source_mode) : ("internal" as BidSourceMode),
    bidExternalText: activeProject?.bid_external_text ?? "",
    bidExternalBusy,
    setBidSourceMode,
    setBidExternalText,
    handleBidExternalFile,
    sealBusy,
    sealResult,
    startSealCheck,
    toolFileBusy,
    handleToolFile,
    toolRunning,
    runQuickTool,
    toolParseResult,
    toolDupResult,
    toolVoidResult,
    toolEvalResult,
    toolHasResult,
    saveToolAsProject,
    // 模型选择（统一网关）
    modelOptions,
    selectedModelKey,
    handleSelectModel,
    // 全站技能带入（标书侧 5 个功能点）
    parseSkills,
    bidOutlineSkills,
    bidChapterSkills,
    deviationSkills,
    defenseSkills,
  }
}

/** 工具视图的正文没有章节结构，包装成 chaptersToText 兼容的纯文本 */
function chaptersToTextStub(text: string): string {
  return chaptersToText([{ node_id: "", title: "", sections: [], content: text, gen_status: "done" as const }])
}

// Q28 切片A（天好 Skill 移植）：投标正文统一取数——external 用上传/粘贴全文，internal 用编制章节。
// 老数据缺列容错 internal，行为与现状逐字一致（resolveBidText/bidChaptersFor 对 internal 直接透传）。
function isExternalBid(cur: { bid_source_mode?: unknown }): boolean {
  return normalizeBidSourceMode(cur.bid_source_mode) === "external"
}

/** 取投标纯文本（废标/评标/交卷体检共用） */
export function resolveBidText(cur: BidProjectRecord): string {
  if (isExternalBid(cur)) return chaptersToTextStub(cur.bid_external_text ?? "")
  return chaptersToText(cur.bid_chapters)
}

/** 取 Chapter[]（评标三路 / 交卷体检需要章节结构）：external 合成单章 stub */
export function bidChaptersFor(cur: BidProjectRecord): Chapter[] {
  if (isExternalBid(cur)) {
    const text = (cur.bid_external_text ?? "").trim()
    if (!text) return []
    return [{ node_id: "", title: "外部投标文件全文", sections: [], content: text, gen_status: "done" }]
  }
  return cur.bid_chapters
}

/**
 * 循环 5 A2：审计用节正文摘录（本地拼装零 AI）——优先按 section_stats 确定性切片取该节片段，
 * 统计缺失时回退标题行定位（截到下一个编号标题行）；统一截断到 max 字控 token。
 */
function auditLeafExcerpt(ch: Chapter | undefined, sectionTitle: string, max = 800): string {
  const content = (ch?.content ?? "").trim()
  if (!content) return ""
  const needle = (sectionTitle ?? "").trim()
  if (!needle) return content.slice(0, max)
  const stats = ch?.section_stats
  const sections = ch?.sections ?? []
  const idx = sections.findIndex((s) => s.trim() === needle)
  if (stats?.length && idx >= 0) {
    const piece = (sliceSectionPieces(content, stats)[idx] ?? "").trim()
    if (piece) return piece.slice(0, max)
  }
  const lines = content.split("\n")
  const start = lines.findIndex((l) =>
    l.trimStart().replace(/^\d+(\.\d+)*\s*/, "").startsWith(needle),
  )
  if (start < 0) return ""
  const out: string[] = []
  let total = 0
  for (let i = start; i < lines.length && total < max; i++) {
    if (i > start && /^\d+(\.\d+)+\s/.test(lines[i].trimStart()) && lines[i].trim().length < 40) break
    out.push(lines[i])
    total += lines[i].length + 1
  }
  return out.join("\n").trim().slice(0, max)
}

/**
 * 条款归章（改造 3④）：AI coverage 映射优先——node_title 命中章标题/小节标题即归该章；
 * 其余条款按标题相似度归章（assignClausesToChapters）；每章上限 15 条防 prompt 过长。
 */
function mapClausesToChapters(
  clauses: RequirementClause[],
  coverage: OutlineCoverageItem[],
  chapters: { title: string; sections?: string[]; part?: string }[],
): RequirementClause[][] {
  const per: RequirementClause[][] = chapters.map(() => [])
  if (!clauses.length || !chapters.length) return per
  const byId = new Map(clauses.map((c) => [c.id, c]))
  const assigned = new Set<string>()
  for (const item of coverage) {
    const cl = byId.get(item.clause_id)
    if (!cl || assigned.has(cl.id)) continue
    // 第十三轮改造 4：条款只映射到技术章（商务骨架章不承接条款应答）
    const idx = chapters.findIndex(
      (c) => !isBizPart(c) && (clauseMatchesTitle(item.node_title, c.title) || (c.sections ?? []).some((s) => clauseMatchesTitle(item.node_title, s))),
    )
    if (idx >= 0 && per[idx].length < 15) {
      per[idx].push(cl)
      assigned.add(cl.id)
    }
  }
  const rest = clauses.filter((c) => !assigned.has(c.id))
  if (rest.length) {
    const sim = assignClausesToChapters(rest, chapters)
    sim.forEach((list, i) => {
      if (isBizPart(chapters[i])) return
      for (const cl of list) {
        if (per[i].length < 15 && !per[i].some((x) => x.id === cl.id)) per[i].push(cl)
      }
    })
  }
  return per
}

export type UseBidWorkspace = ReturnType<typeof useBidWorkspace>

// R147（docx/重解析链按需化）：bidFiles 连带 docx + pdf worker 重依赖，
// 静态 import 会把它们打进 BidWorkspace 路由 chunk；薄封装保持调用点形态不变。
async function extractTenderFileText(file: File, opts?: { pageTag?: boolean }): Promise<string> {
  const m = await import("./bidFiles")
  return m.extractTenderFileText(file, opts)
}
