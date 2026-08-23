import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { describe } from 'node:test';
import { Redis } from 'ioredis';
import { anunciar, iniciarHeartbeat, pararHeartbeat, removerRegistro } from './registro.ts';
import { listarGameServersDisponiveis, estaDisponivel } from '../../../lobby-server/src/redis/gameServers.ts';

function criarRedis(): Redis | null {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const password = process.env.REDIS_PASSWORD ?? undefined;
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

    await anunciar(redis, serverId, meta, ttlMs);

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

    const handle = iniciarHeartbeat(redis, serverId, meta, intervalMs, ttlMs);

    // espera 2 ciclos de heartbeat
    await sleep(intervalMs * 2 + 200);

    const ttl1 = await redis.pttl(`game-servers:disponiveis:${serverId}`);
    assert.ok(ttl1 > 1000, `TTL deveria ter sido renovado, mas pttl=${ttl1}`);

    await sleep(intervalMs + 200);
    const ttl2 = await redis.pttl(`game-servers:disponiveis:${serverId}`);
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

    const handle = iniciarHeartbeat(redis, serverId, meta, intervalMs, ttlMs);

    await sleep(500);
    assert.equal(await estaDisponivel(redis, serverId), true);

    // para heartbeat e aguarda expiração
    pararHeartbeat(handle);
    await sleep(ttlMs + 800);

    const disponivel = await estaDisponivel(redis, serverId);
    assert.equal(disponivel, false, 'deveria ter expirado após parar heartbeat');

    const lista = await listarGameServersDisponiveis(redis);
    assert.equal(lista.find((g) => g.serverId === serverId), undefined, 'não deveria estar na listagem após expirar');

    // cleanup garantido
    await removerRegistro(redis, serverId).catch(() => {});
    await redis.quit().catch(() => {});
  });
});
