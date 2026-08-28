// Janela de Reconexão (issue #38) — TTL de 60s no Redis, por membro.
//
// Modelo:
//   lobby:reconexao:<salaId>:<membroId> -> "1" (EX 60)
//
// A janela vive no Redis (ADR-0002) e é refrescada apenas por desconexão;
// a reconexão bem-sucedida e a expiração limpam a chave. O timer em memória
// em `SalasHandlers` espelha o TTL; o Redis é a persistência de recuperação
// (se o processo reinicia, a chave ainda indica a janela aberta).

import type { Redis } from 'ioredis';
import { redisClient as defaultRedis } from '../config/redis.ts';

export const JANELA_RECONEXAO_SEGUNDOS = 60;
const PREFIXO_RECONEXAO = 'lobby:reconexao:';

export function chaveReconexao(salaId: string, membroId: string): string {
  return `${PREFIXO_RECONEXAO}${salaId}:${membroId}`;
}

export class SalasReconexao {
  private readonly redis: Redis;

  constructor(redis: Redis = defaultRedis) {
    this.redis = redis;
  }

  async definirJanela(salaId: string, membroId: string): Promise<void> {
    await this.redis.set(
      chaveReconexao(salaId, membroId),
      '1',
      'EX',
      JANELA_RECONEXAO_SEGUNDOS,
    );
  }

  async limparJanela(salaId: string, membroId: string): Promise<void> {
    await this.redis.del(chaveReconexao(salaId, membroId));
  }

  async obterJanela(salaId: string, membroId: string): Promise<number> {
    // TTL: segundos até expirar, -2 se a chave não existe, -1 se sem expiração.
    return this.redis.ttl(chaveReconexao(salaId, membroId));
  }

  async existeJanela(salaId: string, membroId: string): Promise<boolean> {
    const ttl = await this.obterJanela(salaId, membroId);
    return ttl >= 0;
  }
}
