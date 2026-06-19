@echo off
set PORT=8899
set DIR=%~dp0
set PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe

echo ===============================
echo    Gongyong Gongcheng Tiku
echo    Local Preview Server
echo ===============================
echo.
echo Starting server at port %PORT% ...

start /B "" "%PYTHON%" -m http.server %PORT% --directory "%DIR%" >nul 2>&1
timeout /t 2 /nobreak >nul

start "" "http://localhost:%PORT%/index.html"
echo.
echo Server is running at: http://localhost:%PORT%/index.html
echo Press any key to stop server and close.
pause >nul

taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq http.server*" >nul 2>&1
