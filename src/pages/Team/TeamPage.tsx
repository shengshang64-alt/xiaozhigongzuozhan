// 团队管理页视图（R-201 阶段A）：成员列表 + 添加成员 + 改角色 + 启停。
// 非管理员进入时展示无权限提示（写操作本就由服务端 403 兜底）。
import { Plus, RefreshCw, ShieldAlert, UserPlus } from "lucide-react"
import { PageHeader } from "@/components/shell/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TEAM_ROLE_LABELS } from "@/lib/teamAuth"
// R47/F19：误操作护栏（与服务端 team_auth.pb.js PATCH 同口径：不能动自己/不能停用降级最后一个可用管理员）
import { memberLockReason } from "./memberGuard"
import type { UseTeam } from "./useTeam"

const ROLE_BADGE_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  admin: "success",
  editor: "neutral",
  viewer: "warning",
}

export function TeamPage(p: UseTeam) {
  if (!p.isAdmin) {
    return (
      <div className="animate-in fade-in duration-300">
        <PageHeader title="团队管理" desc="成员账号与角色权限" />
        <Card className="mx-auto max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlert className="h-9 w-9 text-warning" />
            <p className="text-sm font-medium text-foreground">仅管理员可管理团队成员</p>
            <p className="text-xs text-muted-foreground">你的角色为只读或编辑，如需调整成员权限请联系管理员。</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-foreground">
      <PageHeader
        title="团队管理"
        desc="创建团队账号、分配角色（管理员 / 编辑 / 只读）、启停成员。账号用于本地工作台登录，数据仍保存在本机。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void p.reload()} disabled={p.loading}>
              <RefreshCw className={p.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              刷新
            </Button>
            <Button size="sm" onClick={p.openAdd}>
              <Plus className="h-4 w-4" />
              添加成员
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">成员列表（{p.members.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {p.loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : p.members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无成员</p>
          ) : (
            <div className="divide-y divide-border">
              {p.members.map((m) => {
                const isSelf = p.currentProfile?.id === m.user_id
                const busy = p.busyId === m.id
                // R47/F19：命中护栏时提前禁用角色/启停控件并说明原因（不等点了吃 400）
                const lockReason = memberLockReason(m, p.members, p.currentProfile?.id)
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2BC0A8] to-primary text-sm font-semibold text-white">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                        {m.name}
                        {isSelf && <span className="text-xs text-muted-foreground">（我）</span>}
                        {!m.active && <Badge variant="neutral">已停用</Badge>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span title={lockReason ?? undefined}>
                        <Select value={m.role} onValueChange={(v) => void p.changeRole(m, v as never)} disabled={busy || !!lockReason}>
                        <SelectTrigger className="h-9 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {p.roleOptions.map((r) => (
                            <SelectItem key={r} value={r}>
                              {TEAM_ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      </span>
                      <Button
                        variant={m.active ? "outline" : "secondary"}
                        size="sm"
                        disabled={busy || !!lockReason}
                        onClick={() => void p.toggleActive(m)}
                        title={lockReason ?? (isSelf ? "不能停用自己" : m.active ? "停用该成员" : "启用该成员")}
                      >
                        {m.active ? "停用" : "启用"}
                      </Button>
                    </div>
                    <Badge variant={ROLE_BADGE_VARIANT[m.role] ?? "neutral"} className="w-[52px] justify-center">
                      {TEAM_ROLE_LABELS[m.role] ?? m.role}
                    </Badge>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={p.addOpen} onOpenChange={(o) => (o ? p.openAdd() : p.closeAdd())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              添加成员
            </DialogTitle>
            <DialogDescription>为该同事创建一个登录账号，创建后其可用邮箱与密码登录工作台。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">姓名 *</label>
              <Input value={p.form.name} onChange={(e) => p.setForm({ ...p.form, name: e.target.value })} placeholder="如：张三" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">邮箱（登录账号）*</label>
              <Input value={p.form.email} onChange={(e) => p.setForm({ ...p.form, email: e.target.value })} placeholder="如：zhangsan@team.local" type="email" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground" htmlFor="team-pw">初始密码（至少 8 位）*</label>
              <Input value={p.form.password} onChange={(e) => p.setForm({ ...p.form, password: e.target.value })} placeholder="请设置一个初始密码" id="team-pw" type="password" autoComplete="new-password" aria-describedby="team-pw-hint" />
              <p id="team-pw-hint" className="mt-1 text-[11px] text-muted-foreground">默认隐藏，可点击输入框右侧眼睛图标确认后再告知同事</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">角色</label>
              <Select value={p.form.role} onValueChange={(v) => p.setForm({ ...p.form, role: v as never })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {p.roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {TEAM_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {p.addError && <p className="text-sm text-destructive">{p.addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={p.closeAdd}>
              取消
            </Button>
            <Button onClick={() => void p.submitAdd()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
