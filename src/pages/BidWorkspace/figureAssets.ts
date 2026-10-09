// ---------------------------------------------------------------------------
// 2026-10 配图需求轮：标书图素材模板库（用户上传的架构图/流程图/系统截图，跨项目复用）
//
// 设计约束（与 R167 素材库同哲学）：零 collection / 零 schema——模板登记表存 localStorage，
// 图片本体走既有 aigc 上传通道落服务端（uploadAigcMedia → downloadUrl → persistMediaUrl 落 PB），
// 模板只登记 {名称, 类别, url}。纯模块：不 import React / hook，便于单测。
// ---------------------------------------------------------------------------

export type FigureTemplateKind = "architecture" | "flow" | "screenshot"

export type FigureTemplate = {
  id: string
  /** 模板名（默认取文件名去扩展名，可改） */
  name: string
  kind: FigureTemplateKind
  /** 图片可访问 URL（已落服务端；导出 Word 时 figureToPng 直接 fetch） */
  url: string
  created: string
}

const STORAGE_KEY = "bid-figure-templates-v1"
const MAX_TEMPLATES = 60

export const FIGURE_TEMPLATE_KIND_LABEL: Record<FigureTemplateKind, string> = {
  architecture: "架构图",
  flow: "流程图",
  screenshot: "系统截图",
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 读模板清单（localStorage 不可用/脏数据返回空数组） */
export function listFigureTemplates(): FigureTemplate[] {
  if (typeof window === "undefined") return []
  const data = safeParse(window.localStorage.getItem(STORAGE_KEY))
  if (!Array.isArray(data)) return []
  const out: FigureTemplate[] = []
  for (const it of data) {
    if (!it || typeof it !== "object") continue
    const r = it as Record<string, unknown>
    const id = String(r.id ?? "").trim()
    const name = String(r.name ?? "").trim()
    const url = String(r.url ?? "").trim()
    const kind = r.kind === "architecture" || r.kind === "flow" ? r.kind : "screenshot"
    if (!id || !name || !url) continue
    out.push({ id, name: name.slice(0, 60), kind, url, created: String(r.created ?? "") })
  }
  return out
}

/** 新增模板：同名同 URL 去重（提到最前），超上限丢最旧；返回更新后的完整清单 */
export function addFigureTemplate(input: { name: string; url: string; kind?: FigureTemplateKind }): FigureTemplate[] {
  const name = input.name.trim().slice(0, 60) || "未命名图模板"
  const url = input.url.trim()
  if (!url) return listFigureTemplates()
  const rest = listFigureTemplates().filter((t) => !(t.url === url && t.name === name))
  const next: FigureTemplate[] = [
    {
      id: `figtpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      kind: input.kind ?? "screenshot",
      url,
      created: new Date().toISOString(),
    },
    ...rest,
  ].slice(0, MAX_TEMPLATES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存储满/隐私模式：内存态返回，不阻塞上传主流程 */
  }
  return next
}

/** 删除模板（id 未命中静默返回现清单）；返回更新后的完整清单 */
export function removeFigureTemplate(id: string): FigureTemplate[] {
  const next = listFigureTemplates().filter((t) => t.id !== id)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 同上 */
  }
  return next
}

/** 按文件名猜模板类别：架构/拓扑→architecture，流程/甘特/计划→flow，其余（含「截图/界面/系统」）→screenshot */
export function figureKindFromName(name: string): FigureTemplateKind {
  const n = (name ?? "").toLowerCase()
  if (/架构|拓扑|topology|arch/.test(n)) return "architecture"
  if (/流程|甘特|计划|进度|flow|gantt/.test(n)) return "flow"
  return "screenshot"
}
