// Teste de integração do feedback dos Monstros via wire (issue #173).
//
// Verifica que os efeitos dos Monstros chegam a TODOS os Jogadores pela
// Conexão à Partida: o ATAQUE_RESOLVIDO é broadcast aos 4 sockets com
// `estadosAplicados` (estado resultante das penalidades — Baixa Iluminação,
// sanidade, Amedrontado), a LIMPEZA_APLICADA é broadcast quando os Monstros
// saem da iluminação (Baixa nova encolhe a luz do atingido), o snapshot da
// recarregamento expõe sanidade/emBaixaIluminacao/amedrontado e a recusa de
// comando inválido (FORA_DA_VEZ) chega APENAS ao autor. Segue o padrão de
// iluminacao.test.ts/limpeza.test.ts: app+WS efêmeros com Redis real.
//
// Determinismo do sorteio: a partida nasce sem seed — a Caixa fica na ordem
// canônica de composição (monstros por último). O helper
// `semearCaixaComMonstros` injeta direto no estado persistido (mesmo padrão
// de injeção dos testes de domínio) a ordem vulto-1, espectro-1 na cabeça da
// Caixa, para que o Recebimento do Primeiro Turno de jogador-1 sorteie os
// Monstros sem alterar o fluxo wire dos comandos.

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
  salvarEstadoDaPartida,
} from '../src/partidas/estado.ts';

const SERVER_ID = 'game-server-teste-monstros-feedback';
const JWT_SECRET = 'test_secret_para_monstros_feedback';

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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de feedback dos monstros' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

// Semeia a Caixa do estado persistido: vulto-1 e espectro-1 na cabeça, para o
// Recebimento do Primeiro Turno de jogador-1 sortear os Monstros. O TTL da
// chave é preservado por salvarEstadoDaPartida.
async function semearCaixaComMonstros(partidaId: string): Promise<void> {
  const estado = await obterEstadoDaPartida(redis, partidaId);
  assert.ok(estado !== null, 'estado da partida deve existir para a semeadura');
  const monstros = estado!.tabuleiro.caixa.filter(
    (peca) => peca.pecaId === 'vulto-1' || peca.pecaId === 'espectro-1',
  );
  assert.equal(monstros.length, 2);
  const resto = estado!.tabuleiro.caixa.filter(
    (peca) => !monstros.includes(peca),
  );
  await salvarEstadoDaPartida(redis, partidaId, {
    ...estado!,
    tabuleiro: { ...estado!.tabuleiro, caixa: [...monstros, ...resto] },
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
): Promise<void> {
  const jogadorId = `jogador-${jogadorN}`;
  const pecaId = `inicial-${jogadorN}`;
  enviar(ws, { type: 'SELECIONAR_PECA', jogadorId, pecaId });
  await esperarEvento(ws, 'PECA_SELECIONADA');
  enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId, celula });
  await esperarEvento(ws, 'PECA_POSICIONADA');
}

async function selecionarEPosicionarPeao(
  ws: WebSocket,
  jogadorN: number,
  peaoId: string,
  celula: { linha: number; coluna: number },
): Promise<Array<Record<string, unknown>>> {
  const jogadorId = `jogador-${jogadorN}`;
  enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId, peaoId });
  await esperarEvento(ws, 'PEAO_SELECIONADO');
  const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
  const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
  enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId, peaoId, celula });
  await peaoPosicionadoEspera;
  const recebimento = await recebimentoEspera;
  return recebimento.recebidas as Array<Record<string, unknown>>;
}

async function escolherVagaEPosicionar(
  ws: WebSocket,
  jogadorN: number,
  pecaId: string,
  borda: 'norte' | 'leste' | 'sul' | 'oeste',
  celulaAlvoEsperada: { linha: number; coluna: number },
): Promise<void> {
  const jogadorId = `jogador-${jogadorN}`;
  enviar(ws, {
    type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
    jogadorId,
    recebidaId: `recebida-${pecaId}`,
    borda,
  });
  const escolhido = await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');
  assert.equal(escolhido.recebidaId, `recebida-${pecaId}`);
  assert.deepEqual(escolhido.celulaAlvo, celulaAlvoEsperada);
  enviar(ws, { type: 'POSICIONAR_PECA', jogadorId, pecaId, celula: celulaAlvoEsperada });
  await esperarEvento(ws, 'PECA_POSICIONADA');
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

// Primeiro Turno completo de posicionamento: Peça Inicial + Peão; devolve as
// Recebidas pendentes (para o encaixe escolher as vagas).
async function selecionarEPosicionarInicialEPosicionarPeao(
  ws: WebSocket,
  jogadorN: number,
  celula: { linha: number; coluna: number },
): Promise<Array<Record<string, unknown>>> {
  await selecionarEPosicionarInicial(ws, jogadorN, celula);
  const corMap: Record<number, string> = {
    1: 'peao-branco',
    2: 'peao-vermelho',
    3: 'peao-azul',
    4: 'peao-amarelo',
  };
  return selecionarEPosicionarPeao(ws, jogadorN, corMap[jogadorN]!, celula);
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

// Issue #236: o ATAQUE_RESOLVIDO sai do gatilho do ATUANTE — a Permanência
// do jogador cujo peão está dentro do Alcance dispara (antes = depois,
// dentro), com LIMPEZA_APLICADA no mesmo lote quando a Baixa nova do Vulto
// encolhe a luz do atingido. O cenário de "terceiro dispara o ataque do
// primeiro turno alheio" (delta global do legado, bug #262) é impossível na
// regra centrada no atuante.
test('broadcast: ATAQUE_RESOLVIDO com estadosAplicados e LIMPEZA_APLICADA chegam aos 4 sockets na Permanência; snapshot expõe sanidade/estados', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    await semearCaixaComMonstros(aceite.partidaId);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      // ── Primeiro Turno de jogador-1: Vulto e Espectro na Vizinhança ──
      // Inicial-1 em (3,3), Peão em cima; o Recebimento (Caixa semeada) sorteia
      // vulto-1 e espectro-1, encaixados ao norte (2,3) e ao leste (3,4). O
      // gatilho do posicionamento do Peão roda ANTES dos encaixes (monstros
      // ainda na Caixa): silêncio; o encaixe de peça NUNCA dispara.
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
      const recebidas = await selecionarEPosicionarPeao(ws, 1, 'peao-branco', { linha: 3, coluna: 3 });
      assert.deepEqual(recebidas.map((r) => r.pecaId), ['vulto-1', 'espectro-1']);
      await escolherVagaEPosicionar(ws, 1, 'vulto-1', 'norte', { linha: 2, coluna: 3 });
      await escolherVagaEPosicionar(ws, 1, 'espectro-1', 'leste', { linha: 3, coluna: 4 });
      await encerrarTurnoEAvancar(ws, ws2, 1, 2, 1);

      // ── Primeiros Turnos de jogador-2/3/4: fora→fora é silêncio ─────
      // O peão de jogador-1 fica DENTRO do Alcance dos Monstros encaixados,
      // mas quem atua (jogador-2/3/4) posiciona FORA do Alcance: o peão
      // parado de terceiro não é atingido (issue #262 eliminada).
      const rec2 = await selecionarEPosicionarInicialEPosicionarPeao(ws2, 2, { linha: 0, coluna: 0 });
      assert.equal(rec2.length, 1); // inicial-2 em (0,0): única vaga leste (0,1)
      await escolherVagaEPosicionar(ws2, 2, rec2[0]!.pecaId as string, 'leste', { linha: 0, coluna: 1 });
      await encerrarTurnoEAvancar(ws2, ws3, 2, 3, 1);

      const rec3 = await selecionarEPosicionarInicialEPosicionarPeao(ws3, 3, { linha: 6, coluna: 6 });
      assert.equal(rec3.length, 1); // inicial-3 em (6,6): única vaga norte (5,6)
      await escolherVagaEPosicionar(ws3, 3, rec3[0]!.pecaId as string, 'norte', { linha: 5, coluna: 6 });
      await encerrarTurnoEAvancar(ws3, ws4, 3, 4, 1);

      const rec4 = await selecionarEPosicionarInicialEPosicionarPeao(ws4, 4, { linha: 6, coluna: 0 });
      assert.equal(rec4.length, 2); // inicial-4 em (6,0): vagas norte (5,0) e leste (6,1)
      await escolherVagaEPosicionar(ws4, 4, rec4[0]!.pecaId as string, 'norte', { linha: 5, coluna: 0 });
      await escolherVagaEPosicionar(ws4, 4, rec4[1]!.pecaId as string, 'leste', { linha: 6, coluna: 1 });
      await encerrarTurnoEAvancar(ws4, ws, 4, 1, 2);

      // ── Rodada 2, jogador-1: gatilho da Permanência ──────────────────
      // O peão-branco segue na inicial-1 (3,3), DENTRO do Alcance do Vulto
      // (2,3) e do Espectro (3,4): permanecer dentro dispara (antes = depois).
      // Penalidades: Baixa Iluminação (Vulto) + sanidade 3 → 2 (Espectro); a
      // Baixa nova encolhe a luz de jogador-1 à própria célula ⇒ a Iluminação
      // é reaplicada e a Limpeza remove os dois Monstros.
      const ataquesEsperas = [ws, ws2, ws3, ws4].map((s) => esperarEvento(s, 'ATAQUE_RESOLVIDO'));
      const limpezasEsperas = [ws, ws2, ws3, ws4].map((s) => esperarEvento(s, 'LIMPEZA_APLICADA'));
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      enviar(ws, { type: 'PERMANECER', jogadorId: 'jogador-1', peaoId: 'peao-branco' });

      const ataques = await Promise.all(ataquesEsperas);
      const limpezas = await Promise.all(limpezasEsperas);

      for (const ataque of ataques) {
        assert.equal(ataque.type, 'ATAQUE_RESOLVIDO');
        const atacantes = ataque.atacantes as Array<Record<string, unknown>>;
        assert.deepEqual(atacantes.map((a) => a.pecaId), ['vulto-1', 'espectro-1']);
        assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
        assert.deepEqual(ataque.protegidos, []);
        // Estado RESULTANTE das penalidades, idêntico nos 4 sockets.
        assert.deepEqual(ataque.estadosAplicados, [
          { jogadorId: 'jogador-1', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ]);
      }
      for (const limpeza of limpezas) {
        // Monstros saem da iluminação (Baixa nova) e são removidos: broadcast
        // a todos, no mesmo lote do ATAQUE_RESOLVIDO.
        assert.deepEqual(limpeza.pecasRemovidas, ['vulto-1', 'espectro-1']);
      }

      // ── Snapshot do recarregamento: reconexão de jogador-1 entrega
      // ESTADO_DA_PARTIDA com sanidade/emBaixaIluminacao/amedrontado atuais.
      ws.close();
      await sleep(200);
      const tokenTardio = await tokenParaJogador(1);
      const wsTardio = new WebSocket(servidor.wsUrl(aceite.partidaId, tokenTardio));
      const aceita = esperarEvento(wsTardio, 'ADMISSAO_ACEITA');
      const snapshotEspera = esperarEvento(wsTardio, 'ESTADO_DA_PARTIDA');
      await new Promise<void>((resolve, reject) => {
        wsTardio.once('open', () => resolve());
        wsTardio.once('error', reject);
      });
      try {
        await aceita;
        const estado = await snapshotEspera;
        const snapshot = estado.snapshot as Record<string, unknown>;
        const jogadores = snapshot.jogadores as Array<Record<string, unknown>>;
        const j1 = jogadores.find((j) => j.jogadorId === 'jogador-1')!;
        assert.equal(j1.sanidade, 2);
        assert.equal(j1.emBaixaIluminacao, true);
        assert.equal(j1.amedrontado, false);
        for (const id of ['jogador-2', 'jogador-3', 'jogador-4']) {
          const j = jogadores.find((x) => x.jogadorId === id)!;
          assert.equal(j.sanidade, 3);
          assert.equal(j.emBaixaIluminacao, false);
          assert.equal(j.amedrontado, false);
        }
      } finally {
        wsTardio.close();
      }
    } finally {
      ws2.close();
      ws3.close();
      ws4.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('recusa: ERRO_DO_TABULEIRO (FORA_DA_VEZ) chega apenas ao autor; os outros 3 sockets não recebem erro', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      // Contadores de ERRO_DO_TABULEIRO anexados a todos os sockets ANTES do
      // comando inválido — provam que a recusa não vaza para os demais.
      const erros = [0, 0, 0, 0];
      const sockets = [ws, ws2, ws3, ws4] as const;
      const contadores = sockets.map((_, i) => (data: unknown) => {
        try {
          const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
          if (parsed.type === 'ERRO_DO_TABULEIRO') erros[i]! += 1;
        } catch {}
      });
      sockets.forEach((s, i) => s.on('message', contadores[i]!));

      // Comando inválido: MOVER_PEAO fora da vez (a vez é de jogador-1) —
      // a recusa é unicast ao autor com o código fechado do domínio.
      enviar(ws2, { type: 'MOVER_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 0, coluna: 0 } });
      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'FORA_DA_VEZ');

      // Âncora de canal vivo: comando válido do Jogador Ativo é broadcast aos
      // 4 sockets — após recebê-la, nenhum outro ERRO_DO_TABULEIRO pode chegar.
      const ancoras = [ws, ws3, ws4].map((s) => esperarEvento(s, 'PEAO_SELECIONADO'));
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await Promise.all(ancoras);
      await sleep(300);
      sockets.forEach((s, i) => s.removeListener('message', contadores[i]!));

      assert.equal(erros[0], 0, 'jogador-1 não deve receber ERRO_DO_TABULEIRO');
      assert.equal(erros[1], 1, 'apenas o autor (jogador-2) recebe a recusa, exatamente 1x');
      assert.equal(erros[2], 0, 'jogador-3 não deve receber ERRO_DO_TABULEIRO');
      assert.equal(erros[3], 0, 'jogador-4 não deve receber ERRO_DO_TABULEIRO');
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
