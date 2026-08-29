// Persistência do EstadoDoTabuleiro no Redis (issue #80).
//
// O estado é criado junto com a partida preparada em `criarPartidaPreparada`
// (mesmo TTL) e removido junto no cancelamento. Cada comando de tabuleiro lê,
// aplica e reescreve o estado; o `handlers.ts` serializa as mutações por
// `partidaId` para evitar lost-update no read-modify-write.

import type { Redis } from 'ioredis';
import {
  estadoInicialDoTabuleiro,
  type EstadoDoTabuleiro,
} from '@flicker/engine';

function chaveDoTabuleiro(partidaId: string): string {
  return `game-server:tabuleiro:${partidaId}`;
}

/**
 * Grava o estado inicial do tabuleiro no Redis com o TTL da partida preparada.
 * `KEEPTTL` não é usado aqui pois a chave ainda não existe.
 */
export async function inicializarEstadoDoTabuleiro(
  redis: Redis,
  partidaId: string,
  ttlSegundos: number,
): Promise<void> {
  await redis.set(
    chaveDoTabuleiro(partidaId),
    JSON.stringify(estadoInicialDoTabuleiro()),
    'EX',
    ttlSegundos,
  );
}

/** Lê o estado do tabuleiro; `null` se a chave não existir (partida expirada/cancelada). */
export async function obterEstadoDoTabuleiro(
  redis: Redis,
  partidaId: string,
): Promise<EstadoDoTabuleiro | null> {
  const bruto = await redis.get(chaveDoTabuleiro(partidaId));
  if (bruto === null) {
    return null;
  }
  return JSON.parse(bruto) as EstadoDoTabuleiro;
}

/**
 * Reescreve o estado do tabuleiro preservando o TTL restante da partida
 * (`KEEPTTL`), para que o estado expire junto com a partida preparada.
 */
export async function salvarEstadoDoTabuleiro(
  redis: Redis,
  partidaId: string,
  estado: EstadoDoTabuleiro,
): Promise<void> {
  await redis.set(chaveDoTabuleiro(partidaId), JSON.stringify(estado), 'KEEPTTL');
}

/** Remove o estado do tabuleiro (usado no cancelamento da partida). */
export async function removerEstadoDoTabuleiro(
  redis: Redis,
  partidaId: string,
): Promise<void> {
  await redis.del(chaveDoTabuleiro(partidaId));
}
