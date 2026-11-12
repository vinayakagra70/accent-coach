@echo off
rem Accent Coach: starts the speech engine (Python, port 5181) and the app (port 5180).
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo The speech engine isn't installed. See README.md, "First-time setup".
  pause
  goto :eof
)
start "Accent Coach - speech engine" /min .venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 5181
cd web
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
