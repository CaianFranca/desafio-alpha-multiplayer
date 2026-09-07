// Teste de integração do feedback dos Monstros via wire (issue #173).
//
// Verifica que os efeitos dos Monstros chegam a TODOS os Jogadores pela
// Conexão à Partida: o ATAQUE_RESOLVIDO é broadcast aos 4 sockets com
// `estadosAplicados` (estado resultante das penalidades — Baixa Iluminação,
// sanidade, Amedrontado), a LIMPEZA_APLICADA é broadcast quando os Monstros
// saem da iluminação (Baixa nova encolhe a luz do atingido), o snapshot da
// recarregamento expõe sanidade/emBaixaIluminacao/amedrontado, o silêncio
// fora→fora e a ordem do lote da Permanência (issue #235), e a recusa de
// comando inválido (FORA_DA_VEZ) chega APENAS ao autor. Segue o padrão de
// iluminacao.test.ts/limpeza.test.ts: app+WS efêmeros com Redis real.
//
// Determinismo do sorteio: a partida nasce com a Caixa EMBARALHADA pelo
// serviço de sorteio — a ordem canônica de composição não é garantida. O
// helper `semearCaixa` injeta direto no estado persistido (mesmo padrão de
// injeção dos testes de domínio) uma cabeça de pecaIds imposta na ordem
// exata que o cenário consome — `semearCaixaComMonstros` é o caso vulto-1,
// espectro-1 na cabeça, para que o Recebimento do Primeiro Turno de
// jogador-1 sorteie os Monstros sem alterar o fluxo wire dos comandos.

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

// Semeia a Caixa do estado persistido: coloca os pecaIds indicados, NA ORDEM,
// na cabeça da Caixa (o restante é preservado, na ordem atual, após eles) —
// a ordem herdada do embaralhamento da criação da partida varia entre
// execuções, então ela é imposta aqui. O TTL da chave é preservado por
// salvarEstadoDaPartida.
async function semearCaixa(partidaId: string, cabeca: readonly string[]): Promise<void> {
  const estado = await obterEstadoDaPartida(redis, partidaId);
  assert.ok(estado !== null, 'estado da partida deve existir para a semeadura');
  const desejados = new Set(cabeca);
  const porPecaId = new Map(
    estado!.tabuleiro.caixa.map((peca) => [peca.pecaId, peca]),
  );
  const montada = cabeca.map((pecaId) => porPecaId.get(pecaId)!);
  assert.ok(montada.every((peca) => peca !== undefined));
  const restante = estado!.tabuleiro.caixa.filter(
    (peca) => !desejados.has(peca.pecaId),
  );
  await salvarEstadoDaPartida(redis, partidaId, {
    ...estado!,
    tabuleiro: { ...estado!.tabuleiro, caixa: [...montada, ...restante] },
  });
}

// Cenário padrão dos Monstros: vulto-1 e espectro-1 na cabeça, NESSA ORDEM,
// para o Recebimento do Primeiro Turno de jogador-1 sortear os Monstros na
// ordem esperada pelo assert.
async function semearCaixaComMonstros(partidaId: string): Promise<void> {
  return semearCaixa(partidaId, ['vulto-1', 'espectro-1']);
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

// Cenário da Permanência com Ataque (issues #236/#291): Caixa semeada com
// vulto-1/espectro-1 na cabeça e Primeiro Turno dos 4 jogadores completo, com
// os Monstros encaixados ao norte (2,3) e ao leste (3,4) de inicial-1 — o
// peão-branco fica DENTRO do Alcance deles e os peões de jogador-2/3/4 fora.
// Vez: jogador-1, rodada 2 (o chamador conduz o gatilho da Permanência).
async function prepararPartidaDePermanencia(servidor: ServidorEfemero): Promise<{
  aceite: AceiteDoEncaminhamento;
  sockets: readonly [WebSocket, WebSocket, WebSocket, WebSocket];
}> {
  const aceite = await criarPartidaViaPost(servidor.baseUrl);
  await semearCaixaComMonstros(aceite.partidaId);
  const ws = await conectarPartida(servidor, aceite.partidaId, 1);
  const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
  const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
  const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

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

  return { aceite, sockets: [ws, ws2, ws3, ws4] };
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
    const { aceite, sockets } = await prepararPartidaDePermanencia(servidor);
    const [ws, ws2, ws3, ws4] = sockets;

    try {
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
      // ws fecha idempotente (no caminho feliz ele já foi fechado antes da
      // reconexão tardia). Sem ele, um assert lançado cedo deixaria o socket
      // do jogador-1 aberto e o servidor.fechar() penduraria no wss.close()
      // esperando o último cliente — mascarando o erro real até o timeout do
      // arquivo (relato do flake: recebidas em ordem trocada).
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

// Issue #235 (espelho no wire do teste de domínio 'mover e confirmar fora→fora
// é silêncio mesmo com peão de terceiro dentro do alcance', issue #236): o
// Jogador Ativo move o Peão e confirma FORA do Alcance de qualquer Monstro —
// com o Vulto semeado e encaixado NO tabuleiro e o peão de terceiro parado
// DENTRO do Alcance dele — e NENHUM socket da partida recebe ATAQUE_RESOLVIDO.
// Os ecos do comando (PEAO_MOVIDO, POSICAO_CONFIRMADA) chegam a todos os
// sockets e provam que o lote fluiu: a ausência do ataque não é timeout.
test('silencio: mover e confirmar fora→fora não emite ATAQUE_RESOLVIDO a nenhum socket, mesmo com Monstro no tabuleiro e peão de terceiro dentro do Alcance', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    // Semeia a ordem da Caixa para a rodada inteira: as 6 peças dos Primeiros
    // Turnos (2+1+1+2) e vulto-1/espectro-1 logo depois — jogador-1 só os
    // sorteia no Recebimento da rodada 2, encaixando o Vulto ao norte da peça
    // recém-ocupada, onde o peão de terceiro (peão-branco) fica DENTRO do
    // Alcance enquanto o atuante permanece fora. As retas-1/5 (orientação 0,
    // bordas N/S) em (2,3) e (5,6) são os destinos conectados dos movers da
    // rodada 2; a reta-4 em (0,1) tem borda oeste FECHADA (sem conexão com
    // inicial-2), forçando a Permanência de jogador-2; cruz-1/t-2 preenchem
    // as recebidas de jogador-4 (nunca destino de movimentação). A Caixa
    // nasce embaralhada (sorteio no serviço), então a ordem é imposta peça a
    // peça.
    await semearCaixa(aceite.partidaId, [
      'reta-1',
      'reta-2',
      'reta-4',
      'reta-5',
      'cruz-1',
      't-2',
      'vulto-1',
      'espectro-1',
    ]);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    const ws3 = await conectarPartida(servidor, aceite.partidaId, 3);
    const ws4 = await conectarPartida(servidor, aceite.partidaId, 4);

    try {
      // ── Rodada 1: Primeiros Turnos dos 4 jogadores com retas sorteadas ──
      await selecionarEPosicionarInicial(ws, 1, { linha: 3, coluna: 3 });
      const recebidas = await selecionarEPosicionarPeao(ws, 1, 'peao-branco', { linha: 3, coluna: 3 });
      assert.deepEqual(recebidas.map((r) => r.pecaId), ['reta-1', 'reta-2']);
      await escolherVagaEPosicionar(ws, 1, 'reta-1', 'norte', { linha: 2, coluna: 3 });
      await escolherVagaEPosicionar(ws, 1, 'reta-2', 'leste', { linha: 3, coluna: 4 });
      await encerrarTurnoEAvancar(ws, ws2, 1, 2, 1);

      const rec2 = await selecionarEPosicionarInicialEPosicionarPeao(ws2, 2, { linha: 0, coluna: 0 });
      assert.deepEqual(rec2.map((r) => r.pecaId), ['reta-4']); // inicial-2 em (0,0): única vaga leste (0,1)
      await escolherVagaEPosicionar(ws2, 2, 'reta-4', 'leste', { linha: 0, coluna: 1 });
      await encerrarTurnoEAvancar(ws2, ws3, 2, 3, 1);

      const rec3 = await selecionarEPosicionarInicialEPosicionarPeao(ws3, 3, { linha: 6, coluna: 6 });
      assert.deepEqual(rec3.map((r) => r.pecaId), ['reta-5']); // inicial-3 em (6,6): única vaga norte (5,6)
      await escolherVagaEPosicionar(ws3, 3, 'reta-5', 'norte', { linha: 5, coluna: 6 });
      await encerrarTurnoEAvancar(ws3, ws4, 3, 4, 1);

      const rec4 = await selecionarEPosicionarInicialEPosicionarPeao(ws4, 4, { linha: 6, coluna: 0 });
      assert.deepEqual(rec4.map((r) => r.pecaId), ['cruz-1', 't-2']); // inicial-4 em (6,0): vagas norte (5,0) e leste (6,1)
      await escolherVagaEPosicionar(ws4, 4, 'cruz-1', 'norte', { linha: 5, coluna: 0 });
      await escolherVagaEPosicionar(ws4, 4, 't-2', 'leste', { linha: 6, coluna: 1 });
      await encerrarTurnoEAvancar(ws4, ws, 4, 1, 2);

      // Contadores de ATAQUE_RESOLVIDO anexados a todos os sockets do início
      // da rodada 2 ao fim do turno de jogador-3 — cobrem a Confirmação
      // silenciosa de jogador-1 (Monstros ainda na Caixa), a Permanência
      // silenciosa de jogador-2 e a Confirmação fora→fora de jogador-3
      // (Vulto no tabuleiro, peão-branco DENTRO do Alcance).
      const ataques = [0, 0, 0, 0];
      const sockets = [ws, ws2, ws3, ws4] as const;
      const contadores = sockets.map((_, i) => (data: unknown) => {
        try {
          const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
          if (parsed.type === 'ATAQUE_RESOLVIDO') ataques[i]! += 1;
        } catch {}
      });
      sockets.forEach((s, i) => s.on('message', contadores[i]!));

      // ── Rodada 2, jogador-1: mover e confirmar entre as retas — fora→fora
      // com Monstros na Caixa (silêncio); o Recebimento sorteia vulto-1,
      // encaixado ao norte de reta-1 em (1,3), de onde o Alcance dele cobre
      // o peão-branco (2,3).
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');
      // Mover deseleciona (ST-10); é preciso reselecionar antes de confirmar.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      const confirmado1Espera = esperarEvento(ws, 'POSICAO_CONFIRMADA');
      const recebimento1Espera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await confirmado1Espera;
      const recebimento1 = await recebimento1Espera;
      assert.deepEqual(
        (recebimento1.recebidas as Array<Record<string, unknown>>).map((r) => r.pecaId),
        ['vulto-1'],
      );
      await escolherVagaEPosicionar(ws, 1, 'vulto-1', 'norte', { linha: 1, coluna: 3 });
      await encerrarTurnoEAvancar(ws, ws2, 1, 2, 2);

      // ── Rodada 2, jogador-2: a reta-4 (0,1) não conecta a oeste (bordas
      // N/S da orientação 0), o mover é impossível — a Permanência fora→fora
      // encerra a vez em silêncio, com o Vulto já no tabuleiro.
      enviar(ws2, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      await esperarEvento(ws2, 'PEAO_SELECIONADO');
      const permaneceuEspera = esperarEvento(ws2, 'PEAO_PERMANECEU');
      enviar(ws2, { type: 'PERMANECER', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      await permaneceuEspera;
      await esperarTurnoIniciado(ws3, 'jogador-3', 2);

      // ── Rodada 2, jogador-3: mover e confirmar fora→fora COM o Vulto no
      // tabuleiro — o peão-branco (2,3) está DENTRO do Alcance do Vulto
      // (1,3) e o atuante (5,6) está fora: a classe do bug #262 (peão parado
      // de terceiro atingido pela jogada alheia) não existe na regra
      // centrada no atuante.
      const movidoEsperas = sockets.map((s) => esperarEvento(s, 'PEAO_MOVIDO'));
      enviar(ws3, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-3', peaoId: 'peao-azul' });
      await esperarEvento(ws3, 'PEAO_SELECIONADO');
      enviar(ws3, { type: 'MOVER_PEAO', jogadorId: 'jogador-3', peaoId: 'peao-azul', celula: { linha: 5, coluna: 6 } });
      await Promise.all(movidoEsperas);
      // Mover deseleciona (ST-10); é preciso reselecionar antes de confirmar.
      enviar(ws3, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-3', peaoId: 'peao-azul' });
      await esperarEvento(ws3, 'PEAO_SELECIONADO');
      const confirmado3Esperas = sockets.map((s) => esperarEvento(s, 'POSICAO_CONFIRMADA'));
      const recebimento3Espera = esperarEvento(ws3, 'RECEBIMENTO_GERADO');
      enviar(ws3, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-3', peaoId: 'peao-azul' });
      await Promise.all(confirmado3Esperas);
      const recebimento3 = await recebimento3Espera;
      assert.deepEqual(
        (recebimento3.recebidas as Array<Record<string, unknown>>).map((r) => r.pecaId),
        ['espectro-1'],
      );
      await escolherVagaEPosicionar(ws3, 3, 'espectro-1', 'norte', { linha: 4, coluna: 6 });
      await encerrarTurnoEAvancar(ws3, ws4, 3, 4, 2);

      // Folga pós-fim do lote: nenhum ATAQUE_RESOLVIDO pode chegar depois
      // dos ecos e do Encerramento do Turno.
      await sleep(300);
      sockets.forEach((s, i) => s.removeListener('message', contadores[i]!));
      assert.equal(ataques[0], 0, 'jogador-1 não deve receber ATAQUE_RESOLVIDO');
      assert.equal(ataques[1], 0, 'jogador-2 não deve receber ATAQUE_RESOLVIDO');
      assert.equal(ataques[2], 0, 'jogador-3 não deve receber ATAQUE_RESOLVIDO');
      assert.equal(ataques[3], 0, 'jogador-4 não deve receber ATAQUE_RESOLVIDO');
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

// Issue #235: a ordem do lote da Permanência no wire — o ATAQUE_RESOLVIDO
// precede o TURNO_ENCERRADO (ADR-0008; hoje isso só era garantido no teste de
// domínio, packages/engine/test/monstros.test.ts). O gravador ordenado anota
// os tipos de TODOS os frames recebidos pelo socket do autor entre o comando
// da Permanência e o TURNO_INICIADO do próximo jogador (âncora de fim de
// lote); o broadcaster envia evento a evento a todos os sockets, então a
// ordem relativa registrada é a ordem do wire.
test('ordem: no lote da Permanência o ATAQUE_RESOLVIDO precede o TURNO_ENCERRADO no wire', async () => {
  const servidor = await subirServidor(600);
  try {
    const { aceite, sockets } = await prepararPartidaDePermanencia(servidor);
    const [ws, ws2, ws3, ws4] = sockets;

    try {
      const registro: string[] = [];
      const gravador = (data: unknown): void => {
        try {
          const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
          if (typeof parsed.type === 'string') registro.push(parsed.type);
        } catch {}
      };
      ws.on('message', gravador);
      const proximoTurnoEspera = esperarTurnoIniciado(ws2, 'jogador-2', 2);
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');
      enviar(ws, { type: 'PERMANECER', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await proximoTurnoEspera;
      ws.removeListener('message', gravador);

      const indiceAtaque = registro.indexOf('ATAQUE_RESOLVIDO');
      const indiceEncerramento = registro.indexOf('TURNO_ENCERRADO');
      assert.ok(indiceAtaque >= 0, 'o lote da Permanência deve carregar o ATAQUE_RESOLVIDO');
      assert.ok(indiceEncerramento >= 0, 'o lote da Permanência deve carregar o TURNO_ENCERRADO');
      assert.ok(
        indiceAtaque < indiceEncerramento,
        `ATAQUE_RESOLVIDO deve preceder TURNO_ENCERRADO no wire (lote: ${registro.join(' → ')})`,
      );
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
