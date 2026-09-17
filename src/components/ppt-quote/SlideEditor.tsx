import { useEffect, useState, type ReactNode } from "react"
import { Loader2, Minimize2, PenLine, PlusCircle } from "lucide-react"
import { REFINE_LABEL, type RefineKind, type Slide } from "@/pages/PptQuote/pptQuoteTypes"

type SlideEditorProps = {
  slide: Slide | null
  index: number
  total: number
  slideAiKind: RefineKind | null
  /** B4：自动保存失败态——徽章变「自动保存失败」（destructive），横幅在编辑器工作区顶部 */
  persistFailed?: boolean
  onTitleChange: (value: string) => void
  onBulletsChange: (value: string) => void
  onNotesChange: (value: string) => void
  onRefine: (kind: RefineKind) => void
  /** 「改写 / 扩写 / 精简」旁的带入技能选择器（页面注入） */
  refinePickerSlot?: ReactNode
}

const REFINE_ICONS: Record<RefineKind, typeof PenLine> = {
  rewrite: PenLine,
  expand: PlusCircle,
  condense: Minimize2,
}

export function SlideEditor({
  slide,
  index,
  total,
  slideAiKind,
  persistFailed,
  onTitleChange,
  onBulletsChange,
  onNotesChange,
  onRefine,
  refinePickerSlot,
}: SlideEditorProps) {
  // A2-8：要点列表编辑期保留原文（空行 / 首尾空格不即时吞掉），失焦或触发 AI 改写时统一 trim 提交
  const [bulletsDraft, setBulletsDraft] = useState<{ slideId: string; text: string } | null>(null)
  // B5：精修落定（slideAiKind 非空 → null）后清掉本地草稿，界面始终显示精修结果，
  // 杜绝旧草稿优先显示导致的双向不一致与失焦回写覆盖
  useEffect(() => {
    if (slideAiKind === null) setBulletsDraft(null)
  }, [slideAiKind])
  const commitBulletsDraft = () => {
    if (bulletsDraft && slide && bulletsDraft.slideId === slide.id) {
      onBulletsChange(bulletsDraft.text)
    }
    setBulletsDraft(null)
  }
  // B5：精修进行中锁定编辑（生成窗口数十秒，落定按旧快照合并会无声覆盖用户输入）
  const refineLocked = !!slideAiKind
  if (!slide) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-card py-20 text-sm text-muted-foreground shadow-md">
        从左侧选择一页开始编辑
      </div>
    )
  }
  const refineKinds: RefineKind[] = ["rewrite", "expand", "condense"]
  return (
    <div className="rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-4">
        <h3 className="text-sm font-semibold text-foreground">
          第 {index + 1} / {total} 页
          {refineLocked ? (
            <span className="badge-success ml-2">AI 精修中 · 编辑已锁定</span>
          ) : persistFailed ? (
            <span className="ml-2 rounded-full border border-transparent bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              自动保存失败
            </span>
          ) : (
            <span className="badge-neutral ml-2">编辑中 · 自动保存</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {refinePickerSlot}
          {refineKinds.map((kind) => {
            const Icon = REFINE_ICONS[kind]
            const busy = slideAiKind === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  commitBulletsDraft()
                  onRefine(kind)
                }}
                disabled={!!slideAiKind}
                className={
                  busy
                    ? "flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    : "flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                {REFINE_LABEL[kind]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-5 p-4 lg:p-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">页标题</span>
          <input
            value={slide.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="本页标题"
            disabled={refineLocked}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-base font-semibold text-foreground placeholder:text-muted-foreground placeholder:font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            要点列表（每行一条）
            <span>{slide.bullets.length} 条{slide.bullets.length > 6 ? " · 建议精简到 6 条以内" : ""}</span>
          </span>
          <textarea
            value={bulletsDraft && bulletsDraft.slideId === slide.id ? bulletsDraft.text : slide.bullets.join("\n")}
            onChange={(e) => setBulletsDraft({ slideId: slide.id, text: e.target.value })}
            onBlur={commitBulletsDraft}
            rows={7}
            disabled={refineLocked}
            placeholder={"每行一条要点，如：\n覆盖全院 42 个科室的一体化电子病历\n闭环管理医嘱、用药与检验检查"}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            讲稿备注（导出 PPT 时写入演讲者备注）
            <span>{slide.notes.length} 字</span>
          </span>
          <textarea
            value={slide.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={5}
            disabled={refineLocked}
            placeholder="本页汇报时口头讲解的内容，导出后在 PowerPoint 演讲者备注中可见"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>
    </div>
  )
}
