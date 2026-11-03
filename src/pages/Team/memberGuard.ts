// R47/F19：团队管理误操作护栏（纯函数）。
// 与 pb_hooks/team_auth.pb.js PATCH 的两条护栏同口径：服务端兜底拦截，前端提前禁用按钮并说明原因，
// 避免用户点了才吃 400。仅本地团队域使用。

export type MemberGuardInput = { user_id: string; role: string; active: boolean }

/** 返回该成员「不可停用/不可改角色」的原因；null 表示可正常操作 */
export function memberLockReason(
  m: MemberGuardInput,
  members: MemberGuardInput[],
  myUserId: string | undefined | null,
): string | null {
  if (myUserId && m.user_id === myUserId) return "不能停用或修改自己的账号（如需移交权限，请由其他管理员操作）"
  if (m.role === "admin" && m.active) {
    const activeAdmins = members.filter((x) => x.role === "admin" && x.active).length
    if (activeAdmins <= 1) return "这是最后一个可用管理员，停用或降级会导致团队失去管理权限，已保护"
  }
  return null
}
