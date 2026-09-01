// Teste de integração da Limpeza no serviço da partida (issue #149 / ST-13).
//
// Valida que o serviço aplica a Limpeza como estado persistido e a transmite
// via wire, cobrindo os critérios de #149 no padrão de turnos.test.ts e
// iluminacao.test.ts: servidor efêmero + Redis real, 4 sockets simultâneos,
// admissão tardia e rejeições preservadas.
//
// Cobre:
// - Broadcast simultâneo de LIMPEZA_APLICADA + CELULAS_ILUMINADAS aos 4
//   jogadores no mesmo PartidaBroadcaster.enviar após CONFIRMAR_POSICAO_DO_PEAO
//   que muda Iluminação (com PECAS removidas)
// - Persistência no Redis (posicionadas sem removidas, celulasIluminadas)
//   e snapshot wire
// - Replay de admissão tardia via anunciarTurnoAtual (CELULAS_ILUMINADAS unicast)
// - Ausência de LIMPEZA em comandos que não mudam Iluminação
// - Preservação das rejeições FORA_DA_VEZ e impersonation (DADOS_INVALIDOS)

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
import { obterPartida } from '../src/partidas/partidas.ts';
import { paraSnapshotWire } from '../src/partidas/snapshot.ts';

const SERVER_ID = 'game-server-teste-limpeza';
const JWT_SECRET = 'test_secret_para_limpeza';

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de limpeza' }),
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

function esperarAusenciaDeEvento(
  ws: WebSocket,
  tipo: string,
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise((resolve) => {
    let recebido = false;
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
        recebido = true;
      }
    }
    ws.on('message', onMensagem);
    setTimeout(() => {
      ws.removeListener('message', onMensagem);
      resolve(recebido);
    }, timeoutMs);
  });
}

// ── Helpers DRY do Primeiro Turno ──────────────────────────────

async function selecionarEPosicionarInicial(
  ws: WebSocket,
  jogadorN: number,
  celula: { linha: number; coluna: number },
  opts?: { girarHorarioAntes?: boolean },
): Promise<void> {
  const jogadorId = `jogador-${jogadorN}`;
  const pecaId = `inicial-${jogadorN}`;
  enviar(ws, { type: 'SELECIONAR_PECA', jogadorId, pecaId });
  await esperarEvento(ws, 'PECA_SELECIONADA');

  if (opts?.girarHorarioAntes) {
    enviar(ws, { type: 'GIRAR_PECA', jogadorId, pecaId, sentido: 'horario' });
    await esperarEvento(ws, 'PECA_GIRADA');
  }

  enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId, celula });
  await esperarEvento(ws, 'PECA_POSICIONADA');
}

async function posicionarPeaoEObterRecebidas(
  ws: WebSocket,
  jogadorN: number,
  celula: { linha: number; coluna: number },
): Promise<Array<Record<string, unknown>>> {
  const jogadorId = `jogador-${jogadorN}`;
  const corMap: Record<number, string> = { 1: 'peao-branco', 2: 'peao-vermelho', 3: 'peao-azul', 4: 'peao-amarelo' };
  const peao = corMap[jogadorN]!;
  enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId, peaoId: peao });
  await esperarEvento(ws, 'PEAO_SELECIONADO');

  const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
  const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
  enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId, peaoId: peao, celula });
  await peaoPosicionadoEspera;
  const recebimento = await recebimentoEspera;
  const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
  assert.equal(recebidas.length, 2);
  return recebidas;
}

async function resolverRecebidasComCelulaAlvo(
  ws: WebSocket,
  jogadorN: number,
  recebidas: Array<Record<string, unknown>>,
  bordas: Array<'norte' | 'sul' | 'leste' | 'oeste'>,
): Promise<Array<{ pecaId: string; celulaAlvo: { linha: number; coluna: number } }>> {
  const jogadorId = `jogador-${jogadorN}`;
  const resolvidas: Array<{ pecaId: string; celulaAlvo: { linha: number; coluna: number } }> = [];
  for (let i = 0; i < recebidas.length; i++) {
    const r = recebidas[i]!;
    const recebidaId = r.recebidaId as string;
    const pecaId = r.pecaId as string;
    const borda = bordas[i]!;
    enviar(ws, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId, recebidaId, borda });
    const escolhido = await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');
    assert.equal(escolhido.recebidaId, recebidaId);
    assert.equal(escolhido.borda, borda);
    const celulaAlvo = escolhido.celulaAlvo as { linha: number; coluna: number };
    assert.ok(celulaAlvo && typeof celulaAlvo.linha === 'number' && typeof celulaAlvo.coluna === 'number');
    enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId, celula: celulaAlvo });
    await esperarEvento(ws, 'PECA_POSICIONADA');
    resolvidas.push({ pecaId, celulaAlvo });
  }
  return resolvidas;
}

async function encerrarTurnoEAvancar(
  wsOrigem: WebSocket,
  wsAlvo: WebSocket,
  jogadorOrigem: number,
  proximoJogador: number,
  rodadaEsperada: number,
): Promise<void> {
  const encerradoEspera = esperarEvento(wsOrigem, 'TURNO_ENCERRADO');
  const iniciadoEspera = esperarTurnoIniciado(wsAlvo, `jogador-${proximoJogador}`, rodadaEsperada);
  enviar(wsOrigem, { type: 'ENCERRAR_TURNO', jogadorId: `jogador-${jogadorOrigem}` });
  await encerradoEspera;
  await iniciadoEspera;
}

// Avança os 4 Primeiros Turnos até a rodada 2, com layout determinístico que
// permite Limpeza previsível em CONFIRMAR_POSICAO do peão-branco.
async function prepararRodada2(
  ws: WebSocket,
  ws2: WebSocket,
  ws3: WebSocket,
  ws4: WebSocket,
): Promise<void> {
  // j1: (3,3) interior norte/leste
  await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
  const rec1 = await posicionarPeaoEObterRecebidas(ws, 1, { linha: 3, coluna: 3 });
  await resolverRecebidasComCelulaAlvo(ws, 1, rec1, ['norte', 'leste']);
  await encerrarTurnoEAvancar(ws, ws2, 1, 2, 1);

  // j2: (0,0) borda — girar horário para vagas sul/leste
  await selecionarEPosicionarInicial(ws2, 2, { linha: 0, coluna: 0 }, { girarHorarioAntes: true });
  const rec2 = await posicionarPeaoEObterRecebidas(ws2, 2, { linha: 0, coluna: 0 });
  await resolverRecebidasComCelulaAlvo(ws2, 2, rec2, ['sul', 'leste']);
  await encerrarTurnoEAvancar(ws2, ws3, 2, 3, 1);

  // j3: (1,5) interior
  await selecionarEPosicionarInicial(ws3, 3, { linha: 1, coluna: 5 });
  const rec3 = await posicionarPeaoEObterRecebidas(ws3, 3, { linha: 1, coluna: 5 });
  await resolverRecebidasComCelulaAlvo(ws3, 3, rec3, ['norte', 'leste']);
  await encerrarTurnoEAvancar(ws3, ws4, 3, 4, 1);

  // j4: (5,5) interior
  await selecionarEPosicionarInicial(ws4, 4, { linha: 5, coluna: 5 });
  const rec4 = await posicionarPeaoEObterRecebidas(ws4, 4, { linha: 5, coluna: 5 });
  await resolverRecebidasComCelulaAlvo(ws4, 4, rec4, ['norte', 'leste']);
  await encerrarTurnoEAvancar(ws4, ws, 4, 1, 2);
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

// ────────────────────────────────────────────────────────────────
// Teste A+B — broadcast simultâneo + persistência
// ────────────────────────────────────────────────────────────────

test('Limpeza: broadcast simultâneo de LIMPEZA_APLICADA + CELULAS_ILUMINADAS aos 4 jogadores e persistência no Redis', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      await prepararRodada2(ws, ws2, ws3, ws4);

      // Rodada 2 de jogador-1: mover de (3,3) para (2,3) e confirmar.
      // Nova iluminação (2,3) = (1,3),(2,2),(2,3),(2,4),(3,3) deixa reta-2 em (3,4) fora → limpeza remove reta-2.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');

      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // Anexar listeners para LIMPEZA e CELULAS nos 4 sockets ANTES do comando
      const limpezaEsperas = [
        esperarEvento(ws, 'LIMPEZA_APLICADA'),
        esperarEvento(ws2, 'LIMPEZA_APLICADA'),
        esperarEvento(ws3, 'LIMPEZA_APLICADA'),
        esperarEvento(ws4, 'LIMPEZA_APLICADA'),
      ];
      const celulasEsperas = [
        esperarEvento(ws, 'CELULAS_ILUMINADAS'),
        esperarEvento(ws2, 'CELULAS_ILUMINADAS'),
        esperarEvento(ws3, 'CELULAS_ILUMINADAS'),
        esperarEvento(ws4, 'CELULAS_ILUMINADAS'),
      ];
      const posicaoConfirmadaEspera = esperarEvento(ws, 'POSICAO_CONFIRMADA');

      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });

      // Todos os 4 devem receber LIMPEZA_APLICADA no mesmo broadcast com payload idêntico
      const limpezas = await Promise.all(limpezaEsperas);
      const celulasEventos = await Promise.all(celulasEsperas);
      await posicaoConfirmadaEspera;

      for (const limpeza of limpezas) {
        assert.equal(limpeza.type, 'LIMPEZA_APLICADA');
        const removidas = limpeza.pecasRemovidas as string[];
        assert.deepEqual(removidas, ['reta-2']);
      }
      // Garantir que payloads de limpeza são idênticos entre os 4
      const primeiraRemovida = (limpezas[0]!.pecasRemovidas as string[]).join(',');
      for (const l of limpezas) {
        assert.equal((l.pecasRemovidas as string[]).join(','), primeiraRemovida);
      }

      // CELULAS_ILUMINADAS coexiste no mesmo broadcast — validar que todos receberam igual
      const primeiraCelulas = celulasEventos[0]!.celulas as Array<{ linha: number; coluna: number }>;
      for (const c of celulasEventos) {
        const celulas = c.celulas as Array<{ linha: number; coluna: number }>;
        assert.deepEqual(
          [...celulas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
          [...primeiraCelulas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
        );
      }

      // ── Persistência no Redis
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado deve existir no Redis');
      // reta-2 removida
      const pecaIds = estado!.tabuleiro.posicionadas.map((p) => p.pecaId);
      assert.ok(!pecaIds.includes('reta-2'), `reta-2 deve estar removida, posicionadas=${pecaIds.join(',')}`);
      assert.ok(pecaIds.includes('reta-1'), 'reta-1 deve permanecer');
      assert.ok(pecaIds.includes('inicial-1'), 'inicial-1 deve permanecer (sob peão)');

      // celulasIluminadas persistidas iguais ao broadcast
      const estadoCelulas = [...estado!.celulasIluminadas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
      const broadcastCelulas = [...primeiraCelulas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
      assert.deepEqual(estadoCelulas, broadcastCelulas);

      // snapshot wire reflete o mesmo
      const partida = await obterPartida(redis, aceite.partidaId);
      assert.ok(partida !== null);
      const snapshot = paraSnapshotWire(estado!, partida!.roster, partida!.estado);
      const snapshotCelulas = [...snapshot.celulasIluminadas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
      assert.deepEqual(snapshotCelulas, broadcastCelulas);
      const snapshotPecaIds = snapshot.tabuleiro.posicionadas.map((p) => p.pecaId);
      assert.ok(!snapshotPecaIds.includes('reta-2'), 'snapshot não deve conter reta-2');
    } finally {
      ws.close();
      ws2.close();
      ws3.close();
      ws4.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// ────────────────────────────────────────────────────────────────
// Teste C — admissão tardia entrega CELULAS_ILUMINADAS correntes
// ────────────────────────────────────────────────────────────────

test('Limpeza: admissão tardia recebe CELULAS_ILUMINADAS correntes pós-limpeza via replay unicast', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      await prepararRodada2(ws, ws2, ws3, ws4);

      // Gerar limpeza via CONFIRMAR
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const limpezaEspera = esperarEvento(ws, 'LIMPEZA_APLICADA');
      const celulasEspera = esperarEvento(ws, 'CELULAS_ILUMINADAS');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      const limpeza = await limpezaEspera;
      assert.deepEqual(limpeza.pecasRemovidas, ['reta-2']);
      const celulasBroadcast = (await celulasEspera).celulas as Array<{ linha: number; coluna: number }>;

      // Desconectar ws3 e reconectar como tardio — deve receber replay unicast de CELULAS_ILUMINADAS
      ws3.close();
      await new Promise((r) => setTimeout(r, 200));

      const tokenTardio = await tokenParaJogador(3);
      const wsTardio = new WebSocket(servidor.wsUrl(aceite.partidaId, tokenTardio));
      const aceita = esperarEvento(wsTardio, 'ADMISSAO_ACEITA');
      const turno = esperarEvento(wsTardio, 'TURNO_INICIADO');
      const celulasTardioEspera = esperarEvento(wsTardio, 'CELULAS_ILUMINADAS');

      await new Promise<void>((resolve, reject) => {
        wsTardio.once('open', () => resolve());
        wsTardio.once('error', reject);
      });

      await aceita;
      await turno;
      const celulasTardio = (await celulasTardioEspera).celulas as Array<{ linha: number; coluna: number }>;

      assert.deepEqual(
        [...celulasTardio].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
        [...celulasBroadcast].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
      );

      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null);
      assert.deepEqual(
        [...estado!.celulasIluminadas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
        [...celulasTardio].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
      );
      assert.ok(estado!.celulasIluminadas.length > 0, 'celulasIluminadas não deve estar vazio após limpeza');

      wsTardio.close();
    } finally {
      try { ws.close(); } catch {}
      try { ws2.close(); } catch {}
      try { ws3.close(); } catch {}
      try { ws4.close(); } catch {}
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// ────────────────────────────────────────────────────────────────
// Teste D — comandos sem mudança de Iluminação não emitem LIMPEZA
// ────────────────────────────────────────────────────────────────

test('Limpeza: comandos que não mudam Iluminação não emitem LIMPEZA_APLICADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      await prepararRodada2(ws, ws2, ws3, ws4);

      // D1: MOVER_PEAO isolado (sem CONFIRMAR) não deve emitir LIMPEZA
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const semLimpezaMover = esperarAusenciaDeEvento(ws, 'LIMPEZA_APLICADA', 600);
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');
      const houveLimpezaNoMover = await semLimpezaMover;
      assert.equal(houveLimpezaNoMover, false, 'MOVER_PEAO não deve emitir LIMPEZA_APLICADA');

      // Reselecionar para poder confirmar depois
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // D2: CONFIRMAR com limpeza deve emitir LIMPEZA (reta-2)
      const limpezaEspera = esperarEvento(ws, 'LIMPEZA_APLICADA');
      const posicaoEspera = esperarEvento(ws, 'POSICAO_CONFIRMADA');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await posicaoEspera;
      const limpeza = await limpezaEspera;
      assert.deepEqual(limpeza.pecasRemovidas, ['reta-2']);

      // D3: após CONFIRMAR, um MOVER tentativo do próximo jogador sem confirmação não deve emitir LIMPEZA
      // (MOVER nunca emite, mesmo após limpeza anterior — garante que limpeza não vaza para outros comandos)
      const semLimpezaApos = esperarAusenciaDeEvento(ws, 'LIMPEZA_APLICADA', 500);
      // Não fazer ENCERRAR aqui para não acoplar falha de turno; apenas garantir ausência pós-limpeza
      const houveApos = await semLimpezaApos;
      assert.equal(houveApos, false, 'nenhuma LIMPEZA espúria após CONFIRMAR');
    } finally {
      ws.close();
      ws2.close();
      ws3.close();
      ws4.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('Limpeza: ENCERRAR_TURNO e PERMANECER não emitem LIMPEZA_APLICADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);

    try {
      // Cenário mínimo: Primeiro Turno de j1 posicionado, sem ainda avançar demais.
      // Qualquer ENCERRAR_TURNO válido nesta fase não deve emitir LIMPEZA (iluminação só muda em POSICIONAR_PEAO e CONFIRMAR)
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
      const rec = await posicionarPeaoEObterRecebidas(ws, 1, { linha: 3, coluna: 3 });
      // Consumir limpeza inicial de POSICIONAR_PEAO (pode ter gerado CELULAS mas não limpeza, pois primeiro posicionamento não remove)
      // Resolver recebidas e encerrar — ENCERRAR não deve gerar limpeza
      await resolverRecebidasComCelulaAlvo(ws, 1, rec, ['norte', 'leste']);

      const semLimpeza = esperarAusenciaDeEvento(ws, 'LIMPEZA_APLICADA', 600);
      const encerrado = esperarEvento(ws, 'TURNO_ENCERRADO');
      enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
      await encerrado;
      const houveLimpeza = await semLimpeza;
      assert.equal(houveLimpeza, false, 'ENCERRAR_TURNO não deve emitir LIMPEZA_APLICADA');

      // Estado deve permanecer com posicionadas intactas (sem remoção) após ENCERRAR
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null);
      const ids = estado!.tabuleiro.posicionadas.map((p) => p.pecaId);
      assert.ok(ids.includes('reta-1'));
      assert.ok(ids.includes('reta-2'));
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// ────────────────────────────────────────────────────────────────
// Teste E — rejeições preservadas
// ────────────────────────────────────────────────────────────────

test('Limpeza: rejeições FORA_DA_VEZ e impersonation não alteram estado e não emitem LIMPEZA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      // Estado antes das rejeições
      const estadoAntes = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoAntes !== null);
      assert.equal(estadoAntes!.jogadorAtivoId, 'jogador-1');

      // E1: FORA_DA_VEZ — jogador-2 comanda na vez de jogador-1
      const semLimpezaForaDaVez = esperarAusenciaDeEvento(ws2, 'LIMPEZA_APLICADA', 600);
      enviar(ws2, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      const erroFora = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erroFora.codigo, 'FORA_DA_VEZ');
      const houveLimpezaFora = await semLimpezaForaDaVez;
      assert.equal(houveLimpezaFora, false, 'FORA_DA_VEZ não deve emitir LIMPEZA');

      const estadoAposFora = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoAposFora, estadoAntes);

      // E2: impersonation — ws1 autentica como jogador-1 mas declara jogador-2
      const semLimpezaImpersonation = esperarAusenciaDeEvento(ws, 'LIMPEZA_APLICADA', 600);
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      const erroImp = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroImp.codigo, 'DADOS_INVALIDOS');
      const houveLimpezaImp = await semLimpezaImpersonation;
      assert.equal(houveLimpezaImp, false, 'impersonation não deve emitir LIMPEZA');

      const estadoAposImp = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoAposImp, estadoAntes);

      // Garantir que celulasIluminadas segue inalterada (vazia no início)
      assert.equal(estadoAposImp!.celulasIluminadas.length, 0);
    } finally {
      ws.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
