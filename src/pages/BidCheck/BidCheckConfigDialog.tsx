// ---------------------------------------------------------------------------
// BidCheckConfigDialog —— 暗标 / 检查配置编辑（词库 + 格式标准 + 层级开关）。
//
// 设计红线：所有字段「留空即不判」——暗标格式标准默认 null，未配置时规则层标「标准未配置」。
// 保存仅写 localStorage，不改任何标书内容。
// ---------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { FORMAT_CHECK_KEYS, FORMAT_CHECK_LABEL, type FormatCheckKey } from "@/pages/BidWorkspace/bidTypes"
import type { CheckConfig } from "./config/checkConfig"
import type { AnbidCheckConfig } from "./config/anbidCheckConfig"
import { parseWordList, wordListToText } from "./config/anbidCheckConfig"

type TriState = "true" | "false" | "null"
const toTri = (v: boolean | null): TriState => (v === true ? "true" : v === false ? "false" : "null")
const fromTri = (v: TriState): boolean | null => (v === "true" ? true : v === "false" ? false : null)

type Props = {
  open: boolean
  onClose: () => void
  anbid: AnbidCheckConfig
  checkCfg: CheckConfig
  onSaveAnbid: (patch: Partial<AnbidCheckConfig>) => void
  onSaveCheck: (patch: Partial<CheckConfig>) => void
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function BidCheckConfigDialog({ open, onClose, anbid, checkCfg, onSaveAnbid, onSaveCheck }: Props) {
  // 打开时以生效配置快照初始化草稿；关闭/保存不自动回写直到点「保存」
  const [identity, setIdentity] = useState("")
  const [brand, setBrand] = useState("")
  const [person, setPerson] = useState("")
  const [exclude, setExclude] = useState("")
  const [bodyFont, setBodyFont] = useState("")
  const [bodySize, setBodySize] = useState("")
  const [lineSpacing, setLineSpacing] = useState("")
  const [maxPages, setMaxPages] = useState("")
  const [mt, setMt] = useState("")
  const [mr, setMr] = useState("")
  const [mb, setMb] = useState("")
  const [ml, setMl] = useState("")
  const [allowPage, setAllowPage] = useState<TriState>("null")
  const [allowColor, setAllowColor] = useState<TriState>("null")
  const [separate, setSeparate] = useState<TriState>("null")
  const [fatal, setFatal] = useState(false)
  const [keys, setKeys] = useState<Set<string>>(new Set())

  // 弹窗打开时以生效配置快照重置草稿：同步 setState 无外部系统可接、不构成级联渲染
  // （「open 变 true 即重置草稿」是弹窗草稿态的既定 React 模式，同 useActiveWork 登出清空口径）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setIdentity(wordListToText(anbid.identityWords))
    setBrand(wordListToText(anbid.brandProductWords))
    setPerson(wordListToText(anbid.personNames))
    setExclude(wordListToText(anbid.excludeTerms))
    const fs = anbid.formatStandard
    setBodyFont(fs.bodyFont ?? "")
    setBodySize(fs.bodySize ?? "")
    setLineSpacing(fs.lineSpacing ?? "")
    setMaxPages(fs.maxPages == null ? "" : String(fs.maxPages))
    setMt(fs.margins ? String(fs.margins.top) : "")
    setMr(fs.margins ? String(fs.margins.right) : "")
    setMb(fs.margins ? String(fs.margins.bottom) : "")
    setMl(fs.margins ? String(fs.margins.left) : "")
    setAllowPage(toTri(fs.allowPageNumber))
    setAllowColor(toTri(fs.allowColor))
    setSeparate(toTri(fs.requireSeparateBooklet))
    setFatal(anbid.sealedViolationIsFatal)
    setKeys(new Set(checkCfg.formatKeys))
  }, [open, anbid, checkCfg])
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleKey = (k: string) => {
    setKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const save = () => {
    const marginsNum = [mt, mr, mb, ml].map((s) => Number(s))
    const hasMargins = marginsNum.every((n) => Number.isFinite(n) && n > 0 && n < 100)
    onSaveAnbid({
      identityWords: parseWordList(identity),
      brandProductWords: parseWordList(brand),
      personNames: parseWordList(person),
      excludeTerms: parseWordList(exclude),
      sealedViolationIsFatal: fatal,
      formatStandard: {
        bodyFont: bodyFont.trim() || null,
        bodySize: bodySize.trim() || null,
        lineSpacing: lineSpacing.trim() || null,
        margins: hasMargins ? { top: marginsNum[0], right: marginsNum[1], bottom: marginsNum[2], left: marginsNum[3] } : null,
        allowPageNumber: fromTri(allowPage),
        allowColor: fromTri(allowColor),
        requireSeparateBooklet: fromTri(separate),
        maxPages: maxPages.trim() && Number.isFinite(Number(maxPages)) && Number(maxPages) > 0 ? Math.floor(Number(maxPages)) : null,
      },
    })
    onSaveCheck({ formatKeys: [...keys] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>检查配置（暗标词库 · 格式标准 · 禁则开关）</DialogTitle>
          <DialogDescription>
            售前按招标文件暗标条款回填；<b>留空的格式项不判定</b>（标「标准未配置」），绝不臆测。仅保存本机，不改标书内容。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-6 overflow-y-auto pr-1">
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              暗标身份词库 <Badge variant="danger">命中即废标</Badge>
            </h3>
            <Field label="公司名 / 简称 / 曾用名" hint="一行一个；用于 A1 正文与元数据匹配">
              <Textarea rows={2} value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="例如：XX科技有限公司" />
            </Field>
            <Field label="品牌 / 产品 / 平台名">
              <Textarea rows={2} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <Field label="人名（法人 / 代表 / 项目经理）">
              <Textarea rows={2} value={person} onChange={(e) => setPerson(e.target.value)} />
            </Field>
            <Field label="反向排除词" hint="命中这些串时不误报为公司身份（如项目名本身）">
              <Textarea rows={1} value={exclude} onChange={(e) => setExclude(e.target.value)} />
            </Field>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">暗标格式标准（未填=不判定）</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="要求正文字体"><Input value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} placeholder="宋体 / 留空" /></Field>
              <Field label="要求字号"><Input value={bodySize} onChange={(e) => setBodySize(e.target.value)} placeholder="小四 / 留空" /></Field>
              <Field label="要求行距"><Input value={lineSpacing} onChange={(e) => setLineSpacing(e.target.value)} placeholder="1.5倍 / 留空" /></Field>
              <Field label="页数上限"><Input value={maxPages} onChange={(e) => setMaxPages(e.target.value)} inputMode="numeric" placeholder="如 80 / 留空" /></Field>
            </div>
            <Field label="页面边距（cm：上 / 右 / 下 / 左）">
              <div className="grid grid-cols-4 gap-2">
                <Input value={mt} onChange={(e) => setMt(e.target.value)} inputMode="decimal" placeholder="上" />
                <Input value={mr} onChange={(e) => setMr(e.target.value)} inputMode="decimal" placeholder="右" />
                <Input value={mb} onChange={(e) => setMb(e.target.value)} inputMode="decimal" placeholder="下" />
                <Input value={ml} onChange={(e) => setMl(e.target.value)} inputMode="decimal" placeholder="左" />
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="是否允许页码">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={allowPage} onChange={(e) => setAllowPage(e.target.value as TriState)}>
                  <option value="null">未配置</option>
                  <option value="true">必须编页码</option>
                  <option value="false">禁止页码</option>
                </select>
              </Field>
              <Field label="颜色要求">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={allowColor} onChange={(e) => setAllowColor(e.target.value as TriState)}>
                  <option value="null">未配置</option>
                  <option value="true">允许彩色</option>
                  <option value="false">要求全黑白</option>
                </select>
              </Field>
              <Field label="是否单独成册">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={separate} onChange={(e) => setSeparate(e.target.value as TriState)}>
                  <option value="null">未配置</option>
                  <option value="true">必须单独成册</option>
                  <option value="false">不必</option>
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fatal} onChange={(e) => setFatal(e.target.checked)} />
              暗标违规即废标（勾选后存在必改项将<span className="font-medium">硬阻断导出</span>；不勾选=警告 + 二次确认可继续）
            </label>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">L1 本地格式禁则（复用交卷体检规则表）</h3>
            <div className="flex flex-wrap gap-2">
              {(FORMAT_CHECK_KEYS as FormatCheckKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKey(k)}
                  className={
                    "rounded-full border px-3 py-1 text-xs " +
                    (keys.has(k) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")
                  }
                >
                  {FORMAT_CHECK_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">身份泄露（identity_leak）由暗标层 L5 统一处理，此处勾选不重复。</p>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存配置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
