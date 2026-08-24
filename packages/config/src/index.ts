import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

export interface Config {
  gameServerPort: number;
  lobbyServerPort: number;
  jwtSecret: string;
  partidaPreparadaTtlSegundos: number;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolMax: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

// Alinhado com .env.example e docker-compose.yml (1234), como o lobby faz com a 3001.
const DEFAULT_GAME_SERVER_PORT = 1234;
const DEFAULT_LOBBY_SERVER_PORT = 3001;
const DEFAULT_JWT_SECRET = 'dev_jwt_secret_change_me';
const DEFAULT_POSTGRES_PASSWORD = 'flicker_dev_password';
const DEFAULT_PG_POOL_MAX = 10;
const MAX_PG_POOL_MAX = 100;
const DEFAULT_PARTIDA_PREPARADA_TTL_SEGUNDOS = 600;

let envLoaded = false;

function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const here = dirname(fileURLToPath(import.meta.url));
  // .env na raiz do monorepo, resolvido de forma cwd-independente.
  const envPath = join(here, '../../../.env');

  try {
    process.loadEnvFile(envPath);
    envLoaded = true;
  } catch (error) {
    // Arquivo ausente não é erro: getConfig() cai nos defaults.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? fallback);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function parsePoolMax(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_PG_POOL_MAX);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_PG_POOL_MAX) {
    return parsed;
  }
  return DEFAULT_PG_POOL_MAX;
}

function parsePartidaPreparadaTtlSegundos(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_PARTIDA_PREPARADA_TTL_SEGUNDOS);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PARTIDA_PREPARADA_TTL_SEGUNDOS;
}

export function getConfig(): Config {
  loadEnvFile();

  const gameServerPort = parsePort(
    process.env.GAME_SERVER_PORT as string | undefined,
    DEFAULT_GAME_SERVER_PORT,
  );

  const lobbyServerPort = parsePort(
    process.env.LOBBY_SERVER_PORT as string | undefined,
    DEFAULT_LOBBY_SERVER_PORT,
  );

  const jwtSecret = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;
  const poolMax = parsePoolMax(process.env.PG_POOL_MAX);
  const partidaPreparadaTtlSegundos = parsePartidaPreparadaTtlSegundos(
    process.env.PARTIDA_PREPARADA_TTL_SEGUNDOS as string | undefined,
  );

  const postgres = {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parsePort(process.env.POSTGRES_PORT as string | undefined, 5432),
    user: process.env.POSTGRES_USER ?? 'flicker',
    password: process.env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'flicker',
    poolMax,
  };

  if (process.env.NODE_ENV === 'production') {
    if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
      throw new Error('JWT_SECRET deve ser definido em produção');
    }
    if (!postgres.password || postgres.password === DEFAULT_POSTGRES_PASSWORD) {
      throw new Error('POSTGRES_PASSWORD deve ser definido em produção');
    }
  }

  const redis = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parsePort(process.env.REDIS_PORT as string | undefined, 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
  };

  return { gameServerPort, lobbyServerPort, jwtSecret, partidaPreparadaTtlSegundos, postgres, redis };
}

export function criarClienteRedis(): Redis {
  const { redis } = getConfig();
  const cliente = new Redis({
    host: redis.host,
    port: redis.port,
    password: redis.password,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  cliente.on('error', (error: Error) => {
    console.error('[redis] error:', error.message);
  });

  return cliente;
}
