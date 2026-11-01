@echo off
rem One-click client launcher. Keep this file CRLF (LF line endings make cmd.exe run it as one line -> double-click does nothing).
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node was not found in PATH. Install Node.js 22.12+ and retry.
  pause
  exit /b 1
)

echo Building (if needed) and launching OpenMacro client window ...
node scripts\start-client.js
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
  echo.
  echo Startup failed with exit code %EXITCODE%. See messages above. Press any key to close.
  pause >nul
)

exit /b %EXITCODE%
