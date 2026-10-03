// R144：★/▲ 重点条款噪声判定的单一真源（纯函数，零依赖）。
// 三条产出通道共用同一口径，避免噪声规则各写各的：
//  · extractStarClauses（本地扫描，起条前跳过）
//  · normalizeParseReport（AI 整文通道 + 存量 parse_report 打开即清洗）
//  · complianceMatrix.clausesOf（AI 补扫通道 + 合规矩阵/关键项清单归行）

const STAR_MARK_RE = /[★☆▲△]/

// 目录行：编号/中文序号/「附件」前缀 + 行尾「空白+1~4 位页码」收尾 + 短行（≤50 字）。
// 「行尾孤立即页码」是强判别信号（真实条款不以裸页码收尾），把误删真条款的风险压到极低。
const TOC_HEAD_NUM_RE = /^(?:\d{1,3}[.、)）]|[（(]\d{1,3}[)）]|[一二三四五六七八九十百]+[、.．]|附\s*件[\u4e00-\u9fa50-9]+[:：、.．])/
const TOC_TAIL_PAGE_RE = /\s\d{1,4}$/
export function looksLikeTocClauseLine(line: string): boolean {
  if (line.length > 50) return false
  return TOC_HEAD_NUM_RE.test(line) && TOC_TAIL_PAGE_RE.test(line)
}

// 标注含义解释句：以 ★/▲ 开头、说明「该标记意味着什么/如何评分」的约定句。
// 关键词收敛到「标注约定」专用语，避免误删 `▲ 某系统须支持……` 这类真实参数条款。
const STAR_DEFINE_RE = /^[★☆▲△][^\n]*?(为实质性要求|视为实质性|属于实质性|负偏离[^\n]{0,12}(扣分|无效投标|废标)|按无效投标处理|的含义|是指下列|标注说明)/
export function looksLikeStarDefinitionLine(line: string): boolean {
  return STAR_DEFINE_RE.test(line)
}

/** 综合判定：该行是否为不应建条的噪声（目录行或标注含义解释句）。 */
export function isStarClauseNoiseLine(line: string): boolean {
  return looksLikeTocClauseLine(line) || looksLikeStarDefinitionLine(line)
}

/**
 * 按「条」丢弃噪声条款：标记行命中噪声则该行连同其后未含标记的续行一并剔除，
 * 干净条款与其正文保持不动。幂等——本地扫描产出（无噪声行）原样返回，仅清洗 AI 通道/存量数据。
 * 用于 parse_report.star_clauses 的读清洗（AI 整文解析与补扫都可能把目录行当条款）。
 */
export function cleanStarClauseContent(content: string): string {
  if (!content) return content
  const out: string[] = []
  let dropping = false
  for (const line of content.split(/\r?\n/)) {
    if (STAR_MARK_RE.test(line)) {
      dropping = isStarClauseNoiseLine(line)
      if (dropping) continue
    } else if (dropping) {
      continue // 噪声条款的续行一并丢弃
    }
    out.push(line)
  }
  return out.join("\n").trim()
}
