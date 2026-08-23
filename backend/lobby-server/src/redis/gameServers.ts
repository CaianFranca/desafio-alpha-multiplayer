import type { Redis } from 'ioredis';
import { GAME_SERVERS_PREFIX } from '@flicker/config';

export { GAME_SERVERS_PREFIX };

export interface GameServerDisponivel {
  serverId: string;
  url?: string;
  host?: string;
  port?: number;
  atualizadoEm?: string;
  [key: string]: unknown;
}

export function chaveGameServer(serverId: string): string {
  return `${GAME_SERVERS_PREFIX}${serverId}`;
}

/**
 * Lista game-servers disponíveis via SCAN + MGET.
 * Usa SCAN (não KEYS) para não bloquear o Redis em produção.
 */
export async function listarGameServersDisponiveis(redis: Redis): Promise<GameServerDisponivel[]> {
  const chaves: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${GAME_SERVERS_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      chaves.push(...keys);
    }
  } while (cursor !== '0');

  if (chaves.length === 0) {
    return [];
  }

  const valores = await redis.mget(...chaves);

  const resultado: GameServerDisponivel[] = [];
  for (let i = 0; i < valores.length; i += 1) {
    const raw = valores[i];
    if (raw === null) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as GameServerDisponivel;
      // Garante serverId a partir da chave se ausente no payload
      if (!parsed.serverId) {
        const chave = chaves[i];
        const idFromKey = chave.slice(GAME_SERVERS_PREFIX.length);
        parsed.serverId = idFromKey;
      }
      resultado.push(parsed);
    } catch {
      // Entrada corrompida: ignora mas loga
      console.warn(`[lobby/redis] entrada corrompida ignorada: ${chaves[i]}`);
    }
  }

  return resultado;
}

export async function estaDisponivel(redis: Redis, serverId: string): Promise<boolean> {
  const chave = chaveGameServer(serverId);
  const exists = await redis.exists(chave);
  return exists === 1;
}

export const listarDisponiveis = listarGameServersDisponiveis;
export const isAvailable = estaDisponivel;
