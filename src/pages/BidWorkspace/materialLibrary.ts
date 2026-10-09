// ---------------------------------------------------------------------------
// R167 标书优质素材库（五类标准件）：ref_materials_text 的「分类结构化」单一真源（Logic 层专用，无 JSX）
//
// 设计约束（务必保持）：
// 1. 零 collection / 零 schema——素材库内容全部编码进已存在的 ref_materials_text 字段，
//    以「【素材库·<类别名>】」标记段承载；未标记部分归入 other（团队自由资料），向后兼容 17D 现状。
// 2. 零 AI——解析、归类、拆分、基线取用全部本地纯函数；生成侧只是多带一段基线文本。
// 3. 公司默认标准件只给「结构与写法范式」，人物/业绩/合同额等事实一律留占位提示，
//    与「禁止编造」铁律同向：默认件不可照抄进标书，必须按招标要求与全局事实改写。
// ---------------------------------------------------------------------------

/** 五类公司优质标书素材（标准件）类别 */
export type MaterialKind = "design" | "background" | "implementation" | "training" | "testing"

export type MaterialKindMeta = {
  kind: MaterialKind
  /** 类别名（同时是存储标记里的类别名） */
  label: string
  /** 一句话用途说明（面板展示） */
  hint: string
  /** 章节标题命中词（按章/节标题判定归属类别，本地判定零 AI） */
  titleKeywords: string[]
}

/** 类别顺序即面板展示顺序 */
export const MATERIAL_KINDS: readonly MaterialKindMeta[] = [
  {
    kind: "design",
    label: "设计方案",
    hint: "总体架构 / 技术路线 / 功能设计与集成方案的组织范式",
    titleKeywords: ["设计", "架构", "建设方案", "技术方案", "总体", "功能", "集成", "部署", "技术路线", "平台"],
  },
  {
    kind: "background",
    label: "项目背景分析",
    hint: "政策依据 / 现状调研 / 需求与痛点分析的组织范式",
    titleKeywords: ["背景", "现状", "需求", "痛点", "依据", "政策", "形势", "差距", "必要性", "调研"],
  },
  {
    kind: "implementation",
    label: "实施方案",
    hint: "实施组织 / 进度计划 / 质量与风险管控的组织范式",
    titleKeywords: ["实施", "进度", "计划", "组织", "里程碑", "风险", "质量", "保障", "交付", "项目管理", "团队"],
  },
  {
    kind: "training",
    label: "培训方案",
    hint: "培训对象 / 课程与课时 / 讲师与考核的组织范式",
    titleKeywords: ["培训", "教学", "课程", "课时", "实操", "知识转移", "上岗"],
  },
  {
    kind: "testing",
    label: "测试方案",
    hint: "测试范围 / 类型与用例 / 准入准出与缺陷管理的组织范式",
    titleKeywords: ["测试", "验收", "用例", "缺陷", "性能测试", "压力测试", "回归", "准出", "试运行"],
  },
] as const

export const MATERIAL_KIND_MAP: Readonly<Record<MaterialKind, MaterialKindMeta>> = Object.fromEntries(
  MATERIAL_KINDS.map((m) => [m.kind, m]),
) as Record<MaterialKind, MaterialKindMeta>

/** 存储标记：段首「【素材库·设计方案】」 */
const SECTION_HEAD = "【素材库·"
const SECTION_TAIL = "】"

/** 素材库总标记：资料里出现即说明已启用结构化素材库（未出现=存量自由资料，行为同 17D） */
export const LIBRARY_MARK = "【素材库·"

/** 单个类别基线注入上限（与团队资料注入同量级，控制 prompt 体积） */
export const LIBRARY_BASELINE_MAX_CHARS = 1500

/** 素材库派生结构：五类内容 + 未归类的自由资料 */
export type MaterialLibrary = Record<MaterialKind, string> & { other: string }

/**
 * 公司默认标准件（结构与写法范式，不含具体业绩/人员事实）。
 * 「〔按本项目填写：…〕」为强制占位，提醒必须用招标要求与全局事实替换。
 */
export const COMPANY_DEFAULTS: Readonly<Record<MaterialKind, string>> = {
  design: `一、写作骨架（按此顺序组织，缺项不写空话）
1. 建设目标与范围：先用招标原文的目标措辞复述，再列出本项目覆盖的系统清单与边界（含不含旧系统数据迁移、含不含硬件）。
2. 总体架构：分「业务架构 / 应用架构 / 数据架构 / 技术架构 / 部署架构」五层逐层写，每层先说明设计原则，再给出层内模块与上下游关系。
3. 技术路线与选型：写明微服务/容器化、消息中间件、数据库、集成引擎等选型，并逐条给出选型理由（与招标技术要求对应，不空喊先进性）。
4. 集成与接口方案：以「被集成系统 → 接口方式（HL7/FHIR/视图/WebService）→ 数据流向 → 频率与容错」四列表述，逐系统落地。
5. 分系统功能设计：每个系统按「业务场景 → 功能清单（对应招标参数条目号）→ 关键流程闭环 → 与评级/互联互通条款的关系」写。
6. 安全与合规设计：等保级别、密码应用、三员管理、数据分级、容灾指标（RPO/RTO 取招标要求档位）。
7. 图表位：总体架构图、集成关系图、数据流转图各一张，图后必须有文字解读（图不单独成段）。
二、写法要求
量化承诺只写招标已给的档位与〔按本项目填写：我院承诺值〕；禁止编造并发数、响应时延、性能指标数字；每个功能点须能追溯到招标参数条目号。`,
  background: `一、写作骨架
1. 政策与标准依据：按「国家规划 → 行业标准与评级要求 → 省/市落地要求 → 医院自身决议」四级列清单，名称与文号必须来自招标原文或规范库〔按本项目填写：文号〕，禁止编造编号。
2. 采购人现状：院内信息化现状按「已建系统清单与版本 → 使用科室与业务量 → 现有集成方式 → 主要堵点」四步写实，数据取自现场调研与招标文件「项目背景」段〔按本项目填写：床位数/门急诊量/已建系统〕。
3. 差距分析：用「评级/互联互通要求条款 → 现状 → 差距 → 本项目对应建设内容」四段式逐条对齐，形成需求到建设的可追溯链。
4. 需求归纳：分「业务需求 / 管理需求 / 数据需求 / 集成需求 / 安全需求」五类，每类给出优先级与响应章节号。
5. 建设必要性与预期效益：效益只写可验证的（流程时限、纸质替代、报表产出、评级达标），不写空泛形容词。
二、写法要求
本章只作分析与对齐，不新增招标未提及的建设内容；所有现状表述须能在招标原文中找到依据，无依据的标注「按现场调研确认」。`,
  implementation: `一、写作骨架
1. 实施总体策略：先写「统一规划、分步实施、先核心后外围、先上线后优化」的推进逻辑，再说明与招标工期要求的对应关系。
2. 组织架构与职责：用「角色 → 人数 → 驻场方式 → 职责 → 汇报关系」表述；关键岗位（项目经理/实施负责人/DBA/集成工程师）逐一定位〔按本项目填写：人员姓名与简历编号〕。
3. 阶段与里程碑：按「项目启动 → 需求确认 → 环境准备 → 部署配置 → 接口开发与联调 → 数据迁移 → 培训 → 试运行 → 初验 → 正式运行 → 终验」排列，每阶段给工期、交付物、验收标准三要素。
4. 进度保障：写关键路径、并行策略、周例会与日报机制、里程碑偏差的处理流程（偏差多少天启动何种升级）。
5. 质量与配置管理：文档评审、代码/配置版本管理、变更控制流程（申请 → 影响评估 → 审批 → 实施 → 回归）。
6. 风险管控：按「风险 → 触发条件 → 影响 → 预防措施 → 应急预案 → 责任人」列表，至少覆盖接口延迟、数据迁移、旧系统停机窗口、人员变动四类。
7. 上线与切换方案：写切换窗口、回切条件、灰度范围、驻场保障时段与联系方式。
二、写法要求
所有工期、人数、到场时限必须等于或优于招标要求档位且不高于全局事实表口径；未提供的用「按招标文件要求响应」。`,
  training: `一、写作骨架
1. 培训目标与原则：区分「会用、会配置、会运维」三级目标，对应不同对象。
2. 培训对象分层：最终用户（医师/护士/医技/收费/药房）、关键用户与信息科、管理与运维人员三层，分别说明人数与基础要求。
3. 课程与课时安排：用「课程 → 对象 → 课时 → 讲师 → 形式（集中授课/现场带教/线上回放）→ 考核方式」表；核心业务系统按岗位排课，不写成一门大课。〔按本项目填写：课时与批次〕
4. 培训组织与保障：培训计划报批、场地与账号准备、培训环境（独立培训库）、签到与效果跟踪。
5. 考核与合格标准：笔试/上机操作双考核，不合格人员补训与复训安排；培训交付物（教材、操作手册、视频清单）。
6. 知识转移与长期支持：管理员培训、运维手册交付、上线后按需二次培训机制。
二、写法要求
承诺的培训课时/批次/驻场天数只能取招标已要求档位或全局事实表口径，禁止自行加码。`,
  testing: `一、写作骨架
1. 测试策略与范围：分「功能测试 / 接口与集成测试 / 性能测试 / 安全测试 / 数据迁移校验 / 用户验收测试（UAT）」六类，逐类说明目的、责任方与介入时机。
2. 测试环境与数据：环境清单（开发/测试/培训/准生产）、脱敏数据来源、环境隔离与就绪条件。
3. 用例设计：以招标参数条目与评分点为用例来源，逐条形成「条款号 → 用例编号 → 前置条件 → 步骤 → 预期结果」可追溯矩阵。〔按本项目填写：用例编号规则〕
4. 准入准出准则：准入（版本冻结/环境就绪/冒烟通过）、准出（用例执行率 100%、致命与严重缺陷清零、遗留缺陷有规避方案与责任人）。
5. 缺陷管理：严重级别定义、提交与分派流程、修复时限与回归策略、缺陷趋势度量。
6. 性能与安全测试：指标取招标要求档位，给出压测场景构造方法与结论判据；安全测试覆盖等保要求项〔按本项目填写：指标档位〕。
7. 验收与试运行：初验/终验流程、验收资料清单、试运行时长与问题闭环标准。
二、写法要求
禁止出现招标未要求的具体数值（响应时间、并发数）；测试结论表述用「满足招标 ××× 要求」的可核对句式。`,
}

// ---------------------------------------------------------------------------
// 存储文本 <-> 分类结构（纯函数，双向可逆）
// ---------------------------------------------------------------------------

/**
 * 解析 ref_materials_text 为分类结构：按「【素材库·<类别名>】」切段。
 * 未标记的首段与段落归入 other；未知类别名的标记段同样归 other（不误丢内容）。
 */
export function parseMaterialLibrary(text: string): MaterialLibrary {
  const lib: MaterialLibrary = { design: "", background: "", implementation: "", training: "", testing: "", other: "" }
  const raw = (text ?? "").replace(/\r\n/g, "\n")
  if (!raw.trim()) return lib
  // 段边界：标记必须独占一行（段首允许前置空白）
  const parts = raw.split(/(?=^[ \t]*【素材库·[^】]{1,20}】)/m)
  for (const part of parts) {
    const seg = part.trim()
    if (!seg) continue
    const hit = seg.match(/^【素材库·([^】]{1,20})】\s*\n?/)
    if (!hit) {
      lib.other = joinBlocks([lib.other, seg])
      continue
    }
    const meta = MATERIAL_KINDS.find((m) => m.label === hit[1].trim())
    const body = seg.slice(hit[0].length).trim()
    if (!meta) {
      lib.other = joinBlocks([lib.other, seg])
      continue
    }
    lib[meta.kind] = joinBlocks([lib[meta.kind], body])
  }
  return lib
}

/** 分类结构 -> 存储文本：自由资料(other)前置，五类标记段按序附后（无分类内容时返回 other 原文，行为同 17D）。
 * other 置于首个标记之前，是与 parseMaterialLibrary「标记段延伸到下一标记」互逆的唯一无损排布。 */
export function renderMaterialLibrary(lib: Partial<MaterialLibrary>): string {
  const blocks: string[] = []
  const other = (lib.other ?? "").trim()
  if (other) blocks.push(other)
  for (const meta of MATERIAL_KINDS) {
    const body = (lib[meta.kind] ?? "").trim()
    if (body) blocks.push(`${SECTION_HEAD}${meta.label}${SECTION_TAIL}\n${body}`)
  }
  return blocks.join("\n\n")
}

/** 单类增改：返回新的存储文本（先解析到结构、替换该类、再渲染，保证其他内容与顺序不丢） */
export function upsertLibraryKind(text: string, kind: MaterialKind, body: string): string {
  const lib = parseMaterialLibrary(text)
  lib[kind] = body.trim()
  return renderMaterialLibrary(lib)
}

/** 各类别字数（面板徽标用；other 不计入素材库覆盖数） */
export function libraryCounts(lib: MaterialLibrary): Record<MaterialKind, number> {
  const out = {} as Record<MaterialKind, number>
  for (const meta of MATERIAL_KINDS) out[meta.kind] = (lib[meta.kind] ?? "").trim().length
  return out
}

/** 已建类别数（0-5），供面板与接线哨兵判定 */
export function libraryFilledKinds(lib: MaterialLibrary): MaterialKind[] {
  return MATERIAL_KINDS.filter((m) => (lib[m.kind] ?? "").trim().length > 0).map((m) => m.kind)
}

// ---------------------------------------------------------------------------
// 章节归属判定与基线取用（生成链路消费）
// ---------------------------------------------------------------------------

/**
 * 章/节标题 -> 素材类别（首个命中关键词的类别；命中多个按 MATERIAL_KINDS 顺序取先）。
 * 未命中返回 null（调用方按「无基线」静默降级，行为同现状）。
 */
export function libraryKindFor(title: string, sections?: string[]): MaterialKind | null {
  const hay = [title ?? "", ...(sections ?? [])].join(" ").toLowerCase()
  if (!hay.trim()) return null
  for (const meta of MATERIAL_KINDS) {
    if (meta.titleKeywords.some((k) => hay.includes(k.toLowerCase()))) return meta.kind
  }
  return null
}

/**
 * 取某类别的生成基线文本：命中类内容截断到 LIBRARY_BASELINE_MAX_CHARS；
 * 素材库未启用（无标记）或该类为空返回空串（调用方静默不注入）。
 */
export function libraryBaselineFor(text: string, kind: MaterialKind | null): string {
  if (!kind) return ""
  const raw = (text ?? "").trim()
  if (!raw || !raw.includes(LIBRARY_MARK)) return ""
  const body = parseMaterialLibrary(raw)[kind].trim()
  if (!body) return ""
  return body.length > LIBRARY_BASELINE_MAX_CHARS ? `${body.slice(0, LIBRARY_BASELINE_MAX_CHARS)}…` : body
}

/** 一次性取本项目的基线注入段（章级/节级共用；未启用素材库返回空串） */
export function libraryBaselineText(text: string, title: string, sections?: string[]): string {
  return libraryBaselineFor(text, libraryKindFor(title, sections))
}

// ---------------------------------------------------------------------------
// 自由资料自动归类（「一键归类」：把未标记的团队资料按标题/首行命中词分到五类）
// ---------------------------------------------------------------------------

/** 长文本按段落切块：空行为块界，块内遇标题行不额外拆分（保序、逐段独立） */
function splitBlocks(text: string): string[] {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((b) => b.trim())
    .filter(Boolean)
}

/**
 * 自动归类：把自由资料（other）按块首行命中词分到五类，未命中块留在 other。
 * 只搬运文本不改字，可反复执行（幂等性由调用方保证：先解析再归类）。
 */
export function autoClassifyLibrary(lib: MaterialLibrary): MaterialLibrary {
  const next: MaterialLibrary = { ...lib, other: "" }
  const rest: string[] = []
  for (const block of splitBlocks(lib.other)) {
    const head = block.split("\n")[0] ?? block
    const kind = libraryKindFor(head.slice(0, 60), [block.slice(0, 120)])
    if (kind) next[kind] = joinBlocks([next[kind], block])
    else rest.push(block)
  }
  next.other = rest.join("\n\n").trim()
  return next
}

function joinBlocks(items: string[]): string {
  return items.map((s) => (s ?? "").trim()).filter(Boolean).join("\n\n")
}

// ---------------------------------------------------------------------------
// 生成注入段的「基线 / 自由资料检索」可逆拆分（渲染与消费两侧的单一约定）
// ---------------------------------------------------------------------------

/**
 * 基线标记前缀：素材库命中类别时，注入 ref_materials 的文本形如
 *   「【公司标准件基线·设计方案】<换行>基线正文<空行><空行>自由资料检索段」
 * 未命中（素材库未启用 / 该类为空）时不带标记，与第十七轮 17D 现状逐字一致。
 */
export const BASELINE_PREFIX_MARK = "【公司标准件基线·"

/** 基线段与检索段之间的分隔（两个连续空行，检索段内部不会自造） */
const BASELINE_SEGMENT_SEP = "\n\n\n"

/** 渲染基线标记头（kind=null 返回空串） */
export function baselineMarkForKind(kind: MaterialKind | null): string {
  if (!kind) return ""
  return `${BASELINE_PREFIX_MARK}${MATERIAL_KIND_MAP[kind].label}】`
}

/** 拼装注入 ref_materials 的完整文本（基线可空、检索段可空；两者皆空返回空串） */
export function composeRefMaterials(baselineMark: string, baseline: string, fragments: string): string {
  if (!baselineMark || !baseline) return fragments
  const head = baselineMark + "\n" + baseline
  return fragments ? head + BASELINE_SEGMENT_SEP + fragments : head
}

/** 注入文本 -> [基线正文, 自由资料检索段]（无标记时基线为空串、检索段即全文） */
export function splitRefMaterials(text: string): [string, string] {
  const raw = (text ?? "").trim()
  if (!raw.startsWith(BASELINE_PREFIX_MARK)) return ["", raw]
  const cut = raw.indexOf(BASELINE_SEGMENT_SEP)
  const headBlock = cut < 0 ? raw : raw.slice(0, cut)
  const tail = cut < 0 ? "" : raw.slice(cut + BASELINE_SEGMENT_SEP.length).trim()
  const lines = headBlock.split("\n")
  const body = lines.slice(1).join("\n").trim()
  return [body, tail]
}

/** 取基线正文（builder 侧 libraryBaseline 用） */
export function extractBaselineSegment(text: string): string {
  return splitRefMaterials(text)[0]
}

/** 取自由资料检索段（builder 侧 refMaterials 用） */
export function extractFragmentSegment(text: string): string {
  return splitRefMaterials(text)[1]
}

/** 取命中的类别名（builder 侧 libraryKindLabel 用；未命中返回空串） */
export function baselineLabelFromText(text: string): string {
  const raw = (text ?? "").trim()
  if (!raw.startsWith(BASELINE_PREFIX_MARK)) return ""
  const hit = raw.match(/^【公司标准件基线·([^】]{1,20})】/)
  return hit ? hit[1].trim() : ""
}

/** 判断某类正文是否仍是公司默认标准件（未作定制）：去空白后与 COMPANY_DEFAULTS 全等 */
export function isCompanyDefaultBody(kind: MaterialKind, body: string): boolean {
  const norm = (s: string) => (s ?? "").replace(/\s+/g, "").trim()
  return norm(body).length > 0 && norm(body) === norm(COMPANY_DEFAULTS[kind])
}
