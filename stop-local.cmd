@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Xiaozhi Sales Workbench - Stop
echo ============================================
echo.

call :killport 7000 PocketBase
call :killport 8000 Vite

echo.
echo All services stopped.
ping -n 3 127.0.0.1 >NUL
endlocal
exit /b 0

rem ---- helper: kill whatever LISTENs on a given port ----
:killport
set "PORT=%~1"
set "NAME=%~2"
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo   stopping %NAME% ^(PID %%P^) ...
  taskkill /F /PID %%P >NUL 2>&1
)
if not defined FOUND echo   %NAME% is not running.
exit /b 0
