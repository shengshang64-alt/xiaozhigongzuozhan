@echo off
chcp 65001 >NUL
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"

rem ============================================================
rem  小智工作站 · Qoder 自主迭代 一键启动器
rem  用法：
rem    qoder-auto.cmd status          查看状态（零费用）
rem    qoder-auto.cmd check           环境预检（零费用）
rem    qoder-auto.cmd dry             试跑：只组装提示词，不调用 AI
rem    qoder-auto.cmd run 1           跑 1 轮
rem    qoder-auto.cmd run 3           跑 3 轮
rem    qoder-auto.cmd scope /knowledge run 1    限定范围跑 1 轮
rem ============================================================

rem ---------- 定位 Node.js ----------
set "NODE_EXE="
for %%P in (
  "D:\Program Files\nodejs\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
) do (
  if not defined NODE_EXE if exist %%P set "NODE_EXE=%%~P"
)
if not defined NODE_EXE (
  where node >NUL 2>&1
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo.
  echo [错误] 未找到 Node.js。
  echo        请安装 Node.js 20+ ：https://nodejs.org/
  echo        或把 node.exe 所在目录加入 PATH。
  echo.
  pause
  exit /b 1
)

if "%~1"=="" goto :menu
if /i "%~1"=="status"  goto :status
if /i "%~1"=="check"   goto :check
if /i "%~1"=="dry"     goto :dry
if /i "%~1"=="run"     goto :run
if /i "%~1"=="scope"   goto :scope
if /i "%~1"=="help"    goto :menu
goto :passthru

:menu
echo.
echo ============================================================
echo   小智工作站 · Qoder 自主迭代
echo ============================================================
echo.
echo   当前状态      qoder-auto.cmd status
echo   环境预检      qoder-auto.cmd check
echo   试跑（不花钱） qoder-auto.cmd dry
echo   跑 1 轮       qoder-auto.cmd run 1
echo   跑 3 轮       qoder-auto.cmd run 3
echo   限定模块跑    qoder-auto.cmd scope /knowledge run 1
echo.
echo   可选参数（追加在后面）：
echo     --permission-mode auto    切换权限模式
echo     --timeout 60              单轮超时（分钟）
echo     --max-turns 100           单轮最大轮次
echo     --no-commit               不自动提交
echo     --backup-pb               跑前备份 pb_data
echo.
echo   查看当前状态与待办：先跑 status。
echo.
pause
exit /b 0

:status
"%NODE_EXE%" scripts\qoder-loop.mjs --status %2 %3 %4 %5 %6
goto :done

:check
"%NODE_EXE%" scripts\qoder-loop.mjs --check %2 %3 %4 %5 %6
goto :done

:dry
"%NODE_EXE%" scripts\qoder-loop.mjs --dry-run --rounds 1 %2 %3 %4 %5 %6
echo.
echo  提示词已写入 .loop\prompt-R*.md，可直接打开审阅。
goto :done

:scope
rem 形如： qoder-auto.cmd scope /knowledge run 1
set "SCOPE=%~2"
set "ACTION=%~3"
set "N=%~4"
if "%N%"=="" set "N=1"
if /i "%ACTION%"=="run" (
  "%NODE_EXE%" scripts\qoder-loop.mjs --scope "%SCOPE%" --rounds %N% %5 %6 %7
) else (
  echo [提示] 用法：qoder-auto.cmd scope ^<模块^> run ^<轮数^>
)
goto :done

:run
set "N=%~2"
if "%N%"=="" set "N=1"
"%NODE_EXE%" scripts\qoder-loop.mjs --rounds %N% %3 %4 %5 %6 %7
goto :done

:passthru
"%NODE_EXE%" scripts\qoder-loop.mjs %*
goto :done

:done
echo.
echo 运行结束（退出码 %ERRORLEVEL%）。报告见 .loop\reports\，概览见 .loop\MORNING.md
echo.
pause
endlocal
exit /b 0
