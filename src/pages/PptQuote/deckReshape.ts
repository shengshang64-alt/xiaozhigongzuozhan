// ---------------------------------------------------------------------------
// 生成后自动整形（2026-10-30）
//
// 用户反馈：「画的还是很垃圾，基本上文字占了很大的篇幅，没有汇报思路，没有美观性」
//
// 前几轮改的是「渲染器」（架构图配色、表格图型、卡片网格）——但那些只是"有了更好的容器"，
// 而容器里装的还是文字，所以观感不变。根因是：**内容的"形态"没有变**。
//
// 提示词里写多少条"请用图表"都没用——模型对建议的执行率很低（实测 29 页里 20 页仍是纯文字）。
// 所以这一层做的是**确定性整形**：在 AI 返回内容、落库之前，用规则把该变成视觉的页面变掉。
//
// 整形规则（按顺序尝试，命中即停）：
//   1. 含百分比/年份序列/数值对比的 → 提炼成 chart（柱/折线）
//   2. 含 3-4 个并列名词短语的 → 提炼成 kpi 或 table
//   3. 讲"分层/架构/组成"的 → 提炼成 architecture 图示
//   4. 讲"步骤/流程/阶段"的 → 提炼成 flow 图示
//   5. 都不匹配的才保留 bullets
//
// 重要原则：**只做形态转换，不发明内容**。所有数字都从原文抽取，抽不出来就不转换（保持原样）。
// 宁可少转一页，也不能造假数据——售前 PPT 编数字是要出事故的。
// ---------------------------------------------------------------------------

import type { FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import type { Slide, SlideChart, SlideKpi } from "./pptQuoteTypes"

/** 从文本里抽「数字 + 单位/描述」结构，如「门诊量 3500 人次」「完整率 82%」 */
type NumHit = { value: number; raw: string; label: string }

// 2026-10-30 修：原正则把"覆盖/累计/服务"等动词当 label 一部分，导致 `覆盖 30 市` 抽不出
// （label 被前缀剥离后为空）；单位表也缺"市/省/元/分"等售前高频词。
// 新策略：先剥掉常见动词/介词前缀，再用「数字 + 可选单位」定位，label 取数字前最多 10 字的片段。
const LABEL_PREFIX_RE = /^(现状|目前|当前|已达|累计|覆盖|服务|共计|约|达|已|签约|交付|实施|完成|通过|获得|拥有|建成|上线)\s*/g
const UNIT_RE = /(%|万|亿|人次|张|台|家|个|人|天|小时|分钟|条|级|市|省|元|分|项|套|所)/

/** 从一条要点里抽取数值（label 取数字前的名词短语） */
export function extractNumbers(text: string): NumHit | null {
  const src = String(text ?? "").trim()
  if (!src) return null
  // 在整串里找第一个「前缀+数字」组合
  const numMatch = /(\d+(?:\.\d+)?)/.exec(src)
  if (!numMatch) return null
  const idx = numMatch.index
  const value = Number(numMatch[1])
  if (!Number.isFinite(value)) return null
  // 单位：紧跟数字后的单位词
  const after = src.slice(idx + numMatch[1].length)
  const unitM = unitOf(after)
  const raw = numMatch[1] + (unitM ?? "")
  // label：数字前的片段，剥掉动词前缀与标点
  const rawBefore = src.slice(0, idx).replace(/[：:，,、\s]+$/g, "").trim()
  let label = rawBefore.replace(LABEL_PREFIX_RE, "").trim()
  label = label.replace(/[：:，,、\s]+$/g, "")
  // 剥离后太短（如"覆盖 30 市"→"市"）时退回原文前缀，保留可读的业务含义
  if (label.length < 2 && rawBefore.length >= 2) label = rawBefore
  // 2026-10-30：label 里若含逗号/顿号，只取最后一段（"某三级中医院，建设周期9个月" → "建设周期"）
  if (/[，,、；;]/.test(label)) {
    const segs = label.split(/[，,、；;]/).map((x) => x.trim()).filter(Boolean)
    label = segs[segs.length - 1] ?? label
  }
  if (!label) label = src.slice(idx + numMatch[1].length + (unitM?.length ?? 0)).replace(/^[^\u4e00-\u9fa5]+/, "").trim().slice(0, 10)
  if (!label) return null
  return { value, raw, label }
}

/** 取数字后紧跟的单位（有则返回，无则 null） */
function unitOf(after: string): string | null {
  const m = UNIT_RE.exec(after.slice(0, 3))
  return m ? m[1] : null
}

/** 页面文本总量（判断是不是文字墙） */
function textLoad(s: Slide): number {
  return s.bullets.reduce((n, b) => n + b.length, 0)
}

/** 是否已有视觉形态（有就不用整形） */
export function hasVisual(s: Slide): boolean {
  return Boolean(s.chart || s.kpi?.length || s.image || s.figures?.length)
}

/**
 * 规则 0a（2026-11-04 C 项）：按**大纲声明的 kind** 强制整形。
 *
 * 为什么需要：逐页生成时模型经常把架构页/流程页写成 4 条要点（kind 已被
 * contentToSlide 保住），但这些页的标题往往是结论句（「一体化平台把门诊准备时间压缩 40%」），
 * 不含「架构/分层」这类关键词 → tryArchitecture 的标题门槛把它们全挡在外面，
 * 最后退化成 iconGrid 甚至纯文字卡片。用户看到的仍是「没有架构图」。
 *
 * 口径：**只信大纲的 kind，不再看标题关键词**；但构造不出合法结构（要点太少、
 * 拆不出层/步骤）就返回 null 交给后续规则，绝不硬造数据。
 *   · architecture：要点数 ≥3，逐条当一层（层名取「第N层」或要点前缀），模块从要点里拆
 *   · flow：要点数 ≥3，逐条当一步
 *   · table：要点 2-4 条且都是「A：B」结构
 *   · kpi：3-4 条且都能抽出数值（抽不出就放弃——kpi 绝不能编数字）
 */
function tryDeclaredKind(s: Slide): Partial<Slide> | null {
  switch (s.kind) {
    case "architecture":
      return tryArchitectureForced(s)
    case "flow":
      return tryFlowForced(s)
    case "table":
      return tryTable(s)
    case "kpi":
      return tryKpi(s)
    default:
      return null
  }
}

/** 按大纲声明 kind=architecture 整形（不看标题关键词，只看要点是否够分层） */
function tryArchitectureForced(s: Slide): Partial<Slide> | null {
  const bullets = s.bullets.map((b) => b.trim()).filter(Boolean)
  if (bullets.length < 3) return null
  const layers = bullets.slice(0, 5).map((b, i) => {
    const name = layerNameOf(b, i)
    const body = b.replace(/^[^：:]{0,12}[：:]/, "")
    const modules = body
      .split(/[，,、；;]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 12)
      .slice(0, 4)
    if (modules.length >= 2) return { name, modules }
    const one = (modules[0] ?? body).replace(/\s+/g, "").slice(0, 16).trim()
    return { name, modules: [one.length >= 2 ? one : name] }
  })
  const fig: FigureSpec = { type: "architecture", title: "分层架构", layers }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/** 按大纲声明 kind=flow 整形（不看标题关键词，只看要点是否像有序步骤） */
function tryFlowForced(s: Slide): Partial<Slide> | null {
  const bullets = s.bullets.map((b) => b.trim()).filter(Boolean)
  if (bullets.length < 3) return null
  // 论述句不是步骤（与 tryFlow 同一判据，宁可不转）
  if (bullets.some((b) => /(因为|所以|说明|意味着|要求|导致|本质|核心在于)/.test(b.split(/[：:，,。；;]/)[0] ?? "")))
    return null
  const steps = bullets.slice(0, 6).map((b) => {
    const [name, ...rest] = b.split(/[：:，,]/)
    return { name: name.trim().slice(0, 18), ...(rest.length ? { desc: rest.join("，").trim().slice(0, 24) } : {}) }
  })
  const fig: FigureSpec = { type: "flow", title: "实施路径", steps }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/**
 * 规则 1：百分比/数值对比 → chart
 * 判定：一页里有 ≥3 条要点各含一个可识别数值（更少不足以成图）
 *
 * 2026-10-30 加严（实测「某三级中医院，建」这种被切成分类名的案例）：
 *   - label 必须是「像指标名」的短语（含率/量/数/占比/周期/规模等，或至少 3 个中文字）
 *   - 数值必须真的是"量"（排除年份 19xx/20xx、序号 1-9 这类）
 */
function tryChart(s: Slide): Partial<Slide> | null {
  const hits: NumHit[] = []
  for (const b of s.bullets) {
    const h = extractNumbers(b)
    if (h) hits.push(h)
  }
  if (hits.length < 3) return null
  // 过滤掉不像指标的值：年份、太小的一次性序号
  const usable = hits.filter((h) => {
    if (h.value >= 1900 && h.value <= 2100) return false // 年份不是指标
    if (/^\d+级$/.test(h.raw) && h.value <= 6) return false // "5级"不是可比较的量
    if (!isMetricLabel(h.label)) return false
    return true
  })
  if (usable.length < 3) return null
  // 数值量级差异过大（最大/最小 > 50 倍）时柱状图会失真，改判为不适合
  const vals = usable.map((h) => Math.abs(h.value)).filter((v) => v > 0)
  if (vals.length < 3) return null
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  if (max / Math.max(min, 0.0001) > 50) return null
  // 至少一半带单位的才是真指标（无单位的裸数字多为编号/年份）
  const withUnit = usable.filter((h) => /%|万|亿|人次|张|台|家|个|人|天|小时|分钟|条|项|套|所|市|省|元/.test(h.raw))
  if (withUnit.length < 2) return null
  // 2026-10-30 量纲一致性：混不同单位的柱图没有可比性（实测"建设周期9(月)"与"覆盖率42%"画在一起）
  // 判据加强：① 单位后缀含时间/金额 → 该指标归 time/money；
  //          ② 标签本身含「周期/时长/工期」或「金额/投资/成本」也归类；
  //          ③ time 或 money 与其它量纲混排一律放弃（这类对比该用表格，不是柱图）。
  const kindOf = (h: NumHit): string => {
    const label = h.label
    if (h.raw.endsWith("%")) return "pct"
    const u = h.raw.replace(/^[\d.]+/, "")
    if (/月|天|小时|分钟|周|年/.test(u)) return "time"
    if (/万|亿|元/.test(u)) return "money"
    if (/(周期|时长|工期|耗时|天数|月数)/.test(label)) return "time"
    if (/(金额|投资|成本|预算|费用|报价)/.test(label)) return "money"
    if (/项|个|条|套|所/.test(u)) return "count"
    if (/家|人|人次/.test(u)) return "people"
    return "other"
  }
  const unitKinds = new Set(usable.map(kindOf))
  if (unitKinds.has("time") || unitKinds.has("money")) {
    if (unitKinds.size > 1) return null
  }
  const unit = /%/.test(usable[0].raw) ? "%" : ""
  // 2026-10-30 加严：分类名必须完整可读（实测出现"某三级中医院，建"这种被逗号截断的烂标签）
  // 去掉"由/从/提升至/达到/降至"这类比较连接词尾巴，只留指标名
  const cleanCat = (raw: string): string =>
    raw
      .replace(/[，,、：:；;].*$/, "")
      .replace(/(由|从|至|到|达|为|是|cover|提升到|提升至|下降至|升至).*$/, "")
      .trim()
  const categories = usable.slice(0, 6).map((h) => cleanCat(h.label))
  if (categories.some((c) => c.length < 2 || c.length > 10)) return null
  // 分类名要去重（同一指标出现两次画的图没意义）
  if (new Set(categories).size < categories.length) return null
  const chart: SlideChart = {
    type: "bar",
    title: s.title.replace(/[：:].*$/, "").slice(0, 20) || "关键指标",
    unit,
    categories,
    series: [{ name: "数值", data: usable.slice(0, 6).map((h) => h.value) }],
  }
  // 保留图注说明（把原始要点压成一句），避免信息丢失
  const note = usable.slice(0, 6).map((h) => `${h.label} ${h.raw}`).join("；")
  return { layout: "chart", chart, bullets: [note.slice(0, 60)] }
}

/** label 看起来像不像一个指标名（率/量/数/占比/周期/规模…） */
function isMetricLabel(label: string): boolean {
  const l = String(label ?? "").trim()
  if (l.length < 2) return false
  // 指标词表（含量词类：项/家/市/人 等也常作为指标标签）
  if (/(率|量|数|占比|比例|周期|规模|时长|天数|人数|金额|成本|效率|覆盖|完成|增长|下降|交付|服务|项目|医院|客户|城市|团队|人员|条款|模块|系统)/.test(l)) return true
  // 中文字数 >= 3 的名词短语
  return /^[\u4e00-\u9fa5A-Za-z0-9]{3,12}$/.test(l) && !/(和|与|及|的|了|是|在|为)/.test(l)
}

/**
 * 规则 2：并列要点 → kpi（数字亮点卡）
 * 判定：3-4 条要点，每条都能抽出「标签 + 数值」，且**数值当量不一致才判 kpi**
 * （都带 % 或都是同单位时更像"一组指标对比"，应交给 chart —— 见 tryChart 的同类判定）
 */
function tryKpi(s: Slide): Partial<Slide> | null {
  if (s.bullets.length < 3 || s.bullets.length > 4) return null
  const hits = s.bullets.map((b) => extractNumbers(b))
  if (hits.some((h) => !h)) return null
  const list = hits as NumHit[]
  // 全是百分比 → 更像指标对比图，不判 kpi（让 chart 接手）
  if (list.every((h) => h.raw.endsWith("%"))) return null
  // 2026-10-30 加严：年份/序号不是"亮点数字"（实测「2021」被当成 KPI 值）
  if (list.some((h) => (h.value >= 1900 && h.value <= 2100) || /^\d+级$/.test(h.raw))) return null
  // 2026-10-30：「2级」这类评级等级不是可比较的业绩数字（实测「二级甲等」被抽成 KPI）
  if (list.some((h) => /^\d+$/.test(h.raw.replace(/级.*$/, "")) && h.raw.includes("级") && h.value <= 9)) return null
  // label 必须像指标名
  if (!list.every((h) => isMetricLabel(h.label))) return null
  // 单位完全一致且都带单位 → 也可做对比图；kpi 更适合"量纲不同的大数字"
  const units = new Set(list.map((h) => h.raw.replace(/^[\d.]+/, "")))
  if (units.size === 1 && !units.has("")) return null
  const kpi: SlideKpi[] = list.map((h) => ({ value: h.raw, label: h.label.slice(0, 14) }))
  return { layout: "kpi", kpi }
}

/**
 * 规则 3：分层/架构类 → architecture 图示
 * 判定：标题或要点里出现「分层/架构/技术栈/总体设计」等**结构性**词，且要点数 ≥3
 *
 * 2026-10-30 加严（实测严重误判）：
 *   反例 P3「数据标准不统一」被当成架构图，层名变成"药名不互通"——这是痛点清单不是架构；
 *   反例 P27「服务体系：7×12小时支持」被当成架构图，层名变成"重大故障2小时到场"。
 *   根因：只匹配了「体系/平台」这类泛词。改为必须命中**真·分层**特征，且
 *   每条要点要能拆出 ≥2 个模块名（分层的实质是"一层含多个组件"）。
 */
/** 架构语义标题词表（2026-11-04：补「一体化平台/信息平台/中台」） */
const ARCH_TITLE_RE = /(分层|层级|架构|技术栈|总体设计|一体化平台|信息平台|中台|平台架构)/
/** 痛点/现状类标题：不是分层结构，不能被画成架构图 */
const PAIN_TITLE_RE = /(短板|问题|瓶颈|痛点|现状|不足|缺失)/

function tryArchitecture(s: Slide): Partial<Slide> | null {
  const title = s.title ?? ""
  // 必须是"结构/分层"语义，且标题本身要像架构（不能只是提到"体系"两个字）。
  // 2026-11-04 适度放宽：「一体化平台 / 信息平台 / 中台」这类标题也算架构语义。
  if (!ARCH_TITLE_RE.test(title)) return null
  // 纯痛点清单（标题含 短板/问题/瓶颈/现状 且无真·架构词）绝不能画成分层——
  // 实测反例「数据标准不统一」被当成架构图，层名变成"药名不互通"。
  if (PAIN_TITLE_RE.test(title) && !/(架构|分层|层级|技术栈|总体设计)/.test(title)) return null
  if (s.bullets.length < 3) return null
  const layers = s.bullets.slice(0, 5).map((b, i) => {
    const name = layerNameOf(b, i)
    const body = b.replace(/^[^：:]{0,10}[：:]/, "") // 去掉"第X层："前缀
    const modules = body
      .split(/[，,、；;]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 12)
      .slice(0, 4)
    if (modules.length >= 2) return { name, modules }
    // 2026-11-04 放宽：拆不出 ≥2 个模块时不再整页放弃，
    // 而是把这一层的整句压成 1 个模块（层名兜底），至少能出架构框。
    const one = (modules[0] ?? body).replace(/\s+/g, "").slice(0, 16).trim()
    return { name, modules: [one.length >= 2 ? one : name] }
  })
  const fig: FigureSpec = { type: "architecture", title: "分层架构", layers }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/** 从"第X层：xxx"或"应用层，xxx"里取层名；取不到就用序号名 */
function layerNameOf(bullet: string, idx: number): string {
  const m = /^(第[一二三四五六七八九十\d]+层|[^，,、；:：]{1,8}层|[^，,、；:：]{1,6}平台)[：:，,]/ .exec(bullet)
  if (m) return m[1]
  return `第${idx + 1}层`
}

/**
 * 规则 4：步骤/流程类 → flow 图示
 * 判定：标题或要点里出现流程语义词，且要点数 ≥3，且每条都像一个步骤。
 */
/** 流程语义词表（2026-11-04：补「分期/分步/三步走/路线图」；再补「一期/二期」裸期数写法） */
const FLOW_WORD_RE = /(步骤|流程|阶段|路径|实施|推进|建设顺序|里程碑|分期|分步|三步走|路线图|第[一二三四五六七八九十\d]+期|[一二三四五六七八九十]+期)/
/** 序数/阶段标记（2026-11-04：补「一期/二期」「第N期」「步骤N」「阶段N」） */
const STEP_ORDER_RE =
  /(第[一二三四五六七八九十\d]+[期步层]|[一二三四五六七八九十]+期|步骤\s*\d*|阶段\s*\d*|三步走|分阶段|分步|首先|其次|然后|最后|\d+[.、)])/
/** 标题自带强时序语义时，允许序数词不足 2 条（用标题语义兜底） */
const FLOW_TITLE_TIMED_RE = /(三步走|分期|分阶段|实施路径|实施路线|路线图|实施步骤|建设路径)/

function tryFlow(s: Slide): Partial<Slide> | null {
  const title = s.title ?? ""
  const joined = [title, ...s.bullets].join(" ")
  if (!FLOW_WORD_RE.test(joined)) return null
  if (s.bullets.length < 3) return null
  // 2026-10-30 加严：每一条都得像"一个步骤"，而不是"一句解释"。
  // 实测反例：「评级逻辑 电子病历5级要求…」被当成流程步骤，语义错乱。
  // 2026-11-04 放宽：head 上限 14→22 字——「一期（3-6个月）：…」这类步骤名本身就长；
  // 论述词判据保留（含"因为/说明/意味着/要求/逻辑"的仍不是步骤，宁可不转）。
  const looksLikeStep = (b: string): boolean => {
    const head = b.split(/[：:，,。；;]/)[0].trim()
    if (head.length > 22) return false
    if (/(因为|所以|说明|意味着|要求|导致|逻辑|原因|因此|从而|本质|核心在于)/.test(head)) return false
    return true
  }
  if (!s.bullets.every(looksLikeStep)) return null
  // 至少 2 条带序数/阶段词，才确信这是流程页（否则可能只是并列要点）；
  // 标题已写明「三步走/分期/路线图」时视为强时序，可豁免该条。
  const ordered = s.bullets.filter((b) => STEP_ORDER_RE.test(b))
  if (ordered.length < 2 && !FLOW_TITLE_TIMED_RE.test(title)) return null
  const steps = s.bullets.slice(0, 6).map((b) => {
    const [name, ...rest] = b.split(/[：:，,]/)
    return { name: name.trim().slice(0, 18), ...(rest.length ? { desc: rest.join("，").trim().slice(0, 24) } : {}) }
  })
  const fig: FigureSpec = { type: "flow", title: "实施路径", steps }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/**
 * 规则 5：两条对照（现状/目标、我方/友商）→ table(compare)
 * 判定：正好 2-4 条要点，每条都能拆成两段（「A：B」形式）
 */
function tryTable(s: Slide): Partial<Slide> | null {
  if (s.bullets.length < 2 || s.bullets.length > 4) return null
  // 流程/阶段类不走表格（"第一阶段：xxx"、"一期（3-6个月）：xxx" 也是 A：B 形式，
  // 但它们该画流程图）。2026-11-04：补「分期/分步/三步走/路线图/N期」。
  const joined = [s.title, ...s.bullets].join(" ")
  if (/(步骤|流程|阶段|路径|推进|里程碑|分期|分步|三步走|路线图|第[一二三四五六]步|[一二三四五六七八九]+期)/.test(joined))
    return null
  const rows = s.bullets.map((b) => {
    const m = /^(.{2,14}?)[：:]\s*(.+)$/.exec(b)
    return m ? [m[1].trim(), m[2].trim()] : null
  })
  if (rows.some((r) => !r)) return null
  const fig: FigureSpec = {
    type: "table",
    title: "维度对照",
    columns: ["维度", "说明"],
    rows: rows as string[][],
    variant: "compare",
  }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/**
 * 规则 6（兜底）：并列论点 → 图标矩阵（iconGrid）
 *
 * 为什么需要：实测 AI 生成里最高频的"难视觉化"页型是
 * 「一个标题 + 3-6 条平行短句」，既无数据（画不了图）、无层次（画不了架构）、
 * 无时序（画不了流程），以前只能退化成文字卡片。
 * 图标矩阵给每项一个图标位+色条+大标题，让这类页也有版面结构。
 *
 * 判定：3-6 条要点，每条 4-24 字（像短语而非长句）。
 * 这一条放最后：只有前面所有结构化规则都不适用时才用。
 */
function tryIconGrid(s: Slide): Partial<Slide> | null {
  const items = s.bullets.filter((b) => {
    const t = b.trim()
    return t.length >= 4 && t.length <= 40
  })
  if (items.length < 3) return null
  const fig: FigureSpec = {
    type: "iconGrid",
    title: "要点矩阵",
    items: items.slice(0, 6).map((b) => {
      const t = b.trim()
      // 「标题：说明」形式拆成两块
      const m = /^(.{2,14}?)[：:]\s*(.+)$/.exec(t)
      if (m) return { label: m[1].trim(), desc: m[2].trim() }
      // 2026-10-30 实测修正：原句常是"对标电子病历5级与互联互通四级甲等目标"这种长短语，
      // 直接当 label 会撑满一行、卡片下半留白。改为在自然断点处拆成 主标 + 说明。
      const cut = splitLabelDesc(t)
      return cut
    }),
  }
  return { layout: "image-right", figures: [fig], imageHint: "" }
}

/**
 * 把一条要点拆成「主标 + 说明」。
 *
 * 2026-10-30 二次修正（实测踩坑）：
 * 第一版对 >14 字就硬拆，结果把「四诊（望闻问切）数据未进电子病历」这类
 * **本来就适合当卡片主标的 15-20 字短语**截成半句 + 空说明，反而更差。
 *
 * 现策略（更保守，宁可不拆）：
 *   ① ≤24 字 → 整句当主标（卡片 2 行放得下，这是最常见情况）；
 *   ② 有明确的「A：B」冒号结构 → 拆；
 *   ③ 有并列词且在中间位置（6~14 字处）→ 拆成 A / B；
 *   ④ 其余 → 整句当主标，不产生说明（说明留空比截断好）。
 */
function splitLabelDesc(text: string): { label: string; desc?: string } {
  const t = text.trim().replace(/^[、，,。；;]+/, "")
  // ② 冒号结构优先
  const colon = /^(.{4,20}?)[：:]\s*(.{3,})$/.exec(t)
  if (colon) return { label: colon[1].trim(), desc: colon[2].trim() }
  // ① 常见长度直接当主标
  if (t.length <= 24) return { label: t }
  // ③ 长句才在并列词处断
  const seps = ["以及", "与", "和", "、", "，"]
  for (const sep of seps) {
    const idx = t.indexOf(sep)
    if (idx >= 8 && idx <= 18) {
      const label = t.slice(0, idx).trim()
      const desc = t.slice(idx + sep.length).trim()
      if (label.length >= 6 && desc.length >= 6) return { label, desc }
    }
  }
  // ④ 仍放不下：整句当主标（渲染层会折行 + 缩字号）
  return { label: t }
}

/**
 * 生成「形态优化建议」——**只返回清单，不自动应用**。
 *
 * 2026-10-30 曾据此把 reshape 从生成流程里摘掉；2026-11-04 用户实测「整册仍是纯文字」，
 * 因为建议只写进 localStorage 的 `pp_reshape_suggestions_*`、全仓没有读取/一键应用入口，
 * 建议永远落不了地。
 *
 * 现口径：生成落库前**自动整形**（usePptQuote 调 reshapeTextHeavySlides），
 * 本函数只负责给「整形后仍无视觉形态」的残余页出可选建议。
 */
export type ReshapeSuggestion = {
  slideIndex: number
  title: string
  /** 建议改成什么 kind */
  suggestedKind: "chart" | "kpi" | "table" | "flow" | "architecture" | "iconGrid"
  /** 中文说明（给用户看的理由） */
  reason: string
  /** 应用后的页面（用户在界面点"应用"时才写入） */
  patch: Partial<Slide>
}

/** kind → 建议里展示的页型（不在建议体系里的 kind 归到最接近的一项） */
function declaredSuggestionKind(s: Slide): ReshapeSuggestion["suggestedKind"] {
  switch (s.kind) {
    case "architecture":
    case "flow":
    case "kpi":
    case "table":
    case "chart":
      return s.kind
    default:
      return "iconGrid"
  }
}

export function suggestReshape(slides: Slide[]): ReshapeSuggestion[] {
  const out: ReshapeSuggestion[] = []
  slides.forEach((s, i) => {
    if (hasVisual(s)) return
    const lay = s.layout ?? "auto"
    if (lay === "section") return
    const attempts: [ReshapeSuggestion["suggestedKind"], string, () => Partial<Slide> | null][] = [
      // 与 reshapeTextHeavySlides 同序：先按大纲声明页型，再按语义规则
      [
        declaredSuggestionKind(s),
        "这页大纲已声明为结构化页型，可画成对应的图示",
        () => tryDeclaredKind(s),
      ],
      ["kpi", "这页有几组并列的关键数字，可做成数字亮点卡更醒目", () => tryKpi(s)],
      // 与 reshapeTextHeavySlides 同序：架构/流程先于 table，否则 A：B 形式会被判成表格
      ["architecture", "这页讲的是分层/架构组成，可画成架构图", () => tryArchitecture(s)],
      ["flow", "这页讲的是步骤/流程，可画成流程图", () => tryFlow(s)],
      ["table", "这页是并列对照结构，可做成表格更清晰", () => tryTable(s)],
      ["chart", "这页有可比较的数值序列，可做成柱图", () => tryChart(s)],
      ["iconGrid", "这页是并列论点，可做成要点矩阵更规整", () => tryIconGrid(s)],
    ]
    for (const [kind, reason, fn] of attempts) {
      // 单条规则异常不影响其它规则：catch 里给 null 继续试下一条
      let patch: Partial<Slide> | null
      try {
        patch = fn()
      } catch {
        patch = null
      }
      if (patch) {
        out.push({ slideIndex: i, title: s.title, suggestedKind: kind, reason, patch })
        break
      }
    }
  })
  return out
}

export interface ReshapeStats {
  /** 被整形的页数 */
  reshaped: number
  /** 按规则分布 */
  byRule: Record<string, number>
  /** 版式降级数（声明了 image/banner 但无配图 → 改走可渲染版式） */
  downgraded: number
}

/**
 * 规则 0（最先执行）：修正"声明了视觉版式却没有视觉素材"的页
 *
 * 2026-10-30 实测发现：模型会把页面 layout 标成 banner/image-right，
 * 但 imageHint 没落地成真实图片 → 渲染时退化成"纯文字卡片"，观感最差。
 * 这类页要么补图，要么改走能自渲染的版式（architecture/flow/table/chart/kpi）。
 */
function fixDanglingImageLayout(s: Slide): Partial<Slide> | null {
  const lay = s.layout ?? "auto"
  const wantsImage = lay === "banner" || lay === "image-right" || lay === "image-left"
  if (!wantsImage || s.image) return null
  // 无图：交给后续规则去转成能自渲染的版式；都不匹配则回到 auto（卡片网格可兜住）
  return { layout: "auto" }
}

/**
 * 对整册做形态整形：只处理「纯文字且文字偏多」的页，已有视觉的页一律不动。
 *
 * @param slides    AI 生成的页面
 * @param opts.maxTextOnlyRatio 允许**保留**的纯文字页比例（默认 0.25，即最多留 25% 纯文字，
 *                              其余内容页都会被尝试转成视觉形态；封面/致谢/section 不计）
 */
export function reshapeTextHeavySlides(
  slides: Slide[],
  opts?: { maxTextOnlyRatio?: number },
): { slides: Slide[]; stats: ReshapeStats } {
  const stats: ReshapeStats = { reshaped: 0, byRule: {}, downgraded: 0 }
  const contentCount = Math.max(1, slides.length - 2)
  // 2026-11-04 语义修正：本参数是「允许保留的纯文字页比例」，预算 = 内容页 − 允许保留数。
  // 旧实现直接拿 ratio 当整形配额（默认 0.4 → 只整形 40%），与 JSDoc 相反：
  // 实测 10 页册子只转 3 页，用户看到的仍是满屏文字。
  const maxTextOnly = Math.floor(contentCount * (opts?.maxTextOnlyRatio ?? 0.25))
  const budget = Math.max(0, contentCount - maxTextOnly)

  // 规则 0（先于一切）：无配图却声明了 image/banner 的页，先降级 layout，
  // 否则它们既进不了候选集（hasVisual=false 但 layout 是 image），又渲染成最丑的纯文字。
  const pre = slides.map((s) => {
    const patch = fixDanglingImageLayout(s)
    if (patch) {
      stats.downgraded += 1
      return { ...s, ...patch }
    }
    return s
  })

  // 先算出哪些页是纯文字候选，按「文字量从大到小」优先整形（字越多越该改）
  const candidates = pre
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !hasVisual(s) && (s.layout ?? "auto") !== "section")
    .sort((a, b) => textLoad(b.s) - textLoad(a.s))

  const used = new Set<number>()
  const out = pre.slice()

  for (const { s, i } of candidates) {
    if (used.size >= budget) break
    // 逐一尝试规则，命中即停。
    // 顺序原则：越"具体/越能保留信息"的规则越优先——
    //   kpi(3-4个并列数字) 比 chart 更贴合"每项一个亮点"的语义，先试；
    //   architecture/flow 是有语义前提的结构性规则，必须先于 table：
    //     「一期（3-6个月）：…」「统一门户：…」也都是 A：B 形式，
    //     若 table 先跑，架构/流程页会被当成两列表格抢走（实测就是这样丢图的）；
    //   chart 放最后作为"有多个数值但说不清关系"的兜底。
    const attempts: [string, () => Partial<Slide> | null][] = [
      // 2026-11-04 C 项：大纲已声明页型的页优先按声明整形（标题常是结论句，不含结构关键词）
      ["declared", () => tryDeclaredKind(s)],
      ["kpi", () => tryKpi(s)],
      ["architecture", () => tryArchitecture(s)],
      ["flow", () => tryFlow(s)],
      ["table", () => tryTable(s)],
      ["chart", () => tryChart(s)],
      // 兜底：前面都不适用时，用图标矩阵把并列论点视觉化（避免退化成文字墙）
      ["iconGrid", () => tryIconGrid(s)],
    ]
    for (const [name, fn] of attempts) {
      // 单条规则异常不影响其它规则：catch 里返回 null 继续试下一条
      let patch: Partial<Slide> | null
      try {
        patch = fn()
      } catch {
        patch = null
      }
      if (patch) {
        out[i] = { ...s, ...patch }
        stats.reshaped += 1
        stats.byRule[name] = (stats.byRule[name] ?? 0) + 1
        used.add(i)
        break
      }
    }
  }
  return { slides: out, stats }
}
