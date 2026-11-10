// 素材库 · 联网抓取（UX-v2：prototype/material/web.html）
//
// 原型是独立屏：配额 + 抓取记录 + 抓取台。现网原本是右上角一个折叠面板，
// 这里把原面板内容整体迁成独立屏，区块按原型补齐：
//   A. 页头：标题 + 「按场景词抓图」desc / meta（图库 Key 状态·今日已入库）
//   B. 抓取台：图库选择 + 关键词 + 场景预设 + 结果网格（保留原有全部能力）
//   C. 授权提示（Pexels 条款 7B / Pixabay 允许）—— 入库硬要求
//
// 数据边界：原型的「配额」需要各图库账号的配额接口，现网没有 → 只显示 Key 是否配置，
// 不写「本月还剩 N 次」这类假配额。抓取记录就是下面这次会话的结果，未落库。
import { useNavigate } from "react-router-dom"
import { CheckCircle2, Globe, ImagePlus, KeyRound, Loader2, Search, X } from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { UseMaterialLibrary } from "./useMaterialLibrary"

/** 联网抓取的预设场景词（医疗售前常用画面） */
const SCENE_PRESETS = ["医院外景", "智慧病房", "门诊大厅", "手术室", "机房", "医生沟通", "患者服务", "系统界面"]

export function MaterialWebScreen({ p }: { p: UseMaterialLibrary }) {
  const navigate = useNavigate()
  return (
    <div>
      <PageHeader
        title="联网抓取"
        titleExtra={
          <Badge variant={p.hasWebKey ? "success" : "warning"}>
            {p.hasWebKey ? "Key 已配置" : "未配置 Key"}
          </Badge>
        }
        desc={
          <>
            这一屏只做一件事：
            <b className="font-semibold text-foreground">按场景词抓氛围图，入库时强制留档授权与来源链接</b>
            。架构图、系统截图这类必须准的素材走「导入」，不要靠搜图。
          </>
        }
        meta={
          <>
            <span>
              当前图库 <b className="font-semibold text-foreground">{p.webProvider}</b>
            </span>
            <span>
              本次结果 <b className="font-mono font-semibold text-foreground">{p.webHits.length}</b> 张
            </span>
            <span>
              已选 <b className="font-mono font-semibold text-foreground">{p.selectedUrls.length}</b> 张
            </span>
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/materials?tab=settings")}>
            <KeyRound className="h-3.5 w-3.5" /> 库设置
          </Button>
        }
      />

      {!p.hasWebKey ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5">
          <KeyRound className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-warning">
            当前图库还没配置 API Key，搜索会直接失败。不影响本地导入。
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigate("/materials?tab=settings")}>
            去配置 Key
          </Button>
        </div>
      ) : null}

      {/* B. 抓取台 */}
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold text-foreground">抓取台</h3>
          <span className="text-xs text-muted-foreground">入库自动落「05_图库素材」</span>
        </header>
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={p.webProvider} onValueChange={(v) => p.setWebProvider(v as typeof p.webProvider)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pixabay">Pixabay</SelectItem>
                <SelectItem value="pexels">Pexels</SelectItem>
                <SelectItem value="unsplash">Unsplash</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 min-w-52 flex-1 text-xs"
              value={p.webQuery}
              onChange={(e) => p.setWebQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void p.runWebSearch()
              }}
              placeholder={p.webProvider === "pixabay" ? "中文直搜，如：智慧病房" : "搜图关键词（中文自动映射英文）"}
            />
            <Button size="sm" variant="outline" className="h-8" disabled={p.webSearching} onClick={() => void p.runWebSearch()}>
              {p.webSearching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
              搜索
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">场景词</span>
            {SCENE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void p.runWebSearch(s)}
                className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {s}
              </button>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {p.webProvider === "pexels"
              ? "授权提示：Pexels 条款 7B 禁止上传 AI 生成内容；Pixabay 允许（需上传者打标签）。"
              : "授权提示：入库图片会自动带上图库授权说明与来源页链接，不可删除。"}
          </p>
        </div>
      </section>

      {/* C. 结果 */}
      {p.webMessage ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-card px-3.5 py-2.5 text-[12px] text-muted-foreground">
          {p.webMessage}
        </div>
      ) : null}

      {p.webHits.length > 0 ? (
        <div className="mt-3 space-y-3">
          {p.selectedUrls.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="text-[12.5px] text-foreground">已选 {p.selectedUrls.length} 张</span>
              <Button size="sm" className="h-7 px-2 text-xs" disabled={!!p.savingUrl} onClick={() => void p.saveSelectedHits()}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                批量入库
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={p.clearSelection}>
                <X className="mr-1 h-3.5 w-3.5" />
                取消选择
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {p.webHits.map((hit) => {
              const saved = p.savedUrls[hit.url]
              const selected = p.selectedUrls.includes(hit.url)
              return (
                <div
                  key={hit.url}
                  className={`overflow-hidden rounded-lg border bg-card shadow-sm ${selected ? "border-primary" : "border-border"}`}
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                    <img src={hit.url} alt={hit.alt} loading="lazy" className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    <div className="truncate text-[11px] text-muted-foreground" title={hit.alt}>
                      {hit.alt || hit.url}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {saved ? (
                        <Badge variant="success" className="text-[10px]">已入库</Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={!!p.savingUrl}
                            onClick={() => void p.saveWebHit(hit)}
                          >
                            {p.savingUrl === hit.url ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <ImagePlus className="mr-1 h-3 w-3" />
                            )}
                            存入素材库
                          </Button>
                          <Button
                            size="sm"
                            variant={selected ? "default" : "ghost"}
                            className="h-7 px-2 text-xs"
                            onClick={() => p.toggleSelectUrl(hit.url)}
                          >
                            {selected ? "取消选" : "选中"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <Search className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
          <p className="text-[13px] font-medium text-foreground">还没有搜索结果</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            输入关键词或点上面的场景词开始搜。入库后素材会自动带授权说明与来源链接，可在「素材总览」里看到。
          </p>
        </div>
      )}
    </div>
  )
}
