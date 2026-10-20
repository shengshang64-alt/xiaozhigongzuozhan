@echo off
rem Double-click this to diagnose (and optionally repair) LAN access to the
rem Xiaozhi stack on port 8000. It prints a report, then asks Y/N before
rem changing anything.
rem
rem Runs elevated: reading firewall rules and adding one both need admin, and
rem asking for elevation once here is less confusing than failing halfway.
rem ASCII only, same reason as lan-fix.ps1 (cmd.exe mangles non-ASCII here).
setlocal
set "PS1=%~dp0lan-fix.ps1"
if not exist "%PS1%" (
  echo ERROR: lan-fix.ps1 not found next to this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%PS1%')"
if errorlevel 1 (
  echo.
  echo If no window appeared, the UAC prompt was declined.
  echo Run this again and click Yes.
  pause
)
endlocal
