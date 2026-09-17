@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo ============================================
echo   Xiaozhi Sales Workbench - Local Launcher
echo ============================================
echo.

rem ---------- Stage 1: PocketBase backend (127.0.0.1:7000) ----------
echo [1/2] PocketBase backend (127.0.0.1:7000)
curl -s -f -o NUL --max-time 3 http://127.0.0.1:7000/api/health >NUL 2>&1
if not errorlevel 1 (
  echo       already running - reusing
  goto :vite_stage
)

echo       starting...
rem NOTE: --dir/--hooksDir/--migrationsDir are resolved relative to the
rem pocketbase.exe location, NOT the current directory. Absolute paths are
rem required, otherwise pb_hooks are silently skipped and every custom API
rem route returns 404.
start "PocketBase" /min "%ROOT%\vibex-local\bin\windows\pocketbase.exe" serve --http=127.0.0.1:7000 --dir="%ROOT%\pocketbase\pb_data" --hooksDir="%ROOT%\pocketbase\pb_hooks" --migrationsDir="%ROOT%\pocketbase\pb_migrations"

set /a PB_WAIT=0
:pb_poll
curl -s -f -o NUL --max-time 3 http://127.0.0.1:7000/api/health >NUL 2>&1
if not errorlevel 1 (
  echo       ready
  goto :vite_stage
)
set /a PB_WAIT+=1
if !PB_WAIT! GEQ 30 (
  echo       ERROR: PocketBase did not become ready.
  echo       Check: port 7000 free? exe present in vibex-local\bin\windows ?
  pause
  exit /b 1
)
ping -n 2 127.0.0.1 >NUL
goto :pb_poll

:vite_stage
rem ---------- Stage 2: Vite frontend (127.0.0.1:8000) ----------
echo.
echo [2/2] Vite dev server (127.0.0.1:8000)
curl -s -f -o NUL --max-time 3 http://127.0.0.1:8000/ >NUL 2>&1
if not errorlevel 1 (
  echo       already running - reusing
  goto :open
)

echo       starting...
start "Vite" /min cmd /c "cd /d ""%ROOT%"" && node ""%ROOT%\node_modules\vite\bin\vite.js"" --config ""%ROOT%\vibex-local\vite.local.config.ts"" --host 127.0.0.1 --port 8000"

set /a VITE_WAIT=0
:vite_poll
curl -s -f -o NUL --max-time 5 http://127.0.0.1:8000/ >NUL 2>&1
if not errorlevel 1 (
  echo       ready
  goto :open
)
set /a VITE_WAIT+=1
if !VITE_WAIT! GEQ 40 (
  echo       ERROR: Vite did not become ready.
  echo       Check the Vite window for the real error message.
  pause
  exit /b 1
)
ping -n 2 127.0.0.1 >NUL
goto :vite_poll

:open
echo.
echo ============================================
echo   READY  -^>  http://127.0.0.1:8000/
echo   Backend API      http://127.0.0.1:7000
echo   DB dashboard     http://127.0.0.1:7000/_/
echo ============================================
start "" http://127.0.0.1:8000/
endlocal
exit /b 0
