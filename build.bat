@echo off
SETLOCAL
CD /D "%~dp0"

REM check admin
REM fltmc >nul 2>&1 || ( color 4F & echo. & echo RUNME AS ADMIN & echo. & pause & exit )

call addnode12

call npm install -g bower grunt-cli
call npm install
call bower install
call grunt zip:release

rmdir /Q /S components
rmdir /Q /S node_modules
pause
