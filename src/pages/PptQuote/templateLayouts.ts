// ---------------------------------------------------------------------------
// 公司模板 · 版式解析与映射（2026-10-30 阶段 3）
//
// 解决的原有问题（用户第 7 条）：
//   「不允许只提取模板颜色和字体，就宣称"已按公司模板生成"。」
//
//   原实现 `deckTheme.extractDeckTheme` 只读 theme1.xml 的 accent 色 + major/minor 字体，
//   导出时仍用内置布局画页 —— 结果就是"套了公司模板还是像内置模板"。
//
//   本模块做真正的事：
//     ① 解析 pptx 包里的 **slideMasters + slideLayouts**（名称、占位符类型、数量）；
//     ② 提供 **kind → layout 映射**（用户可调整并保存为公司默认）；
//     ③ 导出时按映射用真实 layout 建页（配合 templateFidelity 的克隆通道）。
//
// 纯函数设计：输入 pptx 字节 → 输出版式清单，便于单测与复用。
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from "fflate"
import {
  SLIDE_KINDS,
  TemplateMappingSchema,
  safeParse,
  type SlideKindZ,
  type TemplateMappingZ,
} from "./deckSchema"

// ===========================================================================
// 一、类型
// ===========================================================================

/** 占位符类型（OOXML ph type） */
export type PlaceholderKind =
  | "title"
  | "body"
  | "ctrTitle"
  | "subTitle"
  | "pic"
  | "chart"
  | "tbl"
  | "dt"
  | "ftr"
  | "sldNum"
  | "other"

export type LayoutPlaceholder = {
  kind: PlaceholderKind
  /** 占位符索引（匹配 ph idx 用；title/ctrTitle 通常无 idx） */
  idx?: number
  /** 原始 type 属性（便于调试） */
  rawType: string
}

/** 一个模板版式 */
export type TemplateLayout = {
  /** 版式部件路径：ppt/slideLayouts/slideLayout3.xml */
  path: string
  /** 版式 id（从 XML 的 cSld name 取，取不到用文件名） */
  layoutId: string
  /** 版式显示名（PowerPoint 里看到的"标题幻灯片"等） */
  name: string
  /** 所属母版路径 */
  masterPath: string
  /** 含哪些占位符 */
  placeholders: LayoutPlaceholder[]
  /** 是否含标题占位符（判断能否当内容页用） */
  hasTitle: boolean
  /** 是否有正文类占位符 */
  hasBody: boolean
}

export type TemplateOutline = {
  /** 模板里所有可用版式（按原始顺序） */
  layouts: TemplateLayout[]
  /** 母版数量 */
  masterCount: number
  /** 解析失败原因（成功时为 null） */
  failure: string | null
}

// ===========================================================================
// 二、解析
// ===========================================================================

/** 从 slideLayout XML 里抽占位符 */
function parsePlaceholders(xml: string): LayoutPlaceholder[] {
  const out: LayoutPlaceholder[] = []
  // <p:ph type="body" idx="1"/> 或 <p:ph/>（默认 body）
  for (const m of xml.matchAll(/<p:ph\b([^/>]*)\/?>/g)) {
    const attrs = m[1] ?? ""
    const rawType = /type="([^"]*)"/.exec(attrs)?.[1] ?? "body"
    const idxStr = /idx="(\d+)"/.exec(attrs)?.[1]
    out.push({
      kind: mapPhType(rawType),
      ...(idxStr ? { idx: Number(idxStr) } : {}),
      rawType,
    })
  }
  return out
}

function mapPhType(t: string): PlaceholderKind {
  switch (t) {
    case "title":
    case "ctrTitle":
    case "subTitle":
    case "body":
    case "pic":
    case "chart":
    case "tbl":
    case "dt":
    case "ftr":
    case "sldNum":
      return t
    default:
      return "other"
  }
}

/** 从 layout XML 里取版式名（cSld name="xxx"） */
function parseLayoutName(xml: string, fallback: string): string {
  const m = /<p:cSld[^>]*\bname="([^"]*)"/.exec(xml)
  const name = (m?.[1] ?? "").trim()
  return name || fallback
}

/**
 * 解析模板的母版与版式清单。
 *
 * 只读 zip 里的 XML，不解压图片（快且省内存）。
 * 失败一律返回 failure 字符串，不抛异常（调用方据此提示"模板无法解析，请另存为标准 pptx"）。
 */
export function parseTemplateOutline(template: Uint8Array): TemplateOutline {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(template)
  } catch {
    return { layouts: [], masterCount: 0, failure: "文件不是有效的 pptx/zip 包" }
  }

  const layoutPaths = Object.keys(entries)
    .filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(/slideLayout(\d+)/.exec(a)?.[1] ?? 0)
      const nb = Number(/slideLayout(\d+)/.exec(b)?.[1] ?? 0)
      return na - nb
    })

  if (!layoutPaths.length) {
    return { layouts: [], masterCount: 0, failure: "模板里没有找到任何版式（slideLayout）" }
  }

  const masterCount = Object.keys(entries).filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).length

  const layouts: TemplateLayout[] = []
  for (const path of layoutPaths) {
    let xml: string
    try {
      xml = strFromU8(entries[path])
    } catch {
      continue
    }
    const fileId = /slideLayout(\d+)\.xml$/.exec(path)?.[1] ?? "0"
    // 找该版式关联的母版（通过 rels）；取不到就留空，不阻断解析
    const relPath = path.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels"
    const masterPath = (() => {
      try {
        const rels = entries[relPath] ? strFromU8(entries[relPath]) : ""
        return /Target="[^"]*?(slideMasters\/slideMaster\d+\.xml)"/.exec(rels)?.[1] ?? ""
      } catch {
        return ""
      }
    })()
    const placeholders = parsePlaceholders(xml)
    const hasTitle = placeholders.some((p) => p.kind === "title" || p.kind === "ctrTitle")
    const hasBody = placeholders.some((p) => p.kind === "body" || p.kind === "tbl" || p.kind === "chart")
    layouts.push({
      path,
      layoutId: `layout${fileId}`,
      name: parseLayoutName(xml, `版式 ${fileId}`),
      masterPath,
      placeholders,
      hasTitle,
      hasBody,
    })
  }

  if (!layouts.length) return { layouts: [], masterCount, failure: "所有版式都解析失败" }
  return { layouts, masterCount, failure: null }
}

// ===========================================================================
// 三、kind → layout 映射
// ===========================================================================

/** 映射结果 + 每项是否"真的匹配到模板版式" */
export type MappingResolution = {
  mapping: TemplateMappingZ
  /** 每个 kind 实际用到的版式（null = 模板里没有合适版式） */
  resolved: Record<SlideKindZ, TemplateLayout | null>
  /** 缺失版式的 kind（需提示用户"这些页不会用模板版式"） */
  missing: SlideKindZ[]
  /** 匹配到了版式但该版式无正文占位符的 kind（正文区需渲染器自绘，导出时提示） */
  bodyFromRenderer: SlideKindZ[]
}

/**
 * 按"语义 + 占位符特征"自动推荐映射。
 *
 * 2026-10-30 实测修正（用真实公司模板验出来的问题）：
 *   多数公司模板的版式只有「标题」占位符，**没有正文占位符**
 *   （实测"智业标准文档编辑规范"模板：6 个版式里 4 个只有 title，正文区是空白）。
 *   原策略只认 hasTitle&&hasBody，导致 9 个 kind 全部映射失败。
 *
 *   现策略改为三级兜底：
 *     ① 名称语义匹配（标题幻灯片/目录/节标题/尾页）
 *     ② 有标题+正文占位 → 最理想
 *     ③ **只有标题占位也算可用**（正文区由渲染器按版式安全区自绘），
 *        并在 resolution 里标记 `bodyFromRenderer`，导出时提示用户
 */
export function recommendMapping(outline: TemplateOutline): TemplateMappingZ {
  const ls = outline.layouts
  const pickByName = (re: RegExp): TemplateLayout | undefined => ls.find((l) => re.test(l.name))
  const withTitle = ls.filter((l) => l.hasTitle)
  const contentLayouts = ls.filter((l) => l.hasTitle && l.hasBody)
  // 内容页优先级：标题+正文 > 仅标题 > 任意含占位符
  const anyContent = contentLayouts[0] ?? withTitle[0] ?? ls[0]

  const cover = pickByName(/标题幻灯片|封面|title slide|cover|首页/i)
  const agenda = pickByName(/目录|agenda|toc|contents/i)
  const section = pickByName(/节标题|章节|section|divider/i)
  const end = pickByName(/结束|尾页|致谢|谢谢|thank|ending|closing/i)

  const m: TemplateMappingZ = {}
  for (const kind of SLIDE_KINDS) {
    let hit: TemplateLayout | undefined
    switch (kind) {
      case "cover":
        hit = cover ?? ls.find((l) => l.placeholders.some((p) => p.kind === "ctrTitle")) ?? anyContent
        break
      case "summary":
        hit = end ?? cover ?? anyContent
        break
      case "agenda":
        hit = agenda ?? anyContent
        break
      case "section":
        hit = section ?? anyContent
        break
      default:
        // 内容类：优先专属名称，其次"标题+正文"，再退"仅标题"
        hit =
          (kind === "image" ? pickByName(/图片|图文|内容.*图片|picture/i) : undefined) ??
          (kind === "chart" ? pickByName(/图表|chart|数据/i) : undefined) ??
          (kind === "table" ? pickByName(/表格|table/i) : undefined) ??
          anyContent
        break
    }
    const layoutId = hit?.path.replace(/^ppt\/slideLayouts\//, "").replace(/\.xml$/, "")
    if (layoutId) m[kind] = layoutId
  }
  return m
}

/** 把映射里的 layoutId 解析成 TemplateLayout */
export function resolveMapping(outline: TemplateOutline, mapping: TemplateMappingZ): MappingResolution {
  const byFileId = new Map<string, TemplateLayout>()
  for (const l of outline.layouts) {
    // 同时支持存 layout3 / slideLayout3 两种写法
    byFileId.set(l.layoutId, l)
    byFileId.set(l.path.replace(/^ppt\/slideLayouts\//, "").replace(/\.xml$/, ""), l)
  }
  const resolved = {} as Record<SlideKindZ, TemplateLayout | null>
  const missing: SlideKindZ[] = []
  // 没有正文占位符的 kind（导出时需要渲染器自绘正文区，并告知用户）
  const bodyFromRenderer: SlideKindZ[] = []
  for (const kind of SLIDE_KINDS) {
    const id = mapping[kind]
    const layout = id ? (byFileId.get(id) ?? null) : null
    resolved[kind] = layout
    if (!layout) {
      missing.push(kind)
    } else if (!layout.hasBody && kind !== "cover" && kind !== "section" && kind !== "summary") {
      bodyFromRenderer.push(kind)
    }
  }
  return { mapping, resolved, missing, bodyFromRenderer }
}

/** 校验用户上传/保存的映射结构 */
export function parseTemplateMapping(raw: unknown): TemplateMappingZ | null {
  const r = safeParse(TemplateMappingSchema, raw)
  return r.ok ? r.data : null
}

/** 映射的中文摘要（界面展示："封面→标题幻灯片，内容页→内容与标题…"） */
export function mappingSummary(outline: TemplateOutline, mapping: TemplateMappingZ): string {
  const res = resolveMapping(outline, mapping)
  const used = new Map<string, string[]>()
  for (const kind of SLIDE_KINDS) {
    const l = res.resolved[kind]
    const key = l ? l.name : "（未映射）"
    const arr = used.get(key) ?? []
    arr.push(KIND_CN[kind])
    used.set(key, arr)
  }
  return Array.from(used.entries())
    .map(([layout, kinds]) => `${layout} ← ${kinds.join("/")}`)
    .join("；")
}

const KIND_CN: Record<SlideKindZ, string> = {
  cover: "封面",
  agenda: "目录",
  section: "章节",
  bullets: "正文",
  kpi: "数字",
  chart: "图表",
  table: "表格",
  flow: "流程",
  architecture: "架构",
  image: "图文",
  summary: "结束",
}
