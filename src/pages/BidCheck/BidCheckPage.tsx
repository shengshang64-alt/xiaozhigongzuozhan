// ---------------------------------------------------------------------------
// BidCheckPage —— 标书检查中枢页面（与 7 步流水线平级的独立入口 /bid-check）。
//
// R262 界面改造：结果态改为「三栏阅读视图」（左章节导航 / 中只读正文+问题标记 / 右问题清单），
// 并与「规则清单页」并列为两个 Tab。输入 / 模式开关 / 配置弹窗 / 导出门禁沿用一期。
// ⚠️ 只标不改：页面呈现的是覆盖层结论，正文纯只读，不提供任何改正文的入口。
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react"
import {
  ClipboardCheck,
  Upload,
  FileText,
  ShieldAlert,
  Settings2,
  Loader2,
  X,
  ListChecks,
  BookOpenCheck,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { hasBlockingCritical } from "./bidCheckTypes"
// R124 口径：docx / xlsx 是数百 kB 级重库，只能点击导出时经 await import() 按需加载。
// 本页此前静态引入 ./report/toExcel（内含 `import * as XLSX from "xlsx"`）与
// ./report/toAnnotatedDocx（内含 `from "docx"`），于是「只进一次标书检查页、从不导出」
// 也要下载两个重库。而 onDemandHeavyLibs.test.ts 的 BFS 入口表只覆盖 6 条路由壳
// （main/PptQuote/IntelCenter/SolutionStudio/BidWorkspace/Knowledge），BidCheck 是漏网的，
// 所以这个回潮一直没被守卫抓住。改回按需后两处重库不再进入本页 chunk。
import { exportHtmlReport } from "./report/toHtml"
import { BidCheckConfigDialog } from "./BidCheckConfigDialog"
import { ReadingView } from "./ReadingView"
import { RulesListPanel } from "./RulesListPanel"
import type { BidCheckVm } from "./useBidCheck"

type Tab = "result" | "rules"

export function BidCheckPage(vm: BidCheckVm) {
  const {
    mode,
    setMode,
    source,
    sourceLabel,
    pickFile,
    pickProject,
    clearSource,
    running,
    result,
    run,
    projects,
    projectsLoading,
    anbidCfg,
    checkCfg,
    patchCheckCfg,
    reviewing,
    runSemanticReview,
    costConfirm,
  } = vm

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [tab, setTab] = useState<Tab>("result")
  const [gateOpen, setGateOpen] = useState(false)
  const [pendingExport, setPendingExport] = useState<null | "excel" | "html" | "docx">(null)

  const sealed = mode === "sealed"
  const blocked = !!result && sealed && hasBlockingCritical(result)
  const hardFatal = blocked && anbidCfg.sealedViolationIsFatal

  const doExport = async (kind: "excel" | "html" | "docx") => {
    if (!result) return
    if (kind === "excel") {
      const { exportChecklistToExcel } = await import("./report/toExcel")
      exportChecklistToExcel(result)
    } else if (kind === "html") {
      exportHtmlReport(result)
    } else {
      const { exportAnnotatedDocx } = await import("./report/toAnnotatedDocx")
      await exportAnnotatedDocx(result)
    }
  }

  const tryExport = (kind: "excel" | "html" | "docx") => {
    if (!result || hardFatal) return
    if (blocked) {
      setPendingExport(kind)
      setGateOpen(true)
      return
    }
    void doExport(kind)
  }

  const issueCount = useMemo(() => (result ? result.summary.fail + result.summary.warn : 0), [result])

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      {/* ---------- 顶部：标题 + 模式开关 + 配置 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">标书检查中枢</h1>
            <p className="text-xs text-muted-foreground">纯规则 · 零 AI · 只标不改（正文只读，产出三栏定位视图 / Excel / HTML / 标注版 Word 四件套覆盖层）</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border">
            <button
              className={cn("px-3 py-1.5 text-sm", !sealed ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
              onClick={() => setMode("normal")}
            >
              普通模式
            </button>
            <button
              className={cn("px-3 py-1.5 text-sm", sealed ? "bg-destructive text-destructive-foreground" : "bg-background hover:bg-accent")}
              onClick={() => setMode("sealed")}
            >
              暗标严格模式
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
            <Settings2 className="h-4 w-4" /> 配置
          </Button>
        </div>
      </div>

      {sealed ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> 暗标严格模式：L1~L5 全开，加严阈值，检出身份泄露 / 元数据痕迹将触发导出门禁。
        </div>
      ) : null}

      {/* ---------- 输入区 ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">检查对象</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">上传文件</div>
              <p className="text-xs text-muted-foreground">.docx 走全量（含元数据 / 节点痕迹）；.pdf 走正文 + PDF 元数据。</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickFile(f)
                  e.target.value = ""
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> 选择 docx / pdf
              </Button>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">选择标书项目</div>
              <p className="text-xs text-muted-foreground">复用项目正文做检查（无文件包，节点痕迹项标「无法检测」）。</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                value={source.kind === "project" ? source.record.id : ""}
                disabled={projectsLoading || projects.length === 0}
                onChange={(e) => pickProject(e.target.value)}
              >
                <option value="">{projectsLoading ? "加载中…" : projects.length ? "请选择项目" : "暂无项目"}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_name || p.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              {source.kind === "none" ? (
                <span className="text-muted-foreground">尚未选择检查对象</span>
              ) : (
                <>
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">{sourceLabel}</span>
                  <Badge variant="neutral">{source.kind === "file" ? "上传文件" : "项目正文"}</Badge>
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearSource}>
                    <X className="inline h-3 w-3" /> 清除
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={runSemanticReview}
                disabled={reviewing || running || !result || result.summary.fail + result.summary.warn === 0}
                title="调用 AI 复核疑似问题的语义合理性，为其标注 0~1 置信度（不改判定）"
              >
                {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI 复核
              </Button>
              <Button onClick={run} disabled={running || source.kind === "none"}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                开始检查
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Tab：检查结果（三栏） / 规则清单 ---------- */}
      <div className="inline-flex overflow-hidden rounded-md border">
        <button
          className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm", tab === "result" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
          onClick={() => setTab("result")}
        >
          <BookOpenCheck className="h-4 w-4" /> 检查结果
          {issueCount > 0 ? <span className="rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">{issueCount}</span> : null}
        </button>
        <button
          className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm", tab === "rules" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
          onClick={() => setTab("rules")}
        >
          <ListChecks className="h-4 w-4" /> 规则清单
        </button>
      </div>

      {tab === "rules" ? (
        <Card>
          <CardContent className="py-4">
            <RulesListPanel checkCfg={checkCfg} patchCheckCfg={patchCheckCfg} anbidCfg={anbidCfg} />
          </CardContent>
        </Card>
      ) : result ? (
        <ReadingView
          result={result}
          blocked={blocked}
          hardFatal={hardFatal}
          onExportExcel={() => tryExport("excel")}
          onExportHtml={() => tryExport("html")}
          onExportDocx={() => tryExport("docx")}
        />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {source.kind === "none" ? "上传文件或选择项目后点击「开始检查」，或切到「规则清单」查看/调整规则开关" : "点击「开始检查」生成三栏检查视图"}
          </CardContent>
        </Card>
      )}

      {/* ---------- 配置弹窗 ---------- */}
      <BidCheckConfigDialog
        open={showConfig}
        onClose={() => setShowConfig(false)}
        anbid={vm.anbidCfg}
        checkCfg={vm.checkCfg}
        onSaveAnbid={vm.patchAnbidCfg}
        onSaveCheck={vm.patchCheckCfg}
      />

      {/* ---------- 暗标导出门禁：二次确认可继续 ---------- */}
      <Dialog open={gateOpen} onOpenChange={(o) => (o ? undefined : setGateOpen(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> 暗标存在必改项
            </DialogTitle>
            <DialogDescription>
              当前检出 <b>{result?.summary.fail ?? 0}</b> 项必须整改（含废标级 🔴）。建议先按清单在 Word 中整改再导出。
              如需先行导出清单用于分工，可在二次确认后继续。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGateOpen(false)}>
              返回整改
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingExport) void doExport(pendingExport)
                setGateOpen(false)
              }}
            >
              确认仍要导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- R273：AI 复核的费用确认弹窗（全站计费契约） ---------- */}
      <CostConfirmDialog {...costConfirm} />
    </div>
  )
}
