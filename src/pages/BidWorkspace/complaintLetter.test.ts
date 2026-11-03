import { describe, it, expect } from "vitest"
import {
  buildComplaintLetter,
  validateComplaintFields,
  complaintReplyDeadline7WorkingDays,
  complaintFilingDeadline15WorkingDays,
  REPLY_STATUS_LABEL,
  type ComplaintLetterInput,
} from "./complaintLetter"

const FULL: ComplaintLetterInput = {
  supplier: { name: '某某科技有限公司', address: '北京市海淀区XX路1号', postalCode: '100000', contactName: '张三', contactPhone: '010-12345678' },
  project: { projectName: '建阳区总医院设备及信息化建设', projectNumber: '[350703]FJXW[GK]2026009', purchaserName: '南平市建阳区卫生健康局' },
  challenge: { challengeNumber: 'ZY-ZY-2026001', challengeDate: '2026年10月9日', replyStatus: 'unsatisfied', replyDate: '2026年10月18日' },
  items: [{ topic: '技术参数指向特定品牌', request: '撤销中标结果并重新评审', facts: '第XX页要求参数完全匹配XX品牌XX型号', legalBasis: '《政府采购法实施条例》第二十条第（三）项', evidence: '采购文件第32页截图 + 质疑答复函（编号ZY-HF-2026001）' }],
  date: '2026年10月21日',
}

describe('buildComplaintLetter', () => {
  it('五段式标题齐全', () => {
    const out = buildComplaintLetter(FULL)
    expect(out).toContain('投  诉  书')
    expect(out).toContain('一、投诉人信息')
    expect(out).toContain('二、项目信息')
    expect(out).toContain('三、质疑情况')
    expect(out).toContain('四、投诉事项')
    expect(out).toContain('五、日期与签章')
  })
  it('包含质疑函编号与答复情况（前置要素）', () => {
    const out = buildComplaintLetter(FULL)
    expect(out).toContain('ZY-ZY-2026001')
    expect(out).toContain(REPLY_STATUS_LABEL.unsatisfied)
  })
  it('逐条附证据材料', () => {
    const out = buildComplaintLetter(FULL)
    expect(out).toContain('证据材料：采购文件第32页截图')
  })
  it('多条投诉事项逐条编号', () => {
    const multi: ComplaintLetterInput = { ...FULL, items: [...FULL.items, { topic: '付款条件苛刻', request: '修改付款节点', facts: '预付款为0%', legalBasis: '实施条例第二十条第（二）项', evidence: '采购文件第40页' }] }
    const out = buildComplaintLetter(multi)
    expect(out).toContain('投诉事项1')
    expect(out).toContain('投诉事项2')
  })
})

describe('complaint deadlines', () => {
  it('答复期满 = 质疑提出 + 7 工作日（跳周末）', () => {
    expect(complaintReplyDeadline7WorkingDays(new Date(2026, 9, 9))).toBe('2026-10-20')
  })
  it('投诉截止 = 答复期满 + 15 工作日', () => {
    expect(complaintFilingDeadline15WorkingDays(new Date(2026, 9, 20))).toBe('2026-11-10')
  })
})

describe('validateComplaintFields', () => {
  it('完整输入无缺失', () => {
    expect(validateComplaintFields(FULL)).toEqual([])
  })
  it('缺质疑函编号触发前置校验', () => {
    const bad: ComplaintLetterInput = { ...FULL, challenge: { ...FULL.challenge, challengeNumber: '' } }
    expect(validateComplaintFields(bad)).toContain('质疑函编号（投诉前置）')
  })
  it('缺证据材料报缺失', () => {
    const bad: ComplaintLetterInput = { ...FULL, items: [{ ...FULL.items[0], evidence: '' }] }
    expect(validateComplaintFields(bad)).toContain('投诉事项1（证据材料）')
  })
  it('空 items 报缺失', () => {
    expect(validateComplaintFields({ ...FULL, items: [] })).toContain('投诉事项')
  })
})
