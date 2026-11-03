// 团队管理页逻辑（R-201 阶段A）——成员列表 / 添加 / 改角色 / 启停。
// 仅本地团队域可用；权限以服务端为准（viewer 调写接口会 403），前端只做提示与禁用。
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { isLocalDeployHost } from "@/lib/rhLogin"
import {
  fetchTeamMembers,
  getCachedTeamProfile,
  teamAddMember,
  teamUpdateMember,
  TEAM_ROLE_LABELS,
  type TeamMember,
  type TeamRole,
} from "@/lib/teamAuth"

const ROLE_OPTIONS: TeamRole[] = ["admin", "editor", "viewer"]

export type NewMemberForm = { name: string; email: string; password: string; role: TeamRole }

const EMPTY_FORM: NewMemberForm = { name: "", email: "", password: "", role: "editor" }

export function useTeam() {
  const currentProfile = getCachedTeamProfile()
  const isAdmin = isLocalDeployHost() && currentProfile?.role === "admin"

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [addError, setAddError] = useState("")
  const [form, setForm] = useState<NewMemberForm>(EMPTY_FORM)
  const [addOpen, setAddOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 拉取成员：setState 全部在 await 之后（避免 effect 内同步 setState 级联渲染）
  const reload = useCallback(async () => {
    const r = await fetchTeamMembers()
    if (r.ok === true) {
      setMembers(r.items)
    } else {
      toast.error(r.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    void (async () => {
      const r = await fetchTeamMembers()
      if (cancelled) return
      if (r.ok === true) {
        setMembers(r.items)
      } else {
        toast.error(r.message)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM)
    setAddError("")
    setAddOpen(true)
  }, [])

  const submitAdd = useCallback(async () => {
    setAddError("")
    if (!form.name.trim()) return setAddError("请填写姓名")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setAddError("邮箱格式不正确")
    if (form.password.length < 8) return setAddError("密码至少 8 位")
    const r = await teamAddMember(form)
    if (!r.ok) {
      setAddError(r.message || "创建成员失败")
      return false
    }
    toast.success(`已创建成员：${form.name.trim()}`)
    setAddOpen(false)
    void reload()
    return true
  }, [form, reload])

  const changeRole = useCallback(
    async (m: TeamMember, role: TeamRole) => {
      if (role === m.role) return
      setBusyId(m.id)
      const r = await teamUpdateMember(m.id, { role })
      setBusyId(null)
      if (!r.ok) return toast.error(r.message || "更新角色失败")
      toast.success(`${m.name} 已设为${TEAM_ROLE_LABELS[role]}`)
      void reload()
    },
    [reload],
  )

  const toggleActive = useCallback(
    async (m: TeamMember) => {
      setBusyId(m.id)
      const r = await teamUpdateMember(m.id, { active: !m.active })
      setBusyId(null)
      if (!r.ok) return toast.error(r.message || "操作失败")
      toast.success(m.active ? `已停用 ${m.name}` : `已启用 ${m.name}`)
      void reload()
    },
    [reload],
  )

  return {
    isAdmin,
    currentProfile,
    members,
    loading,
    busyId,
    roleOptions: ROLE_OPTIONS,
    addOpen,
    addError,
    form,
    setForm,
    openAdd,
    closeAdd: () => setAddOpen(false),
    submitAdd,
    changeRole,
    toggleActive,
    reload,
  }
}

export type UseTeam = ReturnType<typeof useTeam>
