import { Pool } from 'pg';
import { getConfig } from '@flicker/config';

const { postgres } = getConfig();

export const pool = new Pool({
  host: postgres.host,
  port: postgres.port,
  user: postgres.user,
  password: postgres.password,
  database: postgres.database,
});

pool.on('error', (err) => {
  console.error('[pg] pool error:', err.message);
});
