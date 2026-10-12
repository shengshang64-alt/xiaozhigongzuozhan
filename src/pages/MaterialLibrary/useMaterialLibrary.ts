// 素材库状态层（R-008）：列表/统计/联网抓取入库/本地导入/回收站/库设置。
// 数据走 __pb 代理自定义路由（pb_hooks/material_library.pb.js），apiFetch 封装与各页 hook 同款。
// Key 存取沿用 imageSearch.ts 的 localStorage 机制（需求提示词 §3.7.3：不改搜图 key 机制）。
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { triggerBlobDownload } from "@/lib/download"
import {
  getImageSearchKey,
  setImageSearchKey,
  searchImages,
  IMAGE_LICENSES,
  type ImageSearchHit,
  type ImageSearchProvider,
} from "@/pages/PptQuote/imageSearch"
import {
  makeThumbDataUrl,
  normalizeImageDataUrl,
  parseNameFromFileName,
  parseTagsFromFileName,
  guessOrientation,
  sha256HexFromDataUrl,
  dataUrlBytes,
} from "./materialCore"
import {
  MATERIAL_CONFIG_LS_KEY,
  type InternalSourceConfig,
  type MaterialItem,
  type MaterialListResult,
  type MaterialStats,
  type MaterialSource,
} from "./materialTypes"

export const IMPORT_PER_FILE_LIMIT = 6 * 1024 * 1024

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...vibexAuthHeaders(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`)
  }
  return (await res.json()) as T
}

/** 图库候选图 → dataURL：复用 fetch-image 服务端代理（绕跨域/画布污染，同 usePptQuote.urlToDataUrl） */
async function hitToDataUrl(url: string): Promise<string> {
  const r = await apiFetch<{ ok: boolean; dataUrl?: string; message?: string }>("/api/customers/fetch-image", {
    method: "POST",
    body: JSON.stringify({ url }),
  })
  if (!r.ok || !r.dataUrl) throw new Error(r.message || "图片代理下载失败")
  return r.dataUrl
}

export type ImportSummary = {
  added: number
  duplicated: number
  failed: { name: string; reason: string }[]
  total: number
}

export type WebSavePayload = {
  hit: ImageSearchHit
  provider: ImageSearchProvider
  query: string
}

export function useMaterialLibrary() {
  // ---------- 列表 / 统计 ----------
  const [items, setItems] = useState<MaterialItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsLoaded, setItemsLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("")
  const [source, setSource] = useState("")
  const [trashedView, setTrashedView] = useState(false)
  const [stats, setStats] = useState<MaterialStats | null>(null)
  const reqSeq = useRef(0)

  const loadStats = useCallback(async () => {
    try {
      setStats(await apiFetch<MaterialStats>("/api/materials-stats", { headers: vibexAuthHeaders() }))
    } catch {
      /* 统计失败不打断主列表 */
    }
  }, [])

  const loadItems = useCallback(
    async (targetPage: number) => {
      const seq = ++reqSeq.current
      setItemsLoading(true)
      try {
        const qs = new URLSearchParams({ page: String(targetPage), perPage: "60" })
        if (q.trim()) qs.set("q", q.trim())
        if (category) qs.set("category", category)
        if (source) qs.set("source", source)
        if (trashedView) qs.set("trashed", "1")
        const data = await apiFetch<MaterialListResult>(`/api/materials?${qs.toString()}`, { headers: vibexAuthHeaders() })
        if (seq !== reqSeq.current) return // 请求序号守卫，防乱序覆盖
        setTotalItems(data.totalItems ?? 0)
        setHasMore(targetPage * 60 < (data.totalItems ?? 0))
        setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]))
        setPage(targetPage)
        setItemsLoaded(true)
      } catch (e) {
        if (seq === reqSeq.current) toast.error(e instanceof Error ? e.message : "素材列表加载失败")
      } finally {
        if (seq === reqSeq.current) setItemsLoading(false)
      }
    },
    [q, category, source, trashedView],
  )

  // 筛选变化 → 延迟一拍重拉（顺带防抖；清理函数取消上一次未触发的请求）
  useEffect(() => {
    const t = setTimeout(() => void loadItems(1), 0)
    return () => clearTimeout(t)
  }, [loadItems])

  useEffect(() => {
    const t = setTimeout(() => void loadStats(), 0)
    return () => clearTimeout(t)
  }, [loadStats])

  const loadMore = useCallback(() => void loadItems(page + 1), [loadItems, page])

  // ---------- 详情编辑 / 回收站 ----------
  const [detail, setDetail] = useState<MaterialItem | null>(null)

  const openDetail = useCallback(async (it: MaterialItem) => {
    setDetail(it)
    try {
      const full = await apiFetch<MaterialItem>(`/api/materials/${it.id}`, { headers: vibexAuthHeaders() })
      setDetail(full)
    } catch {
      /* 全量拉取失败就展示列表态（无原图） */
    }
  }, [])

  const updateItem = useCallback(
    async (id: string, patch: Partial<Pick<MaterialItem, "name" | "category" | "tags" | "note" | "license" | "licenseChecked">>) => {
      try {
        await apiFetch(`/api/materials/${id}`, { method: "PATCH", body: JSON.stringify(patch), headers: vibexAuthHeaders() })
        toast.success("素材信息已更新")
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, tags: patch.tags ?? it.tags } : it)))
        setDetail((d) => (d && d.id === id ? { ...d, ...patch } : d))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新失败")
      }
    },
    [],
  )

  const trashItem = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/materials/${id}`, { method: "DELETE", headers: vibexAuthHeaders() })
        toast.success("已移入回收站（可在回收站视图恢复）")
        setDetail(null)
        await Promise.all([loadItems(1), loadStats()])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败")
      }
    },
    [loadItems, loadStats],
  )

  const restoreItem = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/materials/${id}/restore`, { method: "POST", headers: vibexAuthHeaders() })
        toast.success("已恢复")
        setDetail(null)
        await Promise.all([loadItems(1), loadStats()])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "恢复失败")
      }
    },
    [loadItems, loadStats],
  )

  const purgeTrashed = useCallback(async () => {
    try {
      const r = await apiFetch<{ purged: number }>("/api/materials-trash/purge", { method: "POST", headers: vibexAuthHeaders() })
      toast.success(`回收站已清空（彻底删除 ${r.purged} 条）`)
      await Promise.all([loadItems(1), loadStats()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清空失败")
    }
  }, [loadItems, loadStats])

  // ---------- 入库核心（联网/本地/内部源共用）：压缩 → 缩略图 → sha256 → POST ----------
  const ingestDataUrl = useCallback(
    async (input: {
      dataUrl: string
      name: string
      category: string
      tags: string[]
      source: MaterialSource
      sourceUrl?: string
      license?: string
      licenseChecked?: boolean
      photographer?: string
      width?: number
      height?: number
    }): Promise<{ duplicated: boolean }> => {
      const norm =
        input.width && input.height && dataUrlBytes(input.dataUrl) <= IMPORT_PER_FILE_LIMIT
          ? { dataUrl: input.dataUrl, width: input.width, height: input.height, bytes: dataUrlBytes(input.dataUrl) }
          : await normalizeImageDataUrl(input.dataUrl)
      const thumb = await makeThumbDataUrl(norm.dataUrl)
      const sha256 = await sha256HexFromDataUrl(norm.dataUrl)
      const r = await apiFetch<{ duplicated: boolean }>("/api/materials", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          category: input.category,
          tags: input.tags,
          source: input.source,
          source_url: input.sourceUrl || "",
          license: input.license || "",
          license_checked: input.licenseChecked ?? false,
          photographer: input.photographer || "",
          width: norm.width,
          height: norm.height,
          bytes: norm.bytes,
          sha256,
          orientation: guessOrientation(norm.width, norm.height),
          image_data: norm.dataUrl,
          thumb_data: thumb,
        }),
        headers: vibexAuthHeaders(),
      })
      return { duplicated: !!r.duplicated }
    },
    [],
  )

  // ---------- 联网抓取 ----------
  const [webProvider, setWebProvider] = useState<ImageSearchProvider>("pixabay")
  const [webQuery, setWebQuery] = useState("")
  const [webHits, setWebHits] = useState<ImageSearchHit[]>([])
  const [webMessage, setWebMessage] = useState("")
  const [webSearching, setWebSearching] = useState(false)
  const [savedUrls, setSavedUrls] = useState<Record<string, boolean>>({})
  const [savingUrl, setSavingUrl] = useState("")
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])

  const hasWebKey = getImageSearchKey(webProvider).trim() !== ""

  const runWebSearch = useCallback(
    async (queryOverride?: string) => {
      const query = (queryOverride ?? webQuery).trim()
      if (!query) {
        toast.warning("请输入搜索关键词")
        return
      }
      setWebQuery(query)
      setWebSearching(true)
      setWebMessage("")
      setWebHits([])
      setSelectedUrls([])
      try {
        const r = await searchImages(webProvider, query, { perPage: 24 })
        setWebHits(r.hits)
        setWebMessage(r.message || (r.ok ? "" : "搜索失败"))
      } catch (e) {
        setWebMessage(e instanceof Error ? e.message : "搜索失败")
      } finally {
        setWebSearching(false)
      }
    },
    [webProvider, webQuery],
  )

  const saveWebHit = useCallback(
    async (hit: ImageSearchHit): Promise<boolean> => {
      const provider = webProvider
      setSavingUrl(hit.url)
      try {
        const dataUrl = await hitToDataUrl(hit.url)
        const r = await ingestDataUrl({
          dataUrl,
          name: (hit.alt || webQuery || "图库素材").slice(0, 80),
          category: "05_图库素材",
          tags: (hit.alt || "")
            .split(/[,，\s]+/)
            .filter((t) => t.length >= 2)
            .slice(0, 4),
          source: provider,
          sourceUrl: hit.pageUrl || hit.url,
          license: IMAGE_LICENSES[provider],
          licenseChecked: true,
          photographer: hit.photographer || "",
          width: hit.width,
          height: hit.height,
        })
        if (r.duplicated) toast.info("该图已在素材库中（sha256 去重）")
        else toast.success("已存入素材库（含授权链：license + 来源页）")
        setSavedUrls((prev) => ({ ...prev, [hit.url]: true }))
        await Promise.all([loadStats(), loadItems(1)])
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "入库失败")
        return false
      } finally {
        setSavingUrl("")
      }
    },
    [webProvider, webQuery, ingestDataUrl, loadStats, loadItems],
  )

  const saveSelectedHits = useCallback(async () => {
    const hits = webHits.filter((h) => selectedUrls.includes(h.url))
    let ok = 0
    for (const h of hits) {
      if (await saveWebHit(h)) ok++
    }
    setSelectedUrls([])
    if (hits.length > 1) toast.info(`批量入库完成：成功 ${ok}/${hits.length}`)
  }, [webHits, selectedUrls, saveWebHit])

  const toggleSelectUrl = useCallback((url: string) => {
    setSelectedUrls((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]))
  }, [])

  // 一键清空当前选择：顶栏「取消选择」按钮语义是清空整批，而非仅移除首项
  const clearSelection = useCallback(() => setSelectedUrls([]), [])

  // ---------- 本地导入（扫描入库的 PB 版：多选文件批量入库，sha256 去重） ----------
  const [importCategory, setImportCategory] = useState("03_现场照片")
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [importResult, setImportResult] = useState<ImportSummary | null>(null)
  const importCancelRef = useRef(false)

  const importFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"))
      const skipped = files.length - images.length
      if (!images.length) {
        toast.warning("未选择图片文件（支持 jpg/png/webp/gif）")
        return
      }
      importCancelRef.current = false
      setImportResult(null)
      const summary: ImportSummary = { added: 0, duplicated: 0, failed: [], total: images.length }
      for (let i = 0; i < images.length; i++) {
        if (importCancelRef.current) break
        const f = images[i]
        setImportProgress({ done: i, total: images.length, current: f.name })
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ""))
            reader.onerror = () => reject(new Error("读取失败"))
            reader.readAsDataURL(f)
          })
          const r = await ingestDataUrl({
            dataUrl,
            name: parseNameFromFileName(f.name),
            category: importCategory,
            tags: parseTagsFromFileName(f.name),
            source: "manual",
            license: "本地上传素材",
            licenseChecked: true,
          })
          if (r.duplicated) summary.duplicated++
          else summary.added++
        } catch (e) {
          summary.failed.push({ name: f.name, reason: e instanceof Error ? e.message : "入库失败" })
        }
      }
      if (skipped > 0) summary.failed.push({ name: `${skipped} 个非图片文件`, reason: "已跳过" })
      setImportProgress(null)
      setImportResult(summary)
      toast.success(`导入完成：新增 ${summary.added} / 重复 ${summary.duplicated} / 失败 ${summary.failed.length}`)
      await Promise.all([loadStats(), loadItems(1)])
    },
    [importCategory, ingestDataUrl, loadStats, loadItems],
  )

  const cancelImport = useCallback(() => {
    importCancelRef.current = true
  }, [])

  // ---------- 内部源（Q-014：未配置显示「未配置」，不报错不阻塞；配置存 localStorage） ----------
  const [internalSources, setInternalSources] = useState<InternalSourceConfig[]>(() => {
    try {
      const raw = localStorage.getItem(MATERIAL_CONFIG_LS_KEY)
      const parsed = raw ? (JSON.parse(raw) as { internalSources?: InternalSourceConfig[] }) : null
      return Array.isArray(parsed?.internalSources) ? parsed.internalSources : []
    } catch {
      return []
    }
  })
  const [internalBusy, setInternalBusy] = useState("")
  const [internalProgress, setInternalProgress] = useState<{ done: number; total: number } | null>(null)

  const persistInternalSources = useCallback((next: InternalSourceConfig[]) => {
    setInternalSources(next)
    try {
      localStorage.setItem(MATERIAL_CONFIG_LS_KEY, JSON.stringify({ internalSources: next }))
    } catch {
      /* localStorage 被禁时仅内存态 */
    }
  }, [])

  const upsertInternalSource = useCallback(
    (src: InternalSourceConfig) => {
      persistInternalSources(internalSources.some((s) => s.id === src.id) ? internalSources.map((s) => (s.id === src.id ? src : s)) : [...internalSources, src])
    },
    [internalSources, persistInternalSources],
  )

  const removeInternalSource = useCallback(
    (id: string) => persistInternalSources(internalSources.filter((s) => s.id !== id)),
    [internalSources, persistInternalSources],
  )

  /** 拉内部源清单并逐张入库；未配置/未启用时给出弱提示，绝不抛错阻塞 */
  const importFromInternalSource = useCallback(
    async (src: InternalSourceConfig) => {
      if (!src.url) {
        toast.info(`「${src.name}」地址未配置，请在库设置里填写清单地址`)
        return
      }
      setInternalBusy(src.id)
      try {
        const res = await fetch(src.url, { headers: { Accept: "application/json" } })
        if (!res.ok) throw new Error(`清单拉取失败（HTTP ${res.status}）`)
        const list = (await res.json()) as { name?: string; url: string; tags?: string[] }[]
        if (!Array.isArray(list) || !list.length) throw new Error("清单为空或格式不对（期望 [{name,url,tags?}]）")
        let added = 0
        let dup = 0
        const failed: string[] = []
        for (let i = 0; i < list.length; i++) {
          const entry = list[i]
          setInternalProgress({ done: i, total: list.length })
          if (!entry?.url) continue
          try {
            const dataUrl = await hitToDataUrl(entry.url)
            const r = await ingestDataUrl({
              dataUrl,
              name: (entry.name || "内部素材").slice(0, 80),
              category: "99_未分类",
              tags: (entry.tags || []).slice(0, 6),
              source: "internal",
              license: "公司内部素材",
              licenseChecked: true,
            })
            if (r.duplicated) dup++
            else added++
          } catch (err) {
            failed.push(`${entry.name || entry.url}：${err instanceof Error ? err.message : "失败"}`)
          }
        }
        setInternalProgress(null)
        toast.success(`内部源入库完成：新增 ${added} / 重复 ${dup} / 失败 ${failed.length}`)
        if (failed.length) toast.warning(`失败明细（前 3 条）：${failed.slice(0, 3).join("；")}`)
        await Promise.all([loadStats(), loadItems(1)])
      } catch (e) {
        setInternalProgress(null)
        toast.error(e instanceof Error ? e.message : "内部源拉取失败（若为跨域限制，请改走同源地址）")
      } finally {
        setInternalBusy("")
      }
    },
    [ingestDataUrl, loadStats, loadItems],
  )

  // ---------- 库设置：API Key（沿用 imageSearch 的 localStorage 机制） ----------
  const setProviderKey = useCallback((provider: ImageSearchProvider, key: string) => {
    setImageSearchKey(provider, key)
    toast.success(`已保存 ${provider} Key（存本机浏览器）`)
  }, [])

  // ---------- 导出索引 JSON ----------
  const exportIndex = useCallback(async () => {
    try {
      const all: MaterialItem[] = []
      for (let p = 1; ; p++) {
        const data = await apiFetch<MaterialListResult>(`/api/materials?page=${p}&perPage=120&mode=meta&trashed=${trashedView ? "1" : "0"}`, {
          headers: vibexAuthHeaders(),
        })
        all.push(...data.items)
        if (all.length >= (data.totalItems ?? 0) || !data.items.length) break
      }
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), total: all.length, items: all }, null, 2)], {
        type: "application/json",
      })
      triggerBlobDownload(blob, `material-library-index-${Date.now()}.json`)
      toast.success(`已导出索引（${all.length} 条，不含原图数据）`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败")
    }
  }, [trashedView])

  return {
    // 列表
    items, itemsLoading, itemsLoaded, totalItems, hasMore, loadMore,
    q, setQ, category, setCategory, source, setSource, trashedView, setTrashedView,
    stats, reloadAll: () => Promise.all([loadItems(1), loadStats()]),
    // 详情/编辑/回收站
    detail, openDetail, setDetail, updateItem, trashItem, restoreItem, purgeTrashed,
    // 联网抓取
    webProvider, setWebProvider, webQuery, setWebQuery, webHits, webMessage, webSearching,
    hasWebKey, runWebSearch, saveWebHit, saveSelectedHits, savedUrls, savingUrl,
    selectedUrls, toggleSelectUrl, clearSelection,
    // 本地导入
    importCategory, setImportCategory, importProgress, importResult, importFiles, cancelImport,
    // 内部源
    internalSources, upsertInternalSource, removeInternalSource, importFromInternalSource, internalBusy, internalProgress,
    // 设置/导出
    setProviderKey, exportIndex,
  }
}

export type UseMaterialLibrary = ReturnType<typeof useMaterialLibrary>
