# J.A.R.V.I.S.

Assistente pessoal com chat em streaming, ferramentas (busca na web, lembretes, memória, Obsidian), voz e uma única conversa contínua cujo contexto é compactado e guardado no banco.

- **Front + back:** Next.js 16 (App Router, React 19, TypeScript, Tailwind 4)
- **Modelo:** OpenCode Go — padrão `deepseek-v4.1-flash`, com trocador de modelo na própria interface
- **Dados:** SQLite local (`node:sqlite`); Supabase quando configurado
- **Contexto:** resumo durável salvo em `settings` e espelhado em `JARVIS/contexto.md` no vault do Obsidian
- **Voz:** Whisper local para transcrição e edge TTS para síntese. A esfera reage ao microfone e ao áudio da resposta.
- **Auto-aperfeiçoamento:** o Jarvis inspeciona o código e gera um diff para revisão
- **Tela e PC:** vê a tela (`ver_tela`) e controla volume, mídia, apps e bloqueio (`controlar_pc`)
- **HUD:** a mesma conversa em uma janela Electron sempre no topo, com bandeja e atalhos
- **PWA:** instalável no celular

## Rodar

Use Node 22.18 ou mais recente. As tarefas de desktop rodam no Windows.

```bash
iniciar.vbs    # produção local em http://127.0.0.1:3300, sem janela de console
parar.cmd      # derruba servidor e HUD
serve.cmd      # a mesma produção, mas com janela (para ver o log ao vivo)
dev.cmd        # desenvolvimento com hot reload
npm run hud    # abre só o HUD Electron (o botão flutuar também abre)
```

`iniciar.vbs` roda o `serve.cmd` oculto e escreve a saída em `.jarvis/server.log`.
O loop de reinício continua valendo: se o servidor cair, ele volta sozinho.

## Acesso local e pelo celular

O servidor escuta em `127.0.0.1`. O navegador e o HUD podem conversar com a mesma instância.

Para usar no celular, configure um proxy HTTPS na frente dessa instância. Defina `JARVIS_PUBLIC_ORIGIN` com a origem HTTPS exata, sem barra no final, e `APP_PASSWORD` com uma senha longa e exclusiva. Configure o proxy para aceitar apenas o domínio escolhido e preservar esse `Host` ao encaminhar para `127.0.0.1:3300`. Abra o endereço HTTPS no celular para entrar e, se quiser, instale pela opção **Adicionar à tela inicial**.

## Como funciona a conversa

Não há várias threads: existe **uma conversa principal** e ela nunca "reinicia" sozinha.

- Toda mensagem entra nessa conversa.
- O servidor atende um turno por vez. A outra interface pode aguardar alguns segundos ou reenviar o texto que ficou no campo de mensagem.
- A partir de 44 registros não compactados, o servidor resume o lote mais antigo em blocos de texto, depois de encerrar a resposta. Ele só avança o cursor ao terminar as mensagens do bloco. As mensagens e operações originais continuam disponíveis no histórico.
- As próximas respostas usam o resumo durável junto com as mensagens recentes.
- O mesmo resumo é escrito em `JARVIS/contexto.md` no vault do Obsidian.
- **NOVA SESSÃO** (no painel de contexto) apaga a conversa e o resumo e recomeça.

## Configuração (`.env.local`)

Copie o modelo e preencha com suas chaves:

```bash
cp .env.example .env.local
```

`.env.local` fica fora do Git. O repositório é público: nunca comite chaves, tokens ou o banco local (`/.data`).

| variável | função |
| --- | --- |
| `OPENCODE_GO_API_KEY` | chave da OpenCode Go (obrigatória) |
| `JARVIS_MODEL` | modelo padrão; `deepseek-v4.1-flash` |
| `OPENCODE_BASE_URL` | padrão `https://opencode.ai/inference/openai/v1` |
| `OBSIDIAN_VAULT_PATH` | vault onde o contexto e as notas são gravados |
| `APP_PASSWORD` | protege o app com login. Obrigatória com acesso HTTPS externo |
| `JARVIS_PUBLIC_ORIGIN` | origem pública HTTPS permitida, sem barra final |
| `JARVIS_VISION_MODEL` | modelo de visão; padrão `deepseek-v4.1-flash` |
| `JARVIS_TTS_VOICE` | voz do edge; padrão `pt-BR-AntonioNeural` |
| `JARVIS_TTS_RATE` | velocidade da voz; padrão `+0%` |
| `JARVIS_TTS_PYTHON` | python do venv de TTS; padrão `.jarvis/tts-venv/Scripts/python.exe` |
| `JARVIS_WORKSPACE_ROOT` | pasta que reúne os projetos locais. O padrão é a pasta acima do Jarvis |
| `JARVIS_CODE_PATH` | caminho de `Code.exe`, caso o VS Code esteja fora dos locais usuais |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | ligam o armazenamento no Supabase |

Reinicie o servidor depois de alterar o `.env.local`.

## Modelos

O seletor no topo troca o modelo em tempo real (a escolha fica salva no banco). A lista mostra os modelos com suporte a ferramentas, encabeçada por `deepseek-v4.1-flash`. O catálogo vem de `/api/models` (cache de 10 min).

## Ferramentas do agente

- `pesquisar_web` (Bing, com fallback DuckDuckGo) e `abrir_url`
- `lembrar`, `criar_lembrete`, `listar_lembretes`, `concluir_lembrete`
- `consultar_obsidian` e `salvar_nota_obsidian` (vault em `OBSIDIAN_VAULT_PATH`)
- `hora_atual`
- `listar_arquivos`, `ler_arquivo` e `propor_melhoria` (diff para revisão)
- `ver_tela` (captura e descreve a tela) e `controlar_pc` (abrir app/URL, volume, mudo, mídia, bloquear)

## Tarefas e rotinas no Windows

Abra o painel lateral e entre em **TAREFAS**. Ali você pode rodar scripts de projeto, ver a saída, acompanhar um arquivo e criar, editar ou executar rotinas. Também pode pedir pelo chat:

- “Roda o lint do Jarvis e me leva ao primeiro erro no VS Code.”
- “Acompanha o arquivo C:\Vídeos\exportação.mp4 e abre a pasta quando estabilizar.”
- “Salva essa checagem como Revisar projeto.” Depois use “Executa Revisar projeto no projeto X”.

O Jarvis inicia um processo local que lê a fila em `.data/automation.db`. Fechar o navegador não interrompe o processo. Lembretes e monitoramentos pendentes voltam quando o servidor inicia novamente. Se um script de projeto foi interrompido durante o reinício, a tarefa registra a interrupção e pode ser executada de novo pelo painel. O Windows pode agrupar ou silenciar os avisos do sistema. O resultado continua disponível no painel.

Ações que alteram dados, executam tarefas ou usam o PC pedem confirmação no chat. O botão **Parar resposta** interrompe as chamadas em andamento e solicita o cancelamento de tarefas enfileiradas por aquele turno. Para uma tarefa em segundo plano já confirmada e cujo turno terminou, use **Cancelar** no painel de tarefas.

Uma checagem roda o script `build`, `lint` ou `test` do `package.json` escolhido. Rotinas também podem abrir projeto, pasta, app e diagnóstico. O acompanhamento começa quando o arquivo aparece ou muda e avisa após 12 segundos sem mudança no tamanho ou na data de modificação.

## Propostas de alteração

O Jarvis usa `listar_arquivos` e `ler_arquivo` para consultar arquivos de código e `propor_melhoria` para anexar um diff ao histórico. A proposta fica em `.data/proposals`, com limite de oito arquivos de até 60 KB por arquivo.

1. Baixe o diff no histórico e revise cada mudança, inclusive scripts e configuração.
2. Valide o diff aprovado em uma cópia descartável do projeto, sem credenciais, arquivos de ambiente, dados ou montagem do perfil do usuário. Comece com `git apply --check arquivo.patch`.
3. Aplique o diff à cópia de validação. Rode `npm test`, `npm run lint` e `npm run build` no ambiente isolado. Depois de revisar os resultados, aplique ao projeto principal e reinicie o servidor com o build aprovado.

## Conversa, esfera e HUD

- O histórico abre por padrão e registra o resultado das operações. **Modo esfera** recolhe o histórico e **Abrir conversa** o restaura. **Carregar mensagens anteriores** dá acesso a turnos mais antigos.
- O botão do microfone grava um pedido. No HUD, `F9` inicia ou encerra a gravação. Em **Voz contínua**, o microfone detecta a fala, interrompe a resposta atual e envia a transcrição após a pausa.
- **Tempos** mostra transcrição, chegada do primeiro texto, início do áudio e conclusão da resposta, conforme a etapa executada.
- Para mover o HUD, arraste o cabeçalho. A bandeja permite mostrar ou ocultar, alternar **Atravessar cliques** ou sair. Atalhos: `Ctrl+Alt+J` mostra ou oculta e `Ctrl+Alt+K` alterna os cliques.
- Sem Electron, o botão do HUD abre a esfera em Picture-in-Picture nos navegadores compatíveis.

## Voz

- A voz principal é o **edge TTS** rodando no servidor: `app/api/tts` sintetiza e devolve MP3 (cache em `.data/tts`). O venv fica em `.jarvis/tts-venv`; para recriar: `python -m venv .jarvis/tts-venv && .jarvis/tts-venv/Scripts/pip install edge-tts`.
- O orbe usa o RMS real do áudio para pulsar; se o MP3 não tocar, cai na voz nativa do navegador com pulso estimado.
- O microfone precisa de permissão em uma página HTTPS ou no endereço local de loopback. Navegador e HUD usam o mesmo fluxo de gravação e transcrição.
- O modo contínuo usa detecção de fala e cancelamento de eco do dispositivo. A precisão depende do ambiente e do microfone.

## Supabase (opcional)

1. Rode `supabase/schema.sql` no SQL Editor.
2. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. Reinicie. O rodapé do painel passa a mostrar `SUPABASE`.

A `service_role` fica só no servidor. As tabelas têm RLS ligado e nenhuma policy pública.

## Instância do servidor

Use uma instância Next.js por conversa, inclusive com Supabase. A fila de turnos, as aprovações pendentes e os processos de voz pertencem à instância que atende o navegador e o HUD.

## Estrutura

```
app/
  api/chat/route.ts          streaming + ferramentas + compactação
  api/hud/route.ts           inicia a janela Electron do HUD
  api/orb-state/route.ts     energia/tom/estado da esfera para o HUD
  hud/page.tsx               mesma interface em modo HUD
  api/context/route.ts       resumo, histórico e nova sessão
  api/models/route.ts        catálogo para o seletor
  api/settings/route.ts      modelo ativo
  api/tts/route.ts           voz edge em MP3 (cache)
  api/reminders|memories/... lembretes e memória
components/
  jarvis-app.tsx             interface compartilhada pelo navegador e HUD
  floating-orb.tsx           fallback: janela Document PiP
  orb.tsx                    esfera holográfica de anéis (energia da voz)
lib/
  ai.ts                      cliente SSE + chamada simples para resumir
  pc.ts                      screenshot, volume, mídia, abrir e bloquear
  vision.ts                  modelo de visão para a tela
  context.ts                 compactação e sincronização
  obsidian.ts                vault: contexto.md, busca e notas
  selfedit.ts                acesso ao código e geração de diffs
  sentiment.ts               tom da resposta (azul/vermelho)
  session.ts                 conversa única, modelo ativo e contexto
  models.ts                  catálogo de modelos
  tools.ts                   ferramentas do agente
scripts/
  tts.py                     edge TTS
  pc.ps1                     controle do PC (screenshot, volume, mídia, apps)
hud/
  main.cjs                   janela sem moldura + bandeja
  tray.png                   ícone da bandeja
  package.json               app Electron mínimo
serve.cmd / dev.cmd          atalhos
```

## Limites conhecidos

- Busca web depende de HTML do Bing; sites com CAPTCHA/paywall podem falhar em `abrir_url`.
- O resumo de contexto é textual (sem embeddings): recupera o essencial, não cada detalhe.
- `ver_tela` manda um frame da tela para o modelo de visão; a captura só acontece quando a ferramenta é chamada.
- O HUD do Windows usa Electron. A opção **Atravessar cliques** precisa estar desligada para arrastar a janela.
- O fallback Document Picture-in-Picture (Chrome/Edge) continua para quando o Electron não estiver instalado; ele tem a moldura do sistema e precisa de um clique real.
- `controlar_pc` abre apenas apps da whitelist (chrome, edge, spotify, notepad, explorer, vscode, calc, whatsapp, telegram) ou URLs http(s).

## Licença

MIT — veja [LICENSE](LICENSE).
