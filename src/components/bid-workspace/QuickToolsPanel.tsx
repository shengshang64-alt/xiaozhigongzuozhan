import { useEffect, useState } from "react"
import { toast } from "sonner"
import { FileUp, Loader2, Save, ScanSearch, Scale, ShieldCheck, Wrench, Copy, ClipboardCheck, AlertTriangle, BadgeCheck, Wand2 } from "lucide-react"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { UseBidWorkspace, ToolKind } from "@/pages/BidWorkspace/useBidWorkspace"
import { TOOL_LABEL } from "@/pages/BidWorkspace/useBidWorkspace"
import { extractStarClauses, starClauseCount, starClauseSectionFrom, upsertParseSection, type ParseReport } from "@/pages/BidWorkspace/bidTypes"
import { ParseReportPanel } from "@/components/bid-workspace/ParseReportPanel"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { DupPairCard } from "@/components/bid-workspace/DupCheckPanel"
import { VoidItemsList } from "@/components/bid-workspace/VoidCheckPanel"
import { EvalResultView } from "@/components/bid-workspace/MockEvalPanel"

type QuickToolsPanelProps = Pick<
  UseBidWorkspace,
  | "toolKind"
  | "switchTool"
  | "toolMaterial"
  | "setToolMaterial"
  | "toolBidText"
  | "setToolBidText"
  | "toolFileBusy"
  | "handleToolFile"
  | "toolRunning"
  | "runQuickTool"
  | "parseLoading"
  | "parseChunkProgress"
  | "toolParseWarnings"
  | "reparseToolSection"
  | "reparseBusyKey"
  | "toolParseResult"
  | "toolDupResult"
  | "toolVoidResult"
  | "toolEvalResult"
  | "toolHasResult"
  | "saveToolAsProject"
  | "parseSkills"
  | "canFactCheck"
  | "factProjectName"
  | "factCheckBusy"
  | "startFactCheck"
  | "factCheckOpen"
  | "setFactCheckOpen"
  | "factCheckResult"
  | "factPatchBusy"
  | "startFactPatch"
>

const TOOLS: { kind: ToolKind; desc: string; icon: typeof ScanSearch; materialLabel: string; materialPlaceholder: string; needBid: boolean }[] = [
  {
    kind: "parse",
    desc: "上传招标文件，提取评分办法、资质要求与废标条款",
    icon: ScanSearch,
    materialLabel: "招标文件文本",
    materialPlaceholder: "上传 .docx / .pdf 或直接粘贴招标公告、评分办法、废标条款等内容…",
    needBid: false,
  },
  {
    kind: "dup",
    desc: "粘贴标书正文，与你的历史投标项目对比相似段落",
    icon: Copy,
    materialLabel: "待查重的标书正文",
    materialPlaceholder: "上传或粘贴需要查重的投标文件正文…",
    needBid: false,
  },
  {
    kind: "void",
    desc: "粘贴废标条款与标书正文，逐条比对响应情况",
    icon: ShieldCheck,
    materialLabel: "废标条款（每行一条）",
    materialPlaceholder: "如：\n投标文件未加盖公章的\n报价超过采购预算的\n未提供社保证明材料的",
    needBid: true,
  },
  {
    kind: "eval",
    desc: "粘贴评分办法与标书正文，AI 逐项打分给改进建议",
    icon: Scale,
    materialLabel: "评分办法（每行一条：评分项：分值）",
    materialPlaceholder: "如：\n技术方案完整性：20\n项目实施方案：15\n售后服务承诺：10\n类似项目业绩：8",
    needBid: true,
  },
]

export function QuickToolsPanel(p: QuickToolsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tool = TOOLS.find((t) => t.kind === p.toolKind) ?? TOOLS[0]
  // 工具结果为本地副本，可直接人工修改；「另存为项目」后进入流水线继续完善
  const [localReport, setLocalReport] = useState<ParseReport | null>(null)
  useEffect(() => {
    setLocalReport(p.toolParseResult)
  }, [p.toolParseResult])

  return (
    <main className="animate-in fade-in duration-500">
      <section className="mx-auto max-w-7xl px-4 pt-8">
        <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-8 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <Wrench className="h-3.5 w-3.5" />
            不建项目也能直接用
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">快捷工具</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            临时场景（帮同事看一份招标文件、快速查重一段标书）直接上传材料即用，结果可另存为投标项目继续走完整流水线。
          </p>
        </header>

        <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          {TOOLS.map((t) => {
            const Icon = t.icon
            const active = t.kind === p.toolKind
            return (
              <button
                key={t.kind}
                type="button"
                onClick={() => p.switchTool(t.kind)}
                className={`flex flex-col items-start gap-3 rounded-lg border p-5 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{TOOL_LABEL[t.kind]}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t.desc}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* 第十六轮 B1 改造 1.3：事实一致性核对（依赖已打开项目的全局事实表与各章正文，段落本地检索零费用） */}
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-md">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">事实一致性核对</h2>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {p.canFactCheck
                  ? `对「${p.factProjectName}」逐条核对全局事实与各章命中段落是否口径一致，输出矛盾清单与修改建议（段落检索在本地完成，仅核对走一次 AI 调用）`
                  : "需要先在项目列表打开一个已有全局事实与章节正文的标书项目，才能进行核对"}
              </p>
            </div>
          </div>
          <Button
            onClick={p.startFactCheck}
            disabled={p.factCheckBusy || !p.canFactCheck}
            className="shrink-0 border-primary/40 text-primary shadow-sm hover:bg-primary/10"
            variant="outline"
          >
            {p.factCheckBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
            {p.factCheckBusy ? "核对中…" : "开始核对"}
          </Button>
        </section>

        <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
            <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{tool.materialLabel}</h2>
                <p className="text-xs text-muted-foreground">文件在浏览器本地解析，不上传原文件</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={p.toolFileBusy}
                onClick={() => fileInputRef.current?.click()}
                className="border-border text-card-foreground shadow-sm hover:bg-secondary"
              >
                {p.toolFileBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1 h-3.5 w-3.5" />}
                {p.toolFileBusy ? "解析中…" : "上传文件"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  void p.handleToolFile(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <Textarea
                value={p.toolMaterial}
                onChange={(e) => p.setToolMaterial(e.target.value)}
                placeholder={tool.materialPlaceholder}
                className="min-h-56 flex-1 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
              />
              {tool.needBid && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">投标文件正文（可同样上传 .docx / .pdf 后粘贴到这里）</p>
                  <Textarea
                    value={p.toolBidText}
                    onChange={(e) => p.setToolBidText(e.target.value)}
                    placeholder="粘贴待检查 / 待评标的投标文件正文…"
                    className="min-h-32 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
                  />
                </div>
              )}
              <Button
                onClick={p.runQuickTool}
                disabled={p.toolRunning || !p.toolMaterial.trim()}
                className="w-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                {p.toolRunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}
                {p.toolRunning ? `正在执行「${TOOL_LABEL[p.toolKind]}」…` : `运行「${TOOL_LABEL[p.toolKind]}」`}
              </Button>
            </div>
          </section>

          <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
            <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">结果</h2>
                <p className="text-xs text-muted-foreground">AI 结果均可人工修改，确认后另存为项目</p>
              </div>
              {p.toolHasResult && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void p.saveToolAsProject()}
                  className="border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Save className="mr-1 h-3.5 w-3.5" />
                  另存为项目
                </Button>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {p.toolRunning || (p.toolKind === "parse" && p.parseLoading) ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm font-medium text-foreground">
                    {p.toolKind === "parse" && p.parseChunkProgress
                      ? `正在解析第 ${p.parseChunkProgress.current}/${p.parseChunkProgress.total} 段…`
                      : "执行中，约需 1-2 分钟…"}
                  </p>
                </div>
              ) : p.toolKind === "parse" ? (
                localReport ? (
                  <ParseReportPanel
                    report={localReport}
                    onChange={(patch) => setLocalReport((prev) => (prev ? { ...prev, ...patch } : prev))}
                    onReparse={p.reparseToolSection}
                    reparseBusyKey={p.reparseBusyKey}
                    skillPickerSlot={<SkillPickerFor scope="bid-parse" source={p.parseSkills} align="right" />}
                    tenderText={p.toolMaterial}
                    warnings={p.toolParseWarnings}
                    onRescanStar={() => {
                      // 第十二轮改造 2：工具报告同样支持 ★/▲ 重点条款本地重扫（零费用，更新本地副本）
                      const lines = extractStarClauses(p.toolMaterial)
                      const sec = starClauseSectionFrom(lines)
                      if (!sec) {
                        toast.info("未在材料中发现 ★/▲ 标记条款")
                        return
                      }
                      setLocalReport((prev) => (prev ? upsertParseSection(prev, sec) : { scope: "full", sections: [sec] }))
                      toast.success(`重新扫描完成：共 ${starClauseCount(lines)} 条 ★/▲ 重点条款（本地扫描，零费用）`)
                    }}
                  />
                ) : (
                  <EmptyResult hint="运行「招标文件解析」后，这里会显示可编辑的解析报告" />
                )
              ) : p.toolKind === "dup" ? (
                p.toolDupResult ? (
                  p.toolDupResult.pairs.length ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-xs text-muted-foreground">
                        对比历史项目 {p.toolDupResult.scanned_projects} 个，发现可疑段落 {p.toolDupResult.suspect_count} 处
                      </p>
                      {p.toolDupResult.pairs.map((pair, i) => (
                        <DupPairCard key={i} pair={pair} />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-primary/30 bg-primary/5 px-4 py-8 text-center text-sm font-medium text-primary">
                      未发现明显相似段落
                    </p>
                  )
                ) : (
                  <EmptyResult hint="运行「标书查重」后，这里会显示相似段落对照（需要已有历史投标项目作对比源）" />
                )
              ) : p.toolKind === "void" ? (
                p.toolVoidResult ? (
                  <VoidItemsList check={p.toolVoidResult} />
                ) : (
                  <EmptyResult hint="运行「废标项检查」后，这里会显示逐条判定结果" />
                )
              ) : p.toolEvalResult ? (
                <EvalResultView aiReview={p.toolEvalResult} />
              ) : (
                <EmptyResult hint="运行「模拟评标」后，这里会显示逐项打分与改进建议" />
              )}
            </div>
          </section>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-4 pb-14 pt-10 text-center text-xs text-muted-foreground">
        查重先本地粗筛再 AI 复判，控制费用；所有 AI 调用前都会先与你确认费用，按实际 token 用量扣费
      </footer>

      <Dialog open={p.factCheckOpen} onOpenChange={p.setFactCheckOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto border-border bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-foreground">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              事实一致性核对结果{p.factProjectName ? `：${p.factProjectName}` : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              按全局事实表逐条核对各章命中段落，以下为口径不一致项与修改建议（结果仅本次展示，不落库）
            </DialogDescription>
          </DialogHeader>
          {p.factCheckResult && p.factCheckResult.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-10 text-center">
              <BadgeCheck className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium text-primary">未发现口径矛盾</p>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                各章命中段落与全局事实表一致。修改事实表或正文后可随时重新核对。
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {(p.factCheckResult ?? []).map((c, i) => (
                <div key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="flex items-start gap-1.5 text-xs font-semibold text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    {c.fact}
                  </p>
                  {c.chapter && <p className="mt-1.5 text-xs text-muted-foreground">所在章：{c.chapter}</p>}
                  {c.quote && (
                    <p className="mt-1.5 rounded border-l-2 border-destructive/50 bg-background px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                      「{c.quote}」
                    </p>
                  )}
                  {c.suggestion && <p className="mt-1.5 text-xs leading-relaxed text-primary">建议：{c.suggestion}</p>}
                </div>
              ))}
              {/* 循环 2 批 1-1：审计自动修复闭环——按矛盾清单生成精准替换补丁，本地唯一命中才改 */}
              {(p.factCheckResult ?? []).length > 0 && (
                <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-3">
                  <Button
                    onClick={() => p.startFactPatch()}
                    disabled={p.factPatchBusy || p.factCheckBusy}
                    className="w-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
                  >
                    {p.factPatchBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
                    {p.factPatchBusy ? "修复中…" : "一键修复"}
                  </Button>
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    AI 按矛盾清单生成精准替换补丁，只有能在对应章唯一命中的原文才会被替换，其余自动跳过。修复完成后，可重新点「开始核对」复检。
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}

function EmptyResult({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <Wrench className="h-8 w-8 text-muted-foreground" />
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}
