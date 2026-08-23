# Setup do Ambiente

Guia de instalação e configuração para quem chega no projeto: estrutura das
áreas, Docker Compose local, GitHub CLI (`gh`) e Context7 (MCP) — ver seção 4.

## 1. Mapa do monorepo

Monorepo com workspaces: frontend e backend na raiz, separados por área.
Cada área tem seu próprio `AGENTS.md` e `opencode.json`. Ver
`docs/adr/0001-estrutura-de-pastas.md` para as decisões de estrutura.

```
desafio-alpha-multiplayer/
├── docker-compose.yml          # entrada do ambiente local
├── .env.example                # variáveis do Compose
├── frontend/
│   └── web/                    # app React + Vite + Three.js (tabuleiro)
│       └── src/
│           ├── pages/          # login, lobby, jogo, minigames
│           ├── components/     # tabuleiro, peças, peões, HUD
│           ├── hooks/          # useWebSocket, useGameState
│           ├── game/           # render/animação do tabuleiro
│           └── api/            # REST auth + JWT
├── backend/
│   ├── lobby-server/           # Express + WS (auth, salas)
│   │   └── src/
│   │       ├── routes/         # REST (register, login)
│   │       ├── ws/             # handlers do lobby WS
│   │       ├── redis/          # salas, servidores disponíveis
│   │       └── config/
│   └── game-server/            # Express + WS (regras, turnos)
│       └── src/
│           ├── rooms/          # sala → estado no Redis
│           ├── handlers/       # COLOCAR_PECA, MOVER_PEAO...
│           ├── minigames/
│           └── redis/          # Pub/Sub entre instâncias
├── packages/                   # engine (regras puras), shared (protocolo WS), config
├── db/                         # migrations e seeds (Knex)
└── infra/
    └── nginx/                  # conf de roteamento /ws/...
```

- **frontend/** — o que o jogador vê: interface web (React/Vite/Three.js) e
  cliente WebSocket. Ver `frontend/AGENTS.md`.
- **backend/** — dois servidores independentes: `lobby-server` (auth e salas)
  e `game-server` (regras e turnos, escalável horizontalmente). Ver
  `backend/AGENTS.md`.
- **infra/** — configuração de infraestrutura (NGINX roteando `/ws/lobby` e
  `/ws/game/<server-id>`). Ver `infra/AGENTS.md`.

## 2. Docker Compose local

O Compose da raiz é a entrada do ambiente de desenvolvimento local. A produção
está fora do escopo desta configuração. O NGINX já tem Dockerfile e contrato
de execução: ele serve o build estático do frontend e os arquivos de
`frontend/web/media`. O perfil `backend` também sobe o `lobby-server`, com
PostgreSQL, Redis e `db-migrate` como dependências.

Crie o arquivo local de ambiente e suba o perfil completo:

```sh
cp .env.example .env
docker compose up -d
```

O arquivo `.env` é ignorado pelo Git e o template define
`COMPOSE_PROFILES=full`, portanto `docker compose up` representa o caminho
completo do ambiente local. Para usar um perfil isolado, substitua o perfil
carregado pelo ambiente do comando:

```sh
COMPOSE_PROFILES=db docker compose up -d
COMPOSE_PROFILES=backend docker compose up -d
COMPOSE_PROFILES=nginx docker compose up -d
```

O perfil `frontend` fica reservado para quando o Dockerfile e o contrato do
frontend existirem. Até lá, não há serviço nesse perfil.

| Perfil | Serviços disponíveis agora | Serviços futuros previstos |
| --- | --- | --- |
| `db` | PostgreSQL, Redis, db-migrate | — |
| `backend` | PostgreSQL, Redis, db-migrate, lobby-server | game-server |
| `frontend` | — | frontend |
| `nginx` | PostgreSQL, Redis, db-migrate, lobby-server, NGINX | frontend, game-server |
| `full` | PostgreSQL, Redis, db-migrate, lobby-server, NGINX | frontend, game-server |

Comandos úteis:

```sh
docker compose ps
docker compose config
docker compose down
```

Para validar o bootstrap do lobby-server isoladamente, use:

```sh
docker compose --profile backend up -d --build
curl http://localhost:3001/health
```

O serviço usa `NODE_ENV=development` por padrão no Compose, `PG_POOL_MAX=10` e
a porta definida por `LOBBY_SERVER_PORT`. Em produção, configure explicitamente
`NODE_ENV=production`, um `JWT_SECRET` próprio e um `POSTGRES_PASSWORD` próprio;
os valores de desenvolvimento são rejeitados pelo `@flicker/config` nesse
ambiente.

### Smoke de autenticação

O seed atual (`teste@flicker.local`) existe apenas para popular o banco e grava
a senha em texto puro. O login do lobby-server usa exclusivamente
`bcrypt.compare`, portanto esse registro não é uma Credencial compatível com o
login. Para o smoke, registre um novo Jogador via `/api/auth/register` e faça
login com o mesmo email e senha:

```sh
curl -X POST http://localhost:3001/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"apelido":"Smoke","email":"smoke@example.local","senha":"senha_development_123"}'
curl -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.local","senha":"senha_development_123"}'
```

O tratamento definitivo da incompatibilidade do seed fica como dívida para a
issue #24 (ST-04).

O PostgreSQL usa o volume nomeado `postgres_data`. O Redis é deliberadamente
volátil no ambiente local. Não há migração do volume criado pela configuração
anterior em `infra/`.

## 3. GitHub CLI (`gh`)

Instalação por sistema operacional: https://github.com/cli/cli#installation

Após instalar, confirme:

```sh
gh --version
```

### Autenticação

```sh
gh auth login
```

Siga os prompts: selecione **GitHub.com**, escolha o protocolo preferido
(HTTPS ou SSH) e, quando perguntado, autorize o `gh` a autenticar o Git com
suas credenciais — assim `git push`/`git pull` funcionam sem configurar um
credential manager à parte.

Para conferir se está autenticado:

```sh
gh auth status
```

### Uso neste repo

Issues e specs vivem no GitHub Issues — todo o fluxo é via `gh` (ver
`docs/agents/issue-tracker.md`). Exemplos:

```sh
gh issue list --state open          # listar issues abertas
gh issue view <número> --comments   # ler uma issue
gh issue create --title "..." --body "..."   # criar issue
```

## 4. Context7 (MCP)

O Context7 injeta documentação atualizada de bibliotecas (Express, React,
Three.js, Redis, etc.) direto no contexto do agente. Os `opencode.json` de
cada área (backend, frontend, infra) já vêm com o MCP configurado — basta
criar a conta, gerar uma API key e gravá-la no repo.

### 4.1 Criar conta

Acesse https://context7.com/dashboard e faça sign in. É gratuito,
sem cartão de crédito.

### 4.2 Criar uma API key

No dashboard, no card **API Keys**, clique em **Create API Key**, dê um nome
(ex.: "opencode") e copie a chave gerada (`ctx7sk-...`). Ela é exibida
**uma única vez** — se perdida, revogue e crie outra.

### 4.3 Gravar a chave no repo

A chave fica num arquivo na raiz do repositório, ignorado pelo git (nada
vai para o GitHub):

```sh
printf '%s' 'ctx7sk-...' > .context7-key
chmod 600 .context7-key
```

Ou apenas crie o arquivo `.context7-key` na raiz do projeto e cole a chave nele

Os `opencode.json` de cada área leem esse arquivo via `{file:../.context7-key}`.

### 4.4 Verificar

```sh
opencode mcp list
```

Ou, numa sessão, peça ao agente docs de uma biblioteca do projeto
(ex.: "use context7: assinatura do cliente Redis do ioredis 5").
