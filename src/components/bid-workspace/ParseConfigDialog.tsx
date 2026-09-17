import { useEffect, useRef } from "react"
import { Loader2, Settings2, Sparkles, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { PARSE_EXTRA_SECTIONS, PARSE_KEY_SECTIONS, type ParseScope } from "@/pages/BidWorkspace/bidTypes"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type ParseConfigDialogProps = Pick<
  UseBidWorkspace,
  | "parseConfigOpen"
  | "closeParseConfig"
  | "parseConfigScope"
  | "setParseConfigScope"
  | "parseConfigExtras"
  | "toggleParseExtra"
  | "setAllParseExtras"
  | "parseConfigStar"
  | "setParseConfigStar"
  | "parseConfigTotal"
  | "saveParseConfig"
  | "confirmStartParse"
  | "parseLoading"
  | "parseSkills"
>

/** 「招标文件解析配置」弹窗：范围两档 + 关键项必选 + 其他项复选（组级三态全选） + 重点条款本地扫描 + 取消/保存配置/开始解析 */
export function ParseConfigDialog(p: ParseConfigDialogProps) {
  const scopeKey = p.parseConfigScope === "key"
  // 第十二轮改造 1：其他项组级三态全选（全勾=checked / 部分=indeterminate / 全不勾=unchecked）
  const extraCheckedCount = PARSE_EXTRA_SECTIONS.filter((d) => p.parseConfigExtras.includes(d.key)).length
  const allExtrasChecked = PARSE_EXTRA_SECTIONS.length > 0 && extraCheckedCount === PARSE_EXTRA_SECTIONS.length
  const someExtrasChecked = extraCheckedCount > 0 && !allExtrasChecked
  const allExtrasRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    // 原生三态：indeterminate 只能经 ref 设置
    if (allExtrasRef.current) allExtrasRef.current.indeterminate = someExtrasChecked
  }, [someExtrasChecked])
  return (
    <Dialog open={p.parseConfigOpen} onOpenChange={(open) => !open && p.closeParseConfig()}>
      <DialogContent className="max-w-3xl rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <Settings2 className="h-3.5 w-3.5" />
            解析配置
          </p>
          <DialogTitle className="text-xl text-foreground">招标文件解析配置</DialogTitle>
          <DialogDescription>
            关键项必选保证评分办法与废标条款不遗漏；其他项按需勾选，配置可按项目保存复用，解析只输出勾选的项。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">解析范围</p>
              <p className="text-xs text-muted-foreground">{scopeKey ? "只解析关键项（推荐），覆盖编制与评审核心字段" : "完整解析，覆盖更多招标要点，Token 消耗更高"}</p>
            </div>
            <div className="mt-2 flex rounded-full border border-border bg-secondary p-1">
              {(
                [
                  { value: "key", label: "只解析关键项", tag: "默认·推荐" },
                  { value: "full", label: "完整解析", tag: "更多 Token" },
                ] as { value: ParseScope; label: string; tag: string }[]
              ).map((opt) => {
                const active = p.parseConfigScope === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => p.setParseConfigScope(opt.value)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs ${
                        active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.tag}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">关键项</p>
              <p className="text-xs text-muted-foreground">{PARSE_KEY_SECTIONS.length} 项必选</p>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PARSE_KEY_SECTIONS.map((d) => (
                <div
                  key={d.key}
                  className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 shadow-sm"
                >
                  <input type="checkbox" checked disabled className="h-4 w-4 shrink-0 accent-primary opacity-60" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{d.title}</span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">必选</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-foreground">其他项</p>
                <label
                  className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors ${
                    scopeKey ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-secondary"
                  }`}
                >
                  <input
                    ref={allExtrasRef}
                    type="checkbox"
                    checked={allExtrasChecked}
                    disabled={scopeKey}
                    onChange={(e) => p.setAllParseExtras(e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span className="text-xs font-medium text-muted-foreground">全选</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">当前共选择 {p.parseConfigTotal} 项</p>
            </div>
            {scopeKey && (
              <p className="mt-1 text-xs text-muted-foreground">当前为「只解析关键项」，切换到「完整解析」后可编辑下列勾选项</p>
            )}
            <div className={`mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 ${scopeKey ? "opacity-60" : ""}`}>
              {PARSE_EXTRA_SECTIONS.map((d) => {
                const checked = p.parseConfigExtras.includes(d.key)
                return (
                  <label
                    key={d.key}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                      checked ? "border-primary/40 bg-primary/5" : "border-border bg-background"
                    } ${scopeKey ? "cursor-not-allowed" : "cursor-pointer hover:border-primary/30"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={scopeKey}
                      onChange={() => p.toggleParseExtra(d.key)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{d.title}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* 第十二轮改造 2：重点条款（本地扫描·零费用），key/full 两档均可勾 */}
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">重点条款</p>
              <p className="text-xs text-muted-foreground">本地扫描 · 零 AI 费用</p>
            </div>
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 shadow-sm transition-colors hover:border-primary/50">
              <input
                type="checkbox"
                checked={p.parseConfigStar}
                onChange={(e) => p.setParseConfigStar(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Star className="h-3.5 w-3.5 shrink-0 text-primary" />
                  抽取 ★/▲ 标记条款（本地扫描·零费用）
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  实质性响应条款与废标高危项，从原文逐字抽取，不产生 AI 费用
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <div className="mr-auto">
            <SkillPickerFor scope="bid-parse" source={p.parseSkills} />
          </div>
          <Button variant="outline" onClick={p.closeParseConfig} className="border-border text-muted-foreground shadow-sm hover:text-foreground">
            取消
          </Button>
          <Button variant="outline" onClick={p.saveParseConfig} className="border-primary/40 text-primary hover:bg-primary/10">
            保存配置
          </Button>
          <Button onClick={p.confirmStartParse} disabled={p.parseLoading} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
            {p.parseLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            {p.parseLoading ? "解析中…" : "开始解析"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
