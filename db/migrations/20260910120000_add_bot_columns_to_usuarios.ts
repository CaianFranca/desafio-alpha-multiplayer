import type { Knex } from 'knex';

// Adiciona colunas de identificação e ciclo de vida de Cadastros bot (#352).
// `bot = true` identifica Cadastros criados pelo BotRunner; `expira_em`
// define o TTL de expiração automática (purga, não confundir com a Limpeza do
// tabuleiro — ADR-0005). Ambas NULL para Cadastros de Jogadores reais.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usuarios', (table) => {
    table.boolean('bot').nullable().defaultTo(false);
    table.timestamp('expira_em', { useTz: true }).nullable();
  });
  // Índice parcial: o job de expiração filtra apenas Cadastros bot com TTL vencido.
  await knex.raw(
    'CREATE INDEX usuarios_bot_expira_em_idx ON usuarios (expira_em) WHERE bot = true',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS usuarios_bot_expira_em_idx');
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropColumn('bot');
    table.dropColumn('expira_em');
  });
}
