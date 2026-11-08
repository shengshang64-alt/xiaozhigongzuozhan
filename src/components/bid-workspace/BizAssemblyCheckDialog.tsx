// UX-R3: S4 商务部分组卷检查 2026-11-08
//
// 用户问题：商务章按通用模板生成，没对齐招标文件的格式要求；用户不知道商务卷是否齐套。
// 本组件是「规则推导版」核对：内置一份常见商务必备项清单，按 bidBizSkeleton 的
// classifyBizChapter 匹配既有章节，逐项给出 齐套 / 需注意 / 缺失 三态。
//
// 诚实边界（不做解析增强）：
//   · 「格式依据」是通用规则占位说明，不是本项目招标文件的真实解析结果——文案明确标注
//     「通用规则」，为后续解析增强留位，绝不伪造。
//   · 不代写任何金额/承诺/公司信息（与 bidBizSkeleton 同一原则）。
import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, ClipboardList, Plus, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { classifyBizChapter, type BizChapterKind } from "@/pages/BidWorkspace/bidBizSkeleton"

type CheckItemState = "ok" | "warn" | "missing"

/** 清单项：必备件名 + 一键补入用的章标题 + 匹配规则（kind 优先，特殊项附标题正则） */
interface BizAssemblyItem {
  label: string
  insertTitle: string
  kind: BizChapterKind
  /** kind 不足以唯一定位时的标题附加匹配（中小企业声明函 share policy_declaration） */
  titleExtra?: RegExp
  /** 报价类文件：成稿里应出现数字，全是占位说明则提示「未填价」 */
  price?: boolean
  /** 通用规则说明（占位，非本项目解析结果） */
  basis: string
}

/** 常见商务必备件清单（S4 规则推导版；与 bidBizSkeleton 的分类器同一套匹配知识） */
const BIZ_ASSEMBLY_ITEMS: BizAssemblyItem[] = [
  {
    label: "投标函（报价函）",
    insertTitle: "投标函",
    kind: "bid_letter",
    price: true,
    basis: "通用规则：法定承诺文件，报价须与开标一览表、分项报价表三处一致",
  },
  {
    label: "法定代表人授权书 / 身份证明",
    insertTitle: "法定代表人授权书",
    kind: "authorization",
    basis: "通用规则：授权签署权文件，须用招标文件规定的格式并签字盖章",
  },
  {
    label: "开标一览表",
    insertTitle: "开标一览表",
    kind: "open_summary",
    price: true,
    basis: "通用规则：唱标依据，大小写金额须与投标函、分项报价表合计一致",
  },
  {
    label: "分项报价表",
    insertTitle: "分项报价表",
    kind: "price_sheet",
    price: true,
    basis: "通用规则：商务评分核心，合计金额须与开标一览表一致",
  },
  {
    label: "资格声明（营业执照等）",
    insertTitle: "资格声明",
    kind: "qualification",
    basis: "通用规则：资格性审查材料，须按招标文件「资格审查表」逐项提供",
  },
  {
    label: "中小企业声明函",
    insertTitle: "中小企业声明函",
    kind: "policy_declaration",
    titleExtra: /中小企业/,
    basis: "通用规则：享受中小企业扶持政策时必备，须按财库〔2020〕46 号格式填写",
  },
]

interface CheckResult {
  item: BizAssemblyItem
  state: CheckItemState
  /** 命中的章节标题（缺失时空） */
  hitTitles: string[]
  /** 需注意的具体原因 */
  warnReason?: string
}

/** 章节标题是否命中清单项（kind 主判，titleExtra 精确化） */
function matchesItem(item: BizAssemblyItem, chapterTitle: string): boolean {
  if (item.titleExtra) return item.titleExtra.test(chapterTitle)
  return classifyBizChapter(chapterTitle) === item.kind
}

/** 单项核对：缺失 / 已含但未填（或报价未填价）/ 齐套 */
function checkItem(item: BizAssemblyItem, chapters: { title?: string; content?: string }[]): CheckResult {
  const hits = chapters.filter((c) => matchesItem(item, c.title ?? ""))
  const hitTitles = hits.map((c) => c.title ?? "")
  if (!hits.length) return { item, state: "missing", hitTitles }
  const filled = hits.some((c) => {
    const content = (c.content ?? "").trim()
    if (!content) return false
    if (content.includes("【待填")) return false // 只有骨架占位，视为未填
    if (item.price && !/[0-9０-９]/.test(content)) return false
    return true
  })
  if (filled) return { item, state: "ok", hitTitles }
  const onlySkeleton = hits.some((c) => (c.content ?? "").includes("【待填"))
  const reason = onlySkeleton
    ? "已建章但仍是填写框架（【待填】未替换）"
    : item.price && hits.some((c) => (c.content ?? "").trim() && !/[0-9０-９]/.test(c.content ?? ""))
      ? "已建章但未见报价数字，请确认已填价"
      : "已建章但内容为空"
  return { item, state: "warn", hitTitles, warnReason: reason }
}

interface BizAssemblyCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chapters: { title?: string; content?: string }[]
  /** 一键补入缺失必备件（useBidWorkspace.addBizAssemblyItems：安全增量，不清正文） */
  onAddMissing?: (titles: string[]) => void
}

export function BizAssemblyCheckDialog({ open, onOpenChange, chapters, onAddMissing }: BizAssemblyCheckDialogProps) {
  const results = useMemo(() => BIZ_ASSEMBLY_ITEMS.map((it) => checkItem(it, chapters)), [chapters])
  const okCount = results.filter((r) => r.state === "ok").length
  const warnCount = results.filter((r) => r.state === "warn").length
  const missingCount = results.filter((r) => r.state === "missing").length
  const missingTitles = results.filter((r) => r.state === "missing").map((r) => r.item.insertTitle)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <ClipboardList className="h-4 w-4 text-primary" />
            商务部分组卷检查
          </DialogTitle>
          <DialogDescription className="text-left leading-relaxed">
            按通用规则核对常见商务必备件是否齐套。各项「格式依据」为通用规则说明，
            未对接本项目招标文件解析（接入后显示具体格式条款出处），请以招标文件「投标文件格式」章节为准。
          </DialogDescription>
        </DialogHeader>

        {/* 汇总：三态计数 + 一键补齐 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">齐套 {okCount}</span>
          {warnCount > 0 && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">需注意 {warnCount}</span>
          )}
          {missingCount > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">缺失 {missingCount}</span>
          )}
          {onAddMissing && missingCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
              onClick={() => onAddMissing(missingTitles)}
              title="把全部缺失必备件补为商务章节（同名跳过，不动既有正文）"
            >
              <Plus className="mr-1 h-3 w-3" />
              一键补齐 {missingCount} 项
            </Button>
          )}
        </div>

        <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
          {results.map((r) => (
            <li
              key={r.item.label}
              className={`rounded-lg border px-3 py-2 ${
                r.state === "ok"
                  ? "border-primary/20 bg-primary/5"
                  : r.state === "warn"
                    ? "border-warning/30 bg-warning/5"
                    : "border-destructive/30 bg-destructive/5"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {r.state === "ok" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  {r.state === "warn" && <AlertTriangle className="h-4 w-4 text-warning" />}
                  {r.state === "missing" && <XCircle className="h-4 w-4 text-destructive" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{r.item.label}</p>
                  {r.state === "ok" && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      已包含：{r.hitTitles.join("、")}
                    </p>
                  )}
                  {r.state === "warn" && (
                    <p className="mt-0.5 text-xs text-warning">
                      {r.warnReason}（{r.hitTitles.join("、")}）
                    </p>
                  )}
                  {r.state === "missing" && (
                    <p className="mt-0.5 text-xs text-destructive">
                      未在大纲中找到对应章节
                      {onAddMissing && (
                        <button
                          type="button"
                          onClick={() => onAddMissing([r.item.insertTitle])}
                          className="ml-2 rounded border border-primary/40 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                        >
                          补入「{r.item.insertTitle}」
                        </button>
                      )}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">格式依据（通用规则）：{r.item.basis}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-muted-foreground">
          商务卷里的金额、承诺、证照由你方按招标文件格式如实填写并盖章；系统只建章与给填写框架，不代写实质内容。
        </p>
      </DialogContent>
    </Dialog>
  )
}
