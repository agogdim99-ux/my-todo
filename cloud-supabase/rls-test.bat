@echo off
chcp 65001 >nul
title RLS test
cd /d "%~dp0"
echo.
echo  Keep start.bat running. Testing with 2 test accounts (rls-a@test.com, rls-b@test.com)...
echo.
node rls-test.js
pause
