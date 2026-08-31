import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
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

async function subirServidorComPartida(): Promise<ServidorEfemero & { broadcaster: PartidaBroadcaster; handlers: PartidaHandlers; wss: import('ws').WebSocketServer }> {
  const contexto: ContextoDoGameServer = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: 600,
  };
  const app = createApp(contexto);
  const server = http.createServer(app);
  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({ redis, broadcaster });
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
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-1');

    const token = criarJwt('jogador-1', 'Jogador 1', sessaoId);
    const resultado = await conectarWs(servidor.port, token, partidaId);

    assert.ok(resultado.conectou, 'deveria ter conectado');
    assert.ok(resultado.mensagem !== null, 'deveria ter recebido mensagem');
    const msg = JSON.parse(resultado.mensagem!);
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
  } finally {
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
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    const resultados: ResultadoWs[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${i}`);
      const token = criarJwt(`jogador-${i}`, `Jogador ${i}`, sessaoId);
      resultados.push(await conectarWs(servidor.port, token, partidaId));
    }

    for (let idx = 0; idx < resultados.length; idx++) {
      const resultado = resultados[idx]!;
      assert.ok(resultado.conectou, 'todos os do roster deveriam conectar');
      assert.ok(resultado.mensagem !== null, 'deveria receber ADMISSAO_ACEITA');
      const msg = JSON.parse(resultado.mensagem!);
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
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaComEstadoNoRedis(partidaId, roster);

    // 3 primeiras admissões não devem gerar PARTIDA_INICIADA — coleta por evento e assert de ordem
    for (let i = 1; i <= 3; i++) {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${i}`);
      const token = criarJwt(`jogador-${i}`, `Jogador ${i}`, sessaoId);
      const msgs = await coletarMensagensWs(servidor.port, token, partidaId, { timeoutMs: 2000, aguardarTipos: ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO'] });
      assertOrdemTipos(msgs, ['ADMISSAO_ACEITA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
      const parsed = msgs.map((m) => JSON.parse(m));
      assert.ok(parsed.find((m) => m.type === 'ADMISSAO_ACEITA'), `jogador ${i} deve receber ADMISSAO_ACEITA`);
      assert.equal(parsed.find((m) => m.type === 'ADMISSAO_ACEITA').estado, 'preparada');
      assert.ok(parsed.find((m) => m.type === 'ESTADO_DA_PARTIDA'), `jogador ${i} deve receber ESTADO_DA_PARTIDA`);
      assert.equal(parsed.filter((m) => m.type === 'PARTIDA_INICIADA').length, 0, `jogador ${i} não deve receber PARTIDA_INICIADA`);
    }

    // 4ª admissão deve gerar PARTIDA_INICIADA e estado em_andamento — ordem exata ST-14
    const sessaoId4 = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId4, 'jogador-4');
    const token4 = criarJwt('jogador-4', 'Jogador 4', sessaoId4);
    const msgs4 = await coletarMensagensWs(servidor.port, token4, partidaId, { timeoutMs: 2000, aguardarTipos: ['ADMISSAO_ACEITA', 'PARTIDA_INICIADA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO'] });
    assertOrdemTipos(msgs4, ['ADMISSAO_ACEITA', 'PARTIDA_INICIADA', 'ESTADO_DA_PARTIDA', 'TURNO_INICIADO']);
    const parsed4 = msgs4.map((m) => JSON.parse(m));
    const adm4 = parsed4.find((m) => m.type === 'ADMISSAO_ACEITA');
    assert.ok(adm4, '4º jogador deve receber ADMISSAO_ACEITA');
    assert.equal(adm4.estado, 'em_andamento');
    const estado4 = parsed4.find((m) => m.type === 'ESTADO_DA_PARTIDA');
    assert.ok(estado4, '4º jogador deve receber ESTADO_DA_PARTIDA');
    assert.equal(estado4.snapshot.estado, 'em_andamento');
    const iniciadas = parsed4.filter((m) => m.type === 'PARTIDA_INICIADA');
    assert.equal(iniciadas.length, 1, '4º jogador deve receber PARTIDA_INICIADA');
    assert.equal(iniciadas[0].partidaId, partidaId);

    // Verifica persistência sem TTL para partida e estado
    const ttlPartida = await redis.ttl(chaveDaPartida(partidaId));
    assert.equal(ttlPartida, -1);
    const ttlEstado = await redis.ttl(chaveDoEstadoDaPartida(partidaId));
    assert.equal(ttlEstado, -1);
  } finally {
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
