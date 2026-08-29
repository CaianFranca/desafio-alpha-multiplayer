import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

export async function seed(knex: Knex): Promise<void> {
  const senha = await bcrypt.hash('senha_development_123', 10);
  await knex('usuarios')
    .insert({
      apelido: 'Testador',
      email: 'teste@flicker.local',
      senha,
    })
    .onConflict()
    .ignore();
}
