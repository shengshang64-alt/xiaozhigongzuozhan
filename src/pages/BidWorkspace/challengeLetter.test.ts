import { describe, it, expect } from "vitest"
import {
  buildChallengeLetter,
  validateChallengeFields,
  challengeDeadline7WorkingDays,
  STANDARD_LEGAL_REFS,
  type ChallengeLetterInput,
} from "./challengeLetter"

const FULL: ChallengeLetterInput = {
  supplier: { name: '某某科技有限公司', address: '北京市海淀区XX路1号', postalCode: '100000', contactName: '张三', contactPhone: '010-12345678' },
  project: { projectName: '建阳区总医院设备及信息化建设', projectNumber: '[350703]FJXW[GK]2026009', purchaserName: '南平市建阳区卫生健康局' },
  items: [{ topic: '技术参数指向特定品牌', request: '修改采购文件删除品牌指向性条款', facts: '第XX页要求参数完全匹配XX品牌XX型号', legalBasis: STANDARD_LEGAL_REFS.brand }],
  date: '2026年10月9日',
}

describe('buildChallengeLetter', () => {
  it('六要素齐全时输出包含所有部分标题', () => {
    const out = buildChallengeLetter(FULL)
    expect(out).toContain('质  疑  函')
    expect(out).toContain('一、供应商信息')
    expect(out).toContain('二、项目信息')
    expect(out).toContain('三、质疑事项')
    expect(out).toContain('四、日期与签章')
  })
  it('逐字引用供应商名称和项目编号', () => {
    const out = buildChallengeLetter(FULL)
    expect(out).toContain('某某科技有限公司')
    expect(out).toContain('[350703]FJXW[GK]2026009')
  })
  it('多条质疑事项逐条编号', () => {
    const multi = { ...FULL, items: [...FULL.items, { topic: '付款条件苛刻', request: '修改付款节点', facts: '预付款为0%', legalBasis: STANDARD_LEGAL_REFS.payment }] }
    const out = buildChallengeLetter(multi)
    expect(out).toContain('质疑事项1')
    expect(out).toContain('质疑事项2')
  })
  it('7 工作日截止计算——跳过周末', () => {
    const dl = challengeDeadline7WorkingDays(new Date(2026, 9, 9))
    expect(dl).toBe('2026-10-20')
  })
})

describe('validateChallengeFields', () => {
  it('完整输入无缺失', () => {
    expect(validateChallengeFields(FULL)).toEqual([])
  })
  it('缺供应商名和日期返回对应项', () => {
    const bad = { ...FULL, supplier: { ...FULL.supplier, name: '' }, date: '' }
    const m = validateChallengeFields(bad)
    expect(m).toContain('供应商名称')
    expect(m).toContain('提出日期')
  })
  it('空 items 报缺失', () => {
    expect(validateChallengeFields({ ...FULL, items: [] })).toContain('质疑事项')
  })
})

describe('STANDARD_LEGAL_REFS', () => {
  it('包含八大禁止情形和通用引用', () => {
    expect(STANDARD_LEGAL_REFS.scale).toContain('不相适应')
    expect(STANDARD_LEGAL_REFS.brand).toContain('特定供应商')
    expect(STANDARD_LEGAL_REFS.general).toContain('质疑和投诉办法')
  })
})
