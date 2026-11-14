import { useRef, useState } from "react"
import { CircleAlert, Download, FileUp, Loader2, ShieldCheck } from "lucide-react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import {
  LEAN_IMPORT_COLUMNS,
  LEAN_IMPORT_TEMPLATE_FILENAME,
  leanImportCounts,
  leanImportTemplateCsv,
  parseLeanImportCsv,
  parseLeanImportTable,
  type LeanImportPreview,
  type LeanImportRow,
} from "@/pages/CustomerManagement/leanImport"

type ImportCheckupScreenProps = {
  onOpenCheckup: () => void
  onNewCustomer: () => void
  preview: LeanImportPreview | null
  parsing?: boolean
  applying?: boolean
  onPreviewRows: (rows: LeanImportRow[], parseErrors: string[]) => void | Promise<void>
  onApply: () => void
  onClearPreview: () => void
}

function downloadTemplate() {
  const blob = new Blob([leanImportTemplateCsv()], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = LEAN_IMPORT_TEMPLATE_FILENAME
  a.click()
  URL.revokeObjectURL(url)
}

async function parseImportFile(file: File): Promise<{ rows: LeanImportRow[]; errors: string[] }> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseLeanImportCsv(await file.text())
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: "array" })
    const first = wb.SheetNames[0]
    if (!first) return { rows: [], errors: ["Excel 里没有工作表"] }
    const table = (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, raw: false }) as unknown[][]).map((row) =>
      (row ?? []).map((cell) => String(cell ?? "").trim()),
    )
    return parseLeanImportTable(table)
  }
  return { rows: [], errors: ["请上传 CSV 或 Excel（.xlsx）模板，不要使用其它格式"] }
}

function GroupList({
  title,
  count,
  items,
}: {
  title: string
  count: number
  items: Array<{ hospitalName: string; reason?: string; extra?: string }>
}) {
  return (
    <section className="rounded-md border border-border px-3 py-2">
      <h4 className="text-xs font-semibold text-card-foreground">
        {title}
        <span className="ml-2 text-[11px] font-medium text-muted-foreground">{count}</span>
      </h4>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">无</p>
      ) : (
        <ul className="mt-1 flex max-h-28 flex-col gap-0.5 overflow-auto text-[11px] text-muted-foreground">
          {items.map((it, i) => (
            <li key={`${it.hospitalName}-${i}`}>
              {it.hospitalName}
              {it.extra ? ` · ${it.extra}` : ""}
              {it.reason ? `（${it.reason}）` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ImportCheckupScreen({
  onOpenCheckup,
  onNewCustomer,
  preview,
  parsing,
  applying,
  onPreviewRows,
  onApply,
  onClearPreview,
}: ImportCheckupScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState("")
  const counts = preview ? leanImportCounts(preview) : null
  const applicable = (counts?.create ?? 0) + (counts?.update ?? 0)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setLocalError("")
    try {
      const parsed = await parseImportFile(file)
      if (!parsed.rows.length && parsed.errors.length) {
        setLocalError(parsed.errors.join("；"))
        onClearPreview()
        return
      }
      await onPreviewRows(parsed.rows, parsed.errors)
    } catch {
      setLocalError("文件解析失败，请确认是 UTF-8 的 CSV 或标准 .xlsx")
      onClearPreview()
    } finally {
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="grid items-start gap-4 pb-10 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-md">
        <header className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="text-sm font-semibold text-card-foreground">客户数据体检</h3>
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">可用</span>
        </header>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          按字段维度扫一遍客户档案：官网待补 / 官网未核实、联系方式缺失、等级与区域空缺等都会归到人头上，
          逐条可点击直达该客户补全。投标与商机匹配依赖这些字段，建完档先跑一遍体检是惯例。
        </p>
        <Button size="sm" onClick={onOpenCheckup} className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          打开数据体检
        </Button>
        <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          批量补全入口在「客户列表」工具条，走官网、卫健委、政府公开信息和可抓到的公众号，结果带来源并标「AI 提供需核实」；本屏不重复入口。
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-md">
        <header className="flex items-center gap-2">
          <FileUp className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="text-sm font-semibold text-card-foreground">经营数据瘦模板导入</h3>
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">预览后写入</span>
        </header>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          只导入联系人、商机和跟进。按标准医院名去重；已有客户只追加联系人、跟进记录和商机，不会覆盖已核实的等级、官网、床位等公开字段。
          名称对不上或只是接近的，先列入待确认，不会自动合并。
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">列：{LEAN_IMPORT_COLUMNS.join("、")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={downloadTemplate} className="border-border text-card-foreground hover:bg-secondary">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            下载 CSV 模板
          </Button>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={parsing || applying} className="border-border text-card-foreground hover:bg-secondary">
            {parsing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}
            上传 CSV / Excel
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls,text/csv"
            className="hidden"
            data-testid="lean-import-file"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>
        {(localError || (preview && preview.errors.length > 0)) && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {localError || preview?.errors.join("；")}
          </p>
        )}
        {preview && counts ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span>新建客户 {counts.create}</span>
              <span>更新联系人与跟进 {counts.update}</span>
              <span>重复跳过 {counts.skip}</span>
              <span>名称待确认 {counts.pending}</span>
            </div>
            <GroupList title="新建客户" count={counts.create} items={preview.create.map((i) => ({ hospitalName: i.hospitalName, extra: `联系人 ${i.contactsToAdd.length}` }))} />
            <GroupList title="更新联系人与跟进" count={counts.update} items={preview.update.map((i) => ({ hospitalName: i.hospitalName, extra: `+联系人 ${i.contactsToAdd.length}` }))} />
            <GroupList title="重复跳过" count={counts.skip} items={preview.skip.map((i) => ({ hospitalName: i.hospitalName, reason: i.reason }))} />
            <GroupList title="名称对不上待确认" count={counts.pending} items={preview.pending.map((i) => ({ hospitalName: i.hospitalName, reason: i.reason }))} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onClearPreview} disabled={applying}>
                清空预览
              </Button>
              <Button size="sm" onClick={onApply} disabled={applying || applicable === 0} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                确认导入（{applicable} 家）
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">
            也可以先「新建客户」建档，再回来补经营数据。上传后先预览，确认才会写库。
            <button type="button" onClick={onNewCustomer} className="ml-1 text-primary underline-offset-2 hover:underline">
              新建客户
            </button>
          </p>
        )}
      </section>
    </div>
  )
}
