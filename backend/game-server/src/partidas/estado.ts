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

export function chaveDoEstadoDaPartida(partidaId: string): string {
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
 * Reescreve o estado da partida preservando o TTL restante da chave do
 * estado, para que ele expire junto com a partida. Em vez de `KEEPTTL` (que,
 * se a chave tiver expirado entre o `obter` e o `salvar`, criaria a chave sem
 * TTL — um estado órfão que nunca expira, #135), consulta-se o TTL remanescente
 * e aplica-se `SET ... EX ttl`. Se a chave já expirou/inexiste (`ttl === -2`),
 * a partida acabou e o estado não é repersistido. Quando a partida está
 * `em_andamento` (ST-14), o TTL é -1 (sem expiração) e o estado é repersistido
 * sem TTL.
 */
export async function salvarEstadoDaPartida(
  redis: Redis,
  partidaId: string,
  estado: EstadoDaPartida,
): Promise<void> {
  const ttl = await redis.ttl(chaveDoEstadoDaPartida(partidaId));
  if (ttl === -2) {
    return;
  }
  if (ttl === -1) {
    await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(estado));
    return;
  }
  if (ttl > 0) {
    await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(estado), 'EX', ttl);
  }
}

/** Remove o estado da partida (usado no cancelamento da partida). */
export async function removerEstadoDaPartida(
  redis: Redis,
  partidaId: string,
): Promise<void> {
  await redis.del(chaveDoEstadoDaPartida(partidaId));
}