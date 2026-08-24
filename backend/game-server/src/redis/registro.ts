import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { GAME_SERVERS_PREFIX, chaveGameServer, sanitizeServerId } from '@flicker/config';

export { GAME_SERVERS_PREFIX, chaveGameServer };

export interface GameServerRegistro {
  serverId: string;
  url?: string;
  host?: string;
  port?: number;
  atualizadoEm: string;
  [key: string]: unknown;
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
 * serverId é derivado de meta.serverId — Data Clump removido.
 */
export async function anunciar(redis: Redis, meta: GameServerRegistro, ttlMs: number): Promise<void> {
  const chave = chaveGameServer(meta.serverId);
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
  getLastError: () => string | undefined;
}

/**
 * Inicia heartbeat periódico que renova o lease via SET EX.
 * @param redis cliente ioredis (lazyConnect permitido)
 * @param meta metadados JSON a armazenar (deve incluir serverId e atualizadoEm)
 * @param intervalMs intervalo entre renovações (default 5000)
 * @param ttlMs TTL do lease (default 15000)
 * @param getMeta opcional: factory para gerar meta fresca a cada tick (atualiza timestamp)
 * @returns handle com stop()
 */
export function iniciarHeartbeat(
  redis: Redis,
  meta: GameServerRegistro,
  intervalMs: number,
  ttlMs: number,
  getMeta?: () => GameServerRegistro,
): HeartbeatHandle {
  let lastError: string | undefined;

  // Anúncio imediato fire-and-forget intencional: heartbeat não bloqueia boot,
  // erro é logado e exposto via getLastError() para observabilidade; próximo tick retenta.
  void anunciar(redis, meta, ttlMs).catch((err: unknown) => {
    lastError = (err as Error).message;
    console.error('[game-server/registro] falha ao anunciar:', lastError);
  });

  const timer = setInterval(() => {
    const base = getMeta ? getMeta() : { ...meta, atualizadoEm: new Date().toISOString() };
    const currentMeta: GameServerRegistro = base.serverId ? base : { ...base, serverId: meta.serverId };
    // Garante serverId consistente se factory esqueceu
    if (!currentMeta.serverId) (currentMeta as GameServerRegistro).serverId = meta.serverId;
    void anunciar(redis, currentMeta, ttlMs).catch((err: unknown) => {
      lastError = (err as Error).message;
      console.error('[game-server/registro] falha no heartbeat:', lastError);
    });
  }, intervalMs);

  // Não impede o event loop de encerrar sozinho se for o único timer restante
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const stop = (): void => {
    clearInterval(timer);
  };
  const getLastError = (): string | undefined => lastError;

  return { stop, timer, getLastError };
}

export function pararHeartbeat(handle: HeartbeatHandle | undefined): void {
  if (!handle) {
    return;
  }
  handle.stop();
}
