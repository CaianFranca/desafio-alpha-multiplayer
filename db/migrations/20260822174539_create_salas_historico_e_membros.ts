import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('salas_historico', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('codigo_sala', 6).notNullable().unique();
    table.check("codigo_sala ~ '^[A-Z0-9]{6}$'");
    table.enu('status', ['aberta', 'encaminhada', 'encerrada', 'expirada'])
      .notNullable()
      .defaultTo('aberta');
    table.uuid('anfitriao_id').nullable().references('id').inTable('usuarios');
    table.enu('resultado', ['vitoria', 'derrota']).nullable();
    table.specificType('duracao', 'interval').nullable();
  });

  await knex.schema.createTable('membros', (table) => {
    table.uuid('sala_id').notNullable().references('id').inTable('salas_historico').onDelete('CASCADE');
    table.uuid('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.primary(['sala_id', 'usuario_id']);
    table.integer('ordem_de_entrada').notNullable();
    table.boolean('bloqueado').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('membros_historico', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('sala_id').notNullable().references('id').inTable('salas_historico').onDelete('CASCADE');
    table.uuid('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.enu('motivo_de_termino', ['saida', 'expulsao', 'expiracao', 'encerramento']).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('membros_historico');
  await knex.schema.dropTableIfExists('membros');
  await knex.schema.dropTableIfExists('salas_historico');
}
