import type { Redis } from 'ioredis';
import type { MembroDaSala, OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import {
  inicializarEstadoDaPartida,
  removerEstadoDaPartida,
} from './estado.ts';

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

  // Estado da partida nasce junto com a partida, com o mesmo TTL (issue #117).
  // Rollback barato: se a inicialização do estado falhar, remove a partida
  // recém-criada para não deixar partida órfã sem estado (que responderia
  // ESTADO_INDISPONIVEL para sempre).
  try {
    await inicializarEstadoDaPartida(
      redis,
      partida.partidaId,
      partidaPreparadaTtlSegundos,
      oferta.roster.map((membro) => membro.jogadorId),
    );
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
  // Remove também o estado da partida associado (issue #117).
  await removerEstadoDaPartida(redis, partidaId);
  return removida;
}

const SCRIPT_ATUALIZAR_PRESENCA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local ttl = redis.call('TTL', KEYS[1])
local ok, partida = pcall(cjson.decode, raw)
if not ok or not partida or not partida.roster then
  return 0
end
local mudou = false
for i, m in ipairs(partida.roster) do
  if m.jogadorId == ARGV[1] then
    if m.presenca ~= 'conectado' then
      m.presenca = 'conectado'
      mudou = true
    end
  end
end
if mudou then
  local novo = cjson.encode(partida)
  if ttl > 0 then
    redis.call('SET', KEYS[1], novo, 'EX', ttl)
  else
    redis.call('SET', KEYS[1], novo)
  end
  return 1
end
return 0
`.trim();

export async function atualizarPresencaAtomica(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
): Promise<boolean> {
  const resultado = await redis.eval(
    SCRIPT_ATUALIZAR_PRESENCA,
    1,
    chaveDaPartida(partidaId),
    jogadorId,
  );
  return resultado === 1;
}
