import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Redis } from 'ioredis';
import {
  cancelarAbandono,
  configurarAbandono,
  rearmarAbandonosAposRestart,
} from '../src/partidas/abandono.ts';

const PARTIDA_ID = '11111111-1111-4111-8111-111111111111';
const CHAVE_PARTIDA = `game-server:partida:${PARTIDA_ID}`;
const CHAVE_ESTADO = `game-server:partida-estado:${PARTIDA_ID}`;

function partidaPreparadaJson(): string {
  return JSON.stringify({
    partidaId: PARTIDA_ID,
    salaId: 'sala-1',
    serverId: 'srv-1',
    estado: 'preparada',
    criadaEm: new Date().toISOString(),
    roster: [1, 2, 3, 4].map((n) => ({
      id: `membro-${n}`,
      jogadorId: `jogador-${n}`,
      presenca: 'em_reconexao',
    })),
  });
}

function redisFalso(store: Map<string, string>, observacao: { matchUsados: string[]; gets: string[] }): Redis {
  return {
    async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      const idx = args.indexOf('MATCH');
      const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
      observacao.matchUsados.push(pattern);
      const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      const chaves = [...store.keys()].filter((k) => k.startsWith(prefixo));
      void cursor;
      return ['0', chaves];
    },
    async get(chave: string): Promise<string | null> {
      observacao.gets.push(chave);
      return store.get(chave) ?? null;
    },
    async ttl(): Promise<number> {
      return 100;
    },
  } as unknown as Redis;
}

test('rearme encontra partida com prefixo game-server:partida:* e ignora estado', async () => {
  const store = new Map<string, string>([
    [CHAVE_PARTIDA, partidaPreparadaJson()],
    [CHAVE_ESTADO, JSON.stringify({ tabuleiro: [] })],
  ]);
  const observacao = { matchUsados: [] as string[], gets: [] as string[] };
  configurarAbandono(undefined, 90);
  try {
    await rearmarAbandonosAposRestart(redisFalso(store, observacao));
    assert.ok(
      observacao.matchUsados.includes('game-server:partida:*'),
      `SCAN deveria usar game-server:partida:*, usou ${observacao.matchUsados.join(',')}`,
    );
    assert.ok(observacao.gets.includes(CHAVE_PARTIDA), 'deveria ler a chave da partida');
    assert.ok(!observacao.gets.includes(CHAVE_ESTADO), 'deveria pular a chave de estado sem GET');
  } finally {
    cancelarAbandono(PARTIDA_ID);
  }
});
