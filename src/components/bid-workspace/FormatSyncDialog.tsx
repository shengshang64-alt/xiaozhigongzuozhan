import { useEffect, useState } from "react"
import { Check, FileStack, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FormatSettings, TemplateProfile } from "@/pages/BidWorkspace/bidTypes"
import type { FormatField } from "@/pages/BidWorkspace/bidDocxFormatExtract"
import { extractTemplateProfileBundle } from "@/pages/BidWorkspace/templateProfile"

const AUTO_KEY = "xiaozhi.bid.formatSync.auto.v1"

type Props = {
  open: boolean
  file: File | null
  current: FormatSettings | null
  /** R47（B20）：招标原文。有值时才把模板要求行与评分点 / ★ 条款做本地对齐（零 AI）。 */
  tenderText?: string
  onClose: () => void
  onApply: (patch: Partial<FormatSettings>, autoNextTime: boolean, profile?: TemplateProfile | null) => void
}

/**
 * R47（B20）底稿同步格式弹窗：识别链路从「只抽纸张/正文/标题」升级为完整模板画像
 * （1-6 级标题 / 表格 / 页眉页脚 / 页码 / 目录 / 标题编号 / 模板要求行 / 对齐结论）。
 * 一次解析同时产出「可勾选格式项」与「模板画像」；用户勾选后应用格式，画像随应用一并落库，
 * 之后大纲与正文生成会自动消费画像里的写作要求（见 templateProfile.templateRequirementLines）。
 */
export function FormatSyncDialog({ open, file, current, tenderText, onClose, onApply }: Props) {
  const [busy, setBusy] = useState(false)
  const [fields, setFields] = useState<FormatField[]>([])
  const [profile, setProfile] = useState<TemplateProfile | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [autoNext, setAutoNext] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !file) {
      setFields([]); setProfile(null); setSelected(new Set()); setError("")
      return
    }
    setBusy(true)
    setAutoNext(localStorage.getItem(AUTO_KEY) === "1")
    void extractTemplateProfileBundle(file, { tenderText })
      .then(({ profile: p, fields: fs }) => {
        setProfile(p)
        setFields(fs)
        setSelected(new Set(fs.map((f) => f.key)))
        if (!fs.length && !p.requirements.length) {
          setError("未从这份 docx 里提取到可识别的格式或要求（可能是扫描版或无样式模板）")
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "格式提取失败"))
      .finally(() => setBusy(false))
  }, [open, file, tenderText])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const apply = () => {
    const patch: Partial<FormatSettings> = {}
    for (const f of fields) if (selected.has(f.key)) f.apply(patch)
    if (autoNext) localStorage.setItem(AUTO_KEY, "1")
    else localStorage.removeItem(AUTO_KEY)
    onApply(patch, autoNext, profile)
  }

  const reqCounts = profile ? countKinds(profile) : null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileStack className="h-4 w-4 text-primary" />
            从底稿同步格式
          </DialogTitle>
          <DialogDescription>
            从「{file?.name ?? "底稿"}」提取到 {fields.length} 项格式设置
            {profile && profile.requirements.length > 0 ? ` 与 ${profile.requirements.length} 条模板写作要求` : ""}
            。勾选要应用的格式项，"应用"后格式合并到本项目配置，模板要求写入大纲与正文写作注入。
          </DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在解析 docx 样式表与模板要求...
          </div>
        )}
        {error && !busy && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {!busy && profile && (
          <div className="space-y-1 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs">
            <p className="font-medium text-foreground">模板画像 · {profile.sourceFileName || "底稿"}</p>
            <p className="text-muted-foreground">{headingSummary(profile)}</p>
            <p className="text-muted-foreground">{layoutSummary(profile)}</p>
            {reqCounts && profile.requirements.length > 0 && (
              <p className="text-muted-foreground">
                模板要求 {profile.requirements.length} 条（内容 {reqCounts.content} · 格式 {reqCounts.format} · ★/▲ {reqCounts.star}）
                {profile.alignment.scoreItemCount + profile.alignment.starClauseCount > 0
                  ? `；与招标对齐：评分点 ${profile.alignment.scoreItemCount} 项 + ★ 条款 ${profile.alignment.starClauseCount} 条，命中 ${profile.alignment.matched}，模板未覆盖 ${profile.alignment.unmatched}`
                  : "；未提供招标原文，暂未对齐"}
              </p>
            )}
            {profile.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {profile.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!busy && fields.length > 0 && (
          <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="px-2 py-1.5 text-left font-medium">项</th>
                  <th className="px-2 py-1.5 text-left font-medium">当前</th>
                  <th className="px-2 py-1.5 text-left font-medium">底稿提取值</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const cur = current ? currentValue(f.key, current) : "-"
                  const isSel = selected.has(f.key)
                  return (
                    <tr key={f.key} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(f.key)}
                          className={`inline-flex h-4 w-4 items-center justify-center rounded border ${isSel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
                          aria-label={isSel ? "取消选中" : "选中"}
                        >
                          {isSel && <Check className="h-3 w-3" />}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 font-medium text-foreground">{f.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground line-through decoration-muted-foreground/40">{cur}</td>
                      <td className="px-2 py-1.5 text-foreground" title={f.evidence ?? ""}>
                        <span className="font-mono text-xs">{f.value}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => setAutoNext(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#0e9f8a]"
          />
          下次上传底稿时自动应用全部提取项（不再弹此窗）
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={apply}
            disabled={busy || !selected.size}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            应用 {selected.size} 项格式
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function countKinds(p: TemplateProfile): { content: number; format: number; star: number } {
  const out = { content: 0, format: 0, star: 0 }
  for (const r of p.requirements) out[r.kind] += 1
  return out
}

function headingSummary(p: TemplateProfile): string {
  const named = p.headings.filter((h) => h.source === "style" && h.font)
  const inherited = p.headings.filter((h) => h.source === "sampled").map((h) => h.level)
  const parts: string[] = []
  if (named.length) {
    parts.push(
      `标题：${named
        .slice(0, 6)
        .map((h) => `${h.level}级 ${h.font}${h.sizePt ? ` ${h.sizePt}pt` : ""}`)
        .join(" / ")}`,
    )
  } else {
    parts.push("标题：模板样式表未定义，按本项目缺省")
  }
  if (inherited.length) parts.push(`${inherited.join("/")} 级按上一级推定`)
  return parts.join("；")
}

function layoutSummary(p: TemplateProfile): string {
  const parts = [
    `${p.page.paper} 边距 上${p.page.margins.top}/下${p.page.margins.bottom}/左${p.page.margins.left}/右${p.page.margins.right}cm`,
    `正文 ${p.body.font || "未识别"}${p.body.sizePt ? ` ${p.body.sizePt}pt` : ""} · ${p.body.lineSpacing}`,
    `标题编号 ${p.titleNumbering}`,
    p.toc ? "含目录" : "无目录",
    p.pageNumber ? "含页码" : "无页码",
    p.header || p.footer ? `页眉页脚「${(p.header || p.footer).slice(0, 24)}」` : "无页眉页脚",
  ]
  if (p.cover) parts.push("首页为封面")
  return parts.join(" · ")
}

function currentValue(key: string, s: FormatSettings): string {
  switch (key) {
    case "paper": return s.paper
    case "margins": {
      const m = s.margins
      return `上${m.top} 下${m.bottom} 左${m.left} 右${m.right} cm`
    }
    case "bodyFont": return s.body?.font ?? "-"
    case "bodySize": return s.body?.size ?? "-"
    case "bodyLineSpacing": return s.body?.lineSpacing ?? "-"
    case "table": return `边框 ${s.table?.border ?? "-"} · 内容 ${s.table?.contentFont ?? "-"}`
    case "headerFooter": return s.headerFooter ? "有页眉页脚" : "无页眉页脚"
    case "pageNumber": return s.pageNumber ? "有页码" : "无页码"
    case "toc": return s.toc ? "含目录" : "不含目录"
    case "titleNumbering": return s.titleNumbering
    default: {
      const mm = /^heading([1-6])$/.exec(key)
      if (mm) {
        const h = s.heading?.[Number(mm[1]) - 1]
        if (!h) return "-"
        const parts: string[] = []
        if (h.font) parts.push(`字体 ${h.font}`)
        if (h.size) parts.push(`字号 ${h.size}`)
        return parts.join(" . ") || "-"
      }
      return "-"
    }
  }
}