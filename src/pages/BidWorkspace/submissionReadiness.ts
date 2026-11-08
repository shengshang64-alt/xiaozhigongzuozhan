// ---------------------------------------------------------------------------
// 2026-10-23（P0-1 交卷清单）：把「散在各步骤的产物与门禁」汇成一张跨步骤总清单
//
// 背景（真实库盘点 32 个项目）：解析 97% → 正文 53% → 偏离表 16% → 废标检查 6% → 评标 3% → 投标结果 0%。
// 用户走完前三步就不走了，因为后四步是四个平级步骤，每个都要单独点、单独花钱，而没有任何一处告诉他们
// 「离交卷还差什么」。已有的 `archiveCardGuidance` 只回答「这一张卡能不能导」，不回答「整份标书能不能交」。
//
// 本模块只做判定，不做修复、不发请求、不花钱：纯函数，输入项目记录，输出带优先级的清单。
// 每一项都带 `step`，UI 据此给「去处理」按钮——提示必须有出路（本项目既有原则）。
// ---------------------------------------------------------------------------

import {
  effectiveVoidStatus,
  GATE_FATAL_RULES,
  numberScoringItems,
  outlineChapterScoringAlignment,
  type BidProjectRecord,
} from "./bidTypes"
import { missingCriticalSectionTitles } from "./parseCoverage"
import { runComposeGates } from "./composeGates"
import { evidenceLedgerOf } from "./evidenceLedger"
import { evaluateProseQuality } from "./proseQualityGate"
import { checkChapterIntegrity, reconcileChaptersWithOutline } from "./chapterIntegrity"
import { reconcileStarClauses, scanTenderText } from "./tenderTextQuality"
import { checkCaptionNumbering } from "./bidWritingRules"
import { countUnconfirmedSubjective } from "./subjectiveScores"

/** 严重度：blocking＝不解决就不能交（废标级/门禁阻断）；must＝应交未交；nice＝建议做但不阻断 */
export type ReadinessLevel = "blocking" | "must" | "nice"
export type ReadinessStatus = "done" | "todo" | "blocked"

export type ReadinessItem = {
  id: string
  title: string
  status: ReadinessStatus
  /** 已完成时写结果，未完成时写"缺什么/为什么" */
  detail: string
  /** 处理该事项所在的流水线步骤（1 起） */
  step: number
  level: ReadinessLevel
}

export type SubmissionReadiness = {
  items: ReadinessItem[]
  done: number
  todo: number
  blocked: number
  /** 可以交卷：没有阻断项、也没有应交未交项 */
  ready: boolean
}

const chapterHasText = (c: { content?: string | null } | null | undefined): boolean =>
  !!String(c?.content ?? "").trim()

export function buildSubmissionReadiness(rec: Partial<BidProjectRecord> | null): SubmissionReadiness {
  const items: ReadinessItem[] = []
  if (!rec) return { items, done: 0, todo: 0, blocked: 0, ready: false }
  // 容错：历史数据 / 残缺记录里 outline、chapters 可能是 JSON 字符串或 null，
  // 直接交给下游会在 filter 处抛错，整张交卷清单白屏（与 sectionText 的容错同口径）。
  const outline = Array.isArray(rec.bid_outline) ? rec.bid_outline : []
  const chapters = Array.isArray(rec.bid_chapters) ? rec.bid_chapters : []

  // ⓪ 招标原文有效性（P0 整改：模板稿/占位符导致的整链错误，先于一切）
  const textQ = scanTenderText(rec.tender_text)
  items.push(
    textQ.suspicious
      ? {
          id: "tender-text",
          title: "招标原文有效性",
          status: "blocked",
          detail: textQ.summary,
          step: 1,
          level: "blocking",
        }
      : { id: "tender-text", title: "招标原文有效性", status: "done", detail: textQ.summary, step: 1, level: "blocking" },
  )

  // ① 解析关键项（废标三件套 + 评分 + 响应要求 + 目录）
  const missingParse = missingCriticalSectionTitles(rec.parse_report ?? null)
  items.push(
    missingParse.length
      ? {
          id: "parse",
          title: "解析关键项",
          status: "blocked",
          detail: `缺 ${missingParse.length} 项：${missingParse.slice(0, 4).join("、")}${missingParse.length > 4 ? " 等" : ""}——评分、废标、响应要求任一项缺失，后面的编制与检查都建立在残报告上`,
          step: 2,
          level: "blocking",
        }
      : { id: "parse", title: "解析关键项", status: "done", detail: "评分、废标、资格、响应要求、目录均已解析", step: 2, level: "blocking" },
  )

  // ①b ★/▲ 条款数量对账（漏一条即可能废标）
  const star = reconcileStarClauses(rec.parse_report ?? null, rec.tender_text)
  items.push(
    star.missing
      ? { id: "star-reconcile", title: "★/▲ 条款对账", status: "blocked", detail: star.summary, step: 2, level: "blocking" }
      : star.warn
        ? { id: "star-reconcile", title: "★/▲ 条款对账", status: "todo", detail: star.summary, step: 2, level: "must" }
        : { id: "star-reconcile", title: "★/▲ 条款对账", status: "done", detail: star.summary, step: 2, level: "blocking" },
  )

  // ② 大纲与评分项一一对应
  const scoring = numberScoringItems(rec.parse_report ?? null)
  const align = outlineChapterScoringAlignment(outline, scoring)
  if (!outline.length) {
    items.push({ id: "outline", title: "投标大纲", status: "blocked", detail: "还没有大纲，正文无从生成", step: 3, level: "blocking" })
  } else if (align.itemsWithoutChapter.length) {
    items.push({
      id: "outline",
      title: "大纲与评分项对应",
      status: "blocked",
      detail: `${align.itemsWithoutChapter.length} 个评分项没有承接章：${align.itemsWithoutChapter.slice(0, 4).map((i) => i.name).join("、")}——评委按评分表逐项找章，缺一项直接丢分`,
      step: 3,
      level: "blocking",
    })
  } else {
    items.push({
      id: "outline",
      title: "大纲与评分项对应",
      status: "done",
      detail: `${align.techChapterCount} 个技术章覆盖 ${align.techItemCount} 个评分项${align.mergedChapters.length ? `（${align.mergedChapters.length} 处合并章待拆）` : "，无合并章"}`,
      step: 3,
      level: "must",
    })
  }

  // ③ 正文完整性（技术章是否都有正文）
  const techChapters = chapters.filter((c) => c.part !== "biz")
  const emptyChapters = techChapters.filter((c) => !chapterHasText(c))
  if (!techChapters.length) {
    items.push({ id: "content", title: "技术章正文", status: "blocked", detail: "确认大纲后还没有生成任何技术章", step: 3, level: "blocking" })
  } else if (emptyChapters.length) {
    items.push({
      id: "content",
      title: "技术章正文",
      status: "todo",
      detail: `${emptyChapters.length}/${techChapters.length} 个技术章没有正文（${emptyChapters.slice(0, 3).map((c) => c.title).join("、")}${emptyChapters.length > 3 ? " 等" : ""}）`,
      step: 3,
      level: "must",
    })
  } else {
    items.push({ id: "content", title: "技术章正文", status: "done", detail: `${techChapters.length} 个技术章均已有正文`, step: 3, level: "must" })
  }

  // ③b 章表与大纲一致（A1）：旧大纲遗留的同主题章会以「重复章」形式进 Word
  const rec1 = reconcileChaptersWithOutline(outline, chapters)
  if (rec1.blocking) {
    items.push({
      id: "chapter-reconcile",
      title: "章表与大纲一致",
      status: "blocked",
      detail: `${rec1.summary}——这些章不在当前大纲里却仍会导出，评委看到两份同主题章会当成结构失控；请按当前大纲整理章表（删除旧稿或合并）`,
      step: 3,
      level: "blocking",
    })
  } else if (!outline.length || !chapters.length) {
    items.push({
      id: "chapter-reconcile",
      title: "章表与大纲一致",
      status: "todo",
      detail: "尚无大纲或章表，对账待生成后自动进行",
      step: 3,
      level: "must",
    })
  } else {
    items.push({ id: "chapter-reconcile", title: "章表与大纲一致", status: "done", detail: rec1.summary, step: 3, level: "must" })
  }

  // ③c 正文落库一致性（A2）：分节产物是否真的拼回了章正文
  const integ = checkChapterIntegrity(chapters)
  if (integ.blocking) {
    items.push({
      id: "chapter-integrity",
      title: "正文落库一致性",
      status: "blocked",
      detail: `${integ.summary}——请对这几章重新生成或手工补齐，否则导出的是空壳章`,
      step: 3,
      level: "blocking",
    })
  } else if (integ.statsDrift.length) {
    items.push({ id: "chapter-integrity", title: "正文落库一致性", status: "todo", detail: integ.summary, step: 3, level: "must" })
  } else {
    items.push({ id: "chapter-integrity", title: "正文落库一致性", status: "done", detail: integ.summary, step: 3, level: "must" })
  }

  // ④ 编制门禁（A1-A6 阻断级）
  const gates = runComposeGates(outline, chapters, rec.parse_report ?? null, rec.gen_options?.scope ?? "both")
  items.push(
    gates.blockingCount > 0
      ? {
          id: "compose-gate",
          title: "编制门禁 A1-A6",
          status: "blocked",
          detail: `${gates.blockingCount} 项阻断级问题（★响应缺失 ${gates.A3_starFidelityGaps.reduce((a, g) => a + g.missingClauses.length, 0)} 条 / 目录缺落点 ${gates.A4_catalogGaps.filter((g) => !g.found && g.kind === "tech_required").length} 项 / 评分无落点 ${gates.A6_scoringLandingGaps.filter((g) => !g.hasLanding).length} 项）`,
          step: 3,
          level: "blocking",
        }
      : { id: "compose-gate", title: "编制门禁 A1-A6", status: "done", detail: "重复章、★响应、目录落点、评分落点均无阻断项", step: 3, level: "must" },
  )

  // ⑤ 技术偏离表
  const deviationRows = rec.response_map?.rows?.length ?? 0
  items.push(
    deviationRows
      ? { id: "deviation", title: "技术偏离表", status: "done", detail: `${deviationRows} 条条款已逐条响应`, step: 3, level: "must" }
      : { id: "deviation", title: "技术偏离表", status: "todo", detail: "还没有偏离表——评委核对技术响应时按这张表看", step: 3, level: "must" },
  )

  // ⑤b UX-R3 S12：主观分逐条确认（isSubjective=true 的评分项须人工确认应对策略）
  // ⚠️ level=must 而非 blocking：主观分策略属人工判断，不卡死流程，但必须显式提醒。
  const subjective = countUnconfirmedSubjective(rec)
  if (subjective.total > 0) {
    items.push(
      subjective.unconfirmed > 0
        ? {
            id: "subjective-confirm",
            title: "主观分逐条确认",
            status: "todo",
            detail: `还有 ${subjective.unconfirmed} 条主观分未确认应对策略（共 ${subjective.total} 条）——评委的人工打分点，建议逐条写清怎么拿分`,
            step: 3,
            level: "must",
          }
        : {
            id: "subjective-confirm",
            title: "主观分逐条确认",
            status: "done",
            detail: `${subjective.total} 条主观分均已确认应对策略`,
            step: 3,
            level: "must",
          },
    )
  }

  // ⑥ 废标检查（做过 ≠ 干净）
  const voidItems = rec.void_check?.items ?? []
  const criticalPending = voidItems.filter(
    (it) => effectiveVoidStatus(it) !== "compliant" && it.severity === "critical" && it.review_status === "pending",
  ).length
  if (!voidItems.length) {
    items.push({ id: "void", title: "废标项检查", status: "todo", detail: "还没跑过废标检查——资格/符合性/★负偏离任一漏判即出局", step: 4, level: "blocking" })
  } else if (criticalPending) {
    items.push({
      id: "void",
      title: "废标项检查",
      status: "blocked",
      detail: `${criticalPending} 条废标级条款未核销（共 ${voidItems.length} 条已判定）——逐条核对或强制放行留痕`,
      step: 4,
      level: "blocking",
    })
  } else {
    items.push({ id: "void", title: "废标项检查", status: "done", detail: `${voidItems.length} 条已判定，无未核销的废标级条款`, step: 4, level: "blocking" })
  }

  // ⑦ 交卷体检（格式/数字/占位等本地规则）
  const formatHits = rec.submission_check?.format_report?.hits ?? []
  const fatalHits = formatHits.filter((h) => GATE_FATAL_RULES.has(h.rule)).length
  if (!(rec.submission_check?.items?.length ?? 0)) {
    items.push({ id: "submission", title: "交卷体检", status: "todo", detail: "还没做交卷体检（格式、数字口径、占位残留等本地规则）", step: 4, level: "must" })
  } else if (fatalHits) {
    items.push({ id: "submission", title: "交卷体检", status: "blocked", detail: `${fatalHits} 条废标级体检项待处置（引文保真/占位/报价上限等）`, step: 4, level: "blocking" })
  } else {
    items.push({ id: "submission", title: "交卷体检", status: "done", detail: `体检通过，共 ${formatHits.length} 条提示`, step: 4, level: "must" })
  }

  // ⑧ 证明材料挂载（证据台账）
  const ledger = evidenceLedgerOf(rec)
  if (!ledger.rows.length) {
    items.push({ id: "evidence", title: "证明材料挂载", status: "todo", detail: "解析报告里还没有评分项，无法生成证据台账", step: 2, level: "must" })
  } else if (ledger.pendingCount) {
    items.push({
      id: "evidence",
      title: "证明材料挂载",
      status: "todo",
      detail: `${ledger.pendingCount}/${ledger.rows.length} 个评分项的材料待挂载（正文里还是【待填写】或没有承接章）——导出时会附《评分点与证明材料索引表》`,
      step: 3,
      level: "must",
    })
  } else {
    items.push({ id: "evidence", title: "证明材料挂载", status: "done", detail: `${ledger.rows.length} 个评分项的材料已就位`, step: 3, level: "must" })
  }

  // ⑨ 正文可读性（段落长度；对齐真实交付基准）
  const prose = evaluateProseQuality(chapters)
  if (!prose.paragraphs) {
    items.push({ id: "prose", title: "正文可读性", status: "todo", detail: "还没有正文可评估段落长度", step: 3, level: "nice" })
  } else if (prose.level === "ok") {
    items.push({ id: "prose", title: "正文可读性", status: "done", detail: prose.detail, step: 3, level: "nice" })
  } else {
    items.push({
      id: "prose",
      title: "正文可读性",
      status: "todo",
      detail: `${prose.detail}——真实交付标书是一句一个事实、40~190 字一段；可点「一键拆段」本地重排（不花钱、不改字）`,
      step: 3,
      level: "nice",
    })
  }

  // ⑨b 图表题注编号——全书粒度（2026-10-26 标书官 P2 建议）
  //
  // 为什么必须在交卷体检里再来一遍，而不只靠章级徽标：
  //   章级检查（useBidWorkspace 对单章内容跑 checkCaptionNumbering）看不到跨章问题。
  //   题注的真正风险是**装订成册后全书重号**：每章各自从「表1-1」起编，单章检查各章
  //   都"连续"，装订后全书就是一堆重复编号，用户在 Word 里才发现。
  //   这里把全部技术章正文拼起来跑一次，才看得见跨章重号。
  //
  // 为什么定为 nice（建议级）而非 blocking：题注跳号会被评审当成文档不严谨，
  //   但不属废标项。给红徽标会把"格式瑕疵"说成"要废标"，红字可信度随即崩塌（本仓既有教训）。
  const allTechText = chapters
    .filter((c) => c.part !== "biz")
    .map((c) => String(c.content ?? ""))
    .join("\n")
  if (allTechText.trim()) {
    const capIssues = checkCaptionNumbering(allTechText)
    items.push(
      capIssues.length
        ? {
            id: "caption-numbering",
            title: "图表题注编号（全书）",
            status: "todo",
            detail: `${capIssues.slice(0, 3).join("；")}${capIssues.length > 3 ? ` 等 ${capIssues.length} 处` : ""}——装订成册后编号须全书连续，删改图表后要在 Word 里更新域`,
            step: 3,
            level: "nice",
          }
        : { id: "caption-numbering", title: "图表题注编号（全书）", status: "done", detail: "全书题注编号连续、无重号", step: 3, level: "nice" },
    )
  }

  // ⑩ 查重（建议项）
  items.push(
    rec.dup_report
      ? { id: "dup", title: "章间查重", status: "done", detail: "已生成查重报告", step: 4, level: "nice" }
      : { id: "dup", title: "章间查重", status: "todo", detail: "建议跑一次查重，避免章节之间大段重复拉低观感", step: 4, level: "nice" },
  )

  // ⑨ 模拟评标（建议项）
  items.push(
    rec.ai_review
      ? { id: "eval", title: "模拟评标", status: "done", detail: "已生成评标报告", step: 6, level: "nice" }
      : { id: "eval", title: "模拟评标", status: "todo", detail: "建议跑一次模拟评标，用评委视角找扣分点", step: 6, level: "nice" },
  )

  const done = items.filter((i) => i.status === "done").length
  const todo = items.filter((i) => i.status === "todo").length
  const blocked = items.filter((i) => i.status === "blocked").length
  // 「建议」级（查重/评标）没做也不拦交卷——它们提高质量，但不影响这份标书能不能交
  const ready = items.every((i) => i.status === "done" || i.level === "nice")
  return { items, done, todo, blocked, ready }
}
