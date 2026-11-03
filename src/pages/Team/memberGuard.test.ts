// R47/F19 回归锈：memberLockReason——与服务端 team_auth.pb.js PATCH 护栏同口径的两条规则
import { describe, expect, it } from "vitest"
import { memberLockReason, type MemberGuardInput } from "./memberGuard"

const m = (user_id: string, role: string, active = true): MemberGuardInput => ({ user_id, role, active })
const TWO_ADMINS = [m("u1", "admin"), m("u2", "admin"), m("u3", "editor"), m("u4", "viewer")]

describe("memberLockReason（R47/F19）", () => {
  it("自己的账号 → 锁定（即使还有别的管理员，也不能直接接口自锁）", () => {
    expect(memberLockReason(TWO_ADMINS[0], TWO_ADMINS, "u1")).toMatch(/不能停用或修改自己/)
  })
  it("最后一个可用管理员（他人操作也不行）→ 锁定", () => {
    const only = [m("u1", "admin"), m("u3", "editor")]
    expect(memberLockReason(only[0], only, "u3")).toMatch(/最后一个可用管理员/)
  })
  it("有两个可用管理员时，另一个管理员可正常操作（不误伤移交场景）", () => {
    expect(memberLockReason(TWO_ADMINS[1], TWO_ADMINS, "u1")).toBeNull()
  })
  it("已停用的管理员不算「最后可用管理员」，可继续编辑（否则永远救不回来）", () => {
    const withInactive = [m("u1", "admin"), m("u2", "admin", false)]
    expect(memberLockReason(withInactive[1], withInactive, "u1")).toBeNull()
  })
  it("普通编辑/只读成员不受护栏影响", () => {
    expect(memberLockReason(TWO_ADMINS[2], TWO_ADMINS, "u1")).toBeNull()
    expect(memberLockReason(TWO_ADMINS[3], TWO_ADMINS, "u1")).toBeNull()
  })
  it("myUserId 缺失（未登录缓存）时不因规则 1 误锁", () => {
    expect(memberLockReason(TWO_ADMINS[0], TWO_ADMINS, undefined)).toBeNull()
  })
})
