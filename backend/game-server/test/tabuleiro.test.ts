// Teste de integração do Tabuleiro no game-server (issue #117).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita o fluxo
// feliz (selecionar → posicionar → estado persiste) e as rejeições do
// domínio (códigos fechados do contrato wire), agora pelo canal de Partida:
// os comandos carregam `jogadorId` (ator do dispatch, ST-11) e o estado
// completo (tabuleiro + turnos) é lido via `obterEstadoDaPartida`.
//
// As conexões passam pelo fluxo de admissão (issue #46): JWT de sessão +
// sessão no Redis + roster da partida; o primeiro evento recebido é sempre
// ADMISSAO_ACEITA (o `jogadorId` vem do token, nunca autodeclarado). A
// admissão anuncia também o turno corrente (TURNO_INICIADO) — frame que
// `esperarEvento` descarta por tipo, sem interferir nas asserções.
//
// Detalhe de timing que define o formato de `conectarPartida`: o servidor
// envia ADMISSAO_ACEITA logo no `handleUpgrade`, então o frame pode chegar
// no mesmo pacote do handshake — o listener de mensagens precisa estar
// anexado ANTES de aguardar o `open`, senão o evento se perde.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import {
  obterEstadoDaPartida,
  removerEstadoDaPartida,
  salvarEstadoDaPartida,
} from '../src/partidas/estado.ts';
import { aplicarComandoDePartida, estadoInicialDaPartida, type EstadoDaPartida } from '@flicker/engine';

const SERVER_ID = 'game-server-teste-tabuleiro';
const JWT_SECRET = 'test_secret_para_tabuleiro';

const redis = criarClienteRedis();

// Cores canônicas dos 4 Peões, pela ordem de entrada (mesma do domínio).
const PEAO_PELA_ORDEM = ['branco', 'vermelho', 'azul', 'amarelo'] as const;

interface ServidorEfemero {
  readonly baseUrl: string;
  readonly port: number;
  readonly wsUrl: (partidaId: string, token: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(ttlSegundos: number): Promise<ServidorEfemero> {
  const contexto = { redis, serverId: SERVER_ID, jwtSecret: JWT_SECRET, partidaPreparadaTtlSegundos: ttlSegundos };
  const app = createApp(contexto);
  const server = http.createServer(app);

  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({ redis, broadcaster });
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
    port,
    wsUrl: (partidaId: string, token: string) =>
      `ws://127.0.0.1:${port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`,
    // Fecha os clientes WS primeiro (senão `server.close()` espera conexões
    // ativas para sempre) e depois o HTTP, com belt-and-braces para
    // keep-alive remanescente do fetch.
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

/** Gera um token de sessão válido (JWT + sessão no Redis) para um jogador do roster. */
async function tokenParaJogador(n: number): Promise<string> {
  const jogadorId = `jogador-${n}`;
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return criarJwt(jogadorId, `Jogador ${n}`, sessaoId);
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
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function deletePartida(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de tabuleiro' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

/**
 * Conecta um jogador do roster à partida passando pela admissão (issue #46):
 * token de sessão válido e espera explícita do ADMISSAO_ACEITA — sem sleeps.
 * O listener do ADMISSAO_ACEITA é anexado antes do `open` (ver cabeçalho).
 */
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

/**
 * Upgrade HTTP cru para exercitar rejeições de admissão (resposta antes do
 * upgrade): resolve com status + corpo quando o servidor responde HTTP.
 */
function fazerUpgradeHttp(port: number, token: string, partidaId: string): Promise<{ status: number; texto: string }> {
  const path = `/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`;
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

/** Aguarda uma mensagem WS com o `type` esperado (timeout para não travar). */
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

/**
 * Primeiro Turno completo do jogador `<n>` via WS: Peça Inicial própria,
 * Peão sobre ela (Recebimento automático), escolha do tipo + encaixe das
 * Recebidas na célula-alvo e Encerramento do Turno. O jogador precisa estar
 * ativo (a ordem dos testes garante a vez).
 */
async function concluirPrimeiroTurnoNoWs(
  ws: WebSocket,
  jogador: number,
  celula: { linha: number; coluna: number },
): Promise<void> {
  const jogadorId = `jogador-${jogador}`;
  const pecaId = `inicial-${jogador}`;
  const peaoId = `peao-${PEAO_PELA_ORDEM[jogador - 1]}`;

  enviar(ws, { type: 'SELECIONAR_PECA', jogadorId, pecaId });
  const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
  assert.equal(selecionada.pecaId, pecaId);

  enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId, celula });
  const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
  assert.equal(posicionada.pecaId, pecaId);
  assert.deepEqual(posicionada.celula, celula);

  enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId, peaoId });
  const peaoSelecionado = await esperarEvento(ws, 'PEAO_SELECIONADO');
  assert.equal(peaoSelecionado.peaoId, peaoId);

  // O encaixe emite PEAO_POSICIONADO e RECEBIMENTO_GERADO no mesmo broadcast;
  // os dois listeners precisam estar anexados ANTES do comando (ver cabeçalho).
  const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
  const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
  enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId, peaoId, celula });
  const peaoPosicionado = await peaoPosicionadoEspera;
  assert.equal(peaoPosicionado.pecaId, pecaId);
  const recebimento = await recebimentoEspera;
  const recebidas = (recebimento.recebidas ?? []) as Array<Record<string, unknown>>;

  for (const recebida of recebidas) {
    const recebidaId = recebida.recebidaId as string;
    const celulaAlvo = recebida.celulaAlvo as { linha: number; coluna: number };

    enviar(ws, { type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA', jogadorId, recebidaId, tipoDaPeca: 'reta' });
    const escolhida = await esperarEvento(ws, 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO');
    assert.equal(escolhida.recebidaId, recebidaId);
    const pecaDoEncaixe = escolhida.pecaId as string;

    enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId: pecaDoEncaixe, celula: celulaAlvo });
    const encaixada = await esperarEvento(ws, 'PECA_POSICIONADA');
    assert.equal(encaixada.pecaId, pecaDoEncaixe);
    assert.deepEqual(encaixada.celula, celulaAlvo);
  }

  enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId });
  const encerrado = await esperarEvento(ws, 'TURNO_ENCERRADO');
  assert.equal(encerrado.jogadorId, jogadorId);
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

test('fluxo feliz: selecionar e posicionar peça persiste no Redis', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
      const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
      assert.equal(selecionada.pecaId, 'inicial-1');

      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
      assert.equal(posicionada.pecaId, 'inicial-1');
      assert.deepEqual(posicionada.celula, { linha: 0, coluna: 0 });

      // O estado no Redis reflete a posição: as iniciais não contêm mais 'inicial-1'.
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado da partida deve existir no Redis');
      const aindaNasIniciais = estado!.tabuleiro.iniciais.some((p) => p.pecaId === 'inicial-1');
      assert.equal(aindaNasIniciais, false);
      const posicionadas = estado!.tabuleiro.posicionadas.filter((p) => p.pecaId === 'inicial-1');
      assert.equal(posicionadas.length, 1);
      assert.deepEqual(posicionadas[0]!.celula, { linha: 0, coluna: 0 });
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: posicionar em célula ocupada responde ERRO_DO_TABULEIRO CELULA_JA_OCUPADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws1 = await conectarPartida(servidor, aceite.partidaId);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      // Jogador-1 conclui o próprio Primeiro Turno em (3,3): as células norte
      // (2,3) e leste (3,4) são ocupadas pelas Recebidas encaixadas.
      await concluirPrimeiroTurnoNoWs(ws1, 1, { linha: 3, coluna: 3 });

      // Jogador-2 (agora ativo) tenta posicionar a própria inicial-2 sobre a
      // célula já ocupada pela inicial-1.
      enviar(ws2, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      await esperarEvento(ws2, 'PECA_SELECIONADA');
      enviar(ws2, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2', celula: { linha: 3, coluna: 3 } });

      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'CELULA_JA_OCUPADA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws1.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: girar peça após FINALIZAR responde ERRO_DO_TABULEIRO MANIPULACAO_ENCERRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
      await esperarEvento(ws, 'PECA_SELECIONADA');
      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      // Encerra a janela de Manipulação.
      enviar(ws, { type: 'FINALIZAR_MANIPULACAO', jogadorId: 'jogador-1' });
      await esperarEvento(ws, 'MANIPULACAO_FINALIZADA');

      // Tenta girar a peça já finalizada.
      enviar(ws, { type: 'GIRAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', sentido: 'horario' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'MANIPULACAO_ENCERRADA');
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: jogador FORA do roster tem o upgrade recusado (403 JOGADOR_FORA_DO_ROSTER)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    // Token válido para um jogadorId que não pertence ao roster da partida.
    const sessaoId = crypto.randomUUID();
    await criarSessaoNoRedis(sessaoId, 'jogador-intruso');
    const token = criarJwt('jogador-intruso', 'Intruso', sessaoId);

    const resultado = await fazerUpgradeHttp(servidor.port, token, aceite.partidaId);

    assert.equal(resultado.status, 403);
    const msg = JSON.parse(resultado.texto) as { type: string; codigo: string };
    assert.equal(msg.type, 'ADMISSAO_REJEITADA');
    assert.equal(msg.codigo, 'JOGADOR_FORA_DO_ROSTER');
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: posicionar sem selecionar responde ERRO_DO_TABULEIRO PECA_NAO_SELECIONADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Tenta posicionar sem ter selecionado a peça antes.
      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PECA_NAO_SELECIONADA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: escolher tipo com caixa esgotada responde ERRO_DO_TABULEIRO CAIXA_ESGOTADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    // Estado sintético (ciclo de vida direto no domínio): peão do jogador-1
    // encaixado sobre a inicial-1, com o Recebimento pendente e a Caixa
    // esvaziada, para exercitar o caminho CAIXA_ESGOTADA do domínio via wire.
    const inicial = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(inicial.sucesso, true, 'roster válido deveria iniciar a Partida');
    if (!inicial.sucesso) {
      throw new Error('inacessível');
    }
    let estado = inicial.estado;
    for (const comando of [
      { tipo: 'selecionar_peca', pecaId: 'inicial-1' },
      { tipo: 'posicionar_peca', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
      { tipo: 'posicionar_peao', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } },
    ] as const) {
      const resultado = aplicarComandoDePartida(estado, comando, 'jogador-1');
      assert.equal(resultado.sucesso, true, `${comando.tipo} deveria ser aceito`);
      if (!resultado.sucesso) {
        throw new Error('inacessível');
      }
      estado = resultado.estado;
    }
    assert.ok(estado.tabuleiro.recebidas.length > 0, 'Recebimento deveria ter pendências');
    const estadoVazio: EstadoDaPartida = {
      ...estado,
      tabuleiro: { ...estado.tabuleiro, caixa: [] },
    };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estadoVazio);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      enviar(ws, {
        type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA',
        jogadorId: 'jogador-1',
        recebidaId: 'recebida-inicial-1-norte',
        tipoDaPeca: 'reta',
      });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'CAIXA_ESGOTADA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: estado da partida ausente responde ERRO_DO_TABULEIRO ESTADO_INDISPONIVEL', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    // Remove o estado da partida mas mantém a partida (ciclo de vida
    // incoerente) — o cliente não deve receber DADOS_INVALIDOS.
    await removerEstadoDaPartida(redis, aceite.partidaId);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'ESTADO_INDISPONIVEL');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});