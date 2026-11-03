# status.ps1 -- one-glance health report for the Xiaozhi resident stack.
#
# Read-only: this script never starts, stops or restarts anything, so it is
# safe to run at any time (and safe to run while users are working).
#
# After a reboot, run this to confirm the boot autostart actually worked:
#   [1] shows XiaozhiDevSupervisor as Ready with a Boot trigger, and whether the
#       watchdog's last run succeeded instead of being refused,
#   [2] shows 7000/8000 listening and under which account,
#   [3] shows the app answering HTTP 200 on both the local and the LAN address.
#
# ASCII only on purpose: PowerShell 5.1 reads BOM-less .ps1 files as ANSI, so
# non-ASCII text here would come out as mojibake.

$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockFile = Join-Path $Root "dev-supervisor.pid"

Write-Host ""
Write-Host "============================================================"
Write-Host "  Xiaozhi Workbench - resident stack status"
Write-Host ("  {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host "============================================================"

# ---- 1. autostart + guardian registration ------------------------------
Write-Host ""
Write-Host "[1] Autostart and guardian tasks"
foreach ($name in 'XiaozhiDevSupervisor', 'XiaozhiDevSupervisorWatchdog') {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) { Write-Host ("    {0} : *** NOT REGISTERED ***" -f $name); continue }
  $info = $task | Get-ScheduledTaskInfo
  $triggers = ($task.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task', '' -replace 'Trigger', '' }) -join '+'
  Write-Host ("    {0,-30} state={1,-8} trigger={2,-12} last={3} result=0x{4:X}" -f `
      $name, $task.State, $triggers, $info.LastRunTime, $info.LastTaskResult)
}
Write-Host "    (Supervisor = starts at boot as SYSTEM; Watchdog = ticks every minute)"

# ---- 2. is anything actually listening? --------------------------------
Write-Host ""
Write-Host "[2] Service ports"
foreach ($port in 7000, 8000) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $conn.OwningProcess)
    $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
    Write-Host ("    {0}  LISTENING  {1} (pid {2}, {3}\{4})" -f $port, $proc.Name, $conn.OwningProcess, $owner.Domain, $owner.User)
  } else {
    Write-Host ("    {0}  *** NOT LISTENING ***" -f $port)
  }
}

# ---- 3. guardian process, and the lock that proves it is alive ---------
Write-Host ""
Write-Host "[3] Resident supervisor"
$sup = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'dev-supervisor\.ps1' })
if ($sup.Count -eq 0) {
  Write-Host "    *** no supervisor running - the watchdog should revive it within 1 minute ***"
} elseif ($sup.Count -eq 1) {
  $owner = Invoke-CimMethod -InputObject $sup[0] -MethodName GetOwner
  Write-Host ("    running: pid {0} as {1}\{2}" -f $sup[0].ProcessId, $owner.Domain, $owner.User)
} else {
  Write-Host ("    *** {0} supervisors running at once - that is wrong ***" -f $sup.Count)
}
if (Test-Path -LiteralPath $LockFile) {
  Write-Host ("    lock file holds pid [{0}]" -f (Get-Content -LiteralPath $LockFile -Raw))
}

# ---- 4. does the app actually answer? ----------------------------------
Write-Host ""
Write-Host "[4] HTTP checks"
function Test-Url([string]$url, [string]$label) {
  try {
    $r = Invoke-WebRequest $url -TimeoutSec 15 -UseBasicParsing
    Write-Host ("    {0,-46} HTTP {1}" -f $label, $r.StatusCode)
  } catch {
    Write-Host ("    {0,-46} *** FAILED ***" -f $label)
  }
}
Test-Url "http://127.0.0.1:8000/" "app  http://127.0.0.1:8000/"
Test-Url "http://127.0.0.1:7000/api/health" "pb   http://127.0.0.1:7000/api/health"
Test-Url "http://127.0.0.1:8000/__pb/api/health" "app->pb proxy"

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1).IPAddress
if ($ip) {
  Test-Url ("http://{0}:8000/" -f $ip) ("LAN  http://{0}:8000/" -f $ip)
} else {
  Write-Host "    (no LAN IPv4 address found)"
}

# ---- 5. tail of both logs ---------------------------------------------
Write-Host ""
Write-Host "[5] Recent guardian activity"
foreach ($log in 'dev-supervisor.log', 'dev-watchdog.log') {
  $path = Join-Path $Root $log
  Write-Host ("    --- {0} ---" -f $log)
  if (Test-Path -LiteralPath $path) {
    Get-Content -LiteralPath $path -Tail 3 | ForEach-Object { Write-Host ("      " + $_) }
  } else {
    Write-Host "      (empty - good news, it only logs when something needed fixing)"
  }
}
Write-Host ""
