import { ShieldCheck } from "lucide-react"
import { PageHeader } from "@/components/shell/PageHeader"
import { DefaultModelBanner } from "@/components/model-config/DefaultModelBanner"
import { PlatformModelCard } from "@/components/model-config/PlatformModelCard"
import { PersonalConfigList } from "@/components/model-config/PersonalConfigList"
import { ConfigFormDialog } from "@/components/model-config/ConfigFormDialog"
import { TestPanel } from "@/components/model-config/TestPanel"
import type { useModelConfig } from "./useModelConfig"

export function ModelConfigPage(p: ReturnType<typeof useModelConfig>) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-foreground">
      <PageHeader
        title="模型配置"
        desc="统一管理公共模型与个人模型：添加 OpenAI 兼容接口后自动拉取模型列表，逐个启用、设为默认并单独测试"
      />

      <main>
        <section className="mb-5 max-w-3xl">
          <DefaultModelBanner
            defaultLabel={p.defaultLabel}
            defaultSource={p.defaultSource}
            declaredDefault={p.declaredDefault}
            missingDefaultCount={p.missingDefaultCount}
            unusableCount={p.unusableCount}
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <PlatformModelCard
              config={p.platformConfig}
              busy={p.busyConfigId === p.platformConfig?.id || (p.listLoading && !p.platformConfig)}
              onToggleModel={p.toggleModel}
              onSetDefault={p.setDefaultModel}
              onTest={p.runTest}
              // R3 · D4：本机/内网部署下平台内置确定不可用，必须标出来（不许当默认成功路径）
              locallyUnusable={p.platformLocallyUnusable}
            />
            <PersonalConfigList
              configs={p.personalConfigs}
              busyConfigId={p.busyConfigId}
              onAdd={p.openCreateForm}
              onEdit={p.openEditForm}
              onRefresh={p.refreshModels}
              onAskDelete={p.askDelete}
              onToggleModel={p.toggleModel}
              onSetDefault={p.setDefaultModel}
              onTest={p.runTest}
              modelHealth={p.modelHealth}
              deletingConfig={p.deletingConfig}
              deleteBusy={p.deleteBusy}
              onCancelDelete={p.cancelDelete}
              onConfirmDelete={p.confirmDelete}
              modelMeta={p.modelMeta}
              onSaveModelMeta={p.updateModelMeta}
            />
          </div>
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <TestPanel
              targetLabel={p.testTargetLabel}
              running={p.testRunning}
              result={p.testResult}
              onRerun={p.rerunTest}
            />
          </aside>
        </div>

        <footer className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground shadow-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          API Key 仅保存在服务端并脱敏展示，任何页面与日志都不会出现完整 Key；个人模型调用由你自己的接口账户承担费用。方案编制、标书工作、PPT 与报价三个模块的 AI 生成会自动使用系统默认模型，也可在生成时临时切换。
        </footer>
      </main>

      <ConfigFormDialog
        open={p.formOpen}
        editing={p.editingConfig}
        busy={p.formBusy}
        errorText={p.formError}
        onClose={p.closeForm}
        onSubmit={(values) => void p.submitForm(values)}
      />
    </div>
  )
}
