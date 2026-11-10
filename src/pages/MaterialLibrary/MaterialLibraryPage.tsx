// 素材库（UX-v2：docs/ux-v2-2026-11/prototype/material/ 四屏）
//
// 拆屏：素材总览 / 导入 / 联网抓取 / 库设置，用 ?tab= 在一个工作区标签内切换。
// 为什么不再用「右上角展开面板」：原型的四块各是独立屏，信息量都不小
// （总览有数据条+分类树+排行，导入有进度+结果，抓取有配额+记录，设置有分类/存储/Key），
// 塞进一个折叠面板会让总览永远压在它们下面。
//
// 能力零丢失：原 MaterialLibraryPage 里的四块内容整体迁到四个屏文件，
// DetailDialog 留在本宿主里（四屏都可能打开详情）。
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PackageOpen, RotateCcw, Trash2 } from "lucide-react"

import { MaterialSubtabs } from "./MaterialSubtabs"
import { MaterialImportScreen } from "./MaterialImportScreen"
import { MaterialOverview } from "./MaterialOverview"
import { MaterialSettingsScreen } from "./MaterialSettingsScreen"
import { MaterialWebScreen } from "./MaterialWebScreen"
import { parseMaterialTab } from "./materialTabs"
import { formatBytes } from "./materialCore"
import {
  MATERIAL_CATEGORIES,
  MATERIAL_SOURCE_LABELS,
  type MaterialItem,
  type MaterialSource,
} from "./materialTypes"
import type { UseMaterialLibrary } from "./useMaterialLibrary"

const SOURCE_BADGE: Record<MaterialSource, string> = {
  manual: "badge-neutral",
  internal: "badge-warning",
  pexels: "badge-success",
  unsplash: "badge-success",
  pixabay: "badge-success",
}

/** 详情/编辑对话框：大图 + 元数据 + 授权链 + 编辑（四屏共用） */
function DetailDialog({ p }: { p: UseMaterialLibrary }) {
  const it = p.detail
  if (!it) return null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) p.setDetail(null)
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>素材详情</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
          <div className="flex max-h-[46vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {it.image_data || it.thumb_data ? (
              <img src={it.image_data || it.thumb_data} alt={it.name} className="max-h-[46vh] w-full object-contain" />
            ) : (
              <PackageOpen className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <DetailFields key={it.id} it={it} p={p} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailFields({ it, p }: { it: MaterialItem; p: UseMaterialLibrary }) {
  const [name, setName] = useState(it.name)
  const [category, setCategory] = useState(it.category)
  const [tagsText, setTagsText] = useState((it.tags || []).join("，"))
  const [note, setNote] = useState(it.note || "")
  const saveEdit = () => {
    void p.updateItem(it.id, {
      name: name.trim() || it.name,
      category,
      tags: tagsText
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
      note,
    })
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">素材名</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">分类</div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
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
      <div>
        <div className="mb-1 text-xs text-muted-foreground">标签（逗号分隔）</div>
        <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="医院，走廊" />
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">备注</div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className={SOURCE_BADGE[it.source] || "badge-neutral"}>{MATERIAL_SOURCE_LABELS[it.source]}</span>
          <span>
            {it.width}×{it.height}
          </span>
          <span>{formatBytes(it.bytes)}</span>
          <span>引用 {it.usage} 次</span>
        </div>
        <div className="mt-1 truncate">授权：{it.license || "—"}</div>
        {it.sourceUrl ? (
          <div className="truncate" title={it.sourceUrl}>
            来源：{it.sourceUrl}
          </div>
        ) : null}
        {it.photographer ? <div>作者：{it.photographer}</div> : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveEdit}>
          保存修改
        </Button>
        {it.trashed ? (
          <Button size="sm" variant="outline" onClick={() => void p.restoreItem(it.id)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            恢复
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void p.trashItem(it.id)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            移入回收站
          </Button>
        )}
      </div>
    </div>
  )
}

export function MaterialLibraryPage({ p }: { p: UseMaterialLibrary }) {
  const [searchParams] = useSearchParams()
  const tab = parseMaterialTab(searchParams.get("tab"))

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-foreground">
      <MaterialSubtabs active={tab} />

      {tab === "import" ? (
        <MaterialImportScreen p={p} />
      ) : tab === "web" ? (
        <MaterialWebScreen p={p} />
      ) : tab === "settings" ? (
        <MaterialSettingsScreen p={p} />
      ) : (
        <MaterialOverview p={p} />
      )}

      <DetailDialog p={p} />
    </div>
  )
}
