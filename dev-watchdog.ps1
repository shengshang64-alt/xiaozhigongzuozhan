# dev-watchdog.ps1 -- fast-exit liveness probe + reviver for the Xiaozhi stack.
#
# Runs from Task Scheduler every minute. It MUST exit quickly and it must never
# block a later tick. That is the whole point of this file existing separately
# from dev-supervisor.ps1:
#
#   The previous setup pointed the 5-minute watchdog task straight at
#   dev-supervisor.ps1, whose loop never returns. The task instance therefore
#   stayed "running" forever, MultipleInstancesPolicy=IgnoreNew refused every
#   following tick with 0x800710E0, and the watchdog never actually watched
#   anything. Splitting the two roles fixes that: dev-supervisor.ps1 is the
#   resident worker, this script is the independent liveness check.
#
# Two things are checked, because either one can fail on its own:
#   1. Is the resident supervisor process alive? Answered by the single-instance
#      lock it holds for its whole lifetime -- "can I still open it for writing?"
#      is an exact test that a recycled PID cannot fool.
#   2. Is the stack actually answering on 8000/7000? The supervisor handles this
#      too, but checking here means a supervisor that is alive yet wedged no
#      longer leaves the app down.
#
# Exit codes: 0 = nothing to do or action taken, 1 = something went wrong.
param(
  [int]$Port = 8000,
  [int]$PbPort = 7000,
  [switch]$Quiet
)
$ErrorActionPreference = "SilentlyContinue"
$Root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockFile   = Join-Path $Root "dev-supervisor.pid"
$LogFile    = Join-Path $Root "dev-watchdog.log"
$Supervisor = Join-Path $Root "dev-supervisor.ps1"
$Launcher   = Join-Path $Root "start-local.cmd"

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  $line | Add-Content -Path $LogFile -Encoding ASCII
  if (-not $Quiet) { Write-Output $line }
}

function Test-Http([string]$url, [int]$TimeoutSec = 5) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = "GET"
    $req.Timeout = $TimeoutSec * 1000
    $req.ReadWriteTimeout = $TimeoutSec * 1000
    $req.AllowAutoRedirect = $false
    $resp = $req.GetResponse()
    $resp.Close()
    return $true
  } catch { return $false }
}

# ---- 1. resident supervisor alive? -------------------------------------
# FileMode Open (not OpenOrCreate) so this probe never creates the lock itself:
# a missing file unambiguously means "no supervisor has ever started".
$supervisorAlive = $false
if (Test-Path -LiteralPath $LockFile) {
  try {
    $stream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    # Reaching here means nobody holds the lock -> no live supervisor.
    $stream.Close()
    $supervisorAlive = $false
  } catch {
    $supervisorAlive = $true
  }
}

if (-not $supervisorAlive) {
  Log "supervisor is not running - starting it"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$Supervisor`"" `
    -WorkingDirectory $Root -WindowStyle Hidden
  # Give it a moment to take the lock so the next tick does not start a second
  # one. Harmless if it is slower than this: the lock still refuses duplicates.
  Start-Sleep -Seconds 5
}

# ---- 2. is the stack serving? ------------------------------------------
$viteOk = Test-Http "http://127.0.0.1:$Port/"
$pbOk   = Test-Http "http://127.0.0.1:$PbPort/api/health"

if ($viteOk -and $pbOk) {
  if (-not $Quiet) { Write-Output "stack healthy (vite=ok pb=ok), supervisorAlive=$supervisorAlive" }
  exit 0
}

Log ("stack unhealthy (vite={0} pb={1}) - checking for an in-flight launcher" -f $viteOk, $pbOk)

# start-local.cmd polls for up to ~140 s before giving up. Launching a second
# copy while the first is still waiting would just have the two of them fight
# over the same ports, so wait for the one already running.
$inFlight = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'start-local\.cmd' })
if ($inFlight.Count -gt 0) {
  Log ("launcher already in flight ({0}) - leaving it alone" -f $inFlight.Count)
  exit 0
}

Log "starting stack via start-local.cmd"
# "< NUL" matters: start-local.cmd calls pause on failure, and a detached task
# has no console to answer it, so without this a failed start would hang a
# hidden cmd.exe forever.
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "`"$Launcher`" --no-browser < NUL" `
  -WorkingDirectory $Root -WindowStyle Hidden
exit 0
