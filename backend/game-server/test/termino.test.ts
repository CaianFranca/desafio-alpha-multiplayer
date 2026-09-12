// Teste wire-level do término da partida no serviço (issue #179 / ST-16).
//
// Padrão de limpeza.test.ts e turnos.test.ts: servidor efêmero + Redis real,
// 4 sockets simultâneos com admissão completa. Cobre os critérios de #179:
// - Snapshot da Conexão à Partida entregue a quem se conecta (recarregamento)
//   com estado terminada e o Resultado preservado
// - Recusa de comando de jogo pós-término com o código próprio
//   PARTIDA_TERMINADA (via ERRO_DO_TABULEIRO)
//
// O término é semeado sobrescrevendo o estado persistido do engine no Redis
// (obterEstadoDaPartida/salvarEstadoDaPartida): dirigir uma vitória/derrota
// real por WS seria inviável e o estado do engine persistido é a interface
// pública do game-server. Recarregamento e recusa são exercitados pelas vias
// reais (admissão + dispatch).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { criarClienteRedis } from '@flicker/config';
import type { AvisoDeRetorno } from '../src/retorno/cliente.ts';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { chaveDoEstadoDaPartida } from '../src/partidas/chaves.ts';
import {
  aplicarRetencaoDeTermino,
  obterEstadoDaPartida,
  salvarEstadoDaPartida,
} from '../src/partidas/estado.ts';

const SERVER_ID = 'game-server-teste-termino';
const JWT_SECRET = 'test_secret_para_termino';

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
  readonly wsUrl: (partidaId: string, token: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(
  ttlSegundos: number,
  partidaTerminadaTtlSegundos = 3600,
  notificarRetorno?: (aviso: AvisoDeRetorno) => Promise<void>,
  redisDoHandler: Redis = redis,
): Promise<ServidorEfemero> {
  const contexto = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: ttlSegundos,
    partidaTerminadaTtlSegundos,
    lobbyRetornoCallbackUrl: 'http://localhost:3001/api/retorno',
  };
  const app = createApp(contexto);
  const server = http.createServer(app);

  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({
    redis: redisDoHandler,
    broadcaster,
    partidaTerminadaTtlSegundos,
    notificarRetorno,
  });
  const wss = criarWebSocketServer(server, contexto, {
    partida: { broadcaster, handlers },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const endereco = server.address() as AddressInfo;
  const port = endereco.port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: (partidaId: string, token: string) =>
      `ws://127.0.0.1:${port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`,
    fechar: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
    },
  };
}

function criarJwt(jogadorId: string, apelido: string, sessaoId: string): string {
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function criarSessaoNoRedis(sessaoId: string, jogadorId: string): Promise<void> {
  await redis.set(`sessao:${sessaoId}`, JSON.stringify({ jogadorId, criadoEm: new Date().toISOString() }), 'EX', 3600);
}

async function tokenParaJogador(n: number): Promise<string> {
  const jogadorId = `jogador-${n}`;
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return criarJwt(jogadorId, `Jogador ${n}`, sessaoId);
}

function membro(n: number): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
  };
}

function ofertaValida(): OfertaDeEncaminhamento {
  return {
    salaId: 'sala-1',
    codigoDeSala: 'ABC123',
    roster: [membro(1), membro(2), membro(3), membro(4)] as OfertaDeEncaminhamento['roster'],
  };
}

function postOferta(baseUrl: string, corpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

function deletePartida(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de término' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

async function conectarPartida(servidor: ServidorEfemero, partidaId: string, jogador = 1): Promise<WebSocket> {
  const token = await tokenParaJogador(jogador);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const aceita = esperarEvento(ws, 'ADMISSAO_ACEITA');

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  try {
    const mensagem = await aceita;
    assert.equal(mensagem.jogadorId, `jogador-${jogador}`);
    return ws;
  } catch (erro) {
    ws.close();
    throw erro;
  }
}

// Reconexão do mesmo Jogador (caminho do recarregamento): o listener do
// snapshot é anexado ANTES do `open` para não perder o frame que o servidor
// envia logo após a admissão.
async function reconectarPartida(
  servidor: ServidorEfemero,
  partidaId: string,
  jogador = 1,
): Promise<{ ws: WebSocket; snapshot: Record<string, unknown> }> {
  const token = await tokenParaJogador(jogador);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const snapshotPromise = esperarEvento(ws, 'ESTADO_DA_PARTIDA');

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  try {
    const mensagem = await esperarEvento(ws, 'ADMISSAO_ACEITA');
    assert.equal(mensagem.jogadorId, `jogador-${jogador}`);
  } catch (erro) {
    ws.close();
    throw erro;
  }

  const snapshot = await snapshotPromise;
  return { ws, snapshot };
}

async function semearTermino(
  partidaId: string,
  resultado: { tipo: 'vitoria' } | { tipo: 'derrota'; motivo: 'caixa_esgotada' | 'equipe_amedrontada' },
): Promise<void> {
  const estado = await obterEstadoDaPartida(redis, partidaId);
  assert.ok(estado !== null, 'estado da partida deve existir no Redis antes da semeadura');
  await salvarEstadoDaPartida(redis, partidaId, { ...estado, resultado });
}

async function semearEstadoProntoParaVitoria(partidaId: string): Promise<void> {
  const estado = await obterEstadoDaPartida(redis, partidaId);
  assert.ok(estado !== null, 'estado da partida deve existir antes da semeadura da vitória');

  const pecaDoPortao = {
    pecaId: 'portao-de-teste',
    tipo: 'portao_de_saida' as const,
    orientacao: 0 as const,
    celula: { linha: 3, coluna: 3 },
  };

  await salvarEstadoDaPartida(redis, partidaId, {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [pecaDoPortao],
      peoes: estado.tabuleiro.peoes.map((peao) => ({
        ...peao,
        pecaId: pecaDoPortao.pecaId,
      })),
    },
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
    cartaoDeAcessoObtido: true,
  });
}

function esperarEvento(
  ws: WebSocket,
  tipo: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMensagem);
      reject(new Error(`timeout aguardando evento WS '${tipo}'`));
    }, timeoutMs);
    function onMensagem(data: unknown): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse((data as Buffer).toString());
      } catch {
        return;
      }
      if (
        typeof parsed === 'object'
        && parsed !== null
        && (parsed as { type?: unknown }).type === tipo
      ) {
        clearTimeout(timer);
        ws.removeListener('message', onMensagem);
        resolve(parsed as Record<string, unknown>);
      }
    }
    ws.on('message', onMensagem);
  });
}

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(async () => {
  try {
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

// ────────────────────────────────────────────────────────────────
// Teste A — recarregamento: snapshot com estado terminada e resultado
// ────────────────────────────────────────────────────────────────

test('Termino: quem se conecta apos o termino recebe snapshot terminada com o resultado', async () => {
  const servidor = await subirServidor(600);
  const aceite = await criarPartidaViaPost(servidor.baseUrl);

  const ws1 = await conectarPartida(servidor, aceite.partidaId, 1);
  const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
  const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
  const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

  try {
    // Recarregamento: jogador-1 fecha a página e reconecta em seguida.
    ws1.close();
    await sleep(200);

    await semearTermino(aceite.partidaId, { tipo: 'vitoria' });

    const { ws: ws1b, snapshot } = await reconectarPartida(servidor, aceite.partidaId, 1);
    try {
      // `snapshot` é o envelope ESTADO_DA_PARTIDA; a projeção vive em `.snapshot`.
      const projecao = snapshot.snapshot as { estado: unknown; resultado: unknown };
      assert.equal(projecao.estado, 'terminada');
      assert.equal(projecao.resultado, 'vitoria');
    } finally {
      ws1b.close();
    }
  } finally {
    ws2.close();
    ws3.close();
    ws4.close();
  }

  await deletePartida(servidor.baseUrl, aceite.partidaId);
  await servidor.fechar();
});

// ────────────────────────────────────────────────────────────────
// Teste B — recusa pós-término com código próprio
// ────────────────────────────────────────────────────────────────

test('Termino: comando de jogo pós-término é recusado com PARTIDA_TERMINADA', async () => {
  const servidor = await subirServidor(600);
  const aceite = await criarPartidaViaPost(servidor.baseUrl);

  const ws1 = await conectarPartida(servidor, aceite.partidaId, 1);
  const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
  const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
  const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

  try {
    await semearTermino(aceite.partidaId, { tipo: 'derrota', motivo: 'equipe_amedrontada' });

    enviar(ws1, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
    const erro = await esperarEvento(ws1, 'ERRO_DO_TABULEIRO');
    assert.equal(erro.codigo, 'PARTIDA_TERMINADA');
    assert.equal(typeof erro.mensagem, 'string');
    assert.ok((erro.mensagem as string).length > 0);
  } finally {
    ws1.close();
    ws2.close();
    ws3.close();
    ws4.close();
  }

  await deletePartida(servidor.baseUrl, aceite.partidaId);
  await servidor.fechar();
});

test('Termino: broadcast, retenção e callback acontecem no término real da partida', async () => {
  const ttlTerminada = 30;
  let avisoRecebido: AvisoDeRetorno | undefined;
  let resolverAviso: ((aviso: AvisoDeRetorno) => void) | undefined;
  const avisoPromise = new Promise<AvisoDeRetorno>((resolve) => {
    resolverAviso = resolve;
  });
  const servidor = await subirServidor(600, ttlTerminada, async (aviso) => {
    avisoRecebido = aviso;
    resolverAviso?.(aviso);
  });
  const aceite = await criarPartidaViaPost(servidor.baseUrl);

  const sockets = await Promise.all([
    conectarPartida(servidor, aceite.partidaId, 1),
    conectarPartida(servidor, aceite.partidaId, 2),
    conectarPartida(servidor, aceite.partidaId, 3),
    conectarPartida(servidor, aceite.partidaId, 4),
  ]);

  try {
    await semearEstadoProntoParaVitoria(aceite.partidaId);
    const terminados = sockets.map((socket) => esperarEvento(socket, 'PARTIDA_TERMINADA'));
    enviar(sockets[0], { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });

    const eventos = await Promise.all(terminados);
    assert.deepEqual(eventos.map((evento) => evento.resultado), ['vitoria', 'vitoria', 'vitoria', 'vitoria']);

    const aviso = await avisoPromise;
    const { chaveDaPartida } = await import('../src/partidas/chaves.ts');
    const ttlPartida = await redis.ttl(chaveDaPartida(aceite.partidaId));
    const ttlEstado = await redis.ttl(chaveDoEstadoDaPartida(aceite.partidaId));
    assert.ok(ttlPartida > 0 && ttlPartida <= ttlTerminada, `TTL da partida inválido: ${ttlPartida}`);
    assert.ok(ttlEstado > 0 && ttlEstado <= ttlTerminada, `TTL do estado inválido: ${ttlEstado}`);

    assert.equal(avisoRecebido, aviso);
    assert.deepEqual(aviso, {
      salaId: 'sala-1',
      partidaId: aceite.partidaId,
      serverId: SERVER_ID,
      resultado: 'vitoria',
      jogadores: ['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4'],
      // Vitória limpa, sem desistência: 409 do lobby continua definitivo.
      teveDesistencia: false,
    });
  } finally {
    for (const socket of sockets) socket.close();
    await deletePartida(servidor.baseUrl, aceite.partidaId);
    await servidor.fechar();
  }
});

test('Retenção do término falha sem impedir o callback ao lobby', async () => {
  let callbackExecutado = false;
  const redisComFalhaNaRetencao = new Proxy(redis, {
    get(target, propriedade, receptor) {
      if (propriedade === 'eval') {
        return async () => {
          throw new Error('Redis indisponível ao aplicar retenção');
        };
      }
      return Reflect.get(target, propriedade, receptor);
    },
  }) as Redis;
  const servidor = await subirServidor(600, 30, async () => {
    callbackExecutado = true;
  }, redisComFalhaNaRetencao);
  const aceite = await criarPartidaViaPost(servidor.baseUrl);
  const sockets = await Promise.all([
    conectarPartida(servidor, aceite.partidaId, 1),
    conectarPartida(servidor, aceite.partidaId, 2),
    conectarPartida(servidor, aceite.partidaId, 3),
    conectarPartida(servidor, aceite.partidaId, 4),
  ]);

  try {
    await semearEstadoProntoParaVitoria(aceite.partidaId);
    const terminado = esperarEvento(sockets[0], 'PARTIDA_TERMINADA');
    enviar(sockets[0], { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
    await terminado;

    for (let tentativa = 0; tentativa < 20 && !callbackExecutado; tentativa += 1) {
      await sleep(5);
    }
    assert.equal(callbackExecutado, true);
  } finally {
    for (const socket of sockets) socket.close();
  }

  await deletePartida(servidor.baseUrl, aceite.partidaId);
  await servidor.fechar();
});

test('Término real: recarregamento entrega snapshot terminada e recusa subsequente', async () => {
  const servidor = await subirServidor(600, 30, async () => undefined);
  const aceite = await criarPartidaViaPost(servidor.baseUrl);

  const sockets = await Promise.all([
    conectarPartida(servidor, aceite.partidaId, 1),
    conectarPartida(servidor, aceite.partidaId, 2),
    conectarPartida(servidor, aceite.partidaId, 3),
    conectarPartida(servidor, aceite.partidaId, 4),
  ]);

  try {
    await semearEstadoProntoParaVitoria(aceite.partidaId);
    const terminados = sockets.map((socket) => esperarEvento(socket, 'PARTIDA_TERMINADA'));
    enviar(sockets[0], { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
    await Promise.all(terminados);

    sockets[0].close();
    await sleep(200);
    const { ws: wsRecarregado, snapshot } = await reconectarPartida(servidor, aceite.partidaId, 1);
    try {
      const projecao = snapshot.snapshot as { estado: unknown; resultado: unknown };
      assert.equal(projecao.estado, 'terminada');
      assert.equal(projecao.resultado, 'vitoria');
      enviar(wsRecarregado, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 0, coluna: 0 } });
      const erro = await esperarEvento(wsRecarregado, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PARTIDA_TERMINADA');
    } finally {
      wsRecarregado.close();
    }
  } finally {
    for (const socket of sockets) {
      try { socket.close(); } catch {}
    }
  }

  await deletePartida(servidor.baseUrl, aceite.partidaId);
  await servidor.fechar();
});

test('Retenção do término não aplica TTL parcial quando uma chave está ausente', async () => {
  const partidaId = `partida-retencao-${crypto.randomUUID()}`;
  const { chaveDaPartida: chaveDaPartidaHelper } = await import('../src/partidas/chaves.ts');
  const chavePartida = chaveDaPartidaHelper(partidaId);
  await redis.set(chavePartida, 'metadados');
  try {
    await assert.rejects(
      aplicarRetencaoDeTermino(redis, partidaId, 30),
      /chave ausente/,
    );
    assert.equal(await redis.ttl(chavePartida), -1);
    assert.equal(await redis.exists(chaveDoEstadoDaPartida(partidaId)), 0);
  } finally {
    await redis.del(chavePartida, chaveDoEstadoDaPartida(partidaId));
  }
});
