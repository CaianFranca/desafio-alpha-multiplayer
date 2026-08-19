import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('jogadores')
    .insert({
      apelido: 'Testador',
      email: 'teste@flicker.local',
      senha: 'senha_development_123',
    })
    .onConflict()
    .ignore();
}
