import type { Redis } from 'ioredis';
import type { MembroDaSala, OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';

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
  redis: Redis,
  oferta: OfertaDeEncaminhamento,
  serverId: ServerId,
  ttlSegundos: number,
): Promise<PartidaPreparada> {
  const partida: PartidaPreparada = {
    partidaId: crypto.randomUUID(),
    serverId,
    salaId: oferta.salaId,
    codigoDeSala: oferta.codigoDeSala,
    roster: oferta.roster,
    estado: 'preparada',
    criadaEm: new Date().toISOString(),
  };

  await redis.set(chaveDaPartida(partida.partidaId), JSON.stringify(partida), 'EX', ttlSegundos);

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
  return (await redis.del(chaveDaPartida(partidaId))) === 1;
}
