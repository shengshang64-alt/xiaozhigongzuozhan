// ---------------------------------------------------------------------------
// 段落价值评估（2026-10-31 原子抽取产出率优化）
//
// 实测问题：B0 批次抽取产出率极低。
//   3 篇高质量方案文档（每篇 6-12 万字）共 24 段（每篇前 8 段）→ 只抽出 7 条原子，
//   其中 20 段被判「无可抽内容」。原因是 splitWithAnchor 从头切段，
//   而大文档的前 8 段往往是：封面、目录、项目背景、政策铺垫 —— 全是提示词明令「绝对不抽」的内容。
//
// 修法：抽取前先给段落打分，跳过明显低价值的段（目录/封面/背景），
//       优先抽「有具体事实、数值、案例、产品能力」的段。
//
// 纯本地、零 AI、零副作用。
// ---------------------------------------------------------------------------

export type ParagraphValue = {
  /** 价值分 0-1，越高越值得抽 */
  score: number
  /** 判定为低价值的原因（用于日志/调试） */
  reasons: string[]
}

/** 目录行特征：点线、页码、"第X章"单独成行、"目录" 字样 */
const TOC_PATTERNS = [
  /[.·]{4,}/, // 点线引导
  /^\s*目\s*录\s*$/m,
  /^\s*第\s*[一二三四五六七八九十百\d]+\s*[章节部分篇]\s*[^\n]{0,30}\s*\.{2,}/m,
  /\.{2,}\s*\d+\s*$/m, // 末尾页码
]

/** 封面/声明特征 */
const COVER_PATTERNS = [
  /^\s*(投\s*标\s*文\s*件|谈\s*判\s*响\s*应\s*文\s*件|响\s*应\s*文\s*件)\s*$/m,
  /^\s*(正\s*本|副\s*本|副本|正本)\s*$/m,
  /项目名称\s*[：:]\s*$|项目编号\s*[：:]\s*$|供\s*应\s*商\s*[：:]\s*$|包\s*号\s*[：:]\s*$/, // 空白模板
  /^\s*20\d\d\s*年\s*\d{1,2}\s*月\s*$/m, // 单独成行的日期
]

/** 背景铺垫/套话特征（提示词明确「绝对不抽」） */
const FLUFF_PATTERNS = [
  /随着[^，。]{0,20}(发展|进步|推进|深入)[，,、]/,
  /近年来[，,]/,
  /在[^，。]{0,10}背景下/,
  /(深入贯彻|全面贯彻|认真落实|积极响应)[^，。]{0,25}(战略|政策|精神|要求)/,
  /^(公司简介|企业简介|公司概况|企业文化|企业愿景|组织架构|致谢|前言|序言)/m,
  // 2026-10-31 实测补充：医院/客户介绍段落在方案范本里极常见，但它不含可抽原子
  // （实测「赣南医学院第一附属医院坐落于赣州…」这类段落模型正确返回空）。
  /(坐落于|始建于|创办于|成立于)\d{4}年/,
  /(三级甲等|三甲)(综合)?医院/,
  /(筚路蓝缕|风雨兼程|春华秋实|从无到有|从小到大)/,
  /(占地面积|建筑面积|编制床位|开放床位|年门诊量|年住院量)/,
  /(全院|医院)(现有|共有|拥有)\s*\d+\s*(名|人|个)/,
]

/**
 * 有具体事实的信号（加分项）。
 *
 * 2026-10-31 实测校准：权重按「能不能抽出原子」重排。
 * 反例（第一版给 0.25 分）：医院简介「坐落于赣州…创办于1958年…三甲医院」
 *   含数字又含医疗词，得分 0.9，但模型正确判定无可抽原子 → 白花一次调用。
 * 正例：产品能力描述「支持XX模块，实现YY功能，兼容ZZ标准」→ 能稳定抽出 product_capability。
 */
const VALUE_SIGNALS = [
  // 最强信号：产品能力 / 技术规格（能稳定抽出 product_capability / metric）
  { re: /(支持|具备|提供|实现|兼容|适配)[^，。]{3,40}(功能|模块|能力|接口|标准|协议)/, weight: 0.35, name: "+产品能力" },
  { re: /(HIS|EMR|LIS|PACS|CDSS|DRG|DIP|HRP|集成平台|数据中台|电子病历|互联互通)/i, weight: 0.30, name: "+具体产品" },
  // 案例/业绩（能抽 case）
  { re: /(中标|承担|承建|已实施|成功上线|通过验收|案例|标杆|示范)/, weight: 0.30, name: "+案例业绩" },
  // 资质/标准（能抽 qualification / policy）
  { re: /(资质|证书|认证|等级保护|等保|CMMI|ISO\d+|测评|评级)([^，。]{0,20})(证书|编号|通过|获得)/, weight: 0.25, name: "+资质标准" },
  // 带口径的数值（能抽 metric）
  { re: /\d+(\.\d+)?\s*(级|%|万人次|万张|亿元|万元)\s*(以上|以下|以内|达标|通过)/, weight: 0.25, name: "+带口径指标" },
  // 技术要素
  { re: /(系统|平台|模块|功能|接口|架构|数据库|中间件|微服务)/, weight: 0.15, name: "+技术要素" },
]

/**
 * 评估单个段落的抽取价值。
 *
 * @param text 段落正文
 * @returns 分值 0-1（<0.25 建议跳过）
 */
export function assessParagraphValue(text: string): ParagraphValue {
  const t = String(text ?? "").trim()
  // 2026-10-31 实测校准：原阈值 40 字会把 30 字左右的高密度产品描述误判为过短
  // （例："系统支持病案管理功能模块，具备统计报表能力，实现数据导出与接口对接。" 34 字，价值很高）。
  // 降到 20 字，真正的标题行（"一、项目概述"）仍会被后面「疑似标题」规则过滤。
  if (t.length < 20) return { score: 0, reasons: ["过短"] }

  const reasons: string[] = []
  let score = 0.3 // 基准分：段落本身有一定信息量

  // ---- 低价值扣分 ----
  let penalty = 0
  if (TOC_PATTERNS.some((re) => re.test(t))) {
    penalty += 0.6
    reasons.push("目录")
  }
  if (COVER_PATTERNS.some((re) => re.test(t))) {
    penalty += 0.5
    reasons.push("封面/空白模板")
  }
  const fluffHits = FLUFF_PATTERNS.filter((re) => re.test(t)).length
  if (fluffHits > 0) {
    penalty += 0.3 * Math.min(2, fluffHits)
    reasons.push("背景套话")
  }

  // 标题行判据：短 **且** 不含句末标点（"1.2 建设目标" 是标题；"系统支持XX功能。" 是正文）
  if (t.length < 60 && !/[。；！？]/.test(t)) {
    penalty += 0.15
    reasons.push("疑似标题")
  }

  // ---- 高价值加分 ----
  let bonus = 0
  for (const sig of VALUE_SIGNALS) {
    if (sig.re.test(t)) {
      bonus += sig.weight
      reasons.push(`+${sig.name}`)
    }
  }
  // 数值密度加成
  const digits = (t.match(/\d/g) ?? []).length
  const density = digits / t.length
  if (density > 0.03) {
    bonus += 0.1
    reasons.push("+数值密集")
  }

  score = Math.max(0, Math.min(1, score - penalty + bonus))
  return { score, reasons }
}

/**
 * 从段落列表中挑出最值得抽取的 N 段。
 *
 * @param paragraphs 段落（含 anchor）
 * @param n 最多返回多少段
 * @param minScore 价值分下限（默认 0.25，低于此认为是目录/封面/套话）
 */
export function pickValuableParagraphs<T extends { text: string }>(paragraphs: T[], n: number, minScore = 0.25): T[] {
  // 2026-10-31 去重：实测技术标书常把同一条需求在「需求清单/技术响应/偏离表」里写多遍
  // （真实案例：段23/34/91 内容几乎逐字相同，都得了 0.95 分）。
  // 若不去重，选出的 8 段可能全是同一件事，抽取产出的原子高度冗余。
  const seenKeys = new Set<string>()
  const scored = paragraphs
    .map((p, i) => ({ p, i, v: assessParagraphValue(p.text) }))
    .filter((x) => x.v.score >= minScore)
    .sort((a, b) => b.v.score - a.v.score || a.i - b.i)

  const deduped: typeof scored = []
  for (const x of scored) {
    const key = dedupeKey(x.p.text)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    deduped.push(x)
    if (deduped.length >= n) break
  }

  // 按原文顺序返回（保持阅读连贯性）
  return deduped.sort((a, b) => a.i - b.i).map((x) => x.p)
}

/** 段落去重键：归一化（去空白标点、取前 60 字）后比较 */
function dedupeKey(text: string): string {
  return String(text ?? "")
    .replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
    .slice(0, 60)
}

/** 统计段落价值分布（用于诊断） */
export function summarizeParagraphValues(paragraphs: { text: string }[]): {
  total: number
  valuable: number
  skipped: number
  skipReasons: Record<string, number>
} {
  let valuable = 0
  const skipReasons: Record<string, number> = {}
  for (const p of paragraphs) {
    const v = assessParagraphValue(p.text)
    if (v.score >= 0.25) {
      valuable += 1
    } else {
      for (const r of v.reasons.filter((x) => !x.startsWith("+"))) {
        skipReasons[r] = (skipReasons[r] ?? 0) + 1
      }
    }
  }
  return {
    total: paragraphs.length,
    valuable,
    skipped: paragraphs.length - valuable,
    skipReasons,
  }
}
