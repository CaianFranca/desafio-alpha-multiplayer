import type { Knex } from "knex";
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('salas_historico', (table) => {
    table.string('server_id').nullable();
    table.string('partida_id').nullable();
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('salas_historico', (table) => {
    table.dropColumn('partida_id');
    table.dropColumn('server_id');
  });
}
