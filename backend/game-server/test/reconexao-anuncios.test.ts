// Anúncios de presença da reconexão em andamento (issue #295, spec #292
// história 2, seam da #294).
//
// Comportamento externo via `armarJanelaSeEmAndamento` +
// `anunciarVoltaSeReadmissao` (`src/ws/ws.ts`) + Redis em memória +
// broadcaster real com socket falso:
//
// - entrada arma e emite 1 JOGADOR_EM_RECONEXAO só em `em_andamento`
// - entrada na `preparada` é silêncio (sem janela, sem evento)
// - entrada sem partida é silêncio
// - volta emite JOGADOR_RECONECTADO e só na re-admissão efetiva
//   (`mudou && em_andamento && !iniciou`)
// - virada N-ésima (`iniciou`) não emite RECONECTADO (é PARTIDA_INICIADA)
// - `preparada`, presença já vigente (`mudou=false`) e sem broadcaster
//   nunca emitem a volta

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import type { MembroDaSala } from '@flicker/shared';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { chaveDaPartida } from '../src/partidas/partidas.ts';
import {
  cancelarExpiracaoDeReconexao,
  chaveReconexaoEmAndamento,
} from '../src/partidas/reconexao-em-andamento.ts';
import {
  anunciarVoltaSeReadmissao,
  armarJanelaSeEmAndamento,
} from '../src/ws/ws.ts';

// ─── Redis em memória (subconjunto do seam: get/set/ttl/del) ───

class RedisEmMemoria {
  private readonly dados = new Map<string, string>();
  private readonly expiracao = new Map<string, number>();

  async get(chave: string): Promise<string | null> {
    return this.dados.get(chave) ?? null;
  }

  async set(chave: string, valor: string, ...resto: unknown[]): Promise<'OK'> {
    this.dados.set(chave, valor);
    const idx = resto.indexOf('EX');
    if (idx >= 0) {
      this.expiracao.set(chave, Number(resto[idx + 1]));
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

interface Cenario {
  readonly partidaId: string;
  readonly redis: RedisEmMemoria;
  readonly broadcaster: PartidaBroadcaster;
  readonly restantes: SocketFalso;
}

async function montarCenario(estado: 'preparada' | 'em_andamento'): Promise<Cenario> {
  const partidaId = `partida-anuncios-${crypto.randomUUID()}`;
  const redis = new RedisEmMemoria();
  await redis.set(
    chaveDaPartida(partidaId),
    JSON.stringify({
      partidaId,
      serverId: 'game-server-teste-anuncios',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster: [membro(1), membro(2)],
      estado,
      criadaEm: new Date().toISOString(),
    }),
  );
  const broadcaster = new PartidaBroadcaster();
  const restantes = criarSocketFalso();
  broadcaster.registrar(partidaId, restantes.comoWebSocket());
  return { partidaId, redis, broadcaster, restantes };
}

// ─── Entrada na janela ───

test('entrada em em_andamento arma a janela e emite 1 JOGADOR_EM_RECONEXAO', async () => {
  const { partidaId, redis, broadcaster, restantes } = await montarCenario('em_andamento');
  try {
    const armou = await armarJanelaSeEmAndamento(
      redis.comoRedis(),
      partidaId,
      'jogador-2',
      broadcaster,
    );
    assert.equal(armou, true);
    assert.equal(redis.tem(chaveReconexaoEmAndamento(partidaId, 'jogador-2')), true);
    assert.deepEqual(restantes.mensagens, [
      { type: 'JOGADOR_EM_RECONEXAO', jogadorId: 'jogador-2' },
    ]);
  } finally {
    cancelarExpiracaoDeReconexao(partidaId, 'jogador-2');
  }
});

test('entrada na preparada é silêncio: sem janela e sem evento', async () => {
  const { partidaId, redis, broadcaster, restantes } = await montarCenario('preparada');
  const armou = await armarJanelaSeEmAndamento(
    redis.comoRedis(),
    partidaId,
    'jogador-2',
    broadcaster,
  );
  assert.equal(armou, false);
  assert.equal(redis.tem(chaveReconexaoEmAndamento(partidaId, 'jogador-2')), false);
  assert.equal(restantes.mensagens.length, 0);
});

test('entrada sem partida é silêncio', async () => {
  const redis = new RedisEmMemoria();
  const broadcaster = new PartidaBroadcaster();
  const armou = await armarJanelaSeEmAndamento(
    redis.comoRedis(),
    'partida-inexistente',
    'jogador-2',
    broadcaster,
  );
  assert.equal(armou, false);
});

// ─── Volta dentro da janela ───

test('volta efetiva emite JOGADOR_RECONECTADO', () => {
  const broadcaster = new PartidaBroadcaster();
  const restantes = criarSocketFalso();
  broadcaster.registrar('partida-x', restantes.comoWebSocket());

  const anunciou = anunciarVoltaSeReadmissao(broadcaster, 'partida-x', 'jogador-2', {
    estado: 'em_andamento',
    mudou: true,
    iniciou: false,
  });
  assert.equal(anunciou, true);
  assert.deepEqual(restantes.mensagens, [
    { type: 'JOGADOR_RECONECTADO', jogadorId: 'jogador-2' },
  ]);
});

test('virada N-ésima (iniciou) não emite RECONECTADO', () => {
  const broadcaster = new PartidaBroadcaster();
  const restantes = criarSocketFalso();
  broadcaster.registrar('partida-x', restantes.comoWebSocket());

  // Admissões iniciais também têm mudou=true — a guarda !iniciou as exclui
  // (a virada anuncia PARTIDA_INICIADA em vez disto).
  const anunciou = anunciarVoltaSeReadmissao(broadcaster, 'partida-x', 'jogador-2', {
    estado: 'em_andamento',
    mudou: true,
    iniciou: true,
  });
  assert.equal(anunciou, false);
  assert.equal(restantes.mensagens.length, 0);
});

test('volta na preparada, sem mudança e sem broadcaster nunca emitem', () => {
  const broadcaster = new PartidaBroadcaster();
  const restantes = criarSocketFalso();
  broadcaster.registrar('partida-x', restantes.comoWebSocket());

  assert.equal(
    anunciarVoltaSeReadmissao(broadcaster, 'partida-x', 'jogador-2', {
      estado: 'preparada',
      mudou: true,
      iniciou: false,
    }),
    false,
  );
  assert.equal(
    anunciarVoltaSeReadmissao(broadcaster, 'partida-x', 'jogador-2', {
      estado: 'em_andamento',
      mudou: false,
      iniciou: false,
    }),
    false,
  );
  assert.equal(
    anunciarVoltaSeReadmissao(undefined, 'partida-x', 'jogador-2', {
      estado: 'em_andamento',
      mudou: true,
      iniciou: false,
    }),
    false,
  );
  assert.equal(restantes.mensagens.length, 0);
});
