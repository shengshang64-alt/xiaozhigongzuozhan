// 素材库 · 导入（UX-v2：prototype/material/import.html）
//
// 原型是三步屏（① 上传 ② 已选文件 ③ 入库结果）。现网一次批量导入直接出结果，
// 因此本屏按「① 上传与规则 → ② 已选文件与进度 → ③ 入库结果」三段呈现，
// 语义与原型一致（文件级状态 / 重复跳过 / 待分类），但不假装有「下一步」按钮——
// 现网是选中即入库，没有中间确认态，这一点如实说明。
//
// 数据边界：原型展示「8 个文件 / 2 个重复 / 2 个待分类」是演示值；
// 这里只在真导入后按 importResult 显示真实计数，未导入时为空态。
import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { FolderInput, ImagePlus, Loader2, Tags, X } from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { statText } from "./materialCore"
import { MATERIAL_CATEGORIES } from "./materialTypes"
import type { UseMaterialLibrary } from "./useMaterialLibrary"

export function MaterialImportScreen({ p }: { p: UseMaterialLibrary }) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const progressPct = p.importProgress
    ? Math.round((p.importProgress.done / Math.max(p.importProgress.total, 1)) * 100)
    : 0

  return (
    <div>
      <PageHeader
        title="导入素材"
        titleExtra={
          p.importProgress ? (
            <Badge variant="neutral">进行中 {progressPct}%</Badge>
          ) : p.importResult ? (
            <Badge variant="success">上次导入完成</Badge>
          ) : (
            <Badge variant="neutral">等待选择文件</Badge>
          )
        }
        desc={
          <>
            这一屏只做一件事：
            <b className="font-semibold text-foreground">把本地图片批量入库，自动去重、自动缩略图、自动分类</b>
            。命名规范会自动转成名称与标签，省掉逐张录入。
          </>
        }
        meta={
          <>
            <span>
              库内现有 <b className="font-mono font-semibold text-foreground">{statText(p.stats?.total)}</b> 个素材
            </span>
            <span>
              导入分类{" "}
              <b className="font-mono font-semibold text-foreground">{p.importCategory}</b>
            </span>
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/materials")}>
            <FolderInput className="h-3.5 w-3.5" /> 回素材总览
          </Button>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* ① 上传与规则 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h3 className="text-[15px] font-semibold text-foreground">① 选择文件</h3>
              <span className="text-xs text-muted-foreground">支持多选 · 单图上限 6MB</span>
            </header>
            <div className="space-y-3 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <span className="mb-1 block text-[11.5px] font-medium text-foreground">入库分类</span>
                  <Select value={p.importCategory} onValueChange={p.setImportCategory}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATERIAL_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="self-end">
                  <Button size="sm" disabled={!!p.importProgress} onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="mr-1 h-3.5 w-3.5" />
                    选择图片（可多选）
                  </Button>
                </div>
                {p.importProgress ? (
                  <div className="self-end">
                    <Button size="sm" variant="outline" onClick={p.cancelImport}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      取消
                    </Button>
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = [...(e.target.files || [])]
                    e.target.value = ""
                    if (files.length) void p.importFiles(files)
                  }}
                />
              </div>
              <p className="rounded-md bg-secondary/50 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                命名规范：<span className="font-mono">来源_内容_日期.jpg</span>（如{" "}
                <span className="font-mono">pexels_医院走廊_20261008.jpg</span>），日期段与扩展名会自动剥除转为名称与标签；
                自动生成 400px 缩略图、按 sha256 去重（重复文件自动跳过）、超 6MB 自动压缩。
              </p>
            </div>
          </section>

          {/* ② 进度 / 已选文件 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h3 className="text-[15px] font-semibold text-foreground">② 入库进度</h3>
              {p.importProgress ? (
                <Badge variant="neutral" className="text-[10px]">
                  {p.importProgress.done}/{p.importProgress.total}
                </Badge>
              ) : null}
            </header>
            <div className="px-4 py-3.5">
              {p.importProgress ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span className="truncate">正在入库：{p.importProgress.current}</span>
                    <span className="font-mono">{progressPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    逐张上传中，可随时点「取消」；已入库的不会回滚。
                  </p>
                </div>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  还没有进行中的导入。选好文件后会立刻开始逐张入库，进度显示在这里。
                </p>
              )}
            </div>
          </section>

          {/* ③ 结果 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h3 className="text-[15px] font-semibold text-foreground">③ 入库结果</h3>
              <div className="flex-1" />
              {p.importResult ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate("/materials")}>
                  去素材总览看
                </Button>
              ) : null}
            </header>
            <div className="px-4 py-3.5">
              {p.importResult ? (
                <>
                  <div className="flex flex-wrap gap-4 text-[12.5px]">
                    <span>
                      新增 <b className="font-mono text-[15px] text-foreground">{p.importResult.added}</b>
                    </span>
                    <span>
                      重复跳过 <b className="font-mono text-[15px] text-muted-foreground">{p.importResult.duplicated}</b>
                    </span>
                    <span>
                      失败{" "}
                      <b
                        className={`font-mono text-[15px] ${p.importResult.failed.length ? "text-destructive" : "text-foreground"}`}
                      >
                        {p.importResult.failed.length}
                      </b>
                    </span>
                  </div>
                  {p.importResult.failed.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-[11.5px] text-destructive">
                      {p.importResult.failed.slice(0, 8).map((f, i) => (
                        <li key={i} className="truncate">
                          · {f.name}：{f.reason}
                        </li>
                      ))}
                      {p.importResult.failed.length > 8 ? <li>… 共 {p.importResult.failed.length} 条失败</li> : null}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  还没有导入记录。这一屏不保留历史导入批次（每次导入的结果只显示当次），入库后的素材请到「素材总览」查看。
                </p>
              )}
            </div>
          </section>
        </div>

        {/* 右侧：去重与分类说明 */}
        <aside className="flex min-w-0 flex-col gap-3.5 lg:sticky lg:top-20 lg:self-start">
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Tags className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-[13px] font-semibold text-foreground">入库规则</h3>
            </header>
            <ul className="space-y-1.5 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>· 同一账号内按 sha256 去重，重复文件直接跳过不报错。</li>
              <li>· 缩略图长边 400px，列表只传缩略图；原图单独存，打开详情才拉。</li>
              <li>· 分类在导入时统一指定；入库后也可在详情里单张改。</li>
              <li>· 命名里的日期与扩展名会自动剥除，只留内容词做名称与标签。</li>
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-foreground">当前分类分布</h3>
            </header>
            <ul className="space-y-1 px-4 py-3 text-[11.5px]">
              {(p.stats?.categories ?? []).length === 0 ? (
                <li className="text-muted-foreground">
                  {p.stats ? "还没有素材，入库后这里会显示各分类数量。" : "统计加载中…"}
                </li>
              ) : (
                (p.stats?.categories ?? []).map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.count}</span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </aside>
      </div>

      {p.importProgress ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          导入进行中，请勿关闭页面。
        </p>
      ) : null}
    </div>
  )
}
