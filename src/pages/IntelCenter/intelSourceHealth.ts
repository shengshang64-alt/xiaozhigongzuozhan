// 信息源健康分类（2026-11-02）：死链与瞬时故障分开治理。
// 后端 intel_center.pb.js 用同一口径决定「连续 3 次死链自动停用」；前端只负责解释，绝不自行停用。
export type IntelSourceErrorKind = "dead" | "blocked" | "transient" | "other"

export function classifyIntelSourceError(raw: string): IntelSourceErrorKind {
  const s = String(raw || "")
  if (/HTTP (403|412)/.test(s)) return "blocked"
  if (/HTTP 404|no such host|NXDOMAIN|connection refused|No connection could be made/i.test(s)) return "dead"
  if (/HTTP 5\d\d|timeout|deadline|tls|x509|dial tcp|超时/i.test(s)) return "transient"
  return "other"
}

export function intelSourceErrorText(raw: string): string {
  const s = String(raw || "")
  const kind = classifyIntelSourceError(s)
  if (kind === "blocked") return "对方拒绝机器抓取（反爬验证，人工浏览器访问正常）"
  if (kind === "dead") {
    if (/HTTP 404/.test(s)) return "页面地址失效（对方网站可能已改版）"
    if (/no such host|NXDOMAIN/i.test(s)) return "域名解析失败（站点可能已改名或停用）"
    return "对方拒绝连接或站点不可达（连续失效会自动停用）"
  }
  if (kind === "transient") {
    if (/HTTP 5\d\d/.test(s)) return "对方服务器故障（通常是暂时的，可稍后重试）"
    if (/tls|x509/i.test(s)) return "对方证书异常（加密连接失败）"
    return "连接超时或网络异常（可稍后重试，不会自动停用）"
  }
  return s || "未知原因"
}
