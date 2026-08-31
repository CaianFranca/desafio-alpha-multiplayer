// Teste de integração do ciclo de Peões no game-server (issue #117).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita o fluxo
// feliz do ciclo (Primeiro Turno: posicionar Peça Inicial + Peão com
// Recebimento; Rodada 2: mover entre Peças e Permanecer) e as rejeições do
// domínio com código fechado do contrato wire, tudo pelo canal de Partida
// com o ator vindo do `jogadorId` da mensagem (ST-11).
//
// Os fluxos de turno normal (mover/permanecer) só existem a partir da Rodada
// 2: `concluirQuatroPrimeirosTurnos` completa os quatro Primeiros Turnos via
// WS (posições das Iniciais: (3,3), (0,0), (6,6), (6,0) — as Recebidas nunca
// colidem entre si e consomem exatamente as 6 Retas da Reserva).
//
// As conexões passam pelo fluxo de admissão (issue #46): JWT de sessão +
// sessão no Redis + roster da partida; o primeiro evento recebido é sempre
// ADMISSAO_ACEITA (o `jogadorId` vem do token, nunca autodeclarado).
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
import { obterEstadoDaPartida } from '../src/partidas/estado.ts';

const SERVER_ID = 'game-server-teste-peoes';
const JWT_SECRET = 'test_secret_para_peoes';

const redis = criarClienteRedis();

// Cores canônicas dos 4 Peões, pela ordem de entrada (mesma do domínio).
const PEAO_PELA_ORDEM = ['branco', 'vermelho', 'azul', 'amarelo'] as const;

// Posições das Iniciais dos 4 Primeiros Turnos: as Recebidas geradas caem em
// células sempre vazias e distintas (norte/leste da borda base da Inicial).
const CELULAS_DAS_INICIAIS = [
  { linha: 3, coluna: 3 },
  { linha: 0, coluna: 0 },
  { linha: 6, coluna: 6 },
  { linha: 6, coluna: 0 },
] as const;

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
 * Setup compartilhado do Primeiro Turno: posiciona a Peça Inicial em (1,2)
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

/**
 * Primeiro Turno completo do jogador `<n>` via WS: Peça Inicial própria,
 * Peão sobre ela (Recebimento automático), escolha do tipo + encaixe das
 * Recebidas na célula-alvo e Encerramento do Turno. O jogador precisa estar
 * ativo (a ordem dos testes garante a vez). As posições escolhidas geram
 * Recebidas em células sempre vazias e consomem apenas Retas da Reserva.
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

/**
 * Conecta os 4 jogadores e conclui os quatro Primeiros Turnos: a vez volta ao
 * primeiro Jogador na Rodada 2 (turno normal). Devolve os sockets na ordem
 * dos jogadores para os fluxos seguintes.
 */
async function concluirQuatroPrimeirosTurnos(
  servidor: ServidorEfemero,
  partidaId: string,
): Promise<WebSocket[]> {
  const sockets = [
    await conectarPartida(servidor, partidaId, 1),
    await conectarPartida(servidor, partidaId, 2),
    await conectarPartida(servidor, partidaId, 3),
    await conectarPartida(servidor, partidaId, 4),
  ];
  for (let jogador = 1; jogador <= 4; jogador++) {
    await concluirPrimeiroTurnoNoWs(sockets[jogador - 1]!, jogador, CELULAS_DAS_INICIAIS[jogador - 1]!);
  }
  return sockets;
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

test('fluxo feliz: ciclo do peão persiste no Redis (Primeiro Turno + mover na Rodada 2)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const sockets = await concluirQuatroPrimeirosTurnos(servidor, aceite.partidaId);
    const ws = sockets[0]!;

    try {
      // Rodada 2, jogador-1 ativo: move o Peão branco da inicial-1 (3,3) para
      // a reta-1 (2,3) — vizinha conectada pela borda norte da Inicial.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      const selecionado = await esperarEvento(ws, 'PEAO_SELECIONADO');
      assert.equal(selecionado.peaoId, 'peao-branco');

      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      const movido = await esperarEvento(ws, 'PEAO_MOVIDO');
      assert.equal(movido.peaoId, 'peao-branco');
      assert.equal(movido.pecaIdDe, 'inicial-1');
      assert.equal(movido.pecaIdPara, 'reta-1');
      assert.deepEqual(movido.celula, { linha: 2, coluna: 3 });

      // Estado no Redis reflete o ciclo completo, com a vez ainda de jogador-1.
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado da partida deve existir no Redis');
      assert.equal(estado!.jogadorAtivoId, 'jogador-1');
      assert.equal(estado!.rodada, 2);
      const peaoBranco = estado!.tabuleiro.peoes.find((p) => p.peaoId === 'peao-branco');
      assert.equal(peaoBranco?.pecaId, 'reta-1');
      assert.equal(estado!.tabuleiro.recebidas.length, 0);
      const reserva = estado!.tabuleiro.reserva.map((p) => p.pecaId);
      assert.ok(!reserva.includes('reta-1'), 'reta-1 deve ter saído da reserva');
      assert.ok(!reserva.includes('reta-2'), 'reta-2 deve ter saído da reserva');

      const porPeca = new Map(estado!.tabuleiro.posicionadas.map((p) => [p.pecaId, p.celula]));
      assert.deepEqual(porPeca.get('inicial-1'), { linha: 3, coluna: 3 });
      assert.deepEqual(porPeca.get('reta-1'), { linha: 2, coluna: 3 });
      assert.deepEqual(porPeca.get('reta-2'), { linha: 3, coluna: 4 });
    } finally {
      for (const socket of sockets) {
        socket.close();
      }
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

    const sockets = await concluirQuatroPrimeirosTurnos(servidor, aceite.partidaId);
    const ws = sockets[0]!;

    try {
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // A reta-2 (3,4) é norte-sul: não tem borda oeste para a leste da
      // Peça Inicial em (3,3) — não é vizinha conectada; mover rejeita.
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 4 } });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'MOVIMENTO_NAO_CONECTADO');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      for (const socket of sockets) {
        socket.close();
      }
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

    const ws1 = await conectarPartida(servidor, aceite.partidaId);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      await concluirPrimeiroTurnoNoWs(ws1, 1, { linha: 3, coluna: 3 });

      // Jogador-2, ativo no próprio Primeiro Turno, tenta encaixar o próprio
      // Peão (vermelho) sobre a reta-1 (2,3) — que não é a Peça Inicial.
      enviar(ws2, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      const selecionado = await esperarEvento(ws2, 'PEAO_SELECIONADO');
      assert.equal(selecionado.peaoId, 'peao-vermelho');

      enviar(ws2, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 2, coluna: 3 } });
      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PECA_INICIAL_EXIGIDA');
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

test('rejeição: comando de peão malformado responde ERRO_DO_TABULEIRO DADOS_INVALIDOS', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Sem o campo `peaoId` o comando falha a guarda wire
      // (`ehComandoDaPartida`), que responde DADOS_INVALIDOS (fora do
      // contrato fechado) antes de qualquer chamada ao domínio.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1' });
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

test('fluxo feliz: permanecer encerra o turno direto (PEAO_PERMANECEU)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const sockets = await concluirQuatroPrimeirosTurnos(servidor, aceite.partidaId);
    const ws = sockets[0]!;

    try {
      // Rodada 2: o Peão branco segue na Peça do início do turno (inicial-1);
      // permanecer trava a posição e encerra o turno sem Recebimento.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      enviar(ws, { type: 'PERMANECER', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      const permaneceu = await esperarEvento(ws, 'PEAO_PERMANECEU');
      assert.equal(permaneceu.peaoId, 'peao-branco');
      assert.equal(permaneceu.pecaId, 'inicial-1');

      // Permanecer encerra a sequência e passa a vez: o Peão segue na mesma
      // Peça e a seleção é limpa no estado persistido.
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado da partida deve existir no Redis');
      assert.equal(estado!.tabuleiro.peaoSelecionadoId, null);
      assert.equal(estado!.tabuleiro.peoes.find((p) => p.peaoId === 'peao-branco')?.pecaId, 'inicial-1');
      assert.equal(estado!.tabuleiro.recebidas.length, 0);
      assert.equal(estado!.jogadorAtivoId, 'jogador-2');
      assert.equal(estado!.rodada, 2);
    } finally {
      for (const socket of sockets) {
        socket.close();
      }
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: posicionar peão sobre Peça ocupada responde ERRO_DO_TABULEIRO PECA_JA_TEM_PEAO', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws1 = await conectarPartida(servidor, aceite.partidaId);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      await concluirPrimeiroTurnoNoWs(ws1, 1, { linha: 3, coluna: 3 });

      // A inicial-1 (3,3) já abriga o Peão branco; o encaixe do primeiro
      // posicionamento do vermelho sobre ela rejeita — mesmo sendo a Peça
      // Inicial (a guarda do tipo passa antes da do Peão ocupante).
      enviar(ws2, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      const selecionado = await esperarEvento(ws2, 'PEAO_SELECIONADO');
      assert.equal(selecionado.peaoId, 'peao-vermelho');

      enviar(ws2, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 3, coluna: 3 } });
      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PECA_JA_TEM_PEAO');
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

test('rejeição: encerrar com pendências do Recebimento responde ERRO_DO_TABULEIRO PENDENCIA_NAO_RESOLVIDA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Primeiro Turno: encaixa o Peão na Inicial (2 Recebidas em aberto) e
      // tenta encerrar o turno: a pendência bloqueia o avanço da vez.
      await posicionarPeaoNaInicial(ws);

      enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PENDENCIA_NAO_RESOLVIDA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});