// ---------------------------------------------------------------------------
// 界面示意图的「真实性 + 隐私打码」口径（纯函数、零 AI、零 DOM）
//
// 需求（用户 2026-10-15）：软件类投标的界面截图一律用 HTML5+CSS3 做静态界面，并且必须满足：
//  ① 患者姓名 / 手机 / 身份证号 → **打码**（马赛克：看得见"这里有一串信息"，但不是明文）；
//  ② 公司名称 / LOGO / 地址 → **不出现**（截图里冒出第三方公司信息既不合规也穿帮）；
//  ③ 医院名称、医生姓名 → **打码**（同上，打码而非留白——留白看着像半成品，马赛克才像真实脱敏截图）；
//  ④ 左侧功能栏必须贴合系统实际：**同屏模块必须属于同一角色/场景分组**
//     （门诊医生工作站 与 住院护士工作站 放同一屏，评审一眼就看出是假界面）；
//  ⑤ 系统名/模块名要与招标文件要求一致（取解析报告与本章节要求，不凭空编）。
//
// 本模块是上述口径的唯一真源：渲染层（HTML/CSS 模板）与提示词构建都从它取规则，
// 避免"提示词说打码、渲染层没打"这类两处漂移。
// ---------------------------------------------------------------------------

/** 打码方式：mosaic=马赛克/模糊（保留"有内容"的观感）；omit=整字段不出现 */
export type MaskKind = "mosaic" | "omit"

/**
 * 字段级处置表。key 为字段语义（提示词与渲染层共用同一批 key）。
 * 判据取向：**能识别到具体个人/机构的明文一律 mosaic 或 omit，绝不留空白**。
 */
export const MASK_POLICY: Record<string, MaskKind> = {
  patient_name: "mosaic",
  patient_phone: "mosaic",
  patient_id_card: "mosaic",
  patient_address: "mosaic",
  doctor_name: "mosaic",
  nurse_name: "mosaic",
  hospital_name: "mosaic",
  // 公司与商业标识：不出现在截图里（含 LOGO、办公地址、400 电话）
  company_name: "omit",
  company_logo: "omit",
  company_address: "omit",
  company_phone: "omit",
}

/** 需要打码的字段（渲染层据此成马赛克块） */
export function maskedFields(): string[] {
  return Object.keys(MASK_POLICY).filter((k) => MASK_POLICY[k] === "mosaic")
}

/** 必须整字段剔除的字段（渲染层绝不能画出来） */
export function omittedFields(): string[] {
  return Object.keys(MASK_POLICY).filter((k) => MASK_POLICY[k] === "omit")
}

/**
 * 马赛克样式口径（CSS 片段，供 HTML5+CSS3 模板直接用）：
 * 模糊 + 细网格叠加，宽度按原文长度给足——**打码不等于留白**，也不能压成一个小方块，
 * 否则一眼就看得出是"故意挖掉"，反而不像真实脱敏截图。
 */
export function mosaicCss(seed: number): string {
  const px = 3 + (Math.abs(Math.floor(seed)) % 3) // 3~5px 网格，随字段错开，避免整屏同纹
  return [
    "filter: blur(2.5px)",
    "background-repeat: repeat",
    `background-size: ${px}px ${px}px`,
    "background-image: repeating-linear-gradient(45deg, rgba(120,120,120,.55) 0 2px, rgba(180,180,180,.55) 2px 4px)",
    "color: transparent",
    "user-select: none",
  ].join("; ")
}

// ---------------------------------------------------------------------------
// 模块分组与「同屏可辨识性」
//
// 口径：同一屏（一张界面示意图的左侧功能栏）只允许出现**同一分组**的模块。
// 这条规则天然覆盖用户举的例子：门诊医生工作站属"门诊场景"、住院护士工作站属"住院场景"，
// 分属两组 → 不会同屏；而"门诊医生工作站 + 门诊收费 + 门诊药房"同屏是真实系统的样子。
// ---------------------------------------------------------------------------

export type ModuleGroup =
  | "outpatient" // 门诊场景
  | "inpatient" // 住院场景
  | "medtech" // 医技（检验/检查/心电/病理）
  | "pharmacy" // 药事
  | "management" // 管理（病案/医务/报表/系统管理）
  | "platform" // 平台与集成（集成平台/主数据/门户）
  | "emr" // 电子病历与质控
  | "internet" // 互联网医院/患者服务

/** 模块 → 分组（词表按医院信息化通行模块划分；新增模块必须归组，不得留空） */
export const MODULE_GROUP: Record<string, ModuleGroup> = {
  门诊挂号: "outpatient",
  门诊分诊: "outpatient",
  门诊医生工作站: "outpatient",
  门诊护士站: "outpatient",
  门诊收费: "outpatient",
  住院登记: "inpatient",
  住院医生工作站: "inpatient",
  住院护士工作站: "inpatient",
  医嘱执行: "inpatient",
  住院结算: "inpatient",
  床位管理: "inpatient",
  检验管理: "medtech",
  检查管理: "medtech",
  心电管理: "medtech",
  病理管理: "medtech",
  药库管理: "pharmacy",
  门诊药房: "pharmacy",
  住院药房: "pharmacy",
  处方审核: "pharmacy",
  病案管理: "management",
  医务管理: "management",
  报表中心: "management",
  系统管理: "management",
  用户与权限: "management",
  数据上报: "management",
  集成平台: "platform",
  主数据管理: "platform",
  统一门户: "platform",
  消息中心: "platform",
  电子病历: "emr",
  病历质控: "emr",
  病历检索: "emr",
  互联网诊疗: "internet",
  患者服务: "internet",
  预约挂号: "internet",
}

/** 取模块分组（词表未收录返回 null，由调用方按"不确定就不上屏"处理） */
export function groupOf(moduleName: string): ModuleGroup | null {
  const name = String(moduleName ?? "").trim()
  if (!name) return null
  if (MODULE_GROUP[name]) return MODULE_GROUP[name]
  // 容错：允许"门诊医生工作站（医师）"这类带后缀的写法按前缀命中
  const hit = Object.keys(MODULE_GROUP).find((k) => name.startsWith(k) || k.startsWith(name))
  return hit ? MODULE_GROUP[hit] : null
}

/**
 * 同屏可辨识性过滤：左侧功能栏只保留与"主模块"同组的模块。
 * - 主模块缺省取第一项；未收录分组的模块一律剔除（不确定的宁可不画，画错更假）；
 * - 过滤后不足 minKeep 项时，返回同组兜底模块补齐（保持真实系统的"功能成组"观感）；
 * - 返回 { kept, dropped, reason }：dropped 供提示词/日志解释"为什么没画这一项"。
 */
export function sanitizeDemoSidebar(
  groups: string[],
  opts?: { anchor?: string; minKeep?: number; fillOrder?: string[] },
): { kept: string[]; dropped: string[]; reason: string } {
  const list = (groups ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  if (!list.length) return { kept: [], dropped: [], reason: "功能栏为空" }
  // 锚点 = 显式指定 ?? 第一个**可识别分组**的模块：功能栏里偶有未收录的新模块排在最前，
  // 若死取第一项会把整屏判成"不可识别"而全部不画（真实系统里那只是个别新模块，不该拖垮整图）。
  const anchor = String(opts?.anchor ?? "").trim() || list.find((m) => groupOf(m)) || ""
  const anchorGroup = groupOf(anchor)
  if (!anchorGroup) {
    return { kept: [], dropped: list, reason: "功能栏里没有任何可识别分组的模块，按「不确定不上屏」处理" }
  }
  const kept: string[] = []
  const dropped: string[] = []
  for (const m of list) {
    if (groupOf(m) === anchorGroup) kept.push(m)
    else dropped.push(m)
  }
  const minKeep = Math.max(1, Math.min(opts?.minKeep ?? 4, 8))
  if (kept.length < minKeep) {
    const order = opts?.fillOrder ?? Object.keys(MODULE_GROUP).filter((k) => MODULE_GROUP[k] === anchorGroup)
    for (const cand of order) {
      if (kept.length >= minKeep) break
      if (!kept.includes(cand)) kept.push(cand)
    }
  }
  return {
    kept: kept.slice(0, 8),
    dropped,
    reason: dropped.length ? `剔除跨场景模块（与「${anchor}」不同组）：${dropped.join("、")}` : "同一场景分组，无需调整",
  }
}
