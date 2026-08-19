import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('jogadores', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('apelido', 30).notNullable().unique();
    table.string('email', 255).notNullable().unique();
    table.text('senha').notNullable();
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('jogadores');
}
