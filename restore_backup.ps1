# restore_backup.ps1 — 从 backups/ 恢复 PocketBase data.db
#
# 用法：
#   .\restore_backup.ps1                       # 交互：列出所有备份让用户选
#   .\restore_backup.ps1 -Latest               # 用最新一份
#   .\restore_backup.ps1 -File <path>          # 指定文件
#   .\restore_backup.ps1 -Latest -Yes          # 免确认（脚本化）
#   .\restore_backup.ps1 -List                 # 只列出，不恢复
#
# 流程：
#   1) 停 PocketBase 进程（WAL 会锁文件，必须先停）
#   2) 用当前 data.db 生成一份 pre-restore 快照（防止误恢复）
#   3) 校验备份 SQLite 文件头
#   4) 覆盖 data.db，删除 data.db-shm / data.db-wal（SQLite 自动重建）
#   5) 提示用户手动重启 PB（不自动 start，避免连锁失败难定位）
#
# 安全：任何一步失败立即停下，不会破坏现有 data.db。

param(
  [string]$File,
  [switch]$Latest,
  [switch]$List,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$PbData  = Join-Path $Root "pocketbase\pb_data"
$DbPath  = Join-Path $PbData "data.db"
$BakDir  = Join-Path $PbData "backups"

function Die($msg) { Write-Host "[错误] $msg" -ForegroundColor Red; exit 1 }
function Info($msg){ Write-Host $msg }
function Ok($msg)  { Write-Host "[OK] $msg" -ForegroundColor Green }

if (-not (Test-Path $DbPath)) { Die "data.db 不存在：$DbPath（本项目 PB 未初始化？）" }
if (-not (Test-Path $BakDir)) { Die "备份目录不存在：$BakDir。请先运行 backup_pb.ps1" }

$backups = Get-ChildItem -Path $BakDir -Filter "data-*.db" -File | Sort-Object LastWriteTime -Descending

if ($List) {
  if ($backups.Count -eq 0) { Info "无备份文件"; exit 0 }
  Info ("共 {0} 个备份：" -f $backups.Count)
  $i = 1
  foreach ($b in $backups) {
    Info ("  [{0}] {1}  ({2:N1} MB)  {3}" -f $i, $b.Name, ($b.Length/1MB), $b.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
    $i++
  }
  exit 0
}

if ($backups.Count -eq 0) { Die "备份目录为空，无可恢复项" }

# 选定备份
$chosen = $null
if ($File) {
  if (-not (Test-Path $File)) {
    # 允许只给文件名
    $candidate = Join-Path $BakDir $File
    if (Test-Path $candidate) { $chosen = Get-Item $candidate }
    else { Die "文件不存在：$File" }
  } else {
    $chosen = Get-Item $File
  }
} elseif ($Latest) {
  $chosen = $backups[0]
} else {
  Info ("可用备份（{0} 个，按时间倒序）：" -f $backups.Count)
  $i = 1
  foreach ($b in $backups) {
    Info ("  [{0}] {1}  ({2:N1} MB)  {3}" -f $i, $b.Name, ($b.Length/1MB), $b.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
    $i++
    if ($i -gt 20) { Info ("  ... 只显示最新 20 个，共 {0} 个。用 -File <name> 指定其它" -f $backups.Count); break }
  }
  $sel = Read-Host "输入序号（回车取消）"
  if (-not $sel) { Info "已取消"; exit 0 }
  $idx = 0
  if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $backups.Count) {
    Die "无效序号：$sel"
  }
  $chosen = $backups[$idx - 1]
}

Info ""
Info "即将执行："
Info ("  备份源    : {0}  ({1:N1} MB, {2})" -f $chosen.FullName, ($chosen.Length/1MB), $chosen.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
Info ("  目标      : {0}" -f $DbPath)
Info ("  当前 data.db 会先快照为 data.db.pre-restore-<时间戳>.db")

# 校验 SQLite 头（前 16 字节）
$fs = [System.IO.File]::OpenRead($chosen.FullName)
try {
  $bts = New-Object byte[] 16
  [void]$fs.Read($bts, 0, 16)
  $magic = [System.Text.Encoding]::ASCII.GetString($bts, 0, 15)
  if ($magic -ne "SQLite format 3") { Die "不是合法的 SQLite 数据库文件：$($chosen.Name)" }
} finally { $fs.Dispose() }

if (-not $Yes) {
  $conf = Read-Host "确认恢复？输入 yes 继续，其它取消"
  if ($conf -ne "yes") { Info "已取消"; exit 0 }
}

# 1) 停 PB
$pbProcs = Get-Process -Name "pocketbase" -ErrorAction SilentlyContinue
if ($pbProcs) {
  Info "→ 停止 PocketBase（PID: $($pbProcs.Id -join ', ')）"
  Stop-Process -Name "pocketbase" -Force
  Start-Sleep -Seconds 2
  # WAL 文件可能还没释放
  if (Get-Process -Name "pocketbase" -ErrorAction SilentlyContinue) {
    Die "PocketBase 未能停止，请手动检查任务管理器"
  }
}

# 2) pre-restore 快照
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safety = Join-Path $PbData ("data.db.pre-restore-$stamp.db")
Info "→ 快照当前 data.db → $($safety | Split-Path -Leaf)"
Copy-Item -Path $DbPath -Destination $safety -Force
if (Test-Path "$DbPath-shm") { Copy-Item "$DbPath-shm" "$safety-shm" -Force }
if (Test-Path "$DbPath-wal") { Copy-Item "$DbPath-wal" "$safety-wal" -Force }

# 3) 覆盖
Info "→ 从备份恢复：$($chosen.Name)"
Copy-Item -Path $chosen.FullName -Destination $DbPath -Force

# 4) 清 WAL / SHM（SQLite 下次启动自动重建）
foreach ($suf in @("-shm", "-wal")) {
  $p = "$DbPath$suf"
  if (Test-Path $p) { Remove-Item $p -Force; Info "  删除 $(($p | Split-Path -Leaf))" }
}

Ok "备份已恢复到 data.db"
Info ""
Info "下一步："
Info "  1) 启动 PocketBase：  .\start-local.cmd   或   pwsh .diag\restart_pb.ps1"
Info "  2) 打开工作台，检查知识库/笔记/项目数据是否符合预期"
Info "  3) 若不对，可用快照回滚（本次恢复前的状态）："
Info ("     Copy-Item `"$safety`" `"$DbPath`" -Force")
Info ("     （记得同时删掉 data.db-shm/data.db-wal，并停 PB 进程）")
