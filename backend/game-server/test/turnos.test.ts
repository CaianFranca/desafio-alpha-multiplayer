// Teste de integração do ciclo de Turnos no game-server (issue #117 / ST-11).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita o avanço da
// vez pelo canal de Partida: o Encerramento do Primeiro Turno emite
// TURNO_ENCERRADO + TURNO_INICIADO (próximo Jogador, mesma rodada) no mesmo
// broadcast e persiste o estado com o próximo ator; um comando de Jogador fora
// da vez é rejeitado com ERRO_DO_TABULEIRO FORA_DA_VEZ, sem alterar o estado.
//
// Cuidado com o TURNO_INICIADO da admissão (issue #46): `anunciarTurnoAtual`
// envia o turno corrente (jogador-1, rodada 1) ao socket recém-admitido, no
// MESMO tipo do evento de avanço. `esperarTurnoIniciado` filtra por
// jogadorId/rodada e descarta o frame da admissão antes de entregar o esperado.
//
// As conexões passam pelo fluxo de admissão (issue #46): JWT de sessão +
// sessão no Redis + roster da partida; o primeiro evento recebido é sempre
// ADMISSAO_ACEITA (o `jogadorId` vem do token, nunca autodeclarado).
//
// Detalhe de timing que define o formato de `conectarPartida`: o servidor
// envia ADMISSAO_ACEITA logo no `handleUpgrade`, então o frame pode chegar
// no mesmo pacote do handshake — o listener de mensagens precisa estar
// anexado ANTES de aguardar o `open`, senão o evento se perde. O mesmo vale
// para o par TURNO_ENCERRADO + TURNO_INICIADO: os dois listeners são anexados
// antes do comando que dispara o broadcast.

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
import { obterEstadoDaPartida } from '../src/partidas/estado.ts';

const SERVER_ID = 'game-server-teste-turnos';
const JWT_SECRET = 'test_secret_para_turnos';

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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de turnos' }),
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

/**
 * Aguarda o TURNO_INICIADO de um Jogador/rodada específicos, descartando os
 * demais frames do tipo — em especial o TURNO_INICIADO que a admissão anuncia
 * ao socket recém-conectado (turno corrente da partida, issue #46).
 */
async function esperarTurnoIniciado(
  ws: WebSocket,
  jogadorId: string,
  rodada: number,
): Promise<Record<string, unknown>> {
  for (;;) {
    const frame = await esperarEvento(ws, 'TURNO_INICIADO');
    if (frame.jogadorId === jogadorId && frame.rodada === rodada) {
      return frame;
    }
  }
}

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

/**
 * Setup do Primeiro Turno de jogador-1: posiciona a Peça Inicial em (1,2)
 * (célula interior, para as bordas norte/leste caírem na grade) e encaixa o
 * Peão branco sobre ela — disparando o Recebimento de 2 pendências. Devolve
 * as pendências geradas; o handler da Partida mantém o Peão selecionado
 * após o primeiro posicionamento (ST-11), então a sequência fica pronta.
 */
async function posicionarPeaoNaInicial(
  ws: WebSocket,
): Promise<Array<Record<string, unknown>>> {
  enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
  const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
  assert.equal(selecionada.pecaId, 'inicial-1');

  enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 1, coluna: 2 } });
  const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
  assert.equal(posicionada.pecaId, 'inicial-1');
  assert.deepEqual(posicionada.celula, { linha: 1, coluna: 2 });

  enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
  const peaoSelecionado = await esperarEvento(ws, 'PEAO_SELECIONADO');
  assert.equal(peaoSelecionado.peaoId, 'peao-branco');

  // O primeiro posicionamento emite PEAO_POSICIONADO e RECEBIMENTO_GERADO no
  // mesmo broadcast; os dois listeners precisam estar anexados ANTES do
  // comando, senão o segundo frame se perde no timing (ver cabeçalho).
  const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
  const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
  enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 1, coluna: 2 } });
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
  return recebidas;
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

test('fluxo feliz: encerrar o Primeiro Turno avança a vez (TURNO_ENCERRADO + TURNO_INICIADO)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      // Primeiro Turno de jogador-1: Peça Inicial + Peão (Recebimento) e o
      // encaixe das 2 Recebidas na célula-alvo.
      const recebidas = await posicionarPeaoNaInicial(ws);
      for (const recebida of recebidas) {
        const recebidaId = recebida.recebidaId as string;
        const celulaAlvo = recebida.celulaAlvo as { linha: number; coluna: number };

        enviar(ws, { type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA', jogadorId: 'jogador-1', recebidaId, tipoDaPeca: 'reta' });
        const escolhida = await esperarEvento(ws, 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO');
        assert.equal(escolhida.recebidaId, recebidaId);
        const pecaDoEncaixe = escolhida.pecaId as string;

        enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: pecaDoEncaixe, celula: celulaAlvo });
        const encaixada = await esperarEvento(ws, 'PECA_POSICIONADA');
        assert.equal(encaixada.pecaId, pecaDoEncaixe);
        assert.deepEqual(encaixada.celula, celulaAlvo);
      }

      // TURNO_ENCERRADO e TURNO_INICIADO chegam no mesmo broadcast; os dois
      // listeners são anexados ANTES do comando para não perder o segundo
      // frame (ver cabeçalho).
      const encerradoEspera = esperarEvento(ws, 'TURNO_ENCERRADO');
      const iniciadoEspera = esperarTurnoIniciado(ws, 'jogador-2', 1);
      enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
      const encerrado = await encerradoEspera;
      assert.equal(encerrado.jogadorId, 'jogador-1');
      const iniciado = await iniciadoEspera;
      assert.equal(iniciado.jogadorId, 'jogador-2');
      assert.equal(iniciado.rodada, 1);

      // Estado persiste com o próximo ator: vez de jogador-2 na mesma rodada,
      // Primeiro Turno de jogador-1 concluído e Tabuleiro sem seleção.
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado da partida deve existir no Redis');
      assert.equal(estado!.jogadorAtivoId, 'jogador-2');
      assert.equal(estado!.rodada, 1);
      const jogador1 = estado!.jogadores.find((j) => j.jogadorId === 'jogador-1');
      assert.equal(jogador1?.primeiroTurnoPendente, false);
      const jogador2 = estado!.jogadores.find((j) => j.jogadorId === 'jogador-2');
      assert.equal(jogador2?.primeiroTurnoPendente, true);
      assert.equal(estado!.posicaoConfirmada, false);
      // jogador-2 ainda não posicionou o Peão: sem Peça de início de turno.
      assert.equal(estado!.pecaDoInicioDoTurnoId, null);
      assert.equal(estado!.tabuleiro.pecaSelecionadaId, null);
      assert.equal(estado!.tabuleiro.peaoSelecionadoId, null);
      assert.equal(estado!.tabuleiro.recebidas.length, 0);
    } finally {
      ws.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: comando de Jogador fora da vez responde ERRO_DO_TABULEIRO FORA_DA_VEZ', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws1 = await conectarPartida(servidor, aceite.partidaId);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      // A vez é de jogador-1 (Primeiro Turno); jogador-2 tenta selecionar a
      // própria inicial-2. O dispatch da Partida valida o ator ANTES de
      // qualquer campo do comando — responde FORA_DA_VEZ ao originador.
      enviar(ws2, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'FORA_DA_VEZ');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);

      // Estado inalterado: a vez segue com jogador-1 e nada foi selecionado.
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado da partida deve existir no Redis');
      assert.equal(estado!.jogadorAtivoId, 'jogador-1');
      assert.equal(estado!.rodada, 1);
      assert.equal(estado!.tabuleiro.pecaSelecionadaId, null);
      assert.equal(estado!.tabuleiro.posicionadas.length, 0);
    } finally {
      ws1.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});