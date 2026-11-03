// ---------------------------------------------------------------------------
// 三份部门检查清单（原样导入，零 AI）——模块级常量真源 + 纯函数
//
// 来源（逐字照抄，不改写 / 不精简 / 不合并措辞；源表位置 D:\重要文件\工作的小程序\KIMI\pretest-assets\）：
//   ① 参照-招标书检查清单.xlsx   · sheet「招标文件检查表」 17 行（数据区 r5-r16，表尾 r17）
//   ② 参照-投标文件检查清单.xlsx · sheet「投标文件检查表」 33 行（数据区 r5-r32，表尾 r33）
//   ③ 参照-解决方案检查清单.xlsx · sheet「投标文件检查表」 24 行（数据区 r5-r23，表尾 r24；表名是「解决方案检查表」）
//
// 三份结构完全一致（两行表头 + 数据行 + 表尾签名栏）：
//   r1 表名；r2 项目名称 / 主负责人 / 难度系数；
//   r3+r4 表头：序号 | 检查内容 | 细则 | 自查检查（检查日期：）→ 结果 / 问题记录 / 检查人 |
//               交叉检查（检查日期：）→ 结果 / 问题记录 / 检查人；
//   数据行：分区行（原表 B:I 跨列合并、中文序号，如「一 文档基础性检查（自查）」）与条目行混排；
//   表尾：检查结果（1、可以送出 2、重新修改 + 修改原因）+ 签名栏（原文整行保留在 footer）。
//
// 逐行核对过的行数（bidChecklists.test.ts 逐项断言，防解析丢行）：
//   招标书   条目 10 + 分区 2 + 表尾 1 = 13（= 源表非表头行 13）
//   投标文件 条目 24 + 分区 4 + 表尾 1 = 29
//   解决方案 条目 17 + 分区 2 + 表尾 1 = 20
//   原表有两行未填序号（投标文件「公司红线条款」、解决方案「方案整体架构」），照原样保留空序号。
//
// 用户裁定（2026-10-15，见 bidComplianceRules.ts 模块头）：三份检查清单原样导入系统。
// 本模块只承载原文与结构（零依赖、零网络、可静态引用）；落库与填写留痕见 bidChecklistStore.ts，
// 面板见 components/bid-workspace/DeptChecklistPanel.tsx。
// ---------------------------------------------------------------------------

/** 一条清单条目（原文逐字） */
export type ChecklistItem = {
  /** 序号（原文形态："1" / "一"；原表未填序号的条目为空串） */
  no: string
  /** 检查内容（原文逐字） */
  content: string
  /** 细则（原文逐字，含原文换行；原表「建议与意见」类条目无细则） */
  detail: string
  /** 分区行（原表 B:I 跨列合并的组标题行）：不参与结果勾选，只作分组展示 */
  section?: boolean
}

/** 一份清单定义 */
export type ChecklistDef = {
  key: string
  title: string
  subtitle?: string
  headers: { projectName: string; owner: string; difficulty: string }
  /** 表尾原文（检查结果 / 修改原因 / 签名栏提示语，逐字保留） */
  footer: string
  items: ChecklistItem[]
}

/** 一个检查组（自查 / 交叉检查）的单行填写内容 */
export type DeptCheckCell = {
  /** 结果："√" 通过 / "×" 不通过 / "" 未判定（对应原表手写勾选栏） */
  result: "" | "√" | "×"
  /** 问题记录（原文列名） */
  note: string
  /** 检查人（原文列名） */
  checker: string
}

/** 一条可填写的清单行（rid 稳定标识一行，序号在组内会重复，不能当主键） */
export type DeptCheckRow = {
  rid: string
  no: string
  content: string
  detail: string
  section?: boolean
  self: DeptCheckCell
  cross: DeptCheckCell
}

/** 签名栏一项：签名 + 日期（文本框，不做电子签章） */
export type DeptCheckSignature = { name: string; date: string }

/** 留痕一条：谁在什么时候改了什么 */
export type DeptCheckLogEntry = { at: string; by: string; what: string }

/**
 * 扩展元数据：整包落在既有 checklists.rating_targets（json）列，零 schema 变更。
 * 这是本类记录（source_mode = "dept_check"）与「建设清单」共用一张表的区分标记与附属信息。
 */
export type DeptCheckMeta = {
  v: 1
  kind: "dept_check"
  /** 对应 ChecklistDef.key */
  def_key: string
  /** 项目级副本：绑定 bid_projects.id，每个项目一份、互不影响 */
  project_id: string
  header: { projectName: string; owner: string; difficulty: string }
  /** 表头「检查日期：」——自查 / 交叉检查各一个 */
  check_dates: { self: string; cross: string }
  /** 表尾签名栏 */
  signatures: { self: DeptCheckSignature; cross: DeptCheckSignature }
  /** 表尾「修改原因」（检查结果选「重新修改」时填写） */
  revise_reason: string
  /** 表尾检查结果："" 未定 / "ready" 可以送出 / "revise" 重新修改 */
  result: "" | "ready" | "revise"
  /** 留痕（最新在前，上限 DEPT_CHECK_LOG_CAP 条） */
  log: DeptCheckLogEntry[]
}

/** checklists.source_mode 标记值：本类记录（部门检查清单） */
export const DEPT_CHECK_SOURCE_MODE = "dept_check"
/** 扩展元数据 kind 标记值 */
export const DEPT_CHECK_KIND = "dept_check"
/** 留痕上限（json 列内自管，超出丢最旧；防无限膨胀） */
export const DEPT_CHECK_LOG_CAP = 50

/**
 * 三份清单一处定义（顺序即面板卡片顺序）。
 * items 与源表数据区逐行对应，每行上方注释标出源表行号，便于日后逐行复核。
 */
export const CHECKLIST_DEFS: ChecklistDef[] = [
  {
    key: "tender",
    title: "招标书检查表",
    subtitle: "参照-招标书检查清单.xlsx · sheet「招标文件检查表」",
    headers: { projectName: "项目名称:", owner: "主负责人:", difficulty: "难度系数：" },
    footer: "检查结果:（检查日期：         ）\n1、可以送出 ；\n2、重新修改            修改原因:                                                       签名：",
    items: [
      // 源表 r5
      { no: "一", content: "文档基础性检查（自查）", detail: "", section: true },
      // 源表 r6
      { no: "1", content: "文件命名是否规范", detail: "是否按售前管理要求进行命名" },
      // 源表 r7
      { no: "2", content: "封面页、页码、页眉、页脚", detail: "招标书不体现公司名称因此封面、页眉、页脚、页码等不出现公司相关的标志" },
      // 源表 r8
      { no: "3", content: "文件排版", detail: "全文项目名称一致、目录已更新\n检查全文格式、字体、行数是否统一；\n章节点是否准确；\n是否有空白页；\n图片是否模糊歪斜，图片表达的意思是否与标题符合；\n表格风格是否一致；\n是否出现其他医院或项目信息。要求全文完整浏览一遍。" },
      // 源表 r9
      { no: "二", content: "需求符合性检查（自查、交叉）", detail: "", section: true },
      // 源表 r10
      { no: "1", content: "成本检查", detail: "1、招标内容是否溢出前期方案、溢出公司标准报价体系。\n2、招标参数有不属于自有产品的范围包括要外采、额外成本、技术难实现的（标准方案没有的）要跟销售确认\n3、检验、检查、手麻、CA、移动护理、移动查房涉及到仪器数量的，是否有备注仪器数量，检验仪器是单双工等\n4、中间件是否有备注点数" },
      // 源表 r11
      { no: "2", content: "敏感字眼检查", detail: "整个招标文件不允许出现智业或其他厂商字眼、是否有出现产品特有名字（如onelink）、是否出现厂商相关的图片" },
      // 源表 r12
      { no: "3", content: "废标条款检查", detail: "1、是否有设置星号条款，并检查星号条款是否能满足三家以上投标\n2、技术评分项是否能满足副标50%的得分，防止废标\n3、是否面向中小企业投标" },
      // 源表 r13
      { no: "4", content: "公司红线条款", detail: "1、验收要求：是否难达标\n2、售后：是否超出公司要求1年（招标书给出去的时候必须提供售后的约定，否则容易被模板覆盖）\n3、回款：是否无首款（正常是首款30%）（招标书给出去的时候必须提供回款的约定，否则容易被模板覆盖）\n4、是否有源代码、知识产权归属业主的条款\n5、是否要求提供履约保证金、保函\n6、关于工期是否过短，是否存在交货期：30天，交货条件：验收后交货等矛盾描述导致交货期短的情况\n7、是否有免费升级字眼（必须出现的时候应该写同版本内免费升级）" },
      // 源表 r14
      { no: "5", content: "控标项检查", detail: "1、确认控标方式、控标对象\n2、核对控标项主标能不能得分" },
      // 源表 r15
      { no: "6", content: "其他项", detail: "1、单项不能超过3分、证书1个最多1分、测试报告1个最多3分\n2、出现与技术参数不相符的著作权、测试报告内容\n3、商务、技术、价格份数比例是否合规，各项分数总和与明细项是否一致没有逻辑错误" },
      // 源表 r16
      { no: "7", content: "建议与意见", detail: "" },
    ],
  },
  {
    key: "bid",
    title: "投标文件检查表（技术部分）",
    subtitle: "参照-投标文件检查清单.xlsx · sheet「投标文件检查表」",
    headers: { projectName: "项目名称:", owner: "主负责人:", difficulty: "难度系数：" },
    footer: "标书检查结果:（检查日期：         ）\n1、可以送出 ；\n2、重新修改            修改原因:                                                       签名：",
    items: [
      // 源表 r5
      { no: "一", content: "通用资格条件（自查、交叉）", detail: "", section: true },
      // 源表 r6
      { no: "1", content: "具备履行合同所必需的设备和专业技术能力", detail: "注意投标范围是否有涉及硬件部分，需要放3c、节能、环保等证书，以招标书要求为准。" },
      // 源表 r7
      { no: "二", content: "投标文件基础性检查（自查）", detail: "", section: true },
      // 源表 r8
      { no: "1", content: "项目名称与编号、采购单位、招标单位", detail: "投标文件整篇项目名称与编号是否正确、采购单位、招标单位是否正确" },
      // 源表 r9
      { no: "2", content: "投标人名称", detail: "投标人名称与营业执照是否正确" },
      // 源表 r10
      { no: "3", content: "投标文件排版", detail: "检查文本格式、字体、行数、图片是否模糊歪斜，是否按招标文件要求编辑；技术部分全篇幅浏览一遍。" },
      // 源表 r11
      { no: "4", content: "页码、页眉、页脚", detail: "是否符合招标文件要求,有无出现其他项目信息，尤其注意投标文件是否有分节，分节一定要检查到位" },
      // 源表 r12
      { no: "5", content: "投标报价", detail: "技术商务部分是否出现报价，公开招标技术部分不出现价格；特殊标除外" },
      // 源表 r13
      { no: "6", content: "投标文件的完整性", detail: "对照招标书的目录、格式要求进行逐项检查技术部分是否完整" },
      // 源表 r14
      { no: "7", content: "偏离表", detail: "表格标题行是否完整、准确，招标编号、名称、签字栏是否有遗漏；不出现负偏离或偏离情况空白行；合同包、品目号是否有错误；招标内容要求部分是否完整；技术指向是否有错误。" },
      // 源表 r15
      { no: "8", content: "投标内容", detail: "符合招标文件规定，是否完全响应招标文件要求" },
      // 源表 r16
      { no: "三", content: "技术部分复合性检查（自查、交叉）", detail: "", section: true },
      // 源表 r17
      { no: "1", content: "技术部分", detail: "产品或服务的技术规格、参数、方案是否符合招标文件要求（文字比对软件比对一遍，可以扩展，不能遗漏和改变原意）；不能出现其他项目的信息、别的公司信息、内容与本项目不符；\n主标要重点检查：有无擅自增加模块和招标没有要求的功能描述，以免造成额外的成本；" },
      // 源表 r18
      { no: "2", content: "交付期（工期)", detail: "交付期（工期）响应符合招标文件要求" },
      // 源表 r19
      { no: "3", content: "承诺函", detail: "标书要求的承诺条款是否都响应（搜索招标要求）,承诺函有没有独立一页，并带签字栏" },
      // 源表 r20
      { no: "", content: "公司红线条款", detail: "是否要提供著作权、产权、版权；免费维护期超1年；付款条件无首款；要求驻点人员；验收或付款是否绑定评级；要求免费升级（必须写免费升级的话也要加同版本内免费升级）……及时跟销售对接、并确认" },
      // 源表 r21
      { no: "4", content: "评分标准", detail: "评分标准是否响应到位，主标注重检查评分要求响应对不对、图片要求；副标重点检查技术分有没有超过50%" },
      // 源表 r22
      { no: "5", content: "投标演示", detail: "投标演示的响应" },
      // 源表 r23
      { no: "6", content: "实施方案", detail: "实施要求响应完整、实施计划表是否更新、交付工期是否满足要求：方案内、实施承诺不出现其他项目信息（注意招标公司名称、采购人、招标编号、招标项目）" },
      // 源表 r24
      { no: "7", content: "培训方案", detail: "培训要求响应完整、培训内容是否更新；方案内、培训承诺不出现其他项目信息（注意招标公司名称、采购人、招标编号、招标项目）" },
      // 源表 r25
      { no: "8", content: "售后方案", detail: "售后要求响应完整、售后服务内容是否更新；方案内、售后承诺不出现其他项目信息（注意招标公司名称、采购人、招标编号、招标项目）" },
      // 源表 r26
      { no: "四", content: "串标检查（自查、交叉）", detail: "", section: true },
      // 源表 r27
      { no: "1", content: "技术部分目录", detail: "技术部分的目录是否过分相似" },
      // 源表 r28
      { no: "2", content: "偏离表", detail: "三家横向查看招标要求部分的呈现、响应描述是否过分相似，严谨一模一样的拷贝" },
      // 源表 r29
      { no: "3", content: "技术方案", detail: "注意看三家响应情况是否一模一样" },
      // 源表 r30
      { no: "4", content: "承诺函", detail: "注意比对三家的承诺函是否过分相似" },
      // 源表 r31
      { no: "5", content: "实施方案、培训方案、售后服务方案、应急方案", detail: "注意比对三家的方案是否相似" },
      // 源表 r32
      { no: "6", content: "图片、表格检查", detail: "注意查看三家所提供的图片、表格是否有雷同或重复" },
    ],
  },
  {
    key: "sol",
    title: "解决方案检查表",
    subtitle: "参照-解决方案检查清单.xlsx · sheet「投标文件检查表」",
    headers: { projectName: "项目名称:", owner: "主负责人:", difficulty: "难度系数：" },
    footer: "检查结果:（检查日期：         ）\n1、可以送出 ；\n2、重新修改            修改原因:                                                       签名：",
    items: [
      // 源表 r5
      { no: "一", content: "文档基础性检查（自查）", detail: "", section: true },
      // 源表 r6
      { no: "1", content: "文件命名是否规范", detail: "是否按售前管理要求进行命名" },
      // 源表 r7
      { no: "2", content: "封面页", detail: "医院名称与官网一致，文档封面使用公司风格、编制时间是当前时间" },
      // 源表 r8
      { no: "3", content: "页码、页眉、页脚", detail: "页眉页脚用公司风格,有无出现其他项目信息，尤其注意文件是否有分节，分节一定要检查到位" },
      // 源表 r9
      { no: "4", content: "文件排版", detail: "全文项目名称一致、目录已更新\n检查全文格式、字体、行数是否统一；\n章节点是否准确；\n是否有空白页；\n图片是否模糊歪斜，图片表达的意思是否与标题符合；\n表格风格是否一致；\n是否出现其他医院或项目信息。要求全文完整浏览一遍。" },
      // 源表 r10
      { no: "5", content: "方案报价", detail: "正常情况下方案不包括报价，要求包括报价的项目价格要跟销售确认过。" },
      // 源表 r11
      { no: "6", content: "oa标准模块匹配", detail: "oa有标准模块的方案，方案内容是否匹配标准模块，要求提供标准模块下的excel表。在标准报价内直接勾选，以方便销售oa报价，和后面的oa审批流程。" },
      // 源表 r12
      { no: "7", content: "名词术语是否过时或不匹配", detail: "如客户名称卫生计生委-卫健委；人口健康信息平台-全民健康信息平台；3G、4G-5G；\n出现本投标人、本响应文件、出现其他客户名字等" },
      // 源表 r13
      { no: "二", content: "需求符合性检查（自查、交叉）", detail: "", section: true },
      // 源表 r14
      { no: "", content: "方案整体架构", detail: "根据方案的类型、阅读对象、已了解的信息及判断方案整体文档架构是否合理" },
      // 源表 r15
      { no: "1", content: "项目背景", detail: "背景涉及政策、建设依据是否是最新或较新的相关文件要求；\n背景是否跟本次需求相匹配；" },
      // 源表 r16
      { no: "2", content: "现状与需求分析", detail: "医院的现状和需求有没有体现；\n现状的差距是否能支撑本次项目的目标" },
      // 源表 r17
      { no: "3", content: "建设目标", detail: "有没有总结提炼出跟本次需求相一致的目标\n客户的定位与本次目标是否匹配,级别高的目标要高大上，级别小的医院目标可以细化" },
      // 源表 r18
      { no: "4", content: "建设内容", detail: "建议以清单体现，跟oa报价相匹配；\n是否跟本次需求相符合，评级项目是否有缺漏项" },
      // 源表 r19
      { no: "5", content: "总体设计", detail: "总体概述是否满足需求、响应政策\n总体架构图是否匹配需求\n技术路线是否最新或较新，并匹配需求" },
      // 源表 r20
      { no: "6", content: "详细功能方案", detail: "功能方案是否匹配建设oa清单、跟建设内容上下匹配；\n功能方案提供的截图是否体现其他医院名字或患者关键信息；\n功能描述不符合标题意思；\n部分节点功能描述太简单等" },
      // 源表 r21
      { no: "7", content: "实施方案及工期问题", detail: "方案阶段不建议体现工期，必须体现的情况下是否有跟销售进行沟通确认、并符合项目需求；\n实施方案是否与需求匹配" },
      // 源表 r22
      { no: "8", content: "竞争对手", detail: "是否有考虑竞争对手的优劣势，突出公司的优势" },
      // 源表 r23
      { no: "9", content: "建议与意见", detail: "" },
    ],
  },
]

/** 按 key 取清单定义（未知 key 返回 undefined，调用侧自行兜底） */
export function deptChecklistDef(key: string): ChecklistDef | undefined {
  return CHECKLIST_DEFS.find((d) => d.key === key)
}

/** 条目行数（剔除分区行）：面板「共 N 条」与测试断言用 */
export function deptCheckEntryCount(def: ChecklistDef): number {
  return def.items.filter((i) => !i.section).length
}

/** 源表非表头总行数（条目 + 分区 + 表尾）：核对「没漏行」用 */
export function deptCheckRowTotal(def: ChecklistDef): number {
  return def.items.length + 1
}

/** 由定义生成空白可填行（结果 / 问题记录 / 检查人全空，原文照搬） */
export function buildDeptCheckRows(def: ChecklistDef): DeptCheckRow[] {
  return def.items.map((it, idx) => ({
    rid: `${def.key}#${idx}`,
    no: it.no,
    content: it.content,
    detail: it.detail,
    ...(it.section ? { section: true as const } : {}),
    self: { result: "" as const, note: "", checker: "" },
    cross: { result: "" as const, note: "", checker: "" },
  }))
}

/** 空白扩展元数据：首次「导入为本项目清单」时落库（项目名称默认取当前项目名） */
export function emptyDeptCheckMeta(def: ChecklistDef, projectId: string, projectName: string): DeptCheckMeta {
  return {
    v: 1,
    kind: DEPT_CHECK_KIND,
    def_key: def.key,
    project_id: projectId,
    header: { projectName, owner: "", difficulty: "" },
    check_dates: { self: "", cross: "" },
    signatures: { self: { name: "", date: "" }, cross: { name: "", date: "" } },
    revise_reason: "",
    result: "",
    log: [],
  }
}
