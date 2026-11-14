// 知识库 · 本机资料检索弹窗（AnyTXT）。
//
// ## 为什么做成弹窗而不是常驻面板
//
// 原型 kb/browse.html 的核心改造之一就是**消灭「两个搜索框」**：
// 顶部一个「搜索标题与正文」+ 中部一个「正文全文检索」——用户不知道用哪个。
//
// 本机资料（AnyTXT 搜的是硬盘里的 Word/PDF）与云端知识库检索**不是一回事**，
// 把两者同时铺在页面上就等于复活了原型要消灭的问题。因此：
//   · 云端检索只有一个入口（文档库屏的搜索框 / 全文检索屏）；
//   · 本机检索收在「本机资料全文检索未启用」这条提示的「查看配置」后面，
//     以及全文检索屏未命中时的同一条提示后面。
//
// 能力一条不少：搜本机文件、预览片段、单条/批量「纳入知识库」都在（LocalDocSearchPanel 原样复用）。

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LocalDocSearchPanel } from "@/components/common/LocalDocSearchPanel"

export function KbLocalSearchDialog({
  open,
  onClose,
  initialQuery,
}: {
  open: boolean
  onClose: () => void
  initialQuery?: string
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent
        className="max-h-[80vh] w-[min(720px,94vw)] overflow-y-auto"
        aria-label="本机资料全文检索"
      >
        <DialogHeader>
          <DialogTitle>本机资料全文检索</DialogTitle>
          <DialogDescription>
            搜的是这台机器硬盘里的 Word / PDF / PPT（AnyTXT 索引），不是云端知识库。
            找到后可一键「纳入知识库」，让云端也能搜到。
          </DialogDescription>
        </DialogHeader>
        <LocalDocSearchPanel initialQuery={initialQuery} />
      </DialogContent>
    </Dialog>
  )
}
