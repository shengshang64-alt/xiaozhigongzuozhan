// ---------------------------------------------------------------------------
// 第3轮 G6：投诉书六要素生成器（模板为主 + AI 兜底增强）
// 依据《政府采购质疑和投诉办法》（财政部令第 94 号）第十八条：
//   投诉书与质疑函同构六要素，但额外须写明「质疑函编号与质疑答复情况」（投诉以质疑为前置程序），
//   并逐条附证据材料（采购文件·沟通记录·截图·质疑函·质疑答复函）并标注证据来源。
// 时限：投诉须在质疑答复期满后 15 个工作日内提起（答复期为采购人收到质疑后 7 个工作日）。
// 本模块以纯模板 + 结构化字段输出正式投诉书文本，调用方（面板）负责收集字段、AI 润色事实/法律/证据。
// ---------------------------------------------------------------------------
import type { ChallengeSupplier, ChallengeProject } from './challengeLetter'

/** 质疑答复情况——投诉前置程序的两种法定可诉情形 */
export type ComplaintReplyStatus = 'no_reply' | 'unsatisfied'

/** 质疑情况（投诉前置要素） */
export interface ComplaintChallengeContext {
  challengeNumber: string      // 质疑函编号（必填——投诉以质疑为前置）
  challengeDate: string        // 质疑提出日期
  replyStatus: ComplaintReplyStatus // 未收到答复 / 已答复但不满意
  replyDate?: string           // 质疑答复日期（如已答复）
}

/** 单个投诉事项（六要素之四——含逐条证据材料，可多条） */
export interface ComplaintItem {
  topic: string       // 投诉事项——具体明确的投诉内容
  request: string     // 请求——撤销中标/重新评审等诉求
  facts: string       // 事实依据
  legalBasis: string  // 法律依据
  evidence: string    // 证据材料（附来源标注）
}

export interface ComplaintLetterInput {
  supplier: ChallengeSupplier
  project: ChallengeProject
  challenge: ComplaintChallengeContext
  items: ComplaintItem[]
  date: string  // 提出日期（YYYY年MM月DD日）
}

/** 质疑答复情况 → 正式文书措辞 */
export const REPLY_STATUS_LABEL: Record<ComplaintReplyStatus, string> = {
  no_reply: '采购人/采购代理机构未在法定期限内作出答复',
  unsatisfied: '对采购人/采购代理机构的质疑答复不满意',
}

/** 证据来源标注提示（第十八条要求逐条附证据并标注来源） */
export const EVIDENCE_SOURCE_HINT = '证据来源标注示例：采购文件第X页 / 沟通记录（微信·邮件 2026-XX-XX）/ 网页截图（含 URL 与时间）/ 质疑函（编号XX）/ 质疑答复函（编号XX）'

/** 顺延 n 个工作日（跳过周末，不处理法定假日），返回 YYYY-MM-DD */
function addWorkingDays(start: Date, n: number): string {
  let remaining = n
  const d = new Date(start)
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

/** 采购人质疑答复期满日（质疑提出后顺延 7 个工作日） */
export function complaintReplyDeadline7WorkingDays(challengeDate: Date): string {
  return addWorkingDays(challengeDate, 7)
}

/** 投诉提起截止日（答复期满后顺延 15 个工作日） */
export function complaintFilingDeadline15WorkingDays(replyDeadline: Date): string {
  return addWorkingDays(replyDeadline, 15)
}

/** 六要素正式投诉书文本（纯模板输出，零 AI） */
export function buildComplaintLetter(input: ComplaintLetterInput): string {
  const { supplier, project, challenge, items, date } = input
  const lotLine = project.lotNumber ? `包号：${project.lotNumber}` : ''
  const buyerLine = project.purchaserName ? `被投诉人/采购人：${project.purchaserName}` : ''
  const replyLine = challenge.replyStatus === 'unsatisfied' && challenge.replyDate
    ? `质疑答复日期：${challenge.replyDate}`
    : ''

  const lines: string[] = [
    '投  诉  书',
    '',
    '一、投诉人信息',
    `投诉人（供应商）名称：${supplier.name}`,
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
    '三、质疑情况（投诉前置程序）',
    `质疑函编号：${challenge.challengeNumber}`,
    `质疑提出日期：${challenge.challengeDate}`,
    `质疑答复情况：${REPLY_STATUS_LABEL[challenge.replyStatus]}`,
    ...(replyLine ? [replyLine] : []),
    '',
    '四、投诉事项、事实依据、法律依据、请求及证据材料',
  ]

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    lines.push(
      `投诉事项${i + 1}：${it.topic}`,
      `事实依据：${it.facts}`,
      `法律依据：${it.legalBasis}`,
      `请    求：${it.request}`,
      `证据材料：${it.evidence}`,
    )
    if (i < items.length - 1) lines.push('')
  }

  lines.push(
    '',
    '五、日期与签章',
    '',
    `提出日期：${date}`,
    '',
    '法定代表人或授权代表（签字）：____________________',
    '投诉人（盖章）：____________________',
    '',
    `注：${EVIDENCE_SOURCE_HINT}。`,
    '    依据《政府采购质疑和投诉办法》第十八条，投诉须以质疑为前置程序；投诉人应在质疑答复期满后 15 个工作日内向同级政府采购监督管理部门提起投诉。',
    '    本投诉书一式两份，附相关证据材料清单及复印件。',
  )

  return lines.join('\n')
}

/** 校验六要素是否完整（含质疑函编号前置与逐条证据），返回缺失项列表（用于 UI 提示） */
export function validateComplaintFields(input: ComplaintLetterInput): string[] {
  const missing: string[] = []
  const { supplier, project, challenge, items, date } = input
  if (!supplier.name.trim()) missing.push('投诉人名称')
  if (!supplier.address.trim()) missing.push('注册地址')
  if (!supplier.contactName.trim()) missing.push('联系人')
  if (!supplier.contactPhone.trim()) missing.push('联系电话')
  if (!project.projectName.trim()) missing.push('项目名称')
  if (!project.projectNumber.trim()) missing.push('项目编号')
  if (!challenge.challengeNumber.trim()) missing.push('质疑函编号（投诉前置）')
  if (!challenge.challengeDate.trim()) missing.push('质疑提出日期')
  if (!items.length) missing.push('投诉事项')
  for (let i = 0; i < items.length; i++) {
    if (!items[i].topic.trim()) missing.push(`投诉事项${i + 1}（内容）`)
    if (!items[i].request.trim()) missing.push(`投诉事项${i + 1}（请求）`)
    if (!items[i].facts.trim()) missing.push(`投诉事项${i + 1}（事实依据）`)
    if (!items[i].legalBasis.trim()) missing.push(`投诉事项${i + 1}（法律依据）`)
    if (!items[i].evidence.trim()) missing.push(`投诉事项${i + 1}（证据材料）`)
  }
  if (!date.trim()) missing.push('提出日期')
  return missing
}
