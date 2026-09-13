import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import {
  criarClienteDeRetorno,
  extrairRetryAfterMs,
  type AvisoDeRetorno,
} from '../src/retorno/cliente.ts';

const JWT_SECRET = 'test_secret_para_callback';

const aviso: AvisoDeRetorno = {
  salaId: 'sala-1',
  partidaId: 'partida-1',
  serverId: 'game-server-1',
  resultado: 'derrota',
  jogadores: ['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4'],
  teveDesistencia: false,
};

test('callback de retorno envia payload e service token ao lobby', async () => {
  const chamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    buscarHttp: async (url, init) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify({ sala: {} }), { status: 200 });
    },
  });

  await cliente(aviso);

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'http://lobby.test/api/retorno');
  assert.ok(chamadas[0].init);
  assert.equal(chamadas[0].init.method, 'POST');
  const headers = chamadas[0].init.headers as Record<string, string>;
  const authorization = headers.Authorization ?? headers.authorization;
  assert.equal(authorization?.startsWith('Bearer '), true);
  // B2: `teveDesistencia` é decisão local de retry — não viaja no payload HTTP.
  assert.deepEqual(JSON.parse(chamadas[0].init.body as string), {
    salaId: aviso.salaId,
    partidaId: aviso.partidaId,
    serverId: aviso.serverId,
    resultado: aviso.resultado,
    jogadores: [...aviso.jogadores],
  });

  const token = authorization.slice(7);
  const claims = jwt.verify(token, JWT_SECRET, { audience: 'flicker-service' }) as jwt.JwtPayload & { role?: string };
  assert.equal(claims.sub, 'flicker-service');
  assert.equal(claims.role, 'service');
});

test('callback de retorno repete falha transitória com backoff até aceitar', async () => {
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 5,
    buscarHttp: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        return new Response(JSON.stringify({ codigo: 'ERRO_INTERNO' }), { status: 503 });
      }
      return new Response('{}', { status: 200 });
    },
  });

  await cliente(aviso);

  assert.equal(chamadas, 2);
});

test('callback de retorno não repete rejeição definitiva', async () => {
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    buscarHttp: async () => {
      chamadas += 1;
      return new Response(JSON.stringify({ codigo: 'SALA_NAO_ENCONTRADA' }), { status: 404 });
    },
  });

  await cliente(aviso);

  assert.equal(chamadas, 1);
});

// B2 (issue #290): com desistência, o 409 SALA_NAO_ENCAMINHADA é transitório
// (retorno N−1 chegou antes do detach em voo) e deve retentar até o lobby
// convergir; sem desistência, a divergência é real e continua definitiva.
test('callback de retorno repete 409 SALA_NAO_ENCAMINHADA quando houve desistência', async () => {
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 5,
    buscarHttp: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        return new Response(JSON.stringify({ codigo: 'SALA_NAO_ENCAMINHADA' }), { status: 409 });
      }
      return new Response('{}', { status: 200 });
    },
  });

  await cliente({ ...aviso, teveDesistencia: true });

  assert.equal(chamadas, 2);
});

test('callback de retorno não repete 409 SALA_NAO_ENCAMINHADA sem desistência', async () => {
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    buscarHttp: async () => {
      chamadas += 1;
      return new Response(JSON.stringify({ codigo: 'SALA_NAO_ENCAMINHADA' }), { status: 409 });
    },
  });

  await cliente(aviso);

  assert.equal(chamadas, 1);
});

test('callback de retorno repete respostas 408 e 429', async () => {
  for (const status of [408, 429]) {
    let chamadas = 0;
    const cliente = criarClienteDeRetorno({
      lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
      jwtSecret: JWT_SECRET,
      backoffInicialMs: 5,
      buscarHttp: async () => {
        chamadas += 1;
        return chamadas === 1
          ? new Response('{}', { status })
          : new Response('{}', { status: 200 });
      },
    });

    await cliente(aviso);
    assert.equal(chamadas, 2, `status ${status} deveria ser retentável`);
  }
});

test('callback de retorno honra Retry-After em resposta retentável', async () => {
  const sleeps: number[] = [];
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 5,
    sleep: async (ms) => { sleeps.push(ms); },
    buscarHttp: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
      }
      return new Response('{}', { status: 200 });
    },
  });

  await cliente(aviso);
  assert.equal(chamadas, 2);
  assert.ok(sleeps[0] >= 1000, `Retry-After de 1s deveria atrasar o retry (sleep=${sleeps[0]}ms)`);
});

test('extrairRetryAfterMs cobre segundos, http-date e inválido', () => {
  assert.equal(extrairRetryAfterMs(new Headers({ 'retry-after': '1' })), 1000);
  assert.equal(extrairRetryAfterMs(new Headers({ 'retry-after': '120' })), 120000);
  assert.equal(extrairRetryAfterMs(new Headers({ 'retry-after': 'invalido' })), undefined);
  assert.equal(extrairRetryAfterMs(undefined), undefined);
  const futuro = new Date(Date.now() + 5000).toUTCString();
  const parsed = extrairRetryAfterMs(new Headers({ 'retry-after': futuro }));
  assert.ok(parsed !== undefined && parsed >= 4000 && parsed <= 6000, `http-date deveria dar ~5000ms, veio ${parsed}`);
});

test('callback de retorno retenta erro de rede com backoff', async () => {
  const sleeps: number[] = [];
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 5,
    sleep: async (ms) => { sleeps.push(ms); },
    buscarHttp: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw new Error('ECONNREFUSED');
      }
      return new Response('{}', { status: 200 });
    },
  });

  await cliente(aviso);
  assert.equal(chamadas, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 5, `backoff de rede deveria ser >=5ms, veio ${sleeps[0]}`);
});

test('callback de retorno respeita cap de 30s no backoff exponencial', async () => {
  const sleeps: number[] = [];
  let chamadas = 0;
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 1000,
    capMs: 30000,
    sleep: async (ms) => { sleeps.push(ms); },
    buscarHttp: async () => {
      chamadas += 1;
      if (chamadas <= 10) {
        return new Response('{}', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    },
  });

  await cliente(aviso);
  assert.equal(chamadas, 11);
  assert.equal(sleeps.length, 10);
  // 1000,2000,4000,8000,16000,30000,30000,30000,30000,30000
  assert.equal(Math.max(...sleeps), 30000);
  assert.ok(sleeps[5] === 30000 && sleeps[9] === 30000, 'cap de 30s deveria ser respeitado');
  for (let i = 1; i < sleeps.length; i++) {
    assert.ok(sleeps[i] >= sleeps[i - 1] || sleeps[i] === 30000, 'backoff deveria ser crescente até o cap');
  }
});

test('default do callback acompanha LOBBY_SERVER_PORT', () => {
  const portaAnterior = process.env.LOBBY_SERVER_PORT;
  const urlAnterior = process.env.LOBBY_RETORNO_CALLBACK_URL;
  process.env.LOBBY_SERVER_PORT = '4321';
  delete process.env.LOBBY_RETORNO_CALLBACK_URL;
  try {
    assert.equal(getConfig().lobbyRetornoCallbackUrl, 'http://localhost:4321/api/retorno');
  } finally {
    if (portaAnterior === undefined) delete process.env.LOBBY_SERVER_PORT;
    else process.env.LOBBY_SERVER_PORT = portaAnterior;
    if (urlAnterior === undefined) delete process.env.LOBBY_RETORNO_CALLBACK_URL;
    else process.env.LOBBY_RETORNO_CALLBACK_URL = urlAnterior;
  }
});
