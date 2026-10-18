@echo off
rem Double-click this to see whether the resident Xiaozhi stack is alive.
rem Read-only: it changes nothing, so it is safe to run at any time.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1"
echo.
pause
