// R-302（2026-10-16）：标书正文"版式与文风"后处理校验（端到端反馈 #5）
// ---------------------------------------------------------------------------
// 售前/演示反馈触发的版式硬条款校验器，与 bidTypes.PROSE_LINT_RULES 共享口径。
// 5 类问题：
//   ① AI 套话黑名单（30+ 词）
//   ② 内联指引（"（详见 XXX）"/"（参考 X.X）"/"（参见 P17）"）
//   ③ 标题层级（编号连续性 + 1/2/3 级不混）
//   ④ 关键章缺表（启发式识别"技术参数/评分/应急/SLA"等关键词的章节，扫是否有 | 表格分隔符）
//   ⑤ 长段落 / 长句（REQ-021：用户"AI 味太重"的真正主因不是禁词，是"一坨 280 字连续文字"）
// 性能：万字 < 10ms；命中上限 50 条防止 UI 刷屏
// 边界：biz 商务骨架章、空内容、< 30 字一律返回空
// ---------------------------------------------------------------------------

export type LintKind =
  | "ai_cliche"
  | "inline_link"
  | "task_dispatch"
  | "title_break"
  | "missing_table"
  | "long_paragraph"
  | "long_sentence"

export type LintHit = {
  /** 类别 */
  kind: LintKind
  /** 命中的关键词（AI 套话词） / 链接原文 / 标题行 / 缺失说明 */
  excerpt: string
  /** 章节内绝对位置（字符偏移） */
  offset: number
  /** 命中描述（给用户看） */
  reason: string
}

export type LintReport = {
  hits: LintHit[]
  /** 用户视角的一句话总结（命中才返回非空串） */
  summary: string
  /** 未截断的原始计数（REQ-021 新增）
   *
   *  hits 受「按类限额 15 + 总量上限 50」双重截断，是**给 UI 看的**；
   *  stats 是**不截断的真实量**，供质量度量与回归判据使用。
   *  两者都从同一次扫描得出（不是两套逻辑），故 stats.rawCounts 恒等于
   *  "若不限额会 push 多少条"。
   *
   *  ⚠️ 它不是死字段：summary 文案**就是**用它拼出来的（分别报结构性/文风、
   *     并如实写"仅列出前 N 条"），summary 由 useBidWorkspace 写入
   *     Chapter.proseLintWarning 后被徽标渲染。删掉 rawCounts 会让 summary
   *     退化成"只报截断后的 50 条"，用户会以为全章只有 50 处问题。 */
  stats: LintStats
  /** 本章命中的最高严重度（无命中为 null）
   *
   *  分两档的**理由**：只有 `title_break`（同级标题跳号）是会被评审真扣分的**格式硬伤**；
   *  而 `missing_table`（关键章建议出表）、套话、内联指引、长段落、长句都属于
   *  **建议性 / 观感问题**。两者若共用同一红色徽标，用户会把"写作啰嗦"或
   *  "没加表"当成"要废标"，红字可信度随即崩塌。
   *  UI 按本字段决定徽标配色（结构性=红 / 建议性与观感=琥珀）。 */
  severity: LintSeverity | null
}

/** 渲染进 LintHit.kind 的严重度分档 */
export type LintSeverity = "structural" | "style"

export type LintStats = {
  /** 每类未截断的命中条数 */
  rawCounts: Record<LintKind, number>
  /** 参与判定的自然段数（已排除表格块） */
  paragraphCount: number
}

/** 结构性缺陷 = 会被评审真扣分的**格式硬伤**，UI 用红色
 *
 *  ⚠️ 只放 `title_break`。`missing_table` 曾在此集合内，2026-10-17 按史矛革裁决移出：
 *     缺表是**公司规范偏好（建议性）**，不是符合性硬伤。实证——真实交付并中标的
 *     《售后服务方案》实测 287 段 / **0 张表格**（纯文字承诺书，没有表是正常的），
 *     旧归属会把这份已中标文件标成红色「会扣分」，让用户白改一遍。
 *     把建议性缺陷标红，反而让红标失去区分力，违背"让用户分清哪些真会扣分"的初衷。
 *  ⚠️ 移出的只有**本集合的归属**；TABLE_REQUIRED_KEYWORDS 的匹配规则一字未动
 *     （R-302 的 4 类行为已验收，那条判据继续照常命中，只是不再染红）。
 *  其余（套话、内联指引、长段落、长句）属观感，UI 用琥珀色 */
const STRUCTURAL_KINDS: ReadonlySet<LintKind> = new Set<LintKind>(["title_break"])

// ---------------------------------------------------------------------------
// 模式库（与 PROSE_LINT_RULES 同步：prompt 是事前预防，linter 是事后兜底）
// ---------------------------------------------------------------------------

/** AI 套话黑名单（与 PROSE_LINT_RULES 第一条一致；保持双向同步）
 *
 * ⚠️ 收录原则（2026-10-16 实机校准，务必遵守）：**只收"去掉后句子信息量不变"的纯宣传腔**。
 *    本清单曾在真实安中医第 5 章（30898 字）上跑出 50 处命中且**全部是「闭环」**——
 *    「闭环」是医疗信息化标准术语（电子病历评级明确要求「医嘱闭环管理」，正文里还有
 *    「急诊处方的开立与闭环跟踪」「数据价值闭环路径」），属于**误报**。
 *    误报的双重危害：① 满屏红字让用户不再信任该标记；② 用户点「重写」会诱导 LLM
 *    把正确的医学术语改掉，**反而降低标书质量**。故此类词一律不收。
 *
 * 明确**不收录**（有专业实义，收了就是误报）：
 *   闭环（医嘱/处方闭环是评级要求）、数据中台/业务中台（医疗架构真实组件）、
 *   全生命周期（数据治理常用）、端到端（流程描述常用）、沉淀（知识沉淀）、
 *   兜底（容灾语境有实义）、打通/拉通/跑通/对齐（集成协同语境有实义）、
 *   精细化/标准化（医院管理常用语）
 */
const AI_CLICHE_PATTERNS: ReadonlyArray<{ re: RegExp; example: string; reason: string }> = [
  // —— 动词类：纯宣传腔，去掉后换成具体措施反而更专业 ——
  { re: /赋能/g, example: "赋能", reason: "AI 套话词「赋能」" },
  // 2026-10-20 修复：原为 /打造(?!.*方案)/g —— `.*` 不带 s 标志、不跨行，所以这条预查的含义是
  // 「本行「打造」之后只要出现过『方案』二字就整行放过」。而标书正文几乎行行含「方案」，
  // 于是「打造一体化解决方案」这类最典型的 AI 腔反而不报，该词实际形同失效。
  // 改为与隔壁「生态(?!系统|圈|链)」同款的窄预查：只放行「打造」紧接着「方案」的情形。
  { re: /打造(?!方案)/g, example: "打造", reason: "AI 套话词「打造」（否定预查仅放行紧接的「打造方案」）" },
  { re: /抓手/g, example: "抓手", reason: "AI 套话词「抓手」" },
  { re: /颠覆/g, example: "颠覆", reason: "AI 套话词「颠覆」" },
  { re: /重塑/g, example: "重塑", reason: "AI 套话词「重塑」" },
  { re: /反哺/g, example: "反哺", reason: "AI 套话词「反哺」" },
  // —— 程度/范围副词：语义空转，无信息量 ——
  { re: /全方位/g, example: "全方位", reason: "AI 套话词「全方位」" },
  { re: /全链路/g, example: "全链路", reason: "AI 套话词「全链路」" },
  { re: /全栈/g, example: "全栈", reason: "AI 套话词「全栈」" },
  { re: /全维度/g, example: "全维度", reason: "AI 套话词「全维度」" },
  { re: /多层次/g, example: "多层次", reason: "AI 套话词「多层次」" },
  { re: /多维度/g, example: "多维度", reason: "AI 套话词「多维度」" },
  // —— 抽象名词化：把具体工作包装成"××化" ——
  { re: /体系化/g, example: "体系化", reason: "AI 套话词「体系化」" },
  { re: /常态化/g, example: "常态化", reason: "AI 套话词「常态化」" },
  // —— 服务包装话术 ——
  { re: /一站式/g, example: "一站式", reason: "AI 套话词「一站式」" },
  { re: /保姆式/g, example: "保姆式", reason: "AI 套话词「保姆式」" },
  { re: /交钥匙/g, example: "交钥匙", reason: "AI 套话词「交钥匙」" },
  { re: /陪伴式/g, example: "陪伴式", reason: "AI 套话词「陪伴式」" },
  { re: /生态(?!系统|圈|链)/g, example: "生态", reason: "AI 套话词「生态」（否定预查放行「生态系统/生态圈/生态链」）" },
  // —— 公文副词连环套 ——
  { re: /深入推进/g, example: "深入推进", reason: "AI 套话词「深入推进」" },
  { re: /扎实开展/g, example: "扎实开展", reason: "AI 套话词「扎实开展」" },
  { re: /稳步推进/g, example: "稳步推进", reason: "AI 套话词「稳步推进」" },
  { re: /有序推进/g, example: "有序推进", reason: "AI 套话词「有序推进」" },
  { re: /(高质量|高标准|严要求)推进/g, example: "高质量推进", reason: "AI 套话词「高质量/高标准/严要求推进」" },
]

/** 每个类别在单章内最多上报的条数——防止一个高频词（如历史上「闭环」刷满 50 条）
 *  把另外 3 类（内联指引 / 标题断裂 / 缺表）的信号完全挤出视野 */
const PER_KIND_CAP = 15


// ---------------------------------------------------------------------------
// ⑤ 长段落 / 长句阈值（REQ-021，2026-10-17 实机校准）
// ---------------------------------------------------------------------------
// 由来：用户反馈「生成的标书质量完全不行，AI 味道太严重」。查证结论是**禁词表不是
// 病根**——他 10-16 生成的 45.1 万字标书（bid_projects id=d3c35o7axkw34wo）在 30+ 条
// AI 套话黑名单上全篇只命中 29 处。真正的差异在**段落长度**：
//
//   标尺 = B 标书库里**真实交付过**的《售后服务方案》
//          （2026年标书\安徽\安徽理工大学\电信\新建文件夹\售后服务方案.docx，28,177 字 / 286 段）
//
//   | 指标            | AI 生成稿 | 真实交付标书 | 倍数 |
//   |-----------------|-----------|--------------|------|
//   | 段落中位长度    |   272 字   |    81.5 字   | 3.3× |
//   | 段落 85 分位    |   378 字   |    193 字    | 2.0× |
//   | 最长段落        |   972 字   |    318 字    | 3.1× |
//   | 超 300 字段落   | 608 / 1638 = 37% | 2 / 286 = 0.7% | 53× |
//   | 句子中位长度    |    57 字   |     45 字    | 1.27× |
//   | 句子 85 分位    |    99 字   |     79 字    | 1.25× |
//
// 结论：**核心差异是段落长度**（句子只差 1.25 倍，数字密度 7.0 vs 6.2/千字几乎一样）。
// 真实中标标书是「一句一个事实、40-190 字一段」，AI 稿是「一坨 280 字的连续文字」。

/** 长段落阈值（字）
 *
 *  依据：真实交付《售后服务方案》段落 85 分位 = **193 字**、90 分位 219 字、最长 318 字，
 *  超 300 字的只占 **0.7%（2/286）**；而 AI 生成稿超 300 字占 **37%（608/1638）**。
 *  取 300 而不是 200：300 是真实标书 99 分位以上（286 段里只有 2 段），
 *  **误报率被真实中标件钉在 0.7%**，不会把正常长段（如参数说明）打成问题；
 *  同时仍能抓住 AI 稿 37% 的病灶。取 250 会让真实标书误报升到 11/286 = 3.8%，
 *  误报换不来额外信息（AI 稿那批本来就在 300 以上）。
 *  ⚠️ 别为了"更严"往下压：误报会让用户不再信任徽标，且点「重写」会诱导 LLM
 *     把本已合格的长段拆碎，反而伤内容完整性（同 AI_CLICHE_PATTERNS 的误报教训）。 */
export const LONG_PARAGRAPH_MAX_CHARS = 300

/** 长句阈值（字）
 *
 *  依据：真实交付《售后服务方案》句子（按 。！？…；！? 切分）85 分位 = **79 字**、
 *  90 分位 85 字、最长 140 字；AI 生成稿 85 分位 99 字。取 80 即"真实中标标的 85 分位"，
 *  含义是：**超过这个长度，就落在真实交付标书里最长的那 15% 句子之外**。
 *  ⚠️ 句子判据独立于段落判据：一个 280 字的段落如果由 8 个 35 字短句构成，
 *     段落命中但句子不该命中——这两种病要分别给用户看到。 */
export const LONG_SENTENCE_MAX_CHARS = 80


/** 内联指引黑名单（要求**成对的括号**包裹，避免裸词误伤）
 *  ⚠️ 2026-10-16 实机教训：原写成 /（如前所述|下文详述|…|上同|同前）/，
 *     由于 `|` 未分组，等价于「（如前所述」OR「下文详述」OR … OR「同前）」，
 *     导致安中医第 5 章「中台与院区特色分治的边界在物理部署**上同**步体现」被误判
 *     （裸词「上同」命中）。凡多分支一律用 (?:…) 分组，且必须带括号。 */
const INLINE_LINK_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /（详见[第]?[一二三四五六七八九十]?[0-9一二三四五六七八九十、,\s\S]{0,30}?[章节][0-9一二三四五六七八九十.,、\s\S]{0,15}?）/g, reason: "内联指引「（详见 X 章 Y 节）」" },
  { re: /（参见[第]?[0-9一二三四五六七八九十、,\s\S]{0,20}?）/g, reason: "内联指引「（参见 X）」" },
  { re: /（参考[第]?[0-9一二三四五六七八九十、,\s\S]{0,20}?）/g, reason: "内联指引「（参考 X）」" },
  { re: /（(?:如前所述|上文所述|下文详述|下文将述|见前述|此处不再赘述)）/g, reason: "内联指引「（如前所述/下文详述）」" },
  { re: /（详见 P[0-9]+）/g, reason: "内联指引「（详见 PX）」" },
]

/** 任务分派 / 章节自指（REQ-024，2026-10-17 真跑发现）
 *
 *  ⚠️ 为什么必须与 INLINE_LINK_PATTERNS 分开、不能合进去：
 *     上面那 5 条**全都要求成对全角括号**（历史教训：裸词会误伤正常表述）。
 *     但真稿里最普遍的形态恰恰**不带括号**——"本部分的实现由第 3 章数据价值闭环核心能力
 *     设计方案承接"。用括号规则一条都抓不到（实测旧稿 354 处「第X章」命中 0 条）。
 *
 *  实证（用户 45.1 万字真生成稿 bid_projects d3c35o7axkw34wo）：
 *    | 特征                    | AI 稿 | 真实中标标书 | 倍差 |
 *    |-------------------------|-------|--------------|------|
 *    | 「第X章」交叉引用        |  354  |      0       |  ∞   |
 *    | 「承接」                |  191  |      0       |  ∞   |
 *    | 「本小节」              |  154  |      0       |  ∞   |
 *    | 「落地」                |  150  |      0       |  ∞   |
 *    | 「响应结论」            |   27  |      0       |  ∞   |
 *  这不是"用词偏好"，是**文体错位**：投标文件是评标专家手上的一本实体文件，
 *  不存在"由第几章负责"的第二人称分工视角。真实标书只写本节做什么，不写谁承接谁。
 *
 *  ⚠️ 三条 pattern 必须**互不覆盖**（每条都能单独被变异杀死）。
 *     第一版把「由第 N 章…承接」与「第 N 章…承接」分成两条，结果前者被后者完全包含：
 *     删掉任一条，测试仍绿——冗余检测掩盖了单条失效（M1/M2 变异存活的真实原因）。
 *     故合并为一条（`由` 前缀可选），并补 24 编号罗马数字与「章/节」两种单位。
 *
 *  ⚠️ 只匹配**带具体章节编号或自指词**的形态，不收裸词：
 *     - 「落地」单独出现（"方案落地"）在行业内是正常词，不收；
 *     - 「本章」不收（"本章小结"是小节标题，会误报）；
 *     - 「承接/承担」不带编号时不收——"集成平台承接接口交互"是正常业务动词。
 *     误报代价不对称：徽标被误报几次，用户就不再信任它。 */
const DISPATCH_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  // ① 章节编号 + 分派动词：「由第 3 章……承接」「第 8 章……负责」（不带括号，旧规则漏掉的形态）
  {
    re: /第\s*[0-9一二三四五六七八九十]+\s*[章节][^。；\n]{0,40}?(?:承接|承担|负责)/g,
    reason: "任务分派句「第 X 章承接/负责」——投标文件给评标专家看，正文只写本节做什么，不写章节间分工",
  },
  // ② 不带括号的内联指引：「详见第 11 章……」
  {
    re: /详见《?第\s*[0-9一二三四五六七八九十]+\s*[章节]/g,
    reason: "内联指引「详见第 X 章」（不带括号形态）——跨章联系靠目录体现，正文不写指引",
  },
  // ③ 章节自指：「本小节界定的痛点，将由第 2 章……」「本节的响应结论为……」
  //    真实中标标书 0 次；AI 稿 154 次。正文以读者视角写内容本身，不指称"本小节"。
  //    ⚠️ 不收「本章」：「本章小结」是常见小节标题，会误报。
  {
    re: /(?:本小节|本节)/g,
    reason: "章节自指「本小节/本节」——正文直接写内容，不指称自己这一段",
  },
]

/** 关键章必出表识别（关键词 → 期望表头）
 *  设计：宽松匹配章节标题 + 严格匹配表格存在 */
const TABLE_REQUIRED_KEYWORDS: ReadonlyArray<{ keyword: RegExp; expectedTable: string }> = [
  { keyword: /技术参数|参数响应|实质性响应/i, expectedTable: "参数响应表（序号|招标参数|响应值|偏离|证明材料）" },
  { keyword: /评分|响应承诺|响应映射/i, expectedTable: "评分点承诺表（评分项|承诺内容|对应章节|页码）" },
  { keyword: /(售后服务|SLA|故障分级|响应时限|运维保障)/i, expectedTable: "SLA 响应表（故障级别|响应时间|到场时间|恢复时间|备品备件）" },
  { keyword: /应急预案|业务连续性|应急演练/i, expectedTable: "应急场景矩阵（场景|影响范围|响应流程|恢复时间|责任人）" },
]

/** 启发式表格存在检测（3 种方式命中其一即视为有表） */
const TABLE_PRESENT_PATTERNS: ReadonlyArray<RegExp> = [
  // Markdown 表格：连续 2+ 行含 3+ 个 |
  /(?:^|\n)[^\n]*\|[^\n]*\|[^\n]*\|[^\n]*\n[^\n]*\|[^\n]*\|[^\n]*\|/,
  // Word 表格列分隔（每行 2+ 个全角 ｜）
  /(?:^|\n)[^\n]*｜[^\n]*｜[^\n]*/,
  // HTML table 标签
  /<table[\s>]/i,
  // mermaid 块（也算结构化展示）
  /```mermaid/,
]

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 标书正文"版式与文风"本地检测
 *
 * @param content 章正文
 * @param chapterTitle 章标题（用于"关键章必出表"判断）
 * @param maxHits 单章最多返回命中数（UI 防刷屏）
 */
export function lintProse(content: string, chapterTitle = "", maxHits = 50): LintReport {
  const emptyStats = (): LintStats => ({
    rawCounts: {
      ai_cliche: 0,
      inline_link: 0,
      task_dispatch: 0,
      title_break: 0,
      missing_table: 0,
      long_paragraph: 0,
      long_sentence: 0,
    },
    paragraphCount: 0,
  })
  if (!content || content.length < 30)
    return { hits: [], summary: "", stats: emptyStats(), severity: null }
  const scanText = content.length > 80000 ? content.slice(0, 80000) : content
  const hits: LintHit[] = []

  // ① AI 套话黑名单
  for (const { re, reason } of AI_CLICHE_PATTERNS) {
    pushAll(hits, scanText, re, "ai_cliche", (m) => ({
      excerpt: around(scanText, m.index ?? 0, 12),
      offset: m.index ?? 0,
      reason,
    }))
  }

  // ② 内联指引
  for (const { re, reason } of INLINE_LINK_PATTERNS) {
    pushAll(hits, scanText, re, "inline_link", (m) => ({
      excerpt: around(scanText, m.index ?? 0, 16),
      offset: m.index ?? 0,
      reason,
    }))
  }

  // ②b 任务分派 / 章节自指（REQ-024：不带括号的「由第 X 章承接」形态）
  //
  // ⚠️ 必须排除**承接段开头**：章级生成的首段常以「第五章 总体架构设计承接上一章需求分析与
  //    现状调研结论……」起句——这是正常的承上启下写法，不是把内容派给别的章。
  //    真跑实测（v2-chap-1）第 3 行整行 117 字，以章名起句，就是这种形态，被误报 1 处。
  //    判据：① 命中起点在行首 24 字内；② 该行以「第 N 章/节 + 标题」开头（即「第N章」出现在行首）。
  //    真正的分派句是「……的实现由第3章……承接」，命中的不是行首那个章号，故不受影响。
  const lineStartAt = (pos: number): number => {
    const i = scanText.lastIndexOf("\n", Math.max(0, pos - 1))
    return i < 0 ? 0 : i + 1
  }
  const isHeadingLeadAt = (pos: number): boolean => {
    const s = lineStartAt(pos)
    const line = scanText.slice(s, scanText.indexOf("\n", s) < 0 ? scanText.length : scanText.indexOf("\n", s))
    // 该行是否以「第N章/第N节 标题」起头
    if (!/^\s*第\s*[0-9一二三四五六七八九十]+\s*[章节]/.test(line)) return false
    // 命中位置是否就落在行首这个「第N章」上（偏差 ≤ 24 字，容忍前置缩进/空白）
    return pos - s <= 24
  }
  for (const { re, reason } of DISPATCH_PATTERNS) {
    pushAll(hits, scanText, re, "task_dispatch", (m) => ({
      excerpt: around(scanText, m.index ?? 0, 16),
      offset: m.index ?? 0,
      reason,
    }))
    // 撤销落在承接段开头上的命中（pushAll 无位置过滤能力，故就地回撤）
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i]
      if (h.kind === "task_dispatch" && isHeadingLeadAt(h.offset)) hits.splice(i, 1)
    }
  }

  // ③ 标题层级断裂（同级跳号 + 1/2/3 级混排）
  detectTitleBreak(hits, scanText)

  // ④ 关键章缺表（仅当 chapterTitle 命中关键词时检查）
  if (chapterTitle) {
    for (const { keyword, expectedTable } of TABLE_REQUIRED_KEYWORDS) {
      if (keyword.test(chapterTitle)) {
        const hasTable = TABLE_PRESENT_PATTERNS.some((re) => re.test(scanText))
        if (!hasTable) {
          hits.push({
            kind: "missing_table",
            excerpt: chapterTitle,
            offset: 0,
            reason: `关键章「${chapterTitle}」应出表：${expectedTable}`,
          })
        }
        break // 命中第一个匹配的关键词就停（避免一章报多次"缺表"）
      }
    }
  }

  // ⑤ 长段落 / 长句（REQ-021：AI 味的真正主因）
  const paragraphCount = detectLongProse(hits, scanText)

  // 未截断的原始计数（stats 用）：必须在截断之前统计
  const rawCounts = emptyStats().rawCounts
  for (const h of hits) rawCounts[h.kind] += 1

  // 截断：先按类别限额（防单一高频词淹没其它类别信号），再按总量上限
  //
  // ⚠️ 为什么长段落不在 hits 里给到真实条数（REQ-021 决定，想改先问）：
  //    hits 是给 UI 渲染的，受 PER_KIND_CAP=15 与 maxHits=50 双重截断，
  //    用户真实稿一章最多 62 个长段落，全刷出来会把另外 4 类信号彻底挤没。
  //    真实量在 stats.rawCounts 里（**不截断**），质量度量与回归判据一律用 stats，
  //    不要用 hits.length 去度量——那只是"UI 上能看到多少条"。
  const perKindCount = new Map<LintKind, number>()
  const capped: LintHit[] = []
  for (const h of hits) {
    const n = perKindCount.get(h.kind) ?? 0
    if (n >= PER_KIND_CAP) continue
    perKindCount.set(h.kind, n + 1)
    capped.push(h)
  }
  const limited = capped.slice(0, maxHits)
  const summary = buildSummary(limited, rawCounts)
  const severity = buildSeverity(limited)

  return { hits: limited, summary, stats: { rawCounts, paragraphCount }, severity }
}

/**
 * summary 文案：**按严重度分开计数**，并且如实写出"只列出前 N 条"
 *
 * 为什么必须用 rawCounts 而不是 limited.length：
 *   用户真实稿一章最多 62 个长段落，hits 被双重截断到 50 条以内。
 *   若 summary 报 "50 处"，用户会以为全章只有 50 处问题 —— 这是**谎报**。
 *   故这里报的是未截断真实量，并明说"仅列出前 N 条"。
 *
 * 为什么结构性/建议性/观感必须分开：
 *   标题跳号会被评审真扣分（格式硬伤）；缺表是公司规范偏好（建议性）；
 *   套话、长段、长句只是观感。混在一句里报"N 处版式问题"会让用户分不清哪个必须改。
 *   （2026-10-17 史矛革裁决：missing_table 从结构性移出，单列"建议补充"一档，
 *     实证是真实中标的售后方案 0 张表被判红——建议性缺陷不该染红。）
 */
function buildSummary(limited: LintHit[], raw: Record<LintKind, number>): string {
  if (!limited.length) return ""
  const totalHits = Object.values(raw).reduce((a, b) => a + b, 0)
  if (totalHits === 0) return ""

  const structural = raw.title_break ?? 0
  const suggestion = raw.missing_table ?? 0
  const style = totalHits - structural - suggestion

  const parts: string[] = []
  if (structural > 0) parts.push(`结构性缺陷 ${structural} 处（标题层级跳号，会被评审扣分）`)
  if (suggestion > 0) parts.push(`建议补充 ${suggestion} 处（关键章建议出表）`)
  if (style > 0) {
    const detail: string[] = []
    if (raw.ai_cliche > 0) detail.push(`AI 套话 ${raw.ai_cliche}`)
    if (raw.inline_link > 0) detail.push(`内联指引 ${raw.inline_link}`)
    if (raw.task_dispatch > 0) detail.push(`章节分派 ${raw.task_dispatch}`)
    if (raw.long_paragraph > 0) detail.push(`长段落 ${raw.long_paragraph}`)
    if (raw.long_sentence > 0) detail.push(`长句 ${raw.long_sentence}`)
    parts.push(`文风问题 ${style} 处（${detail.join(" / ")}）`)
  }

  const tail =
    totalHits > limited.length ? `，仅列出前 ${limited.length} 条` : ""
  return `检测到${parts.join("；")}${tail}。最严重：${limited[0].reason}`
}

/** 本章最高严重度：有结构性缺陷即 structural，否则 style；无命中为 null */
function buildSeverity(hits: LintHit[]): LintSeverity | null {
  if (!hits.length) return null
  return hits.some((h) => STRUCTURAL_KINDS.has(h.kind)) ? "structural" : "style"
}

// ---------------------------------------------------------------------------
// 内部 helpers
// ---------------------------------------------------------------------------

function pushAll(
  out: LintHit[],
  text: string,
  re: RegExp,
  kind: LintKind,
  build: (m: RegExpExecArray) => Omit<LintHit, "kind">,
): void {
  // g 标志正则跨调用复用 lastIndex，必须 new + 显式重置
  const r = new RegExp(re.source, re.flags)
  r.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = r.exec(text)) !== null) {
    out.push({ kind, ...build(m) })
    if (m.index === r.lastIndex) r.lastIndex += 1
  }
}

function around(text: string, offset: number, half: number): string {
  const start = Math.max(0, offset - half)
  const end = Math.min(text.length, offset + half)
  const head = start > 0 ? "…" : ""
  const tail = end < text.length ? "…" : ""
  return head + text.slice(start, end).replace(/\s+/g, " ") + tail
}

/**
 * 标题层级断裂检测：
 *   ① 同级标题跳号（如 5.1 → 5.3，中间缺 5.2）
 *   ② 1/2/3 级混排（标题行既像 ## 又像 ###，编号格式混乱）
 *   限制：只在标书正文格式下识别（每行一个标题）
 */
function detectTitleBreak(out: LintHit[], text: string): void {
  // 标题行匹配：「N.M 名称」或「N.M.K 名称」或「N 章名」
  // 容许前缀空白
  const HEADING_RE = /^[ \t]*(\d+(?:\.\d+){0,2})\s+([^\n]{1,40})$/gm
  const headings: Array<{ level: number; num: string; title: string; offset: number }> = []
  let m: RegExpExecArray | null
  while ((m = HEADING_RE.exec(text)) !== null) {
    const num = m[1]
    const level = num.split(".").length
    headings.push({ level, num, title: m[2].trim(), offset: m.index ?? 0 })
  }
  if (headings.length < 2) return
  // 同级跳号：检测相邻同 N 段是否连续
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]
    const cur = headings[i]
    if (cur.level !== prev.level) continue
    // 比较前缀 N 是否相同
    const prefix = prev.num.split(".").slice(0, prev.level - 1).join(".")
    const curPrefix = cur.num.split(".").slice(0, cur.level - 1).join(".")
    if (prefix !== curPrefix) continue
    // 父级一致，检查连续：prev 是 X.Y，cur 应该是 X.(Y+1)
    const prevLast = Number(prev.num.split(".").pop())
    const curLast = Number(cur.num.split(".").pop())
    if (Number.isNaN(prevLast) || Number.isNaN(curLast)) continue
    if (curLast - prevLast > 1) {
      out.push({
        kind: "title_break",
        excerpt: `${prev.num} ${prev.title} → ${cur.num} ${cur.title}`,
        offset: cur.offset,
        reason: `同级标题跳号：${prev.num} 后直接 ${cur.num}（中间缺 ${prefix}.${prevLast + 1}）`,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// ⑤ 长段落 / 长句检测（REQ-021）
// ---------------------------------------------------------------------------

/** 行是不是"表格行"（Word 纯文本表格行 / Markdown 表格行 / HTML 表格行） */
export function isTableRow(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // Markdown 表格：以 | 起止且至少 2 个 |（表头/分隔/数据行都算）
  if (/^\|.*\|$/.test(t) && (t.match(/\|/g) ?? []).length >= 2) return true
  // HTML 表格标签
  if (/^<\/?(?:table|tr|td|th)\b/i.test(t)) return true
  // Word 纯文本表格行：列间用全角空格 U+3000 分隔（与 bidFiles.splitTableRow 同一生成约定）。
  // ⚠️ 判据必须收紧，别退化成 "含 U+3000 且折出 2 列"（实测踩过）：
  //    正文里偶尔出现**一个**全角空格（如「恰好有一个 U+3000 空格」）就会被折成 2 列，
  //    该行随即被当表格吞掉，真长段落就此漏报。
  //    收紧为：折出 ≥3 列（多列表格的确定形态）或 存在**连续 2 个以上** U+3000
  //    （生成约定"两个全角空格分列"的确定形态）。真实语料实测：2 列表格行几乎不存在
  //    （96 份 + 站内 4 个真项目里仅 1 行），故该收紧不损表格识别。
  if (t.includes("\u3000")) {
    const cols = t.split(/\u3000+/).filter((c) => c.trim() !== "")
    if (cols.length >= 3 || /\u3000{2,}/.test(t)) return true
  }
  return false
}

/**
 * 按"自然段"切分行文本，返回每个段落（含原文 offset）
 *
 * **口径（与 REQ-021 验收锚点绑定，别改）：每行一个自然段。**
 * 依据：用该口径跑用户真实生成稿（bid_projects d3c35o7axkw34wo，45.1 万字 / 18 章）
 * 得到超 300 字段落 **608** 个，与 Chief 独立实测值**完全一致**；
 * 换成"空行分隔的块"口径会得到 603（章内长段被跨行合并后偏少），
 * 换成"合并连续非空行"口径更少。故 608 这组数字只对"每行一段"成立。
 *
 * 表格行跳过：由 isTableRow 逐行判定，表格行**不进段落池**——否则参数响应表
 * 每行 200+ 字会被逐行误报成长段落（一张表刷出几十条）。
 * 单行孤立表格（正文里偶尔出现的一行 pipe）按同一规则处理，也跳过：
 * 宁可漏报一行，也不误报整表。
 * 2026-10-20：本函数改为 export —— qualityAuditRealDb.test.ts 的质量体检要按**同一口径**
 * 复算「段落中位长度 / 85 分位 / 超 300 字占比」并与上面的基准表对比。若在测试里另写一份
 * 切分逻辑，两处口径必然漂移，量出来的数字就不能和 272 vs 81.5 那张表相提并论了。
 */
export function splitParagraphs(text: string): Array<{ text: string; offset: number }> {
  const lines = text.split("\n")
  const kinds: Array<"text" | "row" | "blank" | "fence"> = []
  let inFence = false
  let cursor = 0
  const offsets: number[] = []
  for (const raw of lines) {
    offsets.push(cursor)
    cursor += raw.length + 1 // +1 为 \n
    const t = raw.trim()
    if (/^```/.test(t)) {
      inFence = !inFence
      kinds.push("fence")
    } else if (inFence) {
      kinds.push("fence")
    } else if (!t) {
      kinds.push("blank")
    } else if (isTableRow(t)) {
      kinds.push("row")
    } else {
      kinds.push("text")
    }
  }

  const out: Array<{ text: string; offset: number }> = []
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== "text") continue
    out.push({ text: lines[i].trim(), offset: offsets[i] })
  }
  return out
}

/** 句子切分（按中文句末标点 + 分号切；保留标点）
 *  2026-10-20：同 splitParagraphs 改为 export，供质量体检按同一口径量句子长度分布。 */
export function splitSentences(para: string): string[] {
  return para
    .split(/(?<=[。！？…；!?;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

/**
 * 长段落 / 长句检测
 *
 * 两类分开报：段落的病是"读起来累"，句子的病是"一口气读不完"。
 * 一个 280 字段落由 8 个 35 字短句构成时，只报 long_paragraph 不报 long_sentence。
 *
 * 返回参与判定的自然段数（已排除表格块），供 stats 用。
 * 每段最多报 1 条 long_sentence：一段十几个超长句全刷出来会淹没别类信号。
 */
function detectLongProse(out: LintHit[], text: string): number {
  const paras = splitParagraphs(text)
  for (const para of paras) {
    const longPara = para.text.length > LONG_PARAGRAPH_MAX_CHARS
    if (longPara) {
      out.push({
        kind: "long_paragraph",
        excerpt: around(text, para.offset, 14),
        offset: para.offset,
        reason:
          `段落过长（${para.text.length} 字，超 ${LONG_PARAGRAPH_MAX_CHARS} 字上限），` +
          `评审阅读疲劳，建议拆为 2-3 段`,
      })
    }
    // 长段落里也查长句（两病可并存），但每段最多报 1 条
    const over = splitSentences(para.text).find((s) => s.length > LONG_SENTENCE_MAX_CHARS)
    if (over) {
      out.push({
        kind: "long_sentence",
        excerpt: around(text, para.offset, 14),
        offset: para.offset,
        reason: `句子过长（${over.length} 字，超 ${LONG_SENTENCE_MAX_CHARS} 字上限），建议断句`,
      })
    }
  }
  return paras.length
}
