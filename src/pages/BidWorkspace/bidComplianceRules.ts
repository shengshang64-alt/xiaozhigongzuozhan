// ---------------------------------------------------------------------------
// 部门基础要求 → 本地可判定规则（纯函数、零 AI、唯一真源）
//
// 来源（逐条对照原文，不臆造）：
//   - 《xx项目 招标书检查清单更新至20240204》：公司红线条款、控标项、其他项（评分合规）
//   - 《xx项目 投标文件检查清单更新至20240204》：技术部分/承诺函/串标检查
//   - 《xx项目 解决方案检查清单更新至20231027》：术语旧称、其他项目残留
//   - 《售前工作规范-更新至20241203》：自查+交叉检查、命名、保密红线
//
// 定位：这两批规则都是"机械可判"的（正则/词表/数值比较），放在这里做单一真源，
// 检查侧（交卷体检 / 废标检查 / 解析预警）与生成侧（提示词）都从这里取口径。
// 判定结果一律"只提示不阻断"，由调用方决定分级（红线项建议升级为导出前硬门禁）。
//
// 用户裁定（2026-10-15）：
//   - 三份检查清单原样导入系统（落既有 checklists 集合）——本模块只提供其中的自动判定部分；
//   - "三家横向串标比对"暂不做（需同时上传三家标书 + 跨文件相似度，人工对接销售更合适）。
// ---------------------------------------------------------------------------

/** 命中位置（行号从 1 起，便于面板定位） */
export type RedlineHit = { rule: string; line: number; text: string; note: string; severity: "redline" | "warn" }

const linesOf = (text: string) => String(text ?? "").split("\n")

/**
 * 通用：逐行扫一组正则，命中即返回（规则名 + 行号 + 命中句子 + 处置提示）。
 * text 存**以命中词为中心的窗口**而不是行首 90 字——真实标书里红线词常出现在长表格行的第 200 字之后，
 * 只截行首会让体检提示变成「第 2495 行：院卫生费用核算报表、重点专科数据上报…」，用户照着找不到关键词。
 * 用 match() 而非 test()：即使某条规则日后带上 g 标志，也不会因 lastIndex 变成有状态判定。
 */
function scanLines(text: string, rules: { rule: string; re: RegExp; note: string; severity: "redline" | "warn" }[]): RedlineHit[] {
  const out: RedlineHit[] = []
  const lines = linesOf(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    for (const r of rules) {
      const m = line.match(r.re)
      if (!m) continue
      const at = m.index ?? 0
      const start = Math.max(0, at - 24)
      out.push({
        rule: r.rule,
        line: i + 1,
        text: (start > 0 ? "…" : "") + line.slice(start, start + 90).trim(),
        note: r.note,
        severity: r.severity,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 一、公司红线条款库（招标书检查清单「公司红线条款」原文口径）
// ---------------------------------------------------------------------------

/**
 * 红线规则表。每条对应清单原文的一条（见 note 中的处置要求）。
 * 判据刻意保守：只认明确措辞，宁可漏报交人工，也不制造噪声。
 */
export const COMPANY_REDLINE_RULES: { key: string; label: string; re: RegExp; note: string; severity: "redline" | "warn" }[] = [
  {
    key: "first_payment",
    label: "回款无首款 / 首款不足 30%",
    re: /(无首款|不设首款|首款\s*(?:[0-2]?\d)\s*%|预付(?:款|金)?\s*(?:[0-2]?\d)\s*%)/,
    note: "清单原文：「回款：是否无首款（正常是首款30%）」——招标书发出时必须写明回款约定，否则容易被模板覆盖",
    severity: "redline",
  },
  {
    key: "after_sales_over_1y",
    label: "售后/免费维护期超过 1 年",
    // 阿拉伯数字与中文数字都要认：招标文件写「三年免费质保」比写「3 年」更常见，
    // 只认阿拉伯数字等于这条红线形同虚设。刻意排除「一年/1 年」（那是公司标准口径，不是超限）。
    re: /(?:售后|免费(?:维护|保修|质保)|质保期|维保)[^。；\n]{0,12}?(?:[2-9]|1\d|二|三|四|五|六|七|八|九|十)\s*年/,
    note: "清单原文：「售后：是否超出公司要求1年」——超 1 年需销售确认或写入成本",
    severity: "redline",
  },
  {
    key: "source_code",
    label: "要求交付源代码 / 知识产权归业主",
    // 裸「源码」有歧义（实测误报：「药品溯源码」被判成源代码条款）——必须在 溯/开 之外才算；
    // 用 [^溯开] 而不是负向后顾，避免依赖 lookbehind 的引擎支持差异
    re: /(?:源代码|源程序|[^溯开]源码|^源码)|(知识产权|著作权|版权)[^。；\n]{0,10}?(归|属)[^。；\n]{0,6}?(采购人|业主|甲方|建设单位|招标人)/,
    note: "清单原文：「是否有源代码、知识产权归属业主的条款」——属公司红线，须销售确认",
    severity: "redline",
  },
  {
    key: "free_upgrade",
    label: "免费升级口径未限定「同版本内」",
    re: /免费升级/,
    note: "清单原文：「必须有免费升级字眼时，应写同版本内免费升级」——请核对是否限定同版本内",
    severity: "warn",
  },
  {
    key: "acceptance_tied_to_rating",
    label: "验收/付款绑定评级或评级结果",
    re: /(验收|付款)[^。；\n]{0,12}?(评级|等级|评级结果)|(评级|等级)[^。；\n]{0,12}?(验收|付款)/,
    note: "清单原文：「验收或付款是否绑定评级」——绑评级需销售确认",
    severity: "warn",
  },
  {
    key: "performance_bond",
    label: "要求履约保证金 / 保函",
    re: /(履约保证金|履约保函|银行保函|投标保函)/,
    note: "清单原文：「是否要求提供履约保证金、保函」——需确认额度与形式",
    severity: "warn",
  },
  {
    key: "delivery_conflict",
    label: "工期过短或交货条件矛盾",
    re: /(交货期[^。；\n]{0,10}(1[0-9]|[1-9])\s*天)|(验收后[^。；\n]{0,6}交货)/,
    note: "清单原文：「工期是否过短，是否存在交货期30天、交货条件验收后交货等矛盾描述」",
    severity: "warn",
  },
  {
    key: "dev_party_separation",
    label: "评建分离 / 软硬件分离原则相关表述",
    re: /(评建分离|软硬件分离)/,
    note: "售前工作规范与清单提到的原则性红线：涉及分离原则需核对报价与方案边界",
    severity: "warn",
  },
]

/** 扫公司红线（吃招标书原文或合同条款分区文本） */
export function findCompanyRedlineHits(text: string): RedlineHit[] {
  return scanLines(text, COMPANY_REDLINE_RULES.map((r) => ({ rule: r.label, re: new RegExp(r.re.source, r.re.flags.replace("g", "")), note: r.note, severity: r.severity })))
}

// ---------------------------------------------------------------------------
// 二、评分合规校验（招标书检查清单「其他项」原文口径，纯本地）
// ---------------------------------------------------------------------------

/** 与 bidTypes 的 ScoringItem 结构兼容的最小形状（不 import 大模块，保持本模块可独立单测） */
export type ScoringItemLike = {
  id?: string
  item: string
  score: number
  criteria?: string
  category?: "tech" | "biz"
}

export type ScoringComplianceIssue = { key: string; level: "redline" | "warn"; subject: string; message: string }

/**
 * 评分合规四检（清单原文：「单项不能超过3分、证书1个最多1分、测试报告1个最多3分」；
 * 另两条来自同一清单的废标口径：「技术评分项要能满足副标50%的得分」「技术分不超50%」）。
 * 阈值写死在常量里，便于单测与后续按政策调整。
 */
export const SCORE_CAP_SINGLE = 3
export const SCORE_CAP_CERT = 1
export const SCORE_CAP_REPORT = 3
export const TECH_SCORE_SHARE_MAX = 0.5
export const SUB_BID_PASS_SHARE_MIN = 0.5

export function checkScoringCompliance(items: ScoringItemLike[]): ScoringComplianceIssue[] {
  const issues: ScoringComplianceIssue[] = []
  const list = items ?? []
  for (const it of list) {
    const subject = it.item || "(未命名评分项)"
    const isCert = /证书|认证|资质|著作权|软著|登记证/.test(subject)
    const isReport = /测试报告|检测报告|评测报告|检验报告/.test(subject)
    const cap = isCert ? SCORE_CAP_CERT : isReport ? SCORE_CAP_REPORT : SCORE_CAP_SINGLE
    if (Number(it.score) > cap) {
      issues.push({
        key: isCert ? "cap_cert" : isReport ? "cap_report" : "cap_single",
        level: "redline",
        subject,
        message: `「${subject}」${it.score} 分，超过上限 ${cap} 分（${isCert ? "证书类 1 个最多 1 分" : isReport ? "测试报告类 1 个最多 3 分" : "单项不得超过 3 分"}）`,
      })
    }
  }
  const tech = list.filter((i) => i.category === "tech")
  const biz = list.filter((i) => i.category === "biz")
  const sum = (xs: ScoringItemLike[]) => xs.reduce((a, x) => a + (Number(x.score) || 0), 0)
  const techSum = sum(tech)
  const total = techSum + sum(biz)
  if (total > 0) {
    const share = techSum / total
    if (share > TECH_SCORE_SHARE_MAX + 1e-6) {
      issues.push({
        key: "tech_share",
        level: "warn",
        subject: "技术分占比",
        message: `技术分 ${techSum} 分占加权总分约 ${(share * 100).toFixed(0)}%，超过 50%（清单口径：技术分不超 50%）`,
      })
    }
  }
  return issues
}

/**
 * 副标得分能力校验：清单原文「技术评分项是否能满足副标50%的得分，防止废标」。
 * 按你方模拟评标的得分估算传入即可（techScorePercent / subBidScorePercent 二选一，取更保守者）。
 */
export function checkSubBidScore(
  args: { techScorePercent?: number; subBidScorePercent?: number },
): ScoringComplianceIssue | null {
  const v = args.subBidScorePercent ?? args.techScorePercent
  if (typeof v !== "number" || Number.isNaN(v)) return null
  if (v < SUB_BID_PASS_SHARE_MIN * 100) {
    return {
      key: "sub_bid_50",
      level: "redline",
      subject: "副标得分率",
      message: `当前估算得分率约 ${v.toFixed(0)}%，低于 50%（清单口径：评分项要能满足副标 50% 得分，防止废标）`,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 三、术语旧称库（解决方案/投标文件检查清单原文口径）
// ---------------------------------------------------------------------------

/** 旧称 → 现称（清单原文举例：卫生计生委-卫健委；人口健康信息平台-全民健康信息平台；3G、4G-5G） */
export const OUTDATED_TERMS: { from: RegExp; to: string; note: string }[] = [
  { from: /卫生计生委|卫生和计划生育委员会/g, to: "卫生健康委员会（卫健委）", note: "机构改革后旧称" },
  { from: /人口健康信息平台/g, to: "全民健康信息平台", note: "国家平台名称已更新" },
  { from: /\b3G\b|\b4G\b|3G、4G|4G、3G/g, to: "5G", note: "网络制式旧称" },
  { from: /新农合/g, to: "城乡居民基本医疗保险", note: "制度名称已更新" },
  { from: /电子健康档案\(EHR\)(?![^。；\n]{0,10}电子病历)/g, to: "电子健康档案（EHR，注意与电子病历 EMR 区分）", note: "EHR/EMR 易混，需核对" },
]

/** 扫旧称并给出替换建议（只提示，不自动改正文——改字要人确认） */
export function findOutdatedTerms(text: string): { term: string; suggestion: string; line: number; text: string }[] {
  const out: { term: string; suggestion: string; line: number; text: string }[] = []
  const lines = linesOf(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    for (const t of OUTDATED_TERMS) {
      const re = new RegExp(t.from.source, t.from.flags.includes("g") ? "g" : t.from.flags + "g")
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        out.push({ term: m[0], suggestion: t.to, line: i + 1, text: line.trim().slice(0, 80) })
        if (m[0].length === 0) break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 四、其他项目残留扫描（清单原文反复强调的"低级错误"）
// ---------------------------------------------------------------------------

/**
 * 其他机构/医院名。**两次收紧**（2026-10-15 真实标书实测驱动）：
 *  ① 旧形态 `[汉字]{2,15}医院` 把「互联网医院」「关联医院」「上线后医院」这类以「医院」结尾的
 *     普通短语全当机构名，20 条上限被打满且全是误报；
 *  ② 只认「强特征后缀」仍不够——「公立中医医院」「级医院评审指标上报与公立中医医院」照样命中
 *     （任何汉字串都能当机构名前缀）。
 * 现在一律要求**地名/大学锚点**：`地名(省/市/县/区/州/盟/旗/大学) + ≤4 字 + 机构后缀`。
 * 「厦门市杏林医院」「安徽省卫生健康委员会」会报；「公立中医医院」不报。
 * 中间最多 4 字也是实测压出来的：「新增院**区**或接入互联网医院」里「区」是「院区」的区、不是地名，
 * 放宽到 8 字就会把它当成「区+…+医院」。
 * 宁可漏报（少报一个别家医院名）也不能 20 条全误报——后者会让整条规则被无视。
 */
const HOSPITAL_RE =
  /[A-Za-z0-9\u4e00-\u9fa5]{2,12}(?:省|市|县|区|州|盟|旗|大学)[\u4e00-\u9fa5]{0,4}?(?:人民医院|中医医院|中医院|中西医结合医院|附属医院|中心医院|妇幼保健院|儿童医院|肿瘤医院|口腔医院|胸科医院|传染病医院|精神病医院|康复医院|职工医院|民族医院|社区医院|卫生院|疾病预防控制中心|疾控中心|卫生健康委员会|卫健委|医院)/g

/**
 * 机构名左边界裁剪：命中常把句子前缀一起带进来（实测「参考了XX市人民医院」整体命中），
 * 从**最后一个虚词/标点**之后开始才算名字。
 * 刻意不含 中/外/前/后/上/下/内/生 —— 它们出现在真实机构名里（中心医院、中医院、卫生院），
 * 放进去会把「中心医院」裁成「心医院」。
 */
const NAME_LEAD_TRIM_RE = /.*[的了和与及在是为按据对等把被由向给让使于其该本见考从、，。；：（）【】\s]/

function trimNameLead(v: string): string {
  const m = String(v ?? "").match(NAME_LEAD_TRIM_RE)
  const cut = m ? v.slice(m[0].length) : v
  return cut.length >= 4 ? cut : v
}
/** 其他项目编号形态（与本项目招标编号格式类似但不同者） */
const OTHER_TENDER_NO_RE = /(?:[A-Z]{2,6}[-－]?\d{4}[-－]?\d{2,4}(?:[-－]\d{1,3})?|\[[A-Za-z0-9]{4,10}\][A-Za-z0-9[\]（）()-]{4,40})/g

/**
 * 残留扫描：找出"文中出现的其它医院名 / 其它项目编号"，并**排除本项目自有名称**。
 * own 传本项目应有值（医院名、招标编号、项目名称、投标人名），命中并不在 own 里的即报。
 */
export function findProjectResidue(
  text: string,
  own: { hospitals?: string[]; tenderNos?: string[]; companyNames?: string[] },
): { kind: "hospital" | "tenderNo" | "company"; value: string; line: number }[] {
  const ownH = (own.hospitals ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const ownNo = (own.tenderNos ?? []).map((s) => String(s ?? "").replace(/\s+/g, "").trim()).filter(Boolean)
  const ownC = (own.companyNames ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const out: { kind: "hospital" | "tenderNo" | "company"; value: string; line: number }[] = []
  const lines = linesOf(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    for (const m of line.matchAll(HOSPITAL_RE)) {
      const v = trimNameLead(m[0])
      if (ownH.some((h) => h.includes(v) || v.includes(h))) continue
      if (out.some((o) => o.line === i + 1 && o.kind === "hospital" && o.value === v)) continue
      out.push({ kind: "hospital", value: v, line: i + 1 })
    }
    for (const m of line.matchAll(OTHER_TENDER_NO_RE)) {
      const v = m[0]
      const flat = v.replace(/\s+/g, "")
      if (ownNo.some((n) => n.includes(flat) || flat.includes(n))) continue
      out.push({ kind: "tenderNo", value: v, line: i + 1 })
    }
    for (const c of ownC) {
      // 本公司名出现属正常（非暗标）；此处只做"是否误写成了别家"的反向提示由人工核对，故不报
      void c
    }
  }
  return out
}
