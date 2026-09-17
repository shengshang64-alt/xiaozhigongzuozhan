import { useState, type ReactNode } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MaterialOption, MaterialRef } from "@/pages/PptQuote/pptQuoteTypes"
import type { QuoteOppOption } from "@/pages/PptQuote/usePptQuote"
import { MaterialPicker } from "./MaterialPicker"

type NewQuoteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  quoteName: string
  setQuoteName: (value: string) => void
  quoteRef: MaterialRef | null
  setQuoteRef: (ref: MaterialRef | null) => void
  solutionOptions: MaterialOption[]
  bidOptions: MaterialOption[]
  materialLoading: boolean
  oppOptions: QuoteOppOption[]
  oppId: string
  setOppId: (value: string) => void
  busy: boolean
  onCreate: () => void
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

export function NewQuoteDialog({
  open,
  onOpenChange,
  quoteName,
  setQuoteName,
  quoteRef,
  setQuoteRef,
  solutionOptions,
  bidOptions,
  materialLoading,
  oppOptions,
  oppId,
  setOppId,
  busy,
  onCreate,
}: NewQuoteDialogProps) {
  const [nameError, setNameError] = useState("")

  const handleCreate = () => {
    if (!quoteName.trim()) {
      setNameError("请填写报价名称")
      return
    }
    setNameError("")
    onCreate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          setNameError("")
          onOpenChange(v)
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建报价</DialogTitle>
          <DialogDescription>
            创建后将预置软件许可 / 实施服务 / 硬件三方 / 年保维保四个分组，可手动录入行项或用 AI 生成初稿
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">报价名称 *</span>
            <input
              value={quoteName}
              onChange={(e) => {
                setQuoteName(e.target.value)
                if (nameError) setNameError("")
              }}
              placeholder="如：某某市人民医院智慧医院建设项目报价"
              className={`${inputCls} ${nameError ? "border-destructive focus-visible:ring-destructive" : ""}`}
              aria-invalid={Boolean(nameError)}
            />
            {nameError && <span className="mt-1 block text-xs text-destructive">{nameError}</span>}
          </label>
          <MaterialPicker
            solutionOptions={solutionOptions}
            bidOptions={bidOptions}
            loading={materialLoading}
            value={quoteRef}
            onChange={setQuoteRef}
          />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">关联商机（可选）</span>
            <select
              value={oppId}
              onChange={(e) => setOppId(e.target.value)}
              className={inputCls}
            >
              <option value="">不关联（创建后可在客户管理中跟进）</option>
              {oppOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.customer_name ? `${o.customer_name} · ${o.opp_name}` : o.opp_name}
                </option>
              ))}
            </select>
            {oppId && (
              <span className="mt-1.5 block rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
                关联后可在报价编辑页勾选「保存时同步金额到商机预计金额」
              </span>
            )}
          </label>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "创建中…" : "创建报价"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type QuoteDraftDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftRef: MaterialRef | null
  setDraftRef: (ref: MaterialRef | null) => void
  solutionOptions: MaterialOption[]
  bidOptions: MaterialOption[]
  materialLoading: boolean
  busy: boolean
  onGenerate: () => void
  /** 「AI 生成行项初稿」旁的带入技能选择器（页面注入） */
  quotePickerSlot?: ReactNode
}

export function QuoteDraftDialog({
  open,
  onOpenChange,
  draftRef,
  setDraftRef,
  solutionOptions,
  bidOptions,
  materialLoading,
  busy,
  onGenerate,
  quotePickerSlot,
}: QuoteDraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            按方案生成报价初稿
          </DialogTitle>
          <DialogDescription>
            选择一个方案或标书项目，AI 会读取其大纲与正文摘要，按建设内容推荐四个分组下的行项（名称 / 规格 / 单位 / 建议数量 / 参考单价），生成后全部可人工修改
          </DialogDescription>
        </DialogHeader>
        <MaterialPicker
          solutionOptions={solutionOptions}
          bidOptions={bidOptions}
          loading={materialLoading}
          value={draftRef}
          onChange={setDraftRef}
        />
        {busy && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            AI 正在按建设内容推荐行项，请稍候…
          </p>
        )}
        <DialogFooter>
          {quotePickerSlot && <div className="mr-auto">{quotePickerSlot}</div>}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy || !draftRef}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? "生成中…" : "AI 生成行项初稿"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
