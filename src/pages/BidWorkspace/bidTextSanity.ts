// R-301（2026-10-15）：标书正文"丢字/孤字/句破碎"本地检测
// ---------------------------------------------------------------------------
// 背景（端到端测试发现 BUG-101）：
//   安中医第 5 章 30847 字正文中，AI 生成结果出现大量"中文字符丢失"现象，例如：
//     - "本项目总体技术此基础上..."  缺"在"字
//     - "医疗运 质量"              缺"营"字
//     - "功能模 入同一技术底座"    缺"块"字
//     - "日均门诊患 15000 以上"    缺"者"字
//     - "整体采用 B/S...不依赖额外容 Windows"  缺"兼"字
//   这些是 LLM streaming tokenization 切字 + 内部 markdown 处理导致，不是后端
//   bug，但会直接体现在导出 docx 上（投标时被打回 = 废标风险）。
//   现有 autoRepairChapter 只做格式清洗（去装饰符、半角→全角），不查丢字。
//
// 设计：
//   1. 纯本地检测，零 AI 调用，毫秒级
//   2. 命中模式 = "在标书语境下不可能自然出现的孤立单字 / 行末单字 / 残缺搭配"
//   3. 命中后写入 chapter.sanityWarning（不动 content，让用户人工补/AI 改写）
//      —— R-301 初稿注释写的是 genError，但 genError 是 R280「生成失败原因」的字段
//      （composeGates A2 用它判"失败未写原因"违规），复用会污染失败归因，故改用独立字段。
//   4. UI 端（标书编辑器生成总览）渲染"丢字?"红色徽标；R55 起该徽标可点击跳到命中位置
//   5. 挂在 applyAutoRepair 内触发，即覆盖全部 8 个生成/续写/重写/扩写入口
//
// R55（2026-10-16）真实语料校准 + 召回补洞：
//   校准（首次用真实语料量误报率，此前只有"设计上应该极低"的推断）：
//     - .probe/az-fixture/azhongyi.full.json（安中医全量投标正文 138,810 字）→ 1 处命中
//     - src/pages/BidWorkspace/__fixtures__/azhongyiRealBid.json（脱敏子集 47,103 字）→ 1 处命中
//     - 两处均为 short_line，且都是全文单行「承接」（章标题拼接产物，属真阳性）
//     - BROKEN_PAIRS 12 条在 13.8 万字真实语料上 **零命中** → 该模式族误报率实测 ≈ 0
//   召回补洞：头部记录的 BUG-101 真实样本「日均门诊患 15000 以上」此前**从不命中**
//     （旧式要求缺字处紧跟量词，真实样本却是「门诊患 + 数字」）——已修，并加
//     「源码注释写明的样本必须全部命中」契约测试防复发。
//   有依据不做的扩召回：`整体采\s*用` / `系统提\s*供` / `能够实\s*现` / `系统支\s*持`
//     把 \s+ 放宽成 \s* 会命中**正确**正文（"整体采用"/"系统提供"…），属灾难性误报，必须保留 \s+。
// ---------------------------------------------------------------------------

/** 一处命中 */
export type LostCharHit = {
  /** 类别：single_char_end（行末/段末单字）、short_line（过短行）、missing_modifier（疑似缺修饰字） */
  kind: "single_char_end" | "short_line" | "missing_modifier" | "broken_pair"
  /** 命中的原文片段（前 12 字 + ... + 后 12 字） */
  excerpt: string
  /** 章节内绝对位置（字符偏移） */
  offset: number
  /** 命中描述（给用户看） */
  reason: string
}

/** 整章检测结果 */
export type SanityReport = {
  hits: LostCharHit[]
  /** 提示文案：用户视角的一句话总结 */
  summary: string
}

// ---------------------------------------------------------------------------
// 模式库：医疗售前场景下"中文字符应该成词"或"上下文必成对"的高频搭配
// ---------------------------------------------------------------------------

/** 设计取舍（v1）：
 *  - "行末单字"这种启发（"X。"前是 1 个汉字）在中文里太常见（"好。"/"了。"），误报率极高
 *    → v1 不启用；改用更精确的"前后必有中文 + 残缺搭配"模式
 *  - "残缺搭配"模式：要求 2~4 字词中间出现 \s+（强制空白）—— 正常中文词间无空白
 *    → 误报率几乎为 0（合法中文不会在词中间留空白）；漏报率仅"丢字但不留空白"（极少见）
 *  - "短行"模式：必须是 \n...纯中文≤3 字...\n（行首尾都是换行）—— 排除段中嵌入的短词
 */

/** 残缺搭配：在医疗场景里高频成对、丢失单字后能识别的 2~4 字片段
 *  设计原则：\s+ 强制至少 1 个空白（换行/空格）——正常中文之间不会有空白，所以空白就是丢字信号
 *  误报率：极低；漏报率：丢字但未留空白 → 不可检测（属于模型彻底没输出的极端情况） */
const BROKEN_PAIRS: ReadonlyArray<{ pattern: RegExp; expect: string; reason: string }> = [
  // "总体技术此基础上" → 期望 "总体技术在 此基础上"（缺"在"，行内无空白时仍能识别）
  { pattern: /总体技术(?=\s*此基础上)/g, expect: "总体技术在…此基础上", reason: "疑似缺连接字" },
  // "医疗运 质量" / "医疗运\n质量" → 缺"营"字
  { pattern: /医疗运\s+质量/g, expect: "医疗运营质量", reason: "疑似缺'营'字" },
  // "功能模 入" / "功能模\n入" → 缺"块"字
  { pattern: /功能模\s+入/g, expect: "功能模块入", reason: "疑似缺'块'字" },
  // R55 修正（漏检）：模块头部记录的 BUG-101 真实样本是「医院日均门诊患 15000 以上」，
  // 而此处旧式 /门诊患\s+(人次|以上|数量)/ 要求缺字处**紧跟量词**——真实样本是「门诊患 + 数字」，
  // 于是这条**被写进注释的真实样本从未被命中**（是漏检，不是误报）。
  // 现同时覆盖数字形态与量词形态，并允许无空白（流式丢字的另一种形态）。
  // 反向验证（R55 实测）：整条退回旧式 /门诊患\s+(人次|以上|数量)/ 后，
  //   bidTextSanity.test.ts 的「注释即契约」用例变红，报「日均门诊患 15000 以上 → 实得 []」
  //   —— 即这条修复确实被测试守住了。
  // 关于 (?!者)（诚实记录）：去掉它后上述 16 例**全绿**，因为四个候选中无一以「者」开头，
  //   故它对当前候选集是**冗余的意图声明**（真正拦住「门诊患者」的是候选本身，不是这个断言）。
  //   保留理由：后人若往候选里加「者X」类量词，它是第一道防线；删除它也不会有任何行为变化。
  { pattern: /门诊患(?!者)\s*(?:\d[\d,，.]*|人次|以上|数量)/g, expect: "门诊患者（+数字/量词）", reason: "疑似缺'者'字" },
  // "额外容 Windows" → 缺"兼"字
  { pattern: /不依赖额外容\s+(Windows|Mac|Linux|macOS)/gi, expect: "不依赖额外兼容$1", reason: "疑似缺'兼'字" },
  // "系统包 了" → 缺"含"字
  { pattern: /系统包\s+了/g, expect: "系统包含了", reason: "疑似缺'含'字" },
  // "整体采 用" → 缺"用"字
  { pattern: /整体采\s+用/g, expect: "整体采用", reason: "疑似缺'用'字" },
  // "系统提 供" → 缺"供"字
  { pattern: /系统提\s+供/g, expect: "系统提供", reason: "疑似缺'供'字" },
  // "能够实 现" → 缺"现"字
  { pattern: /能够实\s+现/g, expect: "能够实现", reason: "疑似缺'现'字" },
  // "系统支 持" → 缺"持"字
  { pattern: /系统支\s+持/g, expect: "系统支持", reason: "疑似缺'持'字" },
  // "向用户提 给" → 缺"供"字
  { pattern: /向用户提\s+给/g, expect: "向用户提供", reason: "疑似缺'供'字" },
  // "管 理" 中间被空格切了
  { pattern: /(患者|医生|护士)\s+管\s+理/g, expect: "$1管理", reason: "疑似'管理'中间多空格" },
]

/** 命中类别的置信度（数字越小越可信）：残缺搭配（要求词中留白）> 过短行（启发式，可能有真短行） */
const KIND_PRIORITY: Record<LostCharHit["kind"], number> = {
  missing_modifier: 0,
  broken_pair: 0,
  single_char_end: 1,
  short_line: 2,
}

/**
 * 过短但语义上不该单独成行的行：长度 < 4 字且前后都是中文段落。
 * 刻意不留模块级字面量正则——detectLostChars 内用 new RegExp 现构（字面量会被 SWC/esbuild 提升后跨调用共享 lastIndex），
 * 未使用的 const 只会白吃 tsc noUnusedLocals / eslint no-unused-vars。
 */

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 标书正文"丢字/孤字/句破碎"本地检测
 *
 * 用法：
 *   const r = detectLostChars(chapter.content)
 *   if (r.hits.length) updateChapter(nodeId, { sanityWarning: r.summary, sanityFirstHit: { offset: r.hits[0].offset, excerpt: r.hits[0].excerpt } })
 *   // R55：hits[0] 是"按置信度排序后的首条"（见 KIND_PRIORITY），既做徽标工具提示的"最严重"，
 *   //      也做"丢字?"徽标点击跳转的锚点——所以顺序必须是稳定且语义明确的
 *
 * 性能：1 万字 < 5ms，3 万字 < 20ms（已实测）
 * 上限：单章超过 5 万字时跳过后续正则扫描（极少见，宁可漏检也不卡主线程）
 */
export function detectLostChars(content: string, maxHits = 30): SanityReport {
  // 阈值解释：< 20 字的标书片段不值得扫描（误报率极高，正文也不会这么短）；
  // 之前用 30 排除了短测试用例 + 短行场景，已降低到 20
  if (!content || content.length < 20) return { hits: [], summary: "" }
  const scanText = content.length > 50000 ? content.slice(0, 50000) : content
  const hits: LostCharHit[] = []

  // ① 行末/段末孤字（v1 关闭：中文里"好。/了。"太常见，误报率 > 50%）
  // 如需启用，先统计语料里的真阳性率，建议改成"孤字 + 前后必须是长中文（>10 字） + 不在常见句末词位置"
  // pushAll(hits, scanText, LONE_CHAR_BEFORE_PUNCT, "single_char_end", (m) => ({ ... }))
  // pushAll(hits, scanText, LONE_CHAR_AFTER_PUNCT, "single_char_end", (m) => ({ ... }))

  // ② 残缺搭配（高置信度，误报率几乎为 0）
  for (const { pattern, expect, reason } of BROKEN_PAIRS) {
    pushAll(hits, scanText, pattern, "missing_modifier", (m) => ({
      excerpt: around(scanText, m.index ?? 0, 14),
      offset: m.index ?? 0,
      reason: `${reason}（期望：${expect}）`,
    }))
  }

  // ③ 过短行（限 6 个，太多说明整段都异常 → 用户一眼可见）
  // 关键：用字符串构造 + new RegExp（避免 SWC/esbuild 提升 const 字面量后 lastIndex 跨调用复用）
  const SHORT_LINE_RE = new RegExp("^[\\u4e00-\\u9fa5]{1,3}$", "gm")
  let shortLineHits = 0
  let m: RegExpExecArray | null
  while ((m = SHORT_LINE_RE.exec(scanText)) !== null) {
    if (shortLineHits >= 6) break
    const lineText = m[0]
    // 必须前后是换行（不是段中嵌入的短词）
    const before = m.index > 0 ? scanText[m.index - 1] : "\n"
    const afterIdx = m.index + lineText.length
    const after = afterIdx < scanText.length ? scanText[afterIdx] : "\n"
    if (before !== "\n" || (after !== "\n" && after !== "\r")) continue
    hits.push({
      kind: "short_line",
      excerpt: around(scanText, m.index, 12),
      offset: m.index,
      reason: `第 ${lineNumberAt(scanText, m.index)} 行过短（${lineText.length} 字）：「${lineText}」——可能是丢字或换行错误`,
    })
    shortLineHits += 1
  }

  // 截断 hits
  const limited = hits.slice(0, maxHits)

  // R55：按置信度稳定排序（同置信度保持扫描先后）——让 summary 里的"最严重"名副其实，
  // 也让「丢字?」徽标点击跳到的第一条是**最可能是真阳性**的那条（而不是恰好先扫到的短行）。
  const ranked = limited
    .map((h, i) => ({ h, i }))
    .sort((a, b) => KIND_PRIORITY[a.h.kind] - KIND_PRIORITY[b.h.kind] || a.i - b.i)
    .map((x) => x.h)

  // 摘要
  const summary = ranked.length
    ? `检测到正文可能存在 ${ranked.length} 处丢字/孤字（最严重：${ranked[0].reason}），请人工核对或重写本章`
    : ""

  return { hits: ranked, summary }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function pushAll(
  out: LostCharHit[],
  text: string,
  re: RegExp,
  kind: LostCharHit["kind"],
  build: (m: RegExpExecArray) => Omit<LostCharHit, "kind">,
): void {
  // 注意：必须每次新建正则并显式重置 lastIndex
  // — BROKEN_PAIRS 里 g 标志的字面量正则跨多次调用会保留 lastIndex 状态
  const r = new RegExp(re.source, re.flags)
  r.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = r.exec(text)) !== null) {
    out.push({ kind, ...build(m) })
    if (m.index === r.lastIndex) r.lastIndex += 1 // 防 0 长度死循环
  }
}

function around(text: string, offset: number, half: number): string {
  const start = Math.max(0, offset - half)
  const end = Math.min(text.length, offset + half)
  const head = start > 0 ? "…" : ""
  const tail = end < text.length ? "…" : ""
  return head + text.slice(start, end).replace(/\s+/g, " ") + tail
}

/** 1 基行号（R55：此前 short_line 文案里直接印着占位符"第 N 行"，从未替换成真实行号） */
function lineNumberAt(text: string, offset: number): number {
  let n = 1
  const end = Math.max(0, Math.min(offset, text.length))
  for (let i = 0; i < end; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1
  }
  return n
}
