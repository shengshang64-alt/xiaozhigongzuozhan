import { Cpu } from "lucide-react"
import { modelRefKey, modelRefLabel, type ModelRef } from "@/lib/modelGateway"
import { isLocalDeployHost } from "@/lib/rhLogin"

type ModelSelectProps = {
  models: ModelRef[]
  valueKey: string
  onChange: (key: string) => void
}

export function ModelSelect({ models, valueKey, onChange }: ModelSelectProps) {
  const platformModels = models.filter((m) => m.source === "platform")
  const personalModels = models.filter((m) => m.source === "personal")
  // 本地自用域禁用「平台内置」：
  // 该模型经 RunningHub 中转（pb_hooks/llm.pb.js → llm.runninghub.cn），令牌只来自
  // 请求头 x-rh-api-key 或环境变量 RH_LLM_API_KEY。本地 127.0.0.1 域既读不到
  // Rh-Accesstoken（该 cookie 属 runninghub.cn 域），项目里也没有 /sso-popup-callback
  // 回跳路由，令牌恒为空 → 接口必然返回 412 rh_login_required。用户侧只看到
  // 「AI 生成服务暂不可用，请检查模型配置」，极难自查，故置灰杜绝误选。
  // 边界：仅当本地已有个人模型可选时才禁用，避免退化成「无模型可选」的死局。
  // 约束：本组件只负责呈现，不做选中项回落；selectedModelKey 由父组件按后端
  //       defaultRef 初始化（个人配置优先），因此不会默认落到被禁用的选项上。
  // 线上域（vibex.cn / runninghub.cn）isLocalDeployHost() 恒为 false，行为完全不变。
  const platformDisabled = isLocalDeployHost() && personalModels.length > 0
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-primary">
      <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" />
      <select
        value={valueKey}
        onChange={(e) => onChange(e.target.value)}
        aria-label="选择本次生成使用的模型"
        className="h-7 max-w-44 cursor-pointer rounded-md border-0 bg-transparent text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {models.length === 0 && <option value="">平台内置 gpt-5.5</option>}
        {platformModels.length > 0 && (
          <optgroup label={platformDisabled ? "平台内置（本地不可用）" : "平台内置"}>
            {platformModels.map((m) => (
              <option
                key={modelRefKey(m)}
                value={modelRefKey(m)}
                disabled={platformDisabled}
                title={platformDisabled ? "本地部署缺少 RunningHub 登录态，该模型无法调用" : undefined}
              >
                {modelRefLabel(m)}
              </option>
            ))}
          </optgroup>
        )}
        {personalModels.length > 0 && (
          <optgroup label="我的模型">
            {personalModels.map((m) => (
              <option key={modelRefKey(m)} value={modelRefKey(m)}>
                {modelRefLabel(m)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}
