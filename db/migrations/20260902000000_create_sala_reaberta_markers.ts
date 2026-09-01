import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sala_reaberta_markers', (table) => {
    table.uuid('sala_id').primary().references('id').inTable('salas_historico').onDelete('CASCADE');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sala_reaberta_markers');
}
