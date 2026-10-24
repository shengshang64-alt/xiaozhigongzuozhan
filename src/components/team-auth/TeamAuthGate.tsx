// 团队登录门禁（R-201 阶段A）——仅本地自用域生效，线上域原样透传。
// 状态机：checking（探测中）→ setup（首次初始化：建管理员）→ login → granted。
// 登录/初始化成功后置位团队会话，整站经 vibexAuthHeaders 携带 Authorization。
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { isLocalDeployHost } from "@/lib/rhLogin"
import {
  fetchTeamStatus,
  refreshTeamProfile,
  teamLogin,
  teamSetup,
  getTeamToken,
} from "@/lib/teamAuth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type GateState = "checking" | "setup" | "login" | "granted"

export function TeamAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(isLocalDeployHost() ? "checking" : "granted")
  const [needsSetup, setNeedsSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  // 启动探测：服务端是否待初始化 + 本地 token 是否仍有效
  useEffect(() => {
    if (!isLocalDeployHost()) return
    let cancelled = false
    void (async () => {
      try {
        const status = await fetchTeamStatus()
        if (cancelled) return
        setNeedsSetup(status.needsSetup)
        if (status.needsSetup) {
          setState("setup")
          return
        }
        if (getTeamToken()) {
          const profile = await refreshTeamProfile()
          if (cancelled) return
          if (profile?.active) {
            setState("granted")
            return
          }
        }
        if (!cancelled) setState("login")
      } catch {
        // 后端没起来/网络抖动：不把人锁在门外，退回登录表单
        if (!cancelled) setState("login")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 会话被清除（退出登录/token 失效）时退回登录页
  useEffect(() => {
    if (!isLocalDeployHost()) return
    const onLogout = () => setState("login")
    window.addEventListener("xiaozhi-team-logout", onLogout)
    return () => window.removeEventListener("xiaozhi-team-logout", onLogout)
  }, [])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError("")
    if (state === "setup") {
      const r = await teamSetup(name, email, password)
      setBusy(false)
      if (!r.ok) {
        setError(r.message)
        return
      }
      setState("granted")
      return
    }
    const r = await teamLogin(email, password)
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    setState("granted")
  }, [busy, state, name, email, password])

  if (state === "granted") return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-background to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-lg font-bold text-white shadow-lg shadow-sky-600/25">
            智
          </div>
          <h1 className="text-xl font-semibold tracking-tight">小智工作站 · 团队版</h1>
          <p className="mt-1 text-sm text-muted-foreground">医疗信息化售前工作台</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {state === "setup" ? "初始化团队" : state === "checking" ? "正在连接…" : "登录"}
            </CardTitle>
            <CardDescription>
              {state === "setup"
                ? "尚未创建任何账号。请先设置管理员账号（首个登录者）。"
                : state === "checking"
                  ? "正在检查登录状态…"
                  : "使用管理员创建的团队账号登录。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {state === "setup" && (
              <Input
                placeholder="姓名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}
            <Input
              placeholder="邮箱"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <Input
              placeholder="密码（至少 8 位）"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={state === "setup" ? "new-password" : "current-password"}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit()
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || !email || !password || (state === "setup" && !name)} onClick={() => void submit()}>
              {busy ? "请稍候…" : state === "setup" ? "创建并开始使用" : "登录"}
            </Button>
            {state === "login" && needsSetup && (
              <p className="text-center text-xs text-muted-foreground">
                系统尚未初始化，请联系管理员创建账号
              </p>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          数据保存在本机，账号与角色由管理员在工作站内维护
          <br />
          {/* P3-2：忘记密码指引——当前无自助重置与管理员重置入口，管理员的等效操作是
              在「团队管理」删除账号后重新创建（账号即认证主体，无业务数据挂载） */}
          忘记密码？请联系工作站管理员（在团队管理中删除账号后重新创建即可重置）
        </p>
      </div>
    </div>
  )
}

