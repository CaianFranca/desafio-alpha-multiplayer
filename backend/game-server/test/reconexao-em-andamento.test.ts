// Janela de reconexão da Partida em andamento com conversão em desistência (issue #295).
//
// Comportamento externo via `PartidaHandlers` + módulo `reconexao-em-andamento`
// + Redis em memória (get/set/ttl/del/scan/eval/pipeline) + broadcaster real:
//
// - volta dentro sem perda (presença conectado + chave limpa + timer
//   cancelado; peão/vez/Sanidade intactos, estado bit a bit)
// - TTL autoritativo: fire precoce (ttl > 0) e janela sem EX (ttl -1) abortam
//   sem mutar; só a janela vencida (ttl 0/-2) converte
// - expiração converte igual a B com causa 'expiracao' (fora do turno e Ativo destrava)
// - lote da expiração com Iluminação/Limpeza como em B (só peças do ausente)
// - 3→2 por expiração com objetivos declara vitória N−1 no próprio lote
// - 2→1 por expiração declara derrota + retorno como em B
// - causa explícita distinguível (ausente = implícita; expiracao; desistencia)
// - preparada inalterada (verificação aborta sem mutar)
// - corrida admissão-vs-timer (readmitido aborta; idempotência dupla)

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
  obterEstadoDaPartida,
} from '../src/partidas/estado.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { traduzirEventos } from '../src/partidas/traducao.ts';
import {
  agendarExpiracaoDeReconexao,
  cancelarExpiracaoDeReconexao,
  chaveReconexaoEmAndamento,
  configurarReconexaoEmAndamento,
  definirConversorDeExpiracao,
  definirJanelaDeReconexao,
  limparJanelaDeReconexao,
  rearmarReconexaoEmAndamentoAposRestart,
  verificarExpiracaoSeNecessario,
} from '../src/partidas/reconexao-em-andamento.ts';

// ─── Redis em memória ───

class RedisEmMemoria {
  private readonly dados = new Map<string, string>();
  private readonly expiracao = new Map<string, number>();
  ultimoEx: number | null = null;

  async get(chave: string): Promise<string | null> {
    return this.dados.get(chave) ?? null;
  }

  async set(chave: string, valor: string, ...resto: unknown[]): Promise<'OK'> {
    this.dados.set(chave, valor);
    const idx = resto.indexOf('EX');
    if (idx >= 0) {
      const ex = Number(resto[idx + 1]);
      this.expiracao.set(chave, ex);
      this.ultimoEx = ex;
    }
    return 'OK';
  }

  async ttl(chave: string): Promise<number> {
    if (!this.dados.has(chave)) return -2;
    return this.expiracao.get(chave) ?? -1;
  }

  async del(...chaves: string[]): Promise<number> {
    let removidas = 0;
    for (const chave of chaves) {
      if (this.dados.delete(chave)) removidas += 1;
      this.expiracao.delete(chave);
    }
    return removidas;
  }

  async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
    void cursor;
    const idx = args.indexOf('MATCH');
    const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
    const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return ['0', [...this.dados.keys()].filter((k) => k.startsWith(prefixo))];
  }

  pipeline(): { ttl(chave: string): unknown; exec(): Promise<Array<[Error | null, unknown]>> } {
    const ttls: string[] = [];
    const self = this;
    return {
      ttl(chave: string): unknown {
        ttls.push(chave);
        return undefined;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        const out: Array<[Error | null, unknown]> = [];
        for (const chave of ttls) {
          out.push([null, await self.ttl(chave)]);
        }
        return out;
      },
    };
  }

  async eval(_script: string, _nChaves: number, ...args: unknown[]): Promise<number> {
    return 1;
  }

  tem(chave: string): boolean {
    return this.dados.has(chave);
  }

  comoRedis(): Redis {
    return this as unknown as Redis;
  }
}

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
  return { mensagens, comoWebSocket: () => socket as unknown as WebSocket };
}

function membro(n: number, presenca: 'conectado' | 'em_reconexao' = 'conectado'): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca,
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

async function montarPartida(
  jogadores: readonly string[],
  opcoes: { estado?: 'preparada' | 'em_andamento'; emReconexao?: readonly string[] } = {},
): Promise<PartidaMontada> {
  const partidaId = `partida-reconexao-${crypto.randomUUID()}`;
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
  configurarReconexaoEmAndamento(60);
  definirConversorDeExpiracao((pid, jid) => handlers.converterExpiracaoEmDesistencia(pid, jid));

  const inicial = estadoInicialDaPartida(jogadores);
  assert.equal(inicial.sucesso, true);
  if (!inicial.sucesso) throw new Error('inacessível');
  await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(inicial.estado));

  const numeros = jogadores.map((id) => Number(id.replace('jogador-', '')));
  const emReconexao = new Set(opcoes.emReconexao ?? []);
  const roster = numeros.map((n) =>
    membro(n, emReconexao.has(`jogador-${n}`) ? 'em_reconexao' : 'conectado'),
  );
  await redis.set(
    chaveDaPartida(partidaId),
    JSON.stringify({
      partidaId,
      serverId: 'game-server-teste-reconexao',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster,
      estado: opcoes.estado ?? 'em_andamento',
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
  assert.ok(estado !== null);
  return estado;
}

function limparWiring(): void {
  definirConversorDeExpiracao(undefined);
}

/**
 * Simula a janela vencida no fire real do timer: a janela existiu (EX
 * gravado) e o TTL venceu — a chave sumiu (ttl -2), então a verificação
 * prossegue para os guards de presença/engine. Janela viva (ttl > 0) é o
 * caso do fire precoce, coberto em teste próprio.
 */
async function simularJanelaVencida(montada: PartidaMontada, jogadorId: string): Promise<void> {
  await definirJanelaDeReconexao(montada.redis.comoRedis(), montada.partidaId, jogadorId);
  await montada.redis.del(chaveReconexaoEmAndamento(montada.partidaId, jogadorId));
}

// ─── Causa compatível ───

test('tradução 1:1 da causa: ausente vira wire sem causa; expiracao e desistencia viajam', () => {
  const saida = traduzirEventos([
    { tipo: 'desistencia_registrada', jogadorId: 'j1', peaoId: 'peao-vermelho' },
    { tipo: 'desistencia_registrada', jogadorId: 'j2', peaoId: 'peao-azul', causa: 'expiracao' },
    { tipo: 'desistencia_registrada', jogadorId: 'j3', peaoId: 'peao-branco', causa: 'desistencia' },
  ]);
  assert.deepEqual(saida, [
    { type: 'DESISTENCIA_REGISTRADA', jogadorId: 'j1', peaoId: 'peao-vermelho' },
    { type: 'DESISTENCIA_REGISTRADA', jogadorId: 'j2', peaoId: 'peao-azul', causa: 'expiracao' },
    { type: 'DESISTENCIA_REGISTRADA', jogadorId: 'j3', peaoId: 'peao-branco', causa: 'desistencia' },
  ]);
});

test('desistência explícita viaja com causa desistencia; expiração com expiracao', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-3')!.comoWebSocket(),
      montada.partidaId,
      'jogador-3',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-3' },
    );
    assert.deepEqual(montada.sockets.get('jogador-1')!.mensagens[0], {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-3',
      peaoId: 'peao-azul',
      // Causa explícita (#295): o servidor sempre envia no ato explícito.
      causa: 'desistencia',
    });
    await montada.handlers.drenarRetornosPendentes(2000);
    assert.deepEqual(montada.desistencias, [
      {
        salaId: 'sala-1',
        partidaId: montada.partidaId,
        serverId: 'game-server-teste-reconexao',
        jogadorId: 'jogador-3',
        causa: 'desistencia',
      },
    ]);
  } finally {
    limparWiring();
  }
});

// ─── Expiração converte igual a B ───

test('expiração fora do turno remove peão e vez com causa expiracao, sem trocar o Ativo', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4'], {
    emReconexao: ['jogador-4'],
  });
  try {
    await simularJanelaVencida(montada, 'jogador-4');
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-4',
    );
    assert.equal(converteu, true);
    const estado = await lerEstado(montada);
    assert.deepEqual(
      estado.jogadores.map((j) => j.jogadorId),
      ['jogador-1', 'jogador-2', 'jogador-3'],
    );
    assert.equal(estado.jogadorAtivoId, 'jogador-1');
    assert.ok(estado.tabuleiro.peoes.every((p) => p.peaoId !== 'peao-amarelo'));
    const primeira = montada.sockets.get('jogador-1')!.mensagens[0];
    assert.deepEqual(primeira, {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-4',
      peaoId: 'peao-amarelo',
      causa: 'expiracao',
    });
    assert.equal(montada.desistencias.length, 1);
    assert.equal(montada.desistencias[0].jogadorId, 'jogador-4');
    // Callback do parcial carrega a causa da conversão (#295).
    assert.equal(montada.desistencias[0].causa, 'expiracao');
    assert.equal(montada.redis.tem(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-4')), false);
  } finally {
    limparWiring();
  }
});

test('expiração do Ativo destrava com Passagem imediata', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-1'],
  });
  try {
    const converteu = await montada.handlers.converterExpiracaoEmDesistencia(
      montada.partidaId,
      'jogador-1',
    );
    assert.equal(converteu, true);
    const estado = await lerEstado(montada);
    assert.equal(estado.jogadorAtivoId, 'jogador-2');
    const tipos = montada.sockets.get('jogador-2')!.mensagens.map((m) => m.type);
    assert.equal(tipos[0], 'DESISTENCIA_REGISTRADA');
    assert.ok(tipos.includes('TURNO_INICIADO'));
    assert.deepEqual(montada.sockets.get('jogador-2')!.mensagens[0], {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      causa: 'expiracao',
    });
  } finally {
    limparWiring();
  }
});

test('2→1 por expiração declara derrota + retorno como em B', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2'], {
    emReconexao: ['jogador-2'],
  });
  try {
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-2',
    );
    assert.equal(converteu, true);
    const estado = await lerEstado(montada);
    assert.notEqual(estado.resultado, null);
    const tipos = montada.sockets.get('jogador-1')!.mensagens.map((m) => m.type);
    assert.ok(tipos.includes('PARTIDA_TERMINADA'));
    // Aguarda o detach/retorno em voo (fire-and-forget no parcial, await no término).
    await montada.handlers.drenarRetornosPendentes(2000);
    assert.equal(montada.avisos.length, 1);
    assert.equal(montada.avisos[0].resultado, 'derrota');
    assert.deepEqual(montada.avisos[0].jogadores, ['jogador-1']);
    // Detach pré-retorno carrega a causa da conversão (#295).
    assert.deepEqual(montada.desistencias, [
      {
        salaId: 'sala-1',
        partidaId: montada.partidaId,
        serverId: 'game-server-teste-reconexao',
        jogadorId: 'jogador-2',
        causa: 'expiracao',
      },
    ]);
  } finally {
    limparWiring();
  }
});

// ─── Volta dentro sem perda ───

test('volta dentro da janela: presença conectado + chave limpa + timer cancelado, sem perda', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    // Queda arma janela + timer (espelha ws.ts).
    await definirJanelaDeReconexao(montada.redis.comoRedis(), montada.partidaId, 'jogador-3');
    agendarExpiracaoDeReconexao(montada.partidaId, 'jogador-3', 60_000, montada.redis.comoRedis());
    const antes = await lerEstado(montada);
    const sanidadeAntes = antes.jogadores.map((j) => `${j.jogadorId}=${j.sanidade}`);

    // Re-admissão dentro da janela (espelha ws.ts): presença volta a
    // conectado, janela limpa e timer cancelado antes do fire.
    const bruto = await montada.redis.comoRedis().get(chaveDaPartida(montada.partidaId));
    assert.ok(bruto !== null);
    const partida = JSON.parse(bruto) as { roster: Array<{ jogadorId: string; presenca: string }> };
    for (const m of partida.roster) {
      if (m.jogadorId === 'jogador-3') m.presenca = 'conectado';
    }
    await montada.redis.set(chaveDaPartida(montada.partidaId), JSON.stringify({
      partidaId: montada.partidaId,
      serverId: 'game-server-teste-reconexao',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster: partida.roster,
      estado: 'em_andamento',
      criadaEm: new Date().toISOString(),
    }));
    cancelarExpiracaoDeReconexao(montada.partidaId, 'jogador-3');
    await limparJanelaDeReconexao(montada.redis.comoRedis(), montada.partidaId, 'jogador-3');

    // Mesmo que a verificação dispare atrasada, aborta sem mutar nada.
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-3',
    );
    assert.equal(converteu, false);
    const depois = await lerEstado(montada);
    assert.deepEqual(depois, antes);
    assert.deepEqual(
      depois.jogadores.map((j) => j.jogadorId),
      ['jogador-1', 'jogador-2', 'jogador-3'],
    );
    assert.ok(depois.tabuleiro.peoes.some((p) => p.peaoId === 'peao-azul'), 'peão de quem voltou intacto');
    assert.equal(depois.jogadorAtivoId, antes.jogadorAtivoId, 'vez intacta');
    assert.deepEqual(
      depois.jogadores.map((j) => `${j.jogadorId}=${j.sanidade}`),
      sanidadeAntes,
      'Sanidade intacta',
    );
    assert.equal(montada.redis.tem(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-3')), false);
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0);
  } finally {
    cancelarExpiracaoDeReconexao(montada.partidaId, 'jogador-3');
    limparWiring();
  }
});

test('corrida admissão-vs-timer: readmitido (conectado) aborta sem mutar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    // Simula a re-admissão vencendo a corrida: presença volta a conectado.
    const bruto = await montada.redis.comoRedis().get(chaveDaPartida(montada.partidaId));
    assert.ok(bruto !== null);
    const partida = JSON.parse(bruto) as { roster: Array<{ jogadorId: string; presenca: string }> };
    for (const m of partida.roster) {
      if (m.jogadorId === 'jogador-3') m.presenca = 'conectado';
    }
    await montada.redis.set(chaveDaPartida(montada.partidaId), JSON.stringify({
      partidaId: montada.partidaId,
      serverId: 'game-server-teste-reconexao',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster: partida.roster,
      estado: 'em_andamento',
      criadaEm: new Date().toISOString(),
    }));
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-3',
    );
    assert.equal(converteu, false);
    const estado = await lerEstado(montada);
    assert.deepEqual(
      estado.jogadores.map((j) => j.jogadorId),
      ['jogador-1', 'jogador-2', 'jogador-3'],
    );
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0);
  } finally {
    limparWiring();
  }
});

test('idempotência: segunda expiração do mesmo ausente não converte de novo', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    assert.equal(
      await montada.handlers.converterExpiracaoEmDesistencia(montada.partidaId, 'jogador-3'),
      true,
    );
    assert.equal(
      await montada.handlers.converterExpiracaoEmDesistencia(montada.partidaId, 'jogador-3'),
      false,
    );
    const estado = await lerEstado(montada);
    assert.deepEqual(
      estado.jogadores.map((j) => j.jogadorId),
      ['jogador-1', 'jogador-2'],
    );
  } finally {
    limparWiring();
  }
});

// ─── Preparada inalterada ───

test('preparada nunca converte: verificação aborta sem mutar nem avisar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2'], {
    estado: 'preparada',
    emReconexao: ['jogador-2'],
  });
  try {
    await simularJanelaVencida(montada, 'jogador-2');
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-2',
    );
    assert.equal(converteu, false);
    const estado = await lerEstado(montada);
    assert.deepEqual(
      estado.jogadores.map((j) => j.jogadorId),
      ['jogador-1', 'jogador-2'],
    );
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0);
    assert.equal(montada.avisos.length, 0);
    assert.equal(montada.desistencias.length, 0);
    assert.equal(montada.redis.tem(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-2')), false);
  } finally {
    limparWiring();
  }
});

// ─── TTL autoritativo: precoce e sem-EX abortam ───

test('fire precoce (ttl > 0, janela ainda aberta) não converte nem limpa a janela', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    await definirJanelaDeReconexao(montada.redis.comoRedis(), montada.partidaId, 'jogador-3', 60);
    const antes = await lerEstado(montada);
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-3',
    );
    assert.equal(converteu, false);
    assert.deepEqual(await lerEstado(montada), antes);
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0);
    assert.equal(
      montada.redis.tem(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-3')),
      true,
      'janela viva preservada para o fire no vencimento',
    );
  } finally {
    limparWiring();
  }
});

test('janela sem EX (ttl -1, misconfig) aborta com warn sem mutar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    // Chave sem EX: o stub devolve -1 como o Redis real sem expiração.
    await montada.redis.set(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-3'), '1');
    const antes = await lerEstado(montada);
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-3',
    );
    assert.equal(converteu, false);
    assert.deepEqual(await lerEstado(montada), antes);
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0);
  } finally {
    limparWiring();
  }
});

// ─── Lote da expiração com Iluminação/Limpeza como em B ───

test('expiração recalcula a Iluminação e limpa só as peças do ausente, com causa', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4'], {
    emReconexao: ['jogador-4'],
  });
  try {
    // Mesmo tabuleiro do teste de B em desistencia.test.ts: peças sob os
    // restantes + peças só iluminadas pelo ausente (jogador-4 em (0,0)).
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
    await montada.redis.set(
      chaveDoEstadoDaPartida(montada.partidaId),
      JSON.stringify({
        ...base,
        tabuleiro,
        celulasIluminadas: calcularIluminacao(tabuleiro),
      }),
    );

    await simularJanelaVencida(montada, 'jogador-4');
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-4',
    );
    assert.equal(converteu, true);

    const estado = await lerEstado(montada);
    assert.deepEqual(estado.tabuleiro.posicionadas.map((peca) => peca.pecaId), ['p-a', 'p-b', 'p-d']);

    const mensagens = montada.sockets.get('jogador-1')!.mensagens;
    assert.deepEqual(mensagens[0], {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-4',
      peaoId: 'peao-amarelo',
      causa: 'expiracao',
    });
    assert.deepEqual(
      mensagens.find((m) => m.type === 'LIMPEZA_APLICADA'),
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['p-c', 'p-extra'] },
    );
    const iluminadas = mensagens.find((m) => m.type === 'CELULAS_ILUMINADAS') as
      | { celulas: Array<{ linha: number; coluna: number }> }
      | undefined;
    assert.ok(iluminadas !== undefined, 'tabuleiro novo viaja no lote da expiração');
    assert.ok(
      iluminadas.celulas.every((c) => !(c.linha === 0 && c.coluna <= 1)),
      'células do ausente apagam',
    );
  } finally {
    limparWiring();
  }
});

test('3→2 por expiração com objetivos declara vitória N−1 no próprio lote', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    emReconexao: ['jogador-3'],
  });
  try {
    // Objetivos prontos com N=3: portão com os 3 peões, geradores e cartão —
    // a saída do ausente deixa N−1 vencedor (vitória precede as derrotas).
    const base = await lerEstado(montada);
    const portao = {
      pecaId: 'portao-de-teste',
      tipo: 'portao_de_saida' as const,
      orientacao: 0 as const,
      celula: { linha: 3, coluna: 3 },
    };
    await montada.redis.set(
      chaveDoEstadoDaPartida(montada.partidaId),
      JSON.stringify({
        ...base,
        tabuleiro: {
          ...base.tabuleiro,
          posicionadas: [portao],
          peoes: base.tabuleiro.peoes.map((peao) => ({ ...peao, pecaId: portao.pecaId })),
        },
        geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
        cartaoDeAcessoObtido: true,
      }),
    );

    await simularJanelaVencida(montada, 'jogador-3');
    const converteu = await verificarExpiracaoSeNecessario(
      montada.redis.comoRedis(),
      montada.partidaId,
      'jogador-3',
    );
    assert.equal(converteu, true);

    const estado = await lerEstado(montada);
    assert.deepEqual(estado.resultado, { tipo: 'vitoria' });
    const mensagens = montada.sockets.get('jogador-1')!.mensagens;
    assert.deepEqual(mensagens[mensagens.length - 1], {
      type: 'PARTIDA_TERMINADA',
      resultado: 'vitoria',
    });
    await montada.handlers.drenarRetornosPendentes(2000);
    assert.equal(montada.avisos.length, 1);
    assert.deepEqual(montada.avisos[0], {
      salaId: 'sala-1',
      partidaId: montada.partidaId,
      serverId: 'game-server-teste-reconexao',
      resultado: 'vitoria',
      jogadores: ['jogador-1', 'jogador-2'],
      teveDesistencia: true,
    });
  } finally {
    limparWiring();
  }
});

// ─── Janela: TTL configurável + clamp ───

test('janela grava EX configurável com clamp ≥1s', async () => {
  const redis = new RedisEmMemoria();
  await definirJanelaDeReconexao(redis.comoRedis(), 'p1', 'j1', 60);
  assert.equal(redis.ultimoEx, 60);
  await definirJanelaDeReconexao(redis.comoRedis(), 'p1', 'j1', 0);
  assert.equal(redis.ultimoEx, 1);
});

// ─── Rearme ───

test('rearme reagenda janela viva de em_andamento sem apagar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2'], {
    emReconexao: ['jogador-2'],
  });
  try {
    await definirJanelaDeReconexao(montada.redis.comoRedis(), montada.partidaId, 'jogador-2', 60);
    await rearmarReconexaoEmAndamentoAposRestart(montada.redis.comoRedis());
    assert.equal(montada.redis.tem(chaveReconexaoEmAndamento(montada.partidaId, 'jogador-2')), true);
  } finally {
    cancelarExpiracaoDeReconexao(montada.partidaId, 'jogador-2');
    limparWiring();
  }
});
