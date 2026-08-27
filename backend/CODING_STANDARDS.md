# CODING_STANDARDS — backend

Padrões de código para `lobby-server` e `game-server`. Prescreve o padrão
dominante do código real; onde o código diverge, a regra aqui vale para
código novo e o estado antigo está marcado como **legado**. Termos de domínio
seguem o glossário em `CONTEXT.md` na raiz.

## 1. Escopo

Aplica-se a `backend/lobby-server` e `backend/game-server` (Express 5 + ws +
ioredis + pg, ESM, TypeScript strict). Pacotes compartilhados ficam em
`packages/` — ver `packages/CODING_STANDARDS.md`.

## 2. Comandos de verificação

Rodar dentro do workspace (`backend/lobby-server` ou `backend/game-server`):

| Comando | O quê |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint `strictTypeChecked` |
| `npm run test` | `node:test` via tsx contra Postgres/Redis reais |
| `npm run dev` | tsx watch |

Na raiz do monorepo, `npm run lint` e `npm run typecheck` agregam os
workspaces. Testes de integração exigem Postgres e Redis no ar
(`docker compose --profile db up -d`) — pré-condições estão documentadas no
cabeçalho de cada suíte.

## 3. Estrutura e organização

```
src/
├── config/     # singletons de conexão por tecnologia (pg.ts, redis.ts)
├── middleware/ # middlewares Express (auth, cookie)
├── routes/     # rotas Express por conceito (auth.ts, encaminhamento.ts)
├── ws/         # servidor WebSocket e handlers
└── *.ts        # módulos de domínio soltos (app.ts, index.ts, jwt.ts, sessoes.ts)
test/           # testes de integração (*.integration.test.ts)
```

- Domínio da Partida vive em `src/partidas/` (store Redis + validação).
- Pastas vazias (`handlers/`, `minigames/`, `rooms/`) são placeholders do
  ADR-0001: não criar arquivos fora delas quando o conceito existir.
- game-server usa injeção via `ContextoDoGameServer` (factory `createApp`);
  lobby-server usa imports singleton. Código novo no lobby segue o padrão do
  próprio app — não misturar estilos dentro de um mesmo servidor.

## 4. Nomenclatura

- **Arquivos**: camelCase pelo conceito (`sessoes.ts`, `validacao.ts`),
  **sem acento** em identificadores.
- **Funções**: verbo + objeto em português camelCase — `criarSessao`,
  `obterPartida`, `validarOfertaDeEncaminhamento`. Factories de entrypoint
  podem ficar em inglês (`createApp`, `createWebSocketServer`), como já é
  dominante.
- **Tipos/interfaces**: PascalCase com composição em português —
  `ContextoDoGameServer`, `OfertaDeEncaminhamento`, `PartidaPreparada`.
  Ids são aliases opacos: `ServerId`, `PartidaId`. Erros de domínio:
  classe com sufixo `Error` (`SessaoInvalidaError`).
- **Constantes**: UPPER_SNAKE — `SALT_ROUNDS`, `PREFIXO_SESSAO`,
  `NOME_ACCESS_COOKIE`.
- **Rotas HTTP**: caminho em inglês — `/api/auth/register`, `/health`.
- **Eventos WS (wire)**: UPPER_SNAKE em português — `'CRIAR_SALA'`,
  `'MEMBRO_ENTROU'`; no domínio interno, snake_case (`tipo: 'criar_sala'`).
  A dupla camada é intencional (ver `packages/shared/src/sala.ts`).
- **Logs**: prefixo `[escopo]` — `[auth/register]`, `[pg]`, `[ws]`.

## 5. Tipagem

- TS `strict`, `noEmit`, imports internos **com extensão `.ts` explícita**
  (`from './app.ts'`).
- Contratos wire/DTO vêm exclusivamente de `@flicker/shared` via
  `import type` — nunca redefinir tipos de protocolo localmente.
- Validação de entrada é manual com type guards
  (`isClientMessage(value): value is ClientMessage`); não introduzir lib de
  schema (zod etc.) sem decisão registrada.
- DTOs imutáveis usam `readonly` campo a campo; uniões discriminadas por
  literal (`type`/`tipo`).
- `as` só em bordas `unknown → tipo` (`req.body`, `JSON.parse`). Para erros,
  usar narrowing (`instanceof`), **não** `(error as Error).message` (legado).
- Module augmentation para estender bibliotecas: `req.jogador`
  (`express-serve-static-core`), scripts Lua (`declare module 'ioredis'`).

## 6. Erros, logs e assincronia

- **async/await exclusivo** — não escrever `.then()/.catch()` encadeado.
  Fire-and-forget deliberado usa `void` (`void validarDependencias()`).
- try/catch por rota; log do erro completo com prefixo e resposta genérica:
  ```ts
  console.error('[auth/register] error:', error)
  res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] })
  ```
- `catch {}` vazio retornando `null` só para falhas esperadas e decidíveis
  (JWT inválido, JSON corrompido na store) — nunca para erros de banco/rede.
- Envelope de erro é por app: lobby `{ erros: [{ campo?, mensagem }] }`;
  game-server `{ codigo, motivo }`. Manter o envelope do próprio app.
- Erros de domínio são classes que o caller traduz para status HTTP.

## 7. Testes

- `node:test` + `node:assert/strict`, executados via `tsx --test`.
- Integração real, **sem mocks**: HTTP efêmero em `127.0.0.1:0`, Postgres e
  Redis verdadeiros, reset em `beforeEach`.
- Builders/factories locais por suíte (`ofertaValida()`, `membro(n)` com
  `sobrescreve: Partial<...>`).
- Nome do teste descreve rota + status esperado + condição, em português:
  `'register: 409 com campo=apelido em apelido duplicado'`.
- Concorrência testada com `Promise.all` real; TTLs com sleeps curtos.

## 8. Segurança

- Senha: bcryptjs com custo fixo (`SALT_ROUNDS = 10`) e timing equalization
  com hash dummy quando o email não existe.
- JWT HS256, segredos separados para access/refresh, algoritmo fixado na
  assinatura **e** na verificação; claims revalidados após decode.
- Cookies httpOnly, SameSite=Strict, Path=/; `secure` vem de env.
- Toda entrada validada campo a campo antes de uso (limites conforme
  OpenAPI); email normalizado (trim + lowercase).
- `express.json({ limit: '10kb' })` + handler para 400/413 do body-parser.
- SQL sempre parametrizado (`$1, $2, ...`) — nunca interpolar valores.
- Segredos só via env, carregados por `@flicker/config`, que falha fast se
  default de dev chegar em produção. Nunca logar segredos nem tokens.

## 9. Evite

- `no-floating-promises`: toda Promise é `await`ed ou marcada `void`.
- Interpolar números/datas direto em template strings de mensagens
  (`restrict-template-expressions`) — formatar antes.
- Non-null assertion (`x!`) mesmo após guard/middleware — prefira narrowing;
  nos testes use `assert.ok(x)` seguido de acesso sem `!`.
- `void` em retorno de handler usado como valor.
- Duplicar handlers de body-parser entre apps ao editar — os dois existem
  hoje quase idênticos; extrair apenas quando tocar neles (legado aceito).

## 10. Referências

- `CONTEXT.md` — glossário canônico de domínio.
- `docs/adr/0001` — estrutura de pastas · `0002` — Postgres write-model +
  Redis projeção · `0003` — handoff lobby↔game.
- `.opencode/skills/` e `AGENTS.md` desta área — fluxos e docs de libs via
  Context7 (Express, ws, ioredis, jsonwebtoken).
