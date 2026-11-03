@echo off
rem Double-click: run the read-only output-quality audit and save the report.
rem
rem Why this file exists: running "npx vitest ..." from the wrong directory
rem (e.g. C:\Users\Administrator) makes npx download its own vitest, then find
rem zero test files. This wrapper pins the working directory to the repo root
rem first, so that failure mode cannot happen.
rem
rem Read-only: opens pocketbase\pb_data\data.db with readOnly=true and never
rem writes to the database. Safe to run while the app is running.
rem
rem Usage (optional args; double-click with no args prompts instead):
rem   quality-audit.cmd                        全库, output quality-audit.txt
rem   quality-audit.cmd 安中医                  只统计项目名含"安中医", output quality-audit.txt
rem   quality-audit.cmd 安中医 before           同上, output quality-audit-before.txt
rem   quality-audit.cmd 安中医 after            同上, output quality-audit-after.txt
rem
rem A/B workflow: run "before" with the current config, regenerate one chapter
rem after changing the switches, then run "after". Compare the "超 300 字占比"
rem and "段落中位" columns in section 2 -- those are the metrics that matter
rem (the cliche word count is NOT the root cause, see bidProseLinter.ts:145).
rem
rem ASCII only -- cmd.exe mangles non-ASCII in .cmd files.
setlocal
cd /d "%~dp0"

set "FILTER=%~1"
set "LABEL=%~2"

if not exist "node_modules\vitest" (
  echo.
  echo ERROR: vitest is not installed in this folder's node_modules.
  echo Run "pnpm install" in this folder first, then double-click again.
  echo.
  pause
  exit /b 1
)

if not exist "pocketbase\pb_data\data.db" (
  echo.
  echo ERROR: pocketbase\pb_data\data.db not found.
  echo The audit reads your real data; without it there is nothing to measure.
  echo.
  pause
  exit /b 1
)

if not exist "_eval" mkdir "_eval"

rem No args (double-clicked): ask, so the common case needs no typing.
if "%FILTER%%LABEL%"=="" (
  echo.
  echo Project name keyword for the A/B run -- leave blank to audit the whole DB.
  set /p "FILTER=  keyword: "
  if not "%FILTER%"=="" set /p "LABEL=  label (e.g. before / after, blank = none): "
)

set "OUT=_eval\quality-audit.txt"
if not "%LABEL%"=="" set "OUT=_eval\quality-audit-%LABEL%.txt"

echo.
if "%FILTER%"=="" (echo Auditing the WHOLE database.) else (echo Auditing projects matching "%FILTER%".)
echo This can take a couple of minutes: it lints every chapter body. Please wait...
echo.

set "XZ_AUDIT_PROJECT=%FILTER%"
call npx vitest run src/pages/BidWorkspace/qualityAuditRealDb.test.ts > "%OUT%" 2>&1
set "RC=%ERRORLEVEL%"

type "%OUT%"

echo.
echo ------------------------------------------------------------
echo Exit code: %RC%
echo   0 = the invariants held (the statistics above are the point)
echo   1 = a test or the runner failed -- send the text above back
echo Report saved to: %OUT%
echo ------------------------------------------------------------
echo.
pause
endlocal
