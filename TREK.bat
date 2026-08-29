@echo off
REM Windows: double-click this file to start TREK.
cd /d "%~dp0"
node scripts\launch.mjs %*
echo.
echo TREK has stopped. Press any key to close this window.
pause >nul
