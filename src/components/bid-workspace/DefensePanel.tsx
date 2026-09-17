import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { ChevronDown, HelpCircle, Loader2, Mic, Presentation, Save, Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import type { DefenseOutlinePage, DefenseQuestion, DefenseSpeechNotes } from "@/pages/BidWorkspace/bidTypes"

type DefensePanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "defense"
  | "defenseBusy"
  | "answerBusyId"
  | "pptSending"
  | "defenseConfirm"
  | "setDefenseConfirm"
  | "confirmDefenseRegenerate"
  | "defenseQuestionsReady"
  | "defenseOutlineReady"
  | "defenseSpeechReady"
  | "defenseAnsweredCount"
  | "startGenerateDefenseQuestions"
  | "startGenerateFullAnswer"
  | "updateDefenseQuestion"
  | "startGenerateDefenseOutline"
  | "updateDefenseOutlinePage"
  | "sendOutlineToPpt"
  | "startGenerateSpeechNotes"
  | "updateSpeechNotes"
  | "setActiveStep"
  | "defenseSkills"
  | "isArchivedLocked"
>

const CONFIRM_LABEL: Record<string, string> = {
  questions: "专家问题池",
  outline: "讲标大纲",
  speech: "讲标稿要点",
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 依赖未满足时的引导横幅（不静默） */
function DependencyHint({ text, goLabel, onGo }: { text: string; goLabel?: string; onGo?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5">
      <p className="text-xs text-foreground">{text}</p>
      {goLabel && onGo && (
        <Button
          size="sm"
          variant="outline"
          onClick={onGo}
          className="border-primary/40 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {goLabel}
        </Button>
      )}
    </div>
  )
}

/** 三块共用的折叠外壳 */
function DefenseBlock({
  icon,
  title,
  desc,
  badges,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode
  title: string
  desc: string
  badges?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{desc}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badges}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </div>
  )
}

function BlockEmpty({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center">
      <Sparkles className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-card-foreground">{text}</p>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function BusyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <p className="text-xs text-foreground">{text}</p>
    </div>
  )
}

/** 单个专家问题卡：展开后可编辑答辩要点与完整答案，可二次调用生成完整答案 */
function QuestionCard({
  index,
  q,
  busy,
  disabled,
  locked = false,
  onGenerateAnswer,
  onSave,
}: {
  index: number
  q: DefenseQuestion
  busy: boolean
  disabled: boolean
  /** 循环 6 A1：归档只读——编辑区输入与保存全部禁用 */
  locked?: boolean
  onGenerateAnswer: (id: string) => void
  onSave: (id: string, patch: Partial<DefenseQuestion>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pointsDraft, setPointsDraft] = useState("")
  const [answerDraft, setAnswerDraft] = useState("")

  const toggle = () => {
    if (!expanded) {
      setPointsDraft(q.answer_points.join("\n"))
      setAnswerDraft(q.full_answer)
    }
    setExpanded((v) => !v)
  }

  const dirty = expanded && (pointsDraft !== q.answer_points.join("\n") || answerDraft !== q.full_answer)
  const answered = !!q.full_answer.trim()

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex min-h-14 w-full items-start justify-between gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="badge-neutral">问题 {index + 1}</span>
            {answered ? <span className="badge-success">已备答案</span> : <span className="badge-warning">待备答案</span>}
            {q.edited && <span className="badge-neutral">已编辑</span>}
          </span>
          <span className="mt-1.5 block text-sm font-medium leading-relaxed text-card-foreground">{q.question}</span>
          {q.intent && <span className="mt-1 block text-xs text-muted-foreground">考察点：{q.intent}</span>}
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-3">
          {!!q.ref_chapters.length && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">可引用章节：</span>
              {q.ref_chapters.map((c) => (
                <span key={c} className="badge-neutral">
                  {c}
                </span>
              ))}
            </div>
          )}
          <label className="block text-xs font-semibold text-card-foreground">
            答辩要点（每行一条）
            <Textarea
              value={pointsDraft}
              onChange={(e) => setPointsDraft(e.target.value)}
              rows={Math.max(3, q.answer_points.length + 1)}
              disabled={locked}
              title={locked ? "已归档项目为只读" : undefined}
              className="mt-1.5 resize-y border-border bg-background text-xs leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold text-card-foreground">
            完整答案（200-400 字答辩口径，可人工润色）
            <Textarea
              value={answerDraft}
              onChange={(e) => setAnswerDraft(e.target.value)}
              rows={6}
              placeholder="点「生成完整答案」由 AI 基于标书相关章节撰写，或直接手写"
              disabled={locked}
              title={locked ? "已归档项目为只读" : undefined}
              className="mt-1.5 resize-y border-border bg-background text-sm leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || disabled || locked}
              title={locked ? "已归档项目为只读" : undefined}
              onClick={() => onGenerateAnswer(q.id)}
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {busy ? "答案生成中…" : answered ? "重新生成完整答案" : "生成完整答案"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty || locked}
              title={locked ? "已归档项目为只读" : undefined}
              onClick={() => {
                onSave(q.id, { answer_points: splitLines(pointsDraft), full_answer: answerDraft.trim() })
                toast.success("已保存")
              }}
              className="border-border text-card-foreground hover:bg-secondary"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存编辑
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 讲标大纲单页卡：标题与 bullets 可编辑保存 */
function OutlinePageCard({
  index,
  page,
  revision,
  locked = false,
  onSave,
}: {
  index: number
  page: DefenseOutlinePage
  revision: string
  /** 循环 6 A1：归档只读——输入与保存禁用 */
  locked?: boolean
  onSave: (idx: number, patch: Partial<DefenseOutlinePage>) => void
}) {
  const [titleDraft, setTitleDraft] = useState(page.page_title)
  const [bulletsDraft, setBulletsDraft] = useState(page.bullets.join("\n"))
  const dirty = titleDraft !== page.page_title || bulletsDraft !== page.bullets.join("\n")
  return (
    <div key={`${revision}-${index}`} className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-neutral">第 {index + 1} 页</span>
        <Input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="页标题"
          disabled={locked}
          title={locked ? "已归档项目为只读" : undefined}
          className="h-8 min-w-40 flex-1 border-border bg-background text-sm font-medium focus-visible:shadow-[var(--focus-ring)]"
        />
      </div>
      <Textarea
        value={bulletsDraft}
        onChange={(e) => setBulletsDraft(e.target.value)}
        rows={Math.max(3, page.bullets.length + 1)}
        placeholder="每行一条要点"
        disabled={locked}
        title={locked ? "已归档项目为只读" : undefined}
        className="mt-2 resize-y border-border bg-background text-xs leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || locked}
          title={locked ? "已归档项目为只读" : undefined}
          onClick={() => {
            onSave(index, { page_title: titleDraft.trim() || page.page_title, bullets: splitLines(bulletsDraft) })
            toast.success("已保存")
          }}
          className="text-primary hover:bg-primary/10"
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          保存本页
        </Button>
      </div>
    </div>
  )
}

/** 讲标稿要点编辑器：开场 / 每页讲述要点 / 收尾，整体保存 */
function SpeechEditor({
  notes,
  revision,
  locked = false,
  onSave,
}: {
  notes: DefenseSpeechNotes
  revision: string
  /** 循环 6 A1：归档只读——输入与保存禁用 */
  locked?: boolean
  onSave: (patch: Partial<DefenseSpeechNotes>) => void
}) {
  const [openingDraft, setOpeningDraft] = useState(notes.opening)
  const [sectionsDraft, setSectionsDraft] = useState(notes.sections.map((s) => ({ title: s.title, points: s.points.join("\n") })))
  const [closingDraft, setClosingDraft] = useState(notes.closing)
  const dirty =
    openingDraft !== notes.opening ||
    closingDraft !== notes.closing ||
    sectionsDraft.some((s, i) => s.title !== notes.sections[i]?.title || s.points !== notes.sections[i]?.points.join("\n"))
  return (
    <div key={revision} className="flex flex-col gap-3">
      <label className="block text-xs font-semibold text-card-foreground">
        开场白（150 字内）
        <Textarea
          value={openingDraft}
          onChange={(e) => setOpeningDraft(e.target.value)}
          rows={3}
          disabled={locked}
          title={locked ? "已归档项目为只读" : undefined}
          className="mt-1.5 resize-y border-border bg-background text-sm leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
        />
      </label>
      {sectionsDraft.map((s, i) => (
        <div key={`${revision}-${i}`} className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <p className="text-xs font-semibold text-card-foreground">
            <span className="badge-neutral mr-2">{s.title || `第 ${i + 1} 页`}</span>
            讲述要点（每行一句，2-3 句口语化）
          </p>
          <Textarea
            value={s.points}
            onChange={(e) =>
              setSectionsDraft((prev) => prev.map((it, j) => (j === i ? { ...it, points: e.target.value } : it)))
            }
            rows={3}
            disabled={locked}
            title={locked ? "已归档项目为只读" : undefined}
            className="mt-1.5 resize-y border-border bg-background text-xs leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
          />
        </div>
      ))}
      <label className="block text-xs font-semibold text-card-foreground">
        收尾（100 字内）
        <Textarea
          value={closingDraft}
          onChange={(e) => setClosingDraft(e.target.value)}
          rows={2}
          disabled={locked}
          title={locked ? "已归档项目为只读" : undefined}
          className="mt-1.5 resize-y border-border bg-background text-sm leading-relaxed focus-visible:shadow-[var(--focus-ring)]"
        />
      </label>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || locked}
          title={locked ? "已归档项目为只读" : undefined}
          onClick={() => {
            onSave({
              opening: openingDraft.trim(),
              closing: closingDraft.trim(),
              sections: sectionsDraft
                .map((s, i) => ({ title: s.title || notes.sections[i]?.title || `第 ${i + 1} 页`, points: splitLines(s.points) }))
                .filter((s) => s.title || s.points.length),
            })
            toast.success("已保存")
          }}
          className="border-border text-card-foreground hover:bg-secondary"
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          保存讲标稿
        </Button>
      </div>
    </div>
  )
}

export function DefensePanel(p: DefensePanelProps) {
  const [openBlocks, setOpenBlocks] = useState({ questions: true, outline: true, speech: true })
  const toggleBlock = (key: "questions" | "outline" | "speech") =>
    setOpenBlocks((prev) => ({ ...prev, [key]: !prev[key] }))

  const questions = p.defense.questions
  const outlinePages = p.defense.defense_outline
  const speechNotes = p.defense.speech_notes
  const anyBusy = p.defenseBusy !== ""

  return (
    <section className="relative z-10 mx-auto -mt-8 max-w-7xl px-4 pb-14">
      <div className="rounded-xl border border-border bg-card p-4 shadow-md lg:p-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header>
          <h2 className="text-lg font-semibold tracking-tight text-card-foreground">讲标与答辩</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            基于本项目评分办法与标书正文，预判评标专家问题并备好答辩口径，编排讲标 PPT 大纲（可一键送进 PPT 与报价）与口语化讲标稿要点。三块内容均可编辑保存、可重复生成。
          </p>
        </header>

        {/* 专家问题池 */}
        <DefenseBlock
          icon={<HelpCircle className="h-4 w-4" />}
          title="专家问题池"
          desc="模拟评标专家视角，预判答辩现场最可能被追问的问题并备好答案"
          badges={
            questions.length ? (
              <>
                <span className="badge-neutral">{questions.length} 个问题</span>
                <span className={p.defenseAnsweredCount > 0 ? "badge-success" : "badge-warning"}>
                  已备答案 {p.defenseAnsweredCount}/{questions.length}
                </span>
              </>
            ) : undefined
          }
          open={openBlocks.questions}
          onToggle={() => toggleBlock("questions")}
        >
          {!p.defenseQuestionsReady ? (
            <DependencyHint
              text={
                p.activeProject?.parse_report
                  ? "问题池需要投标文件正文，请先在「③ 投标文件编制」完成章节生成"
                  : "问题池需要先完成「② AI 解析报告」（评分办法 / 废标条款），并有标书正文"
              }
              goLabel={p.activeProject?.parse_report ? "前往编制环节" : "前往解析环节"}
              onGo={() => p.setActiveStep(p.activeProject?.parse_report ? 3 : 2)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SkillPickerFor scope="bid-defense" source={p.defenseSkills} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={anyBusy || p.isArchivedLocked}
                  onClick={p.startGenerateDefenseQuestions}
                  className="border-primary/40 text-primary hover:bg-primary/10 focus-visible:shadow-[var(--focus-ring)]"
                >
                  {p.defenseBusy === "questions" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {questions.length ? "重新生成问题池" : "生成专家问题池"}
                </Button>
                <span className="text-xs text-muted-foreground">每条问题可单独「生成完整答案」，也可人工编辑保存</span>
              </div>
              {p.defenseBusy === "questions" && <BusyRow text="AI 正在以评标专家视角结合评分办法、废标条款与标书内容出题…" />}
              {!questions.length && p.defenseBusy !== "questions" ? (
                <BlockEmpty text="尚未生成专家问题池" hint="生成后这里会出现 8-15 个高概率被追问的问题，附考察点、答辩要点与可引用章节" />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {questions.map((q, i) => (
                    <QuestionCard
                      key={q.id}
                      index={i}
                      q={q}
                      busy={p.answerBusyId === q.id}
                      disabled={anyBusy}
                      locked={p.isArchivedLocked}
                      onGenerateAnswer={p.startGenerateFullAnswer}
                      onSave={p.updateDefenseQuestion}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </DefenseBlock>

        {/* 讲标大纲 */}
        <DefenseBlock
          icon={<Presentation className="h-4 w-4" />}
          title="讲标大纲"
          desc="按评分权重编排 10-15 页讲标 PPT 大纲，可一键送进 PPT 与报价模块"
          badges={outlinePages.length ? <span className="badge-success">{outlinePages.length} 页</span> : undefined}
          open={openBlocks.outline}
          onToggle={() => toggleBlock("outline")}
        >
          {!p.defenseOutlineReady ? (
            <DependencyHint
              text="讲标大纲依赖标书大纲，请先在「③ 投标文件编制」完成大纲生成"
              goLabel="前往编制环节"
              onGo={() => p.setActiveStep(3)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SkillPickerFor scope="bid-defense" source={p.defenseSkills} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={anyBusy || p.isArchivedLocked}
                  onClick={p.startGenerateDefenseOutline}
                  className="border-border text-card-foreground hover:bg-secondary"
                >
                  {p.defenseBusy === "outline" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {outlinePages.length ? "重新生成大纲" : "生成讲标大纲"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!outlinePages.length || p.pptSending || anyBusy || p.isArchivedLocked}
                  onClick={() => void p.sendOutlineToPpt()}
                  className="border-primary/40 text-primary hover:bg-primary/10 focus-visible:shadow-[var(--focus-ring)]"
                >
                  {p.pptSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  送进 PPT 与报价
                </Button>
              </div>
              {p.defenseBusy === "outline" && <BusyRow text="AI 正在按「项目理解 → 总体方案 → 分系统亮点 → 实施质保 → 服务承诺」编排大纲…" />}
              {!outlinePages.length && p.defenseBusy !== "outline" ? (
                <BlockEmpty text="尚未生成讲标大纲" hint="生成后可逐页编辑标题与要点，并一键送进 PPT 与报价模块继续美化" />
              ) : (
                <div className="grid gap-2.5 lg:grid-cols-2">
                  {outlinePages.map((pg, i) => (
                    <OutlinePageCard key={`${p.defense.updated_at}-${i}`} index={i} page={pg} revision={p.defense.updated_at} locked={p.isArchivedLocked} onSave={p.updateDefenseOutlinePage} />
                  ))}
                </div>
              )}
            </div>
          )}
        </DefenseBlock>

        {/* 讲标稿要点 */}
        <DefenseBlock
          icon={<Mic className="h-4 w-4" />}
          title="讲标稿要点"
          desc="与大纲页一一对应的口语化讲述要点：开场白、每页讲什么、收尾"
          badges={speechNotes ? <span className="badge-success">已生成</span> : undefined}
          open={openBlocks.speech}
          onToggle={() => toggleBlock("speech")}
        >
          {!p.defenseSpeechReady ? (
            <DependencyHint text="讲标稿要点依赖讲标大纲，请先在上方生成讲标大纲" />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SkillPickerFor scope="bid-defense" source={p.defenseSkills} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={anyBusy || p.isArchivedLocked}
                  onClick={p.startGenerateSpeechNotes}
                  className="border-border text-card-foreground hover:bg-secondary"
                >
                  {p.defenseBusy === "speech" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {speechNotes ? "重新生成讲标稿" : "生成讲标稿要点"}
                </Button>
                <span className="text-xs text-muted-foreground">生成后可逐段编辑，整体保存</span>
              </div>
              {p.defenseBusy === "speech" && <BusyRow text="AI 正在把大纲翻译成现场能照着讲的口语化要点…" />}
              {!speechNotes && p.defenseBusy !== "speech" ? (
                <BlockEmpty text="尚未生成讲标稿要点" hint="开场 150 字内、每页 2-3 句口语化讲述、收尾 100 字内，照着讲就行" />
              ) : speechNotes ? (
                <SpeechEditor notes={speechNotes} revision={p.defense.updated_at} locked={p.isArchivedLocked} onSave={p.updateSpeechNotes} />
              ) : null}
            </div>
          )}
        </DefenseBlock>
      </div>

      {/* 重复生成覆盖前的二次确认（Dialog，不用 window.confirm） */}
      <Dialog open={!!p.defenseConfirm} onOpenChange={(o) => { if (!o) p.setDefenseConfirm("") }}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle>重新生成{CONFIRM_LABEL[p.defenseConfirm] ?? ""}？</DialogTitle>
            <DialogDescription>
              现有内容将被覆盖且无法恢复，AI 会按最新标书内容重新生成
              {p.defenseConfirm === "outline" ? "（已生成的讲标稿要点会一并清空）" : ""}，本次调用照常计费。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => p.setDefenseConfirm("")} className="border-border text-card-foreground hover:bg-secondary">
              取消
            </Button>
            <Button onClick={p.confirmDefenseRegenerate} disabled={p.isArchivedLocked} className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
              确认重新生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
