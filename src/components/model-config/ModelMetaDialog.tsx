import { useEffect, useState } from "react"
import { Coins, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { resolveModelProfile, resolveQuotaHint } from "@/lib/modelProfiles"
import type { ModelMetaEntry, ModelQuota } from "@/lib/modelMetaLocal"

type Props = {
  open: boolean
  modelId: string
  configName: string
  initial: ModelMetaEntry | null
  busy: boolean
  onClose: () => void
  onSubmit: (patch: { specialty: string; tags: string[]; quota: ModelQuota | null }) => void
}

/**
 * R-041 模型元数据编辑弹窗：擅长（文本）+ 额度（结构化 tier + 数字）。
 */
export function ModelMetaDialog({ open, modelId, configName, initial, busy, onClose, onSubmit }: Props) {
  const [specialty, setSpecialty] = useState("")
  const [tagsRaw, setTagsRaw] = useState("")
  const [tier, setTier] = useState<ModelQuota["tier"]>("go")
  const [req5h, setReq5h] = useState<string>("")
  const [monthly, setMonthly] = useState<string>("")
  const [customText, setCustomText] = useState("")

  const quotaHint = resolveQuotaHint(modelId)
  const resolved = resolveModelProfile(modelId)
  const suggested = resolved.profile && resolved.source !== "user" ? resolved.profile : null

  useEffect(() => {
    if (!open) return
    setSpecialty(initial?.specialty ?? "")
    setTagsRaw((initial?.tags ?? []).join("、"))
    const q = initial?.quota
    if (q) {
      setTier(q.tier)
      setReq5h(q.requests5h != null ? String(q.requests5h) : "")
      setMonthly(q.monthlyUsd != null ? String(q.monthlyUsd) : "")
      setCustomText(q.customText ?? "")
    } else {
      // 默认跟随内置建议（若有）
      setTier(quotaHint?.tier ?? "go")
      setReq5h(quotaHint && quotaHint.requests5h >= 0 ? String(quotaHint.requests5h) : "")
      setMonthly(quotaHint && quotaHint.monthlyUsd >= 0 ? String(quotaHint.monthlyUsd) : "")
      setCustomText("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, quotaHint?.tier])

  const handleUseSuggested = () => {
    if (!suggested) return
    setSpecialty(suggested.specialty)
    setTagsRaw(suggested.tags.join("、"))
  }

  const handleUseQuotaHint = () => {
    if (!quotaHint) return
    setTier(quotaHint.tier)
    setReq5h(quotaHint.requests5h >= 0 ? String(quotaHint.requests5h) : "")
    setMonthly(quotaHint.monthlyUsd >= 0 ? String(quotaHint.monthlyUsd) : "")
    setCustomText("")
  }

  const handleSubmit = () => {
    const tags = tagsRaw
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5)
    let quota: ModelQuota | null = null
    if (tier === "unlimited") {
      quota = { tier: "unlimited", requests5h: -1, monthlyUsd: -1 }
    } else if (tier === "custom") {
      if (customText.trim()) quota = { tier: "custom", customText: customText.trim() }
    } else {
      const r = Number(req5h)
      const m = Number(monthly)
      if (Number.isFinite(r) && Number.isFinite(m) && r >= 0 && m >= 0) {
        quota = { tier, requests5h: Math.round(r), monthlyUsd: Math.round(m) }
      }
    }
    onSubmit({ specialty: specialty.trim(), tags, quota })
  }

  const tierLabel: Record<ModelQuota["tier"], string> = {
    go: "Go 档",
    go_plus: "Go Plus 档",
    unlimited: "∞ 限时免费",
    custom: "自定义（自由文本）",
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>标注模型 · {modelId}</DialogTitle>
          <DialogDescription>
            为「{configName}」下的这个模型添加「擅长什么」和「剩余额度」。数据只保存在本机浏览器。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {suggested && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  内置建议：{suggested.specialty}
                  {suggested.tags.length > 0 && (
                    <span className="ml-1 text-muted-foreground">（{suggested.tags.join("、")}）</span>
                  )}
                </p>
                <button type="button" onClick={handleUseSuggested} className="mt-1 text-primary underline-offset-2 hover:underline">
                  一键填入擅长
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="mm-spec" className="text-sm font-medium text-foreground">
              擅长（可选，一句话人话，≤60 字）
            </label>
            <Textarea
              id="mm-spec"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value.slice(0, 60))}
              placeholder="例如：长文档理解强，适合标书与方案初稿"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mm-tags" className="text-sm font-medium text-foreground">
              场景标签（可选，用 、 或空格分隔，最多 5 个）
            </label>
            <Input id="mm-tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="长上下文、代码、推理" maxLength={80} />
          </div>

          <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Coins className="h-3.5 w-3.5 text-primary" />
              额度（量化）
            </label>
            <div className="flex items-center gap-2">
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as ModelQuota["tier"])}
                className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
              >
                {(Object.keys(tierLabel) as ModelQuota["tier"][]).map((t) => (
                  <option key={t} value={t}>{tierLabel[t]}</option>
                ))}
              </select>
              {quotaHint && (
                <button type="button" onClick={handleUseQuotaHint} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20">
                  <Sparkles className="h-3 w-3" />
                  一键填入内置参考
                </button>
              )}
            </div>
            {quotaHint && (
              <p className="text-xs text-muted-foreground" title={quotaHint.displayFull}>
                内置参考：<span className="font-mono">{quotaHint.display}</span>
                {quotaHint.displayFull !== quotaHint.display && <span>（hover 查看 Go Plus 档）</span>}
              </p>
            )}
            {tier === "unlimited" && (
              <p className="text-xs text-muted-foreground">∞ 限时免费，无请求数与月费限制。</p>
            )}
            {tier === "custom" && (
              <Input value={customText} onChange={(e) => setCustomText(e.target.value.slice(0, 40))} placeholder="自由文本：¥50 剩余 / 500 万 tokens / ..." maxLength={40} />
            )}
            {(tier === "go" || tier === "go_plus") && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">请求数 / 5h</label>
                  <Input type="number" min={0} value={req5h} onChange={(e) => setReq5h(e.target.value)} placeholder="34670" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">月费（美元）</label>
                  <Input type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="80" />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={handleSubmit} disabled={busy} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            保存标注
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
