import { useEffect, useMemo, useState } from "react"
import { Clock, Cpu } from "lucide-react"
import { modelRefKey, modelRefLabel, type ModelRef } from "@/lib/modelGateway"
import { isLocalDeployHost } from "@/lib/rhLogin"
import {
  channelCoolingRemainingMs,
  channelCoolingStrikes,
  configCoolingKey,
  onCoolingChange,
} from "@/lib/modelFailover"

type ModelSelectProps = {
  models: ModelRef[]
  valueKey: string
  onChange: (key: string) => void
}

// R233（r203-cooling-not-surfaced）：账号级失败会给通道打会话内冷却戳，但此前只有生成时
// 才提示一次，用户在模型选择器里看不到「哪一路刚失败 / 何时恢复」，容易把某一路的暂时不可用
// 误判成全局故障。这里只读 modelFailover 的会话登记表：为当前所选通道渲染一枚只读徽标（含恢复
// 倒计时），并在下拉里给冷却中的备选通道补一句状态后缀。纯会话内存、零持久化 / collection /
// pb_hooks / 提示词；不改变回退与选择口径——冷却中的通道仍可选、仍先如实尝试，故只提示不禁用。
function useCoolingKeys(models: ModelRef[]): Map<string, number> {
  const [now, setNow] = useState(() => Date.now())
  const coolingKeys = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of models) {
      const key = modelRefKey(m)
      // 模型级与配置级取较大者：429 / 欠费按账号滚动，同账号换模型同样撞窗
      const remain = Math.max(
        channelCoolingRemainingMs(key, now),
        channelCoolingRemainingMs(configCoolingKey(m.configId), now),
      )
      if (remain > 0) map.set(key, remain)
    }
    return map
  }, [models, now])
  useEffect(() => {
    // 冷却刚被戳上时即时刷新（无需轮询）
    const off = onCoolingChange(() => setNow(Date.now()))
    // 仅在仍有冷却时逐秒自续，用于倒计时与到期自动隐徽；冷却清空即停表，无常驻定时器
    let id: ReturnType<typeof setTimeout> | undefined
    if (coolingKeys.size > 0) {
      const soonest = Math.min(...coolingKeys.values())
      id = setTimeout(() => setNow(Date.now()), Math.max(500, Math.min(soonest, 1000)))
    }
    return () => {
      off()
      if (id) clearTimeout(id)
    }
  }, [coolingKeys])
  return coolingKeys
}

export function ModelSelect({ models, valueKey, onChange }: ModelSelectProps) {
  const platformModels = models.filter((m) => m.source === "platform")
  const personalModels = models.filter((m) => m.source === "personal")
  const coolingKeys = useCoolingKeys(models)
  const selectedModel = models.find((m) => modelRefKey(m) === valueKey) ?? null
  const selectedCoolingMs = coolingKeys.get(valueKey) ?? 0
  const selectedStrikes = selectedModel
    ? Math.max(
        channelCoolingStrikes(modelRefKey(selectedModel)),
        channelCoolingStrikes(configCoolingKey(selectedModel.configId)),
      )
    : 0
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
                {coolingKeys.has(modelRefKey(m)) ? " · 冷却中" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {personalModels.length > 0 && (
          <optgroup label="我的模型">
            {personalModels.map((m) => (
              <option key={modelRefKey(m)} value={modelRefKey(m)}>
                {modelRefLabel(m)}
                {coolingKeys.has(modelRefKey(m)) ? " · 冷却中" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selectedCoolingMs > 0 && (
        <span
          className="badge-warning inline-flex shrink-0 items-center gap-1"
          role="status"
          aria-live="polite"
          title={`该模型通道近期请求失败，已临时冷却；约 ${Math.ceil(
            selectedCoolingMs / 1000,
          )} 秒内会自动改走其它可用通道，无需手动切换`}
        >
          <Clock className="h-3 w-3" />
          冷却中 · 约 {Math.ceil(selectedCoolingMs / 1000)}s
          {selectedStrikes > 1 ? ` ×${selectedStrikes}` : ""}
        </span>
      )}
    </label>
  )
}
