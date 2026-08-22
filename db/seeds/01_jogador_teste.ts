import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

export async function seed(knex: Knex): Promise<void> {
  // Gera hash dinâmico para não reutilizar salt (A5)
  const senhaHash = await bcrypt.hash('senha_development_123', 10);

  await knex('usuarios')
    .insert({
      apelido: 'Testador',
      email: 'teste@flicker.local',
      senha: senhaHash,
    })
    .onConflict()
    .ignore();
}
