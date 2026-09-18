# Medidas de segurança OWASP aplicáveis ao servidor do Flicker of Sanity

## 1. Resumo

Esta pesquisa mapeia os controles OWASP que encaixam na superfície real do servidor do **Flicker of Sanity** — o lobby Express (`:3001`) e o game-server (`:1234`), atrás de dois níveis de nginx, com Postgres 17 e Redis 7 em loopback — e faz o gap analysis contra o código atual. O método foi: (a) ler o código do backend, a config (`packages/config`), o nginx (`infra/nginx/`), o systemd (`infra/systemd/`), o schema (`db/migrations/`), `docs/deploy.md` e os ADRs relevantes; (b) consultar fontes primárias — OWASP Top 10:2021, OWASP API Security Top 10:2023, OWASP Cheat Sheets, RFC 6455 e documentação oficial das bibliotecas (`jsonwebtoken`, Express 5, `ws`, `ioredis`, `pg`, `bcryptjs`) e do Node.js; e (c) registrar, para cada medida, o arquivo:linha de evidência no estado atual. Não houve mudança de código, config, deploy, issue ou ADR.

> Nota de cobertura: a OWASP não mantém um Cheat Sheet autônomo de *Rate Limiting*; o tema foi tratado a partir da seção **Rate limiting** do *Denial of Service Cheat Sheet* e de **API4:2023 Unrestricted Resource Consumption**. O endpoint `/api/encaminhamento` do game-server não tem middleware de autorização, mas só é alcançável em loopback (o nginx do app roteia `/api/` apenas para o lobby) — o risco está coberto em §7.

---

## 2. Modelo de ameaças resumido da superfície

**Ativos.** *Credenciais* (email + senha, `bcrypt` em `usuarios.senha`); *Sessão* (cookie `access_token` de 15 min e `refresh_token` de 7 dias, mais a chave `sessao:<uuid>` no Redis); tokens de serviço (`flicker-service`) e de bot (`flicker-bot`); o **estado da Partida** no Redis (tabuleiro, turnos, chat) e a *Sala* no Postgres/Redis.

**Atores.** *Visitante* (sem autenticação), *Jogador* autenticado, bot (Cadastro efêmero), atacante externo e atacante interno (já autenticado, tentando escalar ou abusar).

**Fronteiras de confiança.** Borda nginx `:80` (`nginx.edge.conf`) → nginx do app `:8080` (`nginx.prod.conf`) → loopback (`127.0.0.1`) → lobby/game-server → loopback → Redis/Postgres. Os dois services systemd são `IPAddressDeny=any` + `IPAddressAllow=localhost` (`infra/systemd/flicker-lobby.service:20-22`, `infra/systemd/flicker-game.service:20-22`). O TLS é terminado no **Cloudflare Quick Tunnel** (o `cloudflared` roda no próprio host e conecta ao nginx de borda via loopback); os saltos internos são HTTP, com o IP do cliente restaurado de `CF-Connecting-IP` na borda.

**Vetores principais.** Cross-Site WebSocket Hijacking (CSWSH) no handshake por cookie sem validação de `Origin` (`backend/lobby-server/src/ws/ws.ts:38-62`, `backend/game-server/src/ws/ws.ts:112-132`); roubo de token via XSS (cookies `HttpOnly` mitigam, CSP ausente agrava); enumeração/força bruta em `/api/auth/*` sem throttling; flood de WebSocket/chat (só o chat tem rate limit); injeção (SQL mitificada por queries parametrizadas; Redis usa protocolo length-prefixed); vazamento de segredos (Redis sem senha; `X-Powered-By` exposto); exposição de `/internal/` (bloqueado na borda, sem rotas correspondentes hoje).

---

## 3. Seções por controle OWASP

Cada item traz **Medida**, **Por que se aplica aqui**, **Onde aplicar**, **Status atual** (`feito`/`parcial`/`ausente`, com `arquivo:linha`) e **Fonte primária**.

### 3.1 Autenticação e Senhas

**Medida A1 — Hash adaptativo com salt para Credenciais.**
No cadastro e no login a senha nunca é armazenada em claro: usa-se `bcrypt` (algoritmo lento e adaptativo) com fator de trabalho 10 e salt gerado pela lib.
*Onde aplicar:* `routes/auth.ts`.
*Status:* **feito** — `bcrypt.hash(senhaBruta, SALT_ROUNDS)` em `backend/lobby-server/src/routes/auth.ts:210`; `SALT_ROUNDS = 10` em `backend/lobby-server/src/routes/auth.ts:33`. `bcrypt.compare` em `:282`.
*Fonte:* OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html; bcrypt.js (dcodeIO) — https://github.com/dcodeIO/bcrypt.js.

**Medida A2 — Limite de entrada de senha compatível com o bcrypt (72 bytes).**
O bcrypt trunca a entrada em 72 bytes; a aplicação deve rejeitar senhas maiores (ou pré-processá-las de forma segura) para não truncar em silêncio.
*Onde aplicar:* `routes/auth.ts` (`validarSenha`) + doc do contrato.
*Status:* **feito (#408)** — `SENHA_MAX_BYTES = 72` e rejeição em `validarSenha` (`backend/lobby-server/src/routes/auth.ts:55,126-127`, mensagem `A senha excede o limite de 72 bytes (UTF-8).`); senha de até 72 bytes segue aceita. Coberto por `backend/lobby-server/test/auth.integration.test.ts:964,992`.
*Fonte:* OWASP Password Storage Cheat Sheet (seções *Input Limits of bcrypt* e *Pre-hashing*); bcrypt.js — https://github.com/dcodeIO/bcrypt.js.

**Medida A3 — Mensagens de erro genéricas no login (anti-enumeração).**
Login falho deve responder o mesmo para email inexistente e senha errada.
*Status:* **feito** — resposta única `Credenciais inválidas.` em `backend/lobby-server/src/routes/auth.ts:109-111,277,284`.
*Fonte:* OWASP Authentication Cheat Sheet (seção *Authentication and Error Messages*) — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html.

**Medida A4 — Equalização de tempo no login (anti-enumeração por timing).**
Quando o email não existe, executar um `bcrypt.compare` descartável para igualar o custo.
*Status:* **feito** — hash falso e comparação em `backend/lobby-server/src/routes/auth.ts:24,276`.
*Fonte:* OWASP Authentication Cheat Sheet (seção *Authentication Responses*); Node.js Security Best Practices (timing attacks) — https://nodejs.org/en/learn/getting-started/security-best-practices.

**Medida A5 — Política de força de senha.**
Comprimento mínimo (a OWASP recomenda 15 sem MFA e 8 com MFA), sem regras de composição arbitrárias e com verificação contra listas de senhas vazadas.
*Status:* **parcial** — mínimo de 8 caracteres (`backend/lobby-server/src/routes/auth.ts:32,95-103`), sem MFA, sem bloqueio de senhas comuns/comprometidas.
*Fonte:* OWASP Authentication Cheat Sheet (seção *Implement Proper Password Strength Controls*).

**Medida A6 — Proteção contra ataques automatizados (throttling/lockout).**
Login e cadastro devem ter limite de tentativas para conter brute force, credential stuffing e password spraying.
*Status:* **feito (#408)** — rate limit por IP e por Cadastro em `/api/auth/login` e `/api/auth/register` via `consumirTentativas` (`backend/lobby-server/src/routes/auth.ts:146-206,266,390`; `backend/lobby-server/src/rate-limit/limitador.ts:23,54`), com contadores no Redis (INCR+EXPIRE atômicos via Lua) que sobrevivem a restart e valem entre instâncias; limiares/janelas configuráveis por env com defaults 30/IP, 10/Cadastro e 900 s (`packages/config/src/index.ts:72-74`). Recusa `429` + `Retry-After` com mensagem genérica (`:56,170-173`), sem distinguir Cadastro existente de inexistente. Coberto por `backend/lobby-server/test/auth.integration.test.ts:810-939` e `packages/config/test/auth-rate-limit.test.ts`; confirmado em produção.
*Fonte:* OWASP Authentication Cheat Sheet (seção *Protect Against Automated Attacks*); OWASP Nodejs Security Cheat Sheet (seção *Take precautions against brute-forcing*) — https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html; Express Security Best Practices (seção *Prevent brute-force attacks against authorization*) — https://expressjs.com/en/advanced/best-practice-security.html.

**Medida A7 — Verificação de posse do email e recuperação de senha.**
Fluxos de confirmação de email e de reset seguro (token de uso único, aleatório e com validade) fazem parte da superfície de Identidade e Acesso.
*Status:* **ausente** — não há rota de verificação nem de recuperação; o cadastro já emite Sessão (`backend/lobby-server/src/routes/auth.ts:160-242`).
*Fonte:* OWASP Authentication Cheat Sheet (seções *Implement Secure Password Recovery Mechanism* e *Email Address Validation*); OWASP Input Validation Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html.

**Medida A8 — Reduzir enumeração de Cadastro no registro.**
O registro responde mensagens distintas para email/apelido já em uso, o que permite enumerar contas.
*Status:* **parcial** — 409 específico por campo em `backend/lobby-server/src/routes/auth.ts:226-238` (trade-off de UX; o login já é genérico).
*Fonte:* OWASP Authentication Cheat Sheet (seção *Authentication Responses* → *Account creation*).

### 3.2 Sessão, JWT e Cookies

**Medida B1 — Assinatura MAC (HS256) com segredos separados para access e refresh.**
Access e refresh usam chaves distintas; isso evita que um refresh seja aceito como access.
*Status:* **feito** — `backend/lobby-server/src/jwt.ts:32,44`; `jwtSecret`/`jwtRefreshSecret` em `packages/config/src/index.ts:319-320`.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seções *Public-key Signatures vs. MAC* e *Secret management*) — https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html.

**Medida B2 — Restringir os algoritmos aceitos na verificação (anti key/algorithm confusion).**
*Status:* **feito** — `algorithms: ['HS256']` em `backend/lobby-server/src/jwt.ts:51,74`, `backend/lobby-server/src/middleware/serviceToken.ts:29-31` e `packages/config/src/serviceToken.ts:39-42`; `alg: none` é recusado.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seções *Unsecured JWTs* e *Key type confusion*).

**Medida B3 — Access token curto + refresh rotativo com detecção de reuso.**
Rotação de refresh invalida o token anterior; reuso é detectado e rejeitado.
*Status:* **feito** — TTLs de 900 s e 604800 s em `packages/config/src/index.ts:62-63`; script Lua de rotação com validação de ownership e detecção de reuso em `backend/lobby-server/src/sessoes.ts:70-87`; rota em `backend/lobby-server/src/routes/auth.ts:337-381`.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seções *JWT revocation*, *Replay protection* e *JWT denylist*); OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html.

**Medida B4 — Uma Sessão ativa por Jogador (com atomicidade).**
*Status:* **feito** — criação/rotação atômicas via `defineCommand`/Lua em `backend/lobby-server/src/sessoes.ts:47-87,124-139`; invariante do glossário em `CONTEXT.md:38`.
*Fonte:* OWASP Session Management Cheat Sheet (seção *Simultaneous Session Logons*).

**Medida B5 — Validar a Sessão no servidor a cada request.**
Não basta o JWT ser válido: a chave de Sessão no Redis precisa existir e pertencer ao Jogador.
*Status:* **feito** — `backend/lobby-server/src/middleware/auth.ts:39-43`; no game-server, `validarSessaoNoRedis` em `backend/game-server/src/auth.ts:54-68`, usada em `backend/game-server/src/ws/ws.ts:301-307`.
*Fonte:* OWASP Session Management Cheat Sheet (seção *Session ID Life Cycle* / *Manage Session ID as Any Other User Input*).

**Medida B6 — Cookies de Sessão com `HttpOnly`, `SameSite=Strict` e `Secure` em produção.**
*Status:* **feito** — formatador em `backend/lobby-server/src/cookies.ts:22-37`; emissão em `backend/lobby-server/src/routes/auth.ts:120-135`; `Secure` default em produção em `packages/config/src/index.ts:246-252`; exposto em `docs/deploy.md:321-325`.
*Fonte:* OWASP Session Management Cheat Sheet (seções *Secure Attribute*, *HttpOnly Attribute*, *SameSite Attribute*); OWASP HTTP Headers Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html.

**Medida B7 — Prefixo de cookie `__Host-` e ausência de `Domain`.**
O prefixo `__Host-` amarra o cookie a `Secure`, sem `Domain` e com `Path=/`, impedindo forja por subdomínio/downgrade.
*Status:* **parcial** — os cookies usam `Path=/`, sem `Domain` e com `Secure` em produção, mas não têm o prefixo (`access_token`/`refresh_token` em `backend/lobby-server/src/cookies.ts:5-6`).
*Fonte:* OWASP Session Management Cheat Sheet (seção *Cookie Name Prefixes*).

**Medida B8 — Timeouts de Sessão (idle e absoluto).**
*Status:* **parcial** — a Sessão expira junto com o refresh (7 dias) e o access expira em 15 min (`packages/config/src/index.ts:62-63`, `backend/lobby-server/src/sessoes.ts:149-158`), mas não há timeout por inatividade separado do TTL absoluto.
*Fonte:* OWASP Session Management Cheat Sheet (seção *Session Expiration* → *Idle Timeout* / *Absolute Timeout*).

**Medida B9 — Registro de `iss`/`aud` nos tokens de Sessão.**
*Status:* **feito** — `assinarAccess`/`assinarRefresh` emitem `iss` comum (`SESSION_ISS`) e `aud` distinto por tipo (`SESSION_ACCESS_AUDIENCE`/`SESSION_REFRESH_AUDIENCE`), e a verificação os exige (`backend/lobby-server/src/jwt.ts:34,46,53,76`; constantes em `packages/config/src/serviceToken.ts:10-12`); o game-server valida `iss`/`aud` de access (`backend/game-server/src/auth.ts:32`). Corte seco: token antigo sem `iss`/`aud` é recusado e exige novo login.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seção *Claims*).

**Medida B10 — Revogação imediata no logout e ao remover Cadastro.**
*Status:* **feito** — logout revoga a Sessão no Redis e limpa os cookies (`backend/lobby-server/src/routes/auth.ts:301-307`, `backend/lobby-server/src/sessoes.ts:177-190`); `/me` e `/refresh` revogam se o Cadastro sumiu (`:320-325,362-365`).
*Fonte:* OWASP Session Management Cheat Sheet (seção *Manual Session Expiration* → *Logout Button*).

**Medida B11 — Defesa CSRF em requisições que mudam estado.**
*Status:* **parcial** — `SameSite=Strict` em todos os cookies de Sessão (`backend/lobby-server/src/cookies.ts:24`, `backend/lobby-server/src/routes/auth.ts:124,132`), sem token CSRF nem verificação de `Origin`/`Sec-Fetch-Site`. A OWASP trata `SameSite` como defesa em profundidade, não substituta do token.
*Fonte:* OWASP Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html; OWASP Session Management Cheat Sheet (seção *SameSite Attribute*).

### 3.3 WebSocket (origem, CSWSH, limites)

**Medida C1 — Autenticar o handshake pela Sessão (cookie) e validar no Redis.**
*Status:* **feito** — lobby em `backend/lobby-server/src/ws/ws.ts:38-62`; game-server aceita cookie `access_token` ou `?token=` e valida no Redis em `backend/game-server/src/ws/ws.ts:112-132,299-307`.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Authentication and Authorization*) — https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html.

**Medida C2 — Validar o header `Origin` no handshake (anti-CSWSH).**
O navegador envia cookies automaticamente no handshake de WebSocket; sem validar `Origin` contra uma allowlist, um site malicioso abre uma conexão autenticada em nome da vítima. A OWASP é explícita: allowlist de origens, nunca denylist, jamais wildcard/substring.
*Onde aplicar:* `createWebSocketServer` (lobby e game-server), no evento `connection`/`upgrade`.
*Status:* **feito (#409)** — allowlist exata (sem wildcard) derivada de `LOBBY_PUBLIC_URL` ou de `WS_ORIGENS_PERMITIDAS`, validada no handshake **antes** de ler a sessão: `origemPermitida` em `packages/shared/src/segurancaWs.ts:10`, usada em `backend/lobby-server/src/ws/ws.ts:160` (`verifyClient` → 403) e `backend/game-server/src/ws/ws.ts:345`. `Origin` ausente (bot/serviço) é aceito; vazio, `"null"` ou fora da allowlist é recusado. Coberto por `backend/lobby-server/test/ws-seguranca.integration.test.ts:320-393`, `backend/game-server/test/ws-seguranca.test.ts:292-379` e `packages/config/test/ws-seguranca.test.ts:97-157`; confirmado em produção (403/101).
*Fonte:* OWASP WebSocket Security Cheat Sheet (seções *Cross-Site WebSocket Hijacking (CSWSH)*, *Origin Header Validation*, *Additional CSWSH Protections*); RFC 6455, seções 1.3 (*Opening Handshake* — o `Origin` "is used to protect against unauthorized cross-origin use of a WebSocket server"), 1.6 (*Security Model*) e 10.2 (*Origin Considerations*) — https://datatracker.ietf.org/doc/html/rfc6455.

**Medida C3 — Limite de tamanho de mensagem WebSocket (`maxPayload`).**
A OWASP recomenda teto de mensagem (tipicamente ≤ 64 KB) para evitar exaustão de recursos.
*Status:* **feito (#409)** — `maxPayload: seguranca.maxPayloadBytes` nos dois servidores (`backend/lobby-server/src/ws/ws.ts:155`, `backend/game-server/src/ws/ws.ts:331`), default 65536 bytes configurável por `WS_MAX_PAYLOAD_BYTES` (1024–1048576) em `packages/config/src/index.ts:85-87`. Frame acima do teto fecha com 1009. Coberto por `ws-seguranca.integration.test.ts:416` e `ws-seguranca.test.ts:403`; confirmado em produção.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seções *Input Validation* e *Denial-of-Service Protection*); `ws` docs (`maxPayload`, default 104857600) — https://github.com/websockets/ws/blob/master/doc/ws.md.

**Medida C4 — Desabilitar compressão `permessage-deflate`.**
Compressão combinada com segredo pode vazar informação (classe CRIME/BREACH).
*Status:* **feito** — o default do `ws` já desabilita a extensão (não há `perMessageDeflate` setado); não há ação pendente, mas convém explicitar para não regredir.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Compression security*); `ws` docs (`perMessageDeflate` desabilitado quando `false`, o default).

**Medida C5 — Rate limiting de mensagens WebSocket.**
*Status:* **feito (#409)** — rate limit geral por conexão com janela deslizante em `LimiteDeMensagensPorConexao` (`packages/shared/src/segurancaWs.ts:21`), default 100 mensagens/10 s configurável (`WS_LIMITE_MENSAGENS`/`WS_JANELA_LIMITE_MENSAGENS_MS`), aplicado no lobby (`backend/lobby-server/src/ws/ws.ts:206,213`) e no game-server (`backend/game-server/src/ws/ws.ts:436,614`); estouro → close 1008 + evento `ws.rate_limit_exceeded`; bots isentos. O chat de Partida mantém 1 msg/2 s (F1). Coberto por `ws-seguranca.integration.test.ts:432,464` e `ws-seguranca.test.ts:424,465`; confirmado em produção.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Denial-of-Service Protection* — "implement rate limiting to prevent message flooding"); OWASP Denial of Service Cheat Sheet (seção *Rate limiting*) — https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html.

**Medida C6 — Revalidar a Sessão/logout em conexões de longa duração.**
Conexões WS sobrevivem à Sessão; a OWASP recomenda revalidar periodicamente e fechar no logout/expiração.
*Status:* **feito (#410)** — revalidação periódica das conexões abertas (default 30 s, `WS_SESSAO_REVALIDACAO_MS` em `packages/config/src/index.ts:99-101`) em `backend/lobby-server/src/ws/revalidacao-de-sessao.ts` + `registro-de-conexoes.ts` e `backend/game-server/src/ws/revalidacao-de-sessao.ts`; logout e troca de Sessão encerram as conexões vigentes com close 4401 (`SESSAO_ENCERRADA`/`SESSAO_SUBSTITUIDA`/`SESSAO_INVALIDA`). Coberto por `sessao-ws.integration.test.ts:82-125` e `sessao-ws.test.ts:266-390`; confirmado em produção (close 4401 ao remover a chave `sessao:<id>`).
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Session Management*).

**Medida C7 — Uma Conexão à Partida vigente por Jogador.**
*Status:* **feito** — registro `Map<partidaId, Map<jogadorId, Conexao>>`, com substituição da conexão anterior em `backend/game-server/src/ws/conexao.ts:11-32` e `backend/game-server/src/ws/ws.ts:350-359,489-499`.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Denial-of-Service Protection* — per-user limits).

**Medida C8 — Teto de mensagens pré-autenticação (anti-DoS).**
*Status:* **feito** — buffer de 32 mensagens descartadas acima do teto em `backend/lobby-server/src/ws/ws.ts:84,94-98`.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Denial-of-Service Protection*).

### 3.4 Autorização e tokens de serviço/bots

**Medida D1 — Exigir Sessão nas rotas de Jogador.**
*Status:* **feito** — `requireSessao` em `/api/bots/adicionar` (`backend/lobby-server/src/routes/bots.ts:101`), `/logout` e `/me` (`backend/lobby-server/src/routes/auth.ts:301,311`); os comandos de Sala/Partida também dependem do socket autenticado.
*Fonte:* OWASP Top 10:2021 A01 *Broken Access Control* — https://owasp.org/Top10/2021/; OWASP API Security Top 10:2023 *API1:2023 Broken Object Level Authorization* — https://owasp.org/API-Security/editions/2023/en/0x11-t10/.

**Medida D2 — Derivar o ator da Sessão, nunca do payload do cliente.**
*Status:* **feito** — o dispatch usa `sessao.jogadorId`, ignorando o `jogadorId` autodeclarado no wire (`backend/game-server/src/ws/ws.ts:540-544`; comentário de cabeçalho em `backend/game-server/src/partidas/handlers.ts:14-28`).
*Fonte:* OWASP API Security Top 10:2023 *API1:2023*; OWASP WebSocket Security Cheat Sheet (seção *Message-Level Authorization*).

**Medida D3 — Checar pertencimento ao roster/estado antes de admitir na Partida.**
*Status:* **feito** — roster e estado verificados em `backend/game-server/src/ws/ws.ts:320-335`.
*Fonte:* OWASP API Security Top 10:2023 *API5:2023 Broken Function Level Authorization*.

**Medida D4 — Token de serviço com `aud`/`role` e verificação no destino.**
*Status:* **feito** — assinatura com `audience: SERVICE_TOKEN_AUDIENCE` e `role: 'service'` (`packages/config/src/serviceToken.ts:13-19`), verificação em `backend/lobby-server/src/middleware/serviceToken.ts:20-36`; aplicado em `/api/game-servers` (`backend/lobby-server/src/routes/gameServers.ts:8`), `/api/retorno` (`backend/lobby-server/src/routes/retorno.ts:10`) e `/api/desistencia` (`backend/lobby-server/src/routes/desistencia.ts:25`).
*Fonte:* OWASP JSON Web Token Cheat Sheet (seções *Claims* e *Secret management*).

**Medida D5 — Não afrouxar a autorização de serviço fora de produção.**
*Status:* **feito (#412)** — `requireServiceToken` exige Bearer válido em todos os ambientes; o ramo `NODE_ENV !== 'production'` foi removido (`backend/lobby-server/src/middleware/serviceToken.ts:14`). Coberto por `backend/lobby-server/test/gameServers.integration.test.ts:203,259` (guard fora e em produção), `desistencia.integration.test.ts:233` e `retorno.integration.test.ts:256`; confirmado em produção (401 sem token).
*Fonte:* OWASP API Security Top 10:2023 *API5:2023*; OWASP HTTP Headers Cheat Sheet (*Reduce fingerprinting*).

**Medida D6 — Token de bot com `aud` dedicada e `bot: true`.**
*Status:* **feito** — `BOT_TOKEN_AUDIENCE`/`flicker-bot`, `bot: true` e TTL de 2 h em `packages/config/src/serviceToken.ts:4,21-35`; verificação em `:37-55`; o game-server identifica o bot em `backend/game-server/src/auth.ts:18-26`.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seção *Claims*).

**Medida D7 — Bots isentos de sessão no Redis e do rate limit de chat.**
*Status:* **parcial (decisão de projeto)** — bots não passam por `validarSessaoNoRedis` (`backend/game-server/src/ws/ws.ts:301`) e furam o rate limit (`backend/game-server/src/partidas/handlers.ts:341-345`). É intencional e limitado a Cadastros bot (`BOTS_HABILITADOS`, `backend/lobby-server/src/app.ts:14-16,46-49`), mas amplia o poder de um emissor de Bot Token.
*Fonte:* OWASP API Security Top 10:2023 *API2:2023 Broken Authentication*; OWASP Authentication Cheat Sheet (*Authentication Solution and Sensitive Accounts*).

**Medida D8 — `/internal/` inacessível de fora.**
*Status:* **feito** — `location /internal/ { return 403; }` nos três nginx (`infra/nginx/nginx.prod.conf:47-50`, `infra/nginx/nginx.conf:38-41`, `infra/nginx/nginx.dev.conf:49-52`). Hoje não existem rotas `/internal/` no backend — é defesa preventiva.
*Fonte:* OWASP Nodejs Security Cheat Sheet (seção *Remove unnecessary routes*); OWASP API Security Top 10:2023 *API9:2023 Improper Inventory Management*.

**Medida D9 — Rota de encaminhamento não exposta.**
*Status:* **feito** — `POST /api/encaminhamento` não tem middleware de autorização (`backend/game-server/src/routes/encaminhamento.ts:10`), mas o nginx do app só roteia `/api/` para o lobby (`infra/nginx/nginx.prod.conf:52-53`) e o game-server é loopback-only (`infra/systemd/flicker-game.service:20-22`).
*Fonte:* OWASP API Security Top 10:2023 *API8:2023 Security Misconfiguration*; OWASP Top 10:2021 A05 *Security Misconfiguration*.

**Medida D10 — Stream de debug acessível a qualquer Jogador (risco aceito).**
*Status:* **parcial (conflito com ADR-0015)** — `receberComando` aceita `ATIVAR_DEBUG` de qualquer Jogador autenticado (`backend/lobby-server/src/ws/debug-stream.ts:59-76`; espelho no game-server). O ADR-0015 **aceita formalmente** esse risco e rejeita flag/allowlist. Qualquer recomendação de restringi-lo conflita com o ADR; o correto é registrar o conflito, não sobrescrever a decisão.
*Fonte:* OWASP API Security Top 10:2023 *API9:2023 Improper Inventory Management*; `docs/adr/0015-ativacao-livre-do-stream-de-debug.md`.

### 3.5 Validação de entrada e injeção (SQL/Redis/JSON)

**Medida E1 — Queries parametrizadas (prepared statements) no Postgres.**
*Status:* **feito** — todas as consultas usam placeholders `$1..$n`: `backend/lobby-server/src/routes/auth.ts:213-218,269-272,315-318,357-360` e `backend/lobby-server/src/salas/repositorio.ts:68-136,190-270`; sem concatenação de string vinda do cliente.
*Fonte:* OWASP SQL Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html; node-postgres *Queries* (parameterized query) — https://node-postgres.com/features/queries; Express Security Best Practices (*Defend against SQL injection… parameterized queries*).

**Medida E2 — Validação de tipo, tamanho e formato na entrada de auth.**
*Status:* **feito** — `typeof`/`trim`, limites de Apelido (3–20), mínimo de senha e regex de email em `backend/lobby-server/src/routes/auth.ts:160-205`; `express.json({ limit: '10kb' })` em `backend/lobby-server/src/app.ts:26` e `backend/game-server/src/app.ts:8`.
*Fonte:* OWASP Input Validation Cheat Sheet; OWASP Nodejs Security Cheat Sheet (seção *Set request size limits*).

**Medida E3 — Contrato fechado de mensagens WebSocket.**
*Status:* **feito** — guards de allowlist fechada em `ehSalaComando` (`backend/lobby-server/src/salas/handlers.ts:159`) e `ehComandoDaPartida` (`backend/game-server/src/partidas/wire.ts:90`); mensagens fora do contrato viram recusa ao originador.
*Fonte:* OWASP Input Validation Cheat Sheet (seção *Allowlist vs Denylist*); OWASP WebSocket Security Cheat Sheet (seção *Input Validation*).

**Medida E4 — Normalização e teto do chat.**
*Status:* **feito** — quebras colapsadas, `trim`, recusa de vazio e teto de 300 caracteres em `backend/game-server/src/partidas/handlers.ts:321-330`; histórico limitado (`PARTIDA_CHAT_HISTORICO_MAXIMO`) em `packages/config/src/index.ts:59-61,190-198`.
*Fonte:* OWASP Input Validation Cheat Sheet (seções *Validating Free-form Unicode Text*); OWASP WebSocket Security Cheat Sheet (seção *Input Validation*).

**Medida E5 — Código de Sala com allowlist e constraint no banco.**
*Status:* **feito** — geração `[A-Z0-9]{6}` com `randomBytes` (`backend/lobby-server/src/salas/codigo.ts:29-38`) e `CHECK (codigo_sala ~ '^[A-Z0-9]{6}$')` (`db/migrations/20260822174539_create_salas_historico_e_membros.ts:6-7`).
*Fonte:* OWASP Input Validation Cheat Sheet (seção *Allowlist Regular Expression Examples*).

**Medida E6 — Tratar JSON inválido/grande sem vazar HTML de erro.**
*Status:* **feito** — handlers de `entity.parse.failed`/`entity.too.large` → 400/413 (`backend/lobby-server/src/app.ts:53-70`, `backend/game-server/src/app.ts:16-33`).
*Fonte:* OWASP Nodejs Security Cheat Sheet (seção *Handle errors in asynchronous calls* / *Error & Exception Handling*); OWASP Input Validation Cheat Sheet.

**Medida E7 — Prevenção de prototype pollution.**
*Status:* **parcial** — o código não faz merge recursivo de JSON do cliente e valida campos explicitamente, mas também não usa `--disable-proto`, `Object.create(null)` nem `Object.hasOwn`.
*Fonte:* Node.js Security Best Practices (seção *Prototype Pollution Attacks*) — https://nodejs.org/en/learn/getting-started/security-best-practices.

**Medida E8 — Injeção em Redis/Lua.**
*Status:* **feito** — o protocolo Redis é length-prefixed e binário-safe, e os scripts Lua usados via `defineCommand` recebem parâmetros por `KEYS`/`ARGV`, sem composição de string (`backend/lobby-server/src/sessoes.ts:47-87`).
*Fonte:* Redis security (seção *String escaping and NoSQL injection*) — https://redis.io/docs/latest/operate/oss_and_stack/management/security/; ioredis (seção *Lua Scripting*) — https://github.com/redis/ioredis.

### 3.6 Rate limiting e abuso (recursos)

**Medida F1 — Rate limit no chat de Partida.**
*Status:* **feito** — 1 mensagem/2 s por Jogador não-bot (`backend/game-server/src/partidas/handlers.ts:67-68,332-353`), com crédito consumido só após persistir.
*Fonte:* OWASP API Security Top 10:2023 *API4:2023 Unrestricted Resource Consumption*; OWASP Denial of Service Cheat Sheet (seção *Rate limiting*).

**Medida F2 — Rate limit nas rotas HTTP de autenticação.**
*Status:* **feito (#408)** — mesmo limitador de A6 aplicado a `/api/auth/login` e `/api/auth/register` (por IP e por Cadastro). Ver A6 para evidência e testes.
*Fonte:* Express Security Best Practices (seção *Prevent brute-force attacks against authorization*); OWASP Authentication Cheat Sheet (*Login Throttling*).

**Medida F3 — Rate limit na borda nginx.**
*Status:* **feito (#418)** — a borda aplica `limit_req` por IP (`rate=10r/s`, `burst=20 nodelay`, `limit_req_status 429`), `limit_conn` de 50 conexões por IP e `client_max_body_size 256k` (`infra/nginx/nginx.edge.conf`), com zonas e escopo em `infra/nginx/rate-limit.snippet` (mapas `$limit_req_key` e `$limit_conn_key`) e o IP real restaurado de `CF-Connecting-IP` em `infra/nginx/cloudflare-realip.snippet`. O `map` do `limit_req` limita só `/server01/api|ws/`, `/api/` e `/ws/`; assets do SPA passam livres. O `map` do `limit_conn` exclui `/assets/` e `/media/` (com ou sem o prefixo `/server01/`), então o preload da Partida não conta no teto de conexões; o WebSocket continua contando.
*Fonte:* OWASP Denial of Service Cheat Sheet (seções *Network Design Concepts* e *Rate limiting*); OWASP Nodejs Security Cheat Sheet (seção *Monitor the event loop*).

**Medida F4 — Limite de corpo de requisição.**
*Status:* **feito** — 10 kb em ambos os serviços (`backend/lobby-server/src/app.ts:26`, `backend/game-server/src/app.ts:8`).
*Fonte:* OWASP Nodejs Security Cheat Sheet (seção *Set request size limits*).

**Medida F5 — Limite de conexões/recursos por Jogador.**
*Status:* **parcial** — há uma Conexão por Jogador por Partida (`backend/game-server/src/ws/conexao.ts:11-32`), mas não há teto de conexões simultâneas por Jogador/IP no lobby nem de Partidas abertas.
*Fonte:* OWASP WebSocket Security Cheat Sheet (seção *Denial-of-Service Protection*); OWASP API Security Top 10:2023 *API4:2023*.

**Medida F6 — Timeouts de conexão/servidor.**
*Status:* **parcial** — o nginx aplica `proxy_read_timeout 60s` em `/api/` e 86400 s em `/ws/*` (`infra/nginx/nginx.prod.conf:60,69,78`); não há configuração explícita de `requestTimeout`/`headersTimeout` no `http.Server` do Node, que fica com defaults.
*Fonte:* Node.js Security Best Practices (seção *Denial of Service of HTTP server*); OWASP Denial of Service Cheat Sheet (seção *Software Design Concepts*).

### 3.7 Headers e CSP

**Medida G1 — Headers básicos de segurança.**
*Status:* **feito** — `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin` com `always` (`infra/nginx/nginx.prod.conf:28-30`; idem `nginx.conf:21-23`, `nginx.dev.conf:32-34`).
*Fonte:* OWASP HTTP Headers Cheat Sheet (*X-Frame-Options*, *X-Content-Type-Options*, *Referrer-Policy*).

**Medida G2 — Content Security Policy.**
*Status:* **feito (#415)** — CSP restritiva em `infra/nginx/security-headers-static.snippet:15` (`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self'; connect-src 'self' blob:; ...`), aplicada apenas em conteúdo estático (`location /` e `/media/`); `blob:` é exigido pelo three.js (validado no smoke Sala→Partida). Confirmado em produção no `/server01/`.
*Onde aplicar:* `infra/nginx/nginx.prod.conf` (HTML do docroot) e, se possível, o Cloudflare Quick Tunnel.
*Fonte:* OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html; OWASP HTTP Headers Cheat Sheet (*Content-Security-Policy*).

**Medida G3 — HSTS.**
*Status:* **feito (#415)** — HSTS condicional via `map $http_x_forwarded_proto $hsts_header` (`infra/nginx/hsts-map.snippet:10`), emitido por `infra/nginx/security-headers.snippet:12`; só quando o TLS foi terminado na borda (`X-Forwarded-Proto` começando com `https`), com `max-age=2592000` (ramp-up) e **sem** `includeSubDomains`. Confirmado em produção (http sem header; https com header).
*Fonte:* OWASP HTTP Headers Cheat Sheet (*Strict-Transport-Security*); OWASP Transport Layer Security Cheat Sheet (seção *Use HTTP Strict Transport Security*) — https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html.

**Medida G4 — `Permissions-Policy`, COOP/COEP/CORP.**
*Status:* **ausente**.
*Fonte:* OWASP HTTP Headers Cheat Sheet (*Permissions-Policy*, *Cross-Origin-Opener-Policy*, *Cross-Origin-Embedder-Policy*, *Cross-Origin-Resource-Policy*).

**Medida G5 — Remover `X-Powered-By` e `Server` informativo.**
*Status:* **feito (#413/#415)** — `app.disable('x-powered-by')` no lobby (`backend/lobby-server/src/app.ts:29`) e no game-server (`backend/game-server/src/app.ts:10`); `server_tokens off` nos três nginx (`infra/nginx/nginx.edge.conf:46`, `infra/nginx/nginx.prod.conf:27`, `infra/nginx/nginx.conf:25`). Coberto por `auth.integration.test.ts:1012` e `encaminhamento.test.ts:382`; confirmado em produção (sem `X-Powered-By`; `Server: nginx` sem versão).
*Onde aplicar:* `createApp` (ambos) e `infra/nginx/`.
*Fonte:* OWASP HTTP Headers Cheat Sheet (*X-Powered-By*, *Server*); Express Security Best Practices (seção *Reduce fingerprinting*); OWASP Nodejs Security Cheat Sheet (seção *Use appropriate security headers*).

**Medida G6 — `Cache-Control: no-store` em respostas sensíveis.**
*Status:* **ausente** — respostas de `/api/*` (Jogador, Sessão) não instruem o cache.
*Fonte:* OWASP Transport Layer Security Cheat Sheet (seção *Prevent Caching of Sensitive Data*); OWASP HTTP Headers Cheat Sheet (*Cache-Control*).

### 3.8 Segredos e configuração

**Medida H1 — Falhar no boot em produção com segredo ausente/default.**
*Status:* **feito** — erro se `JWT_SECRET`/`JWT_REFRESH_SECRET` estiverem ausentes ou iguais aos defaults de dev, ou se `POSTGRES_PASSWORD`/`LOBBY_PUBLIC_URL` faltarem (`packages/config/src/index.ts:363-376`; documentado em `docs/deploy.md:369-372`).
*Fonte:* OWASP Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html; OWASP Nodejs Security Cheat Sheet.

**Medida H2 — Segredos fora do repositório e arquivo de env protegido.**
*Status:* **feito** — secrets via GitHub Actions e `/opt/flicker/env` com `chmod 600` (`docs/deploy.md:215-243,256,298-314`); `.env` é ignorado (`**.env` em `.gitignore`).
*Fonte:* OWASP Secrets Management Cheat Sheet (seções *Centralize and Standardize*, *Access Control*, *CI/CD*).

**Medida H3 — Autenticar o Redis.**
*Status:* **feito (#427)** — `REDIS_PASSWORD` consta no env de produção (`docs/deploy.md:298-322`; `.github/workflows/deploy.yml:195,208`) com `requirepass` em `docker-compose.yml:37` e `packages/config/src/index.ts:60,521` (`DEFAULT_REDIS_PASSWORD` + `trim()` no boot). A mitigação de loopback + `protected mode` foi complementada com autenticação redundante.
*Onde aplicar:* env de produção (`/opt/flicker/env`) + `redis.conf` (`scripts/deploy-server.sh:63`).
*Fonte:* OWASP Secrets Management Cheat Sheet (seção *General Secrets Management*); Redis security (seções *Network security*, *Protected mode* e *Authentication*).

**Medida H4 — Rotação de segredos.**
*Status:* **parcial** — a operação é manual (edita-se o secret e faz-se novo deploy, `docs/deploy.md:241-243`); os tokens de serviço já têm TTL de 1 h e os de bot 2 h, mas não há automação de rotação.
*Fonte:* OWASP Secrets Management Cheat Sheet (seção *Secret Lifecycle* → *Rotation*).

**Medida H5 — Não reutilizar o mesmo segredo entre tipos de token.**
*Status:* **parcial** — tokens de Sessão, de serviço e de bot compartilham `JWT_SECRET` (`backend/lobby-server/src/jwt.ts:92-95`, `packages/config/src/serviceToken.ts:13,21`). As audiences distintas + validação de forma mitigam confusão de tipo, mas a OWASP recomenda não reutilizar segredo entre audiências.
*Fonte:* OWASP JSON Web Token Cheat Sheet (seção *Secret management*).

**Medida H6 — Detecção/scan de segredos no CI.**
*Status:* **ausente** — o job `quality` roda typecheck e migrations, sem scan de segredos (`docs/deploy.md:26`).
*Fonte:* OWASP Secrets Management Cheat Sheet (seção *Detection*).

### 3.9 Transporte/TLS e proxy

**Medida I1 — TLS na exposição pública e loopback no interno.**
*Status:* **feito** — o TLS é terminado no Cloudflare Quick Tunnel e o host interno `:8080` é HTTP/loopback (`docs/deploy.md:50-54,184-186`); apps/PG/Redis ficam em `127.0.0.1` (`infra/nginx/nginx.prod.conf:3,9-16`).
*Fonte:* OWASP Transport Layer Security Cheat Sheet (seções *Use TLS For All Pages*, *Only Support Strong Protocols*); Express Security Best Practices (seção *Use TLS*).

**Medida I2 — Propagar `X-Forwarded-Proto` para cookies/redirects.**
*Status:* **feito** — a borda assume `https` quando o header falta e repassa o valor (`infra/nginx/nginx.edge.conf:28-31,57`); o app repassa adiante (`infra/nginx/nginx.prod.conf:57-59`) e `COOKIE_SECURE=true` em produção (`docs/deploy.md:321-325`).
*Fonte:* OWASP Transport Layer Security Cheat Sheet (seção *Use the "Secure" Cookie Flag*); OWASP Session Management Cheat Sheet (seção *Transport Layer Security*).

**Medida I3 — Política de TLS (protocolos/cifras) e HSTS sob controle.**
*Status:* **parcial/fora de controle** — a terminação é do Cloudflare Quick Tunnel; o repositório aplica HSTS condicional (G3, `infra/nginx/hsts-map.snippet`), mas não define protocolos/cifras. A OWASP exige TLS 1.3 (TLS 1.2 por compatibilidade) e desabilita TLS 1.0/1.1.
*Fonte:* OWASP Transport Layer Security Cheat Sheet (seções *Only Support Strong Protocols*, *Only Support Strong Ciphers*, *Use HTTP Strict Transport Security*).

### 3.10 Infra (Redis/Postgres/systemd/nginx) e observabilidade

**Medida J1 — Hardening dos services e loopback-only.**
*Status:* **feito** — `User=flicker`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `MemoryMax=128M` e `IPAddressDeny=any`/`IPAddressAllow=localhost` em `infra/systemd/flicker-lobby.service:8-28` e `infra/systemd/flicker-game.service:8-28`.
*Fonte:* OWASP Nodejs Security Cheat Sheet (seção *Permissions* — modelo de privilégio/least privilege); Node.js Security Best Practices (seção *Node.js Permission Model*).

**Medida J2 — Isolamento de rede de Redis e Postgres.**
*Status:* **parcial** — ambos escutam em loopback e o firewall de processo protege o Redis de outros processos; o `requirepass` do Redis foi fechado em H3 (#407/#414). Permanece o `appendonly no`, que perde estado a cada restart (`docs/deploy.md:62-63,76-79`).
*Fonte:* Redis security (seções *Network security* e *Code security*).

**Medida J3 — Senha obrigatória do Postgres em produção.**
*Status:* **feito** — `POSTGRES_PASSWORD` obrigatório e não-default em produção (`packages/config/src/index.ts:370-372`), sincronizado de forma idempotente com `ALTER ROLE` citando com `format('%L', …)` (`docs/deploy.md:132-136`).
*Fonte:* OWASP Secrets Management Cheat Sheet; OWASP SQL Injection Prevention Cheat Sheet (seção *Least Privilege*).

**Medida J4 — Logging estruturado e eventos de segurança.**
*Status:* **feito (#411)** — logger pino JSON em `packages/shared/src/securityLogger.ts` com redação (`redact` + `redact` nativo do pino) e `hashEmail`; eventos `auth.login_success`/`auth.login_failure`/`auth.register_success`/`auth.register_conflict`/`auth.rate_limit_exceeded`/`auth.session_reuse`/`ws.handshake_rejected`/`ws.rate_limit_exceeded`/`ws.message_rejected`/`ws.payload_too_large`, todos com `requestId`/`connectionId` (`securityLogger.ts:8-21`; usos em `routes/auth.ts`, `ws/ws.ts` e `partidas/handlers.ts`). Confirmado em produção via journald (JSON com `emailHash`, sem senha/token/cookie em claro). **Cobertura automatizada pendente:** os setters `__set*SecurityLoggerForTests` existem e não são exercitados por nenhum teste (`ws-seguranca`/`auth.integration` cobrem os efeitos, não os eventos) — débito registrado.
*Fonte:* OWASP Authentication Cheat Sheet (seção *Logging and Monitoring*); OWASP WebSocket Security Cheat Sheet (seção *Security Monitoring and Logging*); OWASP Nodejs Security Cheat Sheet (seção *Perform application activity logging*); OWASP Top 10:2021 A09 *Security Logging and Monitoring Failures*.

**Medida J5 — Auditoria de dependências no pipeline.**
*Status:* **feito** — o job `quality` roda `scripts/audit-dependencies.mjs`, que executa `npm audit --omit=dev --package-lock-only` nos três roots npm (raiz/workspaces, `db` e `frontend`) e reprova (exit 1) em qualquer advisory high/critical; exceções em `dependency-audit-allowlist.json` só valem para advisory sem correção disponível (`fixAvailable === false`) e exigem justificativa. O rollback (`workflow_dispatch` com `sha`) é isento do gate.
*Fonte:* Express Security Best Practices (seção *Ensure your dependencies are secure*); Node.js Security Best Practices (seção *Malicious Third-Party Modules*); OWASP Top 10:2021 A06 *Vulnerable and Outdated Components*.

**Medida J6 — Health checks sem autenticação, mas só em loopback.**
*Status:* **feito** — `/health` existe no lobby e no game-server (`backend/lobby-server/src/app.ts:29-38`, `backend/game-server/src/app.ts:10-12`) e não é roteado pelo nginx; a exposição é loopback.
*Fonte:* OWASP API Security Top 10:2023 *API9:2023*; OWASP Nodejs Security Cheat Sheet (seção *Remove unnecessary routes*).

---

## 4. Tabela priorizada das lacunas

Prioridade baseada no risco real para o jogo: exposição a CSWSH/roubo de Sessão, abuso de recursos na autenticação e no WebSocket, e vazamento de segredos/infra.

| Prioridade | Lacuna | Área | Status | Referência OWASP |
| --- | --- | --- | --- | --- |
| Alta | Handshake WebSocket não valida `Origin` (CSWSH) | WebSocket | feito (#409) | WebSocket Security CS (Origin Header Validation, CSWSH); RFC 6455 §1.3/1.6/10.2 |
| Alta | Sem rate limit/lockout em `/api/auth/login` e `/api/auth/register` (brute force, credential stuffing) | Autenticação | feito (#408) | Authentication CS (Protect Against Automated Attacks); Express Security |
| Alta | Sem `maxPayload` no `ws` (default 100 MiB) | WebSocket | feito (#409) | WebSocket Security CS (Input Validation, DoS); ws docs |
| Alta | Redis sem `requirepass` em produção | Segredos/Infra | feito (#407/#414) | Secrets Management CS; Redis security (Authentication) |
| Alta | Sem `Content-Security-Policy` | Headers/CSP | feito (#415) | Content Security Policy CS; HTTP Headers CS |
| Média | Sem rate limit geral de mensagens WS (borda nginx coberta pela F3, #418) | Rate limiting | feito (#409) | WebSocket Security CS (DoS); Denial of Service CS (Rate limiting) |
| Média | `X-Powered-By` exposto e `server_tokens` ligado (fingerprint) | Headers | feito (#413/#415) | HTTP Headers CS (X-Powered-By, Server); Express Security |
| Média | Sessão/WS não é revalidada em conexões longas nem fechada no logout | Sessão/WebSocket | feito (#410) | WebSocket Security CS (Session Management) |
| Média | Sem HSTS | Transporte | feito (#415) | HTTP Headers CS (HSTS); TLS CS |
| Média | Sem `iss`/`aud` nos tokens de Sessão | Sessão/JWT | feito (#416) | JSON Web Token CS (Claims) |
| Média | Sem limite de senha de 72 bytes do bcrypt (trunca em silêncio) | Autenticação | feito (#408) | Password Storage CS (Input Limits of bcrypt); bcrypt.js |
| Média | Sem logging estruturado/eventos de segurança (auth, rate-limit, validação) | Observabilidade | feito (#411) | Authentication CS (Logging); WebSocket Security CS; A09:2021 |
| Média | Bypass de autorização de serviço quando `NODE_ENV !== 'production'` | Autorização | feito (#412) | API5:2023; API8:2023 |
| Média | Sem `npm audit`/auditoria de dependências no CI | Supply chain | feito (#417) | Express Security; Node.js Security; A06:2021 |
| Baixa | Sem token CSRF (só `SameSite=Strict`) | Sessão/CSRF | parcial | CSRF Prevention CS; Session Management CS |
| Baixa | Cookies sem prefixo `__Host-` | Sessão | parcial | Session Management CS (Cookie Name Prefixes) |
| Baixa | Sem `Permissions-Policy`/COOP/COEP/CORP | Headers | ausente | HTTP Headers CS |
| Baixa | Sem `Cache-Control: no-store` em respostas sensíveis | Headers | ausente | TLS CS (Prevent Caching) |
| Baixa | `JWT_SECRET` reaproveitado entre Sessão, serviço e bot | Segredos/JWT | parcial | JSON Web Token CS (Secret management) |
| Baixa | Sem detecção/scan de segredos no CI | Segredos | ausente | Secrets Management CS (Detection) |
| Baixa | Enumeração de Cadastro no registro (409 por campo) | Autenticação | parcial | Authentication CS (Account creation) |
| Baixa | Sem verificação de email/recuperação de senha | Autenticação | ausente | Authentication CS; Input Validation CS |
| Baixa | Sem `--disable-proto`/`Object.create(null)` (prototype pollution) | Validação | parcial | Node.js Security Best Practices |
| Baixa | Timeouts do `http.Server` no default | Rate limiting/DoS | parcial | Node.js Security Best Practices; DoS CS |

---

## 5. Referências (fontes primárias efetivamente acessadas)

### OWASP — Top 10 e API Security Top 10
- OWASP Top 10:2021 — https://owasp.org/Top10/2021/
- OWASP Top 10 API Security Risks – 2023 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/

### OWASP Cheat Sheets
- Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- JSON Web Token Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html
- WebSocket Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- HTTP Headers Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- Input Validation Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- SQL Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- Nodejs Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html
- Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- Transport Layer Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
- Denial of Service Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html

### IETF
- RFC 6455 — The WebSocket Protocol — https://datatracker.ietf.org/doc/html/rfc6455

### Documentação oficial das dependências e do Node.js
- jsonwebtoken (auth0/node-jsonwebtoken) — https://github.com/auth0/node-jsonwebtoken
- ws (websockets/ws, doc/ws.md) — https://github.com/websockets/ws/blob/master/doc/ws.md
- bcrypt.js (dcodeIO/bcrypt.js) — https://github.com/dcodeIO/bcrypt.js
- ioredis (redis/ioredis) — https://github.com/redis/ioredis
- node-postgres — Queries — https://node-postgres.com/features/queries
- Express — Production Best Practices: Security — https://expressjs.com/en/advanced/best-practice-security.html
- Node.js — Security Best Practices — https://nodejs.org/en/learn/getting-started/security-best-practices
- Redis — Redis security — https://redis.io/docs/latest/operate/oss_and_stack/management/security/
