import { CircleAlert, DatabaseBackup, FileUp, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// 导入与体检 · 独立屏（UX-v2：prototype/customer/import.html）。
// 原型该屏 = 上传 → 字段映射 → 冲突处理 → 影响预算 四步导入向导 + 体检入口。
// 现网能力边界（不造假）：客户档案**没有**文件批量导入（字段映射错一步就是整批脏数据，
// 宁可不做），建档走「新建客户」表单 + AI 补全 + 官网抓取线索；数据体检与批量补全是真实力，
// 入口从「客户列表」收拢到本屏，体检结果里每条缺项都能点回客户补全。
// ---------------------------------------------------------------------------

type ImportCheckupScreenProps = {
  onOpenCheckup: () => void
  onNewCustomer: () => void
}

export function ImportCheckupScreen({ onOpenCheckup, onNewCustomer }: ImportCheckupScreenProps) {
  return (
    <div className="grid items-start gap-4 pb-10 lg:grid-cols-2">
      {/* ① 数据体检（真实力）：入口收拢 + 既有弹窗承接 */}
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
          批量补全入口在「客户列表」每个客户卡的「缺 N 项」处，走既有的费用确认与进度流程；本屏不重复入口。
        </p>
      </section>

      {/* ② 批量导入（无此能力 → 诚实空态，按铁律不做假上传） */}
      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-md">
        <header className="flex items-center gap-2">
          <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-card-foreground">文件批量导入</h3>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">暂未提供</span>
        </header>
        <div className="mt-2.5 rounded-md border border-dashed border-border px-3 py-4 text-xs leading-relaxed text-muted-foreground">
          客户档案暂不支持 Excel / vCard 批量导入：医院名称简称不一、等级与区域写法混乱，
          映射错一批就是整批脏档案。当前建档路径：
        </div>
        <ul className="mt-2.5 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <DatabaseBackup className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>「新建客户」表单：粘贴医院简介，AI 一次性补结构化字段（可逐项核对后保存）</span>
          </li>
          <li className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>客户详情「官网抓取线索」：从官网文章提取商机线索，一键转商机</span>
          </li>
        </ul>
        <Button size="sm" variant="outline" onClick={onNewCustomer} className="mt-3 border-border text-card-foreground hover:bg-secondary">
          新建客户
        </Button>
      </section>
    </div>
  )
}
