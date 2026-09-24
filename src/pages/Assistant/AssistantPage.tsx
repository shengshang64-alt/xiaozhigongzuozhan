import { Bot, MessagesSquare } from "lucide-react"
import { PageHeader } from "@/components/shell/PageHeader"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChatStream } from "@/components/assistant/ChatStream"
import { ChatComposer } from "@/components/assistant/ChatComposer"
import { SessionListPanel } from "@/components/assistant/SessionListPanel"
import { MemoryPanel } from "@/components/assistant/MemoryPanel"
import { SkillsPanel } from "@/components/assistant/SkillsPanel"
import { SkillFillDialog } from "@/components/assistant/SkillFillDialog"
import type { useAssistant } from "./useAssistant"

const LEFT_TABS = [
  { key: "sessions" as const, label: "会话" },
  { key: "memory" as const, label: "记忆" },
  { key: "skills" as const, label: "技能" },
]

export function AssistantPage(p: ReturnType<typeof useAssistant>) {
  const activeSession = p.sessions.find((s) => s.id === p.activeSessionId) ?? null

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="小智助手"
        desc="你的售前专属助手：多轮对话、站内数据问答、长期记忆与技能指令，联动当前页面随时干活"
        actions={
          <ModelSelect
            models={p.modelOptions}
            valueKey={p.selectedModelKey}
            onChange={p.setSelectedModelKey}
          />
        }
      />

      <main className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex h-[520px] min-h-0 flex-col rounded-xl border border-border bg-card p-3 shadow-md lg:h-[calc(100vh-16rem)]">
          <div className="mb-3 grid shrink-0 grid-cols-3 gap-1 rounded-full bg-muted p-0.5">
            {LEFT_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => p.setLeftTab(t.key)}
                className={`h-8 rounded-full text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  p.leftTab === t.key
                    ? "bg-card font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {p.leftTab === "sessions" ? (
            <SessionListPanel
              sessions={p.sessions}
              loading={p.sessionsLoading}
              hasMore={p.sessionsHasMore}
              onLoadMore={() => void p.loadMoreSessions()}
              loadingMore={p.sessionsLoadingMore}
              activeSessionId={p.activeSessionId}
              onSelect={p.selectSession}
              onNew={p.newSession}
              onTogglePin={p.togglePinSession}
              onRequestDelete={p.requestDeleteSession}
            />
          ) : null}
          {p.leftTab === "memory" ? (
            <MemoryPanel
              memoryRows={p.memoryRows}
              onAdd={p.addMemory}
              onUpdate={p.updateMemory}
              onDelete={p.deleteMemory}
            />
          ) : null}
          {p.leftTab === "skills" ? (
            <SkillsPanel
              customSkills={p.customSkills}
              onInvoke={p.invokeSkill}
              onAdd={p.addCustomSkill}
              onUpdate={p.updateCustomSkill}
              onDelete={p.deleteCustomSkill}
            />
          ) : null}
        </aside>

        <section className="flex h-[520px] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md lg:h-[calc(100vh-16rem)]">
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Bot className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-foreground">
              {activeSession ? activeSession.session_title || "当前会话" : "新对话"}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <MessagesSquare className="h-3 w-3" />
              最近 {p.convMessages.length} 条消息
            </span>
          </header>

          <ChatStream
            messages={p.convMessages}
            sendState={p.sendState}
            fetchBadge={p.fetchBadge}
            onQuickAsk={p.sendMessage}
            onRetry={p.retryLast}
            onDismiss={p.dismissFailedMsg}
          />

          <ChatComposer
            draftInput={p.draftInput}
            setDraftInput={p.setDraftInput}
            onSend={() => p.sendMessage()}
            busy={p.sendState !== "idle"}
            contextLabel={p.contextLabel}
            onCloseContext={p.closeContext}
            onCancel={p.cancelSend}
            elapsedSec={p.sendElapsedTick}
            focusSignal={p.composerFocusTick}
          />
        </section>
      </main>

      <footer className="mt-4 text-center text-xs text-muted-foreground">
        小智会按你的提问实时查阅站内业务数据（每轮最多两次），并把值得长期记住的偏好沉淀进记忆。
      </footer>

      <SkillFillDialog
        fill={p.skillFill}
        onValue={p.setSkillFillValue}
        onConfirm={p.confirmSkillFill}
        onCancel={p.cancelSkillFill}
      />

      <Dialog
        open={p.deleteTargetSession !== null}
        onOpenChange={(open) => {
          if (!open) p.cancelDeleteSession()
        }}
      >
        <DialogContent className="max-w-sm rounded-xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-base text-foreground">删除会话</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              将同时删除「{p.deleteTargetSession?.session_title || "该会话"}」内的全部消息，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={p.cancelDeleteSession}
              className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void p.confirmDeleteSession()}
              className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
            >
              确认删除
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}
