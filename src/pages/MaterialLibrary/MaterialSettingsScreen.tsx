// 素材库 · 库设置（UX-v2：prototype/material/settings.html）
//
// 原型的四块：分类体系 / 存储占用 / 回收站清空 / 图库 Key。
// 现网能力（原 SettingsTab）全部保留并升为独立屏：图库 Key、内部源、存储与索引、清空回收站。
// 分类体系按原型补上「各分类计数 + 说明」——现网分类是固定枚举（materialTypes.MATERIAL_CATEGORIES），
// 不支持用户自建，这里如实说明，不做「新建分类」的假按钮。
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Download, FolderTree, HardDrive, KeyRound, Loader2, Settings2, Trash2, X } from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { statBytes, statText } from "./materialCore"
import { MATERIAL_CATEGORIES, MATERIAL_SOURCE_LABELS, type InternalSourceConfig } from "./materialTypes"
import type { UseMaterialLibrary } from "./useMaterialLibrary"
import { getImageSearchKey } from "@/pages/PptQuote/imageSearch"

function Panel({
  icon,
  title,
  sub,
  children,
}: {
  icon: React.ReactNode
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-primary">{icon}</span>
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

/** 内部源区块：地址未配置显示「未配置」，不报错不阻塞 */
function InternalSourceList({ p }: { p: UseMaterialLibrary }) {
  const [name, setName] = useState("公司共享盘素材")
  const [url, setUrl] = useState("")
  const addSource = () => {
    if (!url.trim()) return
    const src: InternalSourceConfig = {
      id: `internal_${Date.now().toString(36)}`,
      name: name.trim() || "内部源",
      type: "http-list",
      url: url.trim(),
      enabled: true,
    }
    p.upsertInternalSource(src)
    setUrl("")
  }
  return (
    <div className="space-y-2.5">
      {p.internalSources.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          内部源未配置 —— 填写下方清单地址后可一键拉取公司共享素材（不影响其他功能）。
        </p>
      ) : (
        p.internalSources.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2">
            <span className="text-[12.5px] font-medium text-foreground">{s.name}</span>
            <Badge variant="neutral" className="text-[10px]">http-list</Badge>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={s.url}>
              {s.url || "未配置"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!s.url || p.internalBusy === s.id}
              onClick={() => void p.importFromInternalSource(s)}
            >
              {p.internalBusy === s.id ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              拉取入库
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => p.removeInternalSource(s.id)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}
      {p.internalProgress ? (
        <p className="text-[11.5px] text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          正在拉取 {p.internalProgress.done}/{p.internalProgress.total}…
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-40 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="源名称" />
        <Input
          className="h-8 min-w-0 flex-1 text-xs"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="清单地址（返回 [{name,url,tags?}] 的 JSON）"
        />
        <Button size="sm" variant="outline" className="h-8" onClick={addSource} disabled={!url.trim()}>
          添加内部源
        </Button>
      </div>
    </div>
  )
}

export function MaterialSettingsScreen({ p }: { p: UseMaterialLibrary }) {
  const navigate = useNavigate()
  const [keys, setKeys] = useState<Record<string, string>>({
    pexels: getImageSearchKey("pexels"),
    unsplash: getImageSearchKey("unsplash"),
    pixabay: getImageSearchKey("pixabay"),
  })
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false)
  const trashed = p.stats?.trashed
  const extraCategories = (p.stats?.categories ?? []).filter(
    (c) => !(MATERIAL_CATEGORIES as readonly string[]).includes(c.name),
  )

  return (
    <div>
      <PageHeader
        title="库设置"
        titleExtra={<Badge variant="neutral">本机配置</Badge>}
        desc={
          <>
            这一屏管的是<b className="font-semibold text-foreground">库的地基</b>：图库 Key、内部源、分类体系与回收站。
            日常入库与整理在「素材总览」和「导入」里做，这里不用天天来。
          </>
        }
        meta={
          <>
            <span>
              分类 <b className="font-mono font-semibold text-foreground">{MATERIAL_CATEGORIES.length}</b> 个
            </span>
            <span>
              回收站 <b className="font-mono font-semibold text-foreground">{statText(trashed)}</b> 条
            </span>
            <span>
              存储占用 <b className="font-mono font-semibold text-foreground">{statBytes(p.stats?.bytes)}</b>
            </span>
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/materials")}>
            <Settings2 className="h-3.5 w-3.5" /> 回素材总览
          </Button>
        }
      />

      <div className="grid gap-3.5 xl:grid-cols-2">
        {/* 分类体系 */}
        <Panel icon={<FolderTree className="h-4 w-4" />} title="分类体系" sub="固定枚举 · 不支持自建">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            {MATERIAL_CATEGORIES.map((c) => {
              const hit = (p.stats?.categories ?? []).find((x) => x.name === c)
              return (
                <li key={c} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-foreground">{c}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {p.stats ? (hit?.count ?? 0) : "—"}
                  </span>
                </li>
              )
            })}
          </ul>
          {/* 库里可能存在枚举外的分类（历史数据 / 手工导入 / 旧版默认值）。
              不列出来会与「素材数」矛盾：上面 6 档全是 0，素材数却 > 0。 */}
          {extraCategories.length > 0 ? (
            <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2">
              <p className="text-[11px] font-medium text-warning">枚举外的分类（{extraCategories.length} 个）</p>
              <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px]">
                {extraCategories.map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                这些分类不在固定枚举里，通常来自历史数据。可在「素材总览」逐张改分类，本页不批量迁移。
              </p>
            </div>
          ) : null}
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            分类目前是固定 6 档（与 PPT 配图选材口径一致），暂不支持用户自建层级。要加新档位需要改代码里的分类枚举，
            不是本页能配置的——所以这里不提供「新建分类」按钮。
          </p>
        </Panel>

        {/* 存储 */}
        <Panel icon={<HardDrive className="h-4 w-4" />} title="存储与索引" sub="服务端 material_library">
          <div className="space-y-1 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">素材数（不含回收站）</span>
              <span className="font-mono font-semibold text-foreground">{statText(p.stats?.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">占用空间</span>
              <span className="font-mono font-semibold text-foreground">{statBytes(p.stats?.bytes)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">回收站</span>
              <span className="font-mono font-semibold text-foreground">{statText(trashed)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            素材存于服务端 material_library 集合：原图 + 400px 缩略图分离存储，按账号隔离，sha256 去重。
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => void p.exportIndex()}>
              <Download className="mr-1 h-3.5 w-3.5" />
              导出索引 JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={!trashed}
              onClick={() => setPurgeConfirmOpen(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              清空回收站
            </Button>
          </div>
        </Panel>

        {/* 图库 Key */}
        <Panel icon={<KeyRound className="h-4 w-4" />} title="图库 API Key" sub="存本机 localStorage">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
            与 PPT 配图共用同一套 Key。Pixabay 支持中文直搜，医疗场景优先用它。
          </p>
          <div className="space-y-2">
            {(["pixabay", "pexels", "unsplash"] as const).map((prov) => (
              <div key={prov} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[12px] text-foreground">{MATERIAL_SOURCE_LABELS[prov]}</span>
                <Input
                  className="h-8 min-w-0 flex-1 text-xs"
                  type="password"
                  value={keys[prov]}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [prov]: e.target.value }))}
                  placeholder={`${prov} API Key`}
                />
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => p.setProviderKey(prov, keys[prov])}>
                  保存
                </Button>
              </div>
            ))}
          </div>
        </Panel>

        {/* 内部源 */}
        <Panel icon={<Settings2 className="h-4 w-4" />} title="内部源" sub="公司自有素材清单">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
            公司自有素材清单（http-list：JSON [{`{name,url,tags?}`}]）。入库来源标「内部源」，授权默认「公司内部素材」。
          </p>
          <InternalSourceList p={p} />
        </Panel>
      </div>

      <ConfirmDialog
        open={purgeConfirmOpen}
        onOpenChange={setPurgeConfirmOpen}
        title="彻底删除回收站全部素材？"
        description={`共 ${trashed ?? 0} 条素材将被彻底删除，此操作不可恢复。`}
        confirmText="彻底删除"
        tone="danger"
        onConfirm={() => void p.purgeTrashed()}
      />
    </div>
  )
}
