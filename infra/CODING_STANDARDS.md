# CODING_STANDARDS — infra

Padrões para `docker-compose.yml` (raiz), `infra/nginx/` e os Dockerfiles
do repositório (`db/Dockerfile`, `backend/*/Dockerfile`,
`infra/nginx/Dockerfile`). Prescreve o padrão dominante; divergências estão
marcadas como **legado**.

## 1. Escopo

Infraestrutura de execução: orquestração, proxy, imagens e variáveis de
ambiente. Não cobre código TypeScript — ver os CODING_STANDARDS das áreas.

## 2. Comandos de verificação

| Comando | O quê |
|---|---|
| `docker compose --profile full up --build` | sobe tudo (db → migrate → servers → nginx) |
| `curl localhost:$NGINX_PORT/health` | smoke test do roteamento |
| `docker compose --profile <p> up -d <svc>` | perfil isolado (`db`, `backend`, `nginx`, `full`) |

## 3. Estrutura e organização

- Compose único na raiz; perfis `db`, `backend`, `nginx`, `full`.
- Nginx conf + Dockerfile em `infra/nginx/`; cada serviço com build tem seu
  Dockerfile no próprio diretório.
- Serviços kebab-case (`db-migrate`, `lobby-server`, `game-server`).
- Sem `container_name` e sem redes customizadas — rede default do compose,
  resolução pelo nome do serviço.

## 4. Ordem e saúde dos serviços

- Todo serviço long-running tem **healthcheck**:
  Postgres `pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"`,
  Redis `redis-cli ping`, servers `fetch('/health')`, nginx `wget --spider`.
- Serviço one-shot (`db-migrate`) usa `restart: "no"` e é consumido como
  `condition: service_completed_successfully`.
- `depends_on` sempre com condition; ordem canônica:
  postgres/redis → db-migrate → lobby/game → nginx.
- Portas internas não são expostas ao host; só o nginx publica
  (`"${NGINX_PORT:-8080}:80"`). Serviços se falam pelos nomes de serviço
  (`POSTGRES_HOST: postgres`).

## 5. Imagens e Dockerfiles

- Bases fixas por tipo: `node:22-alpine` (db), `node:24-alpine` (servers),
  multi-stage para nginx (stage build em node, final em `nginx:1.27-alpine`).
- Cache de dependências: copiar todos os `package*.json` primeiro, `npm ci`,
  depois o código (contexto de build = raiz do monorepo nos servers).
- `ARG <PORT>` + `EXPOSE ${PORT}` nos servers; ENTRYPOINT/CMD explícitos
  (db-migrate encadeia `migrate:latest && seed:run`).
- Bind-mounts de código apenas para hot-reload em dev, com anonymous volume
  sobre `/app/node_modules`; montagens somente-leitura usam `:ro`
  (ex.: media do nginx).

## 6. Variáveis de ambiente

- UPPER_SNAKE_CASE com prefixo por domínio: `POSTGRES_`, `REDIS_`, `JWT_`,
  `SESSION_`; TTLs terminam em `_SECONDS`.
- Interpolação com default inline: `${VAR:-default}`; defaults de dev são
  versionados **e** marcados como dev (`dev_jwt_secret_change_me`,
  `flicker_dev_password`). Segredo real nunca vai para o compose nem para
  `.env.example`.
- Fonte única: `.env` na raiz; `.env.example` deve listar **toda** chave
  usada pelo compose (legado: `REDIS_PASSWORD` existe no compose e falta no
  `.env.example`).
- Apps leem env via `@flicker/config`, que falha fast se um default de dev
  chegar em produção — não contornar lendo `process.env` direto.

## 7. Proxy NGINX

- WebSocket: `map $http_upgrade $connection_upgrade` + `proxy_http_version
  1.1` + headers Upgrade/Connection; timeout longo nas rotas WS
  (`proxy_read_timeout 86400s`).
- Upstreams nomeados (`lobby_server`, `game_servers`); descoberta dinâmica
  de game-servers via Redis é a direção do ADR-0003 (hoje é estático,
  registrado no conf).
- Rotas canônicas: `/media/` (estático, `try_files =404`), `/api/` (lobby),
  `/ws/lobby` (lobby), `~ ^/ws/game/` (regex, game-server), `/` SPA fallback
  `try_files $uri $uri/ /index.html`.
- Gzip fica no nível do server, uma vez só.

## 8. Segurança

- Segredos reais nunca vão para o compose nem para `.env.example`; defaults
  de dev são versionados **e** marcados como dev
  (`dev_jwt_secret_change_me`, `flicker_dev_password`).
- Apps leem env via `@flicker/config`, que falha fast se um default de dev
  chegar em produção — não contornar lendo `process.env` direto no serviço.
- Headers de segurança (X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy) ficam no nível do server do nginx, uma vez só.

## 9. Evite

- Publicar porta de banco/redis/server no host.
- Healthcheck ausente em serviço novo.
- `latest` como tag de imagem — bases são pinadas por versão.
- Duplicar headers/timeouts por location quando valem para todas.

### Legado registrado

Sem lint aplicável (não-TS). Pendências conhecidas, para tickets futuros:

- Nenhum Dockerfile roda usuário não-root (sem `USER`).
- `REDIS_PASSWORD` ausente do `.env.example`.
- Upstream `game_servers` estático, aguardando ADR-0003.
- Perfil `frontend` reservado no SETUP.md ainda sem serviço.

## 10. Referências

- `SETUP.md` — perfis, portas e fluxo de subida.
- `docs/adr/0002` — Redis volátil (sem persistência: `--save "" --appendonly no`).
- `docs/adr/0003` — handoff lobby↔game e descoberta de game-servers.
- `infra/AGENTS.md` — docs de libs via Context7.
