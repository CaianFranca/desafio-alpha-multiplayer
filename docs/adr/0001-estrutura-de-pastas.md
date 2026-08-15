# ADR-0001: Estrutura de Pastas do Monorepo

Status: Aceito
Data: 2026-08-13

## Contexto

O sistema é client-server escalável horizontalmente (Flicker of Sanity): um
frontend React, dois backends distintos (lobby e jogo, com múltiplas
instâncias do servidor de jogo), Redis como estado volátil, PostgreSQL
como persistência e NGINX roteando conexões. Sem uma estrutura definida,
cada agente criaria arquivos em lugares arbitrários.

## Decisão

Monorepo com workspaces, separando frontend e backend na raiz:

```
desafio-alpha-multiplayer/
├── frontend/
│   └── web/
│       └── src/
│           ├── pages/        # login, lobby, jogo, minigames
│           ├── components/   # tabuleiro, peças, peões, HUD
│           ├── hooks/        # useWebSocket, useGameState
│           ├── game/         # render/animação do tabuleiro
│           └── api/          # REST auth + JWT
├── backend/
│   ├── lobby-server/         # Express + WS (auth, salas)
│   │   └── src/
│   │       ├── routes/       # REST (register, login)
│   │       ├── ws/           # handlers do lobby WS
│   │       ├── redis/        # salas, servidores disponíveis
│   │       └── config/
│   └── game-server/          # Express + WS (regras, turnos)
│       └── src/
│           ├── rooms/        # sala → estado no Redis
│           ├── handlers/     # COLOCAR_PECA, MOVER_PEAO...
│           ├── minigames/
│           └── redis/        # Pub/Sub entre instâncias
├── packages/
│   ├── engine/               # regras puras do jogo (sem I/O)
│   ├── shared/               # protocolo WS (DTOs tipados)
│   └── config/               # env schemas, constantes
├── db/
│   ├── migrations/           # Knex
│   └── seeds/
└── infra/
    └── nginx/                # conf de roteamento /ws/...
```

## Porquê

- **frontend/ e backend/ na raiz** — a separação reflete o contrato de
  deploy e os lados que cada agente toca; nada de um lado importa código
  do outro diretamente.
- **packages/engine** — regras do jogo como funções puras, sem I/O;
  testáveis e compartilhadas entre servidores, evitando validação duplicada.
- **packages/shared** — protocolo WS (tipos de mensagem) tipado de um lado só.
- **lobby-server e game-server como apps separados** — o NGINX roteia
  `/ws/lobby` vs `/ws/game/<server-id>`; deploy e escala independentes.
- **db/ e infra/ fora dos apps** — migrations (Knex) e docker/nginx não
  pertencem a nenhum serviço em particular.

## Alternativas consideradas

- **apps/ único (web + lobby + game)** — rejeitado: embaralha as
  fronteiras entre frontend e backend.
- **Repositórios separados** — rejeitado: engine e protocolo são
  compartilhados entre os servidores.
