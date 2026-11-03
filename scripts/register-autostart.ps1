<#
  register-autostart.ps1 — install / remove the logon autostart + 5-minute safety net
  for dev-supervisor.ps1 (current user, no admin required).

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1
    powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1 -Remove

  Why two tasks:
    XiaozhiDevSupervisor           at logon -> runs the supervisor loop (15s liveness checks)
    XiaozhiDevSupervisorWatchdog   every 5 min -> runs the same script; it exits at once when
                                   an instance is alive (single-instance pid lock), and takes
                                   over when the loop died. So the stack is always supervised.

  Both tasks use -MultipleInstances IgnoreNew and no execution time limit, because the
  supervisor is meant to run forever.
#>
param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Supervisor = Join-Path $Root 'dev-supervisor.ps1'
$TaskName = 'XiaozhiDevSupervisor'
$WatchName = 'XiaozhiDevSupervisorWatchdog'

if (-not (Test-Path $Supervisor)) { throw "dev-supervisor.ps1 not found: $Supervisor" }

if ($Remove) {
  foreach ($n in @($TaskName, $WatchName)) {
    $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
    if ($t) { Unregister-ScheduledTask -TaskName $n -Confirm:$false; Write-Host "removed task: $n" }
    else { Write-Host "task not present: $n" }
  }
  Write-Host "done (services keep running; stop them via stop-local / task manager)"
  exit 0
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $Supervisor) `
  -WorkingDirectory $Root
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logonTrigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "registered: $TaskName (at logon)"

$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $WatchName -Action $action -Trigger $repeatTrigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "registered: $WatchName (every 5 minutes)"

Get-ScheduledTask -TaskName $TaskName, $WatchName |
  Select-Object TaskName, State | Format-Table -AutoSize
