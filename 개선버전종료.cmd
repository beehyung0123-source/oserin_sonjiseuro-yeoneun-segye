@echo off
node "%~dp0arrangement\start.js" --stop-exhibit
if errorlevel 1 pause
