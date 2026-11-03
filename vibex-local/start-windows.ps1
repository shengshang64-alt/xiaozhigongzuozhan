$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $Root

$LocalDir = Join-Path $Root "vibex-local"
$PbDir = Join-Path $Root "pocketbase"
$PbLogDir = Join-Path $PbDir "logs"
$PbBin = Join-Path $LocalDir "bin\windows\pocketbase.exe"
New-Item -ItemType Directory -Force -Path $PbDir, (Join-Path $PbDir "pb_data"), (Join-Path $PbDir "pb_hooks"), (Join-Path $PbDir "pb_migrations"), $PbLogDir, (Split-Path -Parent $PbBin) | Out-Null

$EnvFile = Join-Path $Root ".env.local"
$EnvExample = Join-Path $LocalDir ".env.local.example"
if (!(Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
  Copy-Item $EnvExample $EnvFile
}
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
    $idx = $line.IndexOf("=")
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"')
    if ($name) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}
if (!$env:VIBEX_APP_ID) { $env:VIBEX_APP_ID = "app-d61cf9ef4f3a43a9ac231816a7e5d501" }

function Ensure-PocketBase {
  if (Test-Path $PbBin) {
    try {
      & $PbBin --version *> $null
      if ($LASTEXITCODE -eq 0) { return }
    } catch {}
    Remove-Item $PbBin -Force
  }
  Write-Host "Downloading PocketBase for Windows..."
  $release = Invoke-RestMethod "https://api.github.com/repos/pocketbase/pocketbase/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match "windows_amd64.zip$" } | Select-Object -First 1
  if (!$asset) { throw "Could not resolve PocketBase windows_amd64 release asset." }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("vibex-pb-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp "pocketbase.zip"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp -Force
  Move-Item (Join-Path $tmp "pocketbase.exe") $PbBin -Force
  Remove-Item $tmp -Recurse -Force
}

function Assert-NodeVersion {
  $parts = (& node -p "process.versions.node").Trim().Split(".")
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $ok = (($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 12) -or ($major -gt 22))
  if (!$ok) {
    throw "Node.js 20.19+ or 22.12+ is required by this export. Install a newer Node.js, then run this script again."
  }
}

function Ensure-NodePm {
  if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 20.19+ or 22.12+ is required. Install Node.js, then run this script again."
  }
  Assert-NodeVersion
  if (Test-Path (Join-Path $Root "pnpm-lock.yaml")) {
    if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
      if (Get-Command corepack -ErrorAction SilentlyContinue) {
        & corepack enable
        & corepack prepare pnpm@latest --activate
      } else {
        throw "pnpm is required for this project. Install pnpm, then run again."
      }
    }
    & pnpm install
    return @("pnpm", "exec", "vite")
  }
  & npm install
  return @("npx", "vite")
}

function Show-PocketBaseLogTail {
  $stderr = Join-Path $PbLogDir "stderr.log"
  if (Test-Path $stderr) { Get-Content $stderr -Tail 80 | ForEach-Object { Write-Host $_ } }
}

function Test-PocketBaseHealth {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:7000/api/health" -TimeoutSec 1
    return ($health.message -eq "API is healthy." -or $health.code -eq 200)
  } catch {
    return $false
  }
}

function Wait-PocketBase($Process) {
  for ($i = 0; $i -lt 30; $i++) {
    if ($Process.HasExited) {
      Show-PocketBaseLogTail
      throw "PocketBase failed to start. Check that port 7000 is free, then retry."
    }
    if (Test-PocketBaseHealth) { return }
    Start-Sleep -Seconds 1
  }
  Show-PocketBaseLogTail
  throw "PocketBase did not become healthy at http://127.0.0.1:7000/api/health."
}

Ensure-PocketBase
$pb = Start-Process -FilePath $PbBin -ArgumentList @("serve", "--http=127.0.0.1:7000", "--dir=$PbDir\pb_data", "--hooksDir=$PbDir\pb_hooks") -WorkingDirectory $PbDir -RedirectStandardOutput (Join-Path $PbLogDir "stdout.log") -RedirectStandardError (Join-Path $PbLogDir "stderr.log") -PassThru

# 2026-10-27：后端服务（sidecar）——承担解析/导出/大文件处理
# 为什么单独起进程而不是塞进 PocketBase：PB 的 JSVM 是 goja，装不了 docx/mammoth/pdfjs 这些 Node 库。
# 为什么失败不阻断启动：前端有降级路径（调不通就退回浏览器端导出），sidecar 挂了平台仍可用。
$sidecar = $null
$sidecarLog = Join-Path $PbLogDir "sidecar.log"
$sidecarErr = Join-Path $PbLogDir "sidecar.err.log"
try {
  $sidecar = Start-Process -FilePath "node" -ArgumentList @("vibex-local/sidecar/server.mjs") `
    -WorkingDirectory $Root -RedirectStandardOutput $sidecarLog -RedirectStandardError $sidecarErr -PassThru -WindowStyle Hidden
  $sidecarOk = $false
  for ($i = 0; $i -lt 15; $i++) {
    if ($sidecar.HasExited) { break }
    try {
      $h = Invoke-RestMethod "http://127.0.0.1:7001/health" -TimeoutSec 1
      if ($h.ok) { $sidecarOk = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 400
  }
  if ($sidecarOk) {
    Write-Host "Sidecar (解析/导出后端): http://127.0.0.1:7001"
  } else {
    Write-Warning "Sidecar 未就绪，导出将退回浏览器端（功能不受影响）。日志: $sidecarErr"
  }
} catch {
  Write-Warning "Sidecar 启动失败，导出将退回浏览器端。原因: $($_.Exception.Message)"
}

try {
  Wait-PocketBase $pb
  $vite = Ensure-NodePm
  Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process "http://127.0.0.1:8000" } | Out-Null
  Write-Host "VibeX local app: http://127.0.0.1:8000"
  Write-Host "PocketBase:      http://127.0.0.1:7000"
  $cmd = $vite[0]
  $args = @()
  if ($vite.Length -gt 1) { $args += $vite[1..($vite.Length - 1)] }
  $args += @("--config", "vibex-local/vite.local.config.ts", "--host", "0.0.0.0", "--port", "8000")
  & $cmd @args
} finally {
  if ($pb -and !$pb.HasExited) { Stop-Process -Id $pb.Id -Force }
  if ($sidecar -and !$sidecar.HasExited) { Stop-Process -Id $sidecar.Id -Force }
}
