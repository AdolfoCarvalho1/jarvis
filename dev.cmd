@echo off
title JARVIS - dev
cd /d "%~dp0"
call npm run dev -- --port 3300
pause
