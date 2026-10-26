@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py serve.py & goto :eof)
where python >nul 2>nul && (python serve.py & goto :eof)
echo Python bulunamadi. https://www.python.org/downloads/ adresinden kurun
echo veya cevrimici surumu kullanin: https://ugurfurkanyesil-rgb.github.io/final/
pause
