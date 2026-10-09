import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  clearDeckTemplate,
  decodeTemplateBytes,
  encodeTemplateBytes,
  extractDeckTheme,
  loadDeckTemplate,
  MAX_TEMPLATE_BYTES,
  saveDeckTemplate,
  shade,
  type StoredDeckTemplate,
  type ThemeStorage,
} from './deckTheme'

const THEME_XML =
  '<a:theme><a:themeElements><a:clrScheme name="Company">' +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:accent1><a:srgbClr val="0e9f8a"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="16324F"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="FFB100"/></a:accent3>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Company"><a:majorFont><a:latin typeface="Source Han Sans CN Bold"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="+mn-lt"/><a:cs typeface="Thai Font"/></a:minorFont></a:fontScheme>' +
  '</a:themeElements></a:theme>'

function fakePptx(entries: Record<string, string>): Uint8Array {
  const z: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(entries)) z[k] = strToU8(v)
  return zipSync(z)
}

function fakeStorage(): ThemeStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('extractDeckTheme（R169 模板主题提取）', () => {
  it('合法 pptx：提取 accent 色（大写归一）与大字体，小字体 +mn-lt 占位符被丢弃', () => {
    const t = extractDeckTheme(fakePptx({ 'ppt/theme/theme1.xml': THEME_XML }))
    expect(t).not.toBeNull()
    expect(t!.accents).toEqual(['0E9F8A', '16324F', 'FFB100'])
    expect(t!.headFont).toBe('Source Han Sans CN Bold')
    expect(t!.bodyFont).toBeUndefined()
  })

  it('非 zip 字节流 → null（诚实降级，不抛）', () => {
    expect(extractDeckTheme(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
  })

  it('zip 内无 theme1.xml → null', () => {
    expect(extractDeckTheme(fakePptx({ 'ppt/slides/slide1.xml': '<x/>' }))).toBeNull()
  })

  it('accent 全是非法 srgbClr（如 themeSlots）→ null', () => {
    const xml = '<a:clrScheme><a:accent1><a:sysClr val="w3"/></a:accent1></a:clrScheme>'
    expect(extractDeckTheme(fakePptx({ 'ppt/theme/theme1.xml': xml }))).toBeNull()
  })
})

describe('shade 派生色（R169）', () => {
  it('压暗/提亮逐通道钳位正确', () => {
    expect(shade('FFFFFF', 0.5)).toBe('808080')
    expect(shade('2E74B5', 0.6)).toBe('1C466D')
    expect(shade('808080', 2)).toBe('FFFFFF')
  })

  it('非 hex 输入原样返回', () => {
    expect(shade('ZZZZZZ', 0.5)).toBe('ZZZZZZ')
  })
})

describe('模板持久化（R169，注入假 Storage）', () => {
  const tpl: StoredDeckTemplate = { name: '公司模板.pptx', savedAt: 1, theme: { accents: ['0E9F8A'] } }

  it('save→load 往返一致；clear 后为 null', () => {
    const st = fakeStorage()
    saveDeckTemplate(tpl, st)
    expect(loadDeckTemplate(st)).toEqual(tpl)
    clearDeckTemplate(st)
    expect(loadDeckTemplate(st)).toBeNull()
  })

  it('空 Storage → null', () => {
    expect(loadDeckTemplate(fakeStorage())).toBeNull()
  })

  it('损坏 JSON / accents 非法 → 一律视为无模板', () => {
    const st = fakeStorage()
    st.setItem('zx_ppt_deck_template_v1', '{not json')
    expect(loadDeckTemplate(st)).toBeNull()
    st.setItem('zx_ppt_deck_template_v1', JSON.stringify({ name: 'x', savedAt: 1, theme: { accents: ['QQQQQQ'] } }))
    expect(loadDeckTemplate(st)).toBeNull()
  })
})

describe('模板字节 base64（R189 母版级保真）', () => {
  it('任意字节序列 encode→decode 逐字节还原（含长度 1/2 尾块与全字节值）', () => {
    for (const len of [1, 2, 3, 4, 5, 6, 7, 255, 256]) {
      const bytes = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37) % 256))
      const enc = encodeTemplateBytes(bytes)
      expect(enc).not.toBeNull()
      const dec = decodeTemplateBytes({ name: 't', savedAt: 0, theme: { accents: ['0E9F8A'] }, bytesB64: enc! })
      expect(dec).not.toBeNull()
      expect(Array.from(dec!)).toEqual(Array.from(bytes))
    }
  })

  it('空字节 / 超 MAX_TEMPLATE_BYTES → encode 返回 null（调用方降级仅套主题）', () => {
    expect(encodeTemplateBytes(new Uint8Array(0))).toBeNull()
    expect(encodeTemplateBytes(new Uint8Array(MAX_TEMPLATE_BYTES + 1))).toBeNull()
  })

  it('脏 bytesB64（非法字符/长度不整除 4/中段填充/缺失）→ decode 返回 null', () => {
    const t = (bytesB64?: string): StoredDeckTemplate => ({
      name: 't', savedAt: 0, theme: { accents: ['0E9F8A'] }, bytesB64,
    })
    expect(decodeTemplateBytes(t('AB!CD=='))).toBeNull()
    expect(decodeTemplateBytes(t('ABC'))).toBeNull()
    expect(decodeTemplateBytes(t('AAAA===='))).toBeNull()
    expect(decodeTemplateBytes(t(''))).toBeNull()
    expect(decodeTemplateBytes(null)).toBeNull()
    expect(decodeTemplateBytes(t())).toBeNull()
  })

  it('bytesB64 随模板 JSON 同一存储键 save→load→clear 往返（零新增 collection）', () => {
    const st = fakeStorage()
    const bytes = new Uint8Array([0, 128, 255, 61, 61])
    const enc = encodeTemplateBytes(bytes)!
    const tpl: StoredDeckTemplate = { name: '公司模板.pptx', savedAt: 1, theme: { accents: ['0E9F8A'] }, bytesB64: enc }
    saveDeckTemplate(tpl, st)
    const back = loadDeckTemplate(st)
    expect(back).not.toBeNull()
    expect(back!.bytesB64).toBe(enc)
    const dec = decodeTemplateBytes(back)
    expect(dec).not.toBeNull()
    expect(Array.from(dec!)).toEqual(Array.from(bytes))
    clearDeckTemplate(st)
    expect(loadDeckTemplate(st)).toBeNull()
  })
})
