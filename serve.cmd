@echo off
title JARVIS - servidor
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo Gerando build inicial...
  call npm run build
  if errorlevel 1 exit /b 1
)

rem Se ja existe um servidor na 3300, espere ele liberar (o rebuild derruba e sobe).
set tries=0
:checkport
netstat -ano | findstr ":3300" | findstr "LISTENING" >nul
if errorlevel 1 goto run
set /a tries+=1
if %tries% GEQ 45 goto busy
rem ping em vez de timeout: timeout falha quando o cmd roda sem console (iniciar.vbs).
ping -n 2 127.0.0.1 >nul
goto checkport

:busy
echo [JARVIS] porta 3300 ocupada por outro processo. Feche esta janela.
ping -n 6 127.0.0.1 >nul
exit /b 0

:run

:loop
echo.
echo [JARVIS] iniciando em http://127.0.0.1:3300
call npm start -- --port 3300
echo.
echo [JARVIS] servidor encerrado. Reiniciando em 2s... (feche esta janela para parar)
ping -n 3 127.0.0.1 >nul
goto loop
