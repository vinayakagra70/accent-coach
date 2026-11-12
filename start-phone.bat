@echo off
rem Accent Coach for phones on the same Wi-Fi: builds the app, then serves it over HTTPS
rem with a QR code to scan. Keep this window open while you practise.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Not installed yet. Run setup.ps1 first (see README.md).
  pause
  goto :eof
)
echo Building the app...
pushd web
call npm run build >nul || (echo Build failed. & popd & pause & goto :eof)
popd
.venv\Scripts\python.exe -m server.phone
pause
