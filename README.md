<p align="center">
  <img src="banner_readme.jpg" alt="Flicker of Sanity" width="640" />
</p>

<p align="center">
  <strong>Jogo cooperativo de tabuleiro digital para 2 a 4 Jogadores escaparem do sanatório.</strong>
</p>

## Sobre o projeto

No **Flicker of Sanity**, de dois a quatro Jogadores exploram o Sanatório em uma Partida cooperativa: posicionam Peças, movem seus Peões, evitam os Monstros (O Vulto e O Espectro) e cuidam da Sanidade até cumprir o Objetivo Global — ligar os 3 Geradores, obter o Cartão de Acesso na Sala do Diretor e reunir todos os peões no Portão de Saída.

> Vocabulário canônico do domínio em [CONTEXT.md](CONTEXT.md).

---

## Quickstart

**Pré-requisitos:** Docker Compose e Git.

**1. Suba o ambiente:**

```sh
cp .env.example .env
docker compose up -d
```

**2. Acesse a entrada principal (NGINX):** http://localhost:8080

**3. Valide os servidores:**

```sh
curl http://localhost:3001/health
curl http://localhost:1234/health
```

**4. Parar / limpar:**

```sh
docker compose down        # preserva o banco (volume postgres_data)
docker compose down -v     # limpeza total (banco volta vazio)
```

> Guia completo de ambiente (perfis `db` / `backend` / `nginx` / `full`, modo dev com hot-reload, rotas `/api/` e `/ws/`, troubleshooting) em [SETUP.md](SETUP.md).

---

## Arquitetura

| Área | Conteúdo | Stack |
| --- | --- | --- |
| `frontend/web/` | App web: login, Lobby, jogo, tabuleiro 3D | React 19 + Vite + Three.js |
| `backend/lobby-server/` | Cadastro, Sessão, Salas, presença, chat | Express + WS (`ws`) + JWT |
| `backend/game-server/` | Regras, Turnos, Ataques, Reconexão da Partida | Express + WS + Redis Pub/Sub |
| `packages/` | `engine` (regras puras), `shared` (protocolo WS), `config` | TypeScript |
| `db/` | Migrations e seeds | Knex + PostgreSQL 17 |
| `infra/nginx/` | Roteamento `/`, `/api/`, `/ws/lobby`, `/ws/game/` | NGINX |

Dados: PostgreSQL (persistência) + Redis (Salas, Sessões, estado da Partida — volátil). Decisões registradas em [docs/adr/](docs/adr/).

---

## Scripts úteis

```sh
npm run dev        # sobe o game-server em modo dev
npm run test       # testes do game-server
npm run test:all   # testes de todos os workspaces
npm run typecheck  # typecheck dos workspaces
npm run bots       # bots de teste no lobby (ver `npm run bots:help`)
```

Frontend tem scripts próprios (`dev`, `build`, `lint`, `typecheck`, `test`) em `frontend/` — ver [frontend/AGENTS.md](frontend/AGENTS.md).

---

## Documentação

- [SETUP.md](SETUP.md) — instalação, Docker Compose, portas, validação integrada
- [WORKFLOW.md](WORKFLOW.md) — fluxo de entrega (spec → tickets → implementação → review → PR)
- [CONTEXT.md](CONTEXT.md) — glossário do domínio (termos canônicos)
- [GRILLING-SESSION.md](GRILLING-SESSION.md) — roteiro de entrevista
- [docs/adr/](docs/adr/) — decisões de arquitetura
- Guias por área: [frontend](frontend/AGENTS.md), [backend](backend/AGENTS.md), [infra](infra/AGENTS.md), [db](db/AGENTS.md)
