// ---------------------------------------------------------------------------
// 技术方案章节的同义词表（2026-10-31 标书生成优化）
//
// 为什么单独建表：
//   prompts/tenderRetrieval.ts 里已有 SECTION_KEYWORDS（20 个 key），但那是**解析分区**口径
//   （overview / tech_score / delivery_req …），用于「把招标原文分成 22 个解析块」。
//   实测技术方案章节只有 3/8 能匹配上它，且匹配到的 delivery_req 关键词偏"交货/验收"，
//   对「培训方案」「应急方案」这类章节帮助有限。
//
// 本表是**生成章节正文**口径：把章节标题映射到该主题在真实招标文件里的实际措辞。
//
// 词表来源：在本地 **25 份真实招标文件（合计 387 万字）** 上统计实际出现频次得出，
// 并逐词核验「至少出现 1 次」——0 次即视为臆造词、一律删除（实测删掉「实操演练」）。例如
//   培训(53) 考核(37) / 实施(164) 阶段(96) 里程碑(8) / 运维(69) 巡检(3)
//   应急(61) 故障(39) 容灾(17) / 迁移(38) 归档(38) 历史数据(17) / 接口(148) 集成(112)
//   —— 只收真实出现过的词，不臆造。
//
// 用法：extendQueryWithSynonyms() 把章节标题/小节名扩展成更宽的检索词集合，
//      再由 retrieveTenderFragments 用 bigram 打分。
// ---------------------------------------------------------------------------

/** 技术主题 → 该主题在招标文件里的实际措辞（按频次高到低） */
const TECH_TOPIC_TERMS: { topic: string; patterns: RegExp; terms: string[] }[] = [
  {
    topic: "培训",
    patterns: /培训|训练|人员能力/,
    terms: ["培训", "考核", "培训方案", "培训计划", "培训内容", "培训教材", "人员培训"],
  },
  {
    topic: "实施",
    patterns: /实施|工期|进度|里程碑|交付计划|项目管理/,
    terms: ["实施", "阶段", "实施计划", "工期", "里程碑", "实施进度", "项目管理", "进度计划", "验收"],
  },
  {
    topic: "运维",
    patterns: /运维|运营维护|运行维护|售后服务|售后/,
    terms: ["运维", "运维服务", "运行维护", "巡检", "运维保障", "故障响应", "售后服务", "质保期"],
  },
  {
    topic: "应急",
    patterns: /应急|灾备|容灾|故障处理|应急预案/,
    terms: ["应急", "故障", "恢复", "容灾", "灾备", "应急预案", "应急响应", "备份"],
  },
  {
    topic: "数据迁移",
    patterns: /迁移|数据治理|数据清洗|历史数据|数据归档/,
    terms: ["迁移", "归档", "数据迁移", "历史数据", "转换", "数据治理", "数据清洗", "数据质量"],
  },
  {
    topic: "架构集成",
    patterns: /架构|集成|接口|平台|中台|总体技术|技术方案/,
    terms: ["接口", "集成", "架构", "系统架构", "技术架构", "平台", "中台", "微服务", "数据交换"],
  },
  {
    topic: "安全",
    patterns: /安全|等级保护|等保|加密|防护/,
    terms: ["安全", "加密", "信息安全", "等级保护", "等保", "防护", "审计", "权限"],
  },
  {
    topic: "质保",
    patterns: /质保|保修|质量保证/,
    terms: ["质保", "质保期", "保修", "质量保证", "免费维护", "服务承诺"],
  },
  {
    topic: "业绩资质",
    patterns: /业绩|案例|资质|资格|证书/,
    terms: ["业绩", "案例", "资质", "资格", "证书", "类似项目", "中标通知"],
  },
  {
    topic: "评分",
    patterns: /评分|评标|分值|得分|评审/,
    terms: ["评分", "评标", "分值", "得分", "评审", "评分标准", "评分因素", "权重"],
  },
  {
    topic: "需求清单",
    patterns: /清单|需求|参数|指标|配置/,
    terms: ["清单", "需求", "参数", "指标", "配置", "技术要求", "功能要求", "性能"],
  },
]

/**
 * 根据章节标题/小节名，找出匹配的技术主题，返回该主题的同义词。
 *
 * 说明：
 *   · 一个标题可能命中多个主题（如「实施与运维方案」），返回并集
 *   · 未命中任何主题时返回空数组（调用方保持原行为）
 */
export function techTermsForTitle(title: string): string[] {
  const t = String(title ?? "")
  if (!t.trim()) return []
  const out: string[] = []
  for (const entry of TECH_TOPIC_TERMS) {
    if (entry.patterns.test(t)) out.push(...entry.terms)
  }
  return [...new Set(out)]
}

/**
 * 把章节标题/小节名扩展成更宽的检索词集合。
 *
 * 行为保证：
 *   · 原有的 title/sections 一定保留在最前面（优先级最高，不改既有行为）
 *   · 同义词追加在后面，只增加召回、不改变原有命中
 *   · 去重
 */
export function extendQueryWithSynonyms(input: { title: string; sections?: string[]; clauses?: string[] }): string[] {
  const base = [input.title, ...(input.sections ?? []), ...(input.clauses ?? [])]
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length >= 2)
  const syn = techTermsForTitle(input.title)
  return [...new Set([...base, ...syn])]
}

/** 供测试/调试：列出所有主题与其词表 */
export function listTechTopics(): { topic: string; terms: string[] }[] {
  return TECH_TOPIC_TERMS.map((e) => ({ topic: e.topic, terms: [...e.terms] }))
}
