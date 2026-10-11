@echo off
rem ---------------------------------------------------------------------------
rem Program A launcher: configure network proxy (US static IP) and open ChatGPT.
rem Keep this file ASCII-only: cmd.exe parses .cmd with the console code page
rem (GBK on zh-CN Windows), so non-ASCII text here can corrupt parsing.
rem Chinese output is produced by Node (UTF-8) after "chcp 65001".
rem ---------------------------------------------------------------------------
chcp 65001 >nul
title GPT-Proxy-Start
cd /d "%~dp0"

if not exist "src\start.js" (
  echo [ERROR] src\start.js not found. Please check the project files.
  pause
  exit /b 2
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js v18 or later.
  pause
  exit /b 2
)

node "src\start.js" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" echo [NOTE] exited with code %EXITCODE%. See messages above.
echo Press any key to close this window...
pause >nul
exit /b %EXITCODE%
