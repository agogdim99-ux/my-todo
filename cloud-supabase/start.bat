@echo off
chcp 65001 >nul
title My Todo - CLOUD (Supabase)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo  [!] .env file was created. Put your Supabase URL and key in it, save, then run start.bat again.
  echo      Notepad will open now.
  notepad ".env"
  pause
  exit /b
)
start "" http://localhost:3001
node server.js
pause
exit /b

:nonode
echo.
echo  [!] Node.js is not installed.
echo      Install the "LTS" version from nodejs.org, then double-click start.bat again.
start "" https://nodejs.org/ko/download
pause
exit /b
