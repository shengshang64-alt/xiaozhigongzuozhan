import { useEffect, useState } from "react"
import { KeyRound, Link2, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { GatewayConfig } from "@/lib/modelGateway"
import type { FormValues } from "@/pages/ModelConfig/useModelConfig"

type ConfigFormDialogProps = {
  open: boolean
  editing: GatewayConfig | null
  busy: boolean
  errorText: string
  onClose: () => void
  onSubmit: (values: FormValues) => void
}

export function ConfigFormDialog({ open, editing, busy, errorText, onClose, onSubmit }: ConfigFormDialogProps) {
  const [configName, setConfigName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  useEffect(() => {
    if (open) {
      setConfigName(editing?.config_name ?? "")
      setBaseUrl(editing?.base_url ?? "")
      setApiKey("")
    }
  }, [open, editing])

  const handleSubmit = () => {
    if (!configName.trim() || !baseUrl.trim()) return
    if (!editing && !apiKey.trim()) return
    onSubmit({ config_name: configName.trim(), base_url: baseUrl.trim(), api_key: apiKey.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑模型配置" : "添加模型配置"}</DialogTitle>
          <DialogDescription>
            填写 OpenAI 兼容接口信息，保存时会自动检测连通性并拉取该地址下的全部模型。Key 只保存在服务端，页面仅显示后四位。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <label htmlFor="cfg-name" className="text-sm font-medium text-foreground">
              配置名称
            </label>
            <Input
              id="cfg-name"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              placeholder="例如：公司 DeepSeek、个人 Kimi"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cfg-url" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Link2 className="h-3.5 w-3.5 text-primary" />
              接口地址（OpenAI 兼容）
            </label>
            <Input
              id="cfg-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cfg-key" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              API Key
            </label>
            <Input
              id="cfg-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing ? `留空表示不修改（当前 ${editing.api_key_masked || "未设置"}）` : "sk-..."}
              maxLength={500}
              autoComplete="new-password"
            />
            {editing && (
              <p className="text-xs text-muted-foreground">
                出于安全考虑不回显已保存的 Key，留空即保持原 Key 不变。
              </p>
            )}
          </div>
          {errorText && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorText}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || !configName.trim() || !baseUrl.trim() || (!editing && !apiKey.trim())}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {busy ? "检测并保存中…" : editing ? "保存修改" : "保存并拉取模型"}
            {!busy && !editing && <Plus className="ml-1 h-4 w-4" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
