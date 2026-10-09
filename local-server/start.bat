@echo off
rem Starts the Lecture Scribe local server. Keep this window open while recording.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run install.ps1 first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -u server.py
pause
