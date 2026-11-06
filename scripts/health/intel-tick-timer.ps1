# intel-tick-timer.ps1 — 情报抓取「关页也跑」的服务端计划任务载荷
#
# 为什么需要它（R3 · D4 /intel-center 🟡「关页即停」）：
#   情报抓取的触发点一直只有前端：`useIntelCenter` 在页面挂载时与驻留期间每 15 分钟
#   调一次 `POST /api/intel/tick`。**浏览器一关，抓取就停**——页面却写着
#   「可以等待下一轮自动抓取」，那句在关页场景下是假的。
#
#   库里实测：40 个信息源里 14 个 last_status=error，其中「国家卫健委」连续失败 15 次、
#   「中国政府采购网」连续 403 15 次——这些不是抓一次就能发现的事，需要**持续重试**
#   才能看出「这个源到底是死了还是今天抽风」。所以必须有关页也能跑的轮次。
#
# 为什么用 Windows 计划任务而不是 pb_hooks 的 cronAdd：
#   本仓 pb_hooks 的既有工程约定是「定时抓取不用 cronAdd」（intel_center.pb.js /
#   ai_hot.pb.js / zx_guard.pb.js 三处文件头写着同一句）。计划任务是**仓外**动作：
#   不改钩子、不需重启 :7000、随时可 schtasks /Delete 撤回，风险面最小。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\health\intel-tick-timer.ps1
#   注册（当前用户，每 30 分钟；不需要管理员）：
#     schtasks /Create /TN "XiaozhiIntelTick" /SC MINUTE /MO 30 /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"<repo>\scripts\health\intel-tick-timer.ps1\""
#
# 退出码：0 = 本轮成功（有抓或无到期源都算成功）；1 = 后端不可用或返回错误
param(
  [int]$PbPort = 7000,
  [int]$TimeoutSec = 120
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$LogFile = Join-Path $Root "pocketbase\logs\intel-tick-timer.log"

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
}

$url = "http://127.0.0.1:$PbPort/api/intel/tick"
$resp = $null
try {
  $resp = Invoke-RestMethod -Uri $url -Method Post -Body "{}" -ContentType "application/json" -TimeoutSec $TimeoutSec
} catch {
  Log ("tick FAILED: {0}" -f $_.Exception.Message)
  exit 1
}

if ($null -eq $resp) {
  Log "tick FAILED: empty response"
  exit 1
}

if ($resp.ran -and $resp.added -gt 0) {
  # 只记录「有信息量」的结果：每 30 分钟一条「0 新增」会把日志淹掉
  Log ("tick ok: added={0} checked={1}/{2} {3}" -f $resp.added, $resp.sources_checked, $resp.due_total, $resp.message)
} elseif ($resp.ran) {
  Log ("tick ok: no new items (checked {0}/{1})" -f $resp.sources_checked, $resp.due_total)
} else {
  Log ("tick skipped: {0}" -f $resp.message)
}
exit 0
