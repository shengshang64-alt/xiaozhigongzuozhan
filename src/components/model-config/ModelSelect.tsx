import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, Cpu } from "lucide-react"
import { modelRefKey, modelRefLabel, type ModelRef } from "@/lib/modelGateway"
import { decodeRhToken, isLocalDeployHost } from "@/lib/rhLogin"
import {
  healthNotice,
  healthShortLabel,
  onHealthChange,
  readModelHealth,
  type ModelHealthEntry,
} from "@/lib/modelHealth"
import { groupModelOptions } from "./modelSelectGroups"

type ModelSelectProps = {
  models: ModelRef[]
  valueKey: string
  onChange: (key: string) => void
}

// 注：原「通道冷却」只读徽标与下拉后缀（R233）已按用户裁定停用（2026-10-15）——
// 实测无任何真实失败也会显示「冷却中 · 约 115s ×2」并盖住整条配置下的所有模型，误导大于收益。
// 停用范围只在展示层与登记表（modelFailover 里那几个函数已改为空实现）；
// 「模型不可访问时自动换别的通道」的回退主链路不受影响，仍照常工作。

// R296（r294-default-model-hygiene）：只读「实测不可用」长期档案——404 已下线 / 上游停用 /
// Key 失效三类确定性失效才会入档，限流与超时归会话冷却（上面那路），不进这里。
// 与冷却同理：只提示不禁用——用户仍可选它、仍会先如实尝试（上游随时可能修好），
// 档案 7 天自动过期、任一通道成功即清账。纯本地读取，零 collection / pb_hooks / 提示词。
function useModelHealth(): Record<string, ModelHealthEntry> {
  const [health, setHealth] = useState<Record<string, ModelHealthEntry>>(
    () => readModelHealth(decodeRhToken()?.sub ?? null),
  )
  useEffect(
    () => onHealthChange(() => setHealth(readModelHealth(decodeRhToken()?.sub ?? null))),
    [],
  )
  return health
}

/** 未配置任何可用模型时的统一提示（阶段 1 · 包 1：禁止 UI 把未配置的模型当可选推荐） */
export const NO_MODEL_CONFIGURED_TEXT = "未配置任何可用模型"
export const NO_MODEL_CONFIGURED_HINT = "请到「模型配置」添加一条可用通道（接口地址 + API Key）并启用模型后再使用 AI 功能"

export function ModelSelect({ models, valueKey, onChange }: ModelSelectProps) {
  const personalModels = models.filter((m) => m.source === "personal")
  const health = useModelHealth()
  // 阶段 1 · 包 1（AI 可靠性）：**没有任何已配置/已启用模型**时，绝不渲染「平台内置 gpt-5.5」
  // 这种看似可选的假选项——它会让用户以为有模型可用，点了才失败，且失败了还查不出原因。
  // 实测本地部署下平台内置必然 412（缺 RunningHub 登录态），把它当默认推荐就是「推荐未配置模型」。
  // 空态只做两件事：如实说明「没有可用模型」+ 给出可执行的下一步，且禁用下拉（没有可选项）。
  const noModelConfigured = models.length === 0
  // P2-4：下拉分组整备——平台内置一组在前，个人模型按供应商细分子组，组内挂账模型沉底
  const groups = useMemo(() => {
    const unhealthy = new Set(
      Object.entries(health)
        .filter(([, e]) => !!e)
        .map(([k]) => k),
    )
    return groupModelOptions(models, unhealthy)
  }, [models, health])
  // R296：当前所选通道的「实测不可用」挂账
  const selectedHealth = health[valueKey] ?? null
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
  // 截断兜底：select 宽度有限（max-w-44），模型名过长时显示省略号；
  // 把完整标签挂到 title 上，悬停即可看全名（浏览器原生 tooltip）。
  const selectedLabel = noModelConfigured
    ? NO_MODEL_CONFIGURED_HINT
    : models.find((m) => modelRefKey(m) === valueKey) != null
      ? modelRefLabel(models.find((m) => modelRefKey(m) === valueKey)!)
      : valueKey
  // 下拉项后缀：冷却（会话内、分钟级）与实测不可用（持久、天级）是两回事，命中哪个说哪个
  const statusSuffix = (key: string): string => {
    const parts: string[] = []
    // 冷却机制已停用：不再给备选模型加「冷却中」后缀（用户裁定 2026-10-15）
    const h = health[key]
    if (h) parts.push(healthShortLabel(h.cls))
    return parts.length ? ` · ${parts.join(" · ")}` : ""
  }
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-primary">
      <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" />
      <select
        value={valueKey}
        onChange={(e) => onChange(e.target.value)}
        aria-label="选择本次生成使用的模型"
        aria-invalid={noModelConfigured || undefined}
        disabled={noModelConfigured}
        title={selectedLabel}
        className="h-7 max-w-44 cursor-pointer rounded-md border-0 bg-transparent text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
      >
        {noModelConfigured && <option value="">{NO_MODEL_CONFIGURED_TEXT}</option>}
        {groups.map((g) => (
          <optgroup
            key={g.key}
            label={g.key === "platform" && platformDisabled ? "平台内置（本地不可用）" : g.label}
          >
            {g.items.map((m) => (
              <option
                key={modelRefKey(m)}
                value={modelRefKey(m)}
                disabled={g.key === "platform" && platformDisabled}
                title={g.key === "platform" && platformDisabled ? "本地部署缺少 RunningHub 登录态，该模型无法调用" : undefined}
              >
                {modelRefLabel(m)}
                {statusSuffix(modelRefKey(m))}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {noModelConfigured && (
        <Link
          to="/model-config"
          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title={NO_MODEL_CONFIGURED_HINT}
        >
          去配置
        </Link>
      )}
      {selectedHealth && (
        <span
          className="badge-danger inline-flex shrink-0 items-center gap-1"
          role="status"
          aria-live="polite"
          title={healthNotice(selectedHealth)}
        >
          <AlertTriangle className="h-3 w-3" />
          {healthShortLabel(selectedHealth.cls)}
        </span>
      )}
    </label>
  )
}
