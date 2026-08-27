// Teste de wiring + integração de `GET /api/game-servers`.
// Garante que o merge não remova o mount do router (regressão a43f1fc -> 404)
// e que o SCAN+MGET canônico + guard JWT funcionem em runtime.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import { GAME_SERVERS_PREFIX } from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { redisClient } from '../src/config/redis.ts';
import { SERVICE_TOKEN_AUDIENCE, assinarServiceToken } from '../src/middleware/serviceToken.ts';
import { Redis } from 'ioredis';

interface ServidorEfemero {
  baseUrl: string;
  fechar(): Promise<void>;
}

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  retryStrategy: () => null,
  enableOfflineQueue: false,
});
let appServidor: ReturnType<typeof createApp> | null = null;

async function subirServidor(): Promise<ServidorEfemero> {
  if (appServidor === null) {
    appServidor = createApp();
  }
  const server = http.createServer(appServidor);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
  };
}

async function comServidor<T>(executar: (servidor: ServidorEfemero) => Promise<T>): Promise<T> {
  const servidor = await subirServidor();
  try {
    return await executar(servidor);
  } finally {
    await servidor.fechar();
  }
}

async function limparGameServers(): Promise<void> {
  // Remove só chaves do registro de game-servers para não interferir com outros testes
  try {
    if (redis.status !== 'ready') return;
    const chaves: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${GAME_SERVERS_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) chaves.push(...keys);
    } while (cursor !== '0');
    if (chaves.length > 0) await redis.del(...chaves);
  } catch {
    // Redis indisponível — ignora limpeza
  }
}

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    // Redis não disponível — cada teste fará t.skip individualmente
  }
});

async function redisDisponivel(): Promise<boolean> {
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

// Em CI, ausência de Redis deve falhar explicitamente (não pular em silêncio),
// senão o critério "testes de integração" da issue #47 passa vazio.
async function exigeRedis(t: import('node:test').TestContext): Promise<boolean> {
  if (await redisDisponivel()) return true;
  if (process.env.CI) {
    throw new Error('Redis obrigatório em CI — testes de integração não podem pular');
  }
  t.skip('Redis não disponível — pule integração');
  return false;
}

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit().catch(() => redis.disconnect());
  } else {
    redis.disconnect();
  }
  // Encerra o singleton redisClient usado pelo router (routes/gameServers.ts:10),
  // que o app abre durante os testes e ninguém fechava → travava o CI (event loop
  // não esvaziava). O `pool` é encerrado uma única vez no último arquivo
  // (ws-auth.integration.test.ts) para não depender da ordem do glob.
  await redisClient.quit().catch(() => undefined);
});

beforeEach(async () => {
  await limparGameServers();
});

// --- 1. wiring: rota montada no createApp (regressão a43f1fc) ---

test('wiring: createApp monta /api/game-servers (router com GET /)', () => {
  const app = createApp();
  const stack = (app as unknown as { router: { stack: Array<{ name: string; handle: { stack: Array<{ route?: { path: string } }> } }> } }).router.stack;
  const routers = stack.filter((l) => l.name === 'router');
  // authRouter + gameServersRouter
  assert.equal(routers.length, 2, `esperava 2 routers (auth + game-servers), veio ${routers.length}`);
  const gameServersRouter = routers[1];
  const hasRootGet = gameServersRouter.handle.stack.some((l) => l.route?.path === '/');
  assert.ok(hasRootGet, 'gameServersRouter deveria ter GET / montado');
});

test('GET /api/game-servers wiring: 200 [] quando nenhum game-server registrado (dev)', async (t) => {
  if (!(await exigeRedis(t))) return;
  await comServidor(async (servidor) => {
    const res = await fetch(`${servidor.baseUrl}/api/game-servers`);
    assert.equal(res.status, 200, `esperava 200, veio ${res.status} body=${await res.clone().text()}`);
    const body = (await res.json()) as unknown[];
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });
});

// --- 2. lista o que foi anunciado via SET PX (SCAN+MGET canônico) ---

test('GET /api/game-servers lista game-server anunciado via SET PX', async (t) => {
  if (!(await exigeRedis(t))) return;
  await comServidor(async (servidor) => {
    const serverId = `test-${Date.now()}-a`;
    const payload = JSON.stringify({ serverId, url: 'http://game-server:1234', atualizadoEm: new Date().toISOString() });
    await redis.set(`${GAME_SERVERS_PREFIX}${serverId}`, payload, 'PX', 15000);

    const res = await fetch(`${servidor.baseUrl}/api/game-servers`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Array<{ serverId: string; url: string }>;
    const encontrado = body.find((g) => g.serverId === serverId);
    assert.ok(encontrado, `game-server ${serverId} não apareceu na listagem`);
    assert.equal(encontrado.url, 'http://game-server:1234');

    await redis.del(`${GAME_SERVERS_PREFIX}${serverId}`);
  });
});

// --- 3. não lista expirado / removido ---

test('GET /api/game-servers não lista após DEL (expirado)', async (t) => {
  if (!(await exigeRedis(t))) return;
  await comServidor(async (servidor) => {
    const serverId = `test-${Date.now()}-b`;
    const payload = JSON.stringify({ serverId, url: 'http://game-server:1234', atualizadoEm: new Date().toISOString() });
    await redis.set(`${GAME_SERVERS_PREFIX}${serverId}`, payload, 'PX', 15000);

    let res = await fetch(`${servidor.baseUrl}/api/game-servers`);
    let body = (await res.json()) as Array<{ serverId: string }>;
    assert.ok(body.find((g) => g.serverId === serverId));

    await redis.del(`${GAME_SERVERS_PREFIX}${serverId}`);

    res = await fetch(`${servidor.baseUrl}/api/game-servers`);
    body = (await res.json()) as Array<{ serverId: string }>;
    assert.equal(body.find((g) => g.serverId === serverId), undefined);
  });
});

// --- 4. guard JWT em produção ---

test('GET /api/game-servers guard JWT em produção: sem token / lixo / secret errado / expirado / JWT de jogador → 401, service token → 200', async (t) => {
  if (!(await exigeRedis(t))) return;
  const secretOrig = process.env.JWT_SECRET;
  const nodeEnvOrig = process.env.NODE_ENV;
  const refreshOrig = process.env.JWT_REFRESH_SECRET;
  const pgOrig = process.env.POSTGRES_PASSWORD;
  const lobbyOrig = process.env.LOBBY_PUBLIC_URL;
  // Usa secrets temporários para não depender do .env do dev. Em produção,
  // getConfig() valida JWT_REFRESH_SECRET / POSTGRES_PASSWORD / LOBBY_PUBLIC_URL
  // (packages/config/src/index.ts:219-232); sem eles o teste falha em checkout limpo.
  process.env.JWT_SECRET = `test-secret-${Date.now()}`;
  process.env.JWT_REFRESH_SECRET = `test-refresh-${Date.now()}`;
  process.env.POSTGRES_PASSWORD = `test-pg-${Date.now()}`;
  process.env.LOBBY_PUBLIC_URL = 'http://localhost:3000';
  process.env.NODE_ENV = 'production';
  // força recriação do app com novo NODE_ENV
  appServidor = createApp();

  try {
    await comServidor(async (servidor) => {
      const { jwtSecret } = getConfig();

      // sem header → 401
      let res = await fetch(`${servidor.baseUrl}/api/game-servers`);
      assert.equal(res.status, 401);

      // Bearer lixo → 401
      res = await fetch(`${servidor.baseUrl}/api/game-servers`, {
        headers: { authorization: 'Bearer lixo.com.lixo' },
      });
      assert.equal(res.status, 401);

      // secret errado → 401
      const tokenErrado = jwt.sign({ sub: 'x' }, 'secret-errado', { expiresIn: '1h' });
      res = await fetch(`${servidor.baseUrl}/api/game-servers`, {
        headers: { authorization: `Bearer ${tokenErrado}` },
      });
      assert.equal(res.status, 401);

      // expirado → 401
      const tokenExpirado = jwt.sign({ sub: 'x' }, jwtSecret, { expiresIn: '1ms' });
      await new Promise((r) => setTimeout(r, 10));
      res = await fetch(`${servidor.baseUrl}/api/game-servers`, {
        headers: { authorization: `Bearer ${tokenExpirado}` },
      });
      assert.equal(res.status, 401);

      // JWT válido de Jogador (sem audience de serviço) → 401
      // R1: assinatura válida não basta — só token de serviço com aud correto passa.
      const tokenJogador = jwt.sign({ sub: 'x' }, jwtSecret, { expiresIn: '1h' });
      res = await fetch(`${servidor.baseUrl}/api/game-servers`, {
        headers: { authorization: `Bearer ${tokenJogador}` },
      });
      assert.equal(res.status, 401);

      // service token válido (aud de serviço, emitido por assinarServiceToken) → 200
      const tokenServico = assinarServiceToken();
      res = await fetch(`${servidor.baseUrl}/api/game-servers`, {
        headers: { authorization: `Bearer ${tokenServico}` },
      });
      assert.equal(res.status, 200);
    });
  } finally {
    // restaura env e recria app em modo dev para próximos testes
    if (secretOrig === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secretOrig;
    if (refreshOrig === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = refreshOrig;
    if (pgOrig === undefined) delete process.env.POSTGRES_PASSWORD;
    else process.env.POSTGRES_PASSWORD = pgOrig;
    if (lobbyOrig === undefined) delete process.env.LOBBY_PUBLIC_URL;
    else process.env.LOBBY_PUBLIC_URL = lobbyOrig;
    if (nodeEnvOrig === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOrig;
    appServidor = createApp();
  }
});
