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
};

export default config;
