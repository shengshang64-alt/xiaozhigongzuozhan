@echo off
chcp 65001 >NUL
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

rem ============================================================
rem  小智工作站 · Qoder 自主迭代 一键启动器（v2 · 对接 scripts/autoloop.mjs）
rem  用法：
rem    qoder-auto.cmd check        环境预检（零费用，不调用 AI）
rem    qoder-auto.cmd gates        只跑四门门禁复验（零费用）
rem    qoder-auto.cmd dry          组装提示词落盘，不调用 AI
rem    qoder-auto.cmd run 1        跑 1 轮
rem    qoder-auto.cmd run 5        跑 5 轮（睡前无人值守用）
rem ============================================================

rem ---------- 定位 Node.js ----------
set "NODE_EXE="
for %%P in (
  "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
  "D:\Program Files\nodejs\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
) do (
  if not defined NODE_EXE if exist %%P set "NODE_EXE=%%~P"
)
if not defined NODE_EXE (
  where node >NUL 2>&1
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo.
  echo [错误] 未找到 Node.js。请安装 Node.js 20+ 或把 node.exe 所在目录加入 PATH。
  echo.
  pause
  exit /b 1
)

if "%~1"=="" goto :menu
if /i "%~1"=="check"   goto :check
if /i "%~1"=="gates"   goto :gates
if /i "%~1"=="dry"     goto :dry
if /i "%~1"=="run"     goto :run
if /i "%~1"=="help"    goto :menu
goto :passthru

:menu
echo.
echo ============================================================
echo   小智工作站 · Qoder 自主迭代 v2
echo ============================================================
echo.
echo   环境预检（零费用）   qoder-auto.cmd check
echo   四门门禁（零费用）   qoder-auto.cmd gates
echo   试跑（不花钱）       qoder-auto.cmd dry
echo   跑 1 轮              qoder-auto.cmd run 1
echo   跑 5 轮（睡前）      qoder-auto.cmd run 5
echo.
echo   提示词：Qoder自主迭代提示词-v2.md
echo   报告落点：docs\evolution\R{轮次}_{日期}.md
echo   停机说明：docs\evolution\_STOP.md
echo.
pause
exit /b 0

:check
"%NODE_EXE%" scripts\autoloop.mjs --check
goto :done

:gates
"%NODE_EXE%" scripts\autoloop.mjs --gate-only
goto :done

:dry
"%NODE_EXE%" scripts\autoloop.mjs --dry-run
goto :done

:run
set "N=%~2"
if "%N%"=="" set "N=1"
"%NODE_EXE%" scripts\autoloop.mjs --rounds %N%
goto :done

:passthru
"%NODE_EXE%" scripts\autoloop.mjs %*
goto :done

:done
echo.
echo 运行结束（退出码 %ERRORLEVEL%）。
pause
endlocal
exit /b 0
