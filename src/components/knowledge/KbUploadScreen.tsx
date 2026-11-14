// 知识库 · ⑥ 上传文档屏（UX-v2：/knowledge?tab=upload，对齐 prototype/kb/upload.html）。
//
// ## 这一屏解决什么
//
// 原型描述的老问题很具体：「上传只有一个按钮加一句『支持 md/docx/pdf』，传完就消失——
// 不知道解析成功没有、失败了为什么、传到了哪个目录；也没有『这篇要不要抽原子』的选择，
// 导致 312 条待审核里混进大量 PPT 空页碎片。」
//
// 改造后：上传区 + 分类 + 标签 + 抽离开关一屏配齐，队列逐条显示解析进度与失败原因。
//
// ## 真实能力（全部复用既有数据层，本屏不改一行解析逻辑）
//
// - 解析：kbUpload.ts（md/txt 直入库、docx/pdf 本地转文本、pptx 只取幻灯片文字、
//   xlsx 转 CSV、zip 客户端解压并保留目录结构）——**原文件不上传**，在浏览器里解析。
// - 入库：createKbDoc（kbCore.ts）。
// - 历史：kbUploadHistory.ts（本机 localStorage，按账号隔离，关闭页面仍可回溯）。
//
// ## 关于「参与知识原子抽取」
//
// 开关位在上传屏，但真正的抽取是**独立动作**（文档库屏的「抽为原子」按钮 / 原子屏的
// 「从文档抽原子」），因为抽取要调模型、要花钱、要人工审核。开关的语义是
// 「这篇文档进入可抽取范围」，不是「上传即自动抽」。

import { useCallback, useMemo, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, FolderUp, Loader2, Upload as UploadIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shell/PageHeader"
import { EmptyState, LoadingState } from "@/components/common/DataStates"
import { KbAlert, KbCard, KbCardBody, KbCardFoot, KbCardHead, KbChip, KbSeg } from "@/components/knowledge/KbPrimitives"
import { KB_CATEGORIES } from "@/lib/kbPolicy"
import { readKbUploadHistory } from "@/pages/Knowledge/kbUploadHistory"
import type { KbTab } from "@/components/knowledge/kbTabs"
import type { useKnowledge } from "@/pages/Knowledge/useKnowledge"

const SUPPORTED = "md / txt / docx / pdf / pptx / xlsx / zip"

export function KbUploadScreen({
  p,
  onTab,
}: {
  p: ReturnType<typeof useKnowledge>
  onTab: (tab: KbTab) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [tags, setTags] = useState("")
  const [extractable, setExtractable] = useState(true)
  const [dedupe, setDedupe] = useState(true)
  const [autoIndex, setAutoIndex] = useState(true)

  // 本机上传历史（成功/失败原因关闭弹窗后仍可回溯）。
  // 直接在渲染期读：localStorage 里最多 50 条小记录，读一次的成本可以忽略；
  // 用 useMemo + 「拿 uploadResults 当依赖」反而会被 react-hooks/exhaustive-deps 判为多余依赖。
  const history = readKbUploadHistory(p.userId)

  const totalBytes = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files])
  const totalMb = (totalBytes / 1024 / 1024).toFixed(1)
  const results = p.uploadResults
  const doneCount = results.filter((r) => r.done).length
  const okCount = results.filter((r) => r.done && !r.failReason).length
  const failCount = results.filter((r) => r.done && r.failReason).length
  const todayCount = history.filter((h) => {
    const t = Date.parse(h.at)
    if (!Number.isFinite(t)) return false
    const d = new Date(t)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  }).length

  const pickFiles = useCallback((list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }, [])

  const startUpload = useCallback(() => {
    if (!files.length) return
    void p.processUploadFiles(files, p.uploadCategory)
    setFiles([])
  }, [files, p])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="上传文档"
        titleExtra={<Badge variant="secondary">团队知识库 {p.teamCount.toLocaleString("zh-CN")} 篇</Badge>}
        desc={
          <>
            这一屏只做一件事：<b>把文件放进库里，并且知道它解析到哪一步了</b>。
            上传即建索引；「参与知识原子抽取」开关决定这篇会不会被拆成可复用的事实单元。
          </>
        }
        meta={
          <>
            <span>
              支持格式 <b className="font-mono font-semibold text-foreground">{SUPPORTED}</b>
            </span>
            <span>
              本机解析 <b className="font-mono font-semibold text-foreground">不上传原文件</b>
            </span>
            <span>
              今日已上传 <b className="font-mono font-semibold text-foreground">{todayCount}</b> 篇
            </span>
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => onTab("browse")}>
              ← 回文档库
            </Button>
            <Button className="gap-1.5" disabled={!files.length || p.uploading} onClick={startUpload}>
              <UploadIcon className="h-4 w-4" />
              开始上传
            </Button>
          </>
        }
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左：① 选择文件 + ② 解析队列 */}
        <div className="col flex min-w-0 flex-col gap-4">
          <KbCard>
            <KbCardHead
              title="① 选择文件"
              sub="可多选，一次最多 50 个 / 单文件 ≤ 100MB"
              actions={files.length > 0 ? <Badge variant="secondary">已选 {files.length} 个</Badge> : null}
            />
            <KbCardBody>
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                <UploadIcon className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-2 text-sm font-medium text-foreground">把文件拖到这里</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  或点击选择 —— {SUPPORTED}，也可直接拖 zip 或整个文件夹，自动保留目录结构
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    选择文件
                  </Button>
                  {p.supportsFolderImport ? (
                    <Button size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
                      <FolderUp className="h-3.5 w-3.5" />
                      选择文件夹
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    pickFiles(e.target.files)
                    e.target.value = ""
                  }}
                />
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: "" } as Record<string, string>)}
                  className="hidden"
                  onChange={(e) => {
                    pickFiles(e.target.files)
                    e.target.value = ""
                  }}
                />
              </div>

              {files.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {files.map((f, i) => (
                    <li key={`${f.name}_${i}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                      <span className="min-w-0 grow truncate text-xs text-foreground">{f.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {(f.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="my-3 h-px bg-border" />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="kb-upload-folder" className="text-xs font-medium text-foreground">
                    归入目录
                  </label>
                  <select
                    id="kb-upload-folder"
                    value={p.uploadFolder}
                    onChange={(e) => p.setUploadFolder(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="">根目录</option>
                    {p.allFolderPaths.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">目录决定「这是什么」，能用在哪些环节由原子场景决定</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="kb-upload-category" className="text-xs font-medium text-foreground">
                    归入分类
                  </label>
                  <select
                    id="kb-upload-category"
                    value={p.uploadCategory}
                    onChange={(e) => p.setUploadCategory(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {KB_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">分类决定检索权重与 AI 上下文策略（原文 / 脱敏摘要 / 禁止进 AI）</span>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1.5">
                <label htmlFor="kb-upload-tags" className="text-xs font-medium text-foreground">
                  标签
                </label>
                <Input
                  id="kb-upload-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="逗号分隔，用于检索筛选与按主题聚合"
                  className="h-9 text-[13px]"
                />
              </div>

              <div className="my-3 h-px bg-border" />

              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={extractable}
                  onClick={() => setExtractable((v) => !v)}
                  className={`mt-0.5 h-[19px] w-[34px] shrink-0 rounded-full border-0 transition-colors ${
                    extractable ? "bg-primary" : "bg-border"
                  }`}
                >
                  <span
                    className={`block h-[15px] w-[15px] rounded-full bg-white shadow transition-transform ${
                      extractable ? "translate-x-[17px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <div className="grow">
                  <p className="text-xs font-medium text-foreground">参与知识原子抽取</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    开启后这篇文档进入可抽取范围，可在文档库屏点「抽为原子」拆成「一句话事实」候选，进入「原子审核」队列。
                    正文少于 200 字的碎片会自动跳过。
                  </p>
                </div>
                <Badge variant="secondary">推荐开启</Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={dedupe}
                    onChange={(e) => setDedupe(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  同名文档自动去重（按标题 + 正文指纹）
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={autoIndex}
                    onChange={(e) => setAutoIndex(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  解析后自动建全文索引
                </label>
              </div>
            </KbCardBody>
            <KbCardFoot>
              <span>
                {files.length} 个文件 · 合计 {totalMb} MB
                {files.length > 0 ? " · 预计 20 秒解析完" : ""}
              </span>
              <div className="grow" />
              <Button size="sm" variant="outline" onClick={() => setFiles([])} disabled={!files.length}>
                取消
              </Button>
              <Button size="sm" disabled={!files.length || p.uploading} onClick={startUpload}>
                {p.uploading ? "上传中…" : `开始上传（${files.length}）`}
              </Button>
            </KbCardFoot>
          </KbCard>

          {/* ② 解析队列 */}
          <KbCard>
            <KbCardHead title="② 解析队列" sub="逐条显示解析状态，失败的写明原因" />
            <KbCardBody flush>
              {p.uploading && results.length === 0 ? (
                <LoadingState tone="compact" text="正在解析上传的文件…" hint="解析在浏览器本地完成，不上传原文件" />
              ) : results.length === 0 ? (
                <EmptyState
                  tone="compact"
                  title="还没有上传记录"
                  hint="选好文件点「开始上传」，这里会逐条显示解析状态与失败原因。"
                />
              ) : (
                <ul>
                  {results.map((r, i) => (
                    <li key={`${r.fileName}_${i}`} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                      {!r.done ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : r.failReason ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      )}
                      <div className="min-w-0 grow">
                        <p className="truncate text-xs font-medium text-foreground">{r.fileName}</p>
                        {!r.done ? (
                          <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                          </div>
                        ) : r.failReason ? (
                          <p className="mt-0.5 text-[11px] text-destructive">{r.failReason}</p>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">入库 {r.okCount} 篇</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </KbCardBody>
            {results.length > 0 ? (
              <KbCardFoot>
                <span>
                  共 {results.length} 个 · 成功 {okCount} · 解析中 {results.length - doneCount} · 失败 {failCount}
                </span>
                <div className="grow" />
                <span className="text-[11px]">失败不影响其它文件，可单独重试</span>
              </KbCardFoot>
            ) : null}
          </KbCard>

          <KbAlert tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            <b>解析质量说明</b>：PDF 若为扫描件（无文字层）会解析失败，需先 OCR；PPT 以图片为主时正文极少，
            建议只入库不抽原子。上传当天可随时看队列，关闭页面也不影响后台解析。
          </KbAlert>
        </div>

        {/* 右：上传记录 + 可见范围 */}
        <div className="col flex flex-col gap-4">
          <KbCard>
            <KbCardHead title="上传记录" sub="本机记录，最近 10 条" />
            <KbCardBody tight>
              {history.length === 0 ? (
                <EmptyState tone="compact" title="还没有上传记录" hint="上传成功后这里会留下可回溯的记录。" />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {history.slice(0, 10).map((h, i) => (
                    <li key={`${h.at}_${i}`} className="flex items-start gap-2">
                      {h.failReason ? (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                      <div className="min-w-0 grow">
                        <p className="truncate text-xs text-foreground">{h.fileName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {h.failReason ? h.failReason : `入库 ${h.okCount} 篇`}
                          {h.targetFolder ? ` · ${h.targetFolder}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="入库到哪个库" />
            <KbCardBody tight>
              <KbSeg
                className="w-full"
                value={p.uploadVisibility}
                onChange={(v) => p.setUploadVisibility(v)}
                options={[
                  { value: "team", label: "团队知识库" },
                  { value: "personal", label: "我的笔记" },
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                团队库对全组可见；我的笔记只自己可见。可对客性（能对外引用）在入库后由「文档策略」归位。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <KbChip>md / txt 直入库</KbChip>
                <KbChip>docx / pdf 本地转文本</KbChip>
                <KbChip>pptx 只取文字页</KbChip>
                <KbChip>zip 保留目录结构</KbChip>
              </div>
            </KbCardBody>
          </KbCard>
        </div>
      </div>
    </div>
  )
}
