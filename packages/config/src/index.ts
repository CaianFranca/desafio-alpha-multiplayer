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
  partidaChatHistoricoMaximo: number;
  trustProxyHops: number;
  authRateLimitJanelaSegundos: number;
  authRateLimitMaxPorIp: number;
  authRateLimitMaxPorCadastro: number;
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
  /** Origens exatas autorizadas a abrir o WS (issue #409); sem wildcard. */
  wsOrigensPermitidas: string[];
  /** Teto de bytes por mensagem WS (issue #409). */
  wsMaxPayloadBytes: number;
  /** Máximo de mensagens por conexão dentro da janela do rate limit (issue #409). */
  wsLimiteMensagens: number;
  /** Janela em ms do rate limit geral por conexão (issue #409). */
  wsJanelaLimiteMensagensMs: number;
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
const DEFAULT_TRUST_PROXY_HOPS = 1;
const MINIMO_TRUST_PROXY_HOPS = 0;
const MAXIMO_TRUST_PROXY_HOPS = 10;
const DEFAULT_AUTH_RATE_LIMIT_JANELA_SEGUNDOS = 900;
const DEFAULT_AUTH_RATE_LIMIT_MAX_POR_IP = 30;
const DEFAULT_AUTH_RATE_LIMIT_MAX_POR_CADASTRO = 10;
/**
 * Teto do histórico de chat por Partida (issue #388): fonte única do default
 * 50 (faixa 1..200). `historico-chat.ts` importa este default em vez de
 * triplicar o literal — mudar aqui propaga para parse + domínio.
 */
export const DEFAULT_PARTIDA_CHAT_HISTORICO_MAXIMO = 50;
export const MINIMO_PARTIDA_CHAT_HISTORICO_MAXIMO = 1;
export const MAXIMO_PARTIDA_CHAT_HISTORICO_MAXIMO = 200;
// Defaults e faixas do endurecimento do WS (issue #409): teto de payload e
// rate limit geral por conexão. Exportados para reuso em testes e backends.
export const DEFAULT_WS_MAX_PAYLOAD_BYTES = 65536;
export const MIN_WS_MAX_PAYLOAD_BYTES = 1024;
export const MAX_WS_MAX_PAYLOAD_BYTES = 1048576;
export const DEFAULT_WS_LIMITE_MENSAGENS = 100;
export const MIN_WS_LIMITE_MENSAGENS = 1;
export const MAX_WS_LIMITE_MENSAGENS = 10000;
export const DEFAULT_WS_JANELA_LIMITE_MENSAGENS_MS = 10000;
export const MIN_WS_JANELA_LIMITE_MENSAGENS_MS = 100;
export const MAX_WS_JANELA_LIMITE_MENSAGENS_MS = 600000;
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
// Histórico do chat de Partida (issue #388): lista Redis própria por Partida,
// fora do blob de estado, com mesmo ciclo/TTL das chaves da Partida. Prefixo
// com hífen (não com ':') para não poluir o SCAN `game-server:partida:*` do
// rearme do não-início (ver `nao-inicio.ts:212`) — mesmo padrão do prefixo
// de estado.
export const GAME_SERVERS_PARTIDA_CHAT_PREFIXO = 'game-server:partida-chat:';

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

/**
 * Parser inteiro genérico dos TTLs de partida com faixa mínima/máxima:
 * devolve o valor quando inteiro dentro da faixa, senão o fallback (com warn
 * só quando a env veio definida mas inválida — inclusive vazia; ausente cai
 * silenciosamente no default, como os demais parsers deste módulo).
 */
function parseInteiroComLimites(
  raw: string | undefined,
  fallback: number,
  label: string,
  minimo: number,
  maximo?: number,
): number {
  const vazio = raw !== undefined && raw.trim() === '';
  const parsed = Number(raw ?? fallback);
  if (!vazio && Number.isInteger(parsed) && parsed >= minimo && (maximo === undefined || parsed <= maximo)) {
    return parsed;
  }
  if (raw !== undefined) {
    const faixa = maximo === undefined ? `(>=${minimo})` : `(${minimo}..${maximo})`;
    console.warn(`[config] ${label} inválido "${raw}" — usando fallback ${fallback} ${faixa}`);
  }
  return fallback;
}

function parsePartidaNaoInicioSegundos(raw: string | undefined): number {
  return parseInteiroComLimites(raw, DEFAULT_PARTIDA_NAO_INICIO_SEGUNDOS, 'PARTIDA_NAO_INICIO_SEGUNDOS', 10, 600);
}

function parsePartidaReconexaoEmAndamentoSegundos(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS,
    'PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS',
    1,
  );
}

function parsePartidaChatHistoricoMaximo(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_PARTIDA_CHAT_HISTORICO_MAXIMO,
    'PARTIDA_CHAT_HISTORICO_MAXIMO',
    MINIMO_PARTIDA_CHAT_HISTORICO_MAXIMO,
    MAXIMO_PARTIDA_CHAT_HISTORICO_MAXIMO,
  );
}

function parseTrustProxyHops(raw: string | undefined): number {
  return parseInteiroComLimites(raw, DEFAULT_TRUST_PROXY_HOPS, 'TRUST_PROXY_HOPS', MINIMO_TRUST_PROXY_HOPS, MAXIMO_TRUST_PROXY_HOPS);
}

function parseAuthRateLimitJanelaSegundos(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_AUTH_RATE_LIMIT_JANELA_SEGUNDOS,
    'AUTH_RATE_LIMIT_JANELA_SEGUNDOS',
    1,
    86400,
  );
}

function parseAuthRateLimitMaxPorIp(raw: string | undefined): number {
  return parseInteiroComLimites(raw, DEFAULT_AUTH_RATE_LIMIT_MAX_POR_IP, 'AUTH_RATE_LIMIT_MAX_POR_IP', 1, 100000);
}

function parseAuthRateLimitMaxPorCadastro(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_AUTH_RATE_LIMIT_MAX_POR_CADASTRO,
    'AUTH_RATE_LIMIT_MAX_POR_CADASTRO',
    1,
    100000,
  );
}

function parseWsMaxPayloadBytes(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_WS_MAX_PAYLOAD_BYTES,
    'WS_MAX_PAYLOAD_BYTES',
    MIN_WS_MAX_PAYLOAD_BYTES,
    MAX_WS_MAX_PAYLOAD_BYTES,
  );
}

function parseWsLimiteMensagens(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_WS_LIMITE_MENSAGENS,
    'WS_LIMITE_MENSAGENS',
    MIN_WS_LIMITE_MENSAGENS,
    MAX_WS_LIMITE_MENSAGENS,
  );
}

function parseWsJanelaLimiteMensagensMs(raw: string | undefined): number {
  return parseInteiroComLimites(
    raw,
    DEFAULT_WS_JANELA_LIMITE_MENSAGENS_MS,
    'WS_JANELA_LIMITE_MENSAGENS_MS',
    MIN_WS_JANELA_LIMITE_MENSAGENS_MS,
    MAX_WS_JANELA_LIMITE_MENSAGENS_MS,
  );
}

/**
 * Origens exatas autorizadas no WS (issue #409). O `Origin` de navegador é
 * sempre `scheme://host:port` e nunca carrega subpath, por isso o default
 * deriva `.origin` de `lobbyPublicUrl` (tolerando deploy sob base path, ex.:
 * VITE_BASE_PATH=/server01). Sem env em desenvolvimento, libera as portas
 * padrão do Vite para o frontend local.
 */
function parseWsOrigensPermitidas(
  raw: string | undefined,
  lobbyPublicUrl: string,
  isProduction: boolean,
): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    const origens = new Set<string>([new URL(lobbyPublicUrl).origin]);
    if (!isProduction) {
      origens.add('http://localhost:5173');
      origens.add('http://127.0.0.1:5173');
    }
    return [...origens];
  }

  const origens = new Set<string>();
  for (const entrada of raw.split(',')) {
    const valor = entrada.trim();
    if (valor.length === 0) {
      continue;
    }
    if (valor.includes('*')) {
      throw new Error('WS_ORIGENS_PERMITIDAS não aceita wildcard — informe origens exatas');
    }
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      throw new Error(`WS_ORIGENS_PERMITIDAS deve conter origens HTTP(S) absolutas: "${valor}"`);
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error(`WS_ORIGENS_PERMITIDAS deve conter origens HTTP(S) absolutas: "${valor}"`);
    }
    origens.add(url.origin);
  }
  return [...origens];
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
  const partidaChatHistoricoMaximo = parsePartidaChatHistoricoMaximo(
    process.env.PARTIDA_CHAT_HISTORICO_MAXIMO as string | undefined,
  );
  const trustProxyHops = parseTrustProxyHops(process.env.TRUST_PROXY_HOPS as string | undefined);
  const authRateLimitJanelaSegundos = parseAuthRateLimitJanelaSegundos(
    process.env.AUTH_RATE_LIMIT_JANELA_SEGUNDOS as string | undefined,
  );
  const authRateLimitMaxPorIp = parseAuthRateLimitMaxPorIp(
    process.env.AUTH_RATE_LIMIT_MAX_POR_IP as string | undefined,
  );
  const authRateLimitMaxPorCadastro = parseAuthRateLimitMaxPorCadastro(
    process.env.AUTH_RATE_LIMIT_MAX_POR_CADASTRO as string | undefined,
  );
  const wsOrigensPermitidas = parseWsOrigensPermitidas(
    process.env.WS_ORIGENS_PERMITIDAS as string | undefined,
    lobbyPublicUrl,
    isProduction,
  );
  const wsMaxPayloadBytes = parseWsMaxPayloadBytes(process.env.WS_MAX_PAYLOAD_BYTES as string | undefined);
  const wsLimiteMensagens = parseWsLimiteMensagens(process.env.WS_LIMITE_MENSAGENS as string | undefined);
  const wsJanelaLimiteMensagensMs = parseWsJanelaLimiteMensagensMs(
    process.env.WS_JANELA_LIMITE_MENSAGENS_MS as string | undefined,
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
    const trustProxyHopsBruto = process.env.TRUST_PROXY_HOPS;
    if (trustProxyHopsBruto === undefined || trustProxyHopsBruto.trim().length === 0) {
      throw new Error('TRUST_PROXY_HOPS deve ser definido explicitamente em produção');
    }
    const trustProxyHopsNumero = Number(trustProxyHopsBruto);
    if (
      !Number.isInteger(trustProxyHopsNumero)
      || trustProxyHopsNumero < MINIMO_TRUST_PROXY_HOPS
      || trustProxyHopsNumero > MAXIMO_TRUST_PROXY_HOPS
    ) {
      throw new Error(`TRUST_PROXY_HOPS inválido em produção: "${trustProxyHopsBruto}"`);
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
    partidaChatHistoricoMaximo,
    trustProxyHops,
    authRateLimitJanelaSegundos,
    authRateLimitMaxPorIp,
    authRateLimitMaxPorCadastro,
    lobbyRetornoCallbackUrl,
    lobbyDesistenciaCallbackUrl,
    postgres,
    redis,
    gameServerHeartbeatIntervalMs,
    gameServerHeartbeatTtlMs,
    gameServerId,
    gameServerAdvertiseHost,
    wsOrigensPermitidas,
    wsMaxPayloadBytes,
    wsLimiteMensagens,
    wsJanelaLimiteMensagensMs,
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
