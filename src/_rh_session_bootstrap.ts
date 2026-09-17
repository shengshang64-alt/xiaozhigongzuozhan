import { fetchRhAccountInfo } from "./lib/rhLogin"

// Platform-owned, best-effort session bootstrap.
//
// Sandbox apps cannot inherit the RunningHub parent-domain cookie directly.
// Calling fetchRhAccountInfo() once at startup performs the silent scoped-token
// exchange when the console already has a login, while remaining anonymous for
// visitors who are not signed in. Keep this outside App.tsx so generated pages
// cannot accidentally remove the default RH login state.
if (typeof window !== "undefined") {
  void fetchRhAccountInfo().catch(() => undefined)
}
