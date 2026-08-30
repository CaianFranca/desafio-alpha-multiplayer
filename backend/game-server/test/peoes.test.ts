// Teste de integração do ciclo de Peões no game-server (issue #88).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita o fluxo
// feliz do ciclo (selecionar → primeiro posicionamento + Recebimento →
// escolher tipos + encaixar Recebidas → mover) e as rejeições do domínio com
// código fechado do contrato wire (mesmo padrão do serviço de tabuleiro #80).
//
// As conexões passam pelo fluxo de admissão (issue #46): JWT de sessão +
// sessão no Redis + roster da partida; o primeiro evento recebido é sempre
// ADMISSAO_ACEITA (o `jogadorId` vem do token, nunca autodeclarado).
//
// Detalhe de timing que define o formato de `conectarPartida`: o servidor
// envia ADMISSAO_ACEITA logo no `handleUpgrade`, então o frame pode chegar
// no mesmo pacote do handshake — o listener de mensagens precisa estar
// anexado ANTES de aguardar o `open`, senão o evento se perde.
//
// Observação de domínio: o handler compõe o Recebimento no primeiro
// posicionamento do Peão (sobre a Peça Inicial) e mantém o Peão selecionado
// para a sequência — seam intermediário, substituído pelo canal de Partida
// do #117 (turnos).

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
import { TabuleiroBroadcaster } from '../src/tabuleiro/broadcast.ts';
import { TabuleiroHandlers } from '../src/tabuleiro/handlers.ts';
import { obterEstadoDoTabuleiro } from '../src/partidas/tabuleiro.ts';

const SERVER_ID = 'game-server-teste-peoes';
const JWT_SECRET = 'test_secret_para_peoes';

const redis = criarClienteRedis();

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

  const broadcaster = new TabuleiroBroadcaster();
  const handlers = new TabuleiroHandlers({ redis, broadcaster });
  const wss = criarWebSocketServer(server, contexto, {
    tabuleiro: { redis, broadcaster, handlers },
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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de peões' }),
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
 * Setup compartilhado do fluxo feliz: posiciona a Peça Inicial em (1,2) (célula
 * interior, para as bordas norte/leste caírem na grade), posiciona o Peão
 * branco sobre ela — disparando o Recebimento de 2 pendências — escolhe o tipo
 * 'reta' e encaixa cada Recebida na célula-alvo. Ao final o Peão branco segue
 * selecionado, sem pendências.
 */
async function prepararSequenciaDoPeao(
  ws: WebSocket,
): Promise<{ recebidas: Array<Record<string, unknown>>; pecas: string[] }> {
  enviar(ws, { type: 'SELECIONAR_PECA', pecaId: 'inicial-1' });
  const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
  assert.equal(selecionada.pecaId, 'inicial-1');

  enviar(ws, { type: 'POSICIONAR_PECA', pecaId: 'inicial-1', celula: { linha: 1, coluna: 2 } });
  const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
  assert.equal(posicionada.pecaId, 'inicial-1');
  assert.deepEqual(posicionada.celula, { linha: 1, coluna: 2 });

  enviar(ws, { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' });
  const peaoSelecionado = await esperarEvento(ws, 'PEAO_SELECIONADO');
  assert.equal(peaoSelecionado.peaoId, 'peao-branco');

  // O primeiro posicionamento emite PEAO_POSICIONADO e RECEBIMENTO_GERADO no
  // mesmo broadcast; os dois listeners precisam estar anexados ANTES do
  // comando, senão o segundo frame se perde no timing (ver cabeçalho).
  const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
  const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
  enviar(ws, { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: { linha: 1, coluna: 2 } });
  const peaoPosicionado = await peaoPosicionadoEspera;
  assert.equal(peaoPosicionado.pecaId, 'inicial-1');
  const recebimento = await recebimentoEspera;
  const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
  assert.equal(recebidas.length, 2);
  // Ordem canônica das bordas da Peça Inicial: norte antes de leste.
  assert.equal(recebidas[0]!.bordaGeradora, 'norte');
  assert.deepEqual(recebidas[0]!.celulaAlvo, { linha: 0, coluna: 2 });
  assert.equal(recebidas[1]!.bordaGeradora, 'leste');
  assert.deepEqual(recebidas[1]!.celulaAlvo, { linha: 1, coluna: 3 });

  const pecas: string[] = [];
  for (const recebida of recebidas) {
    const recebidaId = recebida.recebidaId as string;
    enviar(ws, { type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA', recebidaId, tipoDaPeca: 'reta' });
    const escolhida = await esperarEvento(ws, 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO');
    assert.equal(escolhida.recebidaId, recebidaId);
    assert.equal(escolhida.tipoDaPeca, 'reta');
    const pecaId = escolhida.pecaId as string;
    pecas.push(pecaId);

    enviar(ws, { type: 'POSICIONAR_PECA', pecaId, celula: recebida.celulaAlvo });
    const encaixada = await esperarEvento(ws, 'PECA_POSICIONADA');
    assert.equal(encaixada.pecaId, pecaId);
    assert.deepEqual(encaixada.celula, recebida.celulaAlvo);
  }

  return { recebidas, pecas };
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

test('fluxo feliz: ciclo do peão persiste no Redis (posiciona, resolve recebidas, move)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      const { recebidas, pecas } = await prepararSequenciaDoPeao(ws);
      // A primeira Recebida (norte) consome 'reta-1'; a segunda (leste), 'reta-2'.
      assert.equal(pecas[0], 'reta-1');
      assert.equal(pecas[1], 'reta-2');

      // Move o Peão para a Reta norte-sul em (0,2): a reta-1 tem a borda sul
      // voltada para a norte da Peça Inicial em (1,2).
      enviar(ws, { type: 'MOVER_PEAO', peaoId: 'peao-branco', celula: { linha: 0, coluna: 2 } });
      const movido = await esperarEvento(ws, 'PEAO_MOVIDO');
      assert.equal(movido.peaoId, 'peao-branco');
      assert.equal(movido.pecaIdDe, 'inicial-1');
      assert.equal(movido.pecaIdPara, 'reta-1');
      assert.deepEqual(movido.celula, { linha: 0, coluna: 2 });

      // Estado no Redis reflete o ciclo completo.
      const estado = await obterEstadoDoTabuleiro(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado do tabuleiro deve existir no Redis');
      const peaoBranco = estado!.peoes.find((p) => p.peaoId === 'peao-branco');
      assert.equal(peaoBranco?.pecaId, 'reta-1');
      assert.equal(estado!.recebidas.length, 0);
      const reserva = estado!.reserva.map((p) => p.pecaId);
      assert.ok(!reserva.includes('reta-1'), 'reta-1 deve ter saído da reserva');
      assert.ok(!reserva.includes('reta-2'), 'reta-2 deve ter saído da reserva');

      const porPeca = new Map(estado!.posicionadas.map((p) => [p.pecaId, p.celula]));
      assert.deepEqual(porPeca.get('inicial-1'), { linha: 1, coluna: 2 });
      assert.deepEqual(porPeca.get('reta-1'), { linha: 0, coluna: 2 });
      assert.deepEqual(porPeca.get('reta-2'), { linha: 1, coluna: 3 });
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: mover para peça não conectada responde ERRO_DO_TABULEIRO MOVIMENTO_NAO_CONECTADO', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      await prepararSequenciaDoPeao(ws);

      // Reta-2 (1,3) é norte-sul: não tem borda oeste para a leste da Peça
      // Inicial — não é vizinha conectada; mover para ela rejeita.
      enviar(ws, { type: 'MOVER_PEAO', peaoId: 'peao-branco', celula: { linha: 1, coluna: 3 } });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'MOVIMENTO_NAO_CONECTADO');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: primeiro posicionamento fora da Peça Inicial responde ERRO_DO_TABULEIRO PECA_INICIAL_EXIGIDA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      await prepararSequenciaDoPeao(ws);

      // Seleciona outro Peão e tenta posicioná-lo sobre a Reta-1 (0,2) — que
      // não é a Peça Inicial.
      enviar(ws, { type: 'SELECIONAR_PEAO', peaoId: 'peao-vermelho' });
      const selecionado = await esperarEvento(ws, 'PEAO_SELECIONADO');
      assert.equal(selecionado.peaoId, 'peao-vermelho');

      enviar(ws, { type: 'POSICIONAR_PEAO', peaoId: 'peao-vermelho', celula: { linha: 0, coluna: 2 } });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PECA_INICIAL_EXIGIDA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: comando de peão malformado responde ERRO_DO_TABULEIRO DADOS_INVALIDOS', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // 'peaoId' com apenas espaços passa na guarda wire (string não vazia)
      // mas o domínio rejeita com DADOS_INVALIDOS (identificador obrigatório).
      enviar(ws, { type: 'SELECIONAR_PEAO', peaoId: '   ' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'DADOS_INVALIDOS');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
