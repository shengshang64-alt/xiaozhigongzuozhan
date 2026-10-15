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
  findCompanyRedlineHits,
  findOutdatedTerms,
  findProjectResidue,
  type ScoringItemLike,
} from "./bidComplianceRules"
import { checkDedicatedSections, findPronounHits, findVagueParamHits } from "./bidWritingRules"
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

export function deptRulesHits(input: DeptRulesInput): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const tender = String(input.tenderText ?? "")
  const bid = String(input.bidText ?? "")

  // ① 公司红线条款（招标侧）
  if (tender.trim()) {
    hits.push(
      ...toHits(
        "company_redline",
        "招标文件",
        findCompanyRedlineHits(tender).map((h) => ({
          quote: `${h.severity === "redline" ? "【红线】" : "【提示】"}${h.note}（第 ${h.line} 行：${h.text.slice(0, 40)}）`,
        })),
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
      ...findPronounHits(bid).map((h) => ({ quote: `自称口径「${h.word}」不合规（第 ${h.line} 行：${h.text.slice(0, 30)}）` })),
      ...findVagueParamHits(bid).map((h) => ({ quote: `模糊参数「${h.word}」（第 ${h.line} 行：${h.text.slice(0, 30)}）` })),
    ]
    hits.push(...toHits("writing_voice", "投标正文", voice))
  }

  // ⑥ 必备专用章（大纲侧）——大纲还没生成时不报：否则每次体检都会刷"缺承诺函/缺偏离表"，
  // 而那只是"还没到大纲阶段"，不是缺陷（有阶段门在管，见 stepEntryMissing）。
  if ((input.outline ?? []).length) {
    hits.push(
      ...toHits(
        "dedicated_section",
        "投标文件大纲",
        checkDedicatedSections(input.outline ?? []).map((s) => ({ quote: `${s.label}：${s.reason}——${s.hint}` })),
      ),
    )
  }

  return hits
}
