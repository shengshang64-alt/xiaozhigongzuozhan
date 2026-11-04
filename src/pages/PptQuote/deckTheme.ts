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
    // 2026-11-04：实测公司**官方模板** att5-ppt-template.potx（PB「智业PPT模板」）后新增，默认首选。
    // accent 顺序刻意与官方模板对齐：accent1 = 官方 #4F81BD 钢蓝；
    // accent2..4 = 官方模板的 #C0504D/#9BBB59/#8064A2 换成真实方案稿高频的橙/绿/浅蓝
    // （官方原本那几个是 Office 默认调色板继承值，实际方案里并不用）。
    key: "zhiye",
    label: "智业官方（推荐）",
    desc: "公司官方模板配色：钢蓝 #4F81BD + 亮蓝 #0190DC，微软雅黑；与《智业PPT模板.potx》同源",
    theme: {
      accents: ["4F81BD", "0190DC", "F79646", "36AF47", "66CCED", "44546A"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    // 近年主力方案汇报稿的科技蓝基调（#346AFB/#3987FB 在真实稿里高频出现）
    key: "zhiye-tech",
    label: "智业科技蓝",
    desc: "近年方案汇报常用：主蓝 #346AFB + 青绿橙辅助；比官方模板更锐利",
    theme: {
      accents: ["346AFB", "099FA0", "F79646", "36AF47", "3987FB", "44546A"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
  },
  {
    key: "navy",
    label: "深藏青",
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

// ---------------------------------------------------------------------------
// 智业官方设计令牌（2026-11-04 实测提取，不是拍脑袋定的）
//
// 数据来源分两层，**以官方模板为准、真实方案稿为辅**：
//
//   【权威层】系统内置的公司官方模板 `att5-ppt-template.potx`（PB doc_templates「智业PPT模板」，
//   4 页样例 + 29 个版式，含「标题幻灯片 / 标题和内容 / 尾页」标准版式）：
//     主题 accent1 = #4F81BD（钢蓝），accent2..6 = #C0504D/#9BBB59/#8064A2/#4BACC6/#F79646
//     样例实际用色：#0190DC（亮蓝）、#66CCED（浅蓝）
//     字体：微软雅黑 Light（标题）+ 微软雅黑（正文）
//
//   【样本层】用户磁盘 9 份真实公司方案汇报/公司简介（蚌埠一附院 123 页 / 安医阜阳 115 页 /
//   无锡中医 109 页 / 公司简介 81 页 / 浅色模板 49 页 + 模板库 03/04/07/09）统计 srgbClr 引用频次：
//     #FF0000(201) #3987FB(143) #099FA0(78) #36AF47(62) #F79646(54) #44546A(51)
//     #4759FF(44) #3FAEFB(39) #346AFB(36) ... 字体：微软雅黑 4638 次（绝对主力）
//     每页图片 2.61 张 / 含图页 82% / 每页字数中位 156–234
//
// 结论：公司视觉是「蓝为主 + 青绿橙辅助」的双层体系——
//   官方模板偏钢蓝(#4F81BD/#0190DC/微软雅黑 Light)，近年实际方案稿偏科技蓝(#346AFB/#3987FB)。
//   两者都是"蓝"，所以统一按「官方模板主色 + 方案稿高频蓝」取并集，既安全又贴近真实产出。
// ---------------------------------------------------------------------------

/** 智业官方色板（官方模板优先，方案稿高频色补充） */
export const ZY_BRAND_COLORS = {
  /** 官方模板 accent1 钢蓝——最权威的主色 */
  officialBlue: "4F81BD",
  /** 官方样例实际用色：亮蓝（标题装饰/强调） */
  officialBright: "0190DC",
  /** 官方样例实际用色：浅蓝（大面积底/卡片） */
  officialLight: "66CCED",
  /** 近年真实方案高频蓝（#346AFB 36 次 / #3987FB 143 次 / #4759FF 44 次） */
  primary: "346AFB",
  primaryLight: "3987FB",
  /** 辅助：青 #099FA0（78 次）、绿 #36AF47（62 次）、橙 #F79646（54 次） */
  teal: "099FA0",
  green: "36AF47",
  orange: "F79646",
  /** 正文灰 #44546A（51 次）*/
  body: "44546A",
  /** 警示红：官方 accent2 #C0504D 与方案稿 #FF0000（201 次，用于废标/风险标注） */
  danger: "C0504D",
  dangerStrong: "FF0000",
} as const

/**
 * 智业官方字体。
 * 官方模板用「微软雅黑 Light」做标题；近年方案稿 99% 用「微软雅黑」。
 * 为保证在客户机器上一定能显示（Light 字重在部分环境缺失），标题降为「微软雅黑」，
 * 仅显式声明字重倾向——不写不存在的字体名，避免 PowerPoint 静默回落到宋体。
 */
export const ZY_BRAND_FONTS = {
  head: "微软雅黑",
  body: "微软雅黑",
} as const

/**
 * 字号阶梯（实测公司真实稿的引用频次，按 pt 从大到小）：
 *   14pt 3646 次（正文主力）｜12pt 2400 次（次要正文/图注）｜16pt 1081 次｜
 *   20pt 547 次｜18pt 402 次｜24pt 289 次｜28/32/36pt 用于小标题｜40-60pt 用于封面大字
 * 注意：真实稿**不是**"每页几个大字"，而是 12-16pt 密排正文 + 24-32pt 小标题。
 * 这点与生成器现状（bullets 18pt 起）有实质差异，故导出侧字号选择应参考本阶梯。
 */
export const ZY_FONT_SCALE = {
  coverTitle: 40,
  coverSub: 16,
  sectionTitle: 30,
  slideTitle: 24,
  subtitle: 18,
  body: 14,
  bodySmall: 12,
  caption: 10,
} as const

/**
 * 内容密度基线（实测 9 份真实 PPT）：
 *   平均每页图片 2.61 张（范围 0.76–5.49）｜含图页占比 82%｜
 *   平均每页字数 217（范围 44–371）｜中位 156–234
 * 用途：生成后自检「这册像不像公司真实稿」——图太少/字太少都说明退化成了纯文字 PPT。
 */
export const ZY_DECK_BASELINE = {
  /** 目标：含图页（真实图或图示）占全部内容页的比例 */
  picturePageRatio: 0.8,
  /** 目标：平均每页图片数（真实稿 2.6 张，这里取保守下限） */
  avgPicturesPerSlide: 2.0,
  /** 目标：中位每页字数（真实稿 156–234） */
  medianCharsPerSlide: 150,
} as const

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
