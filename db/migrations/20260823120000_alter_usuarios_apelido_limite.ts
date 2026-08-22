import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const [{ count }] = await knex('usuarios').count().whereRaw('char_length(apelido) > 20');
  if (Number(count) > 0) {
    throw new Error(`Existem ${count} apelidos com mais de 20 caracteres — corrija antes de migrar`);
  }
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('apelido', 20).alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('apelido', 30).alter();
  });
}
