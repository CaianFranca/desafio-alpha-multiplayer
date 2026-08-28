// Janela de Reconexão (issue #38) — TTL de 60s no Redis, por membro.
//
// Modelo:
//   lobby:reconexao:<salaId>:<jogadorId> -> "1" (EX 60)
//   Chave por Jogador (não Membro) para sobreviver ao restart (membroId muda na reconstrução).
//
// A janela vive no Redis (ADR-0002) e é refrescada apenas por desconexão;
// a reconexão bem-sucedida e a expiração limpam a chave. O timer em memória
// em `SalasHandlers` espelha o TTL; o Redis é a persistência de recuperação
// (se o processo reinicia, a chave ainda indica a janela aberta).
// EX deriva de `janelaReconexaoMs` injetada (clamp ≥1s) para não vazar 60s entre testes.

import type { Redis } from 'ioredis';
import { redisClient as defaultRedis } from '../config/redis.ts';

export const JANELA_RECONEXAO_SEGUNDOS = 60;
const PREFIXO_RECONEXAO = 'lobby:reconexao:';

export function chaveReconexao(salaId: string, jogadorId: string): string {
  return `${PREFIXO_RECONEXAO}${salaId}:${jogadorId}`;
}

export class SalasReconexao {
  private readonly redis: Redis;
  private readonly janelaReconexaoMs: number;

  constructor(redis: Redis = defaultRedis, janelaReconexaoMs?: number) {
    this.redis = redis;
    this.janelaReconexaoMs = janelaReconexaoMs ?? JANELA_RECONEXAO_SEGUNDOS * 1000;
  }

  async definirJanela(salaId: string, jogadorId: string): Promise<void> {
    const ex = Math.max(1, Math.ceil(this.janelaReconexaoMs / 1000));
    await this.redis.set(
      chaveReconexao(salaId, jogadorId),
      '1',
      'EX',
      ex,
    );
  }

  async limparJanela(salaId: string, jogadorId: string): Promise<void> {
    await this.redis.del(chaveReconexao(salaId, jogadorId));
  }

  async obterJanela(salaId: string, jogadorId: string): Promise<number> {
    // TTL: segundos até expirar, -2 se a chave não existe, -1 se sem expiração.
    return this.redis.ttl(chaveReconexao(salaId, jogadorId));
  }

  async existeJanela(salaId: string, jogadorId: string): Promise<boolean> {
    const ttl = await this.obterJanela(salaId, jogadorId);
    return ttl >= 0;
  }
}
