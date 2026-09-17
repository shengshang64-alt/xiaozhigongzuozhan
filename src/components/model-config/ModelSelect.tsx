import { Cpu } from "lucide-react"
import { modelRefKey, modelRefLabel, type ModelRef } from "@/lib/modelGateway"

type ModelSelectProps = {
  models: ModelRef[]
  valueKey: string
  onChange: (key: string) => void
}

export function ModelSelect({ models, valueKey, onChange }: ModelSelectProps) {
  const platformModels = models.filter((m) => m.source === "platform")
  const personalModels = models.filter((m) => m.source === "personal")
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
          <optgroup label="平台内置">
            {platformModels.map((m) => (
              <option key={modelRefKey(m)} value={modelRefKey(m)}>
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
