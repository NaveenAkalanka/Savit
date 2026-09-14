@echo off
echo Stopping Savit server on port 4318...

set found=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4318" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
    echo Stopped process %%p
    set found=1
)

if "%found%"=="0" (
    echo No server was running on port 4318.
)

echo.
pause
