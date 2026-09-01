import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import WebSocket from 'ws';
import { criarClienteRedis } from '@flicker/config';
import type {
  MembroDaSala,
  PartidaId,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { chaveDaPartida } from '../src/partidas/partidas.ts';
import { chaveDoEstadoDaPartida, inicializarEstadoDaPartida } from '../src/partidas/estado.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import type { ContextoDoGameServer } from '../src/contexto.ts';

const SERVER_ID = 'game-server-teste';
const JWT_SECRET = 'test_secret_para_admissao';
const redis = criarClienteRedis();

interface ServidorEfemero {
  baseUrl: string;
  port: number;
  serverId: string;
  fechar(): Promise<void>;
}

function membro(n: number, sobrescreve: Partial<MembroDaSala> = {}): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'em_reconexao',
    prontidao: true,
    ...sobrescreve,
  };
}

function criarJwt(jogadorId: string, apelido: string, sessaoId?: string, opcoes: Partial<jwt.SignOptions> = {}): string {
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', ...opcoes });
}

async function criarSessaoNoRedis(sessaoId: string, jogadorId: string): Promise<void> {
  await redis.set(`sessao:${sessaoId}`, JSON.stringify({ jogadorId, criadoEm: new Date().toISOString() }), 'EX', 3600);
}

async function subirServidor(): Promise<ServidorEfemero> {
  const contexto: ContextoDoGameServer = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: 600,
  };
  const app = createApp(contexto);
  const server = http.createServer(app);
  criarWebSocketServer(server, contexto);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    port: endereco.port,
    serverId: SERVER_ID,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
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
    codigoDeSala: 'TEST01',
    roster,
    estado: 'preparada',
    criadaEm: new Date().toISOString(),
  };
  await redis.set(chaveDaPartida(partidaId), JSON.stringify(partida), 'EX', 600);
}

async function criarPartidaComEstadoNoRedis(
  partidaId: PartidaId,
  roster: readonly MembroDaSala[],
): Promise<void> {
  await criarPartidaNoRedis(partidaId, roster);
  await inicializarEstadoDaPartida(redis, partidaId, 600, roster.map((m) => m.jogadorId));
}

async function subirServidorComPartida(redisCliente: Redis = redis): Promise<ServidorEfemero & { broadcaster: PartidaBroadcaster; handlers: PartidaHandlers; wss: import('ws').WebSocketServer }> {
  const contexto: ContextoDoGameServer = {
    redis: redisCliente,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: 600,
  };
  const app = createApp(contexto);
  const server = http.createServer(app);
  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({ redis: redisCliente, broadcaster });
  const wss = criarWebSocketServer(server, contexto, { partida: { broadcaster, handlers } });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    port: endereco.port,
    serverId: SERVER_ID,
    broadcaster,
    handlers,
    wss,
    fechar: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
    },
  };
}

type ColetaOpcoes = { readonly timeoutMs?: number; readonly aguardarTipos?: readonly string[] };

function coletarMensagensWs(
  port: number,
  token: string,
  partidaId: PartidaId,
  opcoes: number | ColetaOpcoes = 800,
): Promise<string[]> {
  const timeoutMs = typeof opcoes === 'number' ? opcoes : (opcoes.timeoutMs ?? 2000);
  const aguardarTipos = typeof opcoes === 'number' ? null : (opcoes.aguardarTipos ?? null);
  return new Promise((resolve) => {
    const mensagens: string[] = [];
    let finalizado = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
    const finalizar = () => {
      if (finalizado) return;
      finalizado = true;
      if (timeout !== null) clearTimeout(timeout);
      try { ws.close(); } catch {}
      resolve(mensagens);
    };
    const verificarConclusao = (): boolean => {
      if (aguardarTipos === null) return false;
      const tipos = mensagens.map((m) => {
        try { return (JSON.parse(m) as { type: string }).type; } catch { return ''; }
      });
      return aguardarTipos.every((t) => tipos.includes(t));
    };
    ws.on('message', (data) => {
      mensagens.push(data.toString());
      if (verificarConclusao()) {
        setTimeout(finalizar, 120);
      }
    });
    ws.on('open', () => {
      timeout = setTimeout(finalizar, timeoutMs);
    });
    ws.on('error', () => finalizar());
    setTimeout(finalizar, timeoutMs + 2500);
  });
}

function assertOrdemTipos(mensagens: readonly string[], ordemEsperada: readonly string[]): void {
  const tipos = mensagens.map((m) => (JSON.parse(m) as { type: string }).type);
  const filtrados = tipos.filter((t) => (ordemEsperada as readonly string[]).includes(t));
  assert.deepEqual(filtrados, [...ordemEsperada], `ordem esperada ${ordemEsperada.join(' → ')} mas recebida ${tipos.join(' → ')}`);
  // garante que a sequência esperada aparece em ordem sem intercalação de outros tipos esperados
  let idx = -1;
  for (const esperado of ordemEsperada) {
    const pos = tipos.indexOf(esperado, idx + 1);
    assert.ok(pos > idx, `tipo ${esperado} deveria aparecer após índice ${idx} na ordem ${tipos.join(' → ')}`);
    idx = pos;
  }
}

interface ResultadoWs {
  readonly conectou: boolean;
  readonly mensagem: string | null;
  readonly closeCode: number | null;
  readonly closeReason: string | null;
}

interface ResultadoHttp {
  readonly status: number;
  readonly texto: string;
}

function fazerUpgradeHttp(port: number, token: string, partidaId: string, serverIdPath?: string): Promise<ResultadoHttp> {
  const path = `/ws/game/${serverIdPath ?? SERVER_ID}?partida-id=${partidaId}&token=${token}`;
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

function conectarWs(
  port: number,
  token: string,
  partidaId: string,
  serverIdPath?: string,
): Promise<ResultadoWs> {
  return new Promise((resolve) => {
    const path = `/ws/game/${serverIdPath ?? SERVER_ID}?partida-id=${partidaId}&token=${token}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    let mensagem: string | null = null;
    let conectou = false;

    ws.on('open', () => {
      conectou = true;
    });

    ws.on('message', (data) => {
      mensagem = data.toString();
      if (conectou) {
        ws.close();
      }
    });

    ws.on('close', (code, reason) => {
      resolve({
        conectou,
        mensagem,
        closeCode: code,
        closeReason: reason.toString(),
      });
    });

    ws.on('error', () => {
      resolve({
        conectou: false,
        mensagem,
        closeCode: null,
        closeReason: null,
      });
    });

    // Timeout de segurança
    setTimeout(() => {
      ws.close();
    }, 3000);
  });
}

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de integração: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
});

test('Jogador do roster com JWT válido é admitido na partida e presença transita para conectado', async () => {
  const servidor = await subirServidor();
  let ws: WebSocket | null = null;
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');

    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);
    ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
    const mensagem = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout ADMISSAO_ACEITA')), 3000);
      ws!.on('message', (data) => {
        clearTimeout(t);
        resolve(data.toString());
      });
      ws!.on('error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    const msg = JSON.parse(mensagem);
    assert.equal(msg.type, 'ADMISSAO_ACEITA');
    assert.equal(msg.jogadorId, 'jogador-1');
    assert.equal(msg.apelido, 'Jogador 1');
    assert.equal(msg.partidaId, partidaId);
    assert.equal(msg.estado, 'preparada');

    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir no redis');
    const partida = JSON.parse(bruto!);
    const membroAtualizado = partida.roster.find((m: MembroDaSala) => m.jogadorId === 'jogador-1');
    assert.equal(membroAtualizado.presenca, 'conectado');

    // ao desconectar, presença deve voltar a em_reconexao (B1)
    ws.close();
    await new Promise<void>((resolve, reject) => {
      const inicio = Date.now();
      const check = async () => {
        const b = await redis.get(chaveDaPartida(partidaId));
        if (b !== null) {
          const p = JSON.parse(b) as { roster: MembroDaSala[] };
          if (p.roster.find((m) => m.jogadorId === 'jogador-1')?.presenca === 'em_reconexao') {
            resolve();
            return;
          }
        }
        if (Date.now() - inicio > 3000) {
          reject(new Error('timeout aguardando em_reconexao'));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
    const bruto2 = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto2 !== null);
    const partida2 = JSON.parse(bruto2!);
    assert.equal(partida2.roster.find((m: MembroDaSala) => m.jogadorId === 'jogador-1').presenca, 'em_reconexao');
  } finally {
    try { ws?.close(); } catch {}
    await servidor.fechar();
  }
});

test('Jogador FORA do roster é recusado', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-99');
    const token = criarJwt('jogador-99', 'Intruso', sessaoId);

    const resultado = await fazerUpgradeHttp(servidor.port, token, partidaId);

    assert.equal(resultado.status, 403);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'JOGADOR_FORA_DO_ROSTER');
  } finally {
    await servidor.fechar();
  }
});

test('JWT inválido/expirado é recusado', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    // Token com secret errado
    const tokenErrado = jwt.sign({ sub: 'jogador-1', apelido: 'Jogador 1' }, 'secret_completamente_diferente', { algorithm: 'HS256', expiresIn: '1h' });
    const resultadoErrado = await fazerUpgradeHttp(servidor.port, tokenErrado, partidaId);

    assert.equal(resultadoErrado.status, 401);
    const msgErrado = JSON.parse(resultadoErrado.texto);
    assert.equal(msgErrado.type, 'ADMISSAO_REJEITADA');
    assert.equal(msgErrado.codigo, 'SESSAO_INVALIDA');

    // Token sem campos obrigatórios no payload
    const tokenSemJogador = jwt.sign({ sessaoId: 'x' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const resultadoSemJogador = await fazerUpgradeHttp(servidor.port, tokenSemJogador, partidaId);
    assert.equal(resultadoSemJogador.status, 401);
    const msgSemJogador = JSON.parse(resultadoSemJogador.texto);
    assert.equal(msgSemJogador.codigo, 'SESSAO_INVALIDA');

    // Token expirado
    const tokenExpirado = criarJwt('jogador-1', 'Jogador 1', crypto.randomUUID(), { expiresIn: '0s' });
    const resultadoExpirado = await fazerUpgradeHttp(servidor.port, tokenExpirado, partidaId);

    assert.equal(resultadoExpirado.status, 401);
    const msgExpirado = JSON.parse(resultadoExpirado.texto);
    assert.equal(msgExpirado.type, 'ADMISSAO_REJEITADA');
    assert.equal(msgExpirado.codigo, 'SESSAO_INVALIDA');
  } finally {
    await servidor.fechar();
  }
});

test('serverId diferente no path é recusado com 404', async () => {
  const servidor = await subirServidor();
  try {
    const resultado = await fazerUpgradeHttp(servidor.port, 'qualquer-token', 'qualquer-partida', 'server-diferente');

    assert.equal(resultado.status, 404);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'SERVER_ID_INVALIDO');
  } finally {
    await servidor.fechar();
  }
});

test('partida-id inexistente é recusado', async () => {
  const servidor = await subirServidor();
  try {
    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');
    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);

    const resultado = await fazerUpgradeHttp(servidor.port, token, 'partida-que-nao-existe');

    assert.equal(resultado.status, 404);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});

test('partida-id ausente na query é recusado', async () => {
  const servidor = await subirServidor();
  try {
    const token = criarJwt('jogador-1', 'Jogador 1');

    // Usar http.request raw para capturar a resposta HTTP antes do upgrade
    const body = await new Promise<{ status: number; texto: string }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: servidor.port,
        path: `/ws/game/${SERVER_ID}?token=${token}`,
        method: 'GET',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });

      req.on('error', reject);
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        reject(new Error('upgrade inesperado'));
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

    assert.equal(body.status, 400);
    const msg = JSON.parse(body.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'PARTIDA_ID_AUSENTE');
  } finally {
    await servidor.fechar();
  }
});

test('os quatro jogadores do roster são admitidos e a partida transita para em_andamento na 4ª admissão', async () => {
  const servidor = await subirServidor();
  const sockets: WebSocket[] = [];
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const resultados: { msg: string; ws: WebSocket }[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${i}`);
      const token = criarJwt(`jogador-${i}`, `Jogador ${i}`, sessaoId);
      const ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
      sockets.push(ws);
      const msg = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout jogador-${i}`)), 3000);
        ws.on('message', (data) => {
          clearTimeout(t);
          resolve(data.toString());
        });
        ws.on('error', (err) => {
          clearTimeout(t);
          reject(err);
        });
      });
      resultados.push({ msg, ws });
    }

    for (let idx = 0; idx < resultados.length; idx++) {
      const { msg: mensagem } = resultados[idx]!;
      assert.ok(mensagem !== null, 'deveria receber ADMISSAO_ACEITA');
      const msg = JSON.parse(mensagem);
      assert.equal(msg.type, 'ADMISSAO_ACEITA');
      if (idx < 3) {
        assert.equal(msg.estado, 'preparada', `jogador ${idx + 1} deve receber preparada`);
      } else {
        assert.equal(msg.estado, 'em_andamento', '4º jogador deve receber em_andamento');
      }
    }

    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir');
    const partida = JSON.parse(bruto!);
    assert.equal(partida.estado, 'em_andamento');
    // Após início, a partida deixa de ter TTL (persiste)
    const ttl = await redis.ttl(chaveDaPartida(partidaId));
    assert.equal(ttl, -1, 'partida em_andamento não deve ter TTL');
  } finally {
    for (const ws of sockets) {
      try { ws.close(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await servidor.fechar();
  }
});

test('ESTADO_DA_PARTIDA snapshot contém tabuleiro e metadados do turno', async () => {
  const servidor = await subirServidorComPartida();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');
    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);

    const mensagens = await coletarMensagensWs(servidor.port, token, partidaId, { timeoutMs: 2000, aguardarTipos: ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO'] });
    assertOrdemTipos(mensagens, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    const parsed = mensagens.map((m) => JSON.parse(m));

    const admissao = parsed.find((m) => m.type === 'ADMISSAO_ACEITA');
    assert.ok(admissao, 'deveria receber ADMISSAO_ACEITA');
    assert.equal(admissao.estado, 'preparada');

    const estadoMsg = parsed.find((m) => m.type === 'ESTADO_DA_PARTIDA');
    assert.ok(estadoMsg, 'deveria receber ESTADO_DA_PARTIDA');
    const snap = estadoMsg.snapshot;
    assert.ok(snap, 'snapshot deve existir');
    assert.equal(snap.estado, 'preparada');
    assert.equal(snap.jogadorAtivoId, 'jogador-1');
    assert.equal(snap.rodada, 1);
    assert.equal(snap.posicaoConfirmada, false);
    assert.equal(snap.pecaDoInicioDoTurnoId, null);
    assert.ok(Array.isArray(snap.celulasIluminadas));
    assert.ok(Array.isArray(snap.tabuleiro.posicionadas));
    assert.ok(Array.isArray(snap.tabuleiro.iniciais));
    assert.equal(snap.tabuleiro.iniciais.length, 4);
    assert.ok(Array.isArray(snap.tabuleiro.peoes));
    assert.equal(snap.tabuleiro.peoes.length, 4);
    assert.ok(Array.isArray(snap.tabuleiro.recebidas));
    assert.ok(Array.isArray(snap.jogadores));
    assert.equal(snap.jogadores.length, 4);
    for (const j of snap.jogadores) {
      assert.ok(typeof j.jogadorId === 'string' && j.jogadorId.length > 0);
      assert.ok(typeof j.apelido === 'string' && j.apelido.length > 0);
      assert.ok(['branco', 'vermelho', 'azul', 'amarelo'].includes(j.cor));
      assert.ok(typeof j.ordem === 'number' && j.ordem >= 1 && j.ordem <= 4);
      assert.ok(typeof j.peaoId === 'string' && j.peaoId.startsWith('peao-'));
      assert.equal(typeof j.primeiroTurnoPendente, 'boolean');
    }
    // Verifica apelido/cor/ordem correspondem ao roster
    const j1 = snap.jogadores.find((j: any) => j.jogadorId === 'jogador-1');
    assert.equal(j1.apelido, 'Jogador 1');
    assert.equal(j1.cor, 'branco');
    assert.equal(j1.ordem, 1);
  } finally {
    await servidor.fechar();
  }
});

test('PARTIDA_INICIADA broadcast apenas na 4ª admissão', async () => {
  const servidor = await subirServidorComPartida();
  const sockets: WebSocket[] = [];
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const conectarComMensagens = async (n: number, aguardarTipos: readonly string[]): Promise<{ ws: WebSocket; mensagens: string[] }> => {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${n}`);
      const token = criarJwt(`jogador-${n}`, `Jogador ${n}`, sessaoId);
      const mensagens: string[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
      sockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`timeout jogador-${n} aguardando ${aguardarTipos.join(',')}`)), 3000);
        const check = () => {
          const tipos = mensagens.map((m) => {
            try { return (JSON.parse(m) as { type: string }).type; } catch { return ''; }
          });
          if (aguardarTipos.every((t) => tipos.includes(t))) {
            clearTimeout(timeout);
            setTimeout(resolve, 120);
          }
        };
        ws.on('message', (data) => {
          mensagens.push(data.toString());
          check();
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        // fallback timeout já cobre
      });
      return { ws, mensagens };
    };

    // 3 primeiras admissões não devem gerar PARTIDA_INICIADA — mantém sockets vivos
    const c1 = await conectarComMensagens(1, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assertOrdemTipos(c1.mensagens, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assert.equal((JSON.parse(c1.mensagens.find((m) => (JSON.parse(m) as { type: string }).type === 'ADMISSAO_ACEITA')!) as { estado: string }).estado, 'preparada');
    assert.equal(c1.mensagens.filter((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA').length, 0, 'jogador 1 não deve receber PARTIDA_INICIADA');

    const c2 = await conectarComMensagens(2, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assertOrdemTipos(c2.mensagens, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assert.equal(c2.mensagens.filter((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA').length, 0, 'jogador 2 não deve receber PARTIDA_INICIADA');
    // c1 ainda não deve ter recebido PARTIDA_INICIADA após entrada do 2
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(c1.mensagens.filter((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA').length, 0, 'jogador 1 não deve receber PARTIDA_INICIADA após 2ª admissão');

    const c3 = await conectarComMensagens(3, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assertOrdemTipos(c3.mensagens, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assert.equal(c3.mensagens.filter((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA').length, 0, 'jogador 3 não deve receber PARTIDA_INICIADA');
    await new Promise((r) => setTimeout(r, 200));
    for (const c of [c1, c2]) {
      assert.equal(c.mensagens.filter((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA').length, 0, 'nenhum dos 3 primeiros deve ter PARTIDA_INICIADA antes da 4ª');
    }

    // 4ª admissão deve gerar PARTIDA_INICIADA e estado em_andamento — ordem exata ST-14
    const c4 = await conectarComMensagens(4, ['ADMISSAO_ACEITA', 'PARTIDA_INICIADA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    assertOrdemTipos(c4.mensagens, ['ADMISSAO_ACEITA', 'PARTIDA_INICIADA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    const parsed4 = c4.mensagens.map((m) => JSON.parse(m) as { type: string; estado?: string; snapshot?: { estado: string }; partidaId?: string });
    const adm4 = parsed4.find((m) => m.type === 'ADMISSAO_ACEITA') as { estado: string } | undefined;
    assert.ok(adm4, '4º jogador deve receber ADMISSAO_ACEITA');
    assert.equal(adm4.estado, 'em_andamento');
    const estado4 = parsed4.find((m) => m.type === 'ESTADO_DA_PARTIDA') as { snapshot: { estado: string } } | undefined;
    assert.ok(estado4, '4º jogador deve receber ESTADO_DA_PARTIDA');
    assert.equal(estado4.snapshot.estado, 'em_andamento');
    const iniciadas = parsed4.filter((m) => m.type === 'PARTIDA_INICIADA');
    assert.equal(iniciadas.length, 1, '4º jogador deve receber PARTIDA_INICIADA');
    assert.equal((iniciadas[0] as { partidaId: string }).partidaId, partidaId);

    // Verifica que os 3 primeiros também receberam o broadcast após a 4ª
    await new Promise((r) => setTimeout(r, 300));
    for (const c of [c1, c2, c3]) {
      const tipos = c.mensagens.map((m) => (JSON.parse(m) as { type: string }).type);
      assert.ok(tipos.includes('PARTIDA_INICIADA'), 'jogadores anteriores devem receber PARTIDA_INICIADA via broadcast na 4ª admissão');
    }

    // Verifica persistência sem TTL para partida e estado
    const ttlPartida = await redis.ttl(chaveDaPartida(partidaId));
    assert.equal(ttlPartida, -1);
    const ttlEstado = await redis.ttl(chaveDoEstadoDaPartida(partidaId));
    assert.equal(ttlEstado, -1);
  } finally {
    for (const ws of sockets) {
      try { ws.close(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await servidor.fechar();
  }
});

test('partida em estado não preparada é recusada', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);
    await redis.set(chaveDaPartida(partidaId), JSON.stringify({
      partidaId,
      serverId: SERVER_ID,
      salaId: 'sala-teste',
      codigoDeSala: 'TEST01',
      roster,
      estado: 'encerrada',
      criadaEm: new Date().toISOString(),
    }), 'EX', 600);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');
    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);

    const resultado = await fazerUpgradeHttp(servidor.port, token, partidaId);

    assert.equal(resultado.status, 404);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});

test('sessão revogada/inexistente é recusada mesmo com JWT válido', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    const sessaoId = crypto.randomUUID();
    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);
    // Não cria a sessão no Redis -> sessão inexistente

    const resultado = await fazerUpgradeHttp(servidor.port, token, partidaId);

    assert.equal(resultado.status, 401);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.codigo, 'SESSAO_INVALIDA');
  } finally {
    await servidor.fechar();
  }
});

test('token de sessão ausente é recusado', async () => {
  const servidor = await subirServidor();
  try {
    const body = await new Promise<{ status: number; texto: string }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: servidor.port,
        path: `/ws/game/${SERVER_ID}?partida-id=qualquer`,
        method: 'GET',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });

      req.on('error', reject);
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        reject(new Error('upgrade inesperado'));
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

    assert.equal(body.status, 401);
    const msg = JSON.parse(body.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'SESSAO_INVALIDA');
  } finally {
    await servidor.fechar();
  }
});

test('JWT sem sessaoId é recusado com SESSAO_INVALIDA', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    // Token válido porém sem o claim sessaoId obrigatório
    const token = criarJwt('jogador-1', 'Jogador 1');

    const resultado = await fazerUpgradeHttp(servidor.port, token, partidaId);

    assert.equal(resultado.status, 401);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'SESSAO_INVALIDA');
  } finally {
    await servidor.fechar();
  }
});

test('falha interna responde 500 com codigo ERRO_INTERNO', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    await redis.set(chaveDaPartida(partidaId), '{json-corrompido', 'EX', 600);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');
    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);

    const resultado = await fazerUpgradeHttp(servidor.port, token, partidaId);

    assert.equal(resultado.status, 500);
    const msg = JSON.parse(resultado.texto);
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'ERRO_INTERNO');
  } finally {
    await servidor.fechar();
  }
});

test('desconexão antes da 4ª admissão não inicia a partida', async () => {
  const servidor = await subirServidorComPartida();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const conectarPersistente = async (n: number): Promise<{ ws: WebSocket; mensagens: string[] }> => {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${n}`);
      const token = criarJwt(`jogador-${n}`, `Jogador ${n}`, sessaoId);
      const mensagens: string[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`timeout admissao jogador-${n}`)), 3000);
        ws.on('message', (data) => {
          const txt = data.toString();
          mensagens.push(txt);
          try {
            const parsed = JSON.parse(txt) as { type: string };
            if (parsed.type === 'ADMISSAO_ACEITA') {
              clearTimeout(timeout);
              setTimeout(resolve, 250);
            }
          } catch {}
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      return { ws, mensagens };
    };

    const c1 = await conectarPersistente(1);
    const c2 = await conectarPersistente(2);
    const c3 = await conectarPersistente(3);

    for (const c of [c1, c2, c3]) {
      const adm = c.mensagens.map((m) => JSON.parse(m) as { type: string; estado: string }).find((m) => m.type === 'ADMISSAO_ACEITA');
      assert.ok(adm, 'deveria receber ADMISSAO_ACEITA');
      assert.equal(adm.estado, 'preparada');
      const iniciadas = c.mensagens.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'PARTIDA_INICIADA');
      assert.equal(iniciadas.length, 0, 'não deve ter PARTIDA_INICIADA antes da 4ª');
    }

    c2.ws.close();

    const aguardarPresenca = async (jogadorId: string, esperado: string): Promise<void> => {
      const inicio = Date.now();
      while (Date.now() - inicio < 3000) {
        const bruto = await redis.get(chaveDaPartida(partidaId));
        if (bruto !== null) {
          const partida = JSON.parse(bruto) as { roster: MembroDaSala[] };
          const membroAlvo = partida.roster.find((m) => m.jogadorId === jogadorId);
          if (membroAlvo?.presenca === esperado) return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail(`presenca de ${jogadorId} não virou ${esperado} a tempo`);
    };
    await aguardarPresenca('jogador-2', 'em_reconexao');

    const c4 = await conectarPersistente(4);

    await new Promise((r) => setTimeout(r, 500));

    const adm4 = c4.mensagens.map((m) => JSON.parse(m) as { type: string; estado: string }).find((m) => m.type === 'ADMISSAO_ACEITA');
    assert.ok(adm4, '4º jogador deve receber ADMISSAO_ACEITA');
    assert.equal(adm4.estado, 'preparada', 'com um offline, partida deve permanecer preparada');

    const tipos4 = c4.mensagens.map((m) => (JSON.parse(m) as { type: string }).type);
    assert.ok(!tipos4.includes('PARTIDA_INICIADA'), 'não deve receber PARTIDA_INICIADA quando há jogador offline');

    for (const c of [c1, c3]) {
      const tipos = c.mensagens.map((m) => (JSON.parse(m) as { type: string }).type);
      assert.ok(!tipos.includes('PARTIDA_INICIADA'), 'outros jogadores não devem receber PARTIDA_INICIADA');
    }

    const brutoFinal = await redis.get(chaveDaPartida(partidaId));
    assert.ok(brutoFinal, 'partida deve existir');
    const partidaFinal = JSON.parse(brutoFinal) as { estado: string };
    assert.equal(partidaFinal.estado, 'preparada');

    const ttl = await redis.ttl(chaveDaPartida(partidaId));
    assert.ok(ttl > 0, `ttl deve ser >0 mas foi ${ttl}`);

    c1.ws.close();
    c3.ws.close();
    c4.ws.close();
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    await servidor.fechar();
  }
});

/** Aguarda o primeiro frame do socket e confirma que é ADMISSAO_ACEITA. */
function aguardarAdmissao(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout aguardando ADMISSAO_ACEITA')), 3000);
    const onErro = (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    };
    ws.once('message', (data) => {
      clearTimeout(timeout);
      ws.off('error', onErro);
      try {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === 'ADMISSAO_ACEITA') {
          resolve();
        } else {
          reject(new Error(`primeira mensagem não foi ADMISSAO_ACEITA: ${msg.type}`));
        }
      } catch (erro) {
        reject(erro as Error);
      }
    });
    ws.on('error', onErro);
  });
}

test('conexão duplicada do mesmo jogador encerra a anterior (4409) sem corromper presença', async () => {
  const servidor = await subirServidorComPartida();
  const abertos: WebSocket[] = [];
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    // 1ª conexão de jogador-1 — permanece aberta para ser substituída.
    const sessaoIdA = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoIdA, 'jogador-1');
    const tokenA = criarJwt('jogador-1', 'Jogador 1', sessaoIdA);
    const antigo = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${tokenA}`);
    abertos.push(antigo);
    const fechamentoAntigo = new Promise<{ code: number | null; reason: string }>((resolve) => {
      antigo.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    await aguardarAdmissao(antigo);

    // 2ª conexão (duplicada) do mesmo jogador — sessão nova, mesmo Jogador.
    const admissaoDoNovo: { recebida: boolean } = { recebida: false };
    const sessaoIdB = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoIdB, 'jogador-1');
    const tokenB = criarJwt('jogador-1', 'Jogador 1', sessaoIdB);
    const novo = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${tokenB}`);
    abertos.push(novo);
    const mensagensNovo: string[] = [];
    novo.on('message', (data) => {
      const texto = data.toString();
      mensagensNovo.push(texto);
      if ((JSON.parse(texto) as { type: string }).type === 'ADMISSAO_ACEITA') {
        admissaoDoNovo.recebida = true;
      }
    });
    await aguardarAdmissao(novo);

    // A conexão anterior é encerrada com o código da substituição (#155) —
    // e apenas depois de o novo socket ter recebido ADMISSAO_ACEITA.
    const fecho = await Promise.race([
      fechamentoAntigo,
      new Promise<never>((_, rejeitar) =>
        setTimeout(() => rejeitar(new Error('timeout aguardando fechamento da conexão antiga')), 3000)),
    ]);
    assert.equal(admissaoDoNovo.recebida, true, 'novo socket deve ter recebido ADMISSAO_ACEITA antes do fechamento do antigo');
    assert.equal(fecho.code, 4409);
    assert.equal(fecho.reason, 'CONEXAO_SUBSTITUIDA');

    // Presença preservada: o fechamento da conexão substituída NÃO marca
    // `em_reconexao` — o Jogador segue `conectado` pela nova conexão.
    await new Promise((r) => setTimeout(r, 300));
    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir no redis');
    const partida = JSON.parse(bruto!) as { roster: MembroDaSala[] };
    assert.equal(
      partida.roster.find((m) => m.jogadorId === 'jogador-1')?.presenca,
      'conectado',
      'presença de jogador-1 deve permanecer conectado após a substituição',
    );

    // A nova conexão permanece viva e continua recebendo broadcast: completar
    // as 4 admissões dispara PARTIDA_INICIADA em broadcast.
    for (const n of [2, 3, 4]) {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${n}`);
      const token = criarJwt(`jogador-${n}`, `Jogador ${n}`, sessaoId);
      const ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`);
      abertos.push(ws);
      await aguardarAdmissao(ws);
    }
    await new Promise((r) => setTimeout(r, 300));
    const tiposNovo = mensagensNovo.map((m) => (JSON.parse(m) as { type: string }).type);
    assert.ok(
      tiposNovo.includes('PARTIDA_INICIADA'),
      `novo socket deveria receber o broadcast PARTIDA_INICIADA; recebeu ${tiposNovo.join(', ')}`,
    );
    assert.ok(novo.readyState === WebSocket.OPEN, 'nova conexão deve permanecer aberta');
  } finally {
    for (const ws of abertos) {
      try { ws.close(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await servidor.fechar();
  }
});

/**
 * Aguarda, por sondagem, que a coleção de mensagens receba um `tipo` — usado
 * em sockets já abertos com coletor próprio (broadcast chega de forma assíncrona).
 */
function aguardarTipo(mensagens: readonly string[], tipo: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const verificar = () => {
      const presente = mensagens.some((m) => {
        try { return (JSON.parse(m) as { type: string }).type === tipo; } catch { return false; }
      });
      if (presente) {
        resolve();
        return;
      }
      if (Date.now() - inicio > timeoutMs) {
        reject(new Error(`timeout aguardando ${tipo}`));
        return;
      }
      setTimeout(verificar, 50);
    };
    verificar();
  });
}

/**
 * Cliente Redis que delega tudo ao cliente real, mas faz a `chamadaFalha`-ésima
 * chamada de `eval` (a transição de presença da admissão) devolver a mesma
 * resposta do script Lua quando a chave da partida não existe (`estado: ''`),
 * forçando `transicao === null` de forma determinística — deletar a chave do
 * Redis na janela entre as duas leituras do servidor seria racy.
 */
function clienteRedisComFalhaNaTransicao(real: Redis, chamadaFalha: number): Redis {
  let chamadas = 0;
  const respostaDeFalha = JSON.stringify({ mudou: false, completo: false, iniciou: false, estado: '' });
  const cliente: Redis = Object.create(real);
  const evalOriginal = real.eval.bind(real) as (...args: unknown[]) => Promise<unknown>;
  (cliente as { eval: unknown }).eval = (...args: unknown[]) => {
    chamadas += 1;
    if (chamadas === chamadaFalha) {
      return Promise.resolve(respostaDeFalha);
    }
    return evalOriginal(...args);
  };
  return cliente;
}

function fechoDe(ws: WebSocket): Promise<{ code: number | null; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function comTimeout<T>(promessa: Promise<T>, mensagem: string, ms = 3000): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error(mensagem)), ms)),
  ]);
}

test('falha na transição após substituição restaura a conexão anterior e preserva presença', async () => {
  const servidor = await subirServidorComPartida(clienteRedisComFalhaNaTransicao(redis, 2));
  const abertos: WebSocket[] = [];
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    // 1ª conexão de jogador-1 — transição real (eval nº 1): jogador conectado.
    const sessaoIdA = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoIdA, 'jogador-1');
    const antigo = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${criarJwt('jogador-1', 'Jogador 1', sessaoIdA)}`);
    abertos.push(antigo);
    await aguardarAdmissao(antigo);

    // 2ª conexão (duplicada) — transição forçada a falhar (eval nº 2): o
    // socket novo recebe ADMISSAO_REJEITADA + close 1011 e a conexão antiga
    // volta a ser a vigente (restauração do caminho de falha).
    const sessaoIdB = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoIdB, 'jogador-1');
    const novo = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${criarJwt('jogador-1', 'Jogador 1', sessaoIdB)}`);
    abertos.push(novo);
    const rejeicaoNovo = new Promise<string>((resolve) => {
      novo.once('message', (data) => resolve(data.toString()));
    });
    const mensagemNovo = JSON.parse(await comTimeout(rejeicaoNovo, 'timeout aguardando ADMISSAO_REJEITADA no socket novo')) as { type: string };
    assert.equal(mensagemNovo.type, 'ADMISSAO_REJEITADA');
    const fechoNovo = await comTimeout(fechoDe(novo), 'timeout aguardando fechamento do socket novo');
    assert.equal(fechoNovo.code, 1011);
    assert.equal(fechoNovo.reason, 'ERRO_INTERNO');
    assert.equal(antigo.readyState, WebSocket.OPEN, 'conexão antiga deve permanecer aberta após a restauração');

    // Presença preservada: a restauração não marca `em_reconexao`.
    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir no redis');
    const partida = JSON.parse(bruto) as { roster: MembroDaSala[] };
    assert.equal(
      partida.roster.find((m) => m.jogadorId === 'jogador-1')?.presenca,
      'conectado',
      'presença de jogador-1 deve permanecer conectado após a falha com restauração',
    );

    // 3ª conexão — prova externa do registro: a substituição fecha a ANTIGA
    // com 4409. Se o registro ainda apontasse para a conexão falhada, o 4409
    // iria para o socket morto e a antiga ficaria aberta.
    const sessaoIdC = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoIdC, 'jogador-1');
    const terceiro = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${criarJwt('jogador-1', 'Jogador 1', sessaoIdC)}`);
    abertos.push(terceiro);
    const fechoAntigo = fechoDe(antigo);
    await aguardarAdmissao(terceiro);
    const fecho = await comTimeout(fechoAntigo, 'timeout aguardando fechamento da conexão antiga (3ª conexão)');
    assert.equal(fecho.code, 4409);
    assert.equal(fecho.reason, 'CONEXAO_SUBSTITUIDA');
    assert.equal(terceiro.readyState, WebSocket.OPEN, 'a 3ª conexão deve permanecer aberta');
  } finally {
    for (const ws of abertos) {
      try { ws.close(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await servidor.fechar();
  }
});

test('substituição de conexão não conta como jogador distinto na 4ª admissão', async () => {
  const servidor = await subirServidorComPartida();
  const abertos: WebSocket[] = [];
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const conectar = async (n: number): Promise<WebSocket> => {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${n}`);
      const ws = new WebSocket(`ws://127.0.0.1:${servidor.port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${criarJwt(`jogador-${n}`, `Jogador ${n}`, sessaoId)}`);
      abertos.push(ws);
      return ws;
    };
    const comColetor = (ws: WebSocket): string[] => {
      const mensagens: string[] = [];
      ws.on('message', (data) => mensagens.push(data.toString()));
      return mensagens;
    };

    // jogador-1 conecta e é substituído por uma duplicata ANTES da 4ª admissão.
    const antigo = await conectar(1);
    await aguardarAdmissao(antigo);
    const fechoAntigo = fechoDe(antigo);
    const duplicado = await conectar(1);
    const mensagensDuplicado = comColetor(duplicado);
    await aguardarAdmissao(duplicado);
    const fecho = await comTimeout(fechoAntigo, 'timeout aguardando fechamento da conexão substituída');
    assert.equal(fecho.code, 4409);
    assert.equal(fecho.reason, 'CONEXAO_SUBSTITUIDA');

    // 2º e 3º jogadores — com a duplicata viva, ainda há apenas 3 jogadores
    // distintos conectados (4 conexões): nenhuma PARTIDA_INICIADA pode ocorrer.
    const ws2 = await conectar(2);
    const mensagens2 = comColetor(ws2);
    await aguardarAdmissao(ws2);
    const ws3 = await conectar(3);
    const mensagens3 = comColetor(ws3);
    await aguardarAdmissao(ws3);
    await new Promise((r) => setTimeout(r, 300));
    for (const [nome, mensagens] of [['duplicado', mensagensDuplicado], ['jogador-2', mensagens2], ['jogador-3', mensagens3]] as const) {
      assert.ok(
        !mensagens.some((m) => (JSON.parse(m) as { type: string }).type === 'PARTIDA_INICIADA'),
        `${nome} não deve receber PARTIDA_INICIADA antes da 4ª admissão`,
      );
    }

    // 4º jogador distinto — a partida inicia: ordem exata ST-14 no socket do
    // 4º e PARTIDA_INICIADA em broadcast para os demais.
    const ws4 = await conectar(4);
    const mensagens4 = comColetor(ws4);
    await aguardarAdmissao(ws4);
    await Promise.all([
      aguardarTipo(mensagens4, 'TURNO_INICIADO'),
      aguardarTipo(mensagensDuplicado, 'PARTIDA_INICIADA'),
      aguardarTipo(mensagens2, 'PARTIDA_INICIADA'),
      aguardarTipo(mensagens3, 'PARTIDA_INICIADA'),
    ]);
    assertOrdemTipos(mensagens4, ['ADMISSAO_ACEITA', 'PARTIDA_INICIADA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);

    // Início remove o TTL das duas chaves (#155) e presença fica conectada.
    assert.equal(await redis.ttl(chaveDaPartida(partidaId)), -1);
    assert.equal(await redis.ttl(chaveDoEstadoDaPartida(partidaId)), -1);
    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir no redis');
    const partida = JSON.parse(bruto) as { roster: MembroDaSala[] };
    for (const m of partida.roster) {
      assert.equal(m.presenca, 'conectado', `presença de ${m.jogadorId} deveria ser conectado`);
    }
  } finally {
    for (const ws of abertos) {
      try { ws.close(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await servidor.fechar();
  }
});
