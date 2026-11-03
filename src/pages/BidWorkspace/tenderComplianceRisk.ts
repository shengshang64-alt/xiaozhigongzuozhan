// ---------------------------------------------------------------------------
// 第3轮 G1/G2：招标文件合规风险与红线扫描（纯本地零 AI 规则引擎）
// 依据《医疗信息化投标全流程规范（整合版）V1.0》：
//   第 2.4 节 八大禁止情形（差别待遇/歧视）、第 4.2 节 六类隐形陷阱、
//   第 4.3 节 七条招标红线 + 附录 F 量化阈值。
// 规则为主命中确定性条款（零 AI 费用、即时）；语义级倾向性/前后矛盾判定由 AI 兜底
// （prompts/complianceRisk.ts）补充，命中项以 origin="ai" 标注、须人工确认。
// 结果作为「合规风险与红线」本地分区（key=compliance_risk）并入第 2 步解析报告，
// 与 star_clauses/lots 同属本地产出区（不走 LLM、不计入 requestedKeys）。
// ---------------------------------------------------------------------------

export type RiskCategory = "discrimination" | "trap" | "redline"
export type RiskLevel = "red" | "yellow"
export type RiskOrigin = "rule" | "ai"

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  discrimination: "差别待遇 / 歧视条款",
  trap: "隐形陷阱",
  redline: "招标红线",
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  red: "红",
  yellow: "黄",
}

export type RiskFinding = {
  ruleId: string
  category: RiskCategory
  level: RiskLevel
  origin: RiskOrigin
  /** 命中条款简称（徽标下方标题） */
  title: string
  /** 原文命中片段（证据，已裁剪） */
  excerpt: string
  /** 为何构成风险 */
  reason: string
  /** 法规/规范依据 */
  legalBasis: string
  /** 处置建议（质疑 / 评估 / 投不投决策） */
  suggestion: string
  /** 命中行号（1 起；0=未定位，如 AI 兜底项） */
  line: number
}

/** 附录 F 量化红线阈值——集中在此，调阈值不改检测逻辑 */
export const REDLINE = {
  /** 首付款/预付款比例低于此值触发红线（红线01） */
  firstPaymentPctMin: 30,
  /** 年维护费率低于此值严拒（红线02） */
  maintenancePctReject: 8,
  /** 年维护费率谈判底线（低于此提醒） */
  maintenancePctFloor: 10,
} as const

type RuleDef = {
  id: string
  category: RiskCategory
  level: RiskLevel
  title: string
  reason: string
  legalBasis: string
  suggestion: string
  re: RegExp
}

/** 确定性规则表（正则命中原文行） */
const RULES: RuleDef[] = [
  {
    id: "DIS-scale", category: "discrimination", level: "red",
    title: "以规模条件作为资格或加分",
    reason: "把注册资本、资产、营收、纳税等规模指标设为门槛或评审因素，与项目实际需要不适应。",
    legalBasis: "87 号令第十七条、财库〔2020〕46 号第五条",
    suggestion: "属不合理门槛，可书面质疑要求删除或改为与履约能力直接相关的条件。",
    re: /(注册资本|资产总额|营业收入|从业人员|净利润|纳税额)[^。\n]{0,20}(以上|不少于|不低于|超过|达到|万元|万以上)/,
  },
  {
    id: "DIS-region", category: "discrimination", level: "red",
    title: "以特定行政区域业绩或注册地作为加分/中标条件",
    reason: "要求本省/本市业绩、本地注册或设分支机构，排斥外地供应商。",
    legalBasis: "《政府采购法实施条例》第二十条（四）（七）",
    suggestion: "地域歧视条款，须在知道权益受损之日起 7 个工作日内书面质疑。",
    re: /(本省|本市|市内|省内|本行政区|自治区|本地)[^。\n]{0,12}(业绩|案例|经验|获奖|纳税|注册|分支机构|设有|设立)/,
  },
  {
    id: "DIS-brand", category: "discrimination", level: "red",
    title: "指定或限定特定品牌、专利、型号",
    reason: "技术参数指向特定供应商的特定产品，具有排他性与倾向性。",
    legalBasis: "《政府采购法实施条例》第二十条（三）（六）",
    suggestion: "质疑要求改为「相当于或优于此参数」，或补充「或相当于」表述。",
    re: /(指定|须为|必须为|仅限|只接受|须采用)[^。\n]{0,10}(品牌|商标|专利|型号|原厂|生产厂家)/,
  },
  {
    id: "DIS-authorize", category: "discrimination", level: "red",
    title: "将生产厂家授权作为资格要求",
    reason: "除进口货物外，不得以生产厂家授权、承诺、证明、背书作为资格要求。",
    legalBasis: "87 号令第十七条",
    suggestion: "质疑删除该资格要求；如为进口货物须核实是否确属进口标的。",
    re: /(生产厂家|原厂|制造商)[^。\n]{0,10}(授权书?|承诺|证明|背书)[^。\n]{0,15}(资格|必须|须|不得|无效|否则)/,
  },
  {
    id: "DIS-ownership", category: "discrimination", level: "yellow",
    title: "限定所有制形式、组织形式或所在地",
    reason: "对供应商所有制（国有/民营）或注册地作非法限定。",
    legalBasis: "《政府采购法实施条例》第二十条（七）",
    suggestion: "质疑删除差别待遇表述，允许各类所有制供应商平等参与。",
    re: /(国有|民营|内资|外资)[^。\n]{0,8}(企业|单位)?[^。\n]{0,6}(须为|必须为|应为|仅限)|(注册地|住所)[^。\n]{0,8}(本地|本省|本市|行政区域)/,
  },
  {
    id: "RL-copyright", category: "redline", level: "red",
    title: "知识产权归属甲方或双方共有",
    reason: "要求将整体知识产权划归采购人或多方共有，核心资产权益流失。",
    legalBasis: "规范 4.3 红线 03",
    suggestion: "竞标评审重点标注；审慎评估，仅让渡项目定制部分使用权为妥。",
    re: /(知识产权|著作权|版权|专利)[^。\n]{0,15}(归|属于|为|所有)[^。\n]{0,10}(甲方|采购人|招标人|共有|双方)/,
  },
  {
    id: "RL-sourcecode", category: "redline", level: "red",
    title: "要求交付底层核心源代码",
    reason: "验收阶段交付核心源代码将致技术机密泄露与非授权二次开发。",
    legalBasis: "规范 4.3 红线 04",
    suggestion: "原则上不应交付核心源代码；如必须，仅交付应用层定制代码并签保密协议。",
    re: /(源代码|源程序|底层代码)[^。\n]{0,15}(交付|提供|移交|开放|公开|赠送|上传)|(交付|提供|移交|公开)[^。\n]{0,10}(核心)?(源代码|源程序|底层代码)/,
  },
  {
    id: "RL-scope", category: "redline", level: "yellow",
    title: "实施范围边界模糊（蔓延风险）",
    reason: "「包括但不限于」等开放表述使功能范围无限扩充，履约边界不清。",
    legalBasis: "规范 4.3 红线 06",
    suggestion: "合同阶段清晰界定实施模块与服务范围，超出部分另行计费。",
    // 2026-10-27：原正则是裸「包括但不限于」，实测三明项目命中 44 次——绝大多数是
    // 技术参数表里的功能点描述（「支持对数据库（包括但不限于 SQLServer、Oracle、Mysql）…」），
    // 那不是风险条款，是产品功能清单的常规写法，摊成 44 张黄卡把真正的风险全淹了。
    // 收窄为「出现在合同/范围/服务期等履约语境」才算范围蔓延风险。
    re: /(实施范围|服务范围|建设范围|采购范围|合同范围|工作内容|服务内容)[^。\n]{0,20}(包括但不限于|等)/,
  },
  {
    id: "RL-api", category: "redline", level: "yellow",
    title: "开放接口不限调用量或免费全量接口",
    reason: "全量开放接口且不限量将致长期运维与适配成本不可预估。",
    legalBasis: "规范 4.3 红线 07",
    suggestion: "合同中明确接口服务量级边界与超量收费模式。",
    re: /(免费|无条件|不限|无限)[^。\n]{0,10}(接口|对接|调用|次数|频次|数据)|全量[^。\n]{0,6}(接口|对接)/,
  },
  {
    id: "RL-grade", category: "redline", level: "yellow",
    title: "过级/评级项目建设目标（评建分离提醒）",
    reason: "电子病历高级别、互联互通四甲以上等过级目标易致评级费用不可控、工期拉长、验收困难。",
    legalBasis: "规范 4.3 红线 05",
    suggestion: "确保「评建分离」，明确建设目标与评级结果解耦，费用与工期设上限。",
    re: /(电子病历[^。\n]{0,8}[四五六5 6]级|互联互通[^。\n]{0,8}[四五]级|智慧服务[^。\n]{0,6}[三四五]级|电子病历评级|互联互通测评)/,
  },
  {
    id: "TRAP-accept", category: "trap", level: "yellow",
    title: "验收标准模糊未量化",
    reason: "验收仅表述为「满足甲方要求」，未量化标准，后期验收争议隐患。",
    legalBasis: "规范 4.2-06",
    suggestion: "要求补充量化验收指标（功能清单、性能阈值、测评等级）与第三方测评口径。",
    re: /(验收|测试)[^。\n]{0,15}(满足|符合|达到|以)[^。\n]{0,8}(甲方|采购人|用户|使用方)[^。\n]{0,6}(要求|满意|认可|确定|为准)/,
  },
  {
    id: "TRAP-exclusive", category: "trap", level: "yellow",
    title: "参数疑似排他/唯一指向",
    reason: "带实质性标记的条款出现独家、唯一、不可替换等表述，涉嫌不合理参数。",
    legalBasis: "规范 4.2-01",
    suggestion: "结合行业常规研判匹配度，疑似排他可质疑；语义判定以 AI 兜底复核为准。",
    re: /[★☆▲][^。\n]{0,40}(独家|唯一|不可替换|排他|无可替代)/,
  },
]

function clip(s: string, max = 68): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * 去重指纹（2026-10-27）：同一份声明在招标文件里重复出现 N 次（投标函/资格声明模板被
 * 复制多份），逐处都会命中同一条规则，此前只按 `ruleId|excerpt 前 40 字` 去重——
 * 而这些重复行的差异恰好落在第 40 字之后（或只有一个空格 / 上标 ¹ 的区别），
 * 于是 8 处原文变成 4 张内容几乎一模一样的风险卡，用户看到的就是「同一条重复四遍」。
 * 实测三明项目 L3420/L3442/L3682/L3704 四行「…资产总额为｜万元…属于（中型企业…）」。
 *
 * 现改为「规则 + 归一化正文」判重：全半角统一、去掉所有空白与标点、删掉纯数字占位
 * （模板里的「｜万元」这类空格位），只保留实质汉字。这样模板复制件会被合并成一条，
 * 而「首付款 20%」与「首付款 10%」这类数字不同的命中仍各自保留。
 */
export function riskFingerprint(ruleId: string, excerpt: string): string {
  const normalized = String(excerpt ?? "")
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, "")
    .replace(/[\d.,，。；;：:、（）()【】[\]「」《》\-—_/／|｜%％¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "")
  return `${ruleId}|${normalized}`
}

function detectPercentRules(lines: string[]): RiskFinding[] {
  const out: RiskFinding[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // 首付款/预付款比例（红线01）
    const pay = line.match(/(?:预付|首付|首期付款)[^0-9%]{0,8}(\d{1,2}(?:\.\d+)?)\s*%/)
    if (pay) {
      const pct = Number(pay[1])
      if (Number.isFinite(pct) && pct < REDLINE.firstPaymentPctMin) {
        out.push({
          ruleId: "RL-payment", category: "redline", level: "red", origin: "rule",
          title: `首付款比例 ${pct}% 低于 ${REDLINE.firstPaymentPctMin}% 红线`,
          excerpt: clip(line), reason: "无首款或首款比例过低，前期投入无法覆盖，现金流风险高。",
          legalBasis: "规范 4.3 红线 01", suggestion: "争取首款不低于 30%；低于红线须在竞标评审重点预警并纳入报价与垫资成本测算。",
          line: i + 1,
        })
      }
    }
    // 年维护费率（红线02）
    const mt = line.match(/(?:年?维护费|维保费|运维费|服务费)[^0-9%]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/)
    if (mt) {
      const pct = Number(mt[1])
      if (Number.isFinite(pct)) {
        if (pct < REDLINE.maintenancePctReject) {
          out.push({
            ruleId: "RL-maint-reject", category: "redline", level: "red", origin: "rule",
            title: `年维护费率 ${pct}% 低于 ${REDLINE.maintenancePctReject}%（严拒）`,
            excerpt: clip(line), reason: "维护费率显著低于行业区间（12%–15%），长期运维亏损。",
            legalBasis: "规范 4.3 红线 02", suggestion: "严拒低于 8% 的维护费率；谈判底线不低于 10%，须测算运维成本。",
            line: i + 1,
          })
        } else if (pct < REDLINE.maintenancePctFloor) {
          out.push({
            ruleId: "RL-maint-floor", category: "redline", level: "yellow", origin: "rule",
            title: `年维护费率 ${pct}% 低于谈判底线 ${REDLINE.maintenancePctFloor}%`,
            excerpt: clip(line), reason: "低于我方谈判底线 10%（行业正常 12%–15%）。",
            legalBasis: "规范 4.3 红线 02", suggestion: "争取上调至不低于 10%；确不能调整须评估运维亏损并预警。",
            line: i + 1,
          })
        }
      }
    }
  }
  return out
}

/** 规则扫描（纯函数、零 AI）：对招标文件原文逐行匹配确定性风险条款 + 量化阈值 */
export function scanTenderComplianceRisk(text: string | null | undefined): RiskFinding[] {
  if (!text) return []
  const lines = String(text).split(/\r?\n/)
  const findings: RiskFinding[] = []
  const seen = new Set<string>()
  const push = (f: RiskFinding) => {
    const k = riskFingerprint(f.ruleId, f.excerpt)
    if (seen.has(k)) return
    seen.add(k)
    findings.push(f)
  }
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim()
    if (!line) continue
    for (const r of RULES) {
      if (r.re.test(line)) {
        push({
          ruleId: r.id, category: r.category, level: r.level, origin: "rule",
          title: r.title, excerpt: clip(line), reason: r.reason,
          legalBasis: r.legalBasis, suggestion: r.suggestion, line: i + 1,
        })
      }
    }
  }
  for (const f of detectPercentRules(lines)) push(f)
  return findings
}

export type ComplianceRiskSummary = {
  total: number
  red: number
  yellow: number
  ruleCount: number
  aiCount: number
  byCategory: Record<RiskCategory, number>
  hasRisk: boolean
}

/** 汇总：总数/红/黄/规则与 AI 分列/按类计数（面板顶部徽标与筛选标签同源） */
export function summarizeComplianceRisk(findings: RiskFinding[] | null | undefined): ComplianceRiskSummary {
  const list = findings ?? []
  const byCategory: Record<RiskCategory, number> = { discrimination: 0, trap: 0, redline: 0 }
  let red = 0
  let yellow = 0
  let ruleCount = 0
  let aiCount = 0
  for (const f of list) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
    if (f.level === "red") red++
    else yellow++
    if (f.origin === "ai") aiCount++
    else ruleCount++
  }
  return { total: list.length, red, yellow, ruleCount, aiCount, byCategory, hasRisk: list.length > 0 }
}

/** 归一 AI 兜底返回（JSON 数组）为 RiskFinding[]，缺字段兜底、origin 恒为 ai */
export function parseAiRiskFindings(raw: unknown): RiskFinding[] {
  const arr = Array.isArray(raw) ? raw : []
  const cats = new Set<RiskCategory>(["discrimination", "trap", "redline"])
  const out: RiskFinding[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const title = String(r.title ?? "").trim()
    const excerpt = String(r.excerpt ?? "").trim()
    if (!title && !excerpt) continue
    const category = (cats.has(String(r.category) as RiskCategory) ? String(r.category) : "trap") as RiskCategory
    const level = String(r.level) === "red" ? "red" : "yellow"
    out.push({
      ruleId: `AI-${String(r.ruleId ?? out.length + 1)}`,
      category, level, origin: "ai",
      title: title || "AI 提示的合规风险",
      excerpt: clip(excerpt),
      reason: String(r.reason ?? "").trim() || "AI 语义研判提示，须人工确认。",
      legalBasis: String(r.legalBasis ?? "").trim() || "规范 2.4 / 4.2（语义判定）",
      suggestion: String(r.suggestion ?? "").trim() || "人工复核后决定是否质疑或纳入决策。",
      line: 0,
    })
  }
  return out
}

/** 合并规则命中与 AI 兜底：按归一化指纹去重，规则项优先保留 */
export function mergeRiskFindings(ruleFindings: RiskFinding[], aiFindings: RiskFinding[]): RiskFinding[] {
  const out: RiskFinding[] = []
  const seen = new Set<string>()
  for (const f of [...ruleFindings, ...aiFindings]) {
    const k = riskFingerprint(f.ruleId, f.excerpt)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
  }
  return out
}

/** 红在前、黄在后；同级按行号（0 的 AI 项排后）——面板展示排序 */
export function sortRiskFindings(findings: RiskFinding[]): RiskFinding[] {
  return [...findings].sort((a, b) => {
    if (a.level !== b.level) return a.level === "red" ? -1 : 1
    const la = a.line || Number.MAX_SAFE_INTEGER
    const lb = b.line || Number.MAX_SAFE_INTEGER
    return la - lb
  })
}

/** 合规风险本地分区落库文本（每行一条，行首 [红]/[黄] + 类别 + 标题 + 依据） */
export function flattenRiskSection(findings: RiskFinding[]): string {
  return sortRiskFindings(findings)
    .map((f) => `[${RISK_LEVEL_LABEL[f.level]}] ${RISK_CATEGORY_LABEL[f.category]} · ${f.title}｜依据：${f.legalBasis}｜建议：${f.suggestion}`)
    .join("\n")
}
