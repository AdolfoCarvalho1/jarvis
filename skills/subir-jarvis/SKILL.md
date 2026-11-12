---
name: subir-jarvis
description: Sobe, reinicia ou builda o J.A.R.V.I.S. local na porta 3300 com segurança.
quando: ["subir o jarvis", "reiniciar o jarvis", "o servidor não responde", "buildar o jarvis"]
version: 1
---

# Subir e reiniciar o J.A.R.V.I.S.

## Quando usar

- O app na porta 3300 não responde ou está servindo build antigo.
- É preciso aplicar um build novo depois de mudar código.
- O HUD Electron precisa ser reaberto.

## Regras

1. **Nunca rode `npm run build` com o servidor no ar.** O Next apaga o `.next` no início; o loop do `serve.cmd` sobe com build parcial e as rotas passam a devolver 404.
2. O ciclo correto é: matar o loop `cmd /c serve.cmd` + o `next start` + o `electron`, apagar `.next`, buildar, subir com `iniciar.vbs`.
3. Depois de subir, confirme `curl http://127.0.0.1:3300/api/health` com `ok:true` e `storage:"sqlite"`.
4. Se o HTML servir mas a interface não reagir, confira os chunks: cada `/_next/static/chunks/*.js` precisa responder `200 application/javascript`. Se vier `text/plain` ou 404, o build está misturado — repita o ciclo.
5. Antes de matar processos, confira que a porta 3100 não pertence a outro projeto. Só mexa na 3300.

## Comandos

```bash
cd "C:/Users/adolf/Desktop/jarvis"
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force; Get-CimInstance Win32_Process | Where-Object { (\$_.Name -eq 'cmd.exe' -and \$_.CommandLine -like '*serve.cmd*') -or (\$_.Name -eq 'node.exe' -and \$_.CommandLine -like '*next*start*') } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
rm -rf .next
npm run build
wscript.exe "C:/Users/adolf/Desktop/jarvis/iniciar.vbs"
```

Para abrir o HUD: `curl -X POST -H "Origin: http://127.0.0.1:3300" http://127.0.0.1:3300/api/hud`.

## Sinais de problema

- `POST /api/orb-state` a 8/s no log: build antigo (o atual usa SSE).
- HUD mostrando o app inteiro: service worker antigo; limpar `serviceworkers`/`cachestorage`.
- Porta presa com PID 0: espere 10–40 s antes de subir de novo.
