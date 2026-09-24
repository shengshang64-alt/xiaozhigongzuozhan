// 个性化外观对话框：模式 / 配色 / 圆角 / 背景图上传与切换。
// 所有改动即时生效并落本机 localStorage（useAppearance 统一管线）。
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, ImagePlus, Loader2, Moon, Palette, RotateCcw, Sun, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { PALETTES, useAppearance } from "@/lib/appearance"

type AppearanceDialogProps = {
  open: boolean
  onClose: () => void
}

export function AppearanceDialog({ open, onClose }: AppearanceDialogProps) {
  const { cfg, patch, addBgImage, removeBgImage, reset } = useAppearance()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // 打开时同步一次最新落盘值（可能被其他标签页/组件改过）
  useEffect(() => {
    if (!open) return
    const onVisible = () => {
      if (document.visibilityState === "visible") window.dispatchEvent(new Event("zx-appearance-refresh"))
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [open])

  const activeBg = cfg.bgImages.find((x) => x.id === cfg.bgActiveId) || null

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return
    setUploading(true)
    const id = await addBgImage(file)
    setUploading(false)
    // 第一张自动设为生效背景
    if (id && !cfg.bgActiveId) patch({ bgActiveId: id })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            个性化外观
          </DialogTitle>
          <DialogDescription>改动即时生效，仅保存在本机浏览器，不影响其他设备。</DialogDescription>
        </DialogHeader>

        {/* 显示模式 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">显示模式</h3>
          <div className="flex gap-2">
            <ModeButton active={cfg.mode === "light"} onClick={() => patch({ mode: "light" })}>
              <Sun className="h-4 w-4" />
              浅色
            </ModeButton>
            <ModeButton active={cfg.mode === "dark"} onClick={() => patch({ mode: "dark" })}>
              <Moon className="h-4 w-4" />
              深色
            </ModeButton>
          </div>
        </section>

        {/* 配色方案 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">配色方案</h3>
          <div className="flex flex-wrap items-center gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.label}
                onClick={() => patch({ palette: p.key })}
                className={
                  "relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                  (cfg.palette === p.key ? "border-foreground" : "border-transparent")
                }
                style={{ backgroundColor: p.hex }}
              >
                {cfg.palette === p.key && <Check className="h-4 w-4 text-white" />}
              </button>
            ))}
            {/* 自定义色：色板 + 取色器 */}
            <label
              title="自选主题色"
              className={
                "relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 transition-transform hover:scale-105 " +
                (cfg.palette === "custom" ? "border-foreground" : "border-transparent")
              }
              style={{
                background:
                  "conic-gradient(#f43f5e,#f59e0b,#84cc16,#0ea5e9,#8b5cf6,#f43f5e)",
              }}
            >
              <input
                type="color"
                value={cfg.customPrimary}
                onChange={(e) => patch({ palette: "custom", customPrimary: e.target.value })}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              {cfg.palette === "custom" && (
                <span className="absolute inset-0" style={{ backgroundColor: cfg.customPrimary }}>
                  <Check className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white" />
                </span>
              )}
            </label>
            {cfg.palette === "custom" && (
              <span className="text-xs text-muted-foreground">{cfg.customPrimary.toUpperCase()}</span>
            )}
          </div>
        </section>

        {/* 圆角 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            控件圆角 <span className="text-xs font-normal text-muted-foreground">{cfg.radius}px</span>
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={18}
              step={1}
              value={cfg.radius}
              onChange={(e) => patch({ radius: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
            <span
              className="shrink-0 border border-border bg-secondary"
              style={{ width: 40, height: 24, borderRadius: Math.min(cfg.radius, 12) }}
            />
          </div>
        </section>

        {/* 背景图 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">自定义背景图</h3>
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />}
              上传图片
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ""
              }}
            />
          </div>
          {cfg.bgImages.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-card px-3 py-4 text-center text-xs text-muted-foreground">
              还没有背景图。上传一张喜欢的图片（照片、渐变、插画都行），会柔和地铺在工作台底色上。
            </p>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {cfg.bgImages.map((img) => {
                const active = img.id === cfg.bgActiveId
                return (
                  <button
                    key={img.id}
                    type="button"
                    title={active ? "点击取消使用" : "设为背景"}
                    onClick={() => patch({ bgActiveId: active ? null : img.id })}
                    className={
                      "group relative aspect-[4/3] overflow-hidden rounded-md border-2 transition-colors " +
                      (active ? "border-primary" : "border-border hover:border-muted-foreground/40")
                    }
                  >
                    <img src={img.src} alt="背景图" className="h-full w-full object-cover" />
                    {active && (
                      <span className="absolute inset-0 flex items-center justify-center bg-primary/25">
                        <Check className="h-4 w-4 text-white drop-shadow" />
                      </span>
                    )}
                    <span
                      role="button"
                      title="删除这张图"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeBgImage(img.id)
                        toast.success("背景图已删除")
                      }}
                      className="absolute right-0.5 top-0.5 hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 group-hover:flex"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {activeBg && (
            <label className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
              <span className="shrink-0">遮罩深度 {cfg.bgDim}%</span>
              <input
                type="range"
                min={0}
                max={80}
                step={5}
                value={cfg.bgDim}
                onChange={(e) => patch({ bgDim: Number(e.target.value) })}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
            </label>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            提示：图片会自动压缩后存本机（透明图会转为白底）；深色模式下配暗色背景图阅读更舒适。
          </p>
        </section>

        {/* 底部操作 */}
        <footer className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="mr-1 h-4 w-4" />
            恢复默认
          </Button>
          <Button size="sm" onClick={onClose} className="bg-primary text-primary-foreground">
            完成
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
        (active
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border bg-card text-foreground hover:bg-secondary")
      }
    >
      {children}
    </button>
  )
}
