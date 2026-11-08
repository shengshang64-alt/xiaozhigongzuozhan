// UX-R2: 团队管理 已按 docs/ux-review-2026-11 修复 2026-11-07（启停确认/角色弹窗/最近登录列/姓名校验）
// 团队管理页视图（R-201 阶段A）：成员列表 + 添加成员 + 改角色 + 启停。
// 非管理员进入时展示无权限提示（写操作本就由服务端 403 兜底）。
import { useState } from "react"
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
import { TEAM_ROLE_LABELS, type TeamMember } from "@/lib/teamAuth"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
// R47/F19：误操作护栏（与服务端 team_auth.pb.js PATCH 同口径：不能动自己/不能停用降级最后一个可用管理员）
import { memberLockReason } from "./memberGuard"
import type { UseTeam } from "./useTeam"

const ROLE_BADGE_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  admin: "success",
  editor: "neutral",
  viewer: "warning",
}

// UX-R2（docs/ux-review-2026-11 §二十二）：各角色一行权限说明
const ROLE_DESC: Record<string, string> = {
  admin: "全部权限，含团队管理与模型配置",
  editor: "业务数据读写（客户 / 商机 / 标书 / 方案）",
  viewer: "仅查看，不能修改任何数据",
}

export function TeamPage(p: UseTeam) {
  // UX-R2：角色修改弹窗 / 启停确认目标
  // UX-R2：姓名特殊字符校验（防 ??? 乱码成员入库）
  const nameIssue = (() => {
    const name = p.form.name.trim()
    if (!name) return null
    return /^[一-龥A-Za-z0-9·.·]+$/.test(name) ? null : "姓名含特殊字符或 emoji，请改用中文 / 字母 / 数字"
  })()
  const [roleEdit, setRoleEdit] = useState<TeamMember | null>(null)
  const [roleDraft, setRoleDraft] = useState<string | null>(null)
  const [activeConfirm, setActiveConfirm] = useState<TeamMember | null>(null)
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
                      {/* 2026-10-31 修：原来是 <p> 内含 <Badge>（Badge 渲染为 div），
                          属非法嵌套（p 只能含行内元素），React 会报 hydration 错误。改 div。 */}
                      <div className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                        {m.name}
                        {isSelf && <span className="text-xs text-muted-foreground">（我）</span>}
                        {!m.active && <Badge variant="neutral">已停用</Badge>}
                      </div>
                      {/* UX-R2：最近登录列——服务端 team_auth 暂未记录登录时间，如实显示「—」并留待后端补字段 */}
                      <p className="mt-0.5 text-xs text-muted-foreground" title="服务端暂未记录登录时间，接入后自动显示">
                        最近登录：—
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !!lockReason}
                        onClick={() => setRoleEdit(m)}
                        title={lockReason ?? "修改角色（含各角色权限说明）"}
                        className="inline-flex h-9 w-[110px] items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {TEAM_ROLE_LABELS[m.role] ?? m.role}
                      </button>
                      <Button
                        variant={m.active ? "outline" : "secondary"}
                        size="sm"
                        disabled={busy || !!lockReason}
                        onClick={() => setActiveConfirm(m)}
                        title={lockReason ?? (isSelf ? "不能停用自己" : m.active ? "停用该成员" : "启用该成员")}
                      >
                        {m.active ? "停用" : "启用"}
                      </Button>
                    </div>
                    <Badge variant={ROLE_BADGE_VARIANT[m.role] ?? "neutral"} className="min-w-[52px] shrink-0 justify-center whitespace-nowrap">
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
              <Input
                value={p.form.name}
                onChange={(e) => p.setForm({ ...p.form, name: e.target.value })}
                placeholder="如：张三"
                autoComplete="off"
                aria-invalid={Boolean(nameIssue) || undefined}
              />
              {nameIssue ? (
                <p className="mt-1 text-xs text-destructive">{nameIssue}</p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">仅支持中文、字母、数字、· 与中英文点号（防止出现乱码成员）</p>
              )}
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
            <Button onClick={() => void p.submitAdd()} disabled={Boolean(nameIssue)}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UX-R2：角色修改弹窗——每个角色带一行权限说明 */}
      <Dialog open={roleEdit !== null} onOpenChange={(o) => (!o ? setRoleEdit(null) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">修改角色 · {roleEdit?.name}</DialogTitle>
            <DialogDescription>选择新角色后点「确认修改」生效；改角色不会删除该成员的数据。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(p.roleOptions ?? ["admin", "editor", "viewer"]).map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                  roleDraft === r ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
                }`}
              >
                <input
                  type="radio"
                  name="team-role"
                  checked={roleDraft === r}
                  onChange={() => setRoleDraft(r)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {TEAM_ROLE_LABELS[r] ?? r}
                    {roleEdit?.role === r ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">（当前）</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{ROLE_DESC[r] ?? "—"}</span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleEdit(null)}>
              取消
            </Button>
            <Button
              disabled={!roleDraft || roleDraft === roleEdit?.role}
              onClick={() => {
                if (roleEdit && roleDraft && roleDraft !== roleEdit.role) void p.changeRole(roleEdit, roleDraft as never)
                setRoleEdit(null)
              }}
            >
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UX-R2：停用 / 启用二次确认——停用会立即踢出登录会话 */}
      <ConfirmDialog
        open={activeConfirm !== null}
        onOpenChange={(o) => (!o ? setActiveConfirm(null) : undefined)}
        title={activeConfirm?.active ? `停用「${activeConfirm.name}」？` : `启用「${activeConfirm?.name}」？`}
        description={
          activeConfirm?.active
            ? "停用后该成员立即被踢出登录会话，无法再登录工作台（其名下数据保留）；随时可重新启用。"
            : "启用后该成员可重新使用邮箱与密码登录工作台。"
        }
        confirmText={activeConfirm?.active ? "确认停用" : "确认启用"}
        tone={activeConfirm?.active ? "danger" : "default"}
        onConfirm={() => {
          if (activeConfirm) void p.toggleActive(activeConfirm)
          setActiveConfirm(null)
        }}
      />
    </div>
  )
}
