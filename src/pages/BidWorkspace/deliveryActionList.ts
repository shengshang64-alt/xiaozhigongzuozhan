import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { normalizeBasisPlaceholders } from "./bidTypes"
import { PLACEHOLDER_RES } from "./placeholderLedger"

// ---------------------------------------------------------------------------
// R288（bid-placeholder-owner-split · P1）：交付前必办清单——把正文里所有「待填写」类
// 占位按「谁来办」分流成可执行动作，让交付前能直接回答「还有几项等我拍板」。
//
// 根因（实测 19 个项目 / 88 致命 + 170 警告）：占位不分责任方，商务决策项（质保年限、
// 响应时限、各类服务收费）淹没在「人工附材料」项里；④ 待人工判定独占 41 处致命 + 117 处
// 警告，等于「谁来办」这个问题在系统里没有答案（承接 r283-gate-owner-rules-overbroad 的
// 人工核对结论：记录/台账/模板/清单/留存策略类应归 ②，承诺数值与收费类应归 ①）。
//
// 判据单一真源：本文件的 DELIVERY_OWNER_PATTERNS。scripts/bid-delivery-gate.mjs 与之同源，
// 由 deliveryActionList.test.ts 的漂移守卫逐条比对模式表原文，任一侧改动未同步即测试失败。
//
// 边界：本地零 AI、零 collection、零 schema；确认进度按项目存本机 localStorage（与
// submissionChecklist.ts 同一模式）；只报不拦——清单不拦截导出（维持既有裁定）。
// ---------------------------------------------------------------------------

export type DeliveryOwner = "biz-decision" | "material-attach" | "system-refetch" | "unclassified"

export const DELIVERY_OWNER_ORDER: DeliveryOwner[] = [
  "biz-decision",
  "material-attach",
  "system-refetch",
  "unclassified",
]

export const DELIVERY_OWNER_LABEL: Record<DeliveryOwner, string> = {
  "biz-decision": "① 商务决策（须拍板）",
  "material-attach": "② 人工附材料（须附原件）",
  "system-refetch": "③ 系统可回取（须查为何没填）",
  unclassified: "④ 待人工判定",
}

export const DELIVERY_OWNER_ACTION: Record<DeliveryOwner, string> = {
  "biz-decision": "由商务/投标负责人拍板具体承诺值与收费口径，AI 不得代填（代填=承诺风险）",
  "material-attach": "由投标文件制作者附真实材料或补录（证书/截图/名单/记录表），系统无法生成",
  "system-refetch": "招标原文或项目字段里已有该事实，正文却留空——须回查注入链路为何失效",
  unclassified: "未能自动归责，须逐条人工确认责任方",
}

/** 各责任方的「办结」动作名，界面按钮文案用（同一份进度不同责任方语义不同） */
export const DELIVERY_OWNER_DONE_LABEL: Record<DeliveryOwner, string> = {
  "biz-decision": "已拍板",
  "material-attach": "已附/已补",
  "system-refetch": "已回取",
  unclassified: "已判定",
}

/**
 * 承诺数值空缺（响应时限/工期/人数/金额/套数）——既是 ① 商务决策的主形态，也是致命判据，
 * 两处共用同一正则，避免出现「算致命但不归拍板」的口径分裂。
 */
export const RE_PROMISE_VALUE =
  /【待填写】\s*(?:个)?(工作日|日历天|日历日|分钟|小时|课时|天|元|万元|%|％|台|套|人|次|年|月|倍|个|项|GB|TB|万)/

/**
 * 归责模式表：**顺序即优先级**（①→③→②），全部命中不上才落 ④。
 * ① 先判——承诺值/价格是评标打分项，漏一项直接丢分，不允许被材料类关键词抢走。
 * ③ 次判——「系统该填没填」属链路缺陷，判据窗口最窄（10 字）故先跑：既防误报，
 *   也避免「项目编号【待填写】及佐证材料」这类真链路缺陷被放宽后的 ② 抢走（R288 实测纠偏）。
 * ② 后判——人工附材料/补录，词表较宽（前置窗口 40 字，跨小半句仍属同一责任方）。
 * 每条模式的原文必须与 scripts/bid-delivery-gate.mjs 中对应行逐字一致（漂移守卫比对 .source）。
 */
export const DELIVERY_OWNER_PATTERNS: ReadonlyArray<{ owner: DeliveryOwner; re: RegExp; why: string }> = [
  { owner: "biz-decision", re: /(质保|保修|免费服务|承诺延长|延长)[^。；\n]{0,20}【待填写】|【待填写】\s*年[^。；\n]{0,10}(质保|保修|免费)|优惠|折扣|让利[^。；\n]{0,15}【待填写】/, why: "质保/延长/优惠类承诺须商务拍板" },
  { owner: "biz-decision", re: RE_PROMISE_VALUE, why: "承诺数值空缺（时限/人数/金额/数量）" },
  { owner: "biz-decision", re: /(费用|人工费|维护费|报价|单价|价格|收费|计费)[^。；\n]{0,15}【待填写】/, why: "收费与价格口径须商务拍板" },
  { owner: "biz-decision", re: /(承诺(?!函)|保证|确保)[^。；\n]{0,15}【待填写】/, why: "承诺句里的数值/期限须商务拍板" },
  { owner: "system-refetch", re: /(项目依据|编制依据|依据文件|项目编号|招标编号|采购编号|项目名称|采购人|预算金额|最高限价)[^。；\n]{0,10}【待填写】|【待填写】[^。；\n]{0,10}(项目依据|依据文件|项目编号|招标编号|采购编号)/, why: "招标原文/项目字段已有该事实" },
  { owner: "system-refetch", re: /(份数|正本|副本)[^。；\n]{0,10}【待填写】|【待填写】[^。；\n]{0,10}(份数)/, why: "装订份数由采购文件规定，可回取" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,12}(证明|证书|资质|复印件|授权函|承诺函|截图|白皮书|检测报告|彩页|名单|社保|型号|清单)|(证明|证书|资质|复印件|授权函|截图|白皮书|检测报告|彩页|名单|社保|型号)[^。；\n]{0,20}【待填写】/, why: "证明材料类，人工附原件" },
  { owner: "material-attach", re: /(佐证材料|证明材料|申报材料|记录单|记录表|实施记录|盘点记录|值守记录|台账|模板|人员信息|对应关系|排班表|留存策略|业绩案例|案例)[^。；\n]{0,40}【待填写】/, why: "记录/台账/模板类，人工补录或附件" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,12}(佐证材料|证明材料|记录|台账|模板|名单|业绩|案例|附件)/, why: "材料/记录类占位" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,16}(按实补充|人工补充|按实填写|占位处理|人工填写)/, why: "正文自述由投标人按实补录" },
  { owner: "material-attach", re: /【[^】]{0,20}(?:此处插入|插入)[^】]{0,20}】/, why: "插图/附证占位，人工补件" },
  { owner: "material-attach", re: /[（(]\s*(?:请)?填写[^）)]{0,14}[）)]/, why: "正文残留填写指令，人工补录" },
]

const UNCLASSIFIED_WHY = "未能自动归责，须逐条人工确认责任方"

/** 占位上下文窗口（与门禁脚本同一把尺子：前 40 后 30，够判语义又不至于跨句误判） */
const CONTEXT_BEFORE = 40
const CONTEXT_AFTER = 30

/** 致命判据：命中即「不填就废标」，与门禁 promise-empty-value / promise-sentence 同源 */
export const DELIVERY_FATAL_PATTERNS: ReadonlyArray<RegExp> = [
  RE_PROMISE_VALUE,
  /(应|须|必须|承诺(?!函)|保证|确保|不低于|不超过|不少于|至少|达到)[^。；\n]{0,25}【待填写】/,
  /\{\{\s*[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]{1,24}\s*\}\}/,
  /[[【(（]\s*(TODO|TBD|FIXME|待补|待补充|待完善|待定|占位)\s*[\]】)）]/i,
]

/** 清单条目上限：超出的按「同形态已合并」口径披露，避免一次性渲染数百条把页面卡死 */
const MAX_ACTION_ITEMS = 120

/** 单条占位动作；同一形态跨章合并（填一次处处对齐），chapters 最多列 3 个章名 */
export type DeliveryActionItem = {
  /** 稳定 id：形态指纹（去空白后的摘录），正文改动后仍能对上本机已确认进度 */
  id: string
  owner: DeliveryOwner
  /** 归责理由（哪条判据命中），界面 tooltip 用 */
  why: string
  snippet: string
  chapters: string[]
  /** 该形态在正文里出现的总次数（含同章重复） */
  occurrences: number
  fatal: boolean
}

export type DeliveryActionState = "done" | "na"
export type DeliveryProgressMap = Record<string, DeliveryActionState>

export type DeliveryOwnerSummary = {
  owner: DeliveryOwner
  label: string
  action: string
  doneLabel: string
  total: number
  pending: number
  fatal: number
  fatalPending: number
  items: DeliveryActionItem[]
}

export type DeliveryActionReport = {
  total: number
  pending: number
  /** ① 商务决策里未办结的条数——「还有几项等我拍板」的直接答案 */
  decisionPending: number
  fatalPending: number
  truncated: number
  byOwner: DeliveryOwnerSummary[]
}

function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function makeSnippet(content: string, start: number, len: number): string {
  const from = Math.max(0, start - CONTEXT_BEFORE)
  const to = Math.min(content.length, start + len + CONTEXT_AFTER)
  return content.slice(from, to).replace(/\s+/g, " ").trim()
}

/** 占位形态原文（matchAll 需要 g 标志，克隆一份避免共享正则的 lastIndex 串味） */
function occurrencesOf(re: RegExp, content: string): RegExpMatchArray[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`
  return [...content.matchAll(new RegExp(re.source, flags))]
}

/** 按模式表归责；顺序即优先级，全不命中落 ④，绝不返回空导致统计漏项 */
export function classifyDeliveryOwner(snippet: string): { owner: DeliveryOwner; why: string } {
  for (const p of DELIVERY_OWNER_PATTERNS) {
    if (p.re.test(snippet)) return { owner: p.owner, why: p.why }
  }
  return { owner: "unclassified", why: UNCLASSIFIED_WHY }
}

export function isFatalPlaceholderSnippet(snippet: string): boolean {
  return DELIVERY_FATAL_PATTERNS.some((re) => re.test(snippet))
}

/**
 * 从各章正文推导「交付前必办清单」（纯函数，本地零 AI）。
 * 判据与交付物对齐：先过 normalizeBasisPlaceholders（导出链路出件前同样规整依据表「编号」列的
 * 无编号占位），否则会把「导出后本就不存在」的占位报成待办。
 */
export function buildDeliveryActionList(chapters: readonly Chapter[]): DeliveryActionItem[] {
  const byKey = new Map<string, DeliveryActionItem>()

  for (const ch of chapters) {
    const content = normalizeBasisPlaceholders(ch.content ?? "")
    if (!content.trim()) continue
    const title = (ch.title ?? "").trim().slice(0, 30) || "（未命名）"

    for (const re of PLACEHOLDER_RES) {
      for (const m of occurrencesOf(re, content)) {
        const snippet = makeSnippet(content, m.index ?? 0, m[0].length)
        if (!snippet) continue
        const key = hashKey(snippet.replace(/\s+/g, ""))
        const hit = byKey.get(key)
        if (hit) {
          hit.occurrences += 1
          if (!hit.chapters.includes(title) && hit.chapters.length < 3) hit.chapters.push(title)
          continue
        }
        const { owner, why } = classifyDeliveryOwner(snippet)
        byKey.set(key, {
          id: key,
          owner,
          why,
          snippet,
          chapters: [title],
          occurrences: 1,
          fatal: isFatalPlaceholderSnippet(snippet),
        })
      }
    }
  }

  // 责任方优先（①→④），同级内致命优先、出现次数多的优先——最该拍板的排最前
  const list = [...byKey.values()]
  list.sort((a, b) => {
    const o = DELIVERY_OWNER_ORDER.indexOf(a.owner) - DELIVERY_OWNER_ORDER.indexOf(b.owner)
    if (o !== 0) return o
    if (a.fatal !== b.fatal) return a.fatal ? -1 : 1
    return b.occurrences - a.occurrences
  })
  return list
}

/** 按责任方分组并算就绪度：pending=未办结（done/na 都算办结） */
export function summarizeDeliveryActions(
  items: readonly DeliveryActionItem[],
  progress: DeliveryProgressMap,
): DeliveryActionReport {
  const byOwner: DeliveryOwnerSummary[] = DELIVERY_OWNER_ORDER.map((owner) => {
    const group = items.filter((it) => it.owner === owner)
    const pendingItems = group.filter((it) => !progress[it.id])
    return {
      owner,
      label: DELIVERY_OWNER_LABEL[owner],
      action: DELIVERY_OWNER_ACTION[owner],
      doneLabel: DELIVERY_OWNER_DONE_LABEL[owner],
      total: group.length,
      pending: pendingItems.length,
      fatal: group.filter((it) => it.fatal).length,
      fatalPending: pendingItems.filter((it) => it.fatal).length,
      items: group,
    }
  })
  const pendingItems = items.filter((it) => !progress[it.id])
  return {
    total: items.length,
    pending: pendingItems.length,
    decisionPending: byOwner[0].pending,
    fatalPending: pendingItems.filter((it) => it.fatal).length,
    truncated: items.length > MAX_ACTION_ITEMS ? items.length - MAX_ACTION_ITEMS : 0,
    byOwner,
  }
}

/** 只渲染未办结之外的全量？口径固定：清单含全部条目并带勾选态，便于打印带进评审会 */
export function renderDeliveryActionMarkdown(
  projectName: string,
  report: DeliveryActionReport,
  progress: DeliveryProgressMap,
): string {
  const L: string[] = []
  L.push(`# 交付前必办清单（按责任方）· ${projectName || "（未命名项目）"}`)
  L.push("")
  L.push(`> 本地推导零 AI 费用 · 生成时间 ${new Date().toLocaleString()} · 只报不拦，逐项办结后方可交卷`)
  L.push("")
  L.push(
    `共 ${report.total} 项待办：① 待拍板 ${report.byOwner[0].pending} / ② 待附件 ${report.byOwner[1].pending} / ③ 待回取 ${report.byOwner[2].pending} / ④ 待判定 ${report.byOwner[3].pending}${report.truncated > 0 ? `（另有 ${report.truncated} 项同形态合并未展开）` : ""}`,
  )
  L.push("")
  for (const g of report.byOwner) {
    if (g.total === 0) continue
    L.push(`## ${g.label}（待办 ${g.pending} / 共 ${g.total}）`)
    L.push("")
    L.push(`办结口径：${g.action}`)
    L.push("")
    L.push("| 状态 | 严重度 | 出现章节 | 原文摘录 | 归责依据 |")
    L.push("|---|---|---|---|---|")
    for (const it of g.items) {
      const mark = progress[it.id] === "na" ? "不适用" : progress[it.id] === "done" ? "已办结" : "待办"
      const snip = it.snippet.replace(/\|/g, "\\|")
      L.push(
        `| ${mark} | ${it.fatal ? "致命" : "警告"} | ${it.chapters.join("、")}${it.chapters.length > 1 ? ` 等${it.occurrences} 处` : ""} | …${snip}… | ${it.why} |`,
      )
    }
    L.push("")
  }
  return L.join("\n")
}

// ------------------------------ 进度持久化（localStorage，按项目隔离） ------------------------------

const KEY_PREFIX = "bid_actions_"

function normalizeProgressMap(raw: unknown): DeliveryProgressMap {
  if (!raw || typeof raw !== "object") return {}
  const out: DeliveryProgressMap = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "done" || v === "na") out[id] = v
  }
  return out
}

export function readDeliveryProgress(projectId: string): DeliveryProgressMap {
  if (!projectId) return {}
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId)
    if (!raw) return {}
    return normalizeProgressMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function writeDeliveryProgress(projectId: string, map: DeliveryProgressMap): void {
  if (!projectId) return
  try {
    window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(map))
  } catch {
    /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
  }
}
