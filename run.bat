@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Freeing port 4318 if it's already in use...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4318" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

rem Bind to all network interfaces (not just this PC) so other devices on the
rem same network can reach the server, not only http://localhost:4318.
set SAVIT_HOST=0.0.0.0

echo.
echo ================================================================
echo   Savit
echo   ------------------------------------------------------------
echo   This device:    http://localhost:4318
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'VMware|WSL|Tailscale|vEthernet' } | ForEach-Object { Write-Host ('  Other devices:  http://' + $_.IPAddress + ':4318') }"
echo   ------------------------------------------------------------
echo   If other devices can't connect, Windows may prompt to allow
echo   Node.js through the firewall the first time - click Allow.
echo   ------------------------------------------------------------
echo   Press CTRL+C to stop the server (then Y to confirm).
echo   Or just double-click stop.bat from anywhere.
echo ================================================================
echo.

call npm run dev --workspace server

echo.
echo Server stopped.
pause
