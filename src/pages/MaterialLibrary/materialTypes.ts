// 素材库类型定义（R-008）。存储走 PocketBase material_library 集合（Q-013 路B），
// 原图/缩略图为 dataURL 文本字段；字段语义与 pb_hooks/material_library.pb.js 头注一一对应。

export type MaterialSource = "manual" | "internal" | "pexels" | "unsplash" | "pixabay"

export type MaterialItem = {
  id: string
  name: string
  category: string
  tags: string[]
  source: MaterialSource
  sourceUrl: string
  license: string
  licenseChecked: boolean
  width: number
  height: number
  bytes: number
  sha256: string
  orientation: "landscape" | "portrait" | "square"
  photographer: string
  usage: number
  note: string
  trashed?: boolean
  /** 缩略图 dataURL（列表 mode=thumbs 返回） */
  thumb_data?: string
  /** 原图 dataURL（仅 GET /api/materials/{id} 全量返回） */
  image_data?: string
  created: string
  updated?: string
}

export type MaterialListResult = { items: MaterialItem[]; page: number; perPage: number; totalItems: number }

export type MaterialStats = {
  total: number
  trashed: number
  bytes: number
  categories: { name: string; count: number }[]
  sources: { name: string; count: number }[]
}

/** 内部源配置（Q-014：地址未配置显示「未配置」，不报错不阻塞；存 localStorage，本地优先） */
export type InternalSourceConfig = {
  id: string
  name: string
  type: "http-list"
  url: string
  enabled: boolean
}

export const MATERIAL_CATEGORIES = [
  "01_架构图",
  "02_系统截图",
  "03_现场照片",
  "04_资质案例",
  "05_图库素材",
  "99_未分类",
] as const

export const MATERIAL_SOURCE_LABELS: Record<MaterialSource, string> = {
  manual: "本地上传",
  internal: "内部源",
  pexels: "Pexels",
  unsplash: "Unsplash",
  pixabay: "Pixabay",
}

/** 图库来源的授权说明（入库硬要求：license + sourceUrl 缺一不入） */
export const GALLERY_SOURCE_LICENSES: Record<"pexels" | "unsplash" | "pixabay", string> = {
  pexels: "Pexels License",
  unsplash: "Unsplash License",
  pixabay: "Pixabay License",
}

/** 素材库 localStorage 键：内部源配置（本地优先，同 imageSearch key 的存法惯例） */
export const MATERIAL_CONFIG_LS_KEY = "material-library-config"
