// Teste de integração de Peças Especiais e sorteio no game-server (issue #139 / ST-12).
//
// Sobe app+WS efêmeros com Redis real e exercita o serviço da partida:
// embaralhamento único da Caixa (seed no serviço), sorteio unitário via
// RECEBIMENTO_GERADO (vaga null + PECA_SORTEADA por peça), mesma mecânica
// (ESCOLHER_VAGA + POSICIONAR_PECA na célula-alvo), ausência de janela de
// manipulação para especiais e capacidade do Portão de Saída (até 4 peões).
// Baseado no padrão de tabuleiro.test.ts / peoes.test.ts.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis, SESSION_ISS, SESSION_ACCESS_AUDIENCE } from '@flicker/config';
import type { AceiteDoEncaminhamento, MembroDaSala, OfertaDeEncaminhamento } from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import {
  obterEstadoDaPartida,
  salvarEstadoDaPartida,
} from '../src/partidas/estado.ts';
import {
  aplicarComandoDePartida,
  bordasAbertas,
  COMPOSICAO_DA_CAIXA,
  estadoInicialDaPartida,
  type EstadoDaPartida,
} from '@flicker/engine';

const SERVER_ID = 'game-server-teste-pecas-especiais';
const JWT_SECRET = 'test_secret_para_pecas_especiais';

const redis = criarClienteRedis();

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
  const wss = criarWebSocketServer(server, contexto, { partida: { broadcaster, handlers } });
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
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', issuer: SESSION_ISS, audience: SESSION_ACCESS_AUDIENCE });
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
    body: JSON.stringify({ partidaId, motivo: 'limpeza pecas especiais' }),
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

function esperarEvento(ws: WebSocket, tipo: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
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
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === tipo) {
        clearTimeout(timer);
        ws.removeListener('message', onMensagem);
        resolve(parsed as Record<string, unknown>);
      }
    }
    ws.on('message', onMensagem);
  });
}

// Aguarda N eventos WS do mesmo tipo (listener único que conta); rejeita se a
// quantidade não for atingida na janela — sem tolerar zero eventos.
function esperarEventos(ws: WebSocket, tipo: string, quantidade: number, timeoutMs = 5000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const coletados: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      ws.removeListener('message', onMensagem);
      reject(new Error(`timeout aguardando ${quantidade} eventos WS '${tipo}' (recebidos ${coletados.length})`));
    }, timeoutMs);
    function onMensagem(data: unknown): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse((data as Buffer).toString());
      } catch {
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === tipo) {
        coletados.push(parsed as Record<string, unknown>);
        if (coletados.length === quantidade) {
          clearTimeout(timer);
          ws.removeListener('message', onMensagem);
          resolve(coletados);
        }
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

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de integração: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') await redis.quit();
  else redis.disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// Embaralhamento da Caixa no serviço (issue #139): a partida criada via HTTP já
// nasce com a Caixa embaralhada (seed aleatório no serviço). Valida comprimento
// e que a ordem não é determinística da composição sem seed.

test('sorteio no serviço: partida criada via HTTP tem Caixa embaralhada completa', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
    assert.ok(estado !== null);
    // Total deriva da composição declarada no engine (incremental na spec).
    const totalDaCaixa = COMPOSICAO_DA_CAIXA.reduce((soma, entrada) => soma + entrada.quantidade, 0);
    assert.equal(estado!.tabuleiro.caixa.length, totalDaCaixa);
    // Composição fixa sem seed começa com reta-1..10; com seed a ordem global
    // deve divergir (evita flake extremo onde o seed sortearia a mesma ordem).
    const semSeed = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(semSeed.sucesso, true);
    if (semSeed.sucesso) {
      const ordemIgual = estado!.tabuleiro.caixa.every((p, i) => p.pecaId === semSeed.estado.tabuleiro.caixa[i]!.pecaId);
      assert.equal(ordemIgual, false, 'Caixa do serviço deve estar embaralhada (ordem distinta da composição sem seed)');
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// Engine direto: especiais têm 4 bordas (gerador, sala_do_diretor, sala_medica, portao_de_saida) em qualquer orientação.

test('peças especiais têm 4 bordas abertas em qualquer orientação', async () => {
  const tipos: Array<'gerador' | 'sala_do_diretor' | 'sala_medica' | 'portao_de_saida'> = [
    'gerador',
    'sala_do_diretor',
    'sala_medica',
    'portao_de_saida',
  ];
  for (const tipo of tipos) {
    for (const orientacao of [0, 90, 180, 270] as const) {
      const bordas = bordasAbertas({ tipo, orientacao });
      assert.equal(bordas.length, 4, `${tipo} em ${orientacao}° deve ter 4 bordas`);
      assert.deepEqual([...bordas].sort(), ['leste', 'norte', 'oeste', 'sul']);
    }
  }
});

// Sorteio unitário via serviço: após posicionar peão inicial, RECEBIMENTO_GERADO
// traz pendências com vaga null e PECA_SORTEADA por peça; escolha é por peça.

test('sorteio unitário via serviço: RECEBIMENTO_GERADO com vaga null e PECA_SORTEADA por peça', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    // Estado sintético controlado: força caixa com especiais no topo para garantir sorteio de especiais
    const base = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(base.sucesso, true);
    if (!base.sucesso) throw new Error('inacessível');
    let estado = base.estado;
    // Coloca gerador-1 e sala_do_diretor-1 no topo da caixa (2 vagas da inicial em (3,3))
    const caixaControlada = [
      { pecaId: 'gerador-1', tipo: 'gerador' as const, orientacao: 0 as const },
      { pecaId: 'sala-do-diretor-1', tipo: 'sala_do_diretor' as const, orientacao: 0 as const },
      ...estado.tabuleiro.caixa.filter((p) => p.pecaId !== 'gerador-1' && p.pecaId !== 'sala-do-diretor-1'),
    ];
    // Posiciona inicial-1 em (3,3) e peão branco sobre ela via domínio
    for (const cmd of [
      { tipo: 'selecionar_peca', pecaId: 'inicial-1' },
      { tipo: 'posicionar_peca', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
    ] as const) {
      const r = aplicarComandoDePartida(estado, cmd, 'jogador-1');
      assert.equal(r.sucesso, true);
      if (!r.sucesso) throw new Error('inacessível');
      estado = r.estado;
    }
    // Injeta caixa controlada mantendo posicionamento
    estado = {
      ...estado,
      tabuleiro: { ...estado.tabuleiro, caixa: caixaControlada },
    };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estado);

    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    try {
      // Listeners antecipados (antes do envio): um PECA_SORTEADA por peça sorteada.
      const sorteadasPromise = esperarEventos(ws, 'PECA_SORTEADA', 2, 5000);
      const recebimentoPromise = esperarEvento(ws, 'RECEBIMENTO_GERADO', 5000);
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const recebimento = await recebimentoPromise;
      const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
      assert.equal(recebidas.length, 2, '2 vagas (norte/leste) → 2 peças sorteadas');
      for (const r of recebidas) {
        assert.equal(r.vaga, null, 'vaga deve nascer null');
        assert.equal(r.celulaAlvo, null, 'celulaAlvo deve nascer null');
        assert.equal(r.orientacao, 0, 'orientação de nascimento viaja no evento (espelho do bot)');
        assert.ok(typeof r.recebidaId === 'string' && (r.recebidaId as string).startsWith('recebida-'));
        assert.ok(typeof r.pecaId === 'string');
      }
      // Verifica que as peças sorteadas são as do topo controlado
      const ids = recebidas.map((r) => r.pecaId as string).sort();
      assert.ok(ids.includes('gerador-1'));
      assert.ok(ids.includes('sala-do-diretor-1'));

      const sorteadas = await sorteadasPromise;
      // Um evento PECA_SORTEADA por peça sorteada, sem tolerar zero.
      assert.equal(sorteadas.length, 2);
      for (const ev of sorteadas) {
        assert.ok(typeof ev.pecaId === 'string');
        assert.ok(['gerador', 'sala_do_diretor', 'sala_medica', 'portao_de_saida', 'reta', 'T', 'cruz', 'vulto', 'espectro'].includes(ev.tipoDaPeca as string));
      }
      // As sorteadas correspondem às recebidas (mesmas peças, sem reposição).
      assert.deepEqual(sorteadas.map((ev) => ev.pecaId).sort(), ids);

      // Escolha da vaga é por peça: cada ESCOLHER_VAGA fixa uma pendência
      const primeira = recebidas[0]!;
      enviar(ws, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId: 'jogador-1', recebidaId: primeira.recebidaId as string, borda: 'norte' });
      const escolhida = await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');
      assert.equal(escolhida.recebidaId, primeira.recebidaId);
      assert.equal(escolhida.borda, 'norte');

      // Verifica que a pendência restante segue com vaga null até ser escolhida
      const estadoAposEscolha = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoAposEscolha !== null);
      const pendenteRestante = estadoAposEscolha!.tabuleiro.recebidas.find((r) => r.recebidaId !== primeira.recebidaId);
      assert.equal(pendenteRestante?.vaga, null);
      const escolhidaNoEstado = estadoAposEscolha!.tabuleiro.recebidas.find((r) => r.recebidaId === primeira.recebidaId);
      assert.equal(escolhidaNoEstado?.vaga, 'norte');
    } finally {
      ws.close();
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// Mesma mecânica para especiais: ESCOLHER_VAGA + POSICIONAR_PECA na célula-alvo
// posiciona cada especial com sucesso.

test('peças especiais usam mesma mecânica: escolher vaga + posicionar na célula-alvo', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const base = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(base.sucesso, true);
    if (!base.sucesso) throw new Error('inacessível');
    let estado = base.estado;
    const especiais = [
      { pecaId: 'gerador-2', tipo: 'gerador' as const },
      { pecaId: 'sala-medica-1', tipo: 'sala_medica' as const },
    ];
    const caixaControlada = [
      ...especiais.map((e) => ({ pecaId: e.pecaId, tipo: e.tipo, orientacao: 0 as const })),
      ...estado.tabuleiro.caixa.filter((p) => !especiais.some((e) => e.pecaId === p.pecaId)),
    ];
    for (const cmd of [
      { tipo: 'selecionar_peca', pecaId: 'inicial-1' },
      { tipo: 'posicionar_peca', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
    ] as const) {
      const r = aplicarComandoDePartida(estado, cmd, 'jogador-1');
      assert.equal(r.sucesso, true);
      if (!r.sucesso) throw new Error('inacessível');
      estado = r.estado;
    }
    estado = { ...estado, tabuleiro: { ...estado.tabuleiro, caixa: caixaControlada } };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estado);

    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    try {
      const recebimentoP = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const recebimento = await recebimentoP;
      const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
      assert.equal(recebidas.length, 2);
      // Encaixa cada especial na sua célula-alvo
      const vagas: Array<'norte' | 'leste'> = ['norte', 'leste'];
      for (let i = 0; i < recebidas.length; i++) {
        const rec = recebidas[i]!;
        const borda = vagas[i]!;
        const celulaAlvo = borda === 'norte' ? { linha: 2, coluna: 3 } : { linha: 3, coluna: 4 };
        enviar(ws, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId: 'jogador-1', recebidaId: rec.recebidaId as string, borda });
        const escolhida = await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');
        const alvo = escolhida.celulaAlvo as unknown as { linha: number; coluna: number };
        assert.equal(alvo.linha, celulaAlvo.linha);

        // Encaixe conectado (issue #311): Especiais têm as 4 bordas abertas —
        // r=0 e nenhum GIRAR_PECA é emitido; o loop preserva o padrão.
        const giros = girosParaConectar(rec.tipoDaPeca as string, borda);
        for (let giro = 0; giro < giros; giro++) {
          enviar(ws, { type: 'GIRAR_PECA', jogadorId: 'jogador-1', pecaId: rec.pecaId as string, sentido: 'horario' });
          await esperarEvento(ws, 'PECA_GIRADA');
        }

        enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: rec.pecaId as string, celula: celulaAlvo });
        const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
        assert.equal(posicionada.pecaId, rec.pecaId);
        assert.deepEqual(posicionada.celula, celulaAlvo);
      }
      const estadoFinal = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoFinal !== null);
      assert.ok(estadoFinal!.tabuleiro.posicionadas.some((p) => p.pecaId === 'gerador-2'));
      assert.ok(estadoFinal!.tabuleiro.posicionadas.some((p) => p.pecaId === 'sala-medica-1'));
    } finally {
      ws.close();
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// Sem janela de manipulação: após posicionar especial, GIRAR_PECA rejeita e
// pecaEmManipulacaoId permanece null.

test('peças especiais não abrem janela de manipulação: girar rejeita MANIPULACAO_ENCERRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const base = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(base.sucesso, true);
    if (!base.sucesso) throw new Error('inacessível');
    let estado = base.estado;
    const caixaControlada = [
      { pecaId: 'gerador-1', tipo: 'gerador' as const, orientacao: 0 as const },
      ...estado.tabuleiro.caixa.filter((p) => p.pecaId !== 'gerador-1'),
    ];
    for (const cmd of [
      { tipo: 'selecionar_peca', pecaId: 'inicial-1' },
      { tipo: 'posicionar_peca', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
    ] as const) {
      const r = aplicarComandoDePartida(estado, cmd, 'jogador-1');
      assert.equal(r.sucesso, true);
      if (!r.sucesso) throw new Error('inacessível');
      estado = r.estado;
    }
    estado = { ...estado, tabuleiro: { ...estado.tabuleiro, caixa: caixaControlada } };
    // Força apenas 1 vaga ocupável bloqueando leste com peça fictícia já posicionada
    estado = {
      ...estado,
      tabuleiro: {
        ...estado.tabuleiro,
        posicionadas: [...estado.tabuleiro.posicionadas, { pecaId: 'bloqueio-leste', tipo: 'reta', orientacao: 0, celula: { linha: 3, coluna: 4 } }],
      },
    };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estado);

    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    try {
      const recebimentoP = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const recebimento = await recebimentoP;
      const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
      assert.equal(recebidas.length, 1);
      const rec = recebidas[0]!;
      assert.equal(rec.pecaId, 'gerador-1');
      enviar(ws, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId: 'jogador-1', recebidaId: rec.recebidaId as string, borda: 'norte' });
      await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');
      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: rec.pecaId as string, celula: { linha: 2, coluna: 3 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      const estadoApos = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoApos !== null);
      assert.equal(estadoApos!.tabuleiro.pecaEmManipulacaoId, null, 'especial não deve abrir janela de manipulação');

      enviar(ws, { type: 'GIRAR_PECA', jogadorId: 'jogador-1', pecaId: 'gerador-1', sentido: 'horario' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'MANIPULACAO_ENCERRADA');

      const estadoAposGiro = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.equal(estadoAposGiro!.tabuleiro.pecaEmManipulacaoId, null);
    } finally {
      ws.close();
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

// Portão aceita até 4 peões: 4 no mesmo portão OK; 2 em peça comum falha com PECA_JA_TEM_PEAO.

test('portão de saída aceita até 4 peões e peça comum rejeita segundo peão', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    // Estado sintético: portão em (3,3), 4 peças vizinhas conectadas, cada uma com um peão.
    // Peça comum (reta) em (0,0) já com um peão, vizinha em (0,1) com segundo peão que tenta mover para reta.
    const base = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
    assert.equal(base.sucesso, true);
    if (!base.sucesso) throw new Error('inacessível');
    let estado = base.estado;

    // Monta posicionadas: portão central + 4 vizinhas ortogonais (todas cruz para garantir conexão)
    const portao = { pecaId: 'portao-de-saida-1', tipo: 'portao_de_saida' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 3 } };
    const vizinhas = [
      { pecaId: 'cruz-1', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 2, coluna: 3 } }, // norte
      { pecaId: 'cruz-2', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 4 } }, // leste
      { pecaId: 'cruz-3', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 4, coluna: 3 } }, // sul
      { pecaId: 'cruz-4', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 2 } }, // oeste
    ];
    // Peça comum para teste de ocupação (reta norte-sul em (0,0) + vizinha cruz em (1,0) para movimento)
    const retaComum = { pecaId: 'reta-1', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 0 } };
    const vizinhaReta = { pecaId: 'cruz-5', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 1, coluna: 0 } };

    estado = {
      ...estado,
      tabuleiro: {
        ...estado.tabuleiro,
        posicionadas: [portao, ...vizinhas, retaComum, vizinhaReta, { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 6 } }],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', pecaId: 'cruz-1' },
          { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'cruz-2' },
          { peaoId: 'peao-azul', cor: 'azul', pecaId: 'cruz-3' },
          { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'cruz-4' },
        ],
        peaoSelecionadoId: null,
        recebidas: [],
        pecaEmManipulacaoId: null,
        pecaSelecionadaId: null,
      },
      jogadorAtivoId: 'jogador-1',
      rodada: 2,
      pecaDoInicioDoTurnoId: 'cruz-1',
      posicaoConfirmada: false,
      // Rodada 2 pressupõe Primeiros Turnos concluídos (o engine bloqueia
      // MOVER_PEAO com primeiroTurnoPendente — MOVIMENTO_INDISPONIVEL).
      jogadores: estado.jogadores.map((j) => ({ ...j, primeiroTurnoPendente: false })),
    };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estado);

    // Conecta jogador-1 e move peões sequencialmente para o portão (precisa selecionar antes de mover)
    const ws1 = await conectarPartida(servidor, aceite.partidaId, 1);
    try {
      // Move branco -> portão
      enviar(ws1, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws1, 'PEAO_SELECIONADO');
      enviar(ws1, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      const m1 = await esperarEvento(ws1, 'PEAO_MOVIDO');
      assert.equal(m1.peaoId, 'peao-branco');
      assert.equal(m1.pecaIdPara, 'portao-de-saida-1');
    } finally {
      ws1.close();
    }

    // Para mover os demais, precisa alternar jogador ativo via estado sintético (simplifica: atualiza estado para próximo jogador)
    for (const [idx, jogador] of [2, 3, 4].entries()) {
      const peaoId = `peao-${PEAO_PELA_ORDEM[jogador - 1]}`;
      let cur = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(cur !== null);
      cur = {
        ...cur!,
        jogadorAtivoId: `jogador-${jogador}`,
        pecaDoInicioDoTurnoId: cur!.tabuleiro.peoes.find((p) => p.peaoId === peaoId)?.pecaId ?? null,
        posicaoConfirmada: false,
        tabuleiro: { ...cur!.tabuleiro, peaoSelecionadoId: null },
      };
      await salvarEstadoDaPartida(redis, aceite.partidaId, cur);
      const ws = await conectarPartida(servidor, aceite.partidaId, jogador);
      try {
        enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: `jogador-${jogador}`, peaoId });
        await esperarEvento(ws, 'PEAO_SELECIONADO');
        enviar(ws, { type: 'MOVER_PEAO', jogadorId: `jogador-${jogador}`, peaoId, celula: { linha: 3, coluna: 3 } });
        const mv = await esperarEvento(ws, 'PEAO_MOVIDO');
        assert.equal(mv.peaoId, peaoId);
        assert.equal(mv.pecaIdPara, 'portao-de-saida-1');
      } finally {
        ws.close();
      }
    }

    const estadoPortao = await obterEstadoDaPartida(redis, aceite.partidaId);
    assert.ok(estadoPortao !== null);
    const noPortao = estadoPortao!.tabuleiro.peoes.filter((p) => p.pecaId === 'portao-de-saida-1');
    assert.equal(noPortao.length, 4, 'portão deve conter 4 peões');

    // Agora testa peça comum: reta-1 já com um peão, segundo tenta mover para ela → PECA_JA_TEM_PEAO
    let estadoComum = await obterEstadoDaPartida(redis, aceite.partidaId);
    assert.ok(estadoComum !== null);
    // Recoloca peões para teste de ocupação: branco em (0,0) e vermelho em (1,0)
    estadoComum = {
      ...estadoComum!,
      tabuleiro: {
        ...estadoComum!.tabuleiro,
        posicionadas: [retaComum, vizinhaReta],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-1' },
          { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'cruz-5' },
          { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
          { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
        ],
        peaoSelecionadoId: null,
      },
      jogadorAtivoId: 'jogador-2',
      pecaDoInicioDoTurnoId: 'cruz-5',
    };
    await salvarEstadoDaPartida(redis, aceite.partidaId, estadoComum);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);
    try {
      enviar(ws2, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      await esperarEvento(ws2, 'PEAO_SELECIONADO');
      enviar(ws2, { type: 'MOVER_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 0, coluna: 0 } });
      const erro = await esperarEvento(ws2, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'PECA_JA_TEM_PEAO');
    } finally {
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
