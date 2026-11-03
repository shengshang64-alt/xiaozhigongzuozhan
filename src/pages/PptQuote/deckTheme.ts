// ---------------------------------------------------------------------------
// R169 公司模板主题令牌：用户上传 .pptx/.potx → 浏览器内解包提取 OOXML 主题
// （accent1 主色 + major/minor 字体），导出 PPT 时套用到版式配色与默认字体。
// 「模板驱动导出」第一步：主题级套用（不做母版/版式级保真，属后续评估项）。
// 纯模块：不依赖 React/DOM，假 Storage 注入即可 node 下单测。
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from 'fflate'

export interface DeckThemeTokens {
  /** OOXML 六位 hex（无 #），至多 accent1..accent6 */
  accents: string[]
  /** 标题字体（theme major latin typeface） */
  headFont?: string
  /** 正文字体（theme minor latin typeface） */
  bodyFont?: string
}

const HEX6_RE = /^[0-9A-Fa-f]{6}$/

function cleanFont(raw: string): string | undefined {
  const t = raw.trim()
  // OOXML 主题里的 +mj-lt/+mn-lt 是「跟随主题」占位符，不是真实字体名
  if (!t || t.startsWith('+')) return undefined
  return t.slice(0, 64)
}

/** 从 .pptx/.potx 二进制提取主题令牌；无 ppt/theme/theme1.xml 或无合法色返回 null（诚实降级） */
export function extractDeckTheme(buf: Uint8Array): DeckThemeTokens | null {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buf)
  } catch {
    return null
  }
  let themeXml: string | null = null
  for (const name of Object.keys(entries)) {
    if (name.startsWith('ppt/theme/') && name.endsWith('theme1.xml')) {
      themeXml = strFromU8(entries[name])
      break
    }
  }
  if (!themeXml) return null
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(themeXml)?.[0]
  if (!scheme) return null
  const accents: string[] = []
  for (const m of scheme.matchAll(/<a:accent(\d)>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"[\s\S]*?<\/a:accent\d>/g)) {
    accents.push(m[2].toUpperCase())
  }
  if (!accents.length) return null
  const headFont = cleanFont(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(themeXml)?.[1] ?? '')
  const bodyFont = cleanFont(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(themeXml)?.[1] ?? '')
  return { accents, headFont, bodyFont }
}

/** 六位 hex 明度缩放（r>1 提亮、r<1 压暗），逐通道四舍五入并钳到 [0,255] */
export function shade(hex: string, r: number): string {
  const h = hex.replace(/^#/, '')
  if (!HEX6_RE.test(h)) return hex
  const n = parseInt(h, 16)
  const ch = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * r))),
  )
  return ch.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export interface StoredDeckTemplate {
  name: string
  savedAt: number
  theme: DeckThemeTokens
  /** R189（r169 切片二）：模板原始字节 base64——母版级保真导出以模板为底包；
   *  超容量/写失败不存，导出自动降级为仅套主题令牌（现通道） */
  bytesB64?: string
}

/** 模板字节存储上限（base64 后约 4/3×；3MB 保护 localStorage ~5MB 预算） */
export const MAX_TEMPLATE_BYTES = 3 * 1024 * 1024

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const TEMPLATE_KEY = 'zx_ppt_deck_template_v1'

function storageOrDefault(st?: ThemeStorage): ThemeStorage | null {
  if (st) return st
  try {
    return globalThis.localStorage as ThemeStorage
  } catch {
    return null
  }
}

export function saveDeckTemplate(t: StoredDeckTemplate, st?: ThemeStorage): void {
  const s = storageOrDefault(st)
  if (s) s.setItem(TEMPLATE_KEY, JSON.stringify(t))
}

/** 读回并校验：JSON 损坏 / accents 非法一律视为无模板（宁可回落内置版式，不让脏数据进导出） */
export function loadDeckTemplate(st?: ThemeStorage): StoredDeckTemplate | null {
  const s = storageOrDefault(st)
  if (!s) return null
  try {
    const raw = s.getItem(TEMPLATE_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as StoredDeckTemplate
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.theme?.accents) ||
      !t.theme.accents.every((c) => typeof c === 'string' && HEX6_RE.test(c))) {
      return null
    }
    return t
  } catch {
    return null
  }
}

export function clearDeckTemplate(st?: ThemeStorage): void {
  const s = storageOrDefault(st)
  if (s) s.removeItem(TEMPLATE_KEY)
}

// ---------------------------------------------------------------------------
// 内置主题预设（2026-10-30，借鉴 Gamma / iSlide「同稿换风格」）
//
// 场景：同一份内容要投给不同客户/不同场合——给院长看要稳重深藏青，给技术负责人看要
// 清爽科技蓝。以前只能重新生成整册（时间长、内容还会变），现在选个预设直接重导即可。
//
// 取值依据：docs/architecture-ppt-playbook.md 的医疗售前视觉基调
// （深藏青主色 + 墨绿/赭石/紫灰/中灰辅色，每页 ≤4 色，一色一义）。
// accents 顺序与 OOXML accent1..6 对齐，导出层按 accent 索引取色，无需改渲染逻辑。
// ---------------------------------------------------------------------------
export interface DeckThemePreset {
  key: string
  /** 展示名（中文，直接进下拉框） */
  label: string
  /** 一句话说明适用场合 */
  desc: string
  theme: DeckThemeTokens
}

export const DECK_THEME_PRESETS: DeckThemePreset[] = [
  {
    key: "navy",
    label: "深藏青（默认）",
    desc: "稳重专业，适合院领导汇报、正式评审",
    theme: {
      accents: ["1B3A5C", "4A6FA5", "2D6E6E", "8B6F47", "5B5B7A", "707070"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    key: "tech-blue",
    label: "科技蓝",
    desc: "清爽锐利，适合技术方案、架构评审",
    theme: {
      accents: ["1E40AF", "2563EB", "0EA5E9", "0D9488", "6D28D9", "475569"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    key: "medical-green",
    label: "医疗绿",
    desc: "温和可信，适合临床/护理/患者服务类主题",
    theme: {
      accents: ["0F766E", "059669", "14B8A6", "2D6E6E", "65A30D", "64748B"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    key: "warm-earth",
    label: "赭石暖调",
    desc: "沉稳厚重，适合运营管理、成本绩效类主题",
    theme: {
      accents: ["8B4513", "B45309", "A16207", "9A3412", "78350F", "57534E"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    key: "violet",
    label: "紫灰学术",
    desc: "克制理性，适合科研申报、方法论讲解",
    theme: {
      accents: ["5B21B6", "6D28D9", "7C3AED", "4C1D95", "6366F1", "52525B"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
]

/** 按 key 取预设；未知 key 返回 null（调用方保持原有模板主题） */
export function findThemePreset(key: string | null | undefined): DeckThemePreset | null {
  if (!key) return null
  return DECK_THEME_PRESETS.find((p) => p.key === key) ?? null
}

// ---------------------- R189 模板字节 base64（纯实现，node/浏览器通用） ----------------------
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** bytes → base64；空字节或超过 MAX_TEMPLATE_BYTES 返回 null（调用方降级仅套主题） */
export function encodeTemplateBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_BYTES) return null
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1
    out += B64_CHARS[b0 >> 2]
    out += B64_CHARS[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
    out += b1 < 0 ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
    out += b2 < 0 ? '=' : B64_CHARS[b2 & 63]
  }
  return out
}

/** base64 → bytes；脏数据（非法字符/长度不整除 4/中段填充）一律返回 null——宁可不开保真也不喂给引擎 */
export function decodeTemplateBytes(t: StoredDeckTemplate | null | undefined): Uint8Array | null {
  const s = t?.bytesB64
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let p = 0
  let bits = 0
  let acc = 0
  for (const ch of clean) {
    const v = B64_CHARS.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[p++] = (acc >> bits) & 0xff
    }
  }
  return out.slice(0, p)
}
