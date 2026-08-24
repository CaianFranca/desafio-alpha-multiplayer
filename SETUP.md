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
está fora do escopo desta configuração. O NGINX já tem Dockerfile multi-stage
(`infra/nginx/Dockerfile`: `node:22-bookworm` faz o build do frontend e
`nginx:1.27-alpine` serve o estático) e contrato de execução: ele serve o build
estático do frontend e os arquivos de `frontend/web/media` montados como
`frontend/web/media:ro` em `/usr/share/nginx/html/media`. Os perfis válidos
são `db`, `backend`, `nginx` e `full` — não existe perfil `frontend` como
serviço. Os serviços de aplicação e dados não publicam portas no host: a
entrada externa única chega pelo NGINX em `http://localhost:8080` (`NGINX_PORT`,
issue #9) e as validações HTTP podem ser feitas pelo host. O Compose mantém a
porta interna `80` dentro da rede; o host usa `8080` por padrão (`NGINX_PORT`
em `.env.example`).

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

O frontend não possui serviço nem perfil próprio: o NGINX serve o build
estático gerado em `infra/nginx/Dockerfile` e monta `frontend/web/media:ro`
em `/usr/share/nginx/html/media` (ver `docker-compose.yml` e
`infra/nginx/Dockerfile`).

| Perfil | Serviços disponíveis |
| --- | --- |
| `db` | PostgreSQL, Redis, db-migrate |
| `backend` | PostgreSQL, Redis, db-migrate, lobby-server, game-server |
| `nginx` | PostgreSQL, Redis, db-migrate, lobby-server, game-server, NGINX |
| `full` | PostgreSQL, Redis, db-migrate, lobby-server, game-server, NGINX |

Comandos úteis:

```sh
docker compose ps
docker compose config
docker compose down
```

Para validar o bootstrap do lobby-server e do game-server isoladamente, use:

```sh
docker compose --profile backend up -d --build
docker compose --profile backend exec lobby-server \
  node -e "fetch('http://localhost:'+process.env.LOBBY_SERVER_PORT+'/health').then(r=>r.text()).then(console.log)"
docker compose --profile backend exec game-server \
  node -e "fetch('http://localhost:'+process.env.GAME_SERVER_PORT+'/health').then(r=>r.text()).then(console.log)"
```

A validação `GET /health` permanece interna via `docker compose --profile backend exec`
(ver bloco acima) e não é exposta pela entrada única do NGINX.

O serviço usa `NODE_ENV=development` por padrão no Compose, `PG_POOL_MAX=10` e
a porta definida por `LOBBY_SERVER_PORT`. Em produção, configure explicitamente
`NODE_ENV=production`, um `JWT_SECRET` próprio e um `POSTGRES_PASSWORD` próprio;
os valores de desenvolvimento são rejeitados pelo `@flicker/config` nesse
ambiente.

### 2.1 Portas e rotas pela entrada única (NGINX 8080)

Portas — apenas o NGINX publica porta no host; os demais serviços são
acessíveis só pela rede interna do Compose (sem `ports:`).

| Host (`env`) | Container | Serviço | Observação |
| --- | --- | --- | --- |
| `8080` (`NGINX_PORT`) | `80` | NGINX | entrada única do ambiente |
| — | `3001` (`LOBBY_SERVER_PORT`) | lobby-server | interno, sem `ports:` |
| — | `1234` (`GAME_SERVER_PORT`) | game-server | interno, sem `ports:` (legado documentado como 1234) |
| — | `5432` | postgres | interno, volume `postgres_data` |
| — | `6379` | redis | interno, volátil (`--save "" --appendonly no`) |

Rotas via NGINX (`infra/nginx/nginx.conf`):

| Rota no host (`http://localhost:8080`) | Destino | Descrição |
| --- | --- | --- |
| `/` | `root /usr/share/nginx/html` | SPA — `try_files $uri $uri/ /index.html` (fallback) |
| `/media/` | `alias /usr/share/nginx/html/media/` | arquivos estáticos de `frontend/web/media:ro` |
| `/api/` | `lobby_server:3001` (`proxy_pass http://lobby_server`) | REST do lobby-server (`/api/auth/*`) |
| `/ws/lobby` | `lobby_server:3001` (`proxy_http_version 1.1`, `Upgrade`/`Connection`) | WebSocket do lobby |
| `~ ^/ws/game/` | `game_servers:1234` (`upstream game_servers`) | WebSocket do game-server; `GAME_SERVER_PORT` é `1234` |

Credenciais de desenvolvimento ficam em `.env.example` na raiz (não movido
para `infra/`): `POSTGRES_*`, `REDIS_*`, `LOBBY_SERVER_PORT=3001`,
`GAME_SERVER_PORT=1234`, `NGINX_PORT=8080`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `COOKIE_SECURE`, `SESSION_*_TTL_SECONDS`,
`NODE_ENV=development`, `PG_POOL_MAX=10`. Copie para `.env` antes do `up`.

### 2.2 Logs

Todos os serviços logam em stdout; use o Compose para inspeção:

```sh
docker compose logs --tail=20              # últimas linhas de todos os serviços
docker compose logs -f                     # seguir em tempo real
docker compose logs lobby-server           # filtrar por serviço
docker compose logs game-server
docker compose logs nginx
docker compose logs postgres
docker compose logs redis
```

### 2.3 Parada e limpeza

```sh
docker compose down        # para e remove containers/rede; preserva postgres_data
docker compose down -v     # remove também o volume nomeado postgres_data (limpeza total)
docker compose up -d --build  # reproduz o ambiente do zero (após down -v)
```

- `down` sem `-v` preserva o volume `postgres_data`: Cadastros criados via
  `/api/auth/register` continuam no banco após `down` + `up -d`.
- `down -v` remove `postgres_data`: o banco volta vazio; o seed
  `teste@flicker.local` (senha em texto puro, incompatível com `bcrypt.compare`)
  e qualquer Cadastro somem.
- `up -d --build` após `down -v` recompila as imagens (`lobby-server`,
  `game-server`, `db-migrate`, `nginx`) e recria o volume limpo — fluxo
  reproduzível para um novo dev.
- Redis é sempre volátil (`redis-server --save "" --appendonly no` no
  `docker-compose.yml`): Sessões e estado em memória somem a cada `down`,
  mesmo sem `-v`. Não há migração do volume criado pela configuração anterior
  em `infra/`.

### 2.4 Validação integrada pela entrada externa (8080)

Roteiro sequencial via `http://localhost:8080` — cobre SPA, auth com
persistência e WebSockets de Sala. Execute com o perfil `full`/`nginx` no ar
(`docker compose up -d`).

**1. SPA e fallback**

```sh
curl -i http://localhost:8080/ | head -n 20
# esperado: HTTP/1.1 200 + content-type: text/html + corpo do index.html

curl -i http://localhost:8080/rota-inexistente | head -n 20
# esperado: HTTP/1.1 200 + mesmo index.html (try_files /index.html)

curl -i http://localhost:8080/media/inexistente.png
# esperado: HTTP/1.1 404 (try_files $uri =404 do /media/)
```

**2. Auth — registro e login via NGINX**

```sh
curl -i -X POST http://localhost:8080/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"apelido":"Smoke","email":"smoke@example.local","senha":"senha_development_123"}'
# esperado: HTTP/1.1 201 + content-type: application/json + X-Powered-By: Express
# corpo: { id, apelido, email } + Set-Cookie: access_token=...; refresh_token=...

curl -i -X POST http://localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.local","senha":"senha_development_123"}'
# esperado: HTTP/1.1 200 + Jogador + Set-Cookie (Sessão única por Jogador)

# validar payload de erro (sem inventar campos — ver openapi.yaml e @flicker/shared):
curl -i -X POST http://localhost:8080/api/auth/register -H 'content-type: application/json' -d '{}'
# esperado: HTTP/1.1 400 + { erros: [{ campo, mensagem }] }

# validar Sessão ativa (reidratação)
curl -i http://localhost:8080/api/auth/me -H 'cookie: access_token=<valor>; refresh_token=<valor>'
# esperado: HTTP/1.1 200 + Jogador (quando Sessão válida); 401 quando ausente/expirada
```

> Nota: o seed `teste@flicker.local` grava senha em texto puro e não é
> compatível com `bcrypt.compare`; use sempre um Cadastro criado via
> `/api/auth/register` para o smoke. Dívida da issue #24 (ST-04).

**3. Persistência — `down` sem `-v` vs `restart`**

```sh
# Após registrar Smoke acima, reinicie só o banco e valide que o Cadastro persiste:
docker compose restart postgres
# aguarde healthcheck (docker compose ps) e refaça o login:
curl -X POST http://localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.local","senha":"senha_development_123"}'
# esperado: HTTP/1.1 200 (postgres_data preservado)

# down sem -v também preserva:
docker compose down
docker compose up -d
# aguarde e refaça o login — ainda 200

# down -v remove tudo (reproduzível):
docker compose down -v && docker compose up -d --build
# aguarde e refaça o login — agora 401 (banco limpo, Cadastro precisa ser recriado)
```

**4. WebSocket do lobby — criação e entrada em Sala**

Payloads reais de `packages/shared/src/sala.ts` e `protocol.ts` (sem inventar;
literais wire em UPPER_SNAKE, `Presenca` em `conectado`/`em_reconexao`):

```sh
# Conecte no lobby (espera 101 Switching Protocols; hoje sem validação de token no upgrade)
wscat -c ws://localhost:8080/ws/lobby
# ou: websocat ws://localhost:8080/ws/lobby

# Dentro da conexão, envie (cliente → servidor):
{"type":"PING"}
# esperado do servidor: {"type":"PONG"}

{"type":"CRIAR_SALA"}
# esperado: evento SalaEventoDoServidor, ex. {"type":"SALA_ATUALIZADA","sala":{"id":"...","codigoDeSala":"ABCDEF","estado":"aberta","anfitriaoId":"...","membros":[...],"convite":{"codigoDeSala":"ABCDEF","link":"..."}}}
# ou {"type":"ERRO_DA_SALA","codigo":"SALA_JA_EXISTE","mensagem":"..."}

{"type":"ENTRAR_NA_SALA","codigoDeSala":"ABCDEF"}
# esperado: {"type":"MEMBRO_ENTROU","membro":{...},"sala":{...}} ou {"type":"ERRO_DA_SALA","codigo":"SALA_NAO_ENCONTRADA",...}

# Outros comandos do protocolo (SalaComandoDoCliente): SAIR_DA_SALA, ALTERNAR_PRONTIDAO,
# ENVIAR_MENSAGEM_DE_CHAT {conteudo}, EXPULSAR_MEMBRO {membroId}, DESBLOQUEAR_JOGADOR {jogadorId},
# ENCERRAR_SALA, INICIAR_PARTIDA — eventos correspondentes: SALA_ATUALIZADA, MEMBRO_SAIU,
# MEMBRO_DESCONECTADO, MEMBRO_EXPULSO, ANFITRIAO_SUBSTITUIDO, PRONTIDAO_ATUALIZADA,
# MENSAGEM_DE_CHAT, ERRO_DA_SALA (ver sala.ts).
```

**5. WebSocket do game-server**

```sh
wscat -c ws://localhost:8080/ws/game/<server-id-ou-partida-id>
# esperado: HTTP/1.1 101 Switching Protocols (upstream game_servers:1234)
# dentro da conexão, PING/PONG funciona; demais comandos de jogo ainda são stub
# que responde PONG a PING e null aos demais (ver backend/game-server/src/ws/ws.ts)
```

**6. Validação interna alternativa (debug)**

```sh
docker compose --profile backend exec lobby-server \
  node -e "fetch('http://localhost:'+process.env.LOBBY_SERVER_PORT+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({apelido:'Smoke2',email:'smoke2@example.local',senha:'senha_development_123'})}).then(r=>r.text()).then(console.log)"
```

O tratamento definitivo da incompatibilidade do seed fica como dívida para a
issue #24 (ST-04).

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
