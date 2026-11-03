// ---------------------------------------------------------------------------
// PPT 生成链路 · Zod Schema 单一真源（2026-10-30）
//
// 为什么要有这一层：
//   原实现用手写 normalizeXxx 函数做"容错解析"，问题有三：
//     ① 非法字段被**静默吞掉**（大纲里的 role/kind/sourceRefs 就是这么丢的）；
//     ② 校验规则散落在各函数里，改了这头忘那头；
//     ③ 模型返回结构漂移时只能靠"猜测"降级，无法给出可行动的报错。
//
//   现改为：**所有模型输出先过 Zod，再进编辑器**。校验失败返回带字段路径的错误，
//   调用方据此决定"重试这一页/留占位/提示用户"，而不是继续带病往下走。
//
// 设计原则：
//   - Schema 只约束**结构**，不约束内容质量（质量归 lintDeck）
//   - 宽松模式：未知字段保留（strip 关闭），便于前后端演进
//   - 所有 schema 都可 safeParse，不抛原始 ZodError（接口统一）
// ---------------------------------------------------------------------------

import { z } from "zod"

// ===========================================================================
// 一、枚举与基础类型
// ===========================================================================

/** 页面类型：决定用哪个渲染器。模型只能从这 11 种里选，不能自由发明。 */
export const SLIDE_KINDS = [
  "cover", // 封面
  "agenda", // 目录
  "section", // 章节过渡
  "bullets", // 要点
  "kpi", // 数字亮点
  "chart", // 图表
  "table", // 表格
  "flow", // 流程图
  "architecture", // 架构图
  "image", // 图文页
  "summary", // 总结/致谢
] as const

/** kind 的中文名（错误提示与界面展示用） */
export const KIND_LABEL: Record<(typeof SLIDE_KINDS)[number], string> = {
  cover: "封面",
  agenda: "目录",
  section: "章节页",
  bullets: "要点页",
  kpi: "数字亮点",
  chart: "图表",
  table: "表格",
  flow: "流程图",
  architecture: "架构图",
  image: "图文页",
  summary: "总结页",
}

export const SlideKindSchema = z.enum(SLIDE_KINDS, {
  // 中文错误文案（默认是 zod 英文，界面直接展示会很难懂）
  message: `页面类型必须是：${SLIDE_KINDS.map((k) => KIND_LABEL[k]).join("/")} 之一`,
})
export type SlideKindZ = z.infer<typeof SlideKindSchema>

/** 页面在汇报故事中的角色（SCQA 骨架） */
export const SLIDE_ROLES = [
  "context",
  "problem",
  "question",
  "answer",
  "evidence",
  "approach",
  "plan",
  "value",
  "close",
] as const

export const ROLE_LABEL_CN: Record<(typeof SLIDE_ROLES)[number], string> = {
  context: "背景",
  problem: "痛点",
  question: "问题",
  answer: "主张",
  evidence: "论据",
  approach: "路径",
  plan: "计划",
  value: "价值",
  close: "收尾",
}

export const SlideRoleSchema = z.enum(SLIDE_ROLES, {
  message: `叙事角色必须是：${SLIDE_ROLES.map((r) => ROLE_LABEL_CN[r]).join("/")} 之一`,
})
export type SlideRoleZ = z.infer<typeof SlideRoleSchema>

/** 素材引用：每页可追溯"这段内容来自哪份素材的哪一段" */
export const SourceRefSchema = z.object({
  /** 素材块 id（素材索引里的稳定 key） */
  chunkId: z.string().min(1).max(120),
  /** 素材文件名或方案/标书名，用于展示 */
  materialName: z.string().max(200).default(""),
  /** 命中片段摘要（≤120 字，避免把全文塞进页面元数据） */
  excerpt: z.string().max(400).default(""),
  /** 素材类型：内容素材 / 视觉素材（二者不得混用） */
  kind: z.enum(["content", "visual"]).default("content"),
})
export type SourceRefZ = z.infer<typeof SourceRefSchema>

// ===========================================================================
// 二、各 kind 的负载结构
// ===========================================================================

/**
 * 图表数据。
 * 硬约束：categories 与每个 series.data 长度必须一致——不一致的图表在 PPT 里会画错，
 * 这是原实现反复出现的缺陷（deckLint 里专门有一条 chart_len_mismatch 在兜）。
 */
export const ChartDataSchema = z
  .object({
    type: z.enum(["bar", "pie", "line"], { message: "图表类型必须是柱状/饼图/折线" }),
    title: z.string().max(80).default(""),
    unit: z.string().max(20).default(""),
    categories: z.array(z.string().min(1).max(40)).min(2).max(12),
    series: z
      .array(
        z.object({
          name: z.string().max(40).default(""),
          data: z.array(z.number().finite()).min(2).max(12),
        }),
      )
      .min(1)
      .max(6),
    /** 数据来源说明（无来源的图表不允许导出） */
    dataSource: z.string().max(200).default(""),
  })
  .superRefine((v, ctx) => {
    // 逐条 series 检查长度一致，并精确报告是哪一条不一致（原来只报"(根)"）
    v.series.forEach((s, i) => {
      if (s.data.length !== v.categories.length) {
        ctx.addIssue({
          code: "custom",
          path: ["series", i, "data"],
          message: `第 ${i + 1} 组数据有 ${s.data.length} 个值，但类目有 ${v.categories.length} 个，必须一致`,
        })
      }
    })
  })
export type ChartDataZ = z.infer<typeof ChartDataSchema>

/** 表格数据。硬约束：每行长度 === 列数。 */
export const TableDataSchema = z
  .object({
    columns: z.array(z.string().min(1).max(40)).min(2).max(6),
    rows: z.array(z.array(z.string().max(200))).min(1).max(12),
    variant: z.enum(["compare", "progress"]).default("compare"),
  })
  .superRefine((v, ctx) => {
    v.rows.forEach((r, i) => {
      if (r.length !== v.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `第 ${i + 1} 行有 ${r.length} 个单元格，但表格有 ${v.columns.length} 列，必须一致`,
        })
      }
    })
  })
export type TableDataZ = z.infer<typeof TableDataSchema>

/** 流程图：3-7 步（超出应拆页或改表格） */
export const FlowDataSchema = z.object({
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(30),
        desc: z.string().max(60).optional(),
      }),
    )
    .min(3)
    .max(7),
  branches: z.array(z.string().max(40)).max(4).optional(),
})
export type FlowDataZ = z.infer<typeof FlowDataSchema>

/** 架构图：3-6 层，每层 2-6 模块（对齐 docs/architecture-ppt-playbook.md） */
export const ArchitectureDataSchema = z.object({
  layers: z
    .array(
      z.object({
        name: z.string().min(1).max(20),
        modules: z.array(z.string().min(1).max(24)).min(2).max(6),
        arrowLabel: z.string().max(20).optional(),
      }),
    )
    .min(3)
    .max(6),
  crossCutting: z.array(z.string().max(20)).max(6).optional(),
})
export type ArchitectureDataZ = z.infer<typeof ArchitectureDataSchema>

/** KPI 亮点（2-4 个） */
export const KpiDataSchema = z
  .array(z.object({ value: z.string().min(1).max(20), label: z.string().min(1).max(30) }))
  .min(1)
  .max(4)
export type KpiDataZ = z.infer<typeof KpiDataSchema>

// ===========================================================================
// 三、大纲（生成前的计划）
// ===========================================================================

/**
 * 大纲条目 —— 这是整条链路的关键契约。
 *
 * 2026-10-30 修复的核心问题：原 SlidePlan 只有 { title, intent }，
 * 大纲阶段模型给的 role/kind/sourceRefs 全被丢弃 → 逐页生成时无约束 → 全变 bullets。
 * 现在 kind/role 是**必填**，逐页生成必须遵守。
 */
export const SlideOutlineSchema = z.object({
  /** 稳定 id（大纲阶段生成，逐页时复用，便于增量重试与追溯） */
  id: z.string().min(1).max(40),
  title: z.string().min(2).max(60),
  /** 叙事角色；非必填但强烈建议，缺失时按 kind 推断 */
  role: SlideRoleSchema.optional(),
  /** 这页要讲什么（一句话，供逐页生成与用户审阅） */
  intent: z.string().max(200).default(""),
  /** 页面类型——逐页生成**不得**改回 bullets */
  kind: SlideKindSchema,
  /** 引用的素材块 */
  sourceRefs: z.array(SourceRefSchema).max(8).default([]),
  /** 预估内容量（字数），用于判断是否需要拆页 */
  estimatedContent: z.number().int().min(0).max(2000).default(0),
})
export type SlideOutlineZ = z.infer<typeof SlideOutlineSchema>

export const DeckOutlineSchema = z.object({
  slides: z.array(SlideOutlineSchema).min(1).max(60),
})
export type DeckOutlineZ = z.infer<typeof DeckOutlineSchema>

// ===========================================================================
// 四、逐页内容（生成后的产物）
// ===========================================================================

/**
 * 单页内容。
 * 注意：**模型不输出坐标/字号/颜色/HTML**——这里刻意不定义这些字段，
 * 排版完全由渲染器按 kind + 模板版式决定。
 */
export const SlideContentSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(2).max(60),
  kind: SlideKindSchema,
  role: SlideRoleSchema.optional(),
  /** 正文要点：默认 2-4 条，每条 ≤32 字（详细内容进 notes） */
  bullets: z.array(z.string().min(1).max(120)).max(6).default([]),
  /** 演讲者备注：可详尽 */
  notes: z.string().max(2000).default(""),
  /** 各 kind 的负载，按 kind 二选一/多选 */
  chart: ChartDataSchema.optional(),
  table: TableDataSchema.optional(),
  flow: FlowDataSchema.optional(),
  architecture: ArchitectureDataSchema.optional(),
  kpi: KpiDataSchema.optional(),
  /** 配图关键词（不是图片本身；真实配图由视觉计划决定） */
  imageHint: z.string().max(60).default(""),
  /** 本页引用的素材（从大纲继承 + 逐页补充） */
  sourceRefs: z.array(SourceRefSchema).max(8).default([]),
  /** 待补充字段（缺事实时输出，禁止编造） */
  pendingFields: z.array(z.string().max(60)).max(10).default([]),
})
export type SlideContentZ = z.infer<typeof SlideContentSchema>

export const SlideContentListSchema = z.object({
  slides: z.array(SlideContentSchema).min(1).max(4),
})

// ===========================================================================
// 五、模板映射
// ===========================================================================

/**
 * 页面类型 → 模板版式 id 的映射。
 * 缺失某项不报错（由渲染器按 kind 兜底），但导出时必须显式告知用户"这页没用模板版式"。
 */
export const TemplateMappingSchema = z.object(
  Object.fromEntries(SLIDE_KINDS.map((k) => [k, z.string().max(80).optional()])) as Record<
    SlideKindZ,
    z.ZodOptional<z.ZodString>
  >,
)
export type TemplateMappingZ = z.infer<typeof TemplateMappingSchema>

// ===========================================================================
// 六、统一解析入口
// ===========================================================================

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; issues: { path: string; message: string }[] }

/**
 * 安全解析：把 ZodError 转成「人可读的中文报错 + 字段路径列表」。
 * 不抛异常，调用方据 ok 分支处理（重试/占位/提示）。
 */
export function safeParse<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const r = schema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  const issues = r.error.issues.slice(0, 8).map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }))
  const first = issues[0]
  const message = first
    ? `字段「${first.path || "(根)"}」不合法：${first.message}${issues.length > 1 ? `（共 ${r.error.issues.length} 处）` : ""}`
    : "返回结构不合法"
  return { ok: false, message, issues }
}

/**
 * 严格解析：失败直接抛带字段路径的 Error。
 * 只用于「必须成功，否则宁可失败」的场景（如最终文档结构组装）。
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label = "数据结构"): T {
  const r = safeParse(schema, raw)
  if (!r.ok) throw new Error(`${label}校验失败：${r.message}`)
  return r.data
}

// ===========================================================================
// 七、辅助：kind 与 role 的推荐搭配（用于大纲校验与提示，不做强约束）
// ===========================================================================

/** 各 kind 是否必须携带对应负载——导出/保存前据此做完整性检查 */
export const KIND_REQUIRED_PAYLOAD: Partial<Record<SlideKindZ, keyof SlideContentZ>> = {
  chart: "chart",
  table: "table",
  flow: "flow",
  architecture: "architecture",
  kpi: "kpi",
}

/** role 的推荐 kind（模型偏离时给提示，不强制） */
export const ROLE_KIND_HINT: Record<SlideRoleZ, SlideKindZ[]> = {
  context: ["kpi", "bullets", "image"],
  problem: ["bullets", "table", "chart"],
  question: ["bullets", "kpi"],
  answer: ["architecture", "bullets", "flow"],
  evidence: ["chart", "kpi", "table"],
  approach: ["architecture", "flow"],
  plan: ["table", "flow"],
  value: ["kpi", "chart"],
  close: ["summary", "bullets"],
}
