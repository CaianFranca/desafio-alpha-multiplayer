import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Hash bcrypt para 'senha_development_123' (custo 10) — evita fallback plaintext em runtime (B1 review #61)
  const senhaHash = '$2a$10$TRYsKKs3gnP3xfzZhmQvturXjyF01X62WYNOENZsXiONM7piZSxVW';

  await knex('usuarios')
    .insert({
      apelido: 'Testador',
      email: 'teste@flicker.local',
      senha: senhaHash,
    })
    .onConflict()
    .ignore();
}
