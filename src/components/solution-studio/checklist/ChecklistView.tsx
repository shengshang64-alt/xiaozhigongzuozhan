import { ChecklistDetailPanel } from "./ChecklistDetailPanel"
import { ChecklistListPanel } from "./ChecklistListPanel"
import { NewChecklistWizard } from "./NewChecklistWizard"
import { ProductLibraryPanel } from "./ProductLibraryPanel"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"

// ---------------------------------------------------------------------------
// 建设清单视图组合层：清单列表 + 产品库 / 清单详情 + 新建向导
// ---------------------------------------------------------------------------

export function ChecklistView({
  ck,
  onStartSolution,
}: {
  ck: UseChecklist
  onStartSolution: (checklistId: string) => void
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">建设清单</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          方案前置环节：维护我公司产品库与行业标准系统库，按评级目标或客户清单生成信息化建设清单，外购缺口自动补齐，清单可导出并带入方案编制。
        </p>
      </header>

      <main>
        {ck.activeChecklist ? (
          <ChecklistDetailPanel ck={ck} onStartSolution={onStartSolution} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
            <ChecklistListPanel ck={ck} />
            <ProductLibraryPanel ck={ck} />
          </div>
        )}
      </main>

      <NewChecklistWizard ck={ck} />

      <ConfirmDialog
        open={Boolean(ck.confirmRequest)}
        onOpenChange={(open) => {
          if (!open) ck.closeConfirmRequest()
        }}
        title={ck.confirmRequest?.title ?? ""}
        description={ck.confirmRequest?.description}
        confirmText={ck.confirmRequest?.confirmText}
        tone={ck.confirmRequest?.tone ?? "default"}
        onConfirm={ck.runConfirmRequest}
      />
    </div>
  )
}
