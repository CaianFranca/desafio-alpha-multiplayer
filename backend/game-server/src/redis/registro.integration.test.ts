import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { describe } from 'node:test';
import { Redis } from 'ioredis';
import { DEFAULT_REDIS_PASSWORD, GAME_SERVERS_PREFIX } from '@flicker/config';
import { estaDisponivel, listarGameServersDisponiveis } from '@flicker/shared/server';
import { anunciar, iniciarHeartbeat, pararHeartbeat, removerRegistro } from './registro.ts';

function criarRedis(): Redis | null {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const password = process.env.REDIS_PASSWORD ?? DEFAULT_REDIS_PASSWORD;
  // Se Redis não estiver disponível, o teste será skipado
  return new Redis({ host, port, password, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000 });
}

async function redisDisponivel(redis: Redis): Promise<boolean> {
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarExpiracao(
  redis: Redis,
  serverId: string,
  ttlMs: number,
  timeoutMs: number = ttlMs + 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const disponivel = await estaDisponivel(redis, serverId);
    if (!disponivel) return true;
    await sleep(150);
  }
  return false;
}

describe('registro de game-servers no Redis com heartbeat', () => {
  test('um game-server ativo aparece como disponível no registro do lobby', async (t) => {
    const redis = criarRedis()!;
    if (!(await redisDisponivel(redis))) {
      t.skip('Redis não disponível — pule integração');
      await redis.quit().catch(() => {});
      return;
    }

    const serverId = `test-${randomUUID()}`;
    const ttlMs = 2000;
    const meta = { serverId, url: 'http://game-server:1234', atualizadoEm: new Date().toISOString() };

    await anunciar(redis, meta, ttlMs);

    // Usa implementação real do lobby (SCAN+MGET) — cobre o critério "o lobby enxerga os disponíveis"
    const disponiveis = await listarGameServersDisponiveis(redis);
    const encontrado = disponiveis.find((g) => g.serverId === serverId);
    assert.ok(encontrado, 'game-server deveria aparecer em listarGameServersDisponiveis');
    assert.equal(await estaDisponivel(redis, serverId), true);

    // cleanup
    await removerRegistro(redis, serverId);
    const aposRemover = await listarGameServersDisponiveis(redis);
    assert.equal(aposRemover.find((g) => g.serverId === serverId), undefined);

    await redis.quit().catch(() => {});
  });

  test('heartbeat renova a disponibilidade do game-server', async (t) => {
    const redis = criarRedis()!;
    if (!(await redisDisponivel(redis))) {
      t.skip('Redis não disponível — pule integração');
      await redis.quit().catch(() => {});
      return;
    }

    const serverId = `test-${randomUUID()}`;
    const ttlMs = 3000;
    const intervalMs = 800;
    const meta = { serverId, url: 'http://game-server:1234', atualizadoEm: new Date().toISOString() };

    const handle = iniciarHeartbeat(redis, meta, intervalMs, ttlMs);

    // espera 2 ciclos de heartbeat
    await sleep(intervalMs * 2 + 200);

    const ttl1 = await redis.pttl(`${GAME_SERVERS_PREFIX}${serverId}`);
    assert.ok(ttl1 > 1000, `TTL deveria ter sido renovado, mas pttl=${ttl1}`);

    await sleep(intervalMs + 200);
    const ttl2 = await redis.pttl(`${GAME_SERVERS_PREFIX}${serverId}`);
    assert.ok(ttl2 > 1000, `TTL deveria continuar renovado, pttl=${ttl2}`);

    const disponiveis = await listarGameServersDisponiveis(redis);
    assert.ok(disponiveis.find((g) => g.serverId === serverId), 'deveria continuar disponível após heartbeats');

    pararHeartbeat(handle);
    await removerRegistro(redis, serverId);
    await redis.quit().catch(() => {});
  });

  test('um game-server que para de renovar expira do registro', async (t) => {
    const redis = criarRedis()!;
    if (!(await redisDisponivel(redis))) {
      t.skip('Redis não disponível — pule integração');
      await redis.quit().catch(() => {});
      return;
    }

    const serverId = `test-${randomUUID()}`;
    const ttlMs = 2000;
    const intervalMs = 700;
    const meta = { serverId, url: 'http://game-server:1234', atualizadoEm: new Date().toISOString() };

    const handle = iniciarHeartbeat(redis, meta, intervalMs, ttlMs);

    await sleep(500);
    assert.equal(await estaDisponivel(redis, serverId), true);

    // para heartbeat e aguarda expiração via polling (evita flaky sleep fixo em CI lento)
    pararHeartbeat(handle);
    const expirou = await esperarExpiracao(redis, serverId, ttlMs);
    assert.equal(expirou, true, 'deveria ter expirado após parar heartbeat');

    const disponivel = await estaDisponivel(redis, serverId);
    assert.equal(disponivel, false, 'deveria ter expirado após parar heartbeat');

    const lista = await listarGameServersDisponiveis(redis);
    assert.equal(lista.find((g) => g.serverId === serverId), undefined, 'não deveria estar na listagem após expirar');

    // cleanup garantido
    await removerRegistro(redis, serverId).catch(() => {});
    await redis.quit().catch(() => {});
  });
});
