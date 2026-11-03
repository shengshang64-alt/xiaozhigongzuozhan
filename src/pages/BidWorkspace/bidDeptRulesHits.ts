/**
 * 部门基础要求 → 交卷体检命中（纯本地零 AI，随体检白拿）。
 *
 * 为什么单独一层：规则本身在 `bidComplianceRules` / `bidWritingRules` 里是纯函数真源，
 * 但"用什么文本去扫、命中怎么截断、分几类"是**接线口径**，放在这里可单测，
 * 也让 useBidWorkspace 的 `buildFormatReportFor` 只多一行调用。
 *
 * 六类命中（各自独立 ≤20 条上限，互不挤占——长文场景下某一类动辄上百条，
 * 共用上限会把另一类整批挤出体检，闸门形同虚设，与既有 deviationCommitHits 同口径）：
 *  ① company_redline    招标侧：合同/商务条款里出现公司红线条款
 *  ② scoring_compliance 招标侧：评分设置踩了合规阈值（单项/证书/报告上限、技术分占比、副标得分率）
 *  ③ outdated_term      投标侧：旧称残留（卫生计生委 / 人口健康信息平台 / 3G、4G…）
 *  ④ project_residue    投标侧：别的医院名 / 别的项目编号
 *  ⑤ writing_voice      投标侧：自称口径、模糊参数、暗标身份泄漏
 *  ⑥ dedicated_section  大纲侧：承诺函 / 偏离表未单独成章
 *
 * 一律 `level: "warn"`——只提示不阻断。红线级是否升级为导出前硬门禁由用户拍板
 * （见 bidComplianceRules 模块头），这里不擅自升级。
 */
import type { FormatCheckHit, FormatCheckRule } from "./bidTypes"
import {
  checkScoringCompliance,
  COMPANY_REDLINE_RULES,
  findCompanyRedlineHits,
  findOutdatedTerms,
  findProjectResidue,
  type ScoringItemLike,
} from "./bidComplianceRules"
import { checkDedicatedSections, findCredentialClaimsWithoutEvidence, findLatexResidue, findPronounHits, findTableCaptionStatus, findVagueParamHits } from "./bidWritingRules"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/** 每类命中上限：与体检其它规则一致，防止单类刷屏挤掉别的类 */
export const DEPT_RULE_CAP = 20

export type DeptRulesInput = {
  /** 招标原文（+ 合同条款解析项）：公司红线条款的扫描基准 */
  tenderText: string
  /** 投标正文全文：旧称 / 残留 / 写作规范 的扫描基准 */
  bidText: string
  /** 评分项（技术+商务），来自解析报告 */
  scoringItems: ScoringItemLike[]
  /** 投标文件大纲（承诺函 / 偏离表专用章检查） */
  outline: { title: string; level?: number }[]
  /** 本项目自有值：残留扫描的排除项（自己的医院名/编号不能被报成"别人的"） */
  own?: { hospitals?: string[]; tenderNos?: string[]; companyNames?: string[] }
  /**
   * 已在**大纲之外**满足的专用件 key（如 deviation = 已生成技术偏离表）。
   * 真实标书实测：偏离表多以独立文件随标提交、不作为正文章节，不传就会天天误报"缺偏离表"。
   */
  satisfiedSections?: string[]
}

/** 大纲树 → 带层级的扁平标题表（专用章检查按 maxLevel 判层级，所以要带 level） */
export function flattenOutlineTitles(nodes: OutlineNode[] | null | undefined, level = 1): { title: string; level: number }[] {
  const out: { title: string; level: number }[] = []
  for (const n of nodes ?? []) {
    const title = String(n?.title ?? "").trim()
    if (title) out.push({ title, level })
    out.push(...flattenOutlineTitles(n?.children, level + 1))
  }
  return out
}

/** 截断到上限并把命中压成体检条目 */
function toHits(
  rule: FormatCheckRule,
  chapter: string,
  items: { quote: string }[],
  cap = DEPT_RULE_CAP,
): FormatCheckHit[] {
  return items.slice(0, cap).map((it) => ({ chapter, rule, quote: it.quote.slice(0, 80), level: "warn" as const }))
}

/**
 * 命中行只取关键词前后的一段窗口。
 * 直接截前 30 字会把关键词切掉——真实标书实测：体检里显示「自称口径『我方』不合规（第1575行：本项目一体化核心业务系统整体采用B/S…）」，
 * 用户照着那句话根本找不到「我方」，等于提示无效。有 inRow 时以它为中心取窗口。
 */
function lineWindow(line: string, word: string, span = 34): string {
  const s = String(line ?? "")
  const key = String(word ?? "")
  const at = key ? s.indexOf(key) : -1
  if (at < 0) return s.slice(0, span)
  const start = Math.max(0, at - Math.floor(span / 3))
  return (start > 0 ? "…" : "") + s.slice(start, start + span)
}

export function deptRulesHits(input: DeptRulesInput): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const tender = String(input.tenderText ?? "")
  const bid = String(input.bidText ?? "")

  // ① 公司红线条款（招标侧）——**按规则去重**：真实标书实测「履约保证金」在第 175/180/638/639/640…
  //    行各报一次，19 条命中里 15 条是同一规则的重复刷屏，等于把别的红线挤出体检。每条规则只报首处。
  if (tender.trim()) {
    const redlineRaw = findCompanyRedlineHits(tender)
    const seenRule = new Set<string>()
    const redline = redlineRaw.filter((h) => {
      if (seenRule.has(h.rule)) return false
      seenRule.add(h.rule)
      return true
    })
    hits.push(
      ...toHits(
        "company_redline",
        "招标文件",
        redline.map((h) => {
          // 窗口以**规则实际命中的那个词**为中心：只截行首会把关键词切掉，用户照着提示找不到原文
          const keyWord = String(h.text ?? "").match(COMPANY_REDLINE_RULES.find((r) => r.key === h.rule)?.re ?? /$^/)?.[0] ?? ""
          const total = redlineRaw.filter((x) => x.rule === h.rule).length
          return {
            quote: `${h.severity === "redline" ? "【红线】" : "【提示】"}${h.note}（第 ${h.line} 行：${lineWindow(h.text, keyWord, 40)}）${
              total > 1 ? `｜全文共 ${total} 处` : ""
            }`,
          }
        }),
      ),
    )
  }

  // ② 评分合规（招标侧）
  hits.push(
    ...toHits(
      "scoring_compliance",
      "评分办法",
      checkScoringCompliance(input.scoringItems ?? []).map((i) => ({
        quote: `${i.level === "redline" ? "【红线】" : "【提示】"}${i.subject}：${i.message}`,
      })),
    ),
  )

  // ③ 术语旧称（投标侧）
  if (bid.trim()) {
    hits.push(
      ...toHits(
        "outdated_term",
        "投标正文",
        findOutdatedTerms(bid).map((h) => ({ quote: `${h.term} → ${h.suggestion}（第 ${h.line} 行）` })),
      ),
    )
    // ④ 其他项目残留（投标侧）——自己的医院名/编号已在规则内排除
    hits.push(
      ...toHits(
        "project_residue",
        "投标正文",
        findProjectResidue(bid, input.own ?? {}).map((h) => ({
          quote: `${h.kind === "hospital" ? "别家医院名" : "别的项目编号"}「${h.value}」（第 ${h.line} 行）`,
        })),
      ),
    )
    // ⑤ 写作规范（投标侧）：自称口径 / 模糊参数
    // 刻意**不含**暗标身份泄漏——formatCheckReport 的 identity_leak 规则已在查同一件事，
    // 两处都报会让同一句话在体检里出现两遍，反而降低信噪比。
    const voice = [
      ...findPronounHits(bid).map((h) => ({ quote: `自称口径「${h.word}」不合规（第 ${h.line} 行：${lineWindow(h.text, h.word)}）` })),
      ...findVagueParamHits(bid).map((h) => ({ quote: `模糊参数「${h.word}」（第 ${h.line} 行：${lineWindow(h.text, h.word)}）` })),
    ]
    hits.push(...toHits("writing_voice", "投标正文", voice))

    // ⑤b 表格表题 / LaTeX 残留（用户硬要求，2026-10-26 补）
    // 为什么并到 bid 分支里而不是新开一段：两者都只扫投标正文，且都要跟随 bidText 的
    // 「有正文才报」语义——正文还没生成时报「表没有表题」是没有意义的前置噪音。
    //
    // 表题：findTableCaptionStatus 与导出侧同口径（全角空格分列、块内 ≥2 行才算出表），
    // 只报「该有表题却没有」的表格，每章按 DEPT_RULE_CAP 截断。
    const captionStatus = findTableCaptionStatus(bid)
    const missingCaption = captionStatus.filter((t) => !t.hasCaption)
    hits.push(
      ...toHits(
        "table_caption_missing",
        "投标正文",
        missingCaption.map((t) => ({
          quote: `第 ${t.line} 行的表格没有表题——用户要求每个表格上方写一行「表N-M 标题」；该表首行：${t.excerpt}`,
        })),
      ),
    )

    // LaTeX：只认命令式形态（见 findLatexResidue 注释），不误伤反斜杠路径与普通乘号
    hits.push(
      ...toHits(
        "latex_residue",
        "投标正文",
        findLatexResidue(bid).map((f) => ({ quote: `${f.label}（第 ${f.line} 行：${f.excerpt}）——改用普通文字 + <sup>/<sub>` })),
      ),
    )

    // ⑤c 凭证类断言必须有出处（2026-10-26 标书官复核提出的真实缺口）
    //
    // 为什么是废标级：正文写「已通过等保三级测评并提供证书」却没给出处，
    // 评标时无从核对；没有证书就是虚假应答。标书官原话「这类表述必须旁边挂详见附件X」。
    // 核实产品里原本没有这条校验（搜「已通过/已获得」生产代码零相关实现），故补上。
    // 只报「有断言、无出处」的，有出处的放行。
    hits.push(
      ...toHits(
        "credential_claim_no_evidence",
        "投标正文",
        findCredentialClaimsWithoutEvidence(bid)
          .filter((c) => !c.hasPointer)
          .map((c) => ({
            quote: `第 ${c.line} 行断言已持有资质但没写出处：${c.excerpt}——补「详见附件N」或证书编号，否则评委无从核对（虚假应答风险）`,
          })),
      ),
    )
  }

  // ⑥ 必备专用章（大纲侧）——大纲还没生成时不报：否则每次体检都会刷"缺承诺函/缺偏离表"，
  // 而那只是"还没到大纲阶段"，不是缺陷（有阶段门在管，见 stepEntryMissing）。
  if ((input.outline ?? []).length) {
    hits.push(
      ...toHits(
        "dedicated_section",
        "投标文件大纲",
        checkDedicatedSections(input.outline ?? [], { satisfied: input.satisfiedSections ?? [] }).map((s) => ({
          quote: `${s.label}：${s.reason}——${s.hint}`,
        })),
      ),
    )
  }

  return hits
}
