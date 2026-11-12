@echo off
title JARVIS - parar
echo Parando o JARVIS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -LocalPort 3300 -State Listen -ErrorAction SilentlyContinue; if ($listener) { $listener.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -and ($_.CommandLine -like '*serve.cmd*' -or $_.CommandLine -like '*next*start*-p 3300*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*jarvis*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
echo.
echo Servidor e HUD encerrados. Para subir de novo, use iniciar.vbs.
timeout /t 3 /nobreak >nul
