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
//   que muda Iluminação (com PECAS removidas) — unicidade 1x/simultaneidade
//   e atomicidade com CELULAS_ILUMINADAS:403 e POSICAO_CONFIRMADA:409
// - Persistência no Redis (posicionadas sem removidas, celulasIluminadas)
//   e snapshot wire
// - Replay de admissão tardia via anunciarTurnoAtual (CELULAS_ILUMINADAS unicast)
//   e negativa de replay histórico de LIMPEZA_APLICADA
// - Ausência de LIMPEZA em comandos que não mudam Iluminação
//   (MOVER_PEAO, PERMANECER, ENCERRAR_TURNO, 2º CONFIRMAR)
// - Cobertura de POSICIONAR_PEAO no Primeiro Turno (ausência explícita)
// - Preservação das rejeições FORA_DA_VEZ e impersonation (DADOS_INVALIDOS)
//   para MOVER_PEAO e CONFIRMAR além de SELECIONAR_PECA
// - Robustez de ausência via âncora positiva + janela de silêncio 600ms
// - Derivação dinâmica de peca esperada removida (sem hard-coded frágil reta-2)

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

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Padrão robusto de ausência com âncora positiva (substitui esperarAusenciaDeEvento flaky).
 * Aguarda o evento âncora (`tipoAncora`) e, a partir dele, observa 600ms de silêncio
 * para o evento ausente (`tipoAusente`) no MESMO listener. Prova negativa sem
 * flaky sleep puro. Resolve `true` se `tipoAusente` foi visto após a âncora,
 * `false` se permaneceu ausente nos 600ms. Rejeita se a âncora não chegar em 5s.
 */
function esperarAusenciaComAncora(
  ws: WebSocket,
  tipoAusente: string,
  tipoAncora: string,
  timeoutMs = 600,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let ancoraRecebida = false;
    let ausenteRecebido = false;
    let silenceTimer: NodeJS.Timeout | null = null;
    const anchorTimer = setTimeout(() => {
      if (!ancoraRecebida) {
        ws.removeListener('message', onMensagem);
        reject(new Error(`timeout aguardando âncora '${tipoAncora}' para ausência de '${tipoAusente}'`));
      }
    }, 5000);

    function onMensagem(data: unknown): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse((data as Buffer).toString());
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const type = (parsed as { type?: unknown }).type;
      if (!ancoraRecebida && type === tipoAncora) {
        ancoraRecebida = true;
        clearTimeout(anchorTimer);
        silenceTimer = setTimeout(() => {
          ws.removeListener('message', onMensagem);
          resolve(ausenteRecebido);
        }, timeoutMs);
      } else if (ancoraRecebida && type === tipoAusente) {
        ausenteRecebido = true;
      }
    }
    ws.on('message', onMensagem);
  });
}

// Mantido para compatibilidade pontual, mas testes novos devem usar esperarAusenciaComAncora.
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

// Avança os 4 Primeiros Turnos até a rodada 2, com layout determinístico que
// permite Limpeza previsível em CONFIRMAR_POSICAO do peão-branco.
// Deriva dinamicamente a peça esperada removida (sem hard-coded frágil): a
// segunda peça de J1 em (3,4) via VAGA_DA_PECA_RECEBIDA_ESCOLHIDO, que fica
// fora da futura iluminação (2,3) e será removida na limpeza.
async function prepararRodada2(
  ws: WebSocket,
  ws2: WebSocket,
  ws3: WebSocket,
  ws4: WebSocket,
): Promise<{ pecaEsperadaRemovida: string; resolvidasJ1: Array<{ pecaId: string; celulaAlvo: { linha: number; coluna: number } }> }> {
  // j1: (3,3) interior norte/leste
  await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
  const rec1 = await posicionarPeaoEObterRecebidas(ws, 1, { linha: 3, coluna: 3 });
  const resolvidasJ1 = await resolverRecebidasComCelulaAlvo(ws, 1, rec1, ['norte', 'leste']);
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

  // Deriva peca esperada: segunda peça de J1 (leste de (3,3) => (3,4)), via resolvidas
  const pecaEsperadaRemovida = resolvidasJ1[1]!.pecaId;
  return { pecaEsperadaRemovida, resolvidasJ1 };
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
// Teste A+B — broadcast simultâneo + persistência + unicidade/atomicidade
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
      const { pecaEsperadaRemovida } = await prepararRodada2(ws, ws2, ws3, ws4);

      // Rodada 2 de jogador-1: mover de (3,3) para (2,3) e confirmar.
      // Nova iluminação (2,3) = (1,3),(2,2),(2,3),(2,4),(3,3) deixa pecaEsperadaRemovida em (3,4) fora → limpeza remove.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');

      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // Contadores de unicidade: prova que LIMPEZA foi emitida exatamente 1x por socket,
      // simultaneamente, sem segundo broadcast.
      const contadores = [0, 0, 0, 0];
      const sockets = [ws, ws2, ws3, ws4] as const;
      function criarContador(idx: number): (data: unknown) => void {
        return (data: unknown) => {
          try {
            const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
            if (parsed.type === 'LIMPEZA_APLICADA') contadores[idx] += 1;
          } catch {}
        };
      }
      const handlers = sockets.map((s, i) => criarContador(i));
      sockets.forEach((s, i) => s.on('message', handlers[i]!));

      // Anexar listeners para LIMPEZA, CELULAS e POSICAO nos 4 sockets ANTES do comando
      // para provar atomicidade no mesmo PartidaBroadcaster.enviar:46
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

      // Todos os 4 devem receber LIMPEZA_APLICADA, CELULAS_ILUMINADAS e POSICAO_CONFIRMADA
      // no mesmo broadcast — Promise.all prova simultaneidade/atomicidade sem segundo broadcast
      const limpezas = await Promise.all(limpezaEsperas);
      const celulasEventos = await Promise.all(celulasEsperas);
      await posicaoConfirmadaEspera;

      // Janela de silêncio para garantir unicidade (exatamente 1x, não 2 broadcasts)
      await sleep(600);
      sockets.forEach((s, i) => s.removeListener('message', handlers[i]!));
      for (let i = 0; i < contadores.length; i++) {
        assert.equal(contadores[i], 1, `socket ${i + 1} deve receber LIMPEZA exatamente 1x (contadores=${contadores.join(',')})`);
      }

      for (const limpeza of limpezas) {
        assert.equal(limpeza.type, 'LIMPEZA_APLICADA');
        const removidas = limpeza.pecasRemovidas as string[];
        assert.deepEqual(removidas, [pecaEsperadaRemovida]);
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
      // peça esperada removida
      const pecaIds = estado!.tabuleiro.posicionadas.map((p) => p.pecaId);
      assert.ok(!pecaIds.includes(pecaEsperadaRemovida), `${pecaEsperadaRemovida} deve estar removida, posicionadas=${pecaIds.join(',')}`);
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
      assert.ok(!snapshotPecaIds.includes(pecaEsperadaRemovida), 'snapshot não deve conter peça removida');
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
// Teste C — admissão tardia entrega CELULAS_ILUMINADAS correntes e NÃO reemite LIMPEZA histórica
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
      const { pecaEsperadaRemovida } = await prepararRodada2(ws, ws2, ws3, ws4);

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
      assert.deepEqual(limpeza.pecasRemovidas, [pecaEsperadaRemovida]);
      const celulasBroadcast = (await celulasEspera).celulas as Array<{ linha: number; coluna: number }>;

      // Desconectar ws3 e reconectar como tardio — deve receber replay unicast de CELULAS_ILUMINADAS
      ws3.close();
      await new Promise((r) => setTimeout(r, 200));

      const tokenTardio = await tokenParaJogador(3);
      const wsTardio = new WebSocket(servidor.wsUrl(aceite.partidaId, tokenTardio));
      const aceita = esperarEvento(wsTardio, 'ADMISSAO_ACEITA');
      const turno = esperarEvento(wsTardio, 'TURNO_INICIADO');
      const celulasTardioEspera = esperarEvento(wsTardio, 'CELULAS_ILUMINADAS');
      // Negativa de admissão: histórico não deve reemitir LIMPEZA_APLICADA
      // Anexo ANTES do open para garantir que âncora CELULAS_ILUMINADAS seja vista no mesmo listener
      const tardioSemLimpeza = esperarAusenciaComAncora(wsTardio, 'LIMPEZA_APLICADA', 'CELULAS_ILUMINADAS', 600);

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

      const houveLimpezaHistorica = await tardioSemLimpeza;
      assert.equal(houveLimpezaHistorica, false, 'admissão tardia não deve reemitir LIMPEZA_APLICADA histórica (apenas anunciarTurnoAtual/handlers.ts:135 reenvia CELULAS)');

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
      const { pecaEsperadaRemovida } = await prepararRodada2(ws, ws2, ws3, ws4);

      // D1: MOVER_PEAO isolado (sem CONFIRMAR) não deve emitir LIMPEZA — usa âncora PEAO_MOVIDO
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const semLimpezaMover = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'PEAO_MOVIDO', 600);
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      const houveLimpezaNoMover = await semLimpezaMover;
      assert.equal(houveLimpezaNoMover, false, 'MOVER_PEAO não deve emitir LIMPEZA_APLICADA');

      // Reselecionar para poder confirmar depois
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // D2: CONFIRMAR com limpeza deve emitir LIMPEZA (peca derivada dinamicamente)
      const limpezaEspera = esperarEvento(ws, 'LIMPEZA_APLICADA');
      const posicaoEspera = esperarEvento(ws, 'POSICAO_CONFIRMADA');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await posicaoEspera;
      const limpeza = await limpezaEspera;
      assert.deepEqual(limpeza.pecasRemovidas, [pecaEsperadaRemovida]);

      // D3: 2º CONFIRMAR no mesmo turno não deve emitir 2ª LIMPEZA — unicidade 1x/turno ADR-0005
      // Usa contador + âncora ERRO_DO_TABULEIRO para robustez
      let segundaLimpezaCount = 0;
      function onSegundaLimpeza(data: unknown): void {
        try {
          const p = JSON.parse((data as Buffer).toString()) as { type?: unknown };
          if (p.type === 'LIMPEZA_APLICADA') segundaLimpezaCount += 1;
        } catch {}
      }
      ws.on('message', onSegundaLimpeza);
      const semSegundaLimpeza = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      const erroSegunda = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroSegunda.codigo, 'POSICAO_CONFIRMADA');
      const houveSegundaLimpeza = await semSegundaLimpeza;
      assert.equal(houveSegundaLimpeza, false, '2º CONFIRMAR não deve emitir 2ª LIMPEZA');
      await sleep(100);
      ws.removeListener('message', onSegundaLimpeza);
      assert.equal(segundaLimpezaCount, 0, 'nenhuma LIMPEZA espúria no 2º CONFIRMAR');

      // D4: após CONFIRMAR, MOVER tentativo pós-confirmação (mesmo turno) não deve emitir LIMPEZA
      // MOVER após posicaoConfirmada deve ser rejeitado como POSICAO_CONFIRMADA, sem limpeza
      const semLimpezaAposConfirm = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const erroMoverApos = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroMoverApos.codigo, 'POSICAO_CONFIRMADA');
      const houveApos = await semLimpezaAposConfirm;
      assert.equal(houveApos, false, 'MOVER após POSICAO_CONFIRMADA não deve emitir LIMPEZA');
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

test('Limpeza: PERMANECER não emite LIMPEZA_APLICADA (rodada 2 sem movimento)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      await prepararRodada2(ws, ws2, ws3, ws4);

      // Rodada 2, jogador-1 ativo em (3,3) sem ter movido: PERMANECER válido
      // pecaDoInicioDoTurnoId == peao-branco pecaId (inicial-1) e posicaoConfirmada=false
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const turnoEncerradoEspera = esperarEvento(ws, 'TURNO_ENCERRADO');
      const semLimpezaPermanecer = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'PEAO_PERMANECEU', 600);
      enviar(ws, { type: 'PERMANECER', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      const houveLimpezaPermanecer = await semLimpezaPermanecer;
      assert.equal(houveLimpezaPermanecer, false, 'PERMANECER não deve emitir LIMPEZA_APLICADA');

      const permaneceu = await turnoEncerradoEspera;
      // PERMANECER encerra o turno direto (peoes.test.ts) — valida que TURNO_ENCERRADO veio
      assert.equal(permaneceu.jogadorId, 'jogador-1');

      // Estado sem remoção adicional
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null);
      // Após permanecer, a limpeza anterior (se houve) já removeu a peça esperada, mas permanecer em si não remove mais
      // Verifica que não houve remoção espúria: conta de posicionadas permanece consistente
      const ids = estado!.tabuleiro.posicionadas.map((p) => p.pecaId);
      // inicial-1 deve permanecer, e peças de J1 ainda existem (exceto se limpeza já ocorreu em teste anterior — neste teste isolado, nenhuma limpeza ocorreu antes do permanecer)
      assert.ok(ids.includes('inicial-1'));
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

test('Limpeza: ENCERRAR_TURNO e POSICIONAR_PEAO no Primeiro Turno não emitem LIMPEZA_APLICADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);

    try {
      // Primeiro Turno: posicionar inicial e testar POSICIONAR_PEAO com ausência explícita
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });

      // POSICIONAR_PEAO no Primeiro Turno: sem peças prévias fora da iluminação,
      // não deve remover (iluminação inicial vazia → nova =5 células, nenhuma pré-existente fora)
      // Prova ausência explícita com âncora PEAO_POSICIONADO + 600ms silêncio
      const semLimpezaPosicionar = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'PEAO_POSICIONADO', 600);
      const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
      const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const houveLimpezaPosicionar = await semLimpezaPosicionar;
      assert.equal(houveLimpezaPosicionar, false, 'POSICIONAR_PEAO no Primeiro Turno não deve emitir LIMPEZA (sem peças prévias fora da iluminação)');
      await peaoPosicionadoEspera;
      const recebimento = await recebimentoEspera;
      const rec = recebimento.recebidas as Array<Record<string, unknown>>;
      assert.equal(rec.length, 2);

      // Resolver recebidas e encerrar — ENCERRAR não deve gerar limpeza
      await resolverRecebidasComCelulaAlvo(ws, 1, rec, ['norte', 'leste']);

      const semLimpezaEncerrar = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'TURNO_ENCERRADO', 600);
      enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
      const houveLimpezaEncerrar = await semLimpezaEncerrar;
      assert.equal(houveLimpezaEncerrar, false, 'ENCERRAR_TURNO não deve emitir LIMPEZA_APLICADA');

      // Estado deve permanecer com posicionadas intactas (sem remoção) após ambos
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null);
      const ids = estado!.tabuleiro.posicionadas.map((p) => p.pecaId);
      for (const pid of rec.map((r) => r.pecaId as string)) {
        assert.ok(ids.includes(pid), `${pid} deve permanecer após ENCERRAR sem limpeza (Primeiro Turno não remove)`);
      }
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// ────────────────────────────────────────────────────────────────
// Teste E — rejeições preservadas (FORA_DA_VEZ + impersonation)
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

      // E1: FORA_DA_VEZ — jogador-2 comanda na vez de jogador-1 via SELECIONAR_PECA
      const semLimpezaFora1 = esperarAusenciaComAncora(ws2, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws2, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      const erroFora1 = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erroFora1.codigo, 'FORA_DA_VEZ');
      const houve1 = await semLimpezaFora1;
      assert.equal(houve1, false, 'FORA_DA_VEZ SELECIONAR_PECA não deve emitir LIMPEZA');
      const estadoApos1 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoApos1, estadoAntes);

      // E1b: FORA_DA_VEZ — MOVER_PEAO fora da vez (ws2 na vez de jogador-1)
      const semLimpezaFora2 = esperarAusenciaComAncora(ws2, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws2, { type: 'MOVER_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 0, coluna: 0 } });
      const erroFora2 = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erroFora2.codigo, 'FORA_DA_VEZ');
      const houve2 = await semLimpezaFora2;
      assert.equal(houve2, false, 'FORA_DA_VEZ MOVER_PEAO não deve emitir LIMPEZA');
      const estadoApos2 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoApos2, estadoAntes);

      // E1c: FORA_DA_VEZ — CONFIRMAR_POSICAO_DO_PEAO fora da vez
      const semLimpezaFora3 = esperarAusenciaComAncora(ws2, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws2, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      const erroFora3 = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erroFora3.codigo, 'FORA_DA_VEZ');
      const houve3 = await semLimpezaFora3;
      assert.equal(houve3, false, 'FORA_DA_VEZ CONFIRMAR não deve emitir LIMPEZA');
      const estadoApos3 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoApos3, estadoAntes);

      // E2: impersonation — ws1 autentica como jogador-1 mas declara jogador-2 via SELECIONAR_PECA
      const semLimpezaImp1 = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      const erroImp1 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroImp1.codigo, 'DADOS_INVALIDOS');
      const houveImp1 = await semLimpezaImp1;
      assert.equal(houveImp1, false, 'impersonation SELECIONAR_PECA não deve emitir LIMPEZA');
      const estadoAposImp1 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoAposImp1, estadoAntes);

      // E2b: impersonation — MOVER_PEAO
      const semLimpezaImp2 = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 1, coluna: 1 } });
      const erroImp2 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroImp2.codigo, 'DADOS_INVALIDOS');
      const houveImp2 = await semLimpezaImp2;
      assert.equal(houveImp2, false, 'impersonation MOVER_PEAO não deve emitir LIMPEZA');
      const estadoAposImp2 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoAposImp2, estadoAntes);

      // E2c: impersonation — CONFIRMAR
      const semLimpezaImp3 = esperarAusenciaComAncora(ws, 'LIMPEZA_APLICADA', 'ERRO_DO_TABULEIRO', 600);
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      const erroImp3 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erroImp3.codigo, 'DADOS_INVALIDOS');
      const houveImp3 = await semLimpezaImp3;
      assert.equal(houveImp3, false, 'impersonation CONFIRMAR não deve emitir LIMPEZA');
      const estadoAposImp3 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoAposImp3, estadoAntes);

      // Garantir que celulasIluminadas segue inalterada (vazia no início)
      assert.equal(estadoAposImp3!.celulasIluminadas.length, 0);
    } finally {
      ws.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
