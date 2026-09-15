// Limitador de tentativas sobre contadores no Redis. Cada item é uma chave
// independente (ex.: por IP, por conta); INCR + EXPIRE precisam ser atômicos
// para que a janela seja aplicada exatamente uma vez, sem corrida entre
// requests concorrentes que criariam o contador sem TTL.

import type { Redis } from 'ioredis';
import { redisClient } from '../config/redis.ts';

export interface ItemLimite {
  chave: string;
  maximo: number;
  janelaSegundos: number;
}

export interface ResultadoLimite {
  excedido: boolean;
  retryAfterSegundos: number;
}

// KEYS[1] = chave do contador
// ARGV[1] = janela em segundos
// Retorna {n, ttl} — total de tentativas e TTL restante em segundos.
const SCRIPT_CONSUMIR_LIMITE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return {n, ttl}
`.trim();

declare module 'ioredis' {
  // Augmentação dos métodos registrados via `defineCommand`. ioredis adiciona
  // esses métodos dinamicamente, mas o TypeScript só os conhece se forem
  // declarados aqui.
  interface Redis {
    consumirLimiteAtomico(chave: string, janelaSegundos: number): Promise<[number, number]>;
  }
}

let scriptsRegistrados = false;

function registrarScripts(): void {
  if (scriptsRegistrados) {
    return;
  }
  scriptsRegistrados = true;
  redisClient.defineCommand('consumirLimiteAtomico', {
    numberOfKeys: 1,
    lua: SCRIPT_CONSUMIR_LIMITE,
  });
}

export async function consumirTentativas(
  itens: readonly ItemLimite[],
): Promise<ResultadoLimite> {
  registrarScripts();

  let excedido = false;
  let retryAfterSegundos = 0;

  for (const item of itens) {
    const [n, ttl] = await redisClient.consumirLimiteAtomico(
      item.chave,
      item.janelaSegundos,
    );
    if (n > item.maximo) {
      excedido = true;
      // TTL pode ser -1 (sem expiração) ou -2 (chave inexistente); clampa em 0.
      retryAfterSegundos = Math.max(retryAfterSegundos, Math.max(ttl, 0));
    }
  }

  return { excedido, retryAfterSegundos };
}
