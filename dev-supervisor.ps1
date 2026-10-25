# dev-supervisor.ps1 — 小智工作站前端探活守护（PS 5.1 兼容、纯 ASCII、无 BOM）
# 用途：Vite dev server 僵死探测（端口监听但不应答）+ 自动拉起；单实例 pid 锁；退避节流。
# 用法：powershell -ExecutionPolicy Bypass -File dev-supervisor.ps1 [-Once] [-PbPort 7000]
# 注册开机自启（可选，管理员）：
#   schtasks /Create /TN "XiaozhiDevSupervisor" /SC ONSTART /RU SYSTEM /TR "powershell -ExecutionPolicy Bypass -File D:\重要文件\工作的小程序\xiaozhigongzuozhan\dev-supervisor.ps1"
param(
  [switch]$Once,
  [int]$Port = 8000,
  [int]$PbPort = 7000,
  [int]$IntervalSec = 15,
  [int]$DiskWarnGb = 4
)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockFile = Join-Path $Root "dev-supervisor.pid"
$LogFile = Join-Path $Root "dev-supervisor.log"

# Single-instance lock.
# NOTE (2026-10-16): this used to be "read dev-supervisor.pid, and if that PID
# exists assume a supervisor is alive". That wedged the app in two ways:
#   1. Windows recycles PIDs. After this supervisor was killed its PID (8884)
#      was handed to an unrelated process (360huabao.exe), so the lock looked
#      held forever. Every XiaozhiDevSupervisorWatchdog run then printed
#      "supervisor already running" and exited 0, nothing ever restarted the
#      stack, and the app stayed down until the pid file was deleted by hand.
#   2. Check-then-write is a race. The logon task and the 5-minute watchdog
#      task could both pass the test before either wrote, leaving two
#      supervisors running at once, each killing/restarting the other's stack.
# Hold an exclusive handle on the lock file instead: acquiring it is atomic,
# and Windows releases it automatically when this process exits, so neither a
# recycled PID nor a killed supervisor can leave the lock stuck.
# Keep in mind $ErrorActionPreference = "SilentlyContinue" above: any failure
# that is not raised as an exception here would be swallowed silently, so all
# lock work below is deliberately explicit.
# FileShare.Read, not None: a second supervisor asking for ReadWrite access is
# still refused (the lock is exactly as exclusive), but monitoring tools can
# still read which PID owns it. With FileShare.None the pid file was unreadable
# to everyone -- including the ops scripts -- for as long as the supervisor lived.
try {
  $LockStream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
} catch {
  Write-Output "supervisor already running (lock on $LockFile is held)"; exit 0
}
# The held handle is what enforces single-instance; the PID written inside is
# only there so a human can see who owns it.
# NOTE: SetLength(0) is required -- without it a shorter new PID would leave
# trailing digits from the old one and the file would read as the wrong PID.
$LockStream.SetLength(0)
$pidBytes = [System.Text.Encoding]::ASCII.GetBytes([string]$PID)
$LockStream.Write($pidBytes, 0, $pidBytes.Length)
$LockStream.Flush()

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
# Disk headroom guard (added 2026-10-19).
# A full C: broke this app in a way that looked like a code bug: a half-finished
# dependency install left node_modules without its top-level links, Vite could
# not resolve the pdfjs worker, and the bid workspace would not open for hours.
# Nothing in this loop watched free space, so the real cause stayed invisible.
# The marker lives outside the repo on purpose: the repo must only ever contain
# product code changes.
$diskAlertFile = "C:\Users\Administrator\.dsh\bot\workspace\disk-alert.txt"
$diskWarned = $false
while ($true) {
  try {
    $freeGb = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
    if ($freeGb -lt $DiskWarnGb) {
      if (-not $diskWarned) {
        $diskWarned = $true
        Log ("DISK LOW: C: only {0} GB free (threshold {1} GB) - this WILL break installs" -f $freeGb, $DiskWarnGb)
        Set-Content -Path $diskAlertFile -Value ("C: free {0} GB at {1}" -f $freeGb, (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ASCII
      }
    } elseif ($diskWarned) {
      $diskWarned = $false
      Log ("DISK OK: C: back to {0} GB free" -f $freeGb)
      Remove-Item -Path $diskAlertFile -Force -ErrorAction SilentlyContinue
    }
  } catch {}
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
