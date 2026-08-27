import type { Redis } from 'ioredis';
import { GAME_SERVERS_PREFIX, chaveGameServer } from '@flicker/config';

export { GAME_SERVERS_PREFIX, chaveGameServer };

export interface GameServerDisponivel {
  serverId: string;
  url?: string;
  host?: string;
  port?: number;
  atualizadoEm?: string;
  [key: string]: unknown;
}

/**
 * Lista game-servers disponíveis via SCAN + MGET.
 * Usa SCAN (não KEYS) para não bloquear o Redis em produção.
 * Implementação canónica compartilhada entre lobby-server (prod) e game-server (test).
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

  // MGET em batches para evitar exceder max args do Redis com muitos game-servers
  const valores: (string | null)[] = [];
  for (let i = 0; i < chaves.length; i += 100) {
    const batch = chaves.slice(i, i + 100);
    const batchValores = await redis.mget(...batch);
    valores.push(...batchValores);
  }

  const resultado: GameServerDisponivel[] = [];
  for (let i = 0; i < valores.length; i += 1) {
    const raw = valores[i];
    if (raw === null) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as GameServerDisponivel;
      if (!parsed.serverId) {
        const chave = chaves[i];
        const idFromKey = chave.slice(GAME_SERVERS_PREFIX.length);
        parsed.serverId = idFromKey;
      }
      resultado.push(parsed);
    } catch (err) {
      console.warn(`[lobby/redis] entrada corrompida ignorada: ${chaves[i]} rawLen=${raw.length} err=${(err as Error).message}`);
    }
  }

  return resultado;
}

export async function estaDisponivel(redis: Redis, serverId: string): Promise<boolean> {
  const chave = chaveGameServer(serverId);
  const exists = await redis.exists(chave);
  return exists === 1;
}
