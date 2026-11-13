@echo off
node "%~dp0start.js" --stop-exhibit
if errorlevel 1 pause
