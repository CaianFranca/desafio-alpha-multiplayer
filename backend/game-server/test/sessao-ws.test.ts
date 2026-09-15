// Ciclo de vida da Sessão nas conexões WS do game-server (issue #410):
//   - Sessão revogada durante a conexão é encerrada na revalidação (4401);
//   - marcador de rotação do refresh mantém a conexão viva (migra o sessaoId);
//   - Sessão válida não é encerrada;
//   - bots são isentos.
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) no molde de
// `ws-seguranca.test.ts` (partida/roster no Redis, `criarJwt`,
// `criarSessaoNoRedis`) e usa `--test-force-exit` já configurado.

import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis, assinarBotToken } from '@flicker/config';
import type { MembroDaSala, PartidaId } from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { chaveDaPartida } from '../src/partidas/partidas.ts';
import { listarConexoes, removerConexao } from '../src/ws/conexao.ts';
import {
  iniciarRevalidacaoDeSessao,
  type HandleRevalidacao,
} from '../src/ws/revalidacao-de-sessao.ts';
import {
  obterSucessorDeSessaoNoRedis,
  validarSessaoNoRedis,
} from '../src/auth.ts';
import type { ContextoDoGameServer } from '../src/contexto.ts';

const SERVER_ID = 'game-server-teste-sessao';
const JWT_SECRET = 'test_secret_para_sessao_ws';
const ORIGEM_PERMITIDA = 'http://permitido.teste';

const redis = criarClienteRedis();
const handles: HandleRevalidacao[] = [];

type SegurancaWs = NonNullable<ContextoDoGameServer['wsSeguranca']>;

const SEGURANCA_BASE: SegurancaWs = {
  origensPermitidas: [ORIGEM_PERMITIDA],
  maxPayloadBytes: 65536,
  limiteMensagens: 100,
  janelaLimiteMensagensMs: 10000,
};

interface ServidorEfemero {
  readonly port: number;
  readonly wsUrl: (partidaId: string, token: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(): Promise<ServidorEfemero> {
  const contexto: ContextoDoGameServer = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: 600,
    wsSeguranca: SEGURANCA_BASE,
  };
  const app = createApp(contexto);
  const server = http.createServer(app);
  const wss = criarWebSocketServer(server, contexto);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const endereco = server.address() as AddressInfo;
  return {
    port: endereco.port,
    wsUrl: (partidaId: string, token: string) =>
      `ws://127.0.0.1:${endereco.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`,
    fechar: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
    },
  };
}

function membro(n: number, sobrescreve: Partial<MembroDaSala> = {}): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
    ...sobrescreve,
  };
}

async function criarPartidaNoRedis(
  partidaId: PartidaId,
  roster: readonly MembroDaSala[],
): Promise<void> {
  const partida = {
    partidaId,
    serverId: SERVER_ID,
    salaId: 'sala-teste',
    codigoDeSala: 'SES01',
    roster,
    estado: 'preparada',
    criadaEm: new Date().toISOString(),
  };
  await redis.set(chaveDaPartida(partidaId), JSON.stringify(partida), 'EX', 600);
}

function criarJwt(jogadorId: string, apelido: string, sessaoId: string): string {
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function criarSessaoNoRedis(sessaoId: string, jogadorId: string): Promise<void> {
  await redis.set(`sessao:${sessaoId}`, JSON.stringify({ jogadorId, criadoEm: new Date().toISOString() }), 'EX', 3600);
}

/** Gera token de sessão válido (JWT + sessão no Redis) e devolve também o sessaoId. */
async function tokenParaJogador(jogadorId: string, apelido: string): Promise<{ token: string; sessaoId: string }> {
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return { token: criarJwt(jogadorId, apelido, sessaoId), sessaoId };
}

function conectarPartida(
  servidor: ServidorEfemero,
  partidaId: string,
  token: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(servidor.wsUrl(partidaId, token), {
      headers: { Origin: ORIGEM_PERMITIDA },
    } as never);
    let encerrado = false;
    const finalizar = (fn: () => void): void => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      ws.off('error', onError);
      ws.off('message', onMessage);
      fn();
    };
    const onError = (err: Error): void => finalizar(() => {
      ws.terminate();
      reject(err);
    });
    const onMessage = (data: WebSocket.RawData): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      const type = (parsed as { type?: unknown } | null)?.type;
      if (type === 'ADMISSAO_ACEITA' || type === 'ESTADO_DA_PARTIDA') {
        finalizar(() => resolve(ws));
      }
    };
    const timer = setTimeout(() => finalizar(() => {
      ws.terminate();
      reject(new Error('timeout aguardando ADMISSAO_ACEITA'));
    }), 5000);
    ws.on('error', onError);
    ws.on('message', onMessage);
  });
}

function esperarClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout ao esperar close'));
    }, timeoutMs);
    ws.once('close', (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function esperarMensagens(ws: WebSocket, quantidade: number, timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const recebidas: string[] = [];
    const limpar = (): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const timer = setTimeout(() => {
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

function tipoDaMensagem(raw: string): string {
  return (JSON.parse(raw) as { type: string }).type;
}

async function pingPong(ws: WebSocket): Promise<void> {
  const pong = esperarMensagens(ws, 1);
  ws.send(JSON.stringify({ type: 'PING' }));
  assert.equal(tipoDaMensagem((await pong)[0]!), 'PONG');
}

function iniciarRevalidacao(): HandleRevalidacao {
  const handle = iniciarRevalidacaoDeSessao({ intervaloMs: 50, redis });
  handles.push(handle);
  return handle;
}

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de sessão WS: ${(error as Error).message}`);
  }
});

after(async () => {
  for (const handle of handles) {
    handle.parar();
  }
  handles.length = 0;
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
});

// O registro de conexões é global ao processo: zera entre testes para que as
// deps injetadas (que varrem `listarConexoes`) não enxerguem conexões mortas
// de testes anteriores.
afterEach(() => {
  for (const conexao of listarConexoes()) {
    removerConexao(conexao);
  }
});

// --- (a) Sessão revogada -> fecha na revalidação ---

test('Sessão revogada durante a conexão é encerrada na revalidação (4401)', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = 'partida-sessao-revogada';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const { token, sessaoId } = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);
    await pingPong(ws);

    await redis.del(`sessao:${sessaoId}`);

    const close = esperarClose(ws);
    const handle = iniciarRevalidacao();
    try {
      const { code, reason } = await close;
      assert.equal(code, 4401, `esperava 4401, recebeu ${code}`);
      assert.equal(reason, 'SESSAO_INVALIDA');
    } finally {
      handle.parar();
    }
  } finally {
    await servidor.fechar();
  }
});

// --- (b) Marcador de rotação -> conexão segue viva ---

test('Marcador de rotação do refresh mantém a conexão viva', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = 'partida-sessao-rotacionada';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const { token, sessaoId } = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);
    await pingPong(ws);

    // Simula a rotação do refresh: remove a Sessão antiga, cria a nova e grava
    // o marcador que a revalidação deve seguir (mesmo contrato do lobby).
    const novaSessaoId = crypto.randomUUID();
    await redis.del(`sessao:${sessaoId}`);
    await criarSessaoNoRedis(novaSessaoId, 'jogador-1');
    await redis.set(`sessao:rotacionada:${sessaoId}`, novaSessaoId, 'EX', 900);

    const handle = iniciarRevalidacao();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(ws.readyState, WebSocket.OPEN, 'a conexão deveria seguir aberta');
      await pingPong(ws);
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

// --- (c) Sessão válida -> não fecha ---

test('Sessão válida não é encerrada pela revalidação', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = 'partida-sessao-valida';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const { token } = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);
    await pingPong(ws);

    const handle = iniciarRevalidacao();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(ws.readyState, WebSocket.OPEN, 'a conexão deveria seguir aberta');
      await pingPong(ws);
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

// --- (d) Bot é isento ---

test('Conexão de bot é isenta da revalidação de Sessão', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = 'partida-sessao-bot';
    const botId = 'bot-sessao';
    const botApelido = 'Bot Sessao';
    await criarPartidaNoRedis(partidaId, [
      membro(1, { jogadorId: botId, apelido: botApelido, ehBot: true }),
    ]);
    const botToken = assinarBotToken({ jogadorId: botId, apelido: botApelido, partidaId }, JWT_SECRET);

    const ws = await conectarPartida(servidor, partidaId, botToken);
    await pingPong(ws);

    // Sem Sessão no Redis, um não-bot fecharia; o bot é pulado.
    const handle = iniciarRevalidacao();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(ws.readyState, WebSocket.OPEN, 'conexão de bot não deveria fechar');
      await pingPong(ws);
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

// --- (e) Redis fora durante a revalidação -> conexão preservada (fail-open) ---

test('Falha de Redis na revalidação preserva a conexão e recupera no próximo tick', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = 'partida-sessao-redis-fora';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const { token } = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);
    await pingPong(ws);

    // `falhar` simula o Redis fora: as deps injetadas lançam como
    // `validarSessaoNoRedis`/`obterSucessorDeSessaoNoRedis` passam a fazer
    // depois do B1. Enquanto isso, a conexão NÃO pode ser encerrada (fail-open).
    let falhar = true;
    let codigoDeFechamento: number | null = null;
    ws.on('close', (code: number) => {
      codigoDeFechamento = code;
    });

    const handle = iniciarRevalidacaoDeSessao({
      intervaloMs: 50,
      redis,
      validarSessao: (sessaoId, jogadorId) => {
        if (falhar) {
          throw new Error('redis fora');
        }
        return validarSessaoNoRedis(redis, sessaoId, jogadorId);
      },
      obterSucessorDeSessao: (sessaoId) => {
        if (falhar) {
          throw new Error('redis fora');
        }
        return obterSucessorDeSessaoNoRedis(redis, sessaoId);
      },
    });
    handles.push(handle);
    try {
      // Vários ticks com Redis "fora": nenhum 4401, conexão intacta.
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(codigoDeFechamento, null, `não deveria fechar, fechou com ${codigoDeFechamento}`);
      assert.notEqual(codigoDeFechamento, 4401, 'falha de Redis não pode encerrar a sessão (4401)');
      assert.equal(ws.readyState, WebSocket.OPEN, 'a conexão deveria seguir aberta');
      await pingPong(ws);

      // Redis volta: a Sessão continua válida e a conexão permanece.
      falhar = false;
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(codigoDeFechamento, null, `não deveria fechar após recuperar, fechou com ${codigoDeFechamento}`);
      assert.equal(ws.readyState, WebSocket.OPEN, 'a conexão deveria seguir aberta');
      await pingPong(ws);
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});
