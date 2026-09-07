import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Redis } from 'ioredis';
import {
  cancelarAbandono,
  configurarAbandono,
  rearmarAbandonosAposRestart,
} from '../src/partidas/abandono.ts';

const PARTIDA_ID = '22222222-2222-4222-8222-222222222222';
const CHAVE_PARTIDA = `game-server:partida:${PARTIDA_ID}`;

function partidaPreparadaJson(sobrescrita: Record<string, unknown> = {}): string {
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
    ...sobrescrita,
  });
}

function redisFalso(
  store: Map<string, string>,
  observacao: { scanArgs: unknown[][] },
): Redis {
  return {
    async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      observacao.scanArgs.push(args);
      const idx = args.indexOf('MATCH');
      const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
      const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      const chaves = [...store.keys()].filter((k) => k.startsWith(prefixo));
      void cursor;
      return ['0', chaves];
    },
    async get(chave: string): Promise<string | null> {
      return store.get(chave) ?? null;
    },
    async ttl(): Promise<number> {
      return 100;
    },
  } as unknown as Redis;
}

test('A1: rearme usa COUNT 500 no SCAN (anti-thundering-herd)', async () => {
  const store = new Map<string, string>([[CHAVE_PARTIDA, partidaPreparadaJson()]]);
  const observacao = { scanArgs: [] as unknown[][] };
  configurarAbandono(undefined, 90);
  try {
    await rearmarAbandonosAposRestart(redisFalso(store, observacao));
    const counts = observacao.scanArgs.map((args) => {
      const i = args.indexOf('COUNT');
      return i >= 0 ? Number(args[i + 1]) : null;
    });
    assert.ok(counts.length > 0, 'deveria escanear ao menos uma vez');
    assert.ok(
      counts.every((c) => c === 500),
      `SCAN deveria usar COUNT 500, usou ${counts.join(',')}`,
    );
  } finally {
    cancelarAbandono(PARTIDA_ID);
  }
});
