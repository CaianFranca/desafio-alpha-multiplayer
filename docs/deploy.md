# Deploy em produção — Flicker of Sanity

Este documento descreve, de forma autocontida, como deployar e rollbackar o
Flicker of Sanity em produção nativa (sem Docker). Qualquer dev deve conseguir
executar a rotina completa a partir daqui, sem contexto externo.

Fontes da verdade: `.github/workflows/deploy.yml`, `scripts/build-release.sh`,
`scripts/deploy-server.sh`, `packages/config/src/index.ts`, `infra/systemd/`,
`infra/nginx/nginx.prod.conf` (nginx do app, `:8080`) e
`infra/nginx/nginx.edge.conf` (vhost de borda, `:80`).

---

## 1. Visão geral

O deploy é feito por um único workflow do GitHub Actions (**Deploy — Flicker
of Sanity**, `.github/workflows/deploy.yml`), disparado por:

- **push na branch `prod`** (rotina normal), ou
- **`workflow_dispatch`** manual, com input `sha` opcional (usado para rollback).

O pipeline tem três jobs encadeados (`quality` → `build` → `deploy`):

| Job | O que faz | Timeout |
| --- | --- | --- |
| `quality` | Typecheck dos workspaces (`npm run typecheck`) + migrations do `db/` contra um Postgres 17 limpo (service container). **NÃO roda testes** — decisão do time (2026-09-05): a suíte de integração e frontend não é mantida e os testes de frontend se mostraram flaky no runner do Actions. Validação de comportamento é feita localmente antes do merge. | 10 min |
| `build` | Executa `scripts/build-release.sh <sha-curto>`, que empacota o tarball `release/flicker-<sha>.tar.gz` e o publica como artifact `flicker-<sha>` (retenção de 14 dias). | 15 min |
| `deploy` | Conecta ao servidor de produção via **OpenVPN + SSH**, instala o env de produção, prepara o Postgres (idempotente) e executa `scripts/deploy-server.sh` no servidor. | 15 min |

Propriedades do workflow:

- `concurrency: deploy-prod` com `cancel-in-progress: true` — só existe um
  deploy por vez; um deploy novo cancela o anterior em andamento.
- `permissions: contents: read` — o workflow não tem permissão de escrita no
  repositório.
- **Não existe GitHub Release.** O artefato vive como artifact de 14 dias e o
  rollback é feito por `workflow_dispatch` + SHA (seção 4).

O job `deploy` só roda quando `github.ref == 'refs/heads/prod'` — push direto
em outra branch nunca deplona, e o `workflow_dispatch` precisa ser executado
selecionando a branch `prod`.

---

## 2. Pré-requisitos do servidor

O bootstrap do servidor **já foi executado** e não faz parte da rotina de
deploy. O servidor (referência de lab: IP `10.10.0.141`, hostname `c041`) é
alcançado pela rede privada via **VPN** para SSH/deploy — a exposição pública é
feita pelo proxy do admin, que termina o TLS e encaminha
`https://lab.alphaedtech.org.br/server01` para a porta **80** deste host,
removendo o prefixo `/server01`. O vhost de borda serve o app tanto na raiz
(pass-through) quanto em `/server01/` (strip), então funciona independente de o
proxy remover ou preservar o prefixo.

Estado esperado do servidor:

- **Node 24** instalado em `/usr/local/bin/node` (os units systemd apontam
  diretamente para esse caminho).
- **PostgreSQL 17** rodando localmente (role e database `flicker` são criados
  de forma idempotente pelo próprio workflow a cada deploy).
- **Redis** rodando localmente com persistência AOF (`appendonly no`... ou
  seja, AOF **desativado**; o estado efêmero do jogo é reconstruído).
- **nginx** instalado. O deploy instala a conf do app (`:8080`) em
  `sites-available/flicker` e o vhost de borda (`:80`, `default_server`) em
  `sites-available/flicker-edge`, e remove o site `default` do Debian de
  `sites-enabled/` (ele também seria `default_server` em `:80`).
- **Docroot** `/var/www/html` — symlink para `<release>/frontend/dist`,
  publicado pelo `deploy-server.sh` a cada deploy.
- Usuário de sistema **`flicker`** (dono das releases; user dos services).
- Diretórios **`/opt/flicker/releases`** e arquivo **`/opt/flicker/env`**
  (o workflow cria o diretório e sobrescreve o env a cada deploy).
- `scripts/deploy-server.sh` roda **como root** no servidor (validado no topo
  do script).

> Nota sobre o Redis: `appendonly no` é a config atual do lab. Com AOF
> desativado, um restart do Redis perde as chaves em memória (registros de
> game-servers com lease, partidas preparadas etc.). Revisite este parágrafo
> se a política de persistência mudar.

---

## 3. Rotina de deploy

### 3.1 Disparar

```bash
git push origin main:prod
```

Isso publica a `main` atual na branch `prod` e dispara o workflow. A branch
`prod` nunca recebe commits diretamente (ela existe só como gatilho; veja
branch protection na seção 8).

Acompanhe em **Actions → Deploy — Flicker of Sanity**.

### 3.2 O que cada job faz

**`quality`** — checkout (do SHA de rollback se houver, senão do HEAD da
`prod`), Node 24, `npm ci` + typecheck na raiz; em `db/`, `npm ci` +
`knex migrate:latest` contra o Postgres 17 do service container (env de teste,
nenhum secret real). Garante que o schema migra de zero sem erro.

**`build`** — checkout do mesmo ref, `scripts/build-release.sh "$SHORT_SHA"`.
O tarball contém tudo que o servidor precisa em runtime (o servidor **nunca
compila, nunca roda TS nem testes**):

- backend lobby + game (fonte TS — produção roda com `node --import tsx`);
- packages `config`, `shared`, `engine` (fonte TS, expostos via `main`/`exports`);
- `node_modules` de produção da raiz (inclui `tsx`) e do `db/`;
- `db/` compilado para JS (`knexfile.js` + `dist/migrations`);
- frontend buildado (vite) com base **`/server01/`** (`VITE_BASE_PATH=/server01/`)
  e a mídia de `frontend/web/media/` copiada para dentro do dist
  (`frontend/dist/media/`);
- `infra/systemd/*.service` e as confs nginx (`nginx.prod.conf` do app e
  `nginx.edge.conf` da borda), instaladas pelo script de deploy.

**`deploy`** — sequência de passos:

1. **Download do artifact** `flicker-<sha>` gerado no job `build`.
2. **VPN (OpenVPN)**: instala o OpenVPN no runner, escreve o secret
   `VPN_CONFIG` em `/tmp/vpn/client.ovpn`, sobe o túnel em modo daemon e faz
   ping no `$SERVER_HOST` até 60 tentativas (1/s). Falhou → imprime
   diagnóstico (rota, log do OpenVPN) e o passo falha (veja seção 7a).
3. **SSH**: instala a chave do secret `SSH_PRIVATE_KEY` em `~/.ssh/deploy_key`
   (600), monta `known_hosts` via `ssh-keyscan` e valida a conexão
   (`SERVER_USER@$SERVER_HOST`).
4. **Gerar env de produção**: monta `/tmp/flicker-env` (chmod 600) a partir
   dos secrets — os valores nunca aparecem nos logs (seção 6 detalha o
   conteúdo).
5. **scp** do tarball, do `scripts/deploy-server.sh` e do env para `/tmp/` no servidor.
6. **Instalar env + preparar Postgres (idempotente)**: instala o env em
   `/opt/flicker/env` (600), cria `/opt/flicker/releases` e, via `psql` como
   usuário `postgres`: cria a role `flicker` se não existir (ou sincroniza a
   senha com `ALTER ROLE`), e cria o database `flicker` se não existir —
   usando `format('%L', ...)` para citar a senha com segurança.
7. **Publicar release** — `bash /tmp/deploy-server.sh <sha> /tmp/flicker-<sha>.tar.gz`
   no servidor (detalhe abaixo).
8. **Encerrar OpenVPN** (`if: always()` — roda mesmo em falha).

### 3.3 O que o `deploy-server.sh` faz (no servidor, como root)

Ordem exata do script:

1. **Extrair** o tarball em staging (`<sha>.tmp`) e mover com `mv` atômico
   para `/opt/flicker/releases/<sha>` — redeploy do mesmo SHA é idempotente.
2. **Permissões**: `flicker:flicker` dono da release; nginx (outros) lê o
   frontend/media; `o+x` em `/opt/flicker` e `releases`.
3. **Migrations**: `knex migrate:latest` com o knexfile **compilado em JS**
   (`db/dist/knexfile.js`), usando o env de produção do EnvironmentFile.
4. **Instalar units systemd + conf nginx**: copia `infra/systemd/*.service`
   para `/etc/systemd/system/` + `daemon-reload`; copia `nginx.prod.conf` para
   `/etc/nginx/sites-available/flicker` + symlink em `sites-enabled/flicker`;
   copia `nginx.edge.conf` para `sites-available/flicker-edge` + symlink em
   `sites-enabled/flicker-edge`; remove `sites-enabled/default`; `nginx -t`
   valida antes de aplicar.
5. **Flip do symlink** (atômico): `/opt/flicker/current` → release nova e
   republica o docroot `/var/www/html` → `<release>/frontend/dist`.
6. **Restart + health check**: `systemctl restart flicker-lobby.service
   flicker-game.service` e, por até **60 s**, `curl` em `http://127.0.0.1:3001/health`
   (lobby) e `http://127.0.0.1:1234/health` (game). **Falhou → rollback
   automático** para a release anterior (flip de volta + docroot de volta +
   restart; a release problemática permanece em disco) e o script sai com erro,
   após imprimir as últimas 30 linhas do `journalctl` das duas units.
7. **Reload nginx** (`systemctl reload nginx` — zero downtime).
8. **Retenção**: mantém as últimas **3 releases** em `/opt/flicker/releases`
   (as releases `current` e a anterior nunca são removidas).

### 3.4 Como conferir que o deploy subiu

- No workflow: passo "Publicar release" termina com `[deploy] deploy <sha> concluído`.
- No servidor:

```bash
readlink /opt/flicker/current            # deve apontar para o SHA novo
readlink /var/www/html                   # deve ser <release>/frontend/dist
systemctl status flicker-lobby flicker-game
curl -fsS http://127.0.0.1:3001/health   # lobby
curl -fsS http://127.0.0.1:1234/health   # game
curl -fsS http://127.0.0.1:8080/         # nginx do app
```

- No navegador: o app responde publicamente em
  **`https://lab.alphaedtech.org.br/server01/`** (TLS terminado no proxy do
  admin). O host interno na porta **8080** é `http` e deve ser tratado como
  loopback/interno.

---

## 4. Rollback

Não há GitHub Release. O rollback **re-testa e re-gera o tarball de qualquer
commit** e redeploya:

1. Pegue o **SHA curto** do commit para o qual quer voltar (`git log --oneline`).
2. No GitHub: **Actions → Deploy — Flicker of Sanity → Run workflow**.
3. Selecione a branch **`prod`** (obrigatório — o job `deploy` só roda em
   `refs/heads/prod`) e preencha o input **`sha`** com o SHA curto.
4. O workflow roda os três jobs normalmente, mas com checkout do SHA
   informado: `quality` re-valida, `build` re-gera `flicker-<sha>` e o
   `deploy` publica essa release.

Como `deploy-server.sh` mantém as últimas 3 releases em disco, voltar para um
SHA recente costuma reaproveitar o diretório já extraído (extração idempotente).
Se o SHA for mais antigo que as 3 retidas, a release é re-extraída do tarball
re-gerado — o rollback funciona em qualquer caso, só demora um pouco mais.

Observação: se o rollback for para um commit cujas **migrations** eram
anteriores às atuais, o script **não** desfaz migrations (`migrate:latest`
só avança). Nesse cenário é preciso reverter a migration manualmente no
servidor ou deployar um commit que a desfaça.

---

## 5. Secrets e variables

Configurados em **GitHub → Settings → Secrets and variables → Actions**
(secrets na aba *Secrets*, a variable na aba *Variables*). **A criação e
edição é feita pela UI do GitHub** — não há CLI suportada para editar valores
e **nenhum valor real deve ser registrado no repositório** (nem em docs,
issues, PRs ou logs).

### Secrets

| Nome | Propósito |
| --- | --- |
| `VPN_CONFIG` | Conteúdo completo do arquivo `.ovpn` do cliente OpenVPN (certificados e chave inclusos). Usado no passo de VPN para subir o túnel até a rede privada. Se o servidor VPN fizer push de `redirect-gateway`, o config deve conter o fallback da seção 7a. |
| `SSH_PRIVATE_KEY` | Chave privada SSH dedicada ao deploy (chave pública autorizada no `authorized_keys` do usuário `SERVER_USER` no servidor). |
| `SERVER_HOST` | Host/IP do servidor de produção na rede privada (lab: `10.10.0.141`). Usado para ping VPN, SSH, `ssh-keyscan` e scp. |
| `SERVER_USER` | Usuário SSH usado no deploy (precisa permissão de `sudo`/root para o `deploy-server.sh` e acesso de escrita em `/tmp`). |
| `PROD_POSTGRES_PASSWORD` | Senha da role `flicker` do Postgres de produção. O workflow a injeta no env de produção e a sincroniza (idempotente) na role. |
| `PROD_JWT_SECRET` | Segredo de assinatura do JWT de acesso em produção. Obrigatório: a config **falha ao iniciar** se ausente ou igual ao default de dev. |
| `PROD_JWT_REFRESH_SECRET` | Segredo de assinatura do JWT de refresh em produção. Mesma validação estrita. |

### Variables

| Nome | Propósito |
| --- | --- |
| `PROD_LOBBY_PUBLIC_URL` | URL pública usada nos links compartilháveis emitidos pelo lobby. Obrigatória em produção (a config lança erro se `LOBBY_PUBLIC_URL` não estiver definida). Lab: `https://lab.alphaedtech.org.br/server01`. |

Rotação de qualquer valor: basta editar o secret/variable na UI e rodar um
novo deploy (o env de produção é regravado a cada deploy em
`/opt/flicker/env`).

---

## 6. Estrutura no servidor

```
/opt/flicker/
├── current -> /opt/flicker/releases/<sha>   # symlink atômico, flipado no deploy
├── releases/
│   ├── <sha-1>/                              # últimas 3 releases mantidas
│   ├── <sha-2>/
│   └── <sha-3>/
└── env                                       # EnvironmentFile, chmod 600

/var/www/html -> /opt/flicker/current/frontend/dist   # docroot (reapontado por release)

/etc/systemd/system/
├── flicker-lobby.service                     # lobby (API + WS de salas), porta 3001
└── flicker-game.service                      # game server (WS das partidas), porta 1234

/etc/nginx/
├── sites-available/flicker                   # conf do app, :8080 (instalada pelo deploy)
├── sites-enabled/flicker -> ../sites-available/flicker
├── sites-available/flicker-edge              # vhost de borda, :80 default_server
├── sites-enabled/flicker-edge -> ../sites-available/flicker-edge
└── sites-enabled/default                     # removido pelo deploy (conflito em :80)
```

Detalhes relevantes:

- **Units systemd** (`infra/systemd/`): `User=flicker`,
  `WorkingDirectory=/opt/flicker/current`, `EnvironmentFile=/opt/flicker/env`,
  `Environment=NODE_ENV=production`, `ExecStart=/usr/local/bin/node --import tsx
  backend/<srv>/src/index.ts`, `Restart=on-failure` (3 s), `MemoryMax=128M`,
  hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `IPAddressDeny=any`
  com `IPAddressAllow=localhost` — os dois services são loopback-only; o
  nginx do app (`:8080`) é quem fala com eles, e o único serviço exposto é o
  vhost de borda do nginx na porta 80, atrás do TLS do proxy do admin).
- **nginx** — duas camadas:
  - `infra/nginx/nginx.prod.conf` (app, `listen 8080`): serve o frontend de
    `/var/www/html` (symlink para `<release>/frontend/dist`) e `media/` via
    `alias /var/www/html/media/`; proxy de `/api/` e `/ws/lobby` para o lobby
    (127.0.0.1:3001) e de `/ws/game/` para o game server (127.0.0.1:1234).
  - `infra/nginx/nginx.edge.conf` (borda, `listen 80 default_server`), com
    três locations: (`1`) redireciona `/server01` → `/server01/` (301);
    (`2`) `/server01/` faz `proxy_pass http://127.0.0.1:8080/` para o nginx do
    app, **removendo o prefixo `/server01/`** (barra final do `proxy_pass`),
    usado quando o admin preserva o prefixo; (`3`) `/` faz pass-through
    (`proxy_pass http://127.0.0.1:8080`, **sem** barra final) preservando o URI,
    usado quando o admin remove o prefixo e entrega a raiz. Em todos os casos
    encaminha Upgrade/Connection (WebSocket) e
    `X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`.
- **Env de produção** (`/opt/flicker/env`) é gerado pelo workflow a cada
  deploy, com:

```ini
NODE_ENV=production
POSTGRES_HOST=127.0.0.1
POSTGRES_USER=flicker
POSTGRES_DB=flicker
POSTGRES_PASSWORD=<secret PROD_POSTGRES_PASSWORD>
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=<secret PROD_JWT_SECRET>
JWT_REFRESH_SECRET=<secret PROD_JWT_REFRESH_SECRET>
LOBBY_PUBLIC_URL=<variable PROD_LOBBY_PUBLIC_URL>
GAME_SERVER_ADVERTISE_HOST=127.0.0.1
COOKIE_SECURE=true
```

> **`GAME_SERVER_ADVERTISE_HOST=127.0.0.1`**: em prod nativa o lobby e o
> game-server coabitam o mesmo host, e o encaminhamento usa o host anunciado
> no registro do Redis; o default (`game-server`, em `packages/config`) só
> resolve na rede Docker Compose.

> **`COOKIE_SECURE=true`**: o acesso público é HTTPS (TLS terminado no proxy
> do admin), então o navegador envia os cookies `Secure` normalmente. O default
> em `packages/config` já é `Secure=true` quando `NODE_ENV=production`; o env
> apenas o torna explícito. O nginx do app repassa `X-Forwarded-Proto` recebido
> da borda para que redirects/cookies sejam gerados como `https`.

---

## 7. Troubleshooting

### a) VPN no runner não sobe / servidor inalcançável

Sintoma: passo "Conectar à VPN (OpenVPN)" falha com
`Servidor <host> inalcançável após 60s com a VPN ativa`.

O handshake da VPN tem até **60 s** para deixar o servidor alcançável (ping).
O próprio workflow imprime diagnóstico quando falha:

- **Internet OK com a VPN ativa** (`curl api.github.com` responde): o túnel
  subiu, mas a rota até o servidor falhou — problema de roteamento VPN.
- **Sem internet com a VPN ativa**: o tráfego do runner está sendo desviado
  para dentro do túnel — o servidor VPN faz **push de `redirect-gateway`**
  (pode não aparecer no corpo do `.ovpn`, pois é empurrado pelo servidor).

**Fix (fallback)**: editar o conteúdo do secret `VPN_CONFIG` (UI do GitHub)
acrescentando ao final do `.ovpn`:

```
pull-filter ignore "redirect-gateway"
route <IP_DO_SERVIDOR> 255.255.255.255 net_gateway
```

No lab: `route 10.10.0.141 255.255.255.255 net_gateway`. Alternativa
equivalente: `route-nopull` + rota estática para o servidor.

### b) Health check falha → rollback automático

Sintoma: passo "Publicar release" falha com
`FALHA no health check — rollback para <sha>`. A release anterior já está no
ar (o script faz o flip de volta sozinho) — **não é preciso agir para restaurar
o serviço**, apenas investigar a causa:

```bash
ssh <user>@10.10.0.141
journalctl -u flicker-lobby -u flicker-game --since "15 minutes ago" --no-pager
```

Causas comuns: env ausente/incorreto (`/opt/flicker/env`), migration quebrada,
porta ocupada, crash no boot (a config de produção lança erro se
`JWT_SECRET`/`JWT_REFRESH_SECRET`/`POSTGRES_PASSWORD` estiverem ausentes ou
iguais aos defaults de dev, ou se `LOBBY_PUBLIC_URL` não estiver definida).

### c) Problema conhecido: issue #252 — "INICIAR PARTIDA" falha em produção nativa

Aberta e não resolvida. O game-server registra no Redis (heartbeat/lease)
um meta com `host: 'game-server'` e `url: http://game-server:<porta>`
**hardcoded** em `backend/game-server/src/index.ts` (`criarMeta()`) — é o
hostname do serviço no Docker Compose. Em produção nativa esse hostname não
resolve, e o fluxo de "INICIAR PARTIDA" falha ao usar o endereço registrado.

**Fix planejado**: env `GAME_SERVER_ADVERTISE_HOST` para o game-server anunciar
o host correto (no lab: `10.10.0.141`). Até lá, partidas iniciadas em produção
nativa estão afetadas por este bug — ver a issue #252 para status.

---

## 8. Branch protection em `prod`

A branch `prod` é gatilho de deploy — um push direto acidental nela deplona o
que estiver nela, mesmo sem validação humana. Proteja via UI do GitHub
(**não há CLI para regras de proteção de branch**):

1. **Settings → Branches → Add branch ruleset** (ou *Add rule* em repos sem
   rulesets) para a branch `prod`.
2. Marque **Require a pull request before merging** — impede push direto; toda
   mudança chega via PR.
3. Opcional, recomendado:
   - **Restrict deletions** (ninguém apaga a `prod`);
   - **Block force pushes**;
   - em *Bypass list*, deixe vazio ou restrinja a admins de plantão — qualquer
     bypass reabre a porta para deploy acidental.
4. Salve. A partir daí, `git push origin main:prod` direto é rejeitado pelo
   GitHub; o caminho passa a ser abrir um PR de `main` → `prod` e mergeá-lo
   (o merge dispara o deploy normalmente, pois é um push na `prod`).
