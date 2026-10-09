// ---------------------------------------------------------------------------
// R159（闭环 r152-star-symbol-loss）：招标文本标注符号丢失检测（纯函数，零依赖、零费用）。
// 根因取证：三明 F05 精简版「标注“”的条款为实质性要求」不是检索选块或引号转义丢失——
// 原 docx 全包 XML 扫描 ★ 0 处（▲ 17 处），符号在上游文档制作/转换时已丢失，文本里只
// 留下「空引号对」签名。此类污染会静默影响 ★/▲ 重点条款扫描、解析报告引文与合规矩阵。
// 系统不猜缺失符号（★/▲/●皆可能，猜=编造），但必须诚实上报签名并提示人工对照原件——
// 与项目「只报告不拦截」「素材缺失处诚实标注」口径一致。
// 保守判据（宁漏勿误）：只认两类强签名——
//  ① 「标注/标记/注明 + 空引号对」或「空引号对 + 的条款/要求/指标/项目/内容」（符号定义句特征）；
//  ② 私用区字符 U+F000-U+F2FF 残留（Wingdings/Symbol 符号字体被原样录入文本的另一种形态）。
// ---------------------------------------------------------------------------

export interface MarkerLossReport {
  /** 空引号对签名命中数（标注约定句式） */
  emptyQuoteCount: number
  /** 私用区残留字符数 */
  puaCount: number
  /** 合计疑点数（emptyQuoteCount + puaCount） */
  hits: number
  /** 命中行摘录（单行 ≤60 字，最多 5 条），供提示展示定位 */
  samples: string[]
}

// 空引号对：左右引号之间只有空白（弯引号/直角引号/半角引号均可，半角兼作两侧）。
// 前缀式：标注/标记/注明 至多隔 2 个非换行字符紧跟空引号对（“标注“”的条款…”定义句主形态）；
// 后缀式：空引号对 + 的 + 条款/要求/指标/项目/内容（前缀动词被改写时的兜底形态）。
const MARK_LOSS_RE =
  /(?:标注|标记|注明)[^\n]{0,2}?[“「『"]\s*[”」』"]|[“「『"]\s*[”」』"]\s*的\s*(?:条款|要求|指标|项目|内容)/g
// 私用区残留：符号字体（Wingdings F0F5=★ 等）被当作正文原样录入文本时的字符形态
const PUA_RE = /[\uF000-\uF2FF]/g

/** 检测招标文本中的标注符号丢失签名（空引号对 + 私用区残留），纯函数可重复调用 */
export function detectMarkerSymbolLoss(text: string): MarkerLossReport {
  const src = text ?? ""
  const emptyQuoteCount = (src.match(MARK_LOSS_RE) ?? []).length
  const puaCount = (src.match(PUA_RE) ?? []).length
  const samples: string[] = []
  if (emptyQuoteCount || puaCount) {
    const lineHit = new RegExp(MARK_LOSS_RE.source) // 去 g 防 lastIndex 粘连
    const puaLine = new RegExp(PUA_RE.source)
    for (const raw of src.split("\n")) {
      if (samples.length >= 5) break
      const line = raw.trim()
      if (!line) continue
      if (lineHit.test(line) || puaLine.test(line)) samples.push(line.length > 60 ? line.slice(0, 60) + "…" : line)
    }
  }
  return { emptyQuoteCount, puaCount, hits: emptyQuoteCount + puaCount, samples }
}

// 逐行判定用：去 g 避免 lastIndex 粘连，与 detectMarkerSymbolLoss 同源签名
const MARK_LOSS_LINE_RE = new RegExp(MARK_LOSS_RE.source)
const PUA_LINE_RE = new RegExp(PUA_RE.source)

/** 单行是否命中符号丢失签名（空引号对句式或私用区残留）；供解析报告逐行挂「疑符号丢失」徽标 */
export function lineHasMarkerLoss(line: string): boolean {
  const l = (line ?? "").trim()
  if (!l) return false
  return MARK_LOSS_LINE_RE.test(l) || PUA_LINE_RE.test(l)
}

/** 统计一段文本命中符号丢失的行数（逐行判定、忽略空行）；供分区级徽标计数与跨会话复核 */
export function countMarkerLossLines(text: string): number {
  const src = text ?? ""
  if (!src) return 0
  let n = 0
  for (const raw of src.split("\n")) {
    if (lineHasMarkerLoss(raw)) n += 1
  }
  return n
}

/** 用户可见的一句式提示（零疑点返回空串）；文案单一真源，toast 与测试共用 */
export function markerLossNotice(r: MarkerLossReport): string {
  if (!r.hits) return ""
  const sample = r.samples[0] ? `（如“${r.samples[0].slice(0, 40)}”）` : ""
  return `招标文件文本发现 ${r.hits} 处疑似标注符号丢失${sample}，★/▲ 重点条款扫描可能不全，请对照招标原件核实`
}
