import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable('jogadores', 'usuarios');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.renameTable('usuarios', 'jogadores');
}
