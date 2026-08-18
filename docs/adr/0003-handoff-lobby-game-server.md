# ADR-0003: Handoff Lobby→Game-Server por HTTP com Registro no Redis

Status: Aceito
Data: 2026-08-18

## Contexto

O Encaminhamento (ST-07) exige que o lobby ofereça os quatro Membros a um
game-server e receba aceite ou recusa síncronos, com revalidação da
composição no commit e cancelamento da Partida pré-conexão. O ADR-0001
prevê game-servers escaláveis horizontalmente e um Redis do lobby para
"servidores disponíveis", mas não define o canal do offer.

## Decisão

O lobby mantém no Redis um registro de game-servers disponíveis com
heartbeat/lease, escolhe um e faz o offer por HTTP direto
(request/response). O game-server cria a Partida ao aceitar; o lobby
revalida a composição no commit e, se mudou, pede cancelamento da Partida
antes de qualquer conexão. Recusa ou timeout mantêm a Sala aberta.

## Porquê

- **Síncrono e atômico**: offer/aceite/recusa é request/response natural,
  sem protocolo de resposta assimétrica.
- **Descoberta elástica**: game-servers efêmeros entram e saem via
  heartbeat/lease, sem DNS fixo nem recomposição do compose.
- **Cancelamento barato**: pré-conexão, cancelar uma Partida é uma deleção
  no Redis do game-server.

## Alternativas consideradas

- **Redis Pub/Sub para o offer** — rejeitada: não há resposta direta;
  exigiria canais de retorno e correlação manual.
- **Descoberta por DNS/compose fixo** — rejeitada: não acompanha
  game-servers efêmeros nem a escala horizontal prevista no ADR-0001.
- **Handshake em duas fases (reserva/confirma)** — rejeitada: TTL de
  reserva e um round-trip extra para o mesmo resultado do cancelamento
  pré-conexão.
