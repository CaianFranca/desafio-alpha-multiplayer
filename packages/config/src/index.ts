import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

export interface Config {
  gameServerPort: number;
  lobbyServerPort: number;
  /** URL pública usada nos links compartilháveis emitidos pelo lobby. */
  lobbyPublicUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  cookieSecure: boolean;
  sessionAccessTtlSeconds: number;
  sessionRefreshTtlSeconds: number;
  partidaPreparadaTtlSegundos: number;
  partidaTerminadaTtlSegundos: number;
  partidaNaoInicioSegundos: number;
  partidaReconexaoEmAndamentoSegundos: number;
  lobbyRetornoCallbackUrl: string;
  lobbyDesistenciaCallbackUrl: string;
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
  gameServerHeartbeatIntervalMs: number;
  gameServerHeartbeatTtlMs: number;
  gameServerId: string | undefined;
  /** Host que o game-server anuncia no registro do Redis, consumido pelo lobby no encaminhamento. */
  gameServerAdvertiseHost: string;
}

// Alinhado com .env.example e docker-compose.yml (1234), como o lobby faz com a 3001.
const DEFAULT_GAME_SERVER_PORT = 1234;
const DEFAULT_LOBBY_SERVER_PORT = 3001;
const DEFAULT_JWT_SECRET = 'dev_jwt_secret_change_me';
const DEFAULT_JWT_REFRESH_SECRET = 'dev_jwt_refresh_change_me';
const DEFAULT_POSTGRES_PASSWORD = 'flicker_dev_password';
const DEFAULT_PG_POOL_MAX = 10;
const MAX_PG_POOL_MAX = 100;
const DEFAULT_PARTIDA_PREPARADA_TTL_SEGUNDOS = 600;
const DEFAULT_PARTIDA_TERMINADA_TTL_SEGUNDOS = 3600;
const DEFAULT_PARTIDA_NAO_INICIO_SEGUNDOS = 90;
const DEFAULT_PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS = 60;
const DEFAULT_SESSION_ACCESS_TTL_SECONDS = 900; // 15 minutos
const DEFAULT_SESSION_REFRESH_TTL_SECONDS = 604800; // 7 dias
const DEFAULT_GAME_SERVER_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_GAME_SERVER_HEARTBEAT_TTL_MS = 15000;
// Alinhado com o nome do serviço no docker-compose.yml; em prod nativa o
// workflow define GAME_SERVER_ADVERTISE_HOST=127.0.0.1.
const DEFAULT_GAME_SERVER_ADVERTISE_HOST = 'game-server';

export const GAME_SERVERS_PREFIX = 'game-servers:disponiveis:';

// Prefixos das chaves de Partida do game-server (compartilhados com o lobby —
// review JF532, O1): o lobby consulta `game-server:partida:<id>` ao decidir
// Partida Órfã e o game-server registra/escaneia as mesmas chaves.
export const GAME_SERVERS_PARTIDA_PREFIXO = 'game-server:partida:';
export const GAME_SERVERS_PARTIDA_ESTADO_PREFIXO = 'game-server:partida-estado:';

export function chaveGameServer(serverId: string): string {
  return `${GAME_SERVERS_PREFIX}${serverId}`;
}

export function sanitizeServerId(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-');
}

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

function parseTtlSegundos(raw: string | undefined, fallback: number, label: string): number {
  const parsed = Number(raw ?? fallback);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  if (raw !== undefined) {
    console.warn(`[config] ${label} inválido "${raw}" — usando fallback ${fallback}`);
  }
  return fallback;
}

function parsePartidaPreparadaTtlSegundos(raw: string | undefined): number {
  return parseTtlSegundos(raw, DEFAULT_PARTIDA_PREPARADA_TTL_SEGUNDOS, 'PARTIDA_PREPARADA_TTL_SEGUNDOS');
}

function parsePartidaTerminadaTtlSegundos(raw: string | undefined): number {
  return parseTtlSegundos(raw, DEFAULT_PARTIDA_TERMINADA_TTL_SEGUNDOS, 'PARTIDA_TERMINADA_TTL_SEGUNDOS');
}

function parsePartidaNaoInicioSegundos(raw: string | undefined): number {
  const fallback = DEFAULT_PARTIDA_NAO_INICIO_SEGUNDOS;
  const parsed = Number(raw ?? fallback);
  if (Number.isInteger(parsed) && parsed >= 10 && parsed <= 600) {
    return parsed;
  }
  if (raw !== undefined) {
    console.warn(`[config] PARTIDA_NAO_INICIO_SEGUNDOS inválido "${raw}" — usando fallback ${fallback} (10..600)`);
  }
  return fallback;
}

function parsePartidaReconexaoEmAndamentoSegundos(raw: string | undefined): number {
  const fallback = DEFAULT_PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS;
  const parsed = Number(raw ?? fallback);
  if (Number.isInteger(parsed) && parsed >= 1) {
    return parsed;
  }
  if (raw !== undefined) {
    console.warn(`[config] PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS inválido "${raw}" — usando fallback ${fallback} (>=1)`);
  }
  return fallback;
}

function parseLobbyRetornoCallbackUrl(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocolo não suportado');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('LOBBY_RETORNO_CALLBACK_URL deve ser uma URL HTTP(S) válida');
  }
}

function parseLobbyDesistenciaCallbackUrl(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocolo não suportado');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('LOBBY_DESISTENCIA_CALLBACK_URL deve ser uma URL HTTP(S) válida');
  }
}

function parseSessionAccessTtlSeconds(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_SESSION_ACCESS_TTL_SECONDS);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_SESSION_ACCESS_TTL_SECONDS;
}

function parseSessionRefreshTtlSeconds(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_SESSION_REFRESH_TTL_SECONDS);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_SESSION_REFRESH_TTL_SECONDS;
}

function parseCookieSecure(raw: string | undefined, isProduction: boolean): boolean {
  if (raw === undefined) {
    // Default: true em produção, false em desenvolvimento.
    return isProduction;
  }
  return raw.toLowerCase() === 'true';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  console.warn(`[config] valor inválido "${raw}" — usando fallback ${fallback}`);
  return fallback;
}

export function createRedisClientOptions(redis: Config['redis']): { host: string; port: number; password?: string; lazyConnect: true; maxRetriesPerRequest: null } {
  return {
    host: redis.host,
    port: redis.port,
    password: redis.password,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

export * from './serviceToken.js';

export function criarClienteRedis(): Redis {
  const { redis } = getConfig();
  const cliente = new Redis(createRedisClientOptions(redis));
  cliente.on('error', (error: Error) => {
    console.error('[redis] error:', error.message);
  });
  return cliente;
}

function parseLobbyPublicUrl(raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocolo não suportado');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('LOBBY_PUBLIC_URL deve ser uma URL HTTP(S) válida');
  }
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
  const lobbyPublicUrl = parseLobbyPublicUrl(
    process.env.LOBBY_PUBLIC_URL as string | undefined,
    `http://localhost:${lobbyServerPort}`,
  );

  const jwtSecret = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET ?? DEFAULT_JWT_REFRESH_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieSecure = parseCookieSecure(process.env.COOKIE_SECURE as string | undefined, isProduction);
  const sessionAccessTtlSeconds = parseSessionAccessTtlSeconds(
    process.env.SESSION_ACCESS_TTL_SECONDS as string | undefined,
  );
  const sessionRefreshTtlSeconds = parseSessionRefreshTtlSeconds(
    process.env.SESSION_REFRESH_TTL_SECONDS as string | undefined,
  );
  const poolMax = parsePoolMax(process.env.PG_POOL_MAX);
  const partidaPreparadaTtlSegundos = parsePartidaPreparadaTtlSegundos(
    process.env.PARTIDA_PREPARADA_TTL_SEGUNDOS as string | undefined,
  );
  const partidaTerminadaTtlSegundos = parsePartidaTerminadaTtlSegundos(
    process.env.PARTIDA_TERMINADA_TTL_SEGUNDOS as string | undefined,
  );
  const partidaNaoInicioSegundos = parsePartidaNaoInicioSegundos(
    process.env.PARTIDA_NAO_INICIO_SEGUNDOS as string | undefined,
  );
  const partidaReconexaoEmAndamentoSegundos = parsePartidaReconexaoEmAndamentoSegundos(
    process.env.PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS as string | undefined,
  );
  const lobbyRetornoCallbackUrl = parseLobbyRetornoCallbackUrl(
    process.env.LOBBY_RETORNO_CALLBACK_URL as string | undefined,
    `http://localhost:${lobbyServerPort}/api/retorno`,
  );
  const lobbyDesistenciaCallbackUrl = parseLobbyDesistenciaCallbackUrl(
    process.env.LOBBY_DESISTENCIA_CALLBACK_URL as string | undefined,
    `http://localhost:${lobbyServerPort}/api/desistencia`,
  );

  const postgres = {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parsePort(process.env.POSTGRES_PORT as string | undefined, 5432),
    user: process.env.POSTGRES_USER ?? 'flicker',
    password: process.env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'flicker',
    poolMax,
  };

  if (isProduction) {
    if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
      throw new Error('JWT_SECRET deve ser definido em produção');
    }
    if (!jwtRefreshSecret || jwtRefreshSecret === DEFAULT_JWT_REFRESH_SECRET) {
      throw new Error('JWT_REFRESH_SECRET deve ser definido em produção');
    }
    if (!postgres.password || postgres.password === DEFAULT_POSTGRES_PASSWORD) {
      throw new Error('POSTGRES_PASSWORD deve ser definido em produção');
    }
    if (process.env.LOBBY_PUBLIC_URL === undefined) {
      throw new Error('LOBBY_PUBLIC_URL deve ser definido em produção');
    }
  }

  const redis = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parsePort(process.env.REDIS_PORT as string | undefined, 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
  };

  let gameServerHeartbeatIntervalMs = parsePositiveInt(
    process.env.GAME_SERVER_HEARTBEAT_INTERVAL_MS as string | undefined,
    DEFAULT_GAME_SERVER_HEARTBEAT_INTERVAL_MS,
  );

  let gameServerHeartbeatTtlMs = parsePositiveInt(
    process.env.GAME_SERVER_HEARTBEAT_TTL_MS as string | undefined,
    DEFAULT_GAME_SERVER_HEARTBEAT_TTL_MS,
  );

  if (gameServerHeartbeatIntervalMs >= gameServerHeartbeatTtlMs) {
    console.warn(
      `[config] GAME_SERVER_HEARTBEAT_INTERVAL_MS (${gameServerHeartbeatIntervalMs}) >= TTL (${gameServerHeartbeatTtlMs}) — ajustando TTL para ${gameServerHeartbeatIntervalMs * 3}`,
    );
    gameServerHeartbeatTtlMs = gameServerHeartbeatIntervalMs * 3;
  }

  const rawGameServerId = process.env.GAME_SERVER_ID as string | undefined;
  const gameServerId = rawGameServerId && rawGameServerId.trim().length > 0 ? sanitizeServerId(rawGameServerId) : undefined;

  const rawGameServerAdvertiseHost = process.env.GAME_SERVER_ADVERTISE_HOST as string | undefined;
  const gameServerAdvertiseHost =
    rawGameServerAdvertiseHost && rawGameServerAdvertiseHost.trim().length > 0
      ? rawGameServerAdvertiseHost.trim()
      : DEFAULT_GAME_SERVER_ADVERTISE_HOST;

  return {
    gameServerPort,
    lobbyServerPort,
    lobbyPublicUrl,
    jwtSecret,
    jwtRefreshSecret,
    cookieSecure,
    sessionAccessTtlSeconds,
    sessionRefreshTtlSeconds,
    partidaPreparadaTtlSegundos,
    partidaTerminadaTtlSegundos,
    partidaNaoInicioSegundos,
    partidaReconexaoEmAndamentoSegundos,
    lobbyRetornoCallbackUrl,
    lobbyDesistenciaCallbackUrl,
    postgres,
    redis,
    gameServerHeartbeatIntervalMs,
    gameServerHeartbeatTtlMs,
    gameServerId,
    gameServerAdvertiseHost,
  };
}

export {
  SERVICE_TOKEN_AUDIENCE,
  BOT_TOKEN_AUDIENCE,
  assinarServiceToken,
  assinarBotToken,
  verificarBotToken,
  type PayloadBotToken,
} from './serviceToken.js';
