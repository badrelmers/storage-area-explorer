@echo off
SETLOCAL
CD /D "%~dp0"

REM check admin
REM fltmc >nul 2>&1 || ( color 4F & echo. & echo RUNME AS ADMIN & echo. & pause & exit )

call addnode22

call npm install
call npm run build

rmdir /Q /S components
rmdir /Q /S node_modules
pause
