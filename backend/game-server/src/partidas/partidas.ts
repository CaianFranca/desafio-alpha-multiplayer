import type { Redis } from 'ioredis';
import type { MembroDaSala, OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import {
  inicializarEstadoDoTabuleiro,
  removerEstadoDoTabuleiro,
} from './tabuleiro.ts';

export type EstadoDaPartida = 'preparada';

export interface PartidaPreparada {
  readonly partidaId: PartidaId;
  readonly serverId: ServerId;
  readonly salaId: string;
  readonly codigoDeSala: string;
  readonly roster: readonly MembroDaSala[];
  readonly estado: EstadoDaPartida;
  readonly criadaEm: string;
}

export function chaveDaPartida(partidaId: PartidaId): string {
  return `game-server:partida:${partidaId}`;
}

export async function criarPartidaPreparada(
  contexto: ContextoDoGameServer,
  oferta: OfertaDeEncaminhamento,
): Promise<PartidaPreparada> {
  const { redis, serverId, partidaPreparadaTtlSegundos } = contexto;
  const partida: PartidaPreparada = {
    partidaId: crypto.randomUUID(),
    serverId,
    salaId: oferta.salaId,
    codigoDeSala: oferta.codigoDeSala,
    roster: oferta.roster,
    estado: 'preparada',
    criadaEm: new Date().toISOString(),
  };

  await redis.set(chaveDaPartida(partida.partidaId), JSON.stringify(partida), 'EX', partidaPreparadaTtlSegundos);

  // Estado do tabuleiro nasce junto com a partida, com o mesmo TTL (issue #80).
  // Rollback barato: se a inicialização do tabuleiro falhar, remove a partida
  // recém-criada para não deixar partida órfã sem tabuleiro (que responderia
  // ESTADO_INDISPONIVEL para sempre).
  try {
    await inicializarEstadoDoTabuleiro(redis, partida.partidaId, partidaPreparadaTtlSegundos);
  } catch (erro) {
    await redis.del(chaveDaPartida(partida.partidaId));
    throw erro;
  }

  return partida;
}

export async function obterPartida(redis: Redis, partidaId: PartidaId): Promise<PartidaPreparada | null> {
  const bruto = await redis.get(chaveDaPartida(partidaId));
  if (bruto === null) {
    return null;
  }
  return JSON.parse(bruto) as PartidaPreparada;
}

export async function existePartida(redis: Redis, partidaId: PartidaId): Promise<boolean> {
  return (await redis.exists(chaveDaPartida(partidaId))) === 1;
}

export async function cancelarPartida(redis: Redis, partidaId: PartidaId): Promise<boolean> {
  const removida = (await redis.del(chaveDaPartida(partidaId))) === 1;
  // Remove também o estado do tabuleiro associado (issue #80).
  await removerEstadoDoTabuleiro(redis, partidaId);
  return removida;
}
