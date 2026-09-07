import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Redis } from 'ioredis';
import {
  cancelarAbandono,
  configurarAbandono,
  definirBroadcasterParaAbandono,
  rearmarAbandonosAposRestart,
  verificarEAbandonarSeNecessario,
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

test('A2: rearme lê o lote via pipeline (GET + TTL em 1 RTT)', async () => {
  const store = new Map<string, string>([[CHAVE_PARTIDA, partidaPreparadaJson()]]);
  const comandos: Array<{ cmd: string; chave: string }> = [];
  let pipelines = 0;
  let execs = 0;
  const redis = {
    async scan(_cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      const idx = args.indexOf('MATCH');
      const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
      const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      return ['0', [...store.keys()].filter((k) => k.startsWith(prefixo))];
    },
    pipeline() {
      pipelines += 1;
      return {
        get(chave: string) {
          comandos.push({ cmd: 'get', chave });
        },
        ttl(chave: string) {
          comandos.push({ cmd: 'ttl', chave });
        },
        async exec(): Promise<Array<[Error | null, unknown]>> {
          execs += 1;
          const out: Array<[Error | null, unknown]> = [];
          for (const c of comandos) {
            out.push([null, c.cmd === 'get' ? (store.get(c.chave) ?? null) : 100]);
          }
          return out;
        },
      };
    },
    async get(): Promise<never> {
      throw new Error('deveria usar pipeline, não GET sequencial');
    },
    async ttl(): Promise<never> {
      throw new Error('deveria usar pipeline, não TTL sequencial');
    },
  } as unknown as Redis;
  configurarAbandono(undefined, 90);
  try {
    await rearmarAbandonosAposRestart(redis);
    assert.equal(pipelines, 1, 'deveria abrir 1 pipeline por lote');
    assert.equal(execs, 1, 'deveria executar o pipeline do lote');
    assert.deepEqual(
      comandos,
      [
        { cmd: 'get', chave: CHAVE_PARTIDA },
        { cmd: 'ttl', chave: CHAVE_PARTIDA },
      ],
      'pipeline deveria enfileirar GET + TTL da chave da partida',
    );
  } finally {
    cancelarAbandono(PARTIDA_ID);
  }
});

test('A3: criadaEm inválida (NaN) nunca agenda nem abandona', async () => {
  const parcial = [1, 2, 3, 4].map((n) => ({
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    presenca: n === 1 ? 'conectado' : 'em_reconexao',
  }));
  const store = new Map<string, string>([
    [CHAVE_PARTIDA, partidaPreparadaJson({ criadaEm: 'data-invalida', roster: parcial })],
  ]);
  const redis = {
    async get(chave: string): Promise<string | null> {
      return store.get(chave) ?? null;
    },
    async del(chave: string): Promise<number> {
      return store.delete(chave) ? 1 : 0;
    },
  } as unknown as Redis;
  let encerramentos = 0;
  definirBroadcasterParaAbandono({
    encerrarPorAbandono() {
      encerramentos += 1;
    },
  });
  const delays: unknown[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((
    cb: (...args: unknown[]) => void,
    ms?: number,
    ...rest: unknown[]
  ) => {
    delays.push(ms);
    return (originalSetTimeout as (...a: unknown[]) => unknown)(cb, ms, ...rest);
  }) as typeof setTimeout;
  try {
    configurarAbandono(undefined, 90);
    const abandonou = await verificarEAbandonarSeNecessario(redis, PARTIDA_ID);
    assert.equal(abandonou, false, 'criadaEm inválida não deve abandonar');
    assert.equal(encerramentos, 0, 'não deve chutar sockets com idade NaN');
    assert.ok(
      delays.every((d) => typeof d === 'number' && Number.isFinite(d)),
      `nenhum timer com delay NaN, agendados: ${JSON.stringify(delays)}`,
    );
    assert.ok(store.has(CHAVE_PARTIDA), 'chave da partida deve permanecer intacta');
  } finally {
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = originalSetTimeout;
    definirBroadcasterParaAbandono({ encerrarPorAbandono() {} });
    cancelarAbandono(PARTIDA_ID);
  }
});

test('A4: DEL falho não chuta sockets (só após cancelarPartida=true)', async () => {
  const store = new Map<string, string>([
    [CHAVE_PARTIDA, partidaPreparadaJson({ criadaEm: new Date('2000-01-01T00:00:00.000Z').toISOString() })],
  ]);
  const redis = {
    async get(chave: string): Promise<string | null> {
      return store.get(chave) ?? null;
    },
    async del(): Promise<number> {
      return 0;
    },
  } as unknown as Redis;
  let encerramentos = 0;
  definirBroadcasterParaAbandono({
    encerrarPorAbandono() {
      encerramentos += 1;
    },
  });
  try {
    configurarAbandono(undefined, 90);
    const abandonou = await verificarEAbandonarSeNecessario(redis, PARTIDA_ID);
    assert.equal(abandonou, false, 'DEL falho não deve concluir o abandono');
    assert.equal(encerramentos, 0, 'sockets devem permanecer intactos com cancelarPartida=false');
    assert.ok(store.has(CHAVE_PARTIDA), 'chave da partida deve permanecer intacta');
  } finally {
    definirBroadcasterParaAbandono({ encerrarPorAbandono() {} });
    cancelarAbandono(PARTIDA_ID);
  }
});
