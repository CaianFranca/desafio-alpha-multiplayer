import type { Knex } from 'knex';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER || 'flicker',
      password: process.env.POSTGRES_PASSWORD || 'flicker_dev_password',
      database: process.env.POSTGRES_DB || 'flicker',
    },
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './seeds',
      extension: 'ts',
    },
  },
  // Produção: knexfile e migrations são compilados para dist/ no
  // build-release.sh (o servidor nunca roda TS nem tem ts-node/tsx).
  // Rodar a partir de db/ com NODE_ENV=production e envs POSTGRES_* definidas.
  production: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER || 'flicker',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DB || 'flicker',
    },
    migrations: {
      // Relativo ao knexfile (o knex CLI faz chdir para o diretório dele):
      // dev → db/migrations; prod → db/dist/migrations (knexfile.js compilado).
      directory: './migrations',
      extension: 'js',
    },
  },
};

export default config;
