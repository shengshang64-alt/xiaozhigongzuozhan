// UX-R2: 模型配置 已按 docs/ux-review-2026-11 修复 2026-11-07
//
// UX-v2（2026-11-09）：按原型 docs/ux-v2-2026-11/prototype/model/ 拆成 3 个屏内 Tab：
//   通道与默认（ModelChannelsScreen，1:1 对齐 channels.html）
//   健康看板（HealthBoard，1:1 对齐 health.html；失败告警接 modelHealth 真数据）
//   连通测试（ModelTestScreen，1:1 对齐 test.html；测试结果落 modelTestLog 台账）
// 拆法刻意保持「一个路由、一个 hook、一处配置列表请求」：拆成三条顶层路由会让标签栏
// 出现三个同名标签，且每条各拉一遍配置。切换只换内容区，见 ModelSubtabs。
import { ShieldCheck } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { ConfigFormDialog } from "@/components/model-config/ConfigFormDialog"
import { HealthBoard } from "@/components/model-config/HealthBoard"
import { ModelChannelsScreen } from "@/components/model-config/ModelChannelsScreen"
import { ModelSubtabs } from "@/components/model-config/ModelSubtabs"
import { ModelTestScreen } from "@/components/model-config/ModelTestScreen"
import { parseModelConfigTab, type ModelConfigTab } from "@/components/model-config/modelConfigTabs"
import type { useModelConfig } from "./useModelConfig"

export function ModelConfigPage(p: ReturnType<typeof useModelConfig>) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseModelConfigTab(searchParams.get("tab"))
  const go = (next: ModelConfigTab) =>
    setSearchParams(next === "channels" ? {} : { tab: next }, { replace: true })

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-foreground">
      <ModelSubtabs active={tab} />

      {tab === "health" ? (
        <HealthBoard p={p} onGoChannels={() => go("channels")} />
      ) : tab === "test" ? (
        <ModelTestScreen p={p} onGoChannels={() => go("channels")} />
      ) : (
        <>
          <ModelChannelsScreen p={p} onOpenTest={() => go("test")} />
          <footer className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground shadow-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            API Key 仅保存在服务端并脱敏展示，任何页面与日志都不会出现完整 Key；个人模型调用由你自己的接口账户承担费用。
          </footer>
        </>
      )}

      {/* 配置表单弹窗在三屏之上共享：任何一屏点「添加 / 编辑」都从这里弹出 */}
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
