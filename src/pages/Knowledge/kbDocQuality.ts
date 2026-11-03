// 文档质量评估（2026-10-30 知识库优化）
//
// 为什么需要它：真实数据预演发现，7005 篇里有 174 篇是"抽了也是垃圾"的文档——
//   · dict：50 万字的字典文件（不是业务文档）
//   · PPT素材/…P79：48-49 字的图片型 PPT 页碎片 × 164 篇
//
// 如果这些一起跑抽取，会产出大量垃圾原子污染审核队列，
// 把"300 篇 3-4.5 小时"的目标变成"1000 篇也审不完"。
//
// 这个模块按**确定性规则**筛掉不适合抽取的文档（不需要模型），
// 让抽取只跑"有内容可抽"的文档。
//
// 设计原则：
//   · 只做**排除判断**，不做"有用/没用"的语义判断（那是审核员的事）
//   · 规则必须可解释（每篇给出具体原因，用户能复核）
//   · 保守：拿不准就放行（宁可多抽几篇，也不要误杀）
// ---------------------------------------------------------------------------

/** 文档质量评估结果 */
export type DocQuality = {
  /** 是否适合进入抽取 */
  extractable: boolean
  /** 评分 0-1（越高越值得抽） */
  score: number
  /** 不抽取的原因（extractable=false 时必有） */
  reasons: string[]
  /** 建议动作 */
  action: "extract" | "skip" | "manual_review"
}

/** 判定阈值 */
export const THRESHOLDS = {
  /** 正文少于此字数不抽（太短撑不起一条原子：原子 body 上限 300 字，标题要陈述句） */
  minChars: 200,
  /** 单篇上限：超过此字数只抽前 N 字（避免一篇 50 万字跑几个小时） */
  maxCharsForExtract: 60_000,
  /** 疑似非业务文档的特征词（文件名/标题） */
  junkTitlePatterns: [/^dict$/i, /^新建/, /^无标题/, /^未命名/, /^\d+$/, /^Sheet\d*$/i, /^Table\d*$/i],
  /** 行平均长度低于此值 → 疑似表格/清单碎片（不是叙述性文本） */
  minAvgLineLength: 8,
}

/**
 * 评估一篇文档是否值得抽取。
 *
 * @param doc 文档的标题与正文
 */
export function assessDocQuality(doc: { title?: string; content?: string }): DocQuality {
  const title = String(doc.title ?? "").trim()
  const content = String(doc.content ?? "")
  const len = content.length
  const reasons: string[] = []

  // 1) 空/极短：撑不起一条原子
  if (len < THRESHOLDS.minChars) {
    return {
      extractable: false,
      score: 0,
      reasons: [`正文仅 ${len} 字，不足 ${THRESHOLDS.minChars} 字（多为图片型 PPT 页/空页碎片）`],
      action: "skip",
    }
  }

  // 2) 疑似非业务文档（字典、临时文件、纯数字编号）
  for (const re of THRESHOLDS.junkTitlePatterns) {
    if (re.test(title)) {
      reasons.push(`标题「${title}」命中非业务文档特征`)
      break
    }
  }

  // 3) 体量异常：超大文件多为字典/日志，不是业务文档
  if (len > 300_000) {
    reasons.push(`正文 ${Math.round(len / 10000)} 万字，疑似字典/日志文件而非业务文档`)
  }

  // 4) 文本结构检测：叙述性文本行较长；表格/清单碎片行很短
  const lines = content.split("\n").filter((l) => l.trim())
  const avgLineLen = lines.length ? content.replace(/\n/g, "").length / lines.length : 0
  if (lines.length > 20 && avgLineLen < THRESHOLDS.minAvgLineLength) {
    reasons.push(`平均每行仅 ${avgLineLen.toFixed(1)} 字，疑似表格/清单碎片而非叙述文本`)
  }

  // 5) 重复字符占比过高：乱码/占位符填充
  //
  // 2026-10-30 实测修正：原规则用「前 5000 字字符种类 < 50」判定乱码，
  // 会误杀正常文档——真实方案里"目录/章节标题反复出现""表格同列表头重复"
  // 都会让字符种类变少。改为组合判定：字符种类少 **且** 有超长重复串。
  const head = content.slice(0, 5000)
  const uniqChars = new Set(head).size
  if (len > 1000 && uniqChars < 50) {
    // 检测是否存在超长重复块（同 30 字片段连续重复 5 次以上 = 明显填充）
    let repeated = false
    const probe = head.slice(0, 30)
    if (probe.length === 30) {
      let count = 0
      for (let i = 0; i + 30 <= head.length; i += 30) {
        if (head.slice(i, i + 30) === probe) count += 1
      }
      repeated = count >= 5
    }
    if (repeated) {
      reasons.push(`前 5000 字只有 ${uniqChars} 种字符且存在超长重复块，疑似乱码或占位填充`)
    }
  }

  // 硬性不可抽
  if (reasons.length) {
    const isJunk = reasons.some((r) => r.includes("非业务文档") || r.includes("字典") || r.includes("乱码"))
    return {
      extractable: false,
      score: 0,
      reasons,
      action: isJunk ? "skip" : "manual_review",
    }
  }

  // 6) 评分：内容越丰富越值得抽（但超过上限后不再加分，因为只抽前 N 字）
  const effectiveLen = Math.min(len, THRESHOLDS.maxCharsForExtract)
  // 200 字 → 0.2；2000 字 → 0.7；6000+ 字 → 1.0
  const score = Math.min(1, Math.log10(effectiveLen / 100) / Math.log10(600))

  const result: DocQuality = { extractable: true, score: Number(score.toFixed(2)), reasons: [], action: "extract" }

  // 提示：超过抽取上限时只会抽前面部分
  if (len > THRESHOLDS.maxCharsForExtract) {
    result.reasons.push(
      `正文 ${len.toLocaleString()} 字超过单次抽取上限，将只抽前 ${THRESHOLDS.maxCharsForExtract.toLocaleString()} 字（可分批续抽）`,
    )
  }
  return result
}

/** 批量评估并汇总（回填脚本用） */
export function summarizeQuality(
  docs: { id: string; title?: string; content?: string }[],
): {
  extractable: number
  skipped: number
  manualReview: number
  skipReasons: Map<string, number>
  details: { id: string; title: string; quality: DocQuality }[]
} {
  let extractable = 0
  let skipped = 0
  let manualReview = 0
  const skipReasons = new Map<string, number>()
  const details: { id: string; title: string; quality: DocQuality }[] = []

  for (const d of docs) {
    const q = assessDocQuality(d)
    details.push({ id: d.id, title: String(d.title ?? ""), quality: q })
    if (q.extractable) extractable += 1
    else if (q.action === "skip") {
      skipped += 1
      // 归因统计（取第一个原因的关键词）
      const key = q.reasons[0]?.includes("图片型") ? "短碎片" : q.reasons[0]?.includes("字典") ? "超大文件" : q.reasons[0]?.includes("表格") ? "表格碎片" : "其他"
      skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1)
    } else manualReview += 1
  }
  return { extractable, skipped, manualReview, skipReasons, details }
}
