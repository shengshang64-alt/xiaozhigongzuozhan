import { Sparkles } from "lucide-react"

export function AiBadge() {
  return (
    <span
      title="该字段由 AI 提供，请人工核实"
      className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
    >
      <Sparkles className="h-3 w-3" />
      AI 提供需核实
    </span>
  )
}
