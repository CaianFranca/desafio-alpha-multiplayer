import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { GAME_SERVERS_PREFIX, sanitizeServerId } from '@flicker/config';

export { GAME_SERVERS_PREFIX };

export interface GameServerRegistro {
  serverId: string;
  url?: string;
  host?: string;
  port?: number;
  atualizadoEm: string;
  [key: string]: unknown;
}

export function chaveGameServer(serverId: string): string {
  return `${GAME_SERVERS_PREFIX}${serverId}`;
}

export function resolverServerId(configId: string | undefined): string {
  if (configId && configId.trim().length > 0) {
    const sanitized = sanitizeServerId(configId);
    if (sanitized.length === 0 || /^[-]+$/.test(sanitized)) {
      return randomUUID();
    }
    return sanitized;
  }
  return randomUUID();
}

/**
 * Anuncia o game-server no Redis com TTL (lease).
 * Usa SET com PX para criar/atualizar a chave atomically.
 */
export async function anunciar(
  redis: Redis,
  serverId: string,
  meta: GameServerRegistro,
  ttlMs: number,
): Promise<void> {
  const chave = chaveGameServer(serverId);
  const payload = JSON.stringify(meta);
  // PX define TTL em ms; SET sobrescreve e renova lease
  await redis.set(chave, payload, 'PX', ttlMs);
}

export async function removerRegistro(redis: Redis, serverId: string): Promise<void> {
  const chave = chaveGameServer(serverId);
  await redis.del(chave);
}

export interface HeartbeatHandle {
  stop: () => void;
  timer: NodeJS.Timeout;
}

/**
 * Inicia heartbeat periódico que renova o lease via SET EX.
 * @param redis cliente ioredis (lazyConnect permitido)
 * @param serverId id do servidor (gerado ou via env)
 * @param meta metadados JSON a armazenar (deve incluir serverId e atualizadoEm)
 * @param intervalMs intervalo entre renovações (default 5000)
 * @param ttlMs TTL do lease (default 15000)
 * @param getMeta opcional: factory para gerar meta fresca a cada tick (atualiza timestamp)
 * @returns handle com stop()
 */
export function iniciarHeartbeat(
  redis: Redis,
  serverId: string,
  meta: GameServerRegistro,
  intervalMs: number,
  ttlMs: number,
  getMeta?: () => GameServerRegistro,
): HeartbeatHandle {
  // Anúncio imediato (fire-and-forget com log)
  void anunciar(redis, serverId, meta, ttlMs).catch((err: unknown) => {
    console.error('[game-server/registro] falha ao anunciar:', (err as Error).message);
  });

  const timer = setInterval(() => {
    const base = getMeta ? getMeta() : { ...meta, atualizadoEm: new Date().toISOString() };
    const currentMeta = base.serverId ? base : { ...base, serverId };
    void anunciar(redis, serverId, currentMeta, ttlMs).catch((err: unknown) => {
      console.error('[game-server/registro] falha no heartbeat:', (err as Error).message);
    });
  }, intervalMs);

  // Não impede o event loop de encerrar sozinho se for o único timer restante
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const stop = (): void => {
    clearInterval(timer);
  };

  return { stop, timer };
}

export function pararHeartbeat(handle: HeartbeatHandle | undefined): void {
  if (!handle) {
    return;
  }
  handle.stop();
}
