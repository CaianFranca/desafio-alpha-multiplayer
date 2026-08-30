// Persistência do EstadoDaPartida no Redis (issue #117).
//
// O estado nasce junto com a partida preparada em `criarPartidaPreparada`
// (mesmo TTL) e é removido junto no cancelamento. Cada comando da partida lê,
// aplica e reescreve o estado; o `handlers.ts` serializa as mutações por
// `partidaId` para evitar lost-update no read-modify-write. Substitui o
// estado isolado de tabuleiro do #80 (game-server:tabuleiro:<id>) pelo estado
// completo do ST-11 (tabuleiro + Turnos) resolvido pelo canal de Partida.

import type { Redis } from 'ioredis';
import {
  estadoInicialDaPartida,
  type EstadoDaPartida,
} from '@flicker/engine';

function chaveDoEstadoDaPartida(partidaId: string): string {
  return `game-server:partida-estado:${partidaId}`;
}

/**
 * Grava o estado inicial da partida no Redis com o TTL da partida preparada.
 * O domínio exige sucesso (roster com exatamente 4 jogadores únicos); a falha
 * é propagada para o rollback em `criarPartidaPreparada`. `KEEPTTL` não é
 * usado aqui pois a chave ainda não existe.
 */
export async function inicializarEstadoDaPartida(
  redis: Redis,
  partidaId: string,
  ttlSegundos: number,
  jogadoresEmOrdem: readonly string[],
): Promise<void> {
  const resultado = estadoInicialDaPartida(jogadoresEmOrdem);
  if (!resultado.sucesso) {
    throw new Error(
      `Falha ao inicializar o estado da partida: ${resultado.erro.codigo} — ${resultado.erro.mensagem}`,
    );
  }
  await redis.set(
    chaveDoEstadoDaPartida(partidaId),
    JSON.stringify(resultado.estado),
    'EX',
    ttlSegundos,
  );
}

/** Lê o estado da partida; `null` se a chave não existir (partida expirada/cancelada). */
export async function obterEstadoDaPartida(
  redis: Redis,
  partidaId: string,
): Promise<EstadoDaPartida | null> {
  const bruto = await redis.get(chaveDoEstadoDaPartida(partidaId));
  if (bruto === null) {
    return null;
  }
  return JSON.parse(bruto) as EstadoDaPartida;
}

/**
 * Reescreve o estado da partida preservando o TTL restante da partida
 * preparada (`KEEPTTL`), para que o estado expire junto com a partida.
 */
export async function salvarEstadoDaPartida(
  redis: Redis,
  partidaId: string,
  estado: EstadoDaPartida,
): Promise<void> {
  await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(estado), 'KEEPTTL');
}

/** Remove o estado da partida (usado no cancelamento da partida). */
export async function removerEstadoDaPartida(
  redis: Redis,
  partidaId: string,
): Promise<void> {
  await redis.del(chaveDoEstadoDaPartida(partidaId));
}