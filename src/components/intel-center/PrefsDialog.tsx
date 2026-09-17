import { useEffect, useState } from "react"
import { Loader2, Plus, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DEFAULT_FOCUS_TOPICS,
  REGION_CHOICES,
  type IntelPrefs,
} from "@/pages/IntelCenter/useIntelCenter"

type PrefsDialogProps = {
  open: boolean
  prefs: IntelPrefs
  sourceNames: string[]
  saving: boolean
  onClose: () => void
  onSave: (next: IntelPrefs) => void
}

const MAX_LIST_ITEMS = 30

/** 我的偏好：关注区域 / 重点网站 / 内容关注三维设置；仅影响本人展示，不改变收集口径 */
export function PrefsDialog({ open, prefs, sourceNames, saving, onClose, onSave }: PrefsDialogProps) {
  const [regionFocus, setRegionFocus] = useState("")
  const [focusSources, setFocusSources] = useState<string[]>([])
  const [focusTopics, setFocusTopics] = useState<string[]>([])
  const [topicInput, setTopicInput] = useState("")

  useEffect(() => {
    if (!open) return
    setRegionFocus(prefs.region_focus)
    setFocusSources([...prefs.focus_sources])
    setFocusTopics(prefs.focus_topics.length > 0 ? [...prefs.focus_topics] : [...DEFAULT_FOCUS_TOPICS])
    setTopicInput("")
  }, [open, prefs])

  const toggleSource = (sourceName: string) => {
    setFocusSources((prev) =>
      prev.includes(sourceName)
        ? prev.filter((n) => n !== sourceName)
        : prev.length >= MAX_LIST_ITEMS
          ? prev
          : [...prev, sourceName],
    )
  }

  const toggleTopic = (topic: string) => {
    setFocusTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((t) => t !== topic)
        : prev.length >= MAX_LIST_ITEMS
          ? prev
          : [...prev, topic],
    )
  }

  const addCustomTopic = () => {
    const topic = topicInput.trim().slice(0, 30)
    if (!topic) return
    setTopicInput("")
    setFocusTopics((prev) =>
      prev.includes(topic) || prev.length >= MAX_LIST_ITEMS ? prev : [...prev, topic],
    )
  }

  const customTopics = focusTopics.filter((t) => !DEFAULT_FOCUS_TOPICS.includes(t))

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            个人偏好
          </p>
          <DialogTitle className="text-xl text-foreground">我的默认界面</DialogTitle>
          <DialogDescription>
            按区域、重点网站、内容三个维度设置你的关注范围，命中的情报会带「关注」徽标并置顶展示。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-5 overflow-y-auto pr-1">
          <section>
            <h3 className="text-sm font-semibold text-foreground">关注区域</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">选定区域后，该区域的情报会标记关注并置顶</p>
            <select
              value={regionFocus}
              onChange={(ev) => setRegionFocus(ev.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">全国（不限区域）</option>
              {REGION_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-foreground">
              重点关注网站
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                已选 {focusSources.length}/{MAX_LIST_ITEMS}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              勾选的网站产出的情报都会标记关注；不勾选不影响正常展示
            </p>
            {sourceNames.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">信息源列表还在加载，请稍后重试</p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {sourceNames.map((sourceName) => (
                  <label
                    key={sourceName}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-sm transition-colors hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={focusSources.includes(sourceName)}
                      onChange={() => toggleSource(sourceName)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="truncate text-foreground" title={sourceName}>
                      {sourceName}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-foreground">
              内容关注
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                已选 {focusTopics.length}/{MAX_LIST_ITEMS}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              标题或正文命中所选词的情报会标记关注；点词切换，可自定义添加
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEFAULT_FOCUS_TOPICS.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  className={
                    focusTopics.includes(topic)
                      ? "rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors"
                      : "rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  }
                >
                  {topic}
                </button>
              ))}
              {customTopics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  title="点击删除该自定义关注词"
                  className="flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {topic}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={topicInput}
                onChange={(ev) => setTopicInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") addCustomTopic()
                }}
                maxLength={30}
                placeholder="自定义关注词，如 医保支付、电子病历"
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addCustomTopic}
                disabled={!topicInput.trim()}
                className="h-9 border-border text-card-foreground shadow-sm hover:bg-secondary disabled:opacity-50"
              >
                <Plus className="mr-1 h-3.5 w-3.5 text-primary" />
                添加
              </Button>
            </div>
          </section>

          <p className="rounded-md border border-dashed border-border bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            偏好只影响你看到的展示与「关注」标记，不改变情报收集口径；设置保存在本地。
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="border-border text-muted-foreground shadow-sm hover:text-foreground"
          >
            取消
          </Button>
          <Button
            onClick={() =>
              onSave({ region_focus: regionFocus, focus_sources: focusSources, focus_topics: focusTopics })
            }
            disabled={saving}
            className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            保存偏好
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
