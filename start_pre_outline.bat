@echo off
set PORT=8000
set DIR=%~dp0

echo ===============================
echo    Gongyong Gongcheng Tiku
echo    Local Preview Server
echo ===============================
echo.
echo Starting server at port %PORT% ...

python -m http.server %PORT%

echo Server is running at: http://localhost:%PORT%/index.html
echo Press any key to stop server and close.

