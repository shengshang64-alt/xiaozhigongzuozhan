import { useMemo } from "react"
import { AlertTriangle, Check, FileText, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// ① 导入招标 · 右栏（UX-v2：prototype/bid/import.html 右栏 1:1）
//
// 原型右栏两块：
//   · 自动识别信息（表格：字段 / 识别值 / 识别状态；已识别 N 项，其中 M 项需你确认）
//   · 同编号项目拦截警示（既有同编号项目时给「覆盖 / 新建版本」二选一）
//
// 数据边界（不造假）：
//   识别值全部取项目档案现有字段（project_name / tender_no / hospital / bid_open_date /
//   tender_budget 等），没有的字段显示「未识别」而不是编一个值。
//   「需确认」= 该字段为空或刚刚被人工改过（现网没有 OCR 置信度数据，故按「有值/无值」判，
//   并在说明里如实写清判定口径，不假装有置信度）。
//   同编号重复检测走既有 findDuplicateTenderNo（② 屏也在用同一口径）。
// ---------------------------------------------------------------------------

/** 识别字段定义：字段名 + 取值 + 是否必填（必填缺失即「需确认」） */
type FieldRow = {
  label: string
  value: string
  /** 该字段是否必填（缺失时状态为「需确认」） */
  required?: boolean
  mono?: boolean
}

type ImportRecognizeProps = {
  /** 项目档案；未选中项目时为 null（面板退化为全「未识别」空态） */
  project: BidProjectRecord | null
  /** 同编号的其他项目（既有判重口径；空数组=无冲突） */
  duplicateProjects?: BidProjectRecord[]
  /** 重新识别：从招标原文再抽一遍（走既有解析，不新增 AI 调用） */
  onReRecognize?: () => void
  /** 项目档案编辑入口（现网在项目卡里改，这里给个跳转提示用） */
  onEditMeta?: () => void
  busy?: boolean
}

export function ImportRecognizePanel({
  project,
  duplicateProjects,
  onReRecognize,
  onEditMeta,
  busy,
}: ImportRecognizeProps) {
  const rows = useMemo<FieldRow[]>(() => {
    const p = (project ?? {}) as unknown as Record<string, unknown>
    const s = (k: string) => String(p[k] ?? "").trim()
    return [
      { label: "项目名称", value: s("project_name"), required: true },
      { label: "招标编号", value: s("tender_no"), required: true, mono: true },
      { label: "采购人", value: s("hospital"), required: true },
      { label: "代理机构", value: s("agency_name") || s("agency"), mono: false },
      { label: "预算金额", value: s("tender_budget") || s("budget"), mono: true },
      { label: "开标时间", value: s("bid_open_date"), required: true, mono: true },
    ]
  }, [project])

  const missing = rows.filter((r) => r.required && !r.value)
  const recognized = rows.filter((r) => r.value).length
  const dupes = duplicateProjects ?? []

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="text-[13.5px] font-semibold text-card-foreground">自动识别信息</h3>
          <span className="text-[11.5px] text-muted-foreground">
            已识别 {recognized} 项{missing.length > 0 ? `，${missing.length} 项需确认` : ""}
          </span>
          <div className="flex-1" />
          {onReRecognize && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onReRecognize}
              title="从已上传的招标原文重新抽取字段（复用既有解析缓存，不重复计费）"
              className="h-7 border-border px-2 text-[11.5px] text-card-foreground hover:bg-secondary"
            >
              <Sparkles className="mr-1 h-3 w-3" />
              重新识别
            </Button>
          )}
        </header>

        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-[11.5px] text-muted-foreground">
              <th className="px-3.5 py-2 font-medium">字段</th>
              <th className="px-2 py-2 font-medium">识别值</th>
              <th className="w-28 px-3.5 py-2 text-right font-medium">识别状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const needConfirm = r.required && !r.value
              return (
                <tr key={r.label} className={`border-b border-border/40 last:border-b-0 ${needConfirm ? "bg-warning/[0.04]" : ""}`}>
                  <td className="px-3.5 py-2 font-medium text-card-foreground">{r.label}</td>
                  <td className={`px-2 py-2 ${r.mono ? "font-mono tabular-nums" : ""} ${r.value ? "text-card-foreground" : "text-muted-foreground"}`}>
                    {r.value || "未识别"}
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    {needConfirm ? (
                      <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        需确认
                      </span>
                    ) : r.value ? (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
                        <Check size={10} strokeWidth={3} />
                        已识别
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">可选</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
          {missing.length > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
              <span className="min-w-0 flex-1 leading-relaxed">
                必填项「{missing.map((m) => m.label).join("、")}」还没识别出来。招标原文里若确有该项，请在上方原文里补；
                缺编号或开标时间会直接影响 ② 解析与 ⑦ 组卷的时间节点。
              </span>
              {onEditMeta && (
                <Button size="sm" variant="ghost" onClick={onEditMeta} className="h-6 shrink-0 px-2 text-[11px] text-primary">
                  去修改
                </Button>
              )}
            </>
          ) : (
            <>
              <Check size={11} strokeWidth={3} className="shrink-0 text-primary" />
              <span>必填字段齐全。识别值取自项目档案，与招标原文有出入时可随时改。</span>
            </>
          )}
        </footer>
      </section>

      {/* 同编号拦截（原型 .alert--amber 同位）：既有同编号项目时不能静默覆盖 */}
      {dupes.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3.5 py-2.5">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-card-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              检测到 <b>{dupes.length}</b> 个同编号项目
              <span className="text-muted-foreground">
                （{dupes.map((d) => d.project_name).slice(0, 3).join("、")}
                {dupes.length > 3 ? " 等" : ""}）。继续导入会新建一个独立项目，不会覆盖已有项目的历史正文。
              </span>
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
