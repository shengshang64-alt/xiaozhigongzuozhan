import { useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  ClipboardCheck,
  Upload,
  FileText,
  ShieldAlert,
  Settings2,
  Loader2,
  X,
  ListChecks,
  Sparkles,
  History,
  ChevronDown,
  FileWarning,
} from "lucide-react"
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
import { BidCheckSubtabs } from "./BidCheckSubtabs"
import { ReadingView } from "./ReadingView"
import { RulesListPanel } from "./RulesListPanel"
import { dedupeProjectOptions, excludeDeletedProjects, filterProjectOptions, sortProjectOptions } from "./projectOptions"
import { parseBidCheckTab, type BidCheckTab } from "./bidCheckTabs"
import type { BidCheckVm } from "./useBidCheck"

// UX-R2: 标书检查 已按 docs/ux-review-2026-11 修复 2026-11-07（拖拽大区/禁用原因显形/模式单选卡/最近报告）
// ---------------------------------------------------------------------------
// BidCheckPage —— 标书检查中枢页面（与 7 步流水线平级的独立入口 /bid-check）。
//
// R262 界面改造：结果态改为「三栏阅读视图」（左章节导航 / 中只读正文+问题标记 / 右问题清单）。
// ⚠️ 只标不改：页面呈现的是覆盖层结论，正文纯只读，不提供任何改正文的入口。
//
// UX-v2（2026-11-11）：按 prototype/check/ 拆四个屏内 Tab（?tab=，口径见 bidCheckTabs.ts）——
// 新建检查（对象+模式+规则开关）/ 检查中（本机执行）/ 检查报告（三栏阅读+导出）/ 历史报告。
// URL ?tab= 缺省时按会话派生：检查进行中→检查中、有结果→检查报告、否则新建检查——
// 因此点「开始检查」不写地址也会自动走到检查中→报告的流程；历史报告为本机摘要留痕
// （完整报告属当次会话，跨会话持久化另行立项，如实标注）。规则清单（规则开关配置）
// 归入「新建检查」屏的折叠区，配置弹窗入口不变。
// ---------------------------------------------------------------------------

// UX-R2（docs/ux-review-2026-11 §十）：最近检查报告——本地 localStorage 摘要（上限 10 条）。
// 检查结果本体含全文与命中定位（MB 级），不适合塞 localStorage；此处只存可复访的元信息，
// 完整三栏视图仍以当次会话的 result 为准（跨会话恢复属 IndexedDB/PB 持久化，另行立项）。
type RecentCheckReport = {
  ranAt: string
  mode: "normal" | "sealed"
  sourceLabel: string
  sourceKind: "file" | "project"
  fail: number
  warn: number
}
const RECENT_CHECKS_KEY = "bid_check_recent_reports"
const RECENT_CHECKS_MAX = 10

function readRecentChecks(): RecentCheckReport[] {
  try {
    const raw = window.localStorage.getItem(RECENT_CHECKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentCheckReport[]
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_CHECKS_MAX) : []
  } catch {
    return []
  }
}

function writeRecentCheck(entry: RecentCheckReport): RecentCheckReport[] {
  const next = [entry, ...readRecentChecks().filter((r) => r.ranAt !== entry.ranAt)].slice(0, RECENT_CHECKS_MAX)
  try {
    window.localStorage.setItem(RECENT_CHECKS_KEY, JSON.stringify(next))
  } catch {
    /* 存储不可用时静默降级为会话内可见 */
  }
  return next
}

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
  // UX-v2：四屏 Tab（?tab=）；缺省按会话派生——检查中 / 有结果看报告 / 否则新建检查
  const [searchParams, setSearchParams] = useSearchParams()
  const [rulesOpen, setRulesOpen] = useState(false)
  const derivedTab: BidCheckTab = running ? "running" : result ? "report" : "upload"
  const tab = parseBidCheckTab(searchParams.get("tab")) ?? derivedTab
  const [gateOpen, setGateOpen] = useState(false)
  const [pendingExport, setPendingExport] = useState<null | "excel" | "html" | "docx">(null)
  // UX-R2：拖拽高亮 / 项目次入口折叠 / 最近检查报告
  const [dragActive, setDragActive] = useState(false)
  const [projectPickOpen, setProjectPickOpen] = useState(false)
  const [recentChecks, setRecentChecks] = useState<RecentCheckReport[]>(() => readRecentChecks())
  // UX-R2：每次成功产出 result 即记一条本地摘要（同一次结果只记一条）。
  // 用渲染期调整状态（React 官方推荐模式，同 CustomerFormDialog 的 prevOpen），避开 effect 内 setState。
  const [prevRecorded, setPrevRecorded] = useState(result)
  if (prevRecorded !== result) {
    setPrevRecorded(result)
    if (result) {
      setRecentChecks(
        writeRecentCheck({
          ranAt: new Date().toISOString(),
          mode,
          sourceLabel,
          sourceKind: source.kind === "file" ? "file" : "project",
          fail: result.summary.fail,
          warn: result.summary.warn,
        }),
      )
    }
  }
  // P1-6：项目下拉整备——同名去重（保最新）+ updated 倒序 + 关键字搜索（实测 30+ 选项
  // 同名重复无排序无搜索，多人团队下不可用）
  const [projectQuery, setProjectQuery] = useState("")
  // 2026-10-28（DS-R04）：先剔除回收站项目，再去重/排序/搜索。
  // 顺序有讲究：去重是「同名保最新」，若先去掉重，回收站里更新的同名记录
  // 会把正常项目顶掉（实测「三明市中西医结合医院」回收站件 updated 更新，正常件被隐藏）。
  const projectOptions = useMemo(
    () =>
      filterProjectOptions(
        dedupeProjectOptions(sortProjectOptions(excludeDeletedProjects(projects))),
        projectQuery,
      ),
    [projects, projectQuery],
  )
  /** 已排除回收站的候选总数（下方计数文案与下拉共用，避免「共 N 个」把回收站算进去） */
  const selectableProjects = useMemo(() => excludeDeletedProjects(projects), [projects])

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

  // 原「检查结果」Tab 角标的 issueCount 随双 Tab 一起退役；三栏视图内的问题计数由 ReadingView 自行汇总

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      {/* ---------- 顶部：标题 + 模式开关 + 配置 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">标书检查中枢</h1>
            <p className="text-xs text-muted-foreground">纯规则 · 零 AI · 只标不改（正文只读，产出三栏定位视图 / Excel / HTML / 标注版 Word 四件套覆盖层）</p>
            {/* UX-R3 S10：交付前终检 / 项目内过程自查的分工说明（可互跳） */}
            <p className="mt-1 text-xs text-muted-foreground">
              交付前终检 · 可检查任意历史文档；项目内过程自查请回{" "}
              <Link
                to="/bid-workspace"
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                标书工作台 →
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
            <Settings2 className="h-4 w-4" /> 配置
          </Button>
        </div>
      </div>

      {/* ---------- UX-v2：四屏 SubTab（新建检查/检查中/检查报告/历史报告） ---------- */}
      <BidCheckSubtabs active={tab} />

      {tab === "upload" ? (
      <>
      {/* ---------- UX-R2：模式单选卡（带一行说明，替代原灰按钮切换 + 独立警示条） ---------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          {
            key: "normal" as const,
            title: "普通模式",
            desc: "只读正文与常用规则：适合交付前的常规自查，速度快",
            active: !sealed,
          },
          {
            key: "sealed" as const,
            title: "暗标严格模式",
            desc: "L1~L5 全开、加严阈值：检出身份泄露 / 元数据痕迹将触发导出门禁",
            active: sealed,
          },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={m.active}
            onClick={() => setMode(m.key)}
            className={`rounded-lg border-2 p-4 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              m.active
                ? m.key === "sealed"
                  ? "border-destructive/60 bg-destructive/5"
                  : "border-primary/60 bg-primary/5"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {m.key === "sealed" ? <ShieldAlert className={`h-4 w-4 ${m.active ? "text-destructive" : "text-muted-foreground"}`} /> : <ClipboardCheck className={`h-4 w-4 ${m.active ? "text-primary" : "text-muted-foreground"}`} />}
              {m.title}
              {m.active ? <span className="ml-auto text-[10px] font-medium text-primary">当前模式</span> : null}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
          </button>
        ))}
      </div>

      {/* ---------- 输入区 ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">检查对象</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          {source.kind === "none" ? (
            /* UX-R2：双入口合并——拖拽/点击同一大区，项目选择折叠为次入口 */
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                const f = e.dataTransfer.files?.[0]
                if (f) pickFile(f)
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-secondary/40"
              }`}
            >
              <Upload className={`h-8 w-8 ${dragActive ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-sm font-medium text-foreground">拖入 docx / pdf，或点击选择文件</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                .docx 走全量检查（含元数据 / 节点痕迹）；.pdf 走正文 + PDF 元数据
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={sourceLabel}>
                {sourceLabel}
              </span>
              <Badge variant="neutral">{source.kind === "file" ? "上传文件" : "项目正文"}</Badge>
              <button className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={clearSource}>
                <X className="inline h-3 w-3" /> 更换
              </button>
            </div>
          )}

          {/* 次入口：从标书项目选择（折叠，不与上传大区并列抢焦点） */}
          <div>
            <button
              type="button"
              aria-expanded={projectPickOpen}
              onClick={() => setProjectPickOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              或 从标书项目选择
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${projectPickOpen ? "rotate-180" : ""}`} />
            </button>
            {projectPickOpen ? (
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
                <input
                  type="search"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="搜索项目名称 / 招标编号…"
                  disabled={projectsLoading || projects.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                />
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                  value={source.kind === "project" ? source.record.id : ""}
                  disabled={projectsLoading || projectOptions.length === 0}
                  onChange={(e) => pickProject(e.target.value)}
                >
                  <option value="">
                    {projectsLoading
                      ? "加载中…"
                      : selectableProjects.length === 0
                        ? "暂无项目"
                        : projectOptions.length === 0
                          ? "无匹配项目（调整搜索词）"
                          : "请选择项目"}
                  </option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_name || p.id}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {selectableProjects.length > projectOptions.length
                    ? `匹配 ${projectOptions.length} / 共 ${selectableProjects.length} 个项目（同名已合并 · 已隐藏回收站）`
                    : selectableProjects.length > 0
                      ? `共 ${selectableProjects.length} 个项目 · 按最近更新排序（已隐藏回收站）`
                      : "复用项目正文做检查（无文件包，节点痕迹项标「无法检测」）"}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              {/* UX-R2：开始检查的禁用原因显形（原按钮「哑巴」问题） */}
              {source.kind === "none" && !running ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                  <FileWarning className="h-3.5 w-3.5" />
                  请先上传文件或选择项目
                </span>
              ) : (
                <>
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">{sourceLabel}</span>
                  <Badge variant="neutral">{source.kind === "file" ? "上传文件" : "项目正文"}</Badge>
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
              {/* UX-v2：点击后不写地址——缺省派生会自动 走 检查中 → 检查报告 */}
              <Button onClick={run} disabled={running || source.kind === "none"}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                开始检查
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- 规则包清单（可调开关）：检查前的配置项，折叠收起不占首屏 ---------- */}
      <details className="rounded-lg border border-border bg-card shadow-md" open={rulesOpen}>
        <summary
          onClick={(e) => {
            e.preventDefault()
            setRulesOpen((v) => !v)
          }}
          className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 [&::-webkit-details-marker]:hidden"
        >
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold text-foreground">规则包清单</span>
          <span className="text-xs text-muted-foreground">点开可逐条调整规则开关（配置会记住）</span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${rulesOpen ? "rotate-180" : ""}`} />
        </summary>
        <div className="border-t border-border px-4 py-3">
          <RulesListPanel checkCfg={checkCfg} patchCheckCfg={patchCheckCfg} anbidCfg={anbidCfg} />
        </div>
      </details>
      </>
      ) : null}

      {/* ---------- UX-v2：检查中 —— 本机执行说明 + 完成后入口（不画假进度条） ---------- */}
      {tab === "running" ? (
        running ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">正在按当前规则包逐条扫描…</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                纯规则 · 零 AI · 文件不出门：全部比对在本机完成，检出即标（正文只读，不改一个字）。
              </p>
            </CardContent>
          </Card>
        ) : result ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ClipboardCheck className="h-7 w-7 text-primary" />
              <p className="text-sm font-medium text-foreground">检查完成</p>
              <p className="text-xs text-muted-foreground">
                共检出 <span className="font-medium text-destructive">{result.summary.fail}</span> 项必改 ·{" "}
                <span className="font-medium text-amber-600">{result.summary.warn}</span> 项提醒
              </p>
              <Button size="sm" onClick={() => setSearchParams({ tab: "report" }, { replace: true })} className="bg-primary text-primary-foreground hover:bg-primary/90">
                看检查报告 →
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ClipboardCheck className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">当前没有进行中的检查</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                到「新建检查」选好对象与模式后点「开始检查」，执行过程会出现在这里。
              </p>
              <Button size="sm" variant="outline" onClick={() => setSearchParams({}, { replace: true })} className="border-border text-card-foreground hover:bg-secondary">
                去新建检查
              </Button>
            </CardContent>
          </Card>
        )
      ) : null}

      {/* ---------- UX-v2：检查报告 —— 三栏阅读 + 四件套导出 ---------- */}
      {tab === "report" ? (
        result ? (
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
              {source.kind === "none"
                ? "先到「新建检查」上传文件或选择项目并开始检查；报告会在这里以三栏视图呈现"
                : "点击「开始检查」后，三栏检查视图会出现在这里"}
            </CardContent>
          </Card>
        )
      ) : null}

      {/* ---------- UX-v2：历史报告（本机摘要；完整三栏视图仍属当次会话的 result） ---------- */}
      {tab === "history" ? (
        recentChecks.length > 0 ? (
          <div className="rounded-lg border border-border bg-card shadow-md">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">最近检查报告</h2>
              <span className="text-xs text-muted-foreground">本机记录（最多 {RECENT_CHECKS_MAX} 条）</span>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(RECENT_CHECKS_KEY)
                  } catch {
                    /* 忽略 */
                  }
                  setRecentChecks([])
                }}
                className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                清空记录
              </button>
            </div>
            <ul>
              {recentChecks.map((r) => (
                <li key={r.ranAt} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.mode === "sealed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                    {r.mode === "sealed" ? "暗标严格" : "普通模式"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={r.sourceLabel}>
                    {r.sourceLabel}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <span className="font-medium text-destructive">{r.fail}</span> 项必改 ·{" "}
                    <span className="font-medium text-amber-600">{r.warn}</span> 项提醒
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.ranAt.slice(5, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border bg-card px-5 py-8 text-center">
            <History className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">还没有检查记录</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              完成第一次检查后，这里会按时间列出历次报告的模式、对象与问题数，方便回溯对比
            </p>
            <button
              type="button"
              onClick={() => setSearchParams({}, { replace: true })}
              className="text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              去新建检查 →
            </button>
          </div>
        )
      ) : null}

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
