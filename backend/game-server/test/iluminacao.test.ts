// Teste de integração de Iluminação e Limpeza via wire (issue #150).
//
// Verifica que os eventos CELULAS_ILUMINADAS e LIMPEZA_APLICADA chegam ao
// cliente quando o motor emite celulas_iluminadas / limpeza_aplicada, que o
// tardio recebe replay unicast, que payload malformado não altera estado e
// que comando com `jogadorId` alheio é aplicado como a Sessão (#155). Segue o
// padrão de turnos.test.ts: app+WS efêmeros com Redis real.

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
import { obterEstadoDaPartida, salvarEstadoDaPartida } from '../src/partidas/estado.ts';
import { estadoInicialDaPartida } from '@flicker/engine';

const SERVER_ID = 'game-server-teste-iluminacao';
const JWT_SECRET = 'test_secret_para_iluminacao';

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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de iluminação' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  const aceite = (await resposta.json()) as AceiteDoEncaminhamento;
  await fixarCaixaDeterministica(aceite.partidaId);
  return aceite;
}

// A Caixa nasce embaralhada com seed aleatório no serviço (issue #139); os
// fluxos abaixo assumem a topologia da ordem de composição, então restaura a
// ordem determinística antes dos turnos. O sorteio embaralhado em si é
// coberto por pecas-especiais.test.ts.
async function fixarCaixaDeterministica(partidaId: string): Promise<void> {
  const semSeed = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  assert.equal(semSeed.sucesso, true);
  if (!semSeed.sucesso) throw new Error('inacessível');
  const atual = await obterEstadoDaPartida(redis, partidaId);
  assert.ok(atual !== null);
  await salvarEstadoDaPartida(redis, partidaId, {
    ...atual!,
    tabuleiro: { ...atual!.tabuleiro, caixa: semSeed.estado.tabuleiro.caixa },
  });
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

async function conectarTardioComCelulas(
  servidor: ServidorEfemero,
  partidaId: string,
  jogador = 3,
): Promise<{ ws: WebSocket; celulas: Array<{ linha: number; coluna: number }> }> {
  const token = await tokenParaJogador(jogador);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const aceita = esperarEvento(ws, 'ADMISSAO_ACEITA');
  const celulasEspera = esperarEvento(ws, 'CELULAS_ILUMINADAS');
  const turnoEspera = esperarEvento(ws, 'TURNO_INICIADO');

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const mensagem = await aceita;
  assert.equal(mensagem.jogadorId, `jogador-${jogador}`);
  // Tardio recebe TURNO + CELULAS unicast via anunciarTurnoAtual — ordem garantida, aguardar ambos
  const [turno, iluminadas] = await Promise.all([turnoEspera, celulasEspera]);
  void turno;
  const celulas = iluminadas.celulas as Array<{ linha: number; coluna: number }>;
  return { ws, celulas };
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

// Giros horários necessários para a Recebida encaixar conectada (issue #311):
// a borda voltada à Peça sob o Peão (o oposto da vaga) precisa estar aberta.
// Em orientação 0, reta nas vagas leste/oeste e T na vaga norte fecham essa
// borda (1 giro horário abre); os demais casos e Especiais/Monstros (4
// bordas) conectam direto (r=0).
function girosParaConectar(tipoDaPeca: string, borda: string): number {
  if (tipoDaPeca === 'reta' && (borda === 'leste' || borda === 'oeste')) return 1;
  if (tipoDaPeca === 'T' && borda === 'norte') return 1;
  return 0;
}

/**
 * Aguarda o TURNO_INICIADO de um Jogador/rodada específicos, descartando os
 * demais frames do tipo — em especial o TURNO_INICIADO que a admissão anuncia
 * ao socket recém-conectado.
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
  assert.equal(recebidas.length, 2); // seed fixa: Inicial tem 2 vagas (norte/leste ou sul/leste após giro)
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

    // Encaixe conectado (issue #311): gira a Recebida (horário) até a borda
    // voltada à Peça sob o Peão abrir; r=0 não emite GIRAR_PECA.
    const giros = girosParaConectar(r.tipoDaPeca as string, borda);
    for (let giro = 0; giro < giros; giro++) {
      enviar(ws, { type: 'GIRAR_PECA', jogadorId, pecaId, sentido: 'horario' });
      await esperarEvento(ws, 'PECA_GIRADA');
    }

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

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de integração: ${(error as Error).message}`);
  }
});

after(async () => {
  // Teardown blindado: o quit() pode lançar ("Connection is closed.") quando
  // o socket do Redis já caiu com ECONNABORTED transiente no fim da bateria —
  // o erro não tratado vira teste sintético falho do runner (não do teste).
  try {
    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  } catch {
    redis.disconnect();
  }
});

test('fluxo feliz: CELULAS_ILUMINADAS é recebido ao posicionar Peão no Primeiro Turno', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });

      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const iluminadasEspera = esperarEvento(ws, 'CELULAS_ILUMINADAS');
      const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
      const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });

      await peaoPosicionadoEspera;
      await recebimentoEspera;
      const iluminadas = await iluminadasEspera;

      const celulas = iluminadas.celulas as Array<{ linha: number; coluna: number }>;
      assert.equal(celulas.length, 5);
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 2 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 4 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 2));
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 4));

      // Tardio: conectar jogador-3 após iluminação e verificar replay unicast
      const { ws: wsTardio, celulas: tardioCelulas } = await conectarTardioComCelulas(servidor, aceite.partidaId, 3);
      try {
        assert.equal(tardioCelulas.length, 5);
        assert.deepEqual(
          [...tardioCelulas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
          [...celulas].sort((a, b) => a.linha - b.linha || a.coluna - b.coluna),
        );
      } finally {
        wsTardio.close();
      }
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('fluxo feliz: LIMPEZA_APLICADA é recebido quando peça fica fora da iluminação ao confirmar posição na rodada 2', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      // ── Primeiro Turno de jogador-1 ──────────────────────────────
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
      const recebidas = await posicionarPeaoEObterRecebidas(ws, 1, { linha: 3, coluna: 3 });
      // Resolver usando celulaAlvo do evento VAGA (assert exato C1)
      await resolverRecebidasComCelulaAlvo(ws, 1, recebidas, ['norte', 'leste']);
      await encerrarTurnoEAvancar(ws, ws2, 1, 2, 1);

      // ── Primeiro Turno de jogador-2 ──────────────────────────────
      // Inicial-2 em (0,0): girar horário antes para obter 2 vagas sul/leste (borda sul/leste)
      await selecionarEPosicionarInicial(ws2, 2, { linha: 0, coluna: 0 }, { girarHorarioAntes: true });
      const recebidas2 = await posicionarPeaoEObterRecebidas(ws2, 2, { linha: 0, coluna: 0 });
      const resolvidas2 = await resolverRecebidasComCelulaAlvo(ws2, 2, recebidas2, ['sul', 'leste']);
      // Validar que celulaAlvo corresponde a sul/leste de (0,0)
      assert.deepEqual(resolvidas2[0]!.celulaAlvo, { linha: 1, coluna: 0 });
      assert.deepEqual(resolvidas2[1]!.celulaAlvo, { linha: 0, coluna: 1 });

      await encerrarTurnoEAvancar(ws2, ws3, 2, 3, 1);

      // ── Primeiro Turno de jogador-3 e 4 para avançar à rodada 2 ──
      for (const [wsX, n, cel] of [
        [ws3, 3, { linha: 1, coluna: 5 }],
        [ws4, 4, { linha: 5, coluna: 5 }],
      ] as const) {
        await selecionarEPosicionarInicial(wsX, n, cel);
        const rec = await posicionarPeaoEObterRecebidas(wsX, n, cel);
        // Inicial interior: vagas norte/leste disponíveis (1,5) -> norte(0,5)/leste(1,6); (5,5) -> norte(4,5)/leste(5,6)
        const bordas: ReadonlyArray<'norte' | 'leste'> = ['norte', 'leste'] as const;
        await resolverRecebidasComCelulaAlvo(wsX, n, rec, bordas as unknown as Array<'norte' | 'sul' | 'leste' | 'oeste'>);
        const prox = n === 3 ? 4 : 1;
        const rodada = n === 4 ? 2 : 1;
        const alvoWs = prox === 1 ? ws : prox === 4 ? ws4 : ws3;
        await encerrarTurnoEAvancar(wsX as WebSocket, alvoWs as WebSocket, n as number, prox, rodada);
      }

      // ── Rodada 2 de jogador-1 ────────────────────────────────────
      // Mover peao-branco de (3,3) para (2,3) — onde está a peça ao norte. Nova iluminação de (2,3): (1,3),(2,2),(2,3),(2,4),(3,3)
      // A peça em (3,4) (leste da inicial) fica FORA → limpeza deve removê-la.
      // O mover re-seleciona o Peão movido (re-seleção pós-mover, #263/#324):
      // o confirmar segue direto, sem SELECIONAR_PEAO.
      // Descobre dinamicamente qual peça está em (3,4) antes da limpeza
      const estadoPreLimpeza = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoPreLimpeza !== null);
      const pecaLeste = estadoPreLimpeza!.tabuleiro.posicionadas.find((p) => p.celula.linha === 3 && p.celula.coluna === 4);
      assert.ok(pecaLeste, 'deve haver peça em (3,4) antes da limpeza');
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');

      const limpezaEspera = esperarEvento(ws, 'LIMPEZA_APLICADA');
      const posicaoConfirmadaEspera = esperarEvento(ws, 'POSICAO_CONFIRMADA');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await posicaoConfirmadaEspera;

      const limpeza = await limpezaEspera;
      assert.equal(limpeza.type, 'LIMPEZA_APLICADA');
      const pecasRemovidas = limpeza.pecasRemovidas as string[];
      // A peça ao leste (3,4) deve estar nas removidas, seja qual for seu tipo embaralhado
      assert.ok(pecasRemovidas.includes(pecaLeste!.pecaId), `esperava ${pecaLeste!.pecaId} nas removidas, got ${pecasRemovidas}`);
      // Na iluminação (2,3), (3,4) está fora; a peça leste deve ser a única removida
      assert.equal(pecasRemovidas.length, 1);
      assert.deepEqual(pecasRemovidas, [pecaLeste!.pecaId]);
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

test('rejeição: payload malformado e tipo inexistente sem alterar estado; jogadorId alheio é aplicado como a Sessão (#155)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Capturar estado antes das rejeições
      const estadoAntes = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoAntes !== null);

      // 1) Tipo inexistente
      enviar(ws, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] });
      const erro1 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro1.codigo, 'DADOS_INVALIDOS');
      const estado1 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estado1, estadoAntes);

      // 2) Payload malformado: celula fora da grade (linha 99)
      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 99, coluna: 99 } });
      const erro2 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro2.codigo, 'DADOS_INVALIDOS');
      const estado2 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estado2, estadoAntes);

      // 3) Payload malformado: falta campo obrigatório pecaId
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1' } as unknown as Record<string, unknown>);
      const erro3 = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro3.codigo, 'DADOS_INVALIDOS');
      const estado3 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estado3, estadoAntes);

      // 4) Ator da Sessão (#155): ws autentica como jogador-1 mas declara
      // jogador-2 no wire. O comando é aplicado como a Sessão — a vez é de
      // jogador-1, então PECA_SELECIONADA confirma que o ator foi a Sessão
      // (com o `jogadorId` do wire, seria FORA_DA_VEZ).
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-1' });
      const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
      assert.equal(selecionada.pecaId, 'inicial-1');
      const estado4 = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado4 !== null);
      assert.equal(estado4!.tabuleiro.pecaSelecionadaId, 'inicial-1');

      // Garantir que nenhum evento de iluminação/limpeza foi emitido indevidamente
      // (nenhum listener pendente; apenas checar que estado celulasIluminadas ainda vazio)
      assert.equal(estado4!.celulasIluminadas.length, 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
