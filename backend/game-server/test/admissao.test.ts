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

test('os quatro jogadores do roster são admitidos e a partida permanece preparada', async () => {
  const servidor = await subirServidor();
  try {
    const partidaId = crypto.randomUUID() as PartidaId;
    const roster: MembroDaSala[] = [membro(1), membro(2), membro(3), membro(4)];
    await criarPartidaNoRedis(partidaId, roster);

    const resultados: ResultadoWs[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const sessaoId = crypto.randomUUID();
      await criarSessaoNoRedis(sessaoId, `jogador-${i}`);
      const token = criarJwt(`jogador-${i}`, `Jogador ${i}`, sessaoId);
      resultados.push(await conectarWs(servidor.port, token, partidaId));
    }

    for (const resultado of resultados) {
      assert.ok(resultado.conectou, 'todos os do roster deveriam conectar');
      assert.ok(resultado.mensagem !== null, 'deveria receber ADMISSAO_ACEITA');
      assert.equal(JSON.parse(resultado.mensagem!).type, 'ADMISSAO_ACEITA');
    }

    const bruto = await redis.get(chaveDaPartida(partidaId));
    assert.ok(bruto !== null, 'partida deveria existir');
    const partida = JSON.parse(bruto!);
    assert.equal(partida.estado, 'preparada');
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
      estado: 'em_andamento',
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
