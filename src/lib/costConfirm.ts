// Canonical billing-confirm primitives — see vibex_billing_contract.yaml
// (rh_vc_deploy/vibex_rhapi_safety_skill/rules/vibex_billing_contract.yaml) for the
// full contract. Do not hand-roll a different localStorage key format or a different
// "confirmed today" check per page — the publish audit recognizes exactly this shape
// (via `useCostConfirm()` / `runWithCostConfirm(...)` in ./hooks/useCostConfirm) as
// user-trigger evidence for paid RHAPI calls. Inventing a new format opts the page out
// of that recognition.
//
// These are stateless helpers; the stateful wrapper (`runWithCostConfirm`) that pages
// actually call lives in `@/hooks/useCostConfirm`.

export function currentVibexAppId(): string {
  return window.location.pathname.match(/app-[0-9a-f]{32}/)?.[0] ?? "local"
}

export function costConfirmStorageKey(appId: string): string {
  return `vibex_cost_confirmed_today:${appId}`
}

function endOfTodayMs(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function hasCostConfirmedToday(appId: string): boolean {
  try {
    const raw = localStorage.getItem(costConfirmStorageKey(appId))
    if (!raw) return false
    const data = JSON.parse(raw) as { expiresAt?: number }
    return typeof data.expiresAt === "number" && data.expiresAt > Date.now()
  } catch {
    return false
  }
}

export function rememberCostConfirmedToday(appId: string): void {
  localStorage.setItem(costConfirmStorageKey(appId), JSON.stringify({ expiresAt: endOfTodayMs() }))
}
