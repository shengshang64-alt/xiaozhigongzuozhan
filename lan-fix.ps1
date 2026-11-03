# lan-fix.ps1 -- diagnose (and optionally repair) LAN access to the Xiaozhi stack.
#
# Why this exists: dev-watchdog.ps1 and dev-supervisor.ps1 both probe
# http://127.0.0.1:8000 only. So a stack that answers on loopback but is
# unreachable from other machines reports "healthy" forever and nobody notices.
# This script is the LAN-side counterpart: it checks the machine address, the
# listener binding, the network profile and the firewall, then offers the one
# change that makes the Private-vs-Public flip stop mattering.
#
# ASCII ONLY on purpose: PowerShell 5.1 reads BOM-less .ps1 files as ANSI, so
# non-ASCII text here would come out as mojibake. Same rule as status.ps1.
#
# Read-only until you answer the prompt at the end. Nothing is changed before that.

param(
  [int]$Port = 8000,
  [string]$LanIp = "192.168.1.3",
  [switch]$NoPrompt
)

$ErrorActionPreference = "SilentlyContinue"

function Head([string]$s) { Write-Host ""; Write-Host ("=== " + $s + " ===") }
function Code([int]$c) { if ($c -gt 0) { return "HTTP " + $c } else { return "*** FAILED ***" } }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Test-Http([string]$url, [int]$TimeoutSec = 5) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = "GET"
    $req.Timeout = $TimeoutSec * 1000
    $req.ReadWriteTimeout = $TimeoutSec * 1000
    $req.AllowAutoRedirect = $false
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    return $code
  } catch {
    return 0
  }
}

Write-Host ""
Write-Host "============================================================"
Write-Host ("  Xiaozhi Workbench - LAN access check (port {0})" -f $Port)
Write-Host ("  {0}    admin={1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $isAdmin)
Write-Host "============================================================"

# ---- 1. is the target address really on this machine? -------------------
Head "[1] IPv4 addresses on this machine"
$addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' })
if ($addrs.Count -eq 0) { Write-Host "    (none found)" }
foreach ($a in $addrs) {
  $mark = ""
  if ($a.IPAddress -eq $LanIp) { $mark = "   <== this is the address colleagues use" }
  Write-Host ("    {0,-16} ifIndex={1,-5} {2}{3}" -f $a.IPAddress, $a.InterfaceIndex, $a.InterfaceAlias, $mark)
}
$targetHere = @($addrs | Where-Object { $_.IPAddress -eq $LanIp }).Count -gt 0
if (-not $targetHere) {
  Write-Host ""
  Write-Host ("    *** {0} is NOT on this machine right now. ***" -f $LanIp)
  Write-Host "    A DHCP lease change would explain everything: colleagues are opening an"
  Write-Host "    address that now belongs to nothing (or to another device)."
  Write-Host "    Fix: use one of the addresses above, and reserve a static lease so it"
  Write-Host "    cannot drift again."
}

# ---- 2. listener: bound to all interfaces, or loopback only? -----------
Head ("[2] Listener on port " + $Port)
$lis = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$bindAll = $false
if ($lis.Count -eq 0) {
  Write-Host "    *** NOT LISTENING - the dev server is not running. ***"
  Write-Host "    Run start-local.cmd, wait for READY, then run this script again."
} else {
  foreach ($c in $lis) {
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $c.OwningProcess)
    $isAll = ($c.LocalAddress -eq "0.0.0.0" -or $c.LocalAddress -eq "::")
    if ($isAll) { $bindAll = $true }
    if ($isAll) { $tag = "   (all interfaces - LAN can reach it)" }
    else { $tag = "   (LOOPBACK ONLY - LAN clients CANNOT connect)" }
    Write-Host ("    {0}:{1}   pid={2}  {3}{4}" -f $c.LocalAddress, $c.LocalPort, $c.OwningProcess, $proc.Name, $tag)
  }
}

# ---- 3. HTTP reachability: loopback vs the LAN address -----------------
Head "[3] HTTP reachability"
$loopCode = Test-Http ("http://127.0.0.1:{0}/" -f $Port)
Write-Host ("    http://127.0.0.1:{0}/         -> {1}" -f $Port, (Code $loopCode))
$lanCode = Test-Http ("http://{0}:{1}/" -f $LanIp, $Port)
Write-Host ("    http://{0}:{1}/     -> {2}" -f $LanIp, $Port, (Code $lanCode))
if ($loopCode -gt 0 -and $lanCode -eq 0) {
  Write-Host ""
  Write-Host "    Diagnosis: the app IS serving on this machine but is NOT reachable on"
  Write-Host "    the LAN address. That is a network-layer block, not an app fault."
}

# ---- 4. network profile -------------------------------------------------
Head "[4] Network profile (firewall treats Private and Public differently)"
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
if ($profiles.Count -eq 0) { Write-Host "    (none found)" }
foreach ($p in $profiles) {
  $tag = ""
  if ($p.NetworkCategory -ne "Private") { $tag = "   <== NOT Private: the one-off 'Allow' prompt rule does not apply here" }
  Write-Host ("    ifIndex={0,-5} {1,-28} {2}{3}" -f $p.InterfaceIndex, $p.Name, $p.NetworkCategory, $tag)
}

# ---- 5. firewall rules that could cover this port ----------------------
# Direction matters: NetSecurity only supports rule -> filter reliably, so this
# walks inbound rules once and reads each rule's port/application filter.
Head ("[5] Inbound firewall rules touching port " + $Port + " or node.exe")
$allInbound = @(Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue)
Write-Host ("    (scanning {0} inbound rules, a few seconds...)" -f $allInbound.Count)
$portRules = @()
$appRules = @()
foreach ($r in $allInbound) {
  $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
  if ($pf) {
    $lp = $pf.LocalPort
    if ($lp -is [array]) {
      if ($lp -contains $Port) { $portRules += $r }
    } elseif (("{0}" -f $lp) -eq ("{0}" -f $Port)) {
      $portRules += $r
    }
  }
  $af = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
  if ($af -and (("{0}" -f $af.Program) -like "*node.exe")) { $appRules += $r }
}

Write-Host ""
Write-Host ("    -- rules mentioning TCP " + $Port + ":")
if ($portRules.Count -eq 0) { Write-Host "       (none)" }
foreach ($r in $portRules) {
  Write-Host ("       {0,-44} enabled={1,-6} action={2,-7} profile={3}" -f $r.DisplayName, $r.Enabled, $r.Action, $r.Profile)
}
Write-Host ""
Write-Host "    -- rules bound to node.exe (the one-off 'Allow' prompt creates this):"
if ($appRules.Count -eq 0) { Write-Host "       (none)" }
foreach ($r in $appRules) {
  Write-Host ("       {0,-44} enabled={1,-6} action={2,-7} profile={3}" -f $r.DisplayName, $r.Enabled, $r.Action, $r.Profile)
}
if ($appRules.Count -gt 0) {
  $narrow = @($appRules | Where-Object { $_.Profile -ne "Any" -and $_.Enabled -eq "True" -and $_.Action -eq "Allow" })
  if ($narrow.Count -gt 0) {
    Write-Host ""
    Write-Host "    Note: the node.exe rule(s) above are enabled+allow but scoped to a"
    Write-Host "    specific profile. If the current profile (see [4]) is not among them,"
    Write-Host "    LAN inbound is silently blocked - which matches the symptom exactly."
  }
}

# ---- 6. the one change that makes the profile irrelevant ---------------
Head "[6] Repair"
$ruleName = "Xiaozhi Workbench " + $Port + " (TCP in)"
$already = @($portRules | Where-Object { $_.DisplayName -eq $ruleName -and $_.Enabled -eq "True" -and $_.Action -eq "Allow" })

if ($already.Count -gt 0) {
  Write-Host ("    Rule '" + $ruleName + "' already exists and is enabled.")
  Write-Host "    If LAN is still blocked, the blocker is NOT this firewall rule:"
  Write-Host "    re-check [1] address drift and [4] profile, or an endpoint-protection"
  Write-Host "    product / VPN client intercepting the connection."
} elseif ($lis.Count -eq 0) {
  Write-Host "    Nothing is listening - start the stack first (start-local.cmd)."
} elseif (-not $bindAll) {
  Write-Host "    Listener is loopback-only, so a firewall rule will NOT help."
  Write-Host "    Start the stack with start-local.cmd (it passes --host 0.0.0.0)."
} elseif ($lanCode -gt 0) {
  Write-Host "    LAN access already works from this machine. Nothing to do."
} else {
  Write-Host ("    Proposed: add inbound allow rule '" + $ruleName + "' for TCP " + $Port)
  Write-Host "    on ALL profiles (Domain/Private/Public). That is what stops the"
  Write-Host "    Private-vs-Public flip from mattering. It opens only this one port."
  if (-not $isAdmin) {
    Write-Host ""
    Write-Host "    *** Needs admin. Close this, run lan-fix.cmd, accept the UAC prompt. ***"
  } else {
    $answer = "N"
    if (-not $NoPrompt) {
      Write-Host ""
      $answer = Read-Host "    Add the rule now? [Y/N]"
    }
    if ($answer -match '^(y|Y)') {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
      $verify = @(Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $ruleName })
      if ($verify.Count -gt 0) {
        Write-Host ("    Added. Re-testing http://{0}:{1}/ ..." -f $LanIp, $Port)
        Start-Sleep -Seconds 2
        $after = Test-Http ("http://{0}:{1}/" -f $LanIp, $Port)
        if ($after -gt 0) {
          Write-Host ("    OK - now answering HTTP {0} on the LAN address." -f $after)
          Write-Host "    Ask a colleague to reload. No restart of the app was needed."
        } else {
          Write-Host "    Rule added, but the LAN address still fails from this machine."
          Write-Host "    That points away from the firewall - send this whole output back."
        }
      } else {
        Write-Host "    *** Could not create the rule. ***"
      }
    } else {
      Write-Host "    Skipped. Nothing was changed."
    }
  }
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  Done. Nothing else was modified."
Write-Host "============================================================"
Write-Host ""
