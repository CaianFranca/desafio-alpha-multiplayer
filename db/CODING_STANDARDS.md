# CODING_STANDARDS — db

Padrões para `db/` (Knex 3 + PostgreSQL 17, migrations/seeds em TypeScript
via ts-node). Prescreve o padrão dominante do código real; divergências estão
marcadas como **legado**. Termos de domínio seguem o glossário em
`CONTEXT.md` na raiz.

## 1. Escopo

Aplica-se a `db/knexfile.ts`, `db/migrations/` e `db/seeds/`. O esquema
detalhado das tabelas (colunas, constraints, regras de negócio) está em
`funcionamento-DB.md` — este documento cobre convenções, não esquema.

## 2. Comandos de verificação

Rodar dentro de `db/`:

| Comando | O quê |
|---|---|
| `npm run migrate:make <nome>` | cria migration com timestamp |
| `npm run migrate:latest` | aplica pendentes |
| `npm run migrate:rollback` | desfaz o último lote |
| `npm run seed:run` | executa seeds |
| `npm run lint` | ESLint `strictTypeChecked` |

No fluxo Docker, o serviço one-shot `db-migrate` roda
`migrate:latest && seed:run` antes dos servidores subirem — não há comando
manual no compose. Conexão vem do `.env` da raiz (chaves `POSTGRES_*`,
carregadas via dotenv apontando para o monorepo).

## 3. Estrutura e organização

```
db/
├── knexfile.ts    # config única; client pg; dirs ./migrations e ./seeds
├── migrations/
└── seeds/
```

- Um arquivo de migration = uma mudança coesa. Múltiplas tabelas
  relacionadas podem nascer juntas quando formam uma unidade (precedente:
  `create_salas_historico_e_membros`).

## 4. Nomenclatura

- **Migrations**: timestamp Knex (`YYYYMMDDHHMMSS`) + verbo snake_case —
  `20260819120000_create_jogadores.ts`, `rename_jogadores_to_usuarios.ts`,
  `add_encaminhamento_to_salas_historico.ts`.
- **Seeds**: prefixo ordinal + snake_case — `01_jogador_teste.ts`.
- **Tabelas/colunas**: snake_case em português; auditoria como `criado_em`.
  Nomes de tabela seguem o glossário quando aplicável (divergências
  históricas, ex.: tabela `usuarios` ↔ entidade Cadastro, estão registradas
  no backend e não devem se multiplicar).

## 5. Migrações

- Named exports tipados: `export async function up(knex: Knex): Promise<void>`
  (idem `down`).
- `up` e `down` sempre completos; `down` é o espelho reverso exato (drops na
  ordem inversa da criação).
- PK uuid com `defaultTo(knex.raw('gen_random_uuid()'))`; PK composta via
  `table.primary(['sala_id', 'usuario_id'])`.
- Constraints inline no builder: `.notNullable().unique()`,
  `.references('id').inTable('usuarios').onDelete('CASCADE')`, `table.check`
  (ex.: regex do Código de Sala), `table.enu(...)`, `specificType('duracao',
  'interval')`.
- Coluna de auditoria: `timestamp('criado_em', { useTz: true })
  .notNullable().defaultTo(knex.fn.now())`.
- Índices além de PK/unique/FK nascem numa migration própria quando uma
  consulta exigir.

## 6. Imutabilidade

- **Migration aplicada nunca é editada.** Corrigir sempre com uma migration
  nova (o histórico é o write-model versionado do ADR-0002).
- Nunca renomear/arquivar migration já aplicada em ambiente compartilhado.
- Seeds são idempotentes (`.onConflict().ignore()`) para poderem rodar a
  cada subida do compose.

## 7. Testes

- Não há suíte automatizada em `db/`. Verificação mínima de qualquer
  mudança: `migrate:latest` seguido de `migrate:rollback` **e**
  `migrate:latest` de novo, contra um banco limpo — prova que `up` e `down`
  fecham.

## 8. Segurança

- Credenciais só via env (`POSTGRES_HOST/PORT/USER/PASSWORD/DB`) com
  defaults de dev versionados; nada de senha real fora do `.env`
  (não versionado).
- Lint estrito vale para `knexfile.ts`; as regras dinâmicas do Knex
  (`no-unsafe-*`) ficam relaxadas **apenas** em `migrations/` e `seeds/`,
  com o override documentado em `eslint.config.mjs`.

## 9. Evite

- Lógica de negócio dentro de migration — schema e dados estruturais apenas.
- Seed sem idempotência.
- SQL cru onde o builder resolve; `knex.raw` restrito a defaults e checks.
- Novos defaults hardcoded fora do padrão env+fallback já estabelecido.

### Legado registrado (baseline do lint em 2026-08-24)

Limpo: **0 violações**. Manter assim.

## 10. Referências

- `db/funcionamento-DB.md` — esquema completo e regras de negócio das tabelas.
- `CONTEXT.md` — glossário canônico de domínio.
- `docs/adr/0002` — Postgres write-model + Redis projeção.
- `db/AGENTS.md` — consulta de Knex/pg via Context7.
