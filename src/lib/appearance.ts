// 个性化外观设置：显示模式（浅色/深色）· 配色方案 · 圆角 · 自定义背景图。
// 全部存 localStorage（仅本机生效，不上传服务端），通过注入 html:root 级
// CSS 变量覆盖 index.css 的 :root token 生效——不改任何业务组件。
// 注意：index.css 里 .dark 块是真正的深色 token；本文件注入的 html:root.dark
// 选择器特异性更高，只覆盖“随配色变化”的那几个变量。
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export type AppearanceMode = "light" | "dark"

export type AppearanceBgImage = { id: string; src: string }

export type AppearanceConfig = {
  mode: AppearanceMode
  /** PALETTES 里的 key；'custom' 表示用 customPrimary 自选色 */
  palette: string
  customPrimary: string
  /** --radius，px；默认主题烧的是 12px */
  radius: number
  bgImages: AppearanceBgImage[]
  bgActiveId: string | null
  /** 背景图遮罩深度 0-80（越大文字越好读） */
  bgDim: number
}

export const APPEARANCE_STORAGE_KEY = "zx_appearance_v1"

export const PALETTES: { key: string; label: string; hex: string }[] = [
  { key: "default", label: "默认青蓝", hex: "#0E7C99" },
  { key: "ocean", label: "海蓝", hex: "#2E6FB0" },
  { key: "violet", label: "紫罗兰", hex: "#7B4FB0" },
  { key: "amber", label: "暖橙", hex: "#D97E27" },
  { key: "rose", label: "玫瑰", hex: "#D64562" },
  { key: "moss", label: "苔绿", hex: "#4B8F3F" },
  { key: "graphite", label: "石墨", hex: "#5A6672" },
]

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  mode: "light",
  palette: "default",
  customPrimary: "#0E7C99",
  radius: 12,
  bgImages: [],
  bgActiveId: null,
  bgDim: 35,
}

/** 图集上限与总量预算（localStorage 单域约 5MB，留足安全余量） */
const MAX_BG_GALLERY = 6
const MAX_BG_TOTAL_CHARS = 3_600_000

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let raw = m[1]
  if (raw.length === 3) raw = raw.split("").map((c) => c + c).join("")
  const r = parseInt(raw.slice(0, 2), 16) / 255
  const g = parseInt(raw.slice(2, 4), 16) / 255
  const b = parseInt(raw.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function resolvePaletteHex(cfg: AppearanceConfig): string {
  if (cfg.palette === "custom") return cfg.customPrimary
  const p = PALETTES.find((x) => x.key === cfg.palette)
  return p ? p.hex : DEFAULT_APPEARANCE.customPrimary
}

// ---------------------------------------------------------------------------
// 应用与持久化
// ---------------------------------------------------------------------------

function buildCss(cfg: AppearanceConfig, bg: AppearanceBgImage | null): string {
  const parts: string[] = []
  const p = hexToHsl(resolvePaletteHex(cfg))
  if (p) {
    const h = p.h
    // primary 前景兜底：底色偏亮时自动切深墨，保证按钮文字对比度
    const fgFor = (l: number) => (l >= 62 ? "178 37% 14%" : "0 0% 100%")
    const pL = Math.min(Math.max(p.l, 28), 46)
    // 浅色：primary 直接用所选色，accent 做同色相极浅 tint
    parts.push(
      `html:root{`,
      `--primary:${h} ${Math.max(p.s, 45)}% ${pL}%;`,
      `--ring:${h} ${Math.max(p.s, 45)}% ${pL}%;`,
      `--sidebar-primary:${h} ${Math.max(p.s, 55)}% 48%;`,
      `--sidebar-ring:${h} ${Math.max(p.s, 45)}% 45%;`,
      `--accent:${h} 45% 92%;`,
      `--accent-foreground:${h} 65% 22%;`,
      `--chart-1:${h} ${Math.max(p.s, 45)}% ${pL}%;`,
      `--primary-foreground:${fgFor(pL)};`,
      `}`,
    )
    // 深色：提亮一档保证对比度，accent 换成深 tint
    parts.push(
      `html:root.dark{`,
      `--primary:${h} ${Math.min(Math.max(p.s, 45), 80)}% 52%;`,
      `--ring:${h} ${Math.min(Math.max(p.s, 45), 80)}% 52%;`,
      `--sidebar-primary:${h} ${Math.max(p.s, 55)}% 50%;`,
      `--sidebar-ring:${h} ${Math.max(p.s, 45)}% 50%;`,
      `--accent:${h} 24% 17%;`,
      `--accent-foreground:${h} 35% 88%;`,
      `--chart-1:${h} ${Math.min(Math.max(p.s, 45), 80)}% 52%;`,
      `--primary-foreground:${fgFor(52)};`,
      `}`,
    )
  }
  parts.push(`html:root{--radius:${cfg.radius}px;}`)
  if (bg) {
    const dim = Math.min(Math.max(cfg.bgDim, 0), 80) / 100
    // 背景画在 html 上（传播到视口画布），再把页面壳层的 bg-background 打透，
    // 卡片/弹窗仍保持不透明，图片只在留白与半透明区域露出，不影响可读性。
    parts.push(
      `html:root.zx-bg{background-image:linear-gradient(rgba(7,20,18,${dim}),rgba(7,20,18,${dim})),url("${bg.src}");background-position:center;background-size:cover;background-attachment:fixed;}`,
      `html:root.zx-bg body{background-color:transparent;}`,
      `html:root.zx-bg .bg-background{background-color:transparent;}`,
    )
  }
  return parts.join("")
}

export function applyAppearance(cfg: AppearanceConfig): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.classList.toggle("dark", cfg.mode === "dark")
  const bg = cfg.bgImages.find((x) => x.id === cfg.bgActiveId) || null
  root.classList.toggle("zx-bg", !!bg)
  let style = document.getElementById("zx-appearance-style") as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = "zx-appearance-style"
    document.head.appendChild(style)
  }
  const css = buildCss(cfg, bg)
  if (style.textContent !== css) style.textContent = css
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function loadAppearance(): AppearanceConfig {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const parsed = JSON.parse(raw) as Partial<AppearanceConfig>
    const mode: AppearanceMode = parsed.mode === "dark" ? "dark" : "light"
    const paletteKnown =
      parsed.palette === "custom" ||
      PALETTES.some((x) => x.key === parsed.palette) ||
      parsed.palette === "default"
    const bgImages = Array.isArray(parsed.bgImages)
      ? parsed.bgImages
          .filter((x) => x && typeof x.id === "string" && typeof x.src === "string")
          .slice(0, MAX_BG_GALLERY)
      : []
    const bgActiveId =
      typeof parsed.bgActiveId === "string" && bgImages.some((x) => x.id === parsed.bgActiveId)
        ? parsed.bgActiveId
        : null
    return {
      mode,
      palette: paletteKnown ? String(parsed.palette) : DEFAULT_APPEARANCE.palette,
      customPrimary: /^#[\da-f]{6}$/i.test(String(parsed.customPrimary))
        ? String(parsed.customPrimary)
        : DEFAULT_APPEARANCE.customPrimary,
      radius: clampNum(parsed.radius, 0, 18, DEFAULT_APPEARANCE.radius),
      bgImages,
      bgActiveId,
      bgDim: clampNum(parsed.bgDim, 0, 80, DEFAULT_APPEARANCE.bgDim),
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

/** 落盘；配额不足时返回错误（调用方决定是否回退状态）。 */
export function saveAppearance(cfg: AppearanceConfig): { ok: true } | { ok: false; error: string } {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(cfg))
    return { ok: true }
  } catch {
    return { ok: false, error: "本机存储空间不足，请删除部分背景图" }
  }
}

// ---------------------------------------------------------------------------
// 背景图上传处理：解码 → 等比缩到最长边 1600 → JPEG 压缩
// ---------------------------------------------------------------------------

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("图片解码失败，请换一张"))
    img.src = url
  })
}

function encodeJpeg(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("当前浏览器不支持图片处理")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", quality)
}

export async function fileToBgDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件")
  const img = await loadImage(file)
  // 三档退让：清晰优先，超限逐级降质降尺寸
  const attempts: [number, number][] = [
    [1600, 0.82],
    [1600, 0.7],
    [1280, 0.62],
  ]
  let src = ""
  for (const [side, q] of attempts) {
    src = encodeJpeg(img, side, q)
    if (src.length <= 1_600_000) break
  }
  if (src.length > 2_000_000) throw new Error("图片过大，请压缩后再上传")
  return src
}

// ---------------------------------------------------------------------------
// React hook：状态 + 即时生效 + 落盘（对话框统一走这里）
// ---------------------------------------------------------------------------

// React 19 下 setState updater 可能被延迟/双调，落盘与注入等副作用一律放在
// updater 之外：用 cfgRef 读最新值，算好 next 后 applyNext 统一生效。

export function useAppearance() {
  const [cfg, setCfg] = useState<AppearanceConfig>(() => loadAppearance())
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  const applyNext = useCallback((next: AppearanceConfig): boolean => {
    if (saveAppearance(next).ok === false) return false
    cfgRef.current = next
    setCfg(next)
    applyAppearance(next)
    return true
  }, [])

  const patch = useCallback(
    (part: Partial<AppearanceConfig>) => {
      if (!applyNext({ ...cfgRef.current, ...part })) {
        toast.error("本机存储空间不足，设置未能保存，请先删除部分背景图")
      }
    },
    [applyNext],
  )

  /** 新增背景图：自动做图集/配额裁剪；成功后不自动设生效（由调用方决定） */
  const addBgImage = useCallback(
    async (file: File): Promise<string | null> => {
      let src: string
      try {
        src = await fileToBgDataUrl(file)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "图片处理失败，请重试")
        return null
      }
      const id = "bg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const prev = cfgRef.current
      let images = [...prev.bgImages, { id, src }]
      // 图集数量上限：超出时丢最旧（正在生效的那张不丢）
      while (images.length > MAX_BG_GALLERY) {
        const drop = images.find((x) => x.id !== prev.bgActiveId)
        if (!drop) break
        images = images.filter((x) => x.id !== drop.id)
      }
      // 总量预算：仍超就继续丢最旧
      let total = images.reduce((s, x) => s + x.src.length, 0)
      while (total > MAX_BG_TOTAL_CHARS && images.length > 1) {
        const drop = images.find((x) => x.id !== prev.bgActiveId)
        if (!drop) break
        images = images.filter((x) => x.id !== drop.id)
        total -= drop.src.length
      }
      if (!applyNext({ ...prev, bgImages: images })) {
        toast.error("背景图存储空间已满，请先删除几张旧图")
        return null
      }
      toast.success("背景图已添加")
      return id
    },
    [applyNext],
  )

  const removeBgImage = useCallback(
    (id: string) => {
      const prev = cfgRef.current
      applyNext({
        ...prev,
        bgImages: prev.bgImages.filter((x) => x.id !== id),
        bgActiveId: prev.bgActiveId === id ? null : prev.bgActiveId,
      })
    },
    [applyNext],
  )

  const reset = useCallback(() => {
    applyNext({ ...DEFAULT_APPEARANCE })
    toast.success("已恢复默认外观")
  }, [applyNext])

  // 对话框重新打开/页面回到前台时从 localStorage 重读（多标签页保持一致）
  useEffect(() => {
    const reload = () => {
      const next = loadAppearance()
      cfgRef.current = next
      setCfg(next)
      applyAppearance(next)
    }
    window.addEventListener("zx-appearance-refresh", reload)
    return () => window.removeEventListener("zx-appearance-refresh", reload)
  }, [])

  return { cfg, patch, addBgImage, removeBgImage, reset }
}
