import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react"
import { TEST_PROMPT, type TestModelResult } from "@/lib/modelGateway"

type TestPanelProps = {
  targetLabel: string
  running: boolean
  result: TestModelResult | null
  onRerun: () => void
}

export function TestPanel({ targetLabel, running, result, onRerun }: TestPanelProps) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FlaskConical className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">测试面板</h2>
          <p className="truncate text-xs text-muted-foreground">
            {targetLabel ? `当前测试：${targetLabel}` : "点击任一模型的「测试」按钮开始"}
          </p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        <div className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">固定测试消息</p>
          <p className="mt-0.5 text-sm text-foreground">「{TEST_PROMPT}」</p>
        </div>

        {!targetLabel && !running && (
          <p className="mt-auto pb-2 text-xs leading-relaxed text-muted-foreground">
            测试会向模型发送一条固定消息，用于确认接口地址与 Key 可用。平台内置模型与个人模型都支持测试。
          </p>
        )}

        {running && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-3 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在请求模型，请稍候…
          </div>
        )}

        {!running && result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {result.ok ? (
                <span className="badge-success inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  测试成功
                </span>
              ) : (
                <span className="badge-danger inline-flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" />
                  测试失败
                </span>
              )}
              {typeof result.elapsedMs === "number" && (
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  耗时 {result.elapsedMs} ms
                </span>
              )}
              <button
                type="button"
                onClick={onRerun}
                className="ml-auto rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                重新测试
              </button>
            </div>
            {result.ok ? (
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
                {result.reply}
              </div>
            ) : (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive">
                {result.message || "测试失败，请稍后重试"}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
