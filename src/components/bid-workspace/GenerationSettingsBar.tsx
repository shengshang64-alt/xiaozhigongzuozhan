import { useEffect, useState } from "react"
import { Check, Gauge, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  CLAUSE_GRANULARITY_LABEL,
  COMPLIANCE_MODE_LABEL,
  type ClauseGranularity,
  type ComplianceMode,
} from "@/pages/BidWorkspace/bidTypes"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type GenerationSettingsBarProps = Pick<
  UseBidWorkspace,
  | "targetPages"
  | "setTargetPages"
  | "outlineLevel"
  | "setOutlineLevel"
  | "figuresEnabled"
  | "setFiguresEnabled"
  | "maxFigures"
  | "setMaxFigures"
  | "clauseGranularity"
  | "setClauseGranularity"
  | "sectionWords"
  | "setSectionWords"
  | "genOptions"
  | "setClauseResponse"
  | "setMaterialBoost"
  | "setWordRefine"
  | "setAutoConsistencyAudit"
  | "setComplianceMode"
  | "estimatedPages"
  | "settingsSaved"
  | "leafTarget"
>

const LEVEL_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: "不指定" },
  { value: 1, label: "一级" },
  { value: 2, label: "二级" },
  { value: 3, label: "三级" },
]

const GRANULARITY_OPTIONS: ClauseGranularity[] = ["system", "l2", "l3"]

// 合并稿 v1.0（R30）：三档写作模式选择器——只切「素材来源与扩展程度」，新增可验收承诺始终受忠实/克制底线约束
const COMPLIANCE_MODES: ComplianceMode[] = ["strict", "moderate", "full"]
const COMPLIANCE_MODE_HINT: Record<ComplianceMode, string> = {
  strict: "只做对标响应：要求字眼改响应表述，禁写行业背景/方法论等扩展内容，篇幅从简（默认，最安全）",
  moderate: "对标响应骨架 + 本项目应用场景描述（约占 30%~50% 篇幅）",
  full: "骨架+场景之上可写行业背景/方法论/制度等充实材料；严禁包装成本项目已发生的事实",
}

/**
 * 第五轮改造 1：编制步骤顶部常驻「生成设置」条——目标页数 / 目录级数 / 配图开关 /
 * 偏离表维度 / 每小节字数，全部持久化到项目记录（防抖自动保存 + 「已保存」徽标）；
 * 估算页数只作参考小字，不再顶替用户设置。
 */
export function GenerationSettingsBar(p: GenerationSettingsBarProps) {
  const [pagesDraft, setPagesDraft] = useState(p.targetPages === null ? "" : String(p.targetPages))
  const [wordsDraft, setWordsDraft] = useState(String(p.sectionWords))
  // 第十六轮 B2：全文配图上限草稿（空=默认 6）
  const [figsDraft, setFigsDraft] = useState("")
  // A2-8：onBlur clamp + 行内提示，不再静默归一
  const [pagesHint, setPagesHint] = useState("")
  const [wordsHint, setWordsHint] = useState("")
  const [figsHint, setFigsHint] = useState("")

  useEffect(() => setPagesDraft(p.targetPages === null ? "" : String(p.targetPages)), [p.targetPages])
  useEffect(() => setWordsDraft(String(p.sectionWords)), [p.sectionWords])
  // 留空 / 恰好等于默认值 6 时输入框显示空（占位符已标「留空=6」），避免误导成手动设置
  useEffect(() => setFigsDraft(p.maxFigures === 6 ? "" : String(p.maxFigures)), [p.maxFigures])

  const handlePagesBlur = () => {
    const raw = pagesDraft.trim()
    if (raw === "") {
      setPagesHint("")
      p.setTargetPages("")
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 1) {
      const fixed = Number.isFinite(n) ? "1" : p.targetPages === null ? "" : String(p.targetPages)
      setPagesHint(Number.isFinite(n) ? "页数至少 1 页，已自动调整" : "请输入有效页数，已恢复原值")
      setPagesDraft(fixed)
      p.setTargetPages(fixed)
      return
    }
    const clamped = Math.min(9999, Math.round(n))
    setPagesHint(clamped !== n ? "页数最大 9999，已自动调整" : "")
    setPagesDraft(String(clamped))
    p.setTargetPages(String(clamped))
  }

  const handleWordsBlur = () => {
    const raw = wordsDraft.trim()
    const n = Number(raw)
    if (raw === "" || !Number.isFinite(n)) {
      setWordsHint("请输入 400–5000 的数字，已恢复原值")
      setWordsDraft(String(p.sectionWords))
      return
    }
    const clamped = Math.max(400, Math.min(5000, Math.round(n)))
    setWordsHint(clamped !== n ? `每小节字数应在 400–5000 之间，已自动调整为 ${clamped}` : "")
    setWordsDraft(String(clamped))
    p.setSectionWords(String(clamped))
  }

  const handleFigsBlur = () => {
    const raw = figsDraft.trim()
    if (raw === "") {
      setFigsHint("")
      p.setMaxFigures("")
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      setFigsHint("请输入 0–20 的数字，已恢复原值")
      setFigsDraft(p.maxFigures === 6 ? "" : String(p.maxFigures))
      return
    }
    const clamped = Math.min(20, Math.round(n))
    setFigsHint(clamped !== n ? `配图上限应在 0–20 之间，已自动调整为 ${clamped}` : "")
    setFigsDraft(clamped === 6 ? "" : String(clamped))
    p.setMaxFigures(String(clamped))
  }

  const summary =
    p.targetPages === null
      ? `未设页数：按招标文件体量估算约 ${p.estimatedPages} 页（仅作参考，不会覆盖你的设置）；大纲规模按约 ${p.leafTarget} 个叶子节点、每叶子约 ${p.sectionWords} 字参考`
      : `当前生效：全文 ${p.targetPages} 页 ≈ ${p.targetPages * 500} 字，大纲目标叶子数约 ${p.leafTarget} 个（每叶子约 ${p.sectionWords} 字），章节预算按权重折算${
          p.figuresEnabled ? `；已开启章节配图（全文上限 ${p.maxFigures} 张，智能编排按上限全局择优）` : ""
        }`

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-primary" />
          生成设置
          <span className="text-xs font-normal text-muted-foreground">自动保存到项目，刷新或重进不丢</span>
        </h2>
        <span
          className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            p.settingsSaved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {p.settingsSaved ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
          {p.settingsSaved ? "已保存" : "保存中…"}
        </span>
      </div>

      {/* 用户反馈轮项 2：原 xl:grid-cols-7 挤行改分组两行——第一行数值/选择组、第二行开关组，
          「技术章生成强化」双 checkbox 卡独立全宽行；控件高度统一 h-9、label 间距统一 gap-1.5 */}
      <div className="mt-3 grid gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">生成模式（越界扩写的新增承诺越克越严）</span>
            <div className="grid grid-cols-3 gap-1">
              {COMPLIANCE_MODES.map((mode) => {
                const active = (p.genOptions.compliance_mode ?? "strict") === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => p.setComplianceMode(mode)}
                    className={`flex h-9 items-center justify-center rounded-md px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                    }`}
                  >
                    {COMPLIANCE_MODE_LABEL[mode]}
                  </button>
                )
              })}
            </div>
            <span className="text-muted-foreground">{COMPLIANCE_MODE_HINT[p.genOptions.compliance_mode ?? "strict"]}</span>
          </div>

          <label className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">目标页数（留空按体量估算）</span>
            <Input
              type="number"
              min={1}
              max={9999}
              placeholder="如 200"
              value={pagesDraft}
              aria-invalid={Boolean(pagesHint)}
              onChange={(e) => {
                setPagesDraft(e.target.value)
                setPagesHint("")
              }}
              onBlur={handlePagesBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
              className={`h-9 border-border bg-background focus-visible:shadow-[var(--focus-ring)] ${pagesHint ? "border-destructive" : ""}`}
            />
            {pagesHint && <span className="text-xs text-destructive">{pagesHint}</span>}
          </label>

          <label className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">每小节字数（400-5000）</span>
            <Input
              type="number"
              min={400}
              max={5000}
              step={100}
              placeholder="800"
              value={wordsDraft}
              aria-invalid={Boolean(wordsHint)}
              onChange={(e) => {
                setWordsDraft(e.target.value)
                setWordsHint("")
              }}
              onBlur={handleWordsBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
              className={`h-9 border-border bg-background focus-visible:shadow-[var(--focus-ring)] ${wordsHint ? "border-destructive" : ""}`}
            />
            {wordsHint && <span className="text-xs text-destructive">{wordsHint}</span>}
          </label>

          <div className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">目录级数</span>
            <div className="grid grid-cols-4 gap-1">
              {LEVEL_OPTIONS.map((opt) => {
                const active = p.outlineLevel === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => p.setOutlineLevel(opt.value)}
                    className={`flex h-9 items-center justify-center rounded-md px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">偏离表拆分维度</span>
            <div className="grid grid-cols-3 gap-1">
              {GRANULARITY_OPTIONS.map((dim) => {
                const active = p.clauseGranularity === dim
                return (
                  <button
                    key={dim}
                    type="button"
                    onClick={() => p.setClauseGranularity(dim)}
                    className={`flex h-9 items-center justify-center rounded-md px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                    }`}
                  >
                    {CLAUSE_GRANULARITY_LABEL[dim]}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">章节配图</span>
            <label className="flex h-9 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3">
              <span className="text-xs font-medium text-foreground">架构 / 流程 / 界面示意</span>
              <input
                type="checkbox"
                checked={p.figuresEnabled}
                onChange={(e) => p.setFiguresEnabled(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-xs">
            <span className="font-medium text-muted-foreground">全文配图上限（0-20，留空=6）</span>
            <Input
              type="number"
              min={0}
              max={20}
              placeholder="6"
              value={figsDraft}
              aria-invalid={Boolean(figsHint)}
              onChange={(e) => {
                setFigsDraft(e.target.value)
                setFigsHint("")
              }}
              onBlur={handleFigsBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
              className={`h-9 border-border bg-background focus-visible:shadow-[var(--focus-ring)] ${figsHint ? "border-destructive" : ""}`}
            />
            {figsHint ? (
              <span className="text-xs text-destructive">{figsHint}</span>
            ) : (
              <span className="text-xs text-muted-foreground">智能编排按上限全局择优，0=不配图</span>
            )}
          </label>
        </div>

        <div className="grid gap-1.5 text-xs">
          <span className="font-medium text-muted-foreground">技术章生成强化（自动保存）</span>
          <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={p.genOptions.clause_response}
                onChange={(e) => p.setClauseResponse(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-xs leading-snug">
                <span className="font-medium text-foreground">逐条应答强化</span>
                <span className="block text-muted-foreground">技术章正文注入 ★/▲ 重点条款，要求逐条正面应答（满足/优于），禁止回避</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={p.genOptions.material_boost}
                onChange={(e) => p.setMaterialBoost(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-xs leading-snug">
                <span className="font-medium text-foreground">素材优先注入</span>
                <span className="block text-muted-foreground">开启后生成时加大招标原文检索量，并检索知识库素材注入（注明来源，检索为空时静默跳过）；关闭则仅用招标原文与自有资料，不检索知识库</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={p.genOptions.word_refine !== false}
                onChange={(e) => p.setWordRefine(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-xs leading-snug">
                <span className="font-medium text-foreground">自动字数精调</span>
                <span className="block text-muted-foreground">成稿治理后仍在预算带外的小节，自动做局部扩写/缩写（锚点唯一定位、事实口径不改，易标方式）；关闭则只做续写补足与段落裁剪</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={p.genOptions.auto_consistency_audit !== false}
                onChange={(e) => p.setAutoConsistencyAudit(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-xs leading-snug">
                <span className="font-medium text-foreground">生成后一致性核对</span>
                <span className="block text-muted-foreground">每章成稿后自动核对全局事实口径，发现矛盾自动修复一次（未唯一定位的留待人工）；关闭则仅在「事实一致性核对」手动执行</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{summary}</p>
    </div>
  )
}
