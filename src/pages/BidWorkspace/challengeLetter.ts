// ---------------------------------------------------------------------------
// 第3轮 G4：质疑函六要素生成器（模板为主 + AI 兜底增强）
// 依据《政府采购质疑和投诉办法》（财政部令第 94 号）第十二条：
//   质疑函须包含——供应商信息 / 项目信息 / 质疑事项与请求 / 事实依据 / 法律依据 / 日期与签章。
// 本模块以纯模板 + 结构化字段输出正式质疑函文本，调用方（hook）负责收集字段、AI 润色事实/法律。
// ---------------------------------------------------------------------------

/** 供应商基本信息（六要素之一） */
export interface ChallengeSupplier {
  name: string           // 全称
  address: string        // 注册地址
  postalCode: string     // 邮编
  contactName: string    // 有效联系人
  contactPhone: string   // 联系电话
}

/** 项目信息（六要素之二） */
export interface ChallengeProject {
  projectName: string    // 项目名称
  projectNumber: string  // 项目编号
  lotNumber?: string     // 包号（如有）
  purchaserName?: string // 采购人/代理机构名称
}

/** 单个质疑事项（六要素之三、四、五组合，可多条） */
export interface ChallengeItem {
  topic: string        // 质疑事项——具体明确的质疑内容
  request: string      // 请求——修改采购文件/重新评审等诉求
  facts: string        // 事实依据——客观描述支撑事实
  legalBasis: string   // 法律依据——引用条款
}

export interface ChallengeLetterInput {
  supplier: ChallengeSupplier
  project: ChallengeProject
  items: ChallengeItem[]
  date: string  // 提出日期（YYYY年MM月DD日）
}

/** 常用法律依据模板（按八大禁止情形/红线归类），AI 兜底时推荐选用 */
export const STANDARD_LEGAL_REFS: Record<string, string> = {
  scale: '《政府采购法实施条例》第二十条第（二）项——设定的资格、技术、商务条件与项目具体特点和实际需要不相适应或与合同履行无关',
  region: '《政府采购法实施条例》第二十条第（四）项——以特定行政区域或特定行业的业绩、奖项作为加分或中标条件',
  brand: '《政府采购法实施条例》第二十条第（三）项——采购需求中的技术、服务等要求指向特定供应商、特定产品',
  authorize: '《政府采购法实施条例》第二十条第（七）项——要求供应商获得特定授权或具有特定资质（超出项目实际需要）',
  ownership: '《政府采购法实施条例》第二十条第（二）项——知识产权归属条款超出合同履行需要',
  copyright: '《政府采购法》第二十二条、《政府采购法实施条例》第二十条第（二）项——版权归属超出合同约定范围对供应商施加不合理义务',
  sourcecode: '《政府采购法实施条例》第二十条第（二）项——要求交付核心源代码超出项目合同履行实际需要',
  scope: '《政府采购法实施条例》第二十条第（二）项——实施范围边界模糊对供应商施加不确定的额外义务',
  payment: '《政府采购法实施条例》第二十条第（二）项——付款条件不合理（无首款或首款比例低于 30%）挤占供应商现金流',
  maintenance: '《政府采购法实施条例》第二十条第（二）项——年维护费率低于行业正常水平（8%），权责严重不对等',
  undisclosed_substantive: '《政府采购法实施条例》第十五条——实质性要求应当以醒目方式标明；应标明而未标明属合规瑕疵，可作为质疑依据',
  general: '《政府采购法》第二十二条、《政府采购法实施条例》第二十条、《政府采购质疑和投诉办法》（财政部令第94号）第十二条',
}

/**
 * 计算质疑截止时间（7 个工作日）：从 knownDate 起顺延 7 个工作日（跳过周末，不处理法定假日）。
 * 返回 YYYY-MM-DD 格式截止日，供 UI 提示"某月某日前须提交质疑函"。
 */
export function challengeDeadline7WorkingDays(knownDate: Date): string {
  let remaining = 7
  const d = new Date(knownDate)
  while (remaining > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** 六要素正式质疑函文本（纯模板输出，零 AI） */
export function buildChallengeLetter(input: ChallengeLetterInput): string {
  const { supplier, project, items, date } = input
  const lotLine = project.lotNumber ? `包号：${project.lotNumber}` : ''
  const buyerLine = project.purchaserName ? `采购人/代理机构：${project.purchaserName}` : ''

  const lines: string[] = [
    '质  疑  函',
    '',
    '一、供应商信息',
    `供应商名称：${supplier.name}`,
    `注册地址：${supplier.address}`,
    `邮政编码：${supplier.postalCode}`,
    `联系人：${supplier.contactName}`,
    `联系电话：${supplier.contactPhone}`,
    '',
    '二、项目信息',
    `项目名称：${project.projectName}`,
    `项目编号：${project.projectNumber}`,
    ...(lotLine ? [lotLine] : []),
    ...(buyerLine ? [buyerLine] : []),
    '',
    '三、质疑事项、事实依据、法律依据及请求',
  ]

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    lines.push(
      `质疑事项${i + 1}：${it.topic}`,
      `事实依据：${it.facts}`,
      `法律依据：${it.legalBasis}`,
      `质 疑 请 求：${it.request}`,
    )
    if (i < items.length - 1) lines.push('')
  }

  lines.push(
    '',
    '四、日期与签章',
    '',
    `提出日期：${date}`,
    '',
    '法定代表人或授权代表（签字）：____________________',
    '投标人（盖章）：____________________',
    '',
    '注：本质疑函一式两份，一份提交采购人/采购代理机构，一份由供应商留存。',
    '    依据《政府采购质疑和投诉办法》第十二条，供应商应在知道或应知权益受损之日起 7 个工作日内提出质疑。',
  )

  return lines.join('\n')
}

/** 校验六要素是否完整，返回缺失项列表（用于 UI 提示） */
export function validateChallengeFields(input: ChallengeLetterInput): string[] {
  const missing: string[] = []
  const { supplier, project, items, date } = input
  if (!supplier.name.trim()) missing.push('供应商名称')
  if (!supplier.address.trim()) missing.push('注册地址')
  if (!supplier.contactName.trim()) missing.push('联系人')
  if (!supplier.contactPhone.trim()) missing.push('联系电话')
  if (!project.projectName.trim()) missing.push('项目名称')
  if (!project.projectNumber.trim()) missing.push('项目编号')
  if (!items.length) missing.push('质疑事项')
  for (let i = 0; i < items.length; i++) {
    if (!items[i].topic.trim()) missing.push(`质疑事项${i + 1}（内容）`)
    if (!items[i].request.trim()) missing.push(`质疑事项${i + 1}（请求）`)
    if (!items[i].facts.trim()) missing.push(`质疑事项${i + 1}（事实依据）`)
    if (!items[i].legalBasis.trim()) missing.push(`质疑事项${i + 1}（法律依据）`)
  }
  if (!date.trim()) missing.push('提出日期')
  return missing
}
