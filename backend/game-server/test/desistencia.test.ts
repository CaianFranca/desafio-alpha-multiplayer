// Efeito atômico da desistência no servidor, com aviso e Retorno (issue #288).
//
// Comportamento externo observável via `PartidaHandlers` + Redis em memória
// (stub do subconjunto usado pelo canal: get/set/ttl/eval) + `PartidaBroadcaster`
// real com sockets falsos — sem WS/HTTP, sem Redis real:
//
// - Guarda/mapeamento wire de DESISTIR_DA_PARTIDA e código JOGADOR_NAO_NA_PARTIDA
// - Tradução de desistencia_registrada (+ derrota por desistencia) e ordem do lote
// - Fora do turno: remove peão e vez, preserva Ativo/rodada, avisa os restantes
// - No próprio turno: Passagem imediata destrava (o seguinte assume, sem travar)
// - 4→3 e 3→2 continuam (sem término) e vencem com N−1
// - 2→1 declara derrota por desistência + callback de Retorno uma única vez
// - Limpeza só-do-ausente (remove só peças fora da iluminação dos restantes)
// - Lote integral aos restantes (ordem do engine: desistência abre o lote)
// - Recusas: não-membro, desistente que tenta de novo e comando pós-término
// - Ator = sessão (#155): o `jogadorId` do wire é vestigial
// - Queda sem desistência continua voltável (snapshot + turno atual, sem expiração)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import {
  calcularIluminacao,
  estadoInicialDaPartida,
  type EstadoDaPartida,
} from '@flicker/engine';
import type { MembroDaSala } from '@flicker/shared';
import type { AvisoDeRetorno, AvisoDeDesistencia } from '../src/retorno/cliente.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import {
  chaveDaPartida,
  chaveDoEstadoDaPartida,
  chaveDoRetornoPendente,
  obterEstadoDaPartida,
} from '../src/partidas/estado.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { paraSnapshotWire } from '../src/partidas/snapshot.ts';
import {
  ehComandoDaPartida,
  mapearComandoDaPartida,
  paraCodigoDaPartidaWire,
} from '../src/partidas/wire.ts';
import { traduzirEventos } from '../src/partidas/traducao.ts';

// ─── Redis em memória (subconjunto do canal de Partida) ───

class RedisEmMemoria {
  private readonly dados = new Map<string, string>();
  /** Contador de `eval` (só a retenção do término usa `eval` no canal). */
  chamadasEval = 0;

  async get(chave: string): Promise<string | null> {
    return this.dados.get(chave) ?? null;
  }

  async set(chave: string, valor: string, ..._resto: unknown[]): Promise<'OK'> {
    this.dados.set(chave, valor);
    return 'OK';
  }

  async ttl(_chave: string): Promise<number> {
    // Sem expiração: o estado é repersistido sem TTL (partida em_andamento).
    return -1;
  }

  async del(...chaves: string[]): Promise<number> {
    let removidas = 0;
    for (const chave of chaves) {
      if (this.dados.delete(chave)) removidas += 1;
    }
    return removidas;
  }

  async eval(_script: string, _nChaves: number, ...args: unknown[]): Promise<number> {
    // Retenção do término: as duas chaves existem no stub em todos os cenários
    // de derrota por desistência — aplica como o Lua (retorna 1).
    this.chamadasEval += 1;
    const ttl = args[args.length - 1];
    const chaves = args.slice(0, -1) as string[];
    assert.ok(typeof ttl === 'number' && ttl > 0, 'retenção exige TTL positivo');
    for (const chave of chaves) {
      assert.ok(this.dados.has(chave), `retenção com chave ausente: ${chave}`);
    }
    return 1;
  }

  comoRedis(): Redis {
    return this as unknown as Redis;
  }
}

// ─── Sockets falsos (capturam o que o broadcaster entrega) ───

interface SocketFalso {
  readonly mensagens: Array<Record<string, unknown>>;
  comoWebSocket(): WebSocket;
}

function criarSocketFalso(): SocketFalso {
  const mensagens: Array<Record<string, unknown>> = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(payload: string): void {
      mensagens.push(JSON.parse(payload) as Record<string, unknown>);
    },
  };
  return {
    mensagens,
    comoWebSocket: () => socket as unknown as WebSocket,
  };
}

function tiposRecebidos(socket: SocketFalso): string[] {
  return socket.mensagens.map((mensagem) => mensagem.type as string);
}

// ─── Montagem de partida ───

function membro(n: number): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
  };
}

interface PartidaMontada {
  readonly partidaId: string;
  readonly redis: RedisEmMemoria;
  readonly broadcaster: PartidaBroadcaster;
  readonly handlers: PartidaHandlers;
  readonly avisos: AvisoDeRetorno[];
  readonly desistencias: AvisoDeDesistencia[];
  readonly sockets: Map<string, SocketFalso>;
}

async function montarPartida(jogadores: readonly string[]): Promise<PartidaMontada> {
  const partidaId = `partida-desistencia-${crypto.randomUUID()}`;
  const redis = new RedisEmMemoria();
  const broadcaster = new PartidaBroadcaster();
  const avisos: AvisoDeRetorno[] = [];
  const desistencias: AvisoDeDesistencia[] = [];
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    notificarDesistencia: async (aviso) => {
      desistencias.push(aviso);
    },
  });

  const inicial = estadoInicialDaPartida(jogadores);
  assert.equal(inicial.sucesso, true, 'estado inicial do engine deve nascer');
  if (!inicial.sucesso) throw new Error('inacessível');
  await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(inicial.estado));

  const numeros = jogadores.map((id) => Number(id.replace('jogador-', '')));
  const roster = numeros.map((n) => membro(n));
  await redis.set(
    chaveDaPartida(partidaId),
    JSON.stringify({
      partidaId,
      serverId: 'game-server-teste-desistencia',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster,
      estado: 'em_andamento',
      criadaEm: new Date().toISOString(),
    }),
  );

  const sockets = new Map<string, SocketFalso>();
  for (const jogadorId of jogadores) {
    const falso = criarSocketFalso();
    sockets.set(jogadorId, falso);
    broadcaster.registrar(partidaId, falso.comoWebSocket());
  }
  return { partidaId, redis, broadcaster, handlers, avisos, desistencias, sockets };
}

async function lerEstado(montada: PartidaMontada): Promise<EstadoDaPartida> {
  const estado = await obterEstadoDaPartida(montada.redis.comoRedis(), montada.partidaId);
  assert.ok(estado !== null, 'estado deve existir no Redis');
  return estado;
}

function desistir(jogadorId: string): Record<string, unknown> {
  return { type: 'DESISTIR_DA_PARTIDA', jogadorId };
}

// ─── Guarda / mapeamento / códigos ───

test('guarda aceita DESISTIR_DA_PARTIDA só com jogadorId', () => {
  assert.equal(ehComandoDaPartida({ type: 'DESISTIR_DA_PARTIDA', jogadorId: 'j1' }), true);
  assert.equal(ehComandoDaPartida({ type: 'DESISTIR_DA_PARTIDA' }), false);
  assert.equal(ehComandoDaPartida({ type: 'DESISTIR_DA_PARTIDA', jogadorId: '' }), false);
  assert.equal(ehComandoDaPartida({ type: 'DESISTIR_DA_PARTIDAA', jogadorId: 'j1' }), false);
});

test('mapeamento converte DESISTIR_DA_PARTIDA para desistir_da_partida', () => {
  assert.deepEqual(
    mapearComandoDaPartida({ type: 'DESISTIR_DA_PARTIDA', jogadorId: 'j1' }),
    { tipo: 'desistir_da_partida' },
  );
});

test('JOGADOR_NAO_NA_PARTIDA pertence ao contrato wire; fora dele vira DADOS_INVALIDOS', () => {
  assert.equal(paraCodigoDaPartidaWire('JOGADOR_NAO_NA_PARTIDA'), 'JOGADOR_NAO_NA_PARTIDA');
  assert.equal(paraCodigoDaPartidaWire('PARTIDA_TERMINADA'), 'PARTIDA_TERMINADA');
  assert.equal(
    paraCodigoDaPartidaWire('CODIGO_INEXISTENTE' as never),
    'DADOS_INVALIDOS',
  );
});

// ─── Tradução ───

test('tradução de desistencia_registrada é 1:1 e abre o lote', () => {
  const saida = traduzirEventos([
    { tipo: 'desistencia_registrada', jogadorId: 'jogador-4', peaoId: 'peao-amarelo' },
    { tipo: 'celulas_iluminadas', celulas: [] },
    { tipo: 'turno_iniciado', jogadorId: 'jogador-1', rodada: 1 },
  ]);
  assert.deepEqual(saida, [
    { type: 'DESISTENCIA_REGISTRADA', jogadorId: 'jogador-4', peaoId: 'peao-amarelo' },
    { type: 'CELULAS_ILUMINADAS', celulas: [] },
    { type: 'TURNO_INICIADO', jogadorId: 'jogador-1', rodada: 1 },
  ]);
});

test('tradução da derrota por desistencia projeta o motivo no wire', () => {
  const saida = traduzirEventos([
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'desistencia' } },
  ]);
  assert.deepEqual(saida, [
    { type: 'PARTIDA_TERMINADA', resultado: 'derrota', motivo: 'desistencia' },
  ]);
});

// ─── Fora do turno: remove peão e vez, preserva Ativo, avisa ───

test('desistência fora do turno remove peão e vez sem trocar o Ativo', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, handlers, sockets } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-4')!.comoWebSocket(),
    partidaId,
    'jogador-4',
    desistir('jogador-4'),
  );

  const estado = await lerEstado(montada);
  assert.deepEqual(
    estado.jogadores.map((j) => j.jogadorId),
    ['jogador-1', 'jogador-2', 'jogador-3'],
  );
  assert.equal(estado.jogadorAtivoId, 'jogador-1');
  assert.equal(estado.rodada, 1);
  assert.ok(
    estado.tabuleiro.peoes.every((peao) => peao.peaoId !== 'peao-amarelo'),
    'peão do desistente sai do tabuleiro',
  );
  assert.equal(estado.resultado, null);

  // Aviso aos restantes: o lote abre com a desistência e não troca o turno.
  for (const jogadorId of ['jogador-1', 'jogador-2', 'jogador-3']) {
    const tipos = tiposRecebidos(sockets.get(jogadorId)!);
    assert.equal(tipos[0], 'DESISTENCIA_REGISTRADA', `${jogadorId} é avisado primeiro da saída`);
    assert.ok(!tipos.includes('TURNO_INICIADO'), 'sem Passagem fora do turno');
    assert.ok(!tipos.includes('PARTIDA_TERMINADA'), '4→3 continua');
  }
  assert.deepEqual(sockets.get('jogador-1')!.mensagens[0], {
    type: 'DESISTENCIA_REGISTRADA',
    jogadorId: 'jogador-4',
    peaoId: 'peao-amarelo',
    // Causa explícita (#295): o ato explícito sempre viaja com a causa.
    causa: 'desistencia',
  });

  // Snapshot pós-remoção consistente (N−1, com apelidos do roster).
  const snapshot = paraSnapshotWire(
    estado,
    [membro(1), membro(2), membro(3), membro(4)],
    'em_andamento',
  );
  assert.equal(snapshot.jogadores.length, 3);
  assert.deepEqual(
    snapshot.jogadores.map((j) => `${j.jogadorId}/${j.apelido}`),
    ['jogador-1/Jogador 1', 'jogador-2/Jogador 2', 'jogador-3/Jogador 3'],
  );
  assert.equal(snapshot.jogadorAtivoId, 'jogador-1');
  assert.equal(snapshot.estado, 'em_andamento');
});

// ─── Desvinculação imediata no lobby (issue #290) ───

test('desistência parcial avisa o lobby para desvincular só o desistente, sem Retorno', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, handlers, sockets, avisos, desistencias } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-4')!.comoWebSocket(),
    partidaId,
    'jogador-4',
    desistir('jogador-4'),
  );
  await handlers.drenarRetornosPendentes();

  assert.deepEqual(desistencias, [
    {
      salaId: 'sala-1',
      partidaId,
      serverId: 'game-server-teste-desistencia',
      jogadorId: 'jogador-4',
      // Causa informativa do parcial (#295): ato explícito.
      causa: 'desistencia',
    },
  ]);
  assert.equal(avisos.length, 0, '4→3 continua: sem callback de Retorno');
});

// ─── No próprio turno: Passagem imediata destrava ───

test('desistência no próprio turno passa a vez ao seguinte sem travar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, handlers, sockets } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-1')!.comoWebSocket(),
    partidaId,
    'jogador-1',
    desistir('jogador-1'),
  );

  const estado = await lerEstado(montada);
  assert.equal(estado.jogadorAtivoId, 'jogador-2');
  assert.equal(estado.rodada, 1);
  assert.ok(
    estado.jogadores.every((j) => j.jogadorId !== 'jogador-1'),
    'desistente sai do roster',
  );

  const tipos = tiposRecebidos(sockets.get('jogador-2')!);
  assert.deepEqual(tipos.slice(0, 3), [
    'DESISTENCIA_REGISTRADA',
    'TURNO_ENCERRADO',
    'TURNO_INICIADO',
  ]);
  assert.deepEqual(sockets.get('jogador-2')!.mensagens[2], {
    type: 'TURNO_INICIADO',
    jogadorId: 'jogador-2',
    rodada: 1,
  });

  // A vez é mesmo do seguinte: fora-da-vez para o terceiro prova o destrave.
  await handlers.aplicarMensagem(
    sockets.get('jogador-3')!.comoWebSocket(),
    partidaId,
    'jogador-3',
    { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-3' },
  );
  const erros = sockets
    .get('jogador-3')!
    .mensagens.filter((m) => m.type === 'ERRO_DO_TABULEIRO');
  assert.equal(erros.length, 1);
  assert.equal(erros[0]!.codigo, 'FORA_DA_VEZ');
});

// ─── 3→2 continua; 4→3 vence com N−1 ───

test('3→2 continua sem término', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  const { partidaId, handlers, sockets } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-3')!.comoWebSocket(),
    partidaId,
    'jogador-3',
    desistir('jogador-3'),
  );

  const estado = await lerEstado(montada);
  assert.equal(estado.jogadores.length, 2);
  assert.equal(estado.resultado, null);
  const tipos = tiposRecebidos(sockets.get('jogador-1')!);
  assert.ok(tipos.includes('DESISTENCIA_REGISTRADA'));
  assert.ok(!tipos.includes('PARTIDA_TERMINADA'), '3→2 continua');
});

test('4→3 continua e vence com N−1', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, handlers, sockets, redis } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-4')!.comoWebSocket(),
    partidaId,
    'jogador-4',
    desistir('jogador-4'),
  );

  // Semeia o estado pronto para vitória com os N−1 restantes sobre o Portão.
  const estado = await lerEstado(montada);
  const portao = {
    pecaId: 'portao-de-teste',
    tipo: 'portao_de_saida' as const,
    orientacao: 0 as const,
    celula: { linha: 3, coluna: 3 },
  };
  await redis.set(
    chaveDoEstadoDaPartida(partidaId),
    JSON.stringify({
      ...estado,
      tabuleiro: {
        ...estado.tabuleiro,
        posicionadas: [portao],
        peoes: estado.tabuleiro.peoes.map((peao) => ({ ...peao, pecaId: portao.pecaId })),
      },
      geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
      cartaoDeAcessoObtido: true,
    }),
  );

  for (const socket of sockets.values()) socket.mensagens.length = 0;
  await handlers.aplicarMensagem(
    sockets.get('jogador-1')!.comoWebSocket(),
    partidaId,
    'jogador-1',
    { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' },
  );

  // O quórum N−1 não impede a vitória: todos os restantes recebem o término.
  for (const jogadorId of ['jogador-1', 'jogador-2', 'jogador-3']) {
    const eventos = sockets.get(jogadorId)!.mensagens;
    const ultimo = eventos[eventos.length - 1]!;
    assert.deepEqual(ultimo, { type: 'PARTIDA_TERMINADA', resultado: 'vitoria' });
  }
});

// ─── 2→1: derrota por desistência + Retorno uma vez ───

test('2→1 declara derrota por desistência e dispara o Retorno uma única vez', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, handlers, sockets, avisos, desistencias } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-2')!.comoWebSocket(),
    partidaId,
    'jogador-2',
    desistir('jogador-2'),
  );

  const estado = await lerEstado(montada);
  assert.equal(estado.jogadores.length, 1);
  assert.deepEqual(
    estado.jogadores.map((j) => j.jogadorId),
    ['jogador-1'],
    'participação na partida é N−1 (engine remove o desistente)',
  );
  assert.deepEqual(estado.resultado, { tipo: 'derrota', motivo: 'desistencia' });

  // A derrota por desistência é o último evento do lote, após o aviso.
  const tipos = tiposRecebidos(sockets.get('jogador-1')!);
  assert.equal(tipos[0], 'DESISTENCIA_REGISTRADA');
  assert.deepEqual(sockets.get('jogador-1')!.mensagens[tipos.length - 1], {
    type: 'PARTIDA_TERMINADA',
    resultado: 'derrota',
    motivo: 'desistencia',
  });

  // N−1 no aviso (issue #290, resolve o follow-up #371): o lobby desvincula
  // cada desistente no callback de desistência e revalida
  // `jogadores == membros ativos`, então o retorno carrega os restantes.
  // O detach do desistente acontece ANTES do retorno (ordem garantida).
  assert.deepEqual(desistencias, [
    {
      salaId: 'sala-1',
      partidaId,
      serverId: 'game-server-teste-desistencia',
      jogadorId: 'jogador-2',
      // Causa informativa do detach pré-retorno (#295): ato explícito.
      causa: 'desistencia',
    },
  ]);
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0], {
    salaId: 'sala-1',
    partidaId,
    serverId: 'game-server-teste-desistencia',
    resultado: 'derrota',
    jogadores: ['jogador-1'],
    // B2: o término com desistência marca o aviso para que o 409 transitório
    // do lobby (detach ainda em voo) retente em vez de encerrar definitivo.
    teveDesistencia: true,
  });

  // Comando pós-término é recusado e não duplica o callback.
  await handlers.aplicarMensagem(
    sockets.get('jogador-1')!.comoWebSocket(),
    partidaId,
    'jogador-1',
    { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' },
  );
  const erros = sockets
    .get('jogador-1')!
    .mensagens.filter((m) => m.type === 'ERRO_DO_TABULEIRO');
  assert.equal(erros.length, 1);
  assert.equal(erros[0]!.codigo, 'PARTIDA_TERMINADA');
  await handlers.drenarRetornosPendentes();
  assert.equal(avisos.length, 1, 'callback de Retorno sai uma única vez');
});

// ─── Limpeza só-do-ausente ───

test('desistência recalcula a Iluminação e limpa só as peças do ausente', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, handlers, sockets, redis } = montada;

  // Peças sob os restantes + peças só iluminadas pelo ausente (jogador-4 em (0,0)).
  const posicionadas = [
    { pecaId: 'p-a', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 3 } },
    { pecaId: 'p-b', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 5, coluna: 3 } },
    { pecaId: 'p-d', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 5 } },
    { pecaId: 'p-c', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 0 } },
    { pecaId: 'p-extra', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 1 } },
  ];
  const base = await lerEstado(montada);
  const tabuleiro = {
    ...base.tabuleiro,
    posicionadas,
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco' as const, pecaId: 'p-a' },
      { peaoId: 'peao-vermelho', cor: 'vermelho' as const, pecaId: 'p-b' },
      { peaoId: 'peao-azul', cor: 'azul' as const, pecaId: 'p-d' },
      { peaoId: 'peao-amarelo', cor: 'amarelo' as const, pecaId: 'p-c' },
    ],
  };
  await redis.set(
    chaveDoEstadoDaPartida(partidaId),
    JSON.stringify({
      ...base,
      tabuleiro,
      celulasIluminadas: calcularIluminacao(tabuleiro),
    }),
  );

  await handlers.aplicarMensagem(
    sockets.get('jogador-4')!.comoWebSocket(),
    partidaId,
    'jogador-4',
    desistir('jogador-4'),
  );

  const estado = await lerEstado(montada);
  const restantes = estado.tabuleiro.posicionadas.map((peca) => peca.pecaId);
  assert.ok(!restantes.includes('p-c'), 'peça do ausente sai');
  assert.ok(!restantes.includes('p-extra'), 'peça só iluminada pelo ausente sai');
  assert.deepEqual(restantes, ['p-a', 'p-b', 'p-d']);

  const mensagens = sockets.get('jogador-1')!.mensagens;
  const limpeza = mensagens.find((m) => m.type === 'LIMPEZA_APLICADA');
  assert.deepEqual(limpeza, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['p-c', 'p-extra'] });
  const iluminadas = mensagens.find((m) => m.type === 'CELULAS_ILUMINADAS') as
    | { celulas: Array<{ linha: number; coluna: number }> }
    | undefined;
  assert.ok(iluminadas !== undefined, 'tabuleiro novo viaja no lote');
  assert.ok(
    iluminadas.celulas.every((c) => !(c.linha === 0 && c.coluna <= 1)),
    'células do ausente apagam',
  );
});

// ─── Recusas: não-membro, desistente reincidente, ator = sessão ───

test('não-membro e desistente reincidente recebem JOGADOR_NAO_NA_PARTIDA', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  const { partidaId, handlers, sockets } = montada;

  const intruso = criarSocketFalso();
  await handlers.aplicarMensagem(
    intruso.comoWebSocket(),
    partidaId,
    'intruso',
    desistir('intruso'),
  );
  assert.deepEqual(intruso.mensagens, [
    {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'JOGADOR_NAO_NA_PARTIDA',
      mensagem: intruso.mensagens[0]!.mensagem,
    },
  ]);
  assert.ok(typeof intruso.mensagens[0]!.mensagem === 'string');

  // A recusa não altera o estado nem avisa ninguém.
  assert.equal((await lerEstado(montada)).jogadores.length, 3);
  assert.equal(sockets.get('jogador-1')!.mensagens.length, 0);

  await handlers.aplicarMensagem(
    sockets.get('jogador-3')!.comoWebSocket(),
    partidaId,
    'jogador-3',
    desistir('jogador-3'),
  );
  assert.equal((await lerEstado(montada)).jogadores.length, 2);

  // Desistente que tenta de novo é recusado pelo domínio.
  const antes = sockets.get('jogador-3')!.mensagens.length;
  await handlers.aplicarMensagem(
    sockets.get('jogador-3')!.comoWebSocket(),
    partidaId,
    'jogador-3',
    desistir('jogador-3'),
  );
  const depois = sockets.get('jogador-3')!.mensagens.slice(antes);
  assert.equal(depois.length, 1);
  assert.equal(depois[0]!.type, 'ERRO_DO_TABULEIRO');
  assert.equal(depois[0]!.codigo, 'JOGADOR_NAO_NA_PARTIDA');
});

test('ator é a sessão: jogadorId alheio no wire não desiste por outro', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  const { partidaId, handlers, sockets } = montada;

  await handlers.aplicarMensagem(
    sockets.get('jogador-1')!.comoWebSocket(),
    partidaId,
    'jogador-1',
    { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-2' },
  );

  const estado = await lerEstado(montada);
  assert.deepEqual(
    estado.jogadores.map((j) => j.jogadorId),
    ['jogador-2', 'jogador-3'],
    'quem sai é a sessão, não o jogadorId declarado',
  );
  assert.deepEqual(sockets.get('jogador-2')!.mensagens[0], {
    type: 'DESISTENCIA_REGISTRADA',
    jogadorId: 'jogador-1',
    peaoId: 'peao-branco',
    causa: 'desistencia',
  });
});

// ─── Presença: desistência anuncia a saída, queda silencia ───

test('presença: desistência anuncia a saída; queda não faz broadcast nenhum', async () => {
  // Desistência = anúncio de presença da saída definitiva: todos os
  // restantes recebem DESISTENCIA_REGISTRADA abrindo o lote, com snapshot
  // consistente em N−1.
  const comDesistencia = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  await comDesistencia.handlers.aplicarMensagem(
    comDesistencia.sockets.get('jogador-3')!.comoWebSocket(),
    comDesistencia.partidaId,
    'jogador-3',
    desistir('jogador-3'),
  );
  for (const jogadorId of ['jogador-1', 'jogador-2']) {
    const tipos = tiposRecebidos(comDesistencia.sockets.get(jogadorId)!);
    assert.ok(tipos.length > 0, `${jogadorId} recebe o lote`);
    assert.equal(tipos[0], 'DESISTENCIA_REGISTRADA', `${jogadorId} é avisado primeiro da saída`);
  }
  assert.deepEqual(
    (await lerEstado(comDesistencia)).jogadores.map((j) => j.jogadorId),
    ['jogador-1', 'jogador-2'],
  );

  // Queda = silêncio total no broadcast: nenhum comando, nenhuma mensagem
  // aos restantes. A presença do caído só muda via `marcarDesconexao` (camada
  // `ws.ts`, fora do `PartidaHandlers`) — sem evento wire novo de roster.
  const comQueda = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  for (const [jogadorId, socket] of comQueda.sockets) {
    assert.equal(socket.mensagens.length, 0, `queda não avisa ${jogadorId}`);
  }
  assert.equal((await lerEstado(comQueda)).jogadores.length, 3);
});

// ─── Ressalvas #290 (R1/R3/R5) ───

test('R1: detach travado não bloqueia o retorno (teto por desistente)', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis, broadcaster, sockets } = montada;
  const avisos: AvisoDeRetorno[] = [];
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    tetoDesvinculoMs: 50,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    // Lobby fora do ar: retry infinito que nunca resolve.
    notificarDesistencia: () => new Promise<void>(() => undefined),
  });

  // Guarda do loop: o detach nunca resolve e o teto usa timer `unref` — sem um
  // handle referenciado, o loop esvazia e o runner cancela o teste (e os
  // seguintes em cascata). Não muda a semântica: só mantém o processo vivo.
  const guardaDoLoop = setTimeout(() => {}, 5000);
  const inicio = Date.now();
  await handlers.aplicarMensagem(
    sockets.get('jogador-2')!.comoWebSocket(),
    partidaId,
    'jogador-2',
    desistir('jogador-2'),
  );
  const duracao = Date.now() - inicio;

  assert.ok(duracao < 2000, `teto estourou a cadeia: ${duracao}ms`);
  assert.equal(avisos.length, 1, 'retorno sai mesmo com detach travado');
  assert.deepEqual(avisos[0]!.jogadores, ['jogador-1'], 'N−1 em memória, sem depender do detach');
  await handlers.drenarRetornosPendentes(100);
  clearTimeout(guardaDoLoop);
});

test('R3: aviso usa N−1 em memória; sem memória e sem estado não inventa N', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis } = montada;
  const bruto = await redis.get(chaveDaPartida(partidaId));
  assert.ok(bruto !== null);
  const partida = JSON.parse(bruto!) as import('../src/partidas/partidas.ts').PartidaPreparada;
  const qualquer = montada.handlers as unknown as {
    montarAviso(
      partida: import('../src/partidas/partidas.ts').PartidaPreparada,
      resultado: 'vitoria' | 'derrota',
      emMemoria: readonly string[] | null,
      teveDesistencia: boolean,
    ): Promise<AvisoDeRetorno | null>;
  };

  // Caminho normal: N−1 em memória, sem tocar o Redis.
  const comMemoria = await qualquer.montarAviso(partida, 'derrota', ['jogador-1'], true);
  assert.deepEqual(comMemoria!.jogadores, ['jogador-1']);

  // Sem memória, sem estado no Redis e com desistência: null (não inventa N).
  const redisVazio = {
    get: async () => null,
    set: async () => 'OK' as const,
    ttl: async () => -1,
    eval: async () => 1,
  } as unknown as Redis;
  const handlersVazio = new PartidaHandlers({
    redis: redisVazio,
    broadcaster: montada.broadcaster,
  });
  const semEstado = (handlersVazio as unknown as typeof qualquer).montarAviso(partida, 'derrota', null, true);
  assert.equal(await semEstado, null);

  // Sem desistência: fallback ao roster preservado (não-início).
  const semDesistencia = await (handlersVazio as unknown as typeof qualquer).montarAviso(partida, 'derrota', null, false);
  assert.deepEqual(semDesistencia!.jogadores, ['jogador-1', 'jogador-2']);
});

test('R5: drain enxerga o detach parcial em voo (placeholder)', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  const { partidaId, redis, broadcaster, sockets } = montada;
  const desistencias: AvisoDeDesistencia[] = [];
  let liberar!: () => void;
  const porta = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarDesistencia: async (aviso) => {
      await porta;
      desistencias.push(aviso);
    },
  });

  const aplicacao = handlers.aplicarMensagem(
    sockets.get('jogador-4')!.comoWebSocket(),
    partidaId,
    'jogador-4',
    desistir('jogador-4'),
  );
  // Dá um giro para a mutação registrar o placeholder antes do drain.
  await new Promise((r) => setTimeout(r, 20));
  let drenou = false;
  const drenagem = handlers.drenarRetornosPendentes(2000).then(() => {
    drenou = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(drenou, false, 'drain espera o detach em voo');
  liberar();
  await drenagem;
  await aplicacao;
  assert.equal(drenou, true);
  assert.equal(desistencias.length, 1);
});

// ─── Queda sem desistência continua voltável ───

test('queda sem desistência volta com snapshot N e turno atual, sem expiração', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  const { partidaId, handlers, sockets, avisos, redis } = montada;

  // Queda = fechar a conexão sem desistir: nenhum comando, nenhum aviso.
  const caido = sockets.get('jogador-2')!;
  assert.equal((await lerEstado(montada)).jogadores.length, 3);
  assert.equal(sockets.get('jogador-1')!.mensagens.length, 0);

  // Reconexão: snapshot consistente com N jogadores + turno atual inalterado.
  const estado = await lerEstado(montada);
  const snapshot = paraSnapshotWire(estado, [membro(1), membro(2), membro(3)], 'em_andamento');
  assert.equal(snapshot.jogadores.length, 3);
  assert.equal(snapshot.jogadorAtivoId, 'jogador-1');
  assert.equal(snapshot.rodada, 1);
  assert.equal(snapshot.estado, 'em_andamento');

  // Sem expiração (observável): estado em_andamento repersistido sem TTL,
  // sem resultado, sem término, sem aviso e sem retenção — `anunciarTurnoAtual`
  // inalterado.
  assert.equal(await redis.ttl(chaveDoEstadoDaPartida(partidaId)), -1);
  assert.equal(estado.resultado, null);
  assert.equal(avisos.length, 0);
  assert.equal(redis.chamadasEval, 0, 'nenhum eval de retenção após queda');

  const retorno = criarSocketFalso();
  await handlers.anunciarTurnoAtual(partidaId, retorno.comoWebSocket());
  assert.deepEqual(retorno.mensagens[0], {
    type: 'TURNO_INICIADO',
    jogadorId: 'jogador-1',
    rodada: 1,
  });
  assert.ok(
    retorno.mensagens.every((m) => m.type !== 'PARTIDA_TERMINADA'),
    'queda não termina a partida',
  );
  assert.ok(caido !== undefined);
});

// ─── Item 4 (review PR #378): Retorno sem descarte ───

test('item 4: pendência persiste durante o envio e apaga após concluir', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis, broadcaster, sockets } = montada;
  const avisos: AvisoDeRetorno[] = [];
  let liberar!: () => void;
  const porta = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      await porta;
      avisos.push(aviso);
    },
    notificarDesistencia: async () => undefined,
  });

  const aplicacao = handlers.aplicarMensagem(
    sockets.get('jogador-2')!.comoWebSocket(),
    partidaId,
    'jogador-2',
    desistir('jogador-2'),
  );
  const chave = chaveDoRetornoPendente(partidaId);
  let vista: string | null = null;
  for (let i = 0; i < 200 && vista === null; i += 1) {
    vista = await redis.get(chave);
    if (vista === null) await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(vista !== null, 'pendência gravada antes do envio concluir');
  const corpo = JSON.parse(vista!) as { resultado: string; teveDesistencia: boolean };
  assert.equal(corpo.resultado, 'derrota');
  assert.equal(corpo.teveDesistencia, true);
  liberar();
  await aplicacao;
  await handlers.drenarRetornosPendentes(2000);
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0]!.jogadores, ['jogador-1']);
  assert.equal(await redis.get(chave), null, 'pendência apagada após concluir');
});

test('item 4: re-drive completa pendência de crash em comando pós-término', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis, broadcaster, sockets } = montada;
  // Envio que nunca conclui (simula crash no meio do envio): estado termina,
  // pendência fica gravada, nada é entregue.
  const lentos = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: () => new Promise<void>(() => undefined),
    notificarDesistencia: async () => undefined,
  });
  await lentos.aplicarMensagem(
    sockets.get('jogador-2')!.comoWebSocket(),
    partidaId,
    'jogador-2',
    desistir('jogador-2'),
  );
  assert.ok((await redis.get(chaveDoRetornoPendente(partidaId))) !== null);

  // Nova instância (pós-restart, guards vazios): comando pós-término é
  // recusado, mas o re-drive entrega o retorno pendente.
  const avisos: AvisoDeRetorno[] = [];
  const novos = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    notificarDesistencia: async () => undefined,
  });
  await novos.aplicarMensagem(
    sockets.get('jogador-1')!.comoWebSocket(),
    partidaId,
    'jogador-1',
    { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' },
  );
  await novos.drenarRetornosPendentes(2000);
  assert.equal(avisos.length, 1, 're-drive entregou o retorno pendente');
  assert.deepEqual(avisos[0], {
    salaId: 'sala-1',
    partidaId,
    serverId: 'game-server-teste-desistencia',
    resultado: 'derrota',
    jogadores: ['jogador-1'],
    teveDesistencia: true,
  });
  assert.equal(await redis.get(chaveDoRetornoPendente(partidaId)), null);
  const erros = sockets
    .get('jogador-1')!
    .mensagens.filter((m) => m.type === 'ERRO_DO_TABULEIRO');
  assert.equal(erros[erros.length - 1]!.codigo, 'PARTIDA_TERMINADA');
});

test('item 4: re-drive completa pendência em anunciarTurnoAtual (reconexão)', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis, broadcaster, sockets } = montada;
  const lentos = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: () => new Promise<void>(() => undefined),
    notificarDesistencia: async () => undefined,
  });
  await lentos.aplicarMensagem(
    sockets.get('jogador-2')!.comoWebSocket(),
    partidaId,
    'jogador-2',
    desistir('jogador-2'),
  );
  assert.ok((await redis.get(chaveDoRetornoPendente(partidaId))) !== null);

  const avisos: AvisoDeRetorno[] = [];
  const novos = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    notificarDesistencia: async () => undefined,
  });
  const retorno = criarSocketFalso();
  await novos.anunciarTurnoAtual(partidaId, retorno.comoWebSocket());
  await novos.drenarRetornosPendentes(2000);
  assert.equal(avisos.length, 1, 'reconexão completou o retorno pendente');
  assert.deepEqual(avisos[0]!.jogadores, ['jogador-1']);
  assert.equal(await redis.get(chaveDoRetornoPendente(partidaId)), null);
});

test('item 4: retry sem desistir converge quando metadados voltam', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  const { partidaId, redis, broadcaster } = montada;
  const avisos: AvisoDeRetorno[] = [];
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    notificarDesistencia: async () => undefined,
  });
  // Some com os metadados: o retry reagenda em vez de descartar.
  const bruto = await redis.get(chaveDaPartida(partidaId));
  assert.ok(bruto !== null);
  await redis.del(chaveDaPartida(partidaId));
  const interno = handlers as unknown as {
    reagendarRetornoSemN1(
      partidaId: string,
      resultado: 'vitoria' | 'derrota',
      emMemoria: readonly string[] | null,
      teveDesistencia: boolean,
      atrasoMs?: number,
    ): void;
  };
  interno.reagendarRetornoSemN1(partidaId, 'derrota', ['jogador-1'], true, 10);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(avisos.length, 0, 'sem metadados, nada enviado (mas sem descarte)');
  // Metadados de volta: a próxima tentativa entrega com N−1 em memória.
  await redis.set(chaveDaPartida(partidaId), bruto!);
  for (let i = 0; i < 200 && avisos.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0]!.jogadores, ['jogador-1']);
  assert.equal(await redis.get(chaveDoRetornoPendente(partidaId)), null);
});
