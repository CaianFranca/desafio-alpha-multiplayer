# ADR-0011: Ativação Livre do Stream de Debug

Status: Aceito
Data: 2026-09-10

## Contexto

O "Modo Desenvolvedor" (issue #340) permite que o frontend envie `ATIVAR_DEBUG`
pelo WebSocket e passe a receber, no painel, linhas espelhadas do lobby-server
e do game-server. Não há autenticação além da Sessão já exigida para conectar
o socket: qualquer Jogador autenticado pode enviar o comando. O review da PR
#346 apontou que qualquer Jogador pode ativar o stream e pediu uma decisão
explícita (flag de configuração ou allowlist) ou o aceite formal documentado.

## Decisão

Aceitar o risco: qualquer Jogador autenticado pode ativar o stream de debug,
sem `streamDeDebugHabilitado` e sem allowlist. O acesso é considerado risco
aceito para uma ferramenta de diagnóstico de desenvolvimento.

O escopo do que é exposto fica limitado pelo próprio desenho:

- **Unicast só a quem ativou**: `emitir`/`emitirParaSocket` entregam apenas aos
  sockets que enviaram `ATIVAR_DEBUG`; nunca há broadcast aos Membros comuns.
- **Lobby**: o escopo é Jogador → Sala (projeção → fallback PG) e uma linha só
  é entregue ao ativo daquela Sala. A ativação antes de entrar numa Sala fica
  sem escopo e é re-resolvida a cada emissão.
- **Game-server**: o escopo é a Partida da conexão (o `partida-id` do upgrade),
  então o ativo só recebe linhas da própria Partida.

## Porquê

- O stream nasce de um comando do próprio cliente sobre uma conexão que ele já
  controla; o que ele recebe fica restrito ao escopo a que já tem acesso.
- É uma ferramenta de desenvolvimento; bloquear em produção custaria mais que o
  benefício, dada a exposição limitada ao próprio Jogador.
- O modo depende de um gatilho escondido no frontend (5 cliques no logo),
  reforçando o caráter de ferramenta interna — ainda que o comando em si não
  seja secreto.

## Alternativas consideradas

- **`streamDeDebugHabilitado` no `@flicker/config`, `false` em produção** —
  não adotada: exige costurar a flag pelo boot do servidor e pelo protocolo, e
  a exposição já fica limitada ao escopo do próprio Jogador; o
  esforço/complexidade não se justifica para um recurso de dev.
- **Allowlist por env de emails/jogadorIds** — não adotada: mesma costura de
  configuração somada à manutenção de uma lista; como a exposição é restrita
  ao escopo do Jogador, a lista adicionaria complexidade sem reduzir um risco
  relevante para uma ferramenta de diagnóstico.
