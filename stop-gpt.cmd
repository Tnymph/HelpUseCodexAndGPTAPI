@echo off
rem ---------------------------------------------------------------------------
rem Program B launcher: close ChatGPT, Roxy, Clash and clean up the proxy.
rem Keep this file ASCII-only (see start-gpt.cmd for the reason).
rem Exit code 10 = relaunched elevated in a new window; this window closes.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
title GPT-Proxy-Stop
cd /d "%~dp0"

if not exist "src\stop.js" (
  echo [ERROR] src\stop.js not found. Please check the project files.
  pause
  exit /b 2
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js v18 or later.
  pause
  exit /b 2
)

node "src\stop.js" %*
set "EXITCODE=%ERRORLEVEL%"

if "%EXITCODE%"=="10" exit /b 0

echo.
echo Press any key to close this window...
pause >nul
exit /b %EXITCODE%
