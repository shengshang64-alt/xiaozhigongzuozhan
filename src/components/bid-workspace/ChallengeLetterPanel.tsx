import { useState } from "react"
import { Loader2, Gavel, Wand2, Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { chatViaGateway } from "@/lib/modelGateway"
import {
  buildChallengeLetter,
  validateChallengeFields,
  challengeDeadline7WorkingDays,
  STANDARD_LEGAL_REFS,
  type ChallengeSupplier,
  type ChallengeProject,
  type ChallengeItem,
  type ChallengeLetterInput,
} from "@/pages/BidWorkspace/challengeLetter"

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

interface Props {
  tenderText?: string
  archived?: boolean
  runWithCostConfirm?: (fn: () => void, message: string) => void
}

export function ChallengeLetterPanel({ tenderText, archived, runWithCostConfirm }: Props) {
  const [supplier, setSupplier] = useState<ChallengeSupplier>({ name: "", address: "", postalCode: "", contactName: "", contactPhone: "" })
  const [project, setProject] = useState<ChallengeProject>({ projectName: "", projectNumber: "", purchaserName: "" })
  const [items, setItems] = useState<ChallengeItem[]>([{ topic: "", request: "", facts: "", legalBasis: "" }])
  const [date, setDate] = useState(todayStr)
  const [letter, setLetter] = useState("")
  const [aiBusy, setAiBusy] = useState(false)

  const deadline = challengeDeadline7WorkingDays(new Date())

  const setSup = (k: keyof ChallengeSupplier) => (e: React.ChangeEvent<HTMLInputElement>) => setSupplier((p) => ({ ...p, [k]: e.target.value }))
  const setPrj = (k: keyof ChallengeProject) => (e: React.ChangeEvent<HTMLInputElement>) => setProject((p) => ({ ...p, [k]: e.target.value }))
  const setItemField = (idx: number, k: keyof ChallengeItem) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setItems((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [k]: e.target.value }; return n })
  }
  const addItem = () => setItems((p) => [...p, { topic: "", request: "", facts: "", legalBasis: "" }])
  const removeItem = (i: number) => { if (items.length > 1) setItems((p) => p.filter((_, x) => x !== i)) }

  function handleGenerate() {
    const input: ChallengeLetterInput = { supplier, project, items, date }
    const missing = validateChallengeFields(input)
    if (missing.length) {
      toast.error(`请补全以下要素：${missing.join("、")}`)
      return
    }
    setLetter(buildChallengeLetter(input))
  }

  /** AI 兜底：补全事实依据与法律依据 */
  function handleAiEnhance() {
    if (!runWithCostConfirm || archived) return
    const validItems = items.filter((it) => it.topic.trim())
    if (!validItems.length) { toast.error("请先填写至少一项质疑事项"); return }
    runWithCostConfirm(() => {
      void (async () => {
        setAiBusy(true)
        try {
          const context = (tenderText ?? "").slice(0, 8000)
          const topicDesc = validItems.map((it, i) => `事项${i + 1}：${it.topic}`).join("\n")
          const res = await chatViaGateway({
            modelRef: null,
            messages: [
              { role: "system", content: [
                `你是政府采购维权助手。依据以下招标文件片段和质疑事项，为每项补充「事实依据」和「法律依据」。`,
                `输出严格 JSON 数组（禁止代码围栏），每项一个对象：[{"facts":"...","legalBasis":"..."}]`,
                `法律依据必须引用具体法规条款号（政府采购法、实施条例第20条、94号令第12条等），可参考模板：${STANDARD_LEGAL_REFS.general}`,
              ].join("\n") },
              { role: "user", content: `【招标文件片段】\n${context}\n\n【质疑事项】\n${topicDesc}\n\n请输出 ${validItems.length} 条事实依据与法律依据 JSON 数组。` },
            ],
            page: "bid-workspace",
            max_tokens: 2048,
          })
          if (!res.ok || !res.text) throw new Error(res.error || "AI 生成失败")
          const t = res.text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
          const start = t.indexOf("["); const end = t.lastIndexOf("]")
          if (start < 0 || end <= start) throw new Error("格式解析失败")
          const arr = JSON.parse(t.slice(start, end + 1)) as Array<{ facts?: string; legalBasis?: string }>
          let ai = 0
          setItems((prev) => prev.map((it) => {
            if (!it.topic.trim()) return it
            const enh = arr[ai]; if (!enh) return it
            ai++
            return { ...it, facts: it.facts || (enh.facts ?? ""), legalBasis: it.legalBasis || (enh.legalBasis ?? "") }
          }))
          toast.success("AI 已兜底补全事实依据与法律依据")
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "AI 补全失败")
        } finally { setAiBusy(false) }
      })()
    }, "将调用 AI 为质疑函事实依据/法律依据兜底补全，按 token 计费")
  }

  function copyLetter() { navigator.clipboard.writeText(letter).then(() => toast.success("已复制到剪贴板")) }
  function downloadLetter() {
    const blob = new Blob(["\ufeff" + letter], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = `质疑函_${project.projectNumber || "draft"}.txt`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-5">
      {/* 时限提示 */}
      <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
        依据《质疑和投诉办法》第十二条：须在知道或应知权益受损之日起 <b>7 个工作日</b> 内提出（若今天为起算日，截止不晚于 <b>{deadline}</b>）。
      </p>

      {/* 一、供应商信息 */}
      <fieldset className="grid gap-2 rounded-lg border border-border p-4">
        <legend className="px-1 text-xs font-semibold text-foreground">一、供应商信息</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input placeholder="供应商全称" value={supplier.name} onChange={setSup("name")} />
          <Input placeholder="注册地址" value={supplier.address} onChange={setSup("address")} />
          <Input placeholder="邮政编码" value={supplier.postalCode} onChange={setSup("postalCode")} className="sm:w-32" />
          <Input placeholder="联系人" value={supplier.contactName} onChange={setSup("contactName")} />
          <Input placeholder="联系电话" value={supplier.contactPhone} onChange={setSup("contactPhone")} />
        </div>
      </fieldset>

      {/* 二、项目信息 */}
      <fieldset className="grid gap-2 rounded-lg border border-border p-4">
        <legend className="px-1 text-xs font-semibold text-foreground">二、项目信息</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input placeholder="项目名称" value={project.projectName} onChange={setPrj("projectName")} />
          <Input placeholder="项目编号（含包号）" value={project.projectNumber} onChange={setPrj("projectNumber")} />
          <Input placeholder="采购人/代理机构" value={project.purchaserName ?? ""} onChange={setPrj("purchaserName")} />
        </div>
      </fieldset>

      {/* 三、质疑事项（动态可多条） */}
      <fieldset className="grid gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-xs font-semibold text-foreground">三、质疑事项（每项含 4 子段）</legend>
        {items.map((it, idx) => (
          <div key={idx} className="grid gap-2 rounded border border-border/60 bg-secondary/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">事项 {idx + 1}</span>
              {items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="text-xs text-destructive hover:underline">删除</button>}
            </div>
            <Input placeholder="质疑事项（具体明确）" value={it.topic} onChange={setItemField(idx, "topic")} />
            <Textarea placeholder="事实依据（客观描述支撑事实）" value={it.facts} onChange={setItemField(idx, "facts")} className="min-h-16" />
            <Textarea placeholder="法律依据（引用具体条款）" value={it.legalBasis} onChange={setItemField(idx, "legalBasis")} className="min-h-16" />
            <Input placeholder="请求（如修改采购文件、重新评审）" value={it.request} onChange={setItemField(idx, "request")} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addItem} className="self-start">+ 新增质疑事项</Button>
      </fieldset>

      {/* 四、日期 */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-foreground">提出日期</label>
        <Input value={date} onChange={(e) => setDate(e.target.value)} className="w-48" placeholder="YYYY年MM月DD日" />
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleGenerate} disabled={archived} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
          <Gavel className="mr-1.5 h-4 w-4" />
          生成质疑函
        </Button>
        {runWithCostConfirm && (
          <Button variant="outline" onClick={handleAiEnhance} disabled={aiBusy || archived}>
            {aiBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
            AI 兜底补全
          </Button>
        )}
      </div>

      {/* 结果 */}
      {letter && (
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">质疑函预览</h3>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={copyLetter}><Copy className="mr-1 h-3.5 w-3.5" />复制</Button>
              <Button size="sm" variant="ghost" onClick={downloadLetter}><Download className="mr-1 h-3.5 w-3.5" />下载</Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{letter}</pre>
        </div>
      )}
    </div>
  )
}
