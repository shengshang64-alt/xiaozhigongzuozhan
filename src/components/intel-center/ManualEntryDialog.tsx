import { useEffect, useState } from "react"
import { Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SOURCE_TYPE_LABEL, type IntelSourceType } from "@/pages/IntelCenter/useIntelCenter"

type ManualEntryDialogProps = {
  open: boolean
  title: string
  onTitle: (v: string) => void
  url: string
  onUrl: (v: string) => void
  snippet: string
  onSnippet: (v: string) => void
  itemType: IntelSourceType
  onItemType: (v: IntelSourceType) => void
  region: string
  onRegion: (v: string) => void
  saving: boolean
  onSubmit: () => void
  onClose: () => void
  isPublic: boolean
  onIsPublic: (v: boolean) => void
  fetchingUrl: boolean
  onFetchUrl: () => void
}

const TYPE_OPTIONS: { key: IntelSourceType; label: string }[] = [
  { key: "policy", label: SOURCE_TYPE_LABEL.policy },
  { key: "competitor", label: SOURCE_TYPE_LABEL.competitor },
  { key: "bid", label: SOURCE_TYPE_LABEL.bid },
  { key: "media", label: SOURCE_TYPE_LABEL.media },
]

// Radix Dialog 规范化：自带 Escape 关闭 + focus-trap；标题必填走行内校验（红框 + 提示），摘要带字数计数
export function ManualEntryDialog({
  open,
  title,
  onTitle,
  url,
  onUrl,
  snippet,
  onSnippet,
  itemType,
  onItemType,
  region,
  onRegion,
  saving,
  onSubmit,
  onClose,
  isPublic,
  onIsPublic,
  fetchingUrl,
  onFetchUrl,
}: ManualEntryDialogProps) {
  const [titleTouched, setTitleTouched] = useState(false)
  useEffect(() => {
    if (open) setTitleTouched(false)
  }, [open])
  const titleInvalid = titleTouched && !title.trim()
  const handleSubmit = () => {
    if (!title.trim()) {
      setTitleTouched(true)
      return
    }
    onSubmit()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground">手动录入情报</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            填写标题与要点即可入库，之后可用 AI 摘要打标自动补全
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 grid gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="intel-entry-title">
              标题 <span className="text-primary">*</span>
            </label>
            <Input
              id="intel-entry-title"
              value={title}
              onChange={(ev) => onTitle(ev.target.value)}
              placeholder="例如：某省医保局发布 DRG 2.0 分组方案"
              maxLength={200}
              aria-invalid={titleInvalid}
              className={`mt-1 h-9 ${titleInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {titleInvalid && <p className="mt-1 text-xs text-destructive">标题为必填项，请填写后再保存</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="intel-entry-type">
                情报类型
              </label>
              <select
                id="intel-entry-type"
                value={itemType}
                onChange={(ev) => onItemType(ev.target.value as IntelSourceType)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="intel-entry-region">
                地区（选填）
              </label>
              <Input
                id="intel-entry-region"
                value={region}
                onChange={(ev) => onRegion(ev.target.value)}
                placeholder="例如：浙江 / 全国"
                maxLength={30}
                className="mt-1 h-9"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="intel-entry-url">
              原文链接（选填，支持公众号文章链接 mp.weixin.qq.com）
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="intel-entry-url"
                value={url}
                onChange={(ev) => onUrl(ev.target.value)}
                placeholder="https://… 粘贴文章链接后可点右侧「抓取链接」自动填标题正文"
                maxLength={500}
                className="h-9 min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={onFetchUrl}
                disabled={fetchingUrl}
                className="h-9 shrink-0 border-primary text-primary hover:bg-primary/10"
              >
                {fetchingUrl ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
                {fetchingUrl ? "抓取中…" : "抓取链接"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">抓取失败时可手动填写标题与正文，不影响保存</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="intel-entry-snippet">
                内容摘要 / 正文片段（选填）
              </label>
              <span className="text-xs text-muted-foreground">{snippet.length}/2000</span>
            </div>
            <Textarea
              id="intel-entry-snippet"
              value={snippet}
              onChange={(ev) => onSnippet(ev.target.value)}
              placeholder="粘贴情报正文或要点，之后可用 AI 摘要打标自动补全摘要与标签"
              rows={4}
              maxLength={2000}
              className="mt-1 leading-relaxed"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2.5">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(ev) => onIsPublic(ev.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">公开到团队</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {isPublic ? "全员可见" : "仅自己可见（默认）"}
            </span>
          </label>
        </div>

        <footer className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {saving ? "保存中…" : "保存情报"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
