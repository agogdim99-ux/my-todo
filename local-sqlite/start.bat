@echo off
chcp 65001 >nul
title My Todo - LOCAL (SQLite)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 goto oldnode
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
pause
exit /b

:nonode
echo.
echo  [!] Node.js is not installed.
echo      Install the "LTS" version from nodejs.org, then double-click start.bat again.
start "" https://nodejs.org/ko/download
pause
exit /b

:oldnode
echo.
echo  [!] Your Node.js is too old. Install the latest "LTS" version from nodejs.org.
start "" https://nodejs.org/ko/download
pause
exit /b
