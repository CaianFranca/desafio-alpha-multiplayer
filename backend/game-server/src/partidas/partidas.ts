import type { Redis } from 'ioredis';
import type { MembroDaSala, OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import {
  chaveDoEstadoDaPartida,
  inicializarEstadoDaPartida,
  removerEstadoDaPartida,
} from './estado.ts';

export type EstadoDaPartida = 'preparada' | 'em_andamento';

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
  // Normaliza presença para 'em_reconexao' no nascimento da partida (ST-14):
  // o roster do lobby chega com 'conectado', mas a Conexão à Partida ainda
  // não foi estabelecida — o WS contará as admissões.
  const rosterInicial = oferta.roster.map((membro) => ({
    ...membro,
    presenca: 'em_reconexao' as const,
  }));
  const partida: PartidaPreparada = {
    partidaId: crypto.randomUUID(),
    serverId,
    salaId: oferta.salaId,
    codigoDeSala: oferta.codigoDeSala,
    roster: rosterInicial,
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

export interface ResultadoTransicaoDePresenca {
  readonly mudou: boolean;
  readonly completo: boolean;
  readonly iniciou: boolean;
  readonly estado: EstadoDaPartida;
}

const TTL_NAO_EXISTE = -2;
const TTL_SEM_EXPIRACAO = -1;

const SCRIPT_TRANSICAO_PRESENCA = `
local function salvarPreservandoTtl(chave, valor)
  local ttl = redis.call('TTL', chave)
  if ttl == -1 then
    redis.call('SET', chave, valor)
  elseif ttl == 0 then
    redis.call('SET', chave, valor)
    redis.call('PERSIST', chave)
  elseif ttl > 0 then
    redis.call('SET', chave, valor, 'EX', ttl)
  elseif ttl == -2 then
    -- chave expirou entre GET e SET — não repersiste
    return
  else
    redis.call('SET', chave, valor)
  end
end
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({mudou=false, completo=false, iniciou=false, estado=''})
end
local ok, partida = pcall(cjson.decode, raw)
if not ok or not partida or not partida.roster then
  return cjson.encode({mudou=false, completo=false, iniciou=false, estado='' })
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
local conectados = 0
for i, m in ipairs(partida.roster) do
  if m.presenca == 'conectado' then
    conectados = conectados + 1
  end
end
local completo = (conectados == 4)
local iniciou = false
if completo and partida.estado == 'preparada' then
  partida.estado = 'em_andamento'
  iniciou = true
end
local estadoAtual = partida.estado
if mudou or iniciou then
  local novo = cjson.encode(partida)
  if iniciou then
    -- ST-14: partida em_andamento persiste sem TTL (sem expiração)
    redis.call('SET', KEYS[1], novo)
    redis.call('PERSIST', KEYS[1])
    if redis.call('EXISTS', KEYS[2]) == 1 then
      redis.call('PERSIST', KEYS[2])
    end
  else
    salvarPreservandoTtl(KEYS[1], novo)
  end
end
return cjson.encode({mudou=mudou, completo=completo, iniciou=iniciou, estado=estadoAtual})
`.trim();

export async function transicionarSeCompletoOuAtualizarPresenca(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
): Promise<ResultadoTransicaoDePresenca | null> {
  const bruto = await redis.eval(
    SCRIPT_TRANSICAO_PRESENCA,
    2,
    chaveDaPartida(partidaId),
    chaveDoEstadoDaPartida(partidaId),
    jogadorId,
  );
  const json = typeof bruto === 'string' ? bruto : String(bruto ?? '');
  try {
    const parsed = JSON.parse(json) as ResultadoTransicaoDePresenca;
    if (parsed.estado !== 'preparada' && parsed.estado !== 'em_andamento') {
      // Estado vazio indica partida inexistente ou payload corrompido — não mascarar como 'preparada'
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
