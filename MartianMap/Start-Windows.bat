@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py serve.py & goto :eof)
where python >nul 2>nul && (python serve.py & goto :eof)
echo Python was not found. Install it from https://www.python.org/downloads/
echo or use the online version: https://sayko89.github.io/nasa-space-apps-challenge-2026/
pause
