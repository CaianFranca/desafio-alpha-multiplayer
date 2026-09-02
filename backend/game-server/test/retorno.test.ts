import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import {
  criarClienteDeRetorno,
  type AvisoDeRetorno,
} from '../src/retorno/cliente.ts';

const JWT_SECRET = 'test_secret_para_callback';

const aviso: AvisoDeRetorno = {
  salaId: 'sala-1',
  partidaId: 'partida-1',
  serverId: 'game-server-1',
  resultado: 'derrota',
  jogadores: ['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4'],
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
  assert.deepEqual(JSON.parse(chamadas[0].init.body as string), aviso);

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
  let chamadas = 0;
  const inicio = Date.now();
  const cliente = criarClienteDeRetorno({
    lobbyRetornoCallbackUrl: 'http://lobby.test/api/retorno',
    jwtSecret: JWT_SECRET,
    backoffInicialMs: 5,
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
  const duracao = Date.now() - inicio;
  assert.ok(duracao >= 900, `Retry-After de 1s deveria atrasar o retry (duracao=${duracao}ms)`);
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
