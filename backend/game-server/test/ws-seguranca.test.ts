// Teste de integração do endurecimento do WS no game-server (issue #409):
// allowlist de Origem (recusada no upgrade, ANTES de qualquer validação de
// token/partida — por isso a rejeição é 403 e não 401), teto de payload
// (close 1009), rate limit geral por conexão (close 1008) e isenção de bots
// (token de bot assinado com `assinarBotToken`, sem sessão no Redis).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e passa
// `contexto.wsSeguranca` com valores pequenos/determinísticos em vez dos
// defaults de `getConfig()`. Espelha o scaffolding de `admissao.test.ts`
// (partida/roster no Redis, `criarJwt`, `criarSessaoNoRedis`) e o
// `fazerUpgradeHttp` de `tabuleiro.test.ts` (inspeção de status/corpo das
// rejeições HTTP do upgrade, com header `Origin` injetável).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis, assinarBotToken } from '@flicker/config';
import type { MembroDaSala, PartidaId } from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { chaveDaPartida } from '../src/partidas/partidas.ts';
import type { ContextoDoGameServer } from '../src/contexto.ts';

const SERVER_ID = 'game-server-teste-seguranca';
const JWT_SECRET = 'test_secret_para_seguranca_ws';

const ORIGEM_PERMITIDA = 'http://permitido.teste';
const ORIGEM_MALICIOSA = 'http://malicioso.teste';

const redis = criarClienteRedis();

type SegurancaWs = NonNullable<ContextoDoGameServer['wsSeguranca']>;

/** Defaults determinísticos; cada caso sobrescreve só o limite exercitado. */
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

async function subirServidor(wsSeguranca: SegurancaWs): Promise<ServidorEfemero> {
  const contexto: ContextoDoGameServer = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: 600,
    wsSeguranca,
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
    // Fecha os clientes WS primeiro (senão `server.close()` espera conexões
    // ativas) e depois o HTTP, com belt-and-braces para keep-alive.
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
    codigoDeSala: 'SEG01',
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

/** Gera um token de sessão válido (JWT + sessão no Redis) para um jogador do roster. */
async function tokenParaJogador(jogadorId: string, apelido: string): Promise<string> {
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return criarJwt(jogadorId, apelido, sessaoId);
}

/**
 * Conecta e espera o ADMISSAO_ACEITA. Os listeners são anexados antes do
 * `open` porque o frame pode chegar no mesmo pacote do handshake (ver
 * cabeçalho de `tabuleiro.test.ts`). `origin` injeta o header de upgrade.
 */
function conectarPartida(
  servidor: ServidorEfemero,
  partidaId: string,
  token: string,
  origin?: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const opcoes = origin === undefined ? undefined : ({ headers: { Origin: origin } } as never);
    const ws = new WebSocket(servidor.wsUrl(partidaId, token), opcoes);
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
      if ((parsed as { type?: unknown } | null)?.type === 'ADMISSAO_ACEITA') {
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

interface ResultadoHttp {
  readonly status: number;
  readonly texto: string;
}

/**
 * Upgrade HTTP cru para exercitar a rejeição por Origem (resposta HTTP antes
 * do upgrade). `token` e `origin` são opcionais: sem token o caminho normal
 * responderia 401, provando que a checagem de Origem vem antes.
 */
function fazerUpgradeHttp(
  port: number,
  partidaId: string,
  opcoes: { readonly token?: string; readonly origin?: string } = {},
): Promise<ResultadoHttp> {
  const tokenParam = opcoes.token === undefined ? '' : `&token=${encodeURIComponent(opcoes.token)}`;
  const path = `/ws/game/${SERVER_ID}?partida-id=${partidaId}${tokenParam}`;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(opcoes.origin === undefined ? {} : { Origin: opcoes.origin }),
      },
    });

    req.on('error', reject);
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      reject(new Error('upgrade inesperado — conexão deveria ter sido rejeitada'));
    });
    req.on('response', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, texto: data });
      });
    });
    req.end();
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

/** Registra o listener antes do envio para não perder mensagens em rajada. */
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

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de ws-seguranca: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
});

// --- 1. Origem na allowlist é admitida ---

test('Origem na allowlist é admitida (ADMISSAO_ACEITA)', async () => {
  const servidor = await subirServidor(SEGURANCA_BASE);
  try {
    const partidaId = 'partida-origem-ok';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const token = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token, ORIGEM_PERMITIDA);
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

// --- 2. Origem fora da allowlist é recusada ANTES de autenticar ---

test('Origem fora da allowlist é recusada com 403 (antes do 401 de token)', async () => {
  const servidor = await subirServidor(SEGURANCA_BASE);
  try {
    const partidaId = 'partida-origem-bad';
    await criarPartidaNoRedis(partidaId, [membro(1)]);

    // Token inválido de propósito: se a origem fosse checada depois da
    // autenticação, o status seria 401 SESSAO_INVALIDA. O 403
    // ORIGEM_NAO_PERMITIDA prova a precedência.
    const resultado = await fazerUpgradeHttp(servidor.port, partidaId, {
      token: 'token-invalido',
      origin: ORIGEM_MALICIOSA,
    });

    assert.equal(resultado.status, 403, `esperava 403, recebeu ${resultado.status}`);
    const corpo = JSON.parse(resultado.texto) as { type: string; codigo: string };
    assert.equal(corpo.type, 'ADMISSAO_REJEITADA');
    assert.equal(corpo.codigo, 'ORIGEM_NAO_PERMITIDA');
  } finally {
    await servidor.fechar();
  }
});

// --- 3. Sem Origin (bot/serviço) é aceita ---

test('Sem header Origin é aceita e responde PING/PONG', async () => {
  const servidor = await subirServidor(SEGURANCA_BASE);
  try {
    const partidaId = 'partida-sem-origem';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const token = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);
    assert.equal(ws.readyState, WebSocket.OPEN);

    const pong = esperarMensagens(ws, 1);
    ws.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem((await pong)[0]!), 'PONG');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

test('Origin vazio é recusada com 403 (ORIGEM_NAO_PERMITIDA)', async () => {
  const servidor = await subirServidor(SEGURANCA_BASE);
  try {
    const partidaId = 'partida-origem-vazia';
    await criarPartidaNoRedis(partidaId, [membro(1)]);

    // Token inválido de propósito: header Origin presente porém vazio não é
    // ausência de header, então a recusa 403 precede o 401 SESSAO_INVALIDA.
    const resultado = await fazerUpgradeHttp(servidor.port, partidaId, {
      token: 'token-invalido',
      origin: '',
    });

    assert.equal(resultado.status, 403, `esperava 403, recebeu ${resultado.status}`);
    const corpo = JSON.parse(resultado.texto) as { type: string; codigo: string };
    assert.equal(corpo.type, 'ADMISSAO_REJEITADA');
    assert.equal(corpo.codigo, 'ORIGEM_NAO_PERMITIDA');
  } finally {
    await servidor.fechar();
  }
});

test('Origin "null" (iframe sandboxed) é recusada com 403 (ORIGEM_NAO_PERMITIDA)', async () => {
  const servidor = await subirServidor(SEGURANCA_BASE);
  try {
    const partidaId = 'partida-origem-null';
    await criarPartidaNoRedis(partidaId, [membro(1)]);

    // `"null"` de iframe sandboxed é header presente e deve ser recusado antes
    // da validação de token.
    const resultado = await fazerUpgradeHttp(servidor.port, partidaId, {
      token: 'token-invalido',
      origin: 'null',
    });

    assert.equal(resultado.status, 403, `esperava 403, recebeu ${resultado.status}`);
    const corpo = JSON.parse(resultado.texto) as { type: string; codigo: string };
    assert.equal(corpo.type, 'ADMISSAO_REJEITADA');
    assert.equal(corpo.codigo, 'ORIGEM_NAO_PERMITIDA');
  } finally {
    await servidor.fechar();
  }
});

// --- 4. Teto de payload ---

test('Mensagem acima do teto de payload fecha com 1009', async () => {
  const servidor = await subirServidor({ ...SEGURANCA_BASE, maxPayloadBytes: 1024 });
  try {
    const partidaId = 'partida-payload';
    await criarPartidaNoRedis(partidaId, [membro(1)]);
    const token = await tokenParaJogador('jogador-1', 'Jogador 1');

    const ws = await conectarPartida(servidor, partidaId, token);

    // JSON válido com padding acima de 1 KiB: o receiver do `ws` barra pelo
    // tamanho antes de emitir 'message' e fecha com 1009 automaticamente.
    ws.send(JSON.stringify({ type: 'PING', padding: 'x'.repeat(2048) }));
    const { code } = await esperarClose(ws);
    assert.equal(code, 1009, `esperava close 1009, recebeu ${code}`);
  } finally {
    await servidor.fechar();
  }
});

// --- 5. Rate limit geral por conexão ---

test('Conexão que estoura o rate limit fecha com 1008 sem afetar outra conexão', async () => {
  const servidor = await subirServidor({ ...SEGURANCA_BASE, limiteMensagens: 3 });
  try {
    const partidaId = 'partida-rate-limit';
    // Dois membros no roster para sustentar duas conexões válidas simultâneas
    // (o limite é POR CONEXÃO, então cada socket tem o próprio contador).
    await criarPartidaNoRedis(partidaId, [membro(1), membro(2)]);
    const tokenA = await tokenParaJogador('jogador-1', 'Jogador 1');
    const tokenB = await tokenParaJogador('jogador-2', 'Jogador 2');

    const wsA = await conectarPartida(servidor, partidaId, tokenA);
    const wsB = await conectarPartida(servidor, partidaId, tokenB);

    // B entra e responde dentro do limite (1 das 3 mensagens da janela).
    const pongB1 = esperarMensagens(wsB, 1);
    wsB.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem((await pongB1)[0]!), 'PONG');

    // Rajada de 4 mensagens em A com limite 3: a 4ª estoura e fecha com 1008.
    for (let i = 0; i < 4; i += 1) {
      wsA.send(JSON.stringify({ type: 'PING' }));
    }
    const { code } = await esperarClose(wsA);
    assert.equal(code, 1008, `esperava close 1008, recebeu ${code}`);

    // B continua viva e respondendo: o flood de A não afeta quem está dentro
    // do limite (o contador é por conexão).
    assert.equal(wsB.readyState, WebSocket.OPEN);
    const pongB2 = esperarMensagens(wsB, 1);
    wsB.send(JSON.stringify({ type: 'PING' }));
    assert.equal(tipoDaMensagem((await pongB2)[0]!), 'PONG');

    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});

// --- 6. Isenção de bots (tokens de bot de auth.ts) ---

test('Conexão de bot não consome o rate limit', async () => {
  const servidor = await subirServidor({ ...SEGURANCA_BASE, limiteMensagens: 2 });
  try {
    const partidaId = 'partida-bot';
    const botId = 'bot-rate-limit';
    const botApelido = 'Bot Rate';
    // Roster com o bot; a admissão de bot NÃO passa por validarSessaoNoRedis,
    // então basta assinar o token de bot com o jwtSecret do servidor.
    await criarPartidaNoRedis(partidaId, [
      membro(1),
      membro(2, { jogadorId: botId, apelido: botApelido, ehBot: true }),
    ]);
    const botToken = assinarBotToken({ jogadorId: botId, apelido: botApelido, partidaId }, JWT_SECRET);

    const ws = await conectarPartida(servidor, partidaId, botToken);

    // 5 PINGs com limite 2: sem a isenção, já teria fechado com 1008.
    const pongs = esperarMensagens(ws, 5);
    for (let i = 0; i < 5; i += 1) {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
    const recebidas = await pongs;
    assert.equal(recebidas.length, 5);
    for (const raw of recebidas) {
      assert.equal(tipoDaMensagem(raw), 'PONG');
    }
    assert.equal(ws.readyState, WebSocket.OPEN, 'conexão de bot não deveria fechar por rate limit');

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  } finally {
    await servidor.fechar();
  }
});
