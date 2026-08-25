// Testes de integração WS autenticado no lobby-server (issue #40, ST-04).
// Valida: cookie httpOnly access JWT + existência da Sessão no Redis;
// rejeita Visitante (4401); identifica Jogador; múltiplas conexões mesmo Jogador.
// Usa PG+Redis reais conforme getConfig() (profile backend do compose).
// Estilo: node:test + assert/strict, espelha auth.integration.test.ts.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';

interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
  fechar(): Promise<void>;
}

interface Cookies {
  access_token?: string;
  refresh_token?: string;
}

const redis = criarClienteRedis();
let appServidor: ReturnType<typeof createApp> | null = null;
let contador = 0;

async function subirServidor(): Promise<ServidorEfemero> {
  if (appServidor === null) {
    appServidor = createApp();
  }
  const app = appServidor;
  const server = http.createServer(app);
  createWebSocketServer(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    wsUrl: `ws://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
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

function sufixo(): string {
  contador += 1;
  return `${contador}`;
}

function apelidoUnico(prefixo: string): string {
  return `${prefixo}-${sufixo()}`;
}

function emailUnico(prefixo: string): string {
  return `${prefixo}-${sufixo()}@exemplo.local`;
}

function extrairCookies(res: Response): Cookies {
  const setCookies = res.headers.getSetCookie();
  const cookies: Cookies = {};
  for (const raw of setCookies) {
    const [par] = raw.split(';');
    if (!par) continue;
    const eq = par.indexOf('=');
    if (eq === -1) continue;
    const nome = par.slice(0, eq).trim();
    const valor = par.slice(eq + 1).trim();
    if (nome === 'access_token' || nome === 'refresh_token') {
      cookies[nome] = valor;
    }
  }
  return cookies;
}

function headerDeCookies(cookies: Cookies): string {
  const partes: string[] = [];
  if (typeof cookies.access_token === 'string') {
    partes.push(`access_token=${cookies.access_token}`);
  }
  if (typeof cookies.refresh_token === 'string') {
    partes.push(`refresh_token=${cookies.refresh_token}`);
  }
  return partes.join('; ');
}

function postJson(baseUrl: string, path: string, corpo: unknown, cookies?: Cookies): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) {
    headers.cookie = cookieHeader;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function cadastroValido(sobrescreve: Partial<{ apelido: string; email: string; senha: string }> = {}): {
  apelido: string;
  email: string;
  senha: string;
} {
  return {
    apelido: apelidoUnico('jogador'),
    email: emailUnico('jogador'),
    senha: 'senha_dev_123',
    ...sobrescreve,
  };
}

function conectarWs(
  wsUrl: string,
  cookies?: Cookies,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const cookieHeader = headerDeCookies(cookies ?? {});
    if (cookieHeader.length > 0) {
      headers.Cookie = cookieHeader;
    }
    const ws = new WebSocket(wsUrl, { headers } as never);
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout ao conectar WS'));
    }, 3000);

    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.once('close', (code) => {
      clearTimeout(timeout);
      reject(new Error(`close prematuro code=${code}`));
    });
  });
}

function esperarClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout ao esperar close'));
    }, timeoutMs);
    ws.once('close', (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function esperarMensagem(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout mensagem')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

before(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(`Postgres indisponível para testes ws-auth: ${(error as Error).message}`);
  }
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para testes ws-auth: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit().catch(() => redis.disconnect());
  } else {
    redis.disconnect();
  }
  await pool.end().catch(() => undefined);
  setImmediate(() => process.exit(0));
});

beforeEach(async () => {
  await pool.query('DELETE FROM usuarios');
  await redis.flushdb();
});

// --- 1. sem sessão → close 4401 ---

test('WS sem sessão válida é rejeitado com close 4401', async () => {
  await comServidor(async (servidor) => {
    const ws = new WebSocket(servidor.wsUrl);
    const { code } = await esperarClose(ws, 3000);
    assert.equal(code, 4401, `esperava close 4401, recebeu ${code}`);
  });
});

// --- 2. com sessão → open + PING/PONG ---

test('WS com sessão válida é aceito e mantém conexão identificada', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    assert.ok(cookies.access_token, 'access_token ausente');

    const ws = await conectarWs(servidor.wsUrl, cookies);
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.send(JSON.stringify({ type: 'PING' }));
    const raw = await esperarMensagem(ws);
    const msg = JSON.parse(raw) as { type: string };
    assert.equal(msg.type, 'PONG');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});

// --- 3. múltiplas conexões do mesmo Jogador ambas open ---

test('WS múltiplas conexões do mesmo Jogador são aceitas', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);

    const ws1 = await conectarWs(servidor.wsUrl, cookies);
    const ws2 = await conectarWs(servidor.wsUrl, cookies);

    assert.equal(ws1.readyState, WebSocket.OPEN);
    assert.equal(ws2.readyState, WebSocket.OPEN);

    ws1.send(JSON.stringify({ type: 'PING' }));
    const r1 = await esperarMensagem(ws1);
    assert.equal((JSON.parse(r1) as { type: string }).type, 'PONG');

    ws2.send(JSON.stringify({ type: 'PING' }));
    const r2 = await esperarMensagem(ws2);
    assert.equal((JSON.parse(r2) as { type: string }).type, 'PONG');

    ws1.close();
    ws2.close();
    await Promise.all([esperarClose(ws1).catch(() => undefined), esperarClose(ws2).catch(() => undefined)]);
  });
});

// Cobertura extra: token forjado também rejeita 4401

test('WS com access_token forjado é rejeitado com 4401', async () => {
  await comServidor(async (servidor) => {
    const ws = new WebSocket(servidor.wsUrl, {
      headers: { Cookie: 'access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.invalida' },
    } as never);
    const { code } = await esperarClose(ws, 3000);
    assert.equal(code, 4401);
  });
});
