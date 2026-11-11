@echo off
rem Accent Coach: starts the local web app and opens it in the browser.
cd /d "%~dp0web"
if not exist node_modules (
  echo Installing once...
  call npm install --no-fund --no-audit || goto :fail
)
start "" http://127.0.0.1:5180/
call npx vite --port 5180 --strictPort
goto :eof
:fail
echo Install failed. Is Node.js installed?
pause
