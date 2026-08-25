# CODING_STANDARDS — packages

Padrões para `packages/shared`, `packages/engine` e `packages/config`.
Prescreve o padrão dominante do código real; divergências estão marcadas como
**legado**. Termos de domínio seguem o glossário em `CONTEXT.md` na raiz.

## 1. Escopo

| Pacote | Papel | I/O |
|---|---|---|
| `@flicker/shared` | Protocolo WS e DTOs tipados, **apenas types/interfaces** — sem runtime, sem validação | nenhum |
| `@flicker/engine` | Regras do domínio como funções puras `(estado, comando) → Resultado` (ADR-0001) | nenhum |
| `@flicker/config` | Env schema + constantes + fábrica de cliente Redis | único com I/O |

## 2. Comandos de verificação

Dentro de cada pacote: `npm run typecheck`, `npm run lint`,
`npm run test` (só engine tem testes). Na raiz: `npm run lint` e
`npm run typecheck` agregam os workspaces.

## 3. Estrutura e organização

- Sem build: `main`/`types` apontam direto para `src/index.ts`; consumo é
  fonte TS via tsx.
- Barrel explícito em `src/index.ts`: listar cada export nomeado
  (`export type { ... } from './x.ts'`). **Nunca** `export *`.
- Fatie por conceito (`shared`: um arquivo por contrato). O engine hoje
  concentra o lobby num arquivo só — é o limite aceito, não o modelo a
  seguir para código novo.
- Imports internos com extensão `.ts` explícita.

## 4. Nomenclatura

- Arquivos camelCase pelo conceito (`sala.ts`, `encaminhamento.ts`),
  sem acento em identificadores.
- Funções: verbo + objeto em português — `criarSala`, `entrarNaSala`,
  `estadoDoLobbyVazio`. Tipos com sufixos semânticos: `-Comando`,
  `-Evento`, `-Erro` (`CriarSalaComando`, `MembroDesconectadoEvento`,
  `ErroDeDominio`).
- Constantes e literais de erro UPPER_SNAKE: `LIMITE_DE_MEMBROS`,
  `'SALA_CHEIA'`, `'APENAS_ANFITRIAO'`.
- Duas camadas de discriminante, intencionais:
  - wire (shared): campo `type` UPPER_SNAKE — `type: 'CRIAR_SALA'`
  - domínio (engine): campo `tipo` snake_case — `tipo: 'criar_sala'`
- Estados compostos em snake_case: `'em_reconexao'`.

## 5. Tipagem

- União discriminada em duas camadas: comandos por `tipo`, eventos por
  `tipo`, mensagens WS por `type`.
- Erro no engine é **valor, não exception**: `Resultado = Operacao... |
  OperacaoRejeitada` com discriminante booleano `sucesso: true/false`.
- Constante → tipo derivado: `MOTIVOS_DE_ENCERRAMENTO [...] as const` +
  `(typeof MOTIVOS_DE_ENCERRAMENTO)[number]`.
- `readonly` em todos os campos e coleções do engine
  (`readonly membros: readonly Membro[]`); tuplas de tamanho fixo
  (`readonly [MembroDaSala, MembroDaSala, MembroDaSala, MembroDaSala]`).
  Ids são aliases opacos (`ServerId`, `PartidaId`).
- **Legado**: `shared/sala.ts` e `autenticacao.ts` ainda não usam
  `readonly`; código novo nesses arquivos adota `readonly`.
- Narrowing em testes com `Extract<typeof evento, { tipo: '...' }>`.

## 6. Pureza e fronteiras

- **Engine é puro**: zero I/O, zero `async/Promise/setTimeout`, zero acesso a
  `process` ou relógio. Mutação sempre imutável (spread + map), verificada
  por teste com `structuredClone` como snapshot.
- Todo I/O fica em `@flicker/config` ou nos apps. Nunca importar `pg`,
  `ioredis`, `fs` num pacote de domínio.
- Servidores consomem `shared`/`config` pelos barrels; validação na borda é
  type guard manual (`isClientMessage`). O engine ainda não tem consumidores
  (legado): migrar a validação dos servidores para o engine é a direção do
  ADR-0001 — ao fazê-lo, manter shared e engine sincronizados **na mão**,
  registrando divergências intencionais em comentário (wire desacoplado do
  modelo interno).

## 7. Testes

- `node:test` + `node:assert/strict` via tsx; arquivo em `test/`, paralelo a
  `src/`.
- Um `test()` de topo por caso, sem `describe`; nome descritivo em
  português.
- Factories de comando com defaults e `as const`; helper que lança em
  rejeição; narrowing com `if (!resultado.sucesso) return;`.
- Eventos verificados por `resultado.eventos.map((e) => e.tipo)`.
- Toda operação nova do engine ganha teste de pureza/idempotência
  (não muta o estado recebido).

## 8. Segurança

- Pacotes não lidam com segredos diretamente; `config` lê env e aplica os
  defaults de dev versionados, falhando fast em produção.
- Não logar segredos; `console.error` restrito a falhas de inicialização.

## 9. Evite

- Exceptions no engine — retorne `Resultado`.
- `export *`, imports circulares entre pacotes, dependência do engine dentro
  do shared.
- Dois nomes públicos para a mesma função (legado:
  `admitirMembro = entrarNaSala`).
- Arquivo novo monolítico no engine — fatie por conceito.
- Callback async passado a `test()` sem `await` interno (gera
  `no-floating-promises`).

### Legado registrado (baseline do lint em 2026-08-24)

Violações existentes, pendentes de tickets de correção futura:

| Pacote | Total | Detalhe |
|---|---|---|
| `engine` (test/) | 158 | 69 `no-floating-promises` (callbacks async em `test()`), 89 `no-unnecessary-condition` (padrão assert + narrowing que o ESLint não enxerga) |
| `engine` (src/) | 2 | `restrict-template-expressions` (template com `number`) |
| `config` | 8 | `no-unnecessary-type-assertion` (`process.env.X as string \| undefined`) |
| `shared` | 0 | limpo |

## 10. Referências

- `CONTEXT.md` — glossário canônico de domínio.
- `docs/adr/0001` — papel dos pacotes · `0002` — write-model/projeção ·
  `0003` — handoff lobby↔game.
- `AGENTS.md` da raiz e de `backend/` — consulta de libs via Context7.
