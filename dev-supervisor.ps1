# dev-supervisor.ps1 — 小智工作站前端探活守护（PS 5.1 兼容、纯 ASCII、无 BOM）
# 用途：Vite dev server 僵死探测（端口监听但不应答）+ 自动拉起；单实例 pid 锁；退避节流。
# 用法：powershell -ExecutionPolicy Bypass -File dev-supervisor.ps1 [-Once] [-PbPort 7000]
# 注册开机自启（可选，管理员）：
#   schtasks /Create /TN "XiaozhiDevSupervisor" /SC ONSTART /RU SYSTEM /TR "powershell -ExecutionPolicy Bypass -File D:\重要文件\工作的小程序\xiaozhigongzuozhan\dev-supervisor.ps1"
param(
  [switch]$Once,
  [int]$Port = 8000,
  [int]$PbPort = 7000,
  [int]$IntervalSec = 15
)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockFile = Join-Path $Root "dev-supervisor.pid"
$LogFile = Join-Path $Root "dev-supervisor.log"

# 单实例锁
if (Test-Path $LockFile) {
  $oldPid = 0
  [int]::TryParse((Get-Content $LockFile -Raw), [ref]$oldPid) | Out-Null
  if ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Output "supervisor already running (pid $oldPid)"; exit 0
  }
}
# NOTE: the -Path switch is required. Without it Set-Content cannot bind Path,
# the call fails, and $ErrorActionPreference = "SilentlyContinue" swallows the
# error -- so the lock file was never written and several supervisors could run
# at once (each one killing/restarting the other's stack).
Set-Content -Path $LockFile -Value ([string]$PID) -Encoding ASCII

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  $line | Add-Content -Path $LogFile -Encoding ASCII
  Write-Output $line
}

function Test-Http([string]$url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = "GET"; $req.Timeout = 5000; $req.ReadWriteTimeout = 5000
    $req.AllowAutoRedirect = $false
    $resp = $req.GetResponse()
    $resp.Close(); return $true
  } catch { return $false }
}

function Find-PidOnPort([int]$port) {
  $lines = netstat -ano | Select-String (":{0}\s" -f $port)
  foreach ($l in $lines) {
    $parts = ($l.ToString()) -split "\s+" | Where-Object { $_ -ne "" }
    if ($parts[-1] -match "^\d+$") { return [int]$parts[-1] }
  }
  return 0
}

function Start-Stack {
  Log "starting stack via start-local.cmd"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$Root\start-local.cmd`" --no-browser" -WorkingDirectory $Root -WindowStyle Hidden
}

function Stop-Pid([int]$procId) {
  try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
}

Log "supervisor start (port $Port, pb $PbPort, interval ${IntervalSec}s)"
$failStreak = 0
$pbFailStreak = 0
while ($true) {
  $viteOk = Test-Http "http://127.0.0.1:$Port/"
  $pbOk = Test-Http "http://127.0.0.1:$PbPort/api/health"
  if (-not $viteOk) {
    $failStreak++
    $hungPid = Find-PidOnPort $Port
    Log ("vite unhealthy streak={0} pid={1}" -f $failStreak, $hungPid)
    if ($hungPid -gt 0) { Stop-Pid $hungPid }
    if ($failStreak -ge 2) {
      # 连续 2 轮不健康：整栈拉起（start-local 会复用健康的 PB）
      Log "restarting stack (streak $failStreak)"
      Start-Stack
      $failStreak = 0
      Start-Sleep -Seconds 20
    }
  } else {
    $failStreak = 0
    # PB-only failure: vite is fine but the backend is down/hung.
    # Without this branch a dead PocketBase stays dead until vite also breaks,
    # and every page silently loses all its data.
    if (-not $pbOk) {
      $pbFailStreak++
      $pbHungPid = Find-PidOnPort $PbPort
      Log ("pb unhealthy streak={0} pid={1}" -f $pbFailStreak, $pbHungPid)
      if ($pbFailStreak -ge 2) {
        if ($pbHungPid -gt 0) { Stop-Pid $pbHungPid }
        Log "restarting stack (pb streak $pbFailStreak)"
        Start-Stack
        $pbFailStreak = 0
        Start-Sleep -Seconds 20
      }
    } else {
      $pbFailStreak = 0
    }
  }
  if ($Once) { Log "once mode done"; break }
  Start-Sleep -Seconds $IntervalSec
}
