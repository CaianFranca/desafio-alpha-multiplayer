// Testes de integração do endurecimento do WS no lobby-server (issue #409):
// allowlist de Origem (recusa no handshake, antes da autenticação), teto de
// payload (close 1009), rate limit geral por conexão (close 1008) e isenção de
// bots (@bot.teste). Usa PG+Redis reais conforme getConfig() (profile backend
// do compose). Estilo: node:test + assert/strict, espelha ws-auth.integration.test.ts
// — os helpers de `test/helpers/salas-ws.ts` não são usados porque não permitem
// injetar o header `Origin`.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { createApp } from '../src/app.ts';
import { createWebSocketServer, type SegurancaWs, type WsDeps } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { criarSessao } from '../src/sessoes.ts';
import { assinarAccess } from '../src/jwt.ts';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';

registrarArquivoDeTeste();

interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
  fechar(): Promise<void>;
}

interface Cookies {
  access_token?: string;
  refresh_token?: string;
}

const ORIGEM_PERMITIDA = 'http://permitido.teste';
const ORIGEM_MALICIOSA = 'http://malicioso.teste';

// Valores pequenos e determinísticos para exercitar os limites sem depender
// dos defaults de `getConfig()`.
const SEGURANCA_BASE: SegurancaWs = {
  origensPermitidas: [ORIGEM_PERMITIDA],
  maxPayloadBytes: 65536,
  limiteMensagens: 100,
  janelaLimiteMensagensMs: 10000,
};

const redis = criarClienteRedis();
let contador = 0;

async function subirServidor(deps: WsDeps): Promise<ServidorEfemero> {
  const app = createApp();
  const server = http.createServer(app);
  createWebSocketServer(server, deps);

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

async function comServidor<T>(
  deps: WsDeps,
  executar: (servidor: ServidorEfemero) => Promise<T>,
): Promise<T> {
  const servidor = await subirServidor(deps);
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
  return `${prefixo}-${sufixo()}@teste.local`;
}

function cadastroValido(prefixo: string): { apelido: string; email: string; senha: string } {
  return { apelido: apelidoUnico(prefixo), email: emailUnico(prefixo), senha: 'senha_dev_123' };
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

async function registrarJogador(servidor: ServidorEfemero, prefixo: string): Promise<Cookies> {
  const reg = await fetch(`${servidor.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cadastroValido(prefixo)),
  });
  assert.equal(reg.status, 201);
  const cookies = extrairCookies(reg);
  assert.ok(cookies.access_token, 'access_token ausente');
  return cookies;
}

function conectarWs(wsUrl: string, cookies?: Cookies, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: headersDeUpgrade(cookies, origin) } as never);
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

/**
 * Conecta esperando a recusa do handshake. Sem listener de
 * `unexpected-response`, o cliente `ws` emitiria `error`; com o listener, ele
 * entrega `req`/`res` — devolvemos o status HTTP sem que `open` dispare.
 */
function conectarRecusado(
  wsUrl: string,
  cookies?: Cookies,
  origin?: string,
): Promise<{ abriu: boolean; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: headersDeUpgrade(cookies, origin) } as never);
    let abriu = false;
    let encerrado = false;
    const timeout = setTimeout(() => {
      if (encerrado) return;
      encerrado = true;
      ws.terminate();
      reject(new Error('timeout ao esperar recusa de handshake'));
    }, 3000);

    ws.once('open', () => {
      abriu = true;
    });
    ws.once('unexpected-response', (req, res) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timeout);
      const statusCode = res.statusCode;
      res.resume();
      ws.terminate();
      resolve({ abriu, statusCode });
    });
    ws.once('error', (err) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function headersDeUpgrade(cookies: Cookies | undefined, origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) {
    headers.Cookie = cookieHeader;
  }
  if (origin !== undefined) {
    headers.Origin = origin;
  }
  return headers;
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

function tipoDaMensagem(raw: string): string {
  return (JSON.parse(raw) as { type: string }).type;
}

/** Registra o listener antes do envio para não perder mensagens em rajada. */
function esperarMensagens(ws: WebSocket, quantidade: number, timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const recebidas: string[] = [];
    const limpar = (): void => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const timeout = setTimeout(() => {
      limpar();
      reject(new Error(`timeout: ${recebidas.length}/${quantidade} mensagens`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      recebidas.push(data.toString());
      if (recebidas.length >= quantidade) {
        limpar();
        resolve(recebidas);
      }
    };
    const onError = (err: Error): void => {
      limpar();
      reject(err);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

before(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(`Postgres indisponível para testes ws-seguranca: ${(error as Error).message}`);
  }
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para testes ws-seguranca: ${(error as Error).message}`);
  }
});

after(async () => {
  try {
    await redis.quit().catch(() => {
      try {
        redis.disconnect();
      } catch {}
    });
  } catch {
    try {
      redis.disconnect();
    } catch {}
  }
  // redisClient (singleton) e pool são encerrados uma única vez via ./teardown.ts
  // quando o último arquivo de teste terminar.
  await finalizarArquivoDeTeste();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

// --- 1. Origem na allowlist conecta ---

test('Origem na allowlist conecta e autentica', async () => {
  await comServidor({ seguranca: SEGURANCA_BASE }, async (servidor) => {
    const cookies = await registrarJogador(servidor, 'origem-ok');
    const ws = await conectarWs(servidor.wsUrl, cookies, ORIGEM_PERMITIDA);
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem(await esperarMensagem(ws)), 'PONG');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});

// --- 2. Origem fora da allowlist é recusada ANTES de autenticar ---

test('Origem fora da allowlist é recusada no handshake (403), mesmo com cookies válidos', async () => {
  let autenticou = false;
  const deps: WsDeps = {
    seguranca: SEGURANCA_BASE,
    // Espião: se a autenticação rodasse, o handshake teria sido aceito.
    obterSessao: async () => {
      autenticou = true;
      return null;
    },
  };
  await comServidor(deps, async (servidor) => {
    const cookies = await registrarJogador(servidor, 'origem-bad');
    const resultado = await conectarRecusado(servidor.wsUrl, cookies, ORIGEM_MALICIOSA);

    assert.equal(resultado.statusCode, 403, `esperava 403, recebeu ${resultado.statusCode}`);
    assert.equal(resultado.abriu, false, 'cliente não deveria abrir a conexão');
    assert.equal(autenticou, false, 'a autenticação não deveria rodar para origem recusada');
  });
});

// --- 3. Sem Origin (bot/serviço) conecta ---

test('Sem header Origin conecta e responde PING/PONG', async () => {
  await comServidor({ seguranca: SEGURANCA_BASE }, async (servidor) => {
    const cookies = await registrarJogador(servidor, 'sem-origin');
    const ws = await conectarWs(servidor.wsUrl, cookies);
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem(await esperarMensagem(ws)), 'PONG');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});

// --- 4. Teto de payload ---

test('Mensagem acima do teto de payload fecha com 1009', async () => {
  const seguranca: SegurancaWs = { ...SEGURANCA_BASE, maxPayloadBytes: 1024 };
  await comServidor({ seguranca }, async (servidor) => {
    const cookies = await registrarJogador(servidor, 'payload');
    const ws = await conectarWs(servidor.wsUrl, cookies);

    // JSON válido com padding acima de 1 KiB: o receiver do `ws` barra pelo
    // tamanho antes de emitir 'message'.
    ws.send(JSON.stringify({ type: 'PING', padding: 'x'.repeat(2048) }));
    const { code } = await esperarClose(ws);
    assert.equal(code, 1009, `esperava close 1009, recebeu ${code}`);
  });
});

// --- 5. Rate limit geral por conexão ---

test('Conexão que estoura o rate limit fecha com 1008 sem afetar outra conexão', async () => {
  const seguranca: SegurancaWs = { ...SEGURANCA_BASE, limiteMensagens: 3 };
  await comServidor({ seguranca }, async (servidor) => {
    const cookiesA = await registrarJogador(servidor, 'rate-a');
    const cookiesB = await registrarJogador(servidor, 'rate-b');

    const wsA = await conectarWs(servidor.wsUrl, cookiesA);
    const wsB = await conectarWs(servidor.wsUrl, cookiesB);

    // B entra e responde dentro do limite.
    wsB.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem(await esperarMensagem(wsB)), 'PONG');

    // A estoura o limite com uma rajada de 4 mensagens (limite 3).
    for (let i = 0; i < 4; i += 1) {
      wsA.send(JSON.stringify({ type: 'PING' }));
    }
    const { code } = await esperarClose(wsA);
    assert.equal(code, 1008, `esperava close 1008, recebeu ${code}`);

    // B continua viva: o limite é por conexão.
    assert.equal(wsB.readyState, WebSocket.OPEN);
    wsB.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem(await esperarMensagem(wsB)), 'PONG');

    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
  });
});

// --- 6. Isenção de bots (@bot.teste) ---

test('Conexão de bot não consome o rate limit', async () => {
  const seguranca: SegurancaWs = { ...SEGURANCA_BASE, limiteMensagens: 2 };
  await comServidor({ seguranca }, async (servidor) => {
    // Bot criado por INSERT direto com bot=true e domínio reservado @bot.teste,
    // espelhando bots/bot-runner.ts (registro público rejeita o domínio).
    const inserido = await pool.query<{ id: string; apelido: string; email: string }>(
      `INSERT INTO usuarios (apelido, email, senha, bot)
       VALUES ($1, $2, $3, true)
       RETURNING id, apelido, email`,
      [apelidoUnico('bot'), `bot-${sufixo()}@bot.teste`, 'bot_nopassword'],
    );
    const jogador = inserido.rows[0]!;
    const { sessaoId } = await criarSessao(jogador.id);
    const accessToken = assinarAccess(jogador, sessaoId);

    const ws = await conectarWs(servidor.wsUrl, { access_token: accessToken });

    // 5 PINGs com limite 2: sem a isenção, a conexão já teria fechado com 1008.
    const pongPromessa = esperarMensagens(ws, 5);
    for (let i = 0; i < 5; i += 1) {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
    const recebidas = await pongPromessa;

    assert.equal(recebidas.length, 5);
    for (const raw of recebidas) {
      assert.equal(tipoDaMensagem(raw), 'PONG');
    }
    assert.equal(ws.readyState, WebSocket.OPEN, 'conexão de bot não deveria fechar por rate limit');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});
