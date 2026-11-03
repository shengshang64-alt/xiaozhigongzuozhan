# sidecar-supervisor.ps1 — 小智工作站后端服务（sidecar）探活守护
#
# 用途：保证解析/导出后端（127.0.0.1:7001）常驻。探活 -> 挂了就拉起 -> 退避节流。
# 为什么需要它（2026-10-27 用户要求「做常驻服务」）：
#   sidecar 承担「解析、导出、大文件处理」。它挂了前端会降级回浏览器路径，
#   但降级意味着大标书又回到 6 万字/20 段的旧限制 —— 所以必须常驻。
#
# 与 dev-supervisor.ps1 的关系：
#   那个守 8000（前端）和提示 7000（PocketBase）；本脚本只守 7001（sidecar）。
#   分开是为了独立启停：sidecar 挂了不影响前端探活判定。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File sidecar-supervisor.ps1 [-Once] [-IntervalSec 15]
# 注册开机自启（管理员）：
#   schtasks /Create /TN "XiaozhiSidecarSupervisor" /SC ONSTART /RU SYSTEM /TR "powershell -ExecutionPolicy Bypass -File D:\重要文件\工作的小程序\xiaozhigongzuozhan\sidecar-supervisor.ps1"
#
# 设计要点（照抄 dev-supervisor 踩过的坑）：
#   - 单实例用独占文件句柄，不用"读 PID 看活没活"（Windows 会回收 PID，曾因此锁死）
#   - 退避节流：连续失败不狂重启（避免日志刷屏与资源浪费）
#   - 只监听本机：sidecar 是本地服务，不对外

param(
  [switch]$Once,
  [int]$SidecarPort = 7001,
  [int]$IntervalSec = 15,
  [int]$MaxBackoffSec = 120
)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockFile = Join-Path $Root "sidecar-supervisor.pid"
$LogFile = Join-Path $Root "sidecar-supervisor.log"
$ServerJs = Join-Path $Root "vibex-local\sidecar\server.mjs"
$SidecarOut = Join-Path $Root "pocketbase\logs\sidecar.log"
$SidecarErr = Join-Path $Root "pocketbase\logs\sidecar.err.log"

function Write-Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 单实例锁：独占句柄（进程退出由 OS 自动释放，不会因 PID 回收而锁死）
try {
  $LockStream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
} catch {
  Write-Output "sidecar supervisor already running (lock held)"
  exit 0
}
Set-Content -Path $LockFile -Value $PID -Encoding ASCII

function Test-Sidecar {
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$SidecarPort/health" -TimeoutSec 3
    return ($h.ok -eq $true)
  } catch {
    return $false
  }
}

function Find-SidecarProcess {
  # 优先按端口找（最准）；找不到再按命令行匹配
  $conn = Get-NetTCPConnection -LocalPort $SidecarPort -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq "node") { return $p }
  }
  return $null
}

function Start-Sidecar {
  if (!(Test-Path $ServerJs)) {
    Write-Log "ERROR server.mjs 不存在: $ServerJs"
    return $false
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SidecarOut) | Out-Null
  try {
    $p = Start-Process -FilePath "node" -ArgumentList @($ServerJs) -WorkingDirectory $Root `
      -RedirectStandardOutput $SidecarOut -RedirectStandardError $SidecarErr `
      -PassThru -WindowStyle Hidden
    Write-Log "启动 sidecar PID=$($p.Id)"
    return $true
  } catch {
    Write-Log "ERROR 启动失败: $($_.Exception.Message)"
    return $false
  }
}

Write-Log "supervisor 启动（PID=$PID，端口=$SidecarPort，间隔=${IntervalSec}s）"

$backoff = 0
$lastState = $null

do {
  $alive = Test-Sidecar
  if ($alive) {
    if ($lastState -ne "up") { Write-Log "sidecar 健康" }
    $lastState = "up"
    $backoff = 0
  } else {
    if ($lastState -ne "down") { Write-Log "sidecar 无响应，准备拉起" }
    $lastState = "down"

    # 先看有没有进程占着端口但不应答（僵死）——杀掉再起
    $stuck = Find-SidecarProcess
    if ($stuck) {
      Write-Log "发现僵死 sidecar PID=$($stuck.Id)，强制结束"
      Stop-Process -Id $stuck.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }

    if ($backoff -gt 0) {
      Write-Log "退避 ${backoff}s 后重试"
      Start-Sleep -Seconds $backoff
    }
    if (Start-Sidecar) {
      # 等它就绪（最多 10 秒）
      $ready = $false
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Sidecar) { $ready = $true; break }
      }
      if ($ready) {
        Write-Log "sidecar 已就绪"
        $lastState = "up"
        $backoff = 0
      } else {
        Write-Log "WARN 启动后仍不健康（看 $SidecarErr）"
        $backoff = [Math]::Min($MaxBackoffSec, [Math]::Max(5, $backoff * 2))
      }
    } else {
      $backoff = [Math]::Min($MaxBackoffSec, [Math]::Max(5, $backoff * 2))
    }
  }

  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSec
} while ($true)

try { $LockStream.Close() } catch {}
Write-Log "supervisor 退出"
