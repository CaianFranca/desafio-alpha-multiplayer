import type { Redis } from 'ioredis';
import type { MembroDaSala, OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import { chaveDaPartida, chaveDoChatDaPartida, chaveDoEstadoDaPartida } from './chaves.ts';
import { inicializarEstadoDaPartida } from './estado.ts';
import { agendarNaoInicio, cancelarNaoInicio, obterNaoInicioSegundos } from './nao-inicio.ts';

export type EstadoDaPartida = 'preparada' | 'em_andamento';

export interface PartidaPreparada {
  readonly partidaId: PartidaId;
  readonly serverId: ServerId;
  readonly salaId: string;
  readonly codigoDeSala: string;
  readonly roster: readonly MembroDaSala[];
  readonly estado: EstadoDaPartida;
  readonly criadaEm: string;
  /**
   * Marco autoritativo do início da Partida (epoch ms, issue #259): gravado
   * atomicamente na transição de presença que vira `em_andamento`; `null`
   * enquanto `preparada`. Persistido no Redis junto da PartidaPreparada e
   * devolvido pela transição para viajar em PARTIDA_INICIADA e no snapshot.
   */
  readonly iniciadaEm?: number | null;
}

export { chaveDaPartida, chaveDoChatDaPartida, chaveDoEstadoDaPartida };

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
    iniciadaEm: null,
  };

  await redis.set(chaveDaPartida(partida.partidaId), JSON.stringify(partida), 'EX', partidaPreparadaTtlSegundos);

  // Estado da partida nasce junto com a partida, com o mesmo TTL (issue #117).
  // Rollback barato: se a inicialização do estado falhar, remove a partida
  // recém-criada para não deixar partida órfã sem estado (que responderia
  // ESTADO_INDISPONIVEL para sempre).
  try {
    // Seed aleatória via WebCrypto (mesma global do randomUUID acima).
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await inicializarEstadoDaPartida(
      redis,
      partida.partidaId,
      partidaPreparadaTtlSegundos,
      oferta.roster.map((membro) => membro.jogadorId),
      seed,
    );
  } catch (erro) {
    await redis.del(chaveDaPartida(partida.partidaId));
    throw erro;
  }

  // Teto único do não-início (review JF532, O2): o valor vive no módulo
  // `nao-inicio` (fixado pelo wiring em index.ts) — não se lê do contexto.
  const naoInicioMs = obterNaoInicioSegundos() * 1000;
  agendarNaoInicio(partida.partidaId, naoInicioMs);

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

// Cancelamento incondicional (R3): partida + estado + chat do histórico da
// #388 num único EVAL — sem janela entre os 3 DEL onde o chat ficaria órfão
// ou a partida ressuscitaria sem estado.
const SCRIPT_CANCELAR_PARTIDA = `
local removida = redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return removida
`.trim();

export async function cancelarPartida(redis: Redis, partidaId: PartidaId): Promise<boolean> {
  cancelarNaoInicio(partidaId);
  const removida =
    (await redis.eval(
      SCRIPT_CANCELAR_PARTIDA,
      3,
      chaveDaPartida(partidaId),
      chaveDoEstadoDaPartida(partidaId),
      chaveDoChatDaPartida(partidaId),
    )) === 1;
  return removida;
}

// Review #304 (item 1): o não-início não pode usar o DEL incondicional — entre
// a leitura do estado e o DEL, o Lua de admissão pode ter virado a partida para
// `em_andamento` (com PERSIST). O script só remove se a partida ainda está em
// `preparada`; retorna 0 quando a condição falha, e o chamador reagenda sem
// chutar sockets. A chave de chat da #388 vai junto (DEL condicional).
const SCRIPT_CANCELAR_SE_NAO_INICIADA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local ok, partida = pcall(cjson.decode, raw)
if not ok or not partida or partida.estado ~= 'preparada' then
  return 0
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 1
`.trim();

export async function cancelarPartidaSeNaoIniciada(redis: Redis, partidaId: string): Promise<boolean> {
  const removida =
    (await redis.eval(
      SCRIPT_CANCELAR_SE_NAO_INICIADA,
      3,
      chaveDaPartida(partidaId),
      chaveDoEstadoDaPartida(partidaId),
      chaveDoChatDaPartida(partidaId),
    )) === 1;
  if (removida) {
    cancelarNaoInicio(partidaId);
  }
  return removida;
}

export interface ResultadoTransicaoDePresenca {
  readonly mudou: boolean;
  readonly completo: boolean;
  readonly iniciou: boolean;
  readonly estado: EstadoDaPartida;
  /**
   * Marco autoritativo do início (epoch ms, issue #259) quando a Partida está
   * `em_andamento`; `null` em `preparada` e em Partidas persistidas por
   * binário anterior sem o campo (normalização defensiva).
   */
  readonly iniciadaEm: number | null;
}

const TTL_NAO_EXISTE = -2;
const TTL_SEM_EXPIRACAO = -1;

const SCRIPT_TRANSICAO_PRESENCA = `
local function salvarPreservandoTtl(chave, valor)
  local ttl = redis.call('TTL', chave)
  if ttl == -2 then
    -- chave expirou entre GET e SET — não repersiste
    return
  elseif ttl == -1 then
    redis.call('SET', chave, valor)
  elseif ttl > 0 then
    redis.call('SET', chave, valor, 'EX', ttl)
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
local completo = (conectados == #partida.roster)
local iniciou = false
if completo and partida.estado == 'preparada' and redis.call('EXISTS', KEYS[2]) == 1 then
  partida.estado = 'em_andamento'
  -- Marco autoritativo do início (epoch ms, issue #259): gravado no mesmo
  -- ponto atômico da virada para 'em_andamento' (ARGV[2]).
  partida.iniciadaEm = tonumber(ARGV[2])
  iniciou = true
end
local estadoAtual = partida.estado
if mudou or iniciou then
  local novo = cjson.encode(partida)
  if iniciou then
    -- ST-14: partida em_andamento persiste sem TTL (sem expiração) + cancela não-início 90s
    -- Histórico de chat da #388 vai junto quando existir (lista só nasce no
    -- primeiro RPUSH, então a ausência é o caso comum na virada).
    redis.call('SET', KEYS[1], novo)
    redis.call('PERSIST', KEYS[1])
    if redis.call('EXISTS', KEYS[2]) == 1 then
      redis.call('PERSIST', KEYS[2])
    end
    if redis.call('EXISTS', KEYS[3]) == 1 then
      redis.call('PERSIST', KEYS[3])
    end
  else
    salvarPreservandoTtl(KEYS[1], novo)
  end
end
return cjson.encode({mudou=mudou, completo=completo, iniciou=iniciou, estado=estadoAtual, iniciadaEm=partida.iniciadaEm or 0})
`.trim();

const SCRIPT_DESCONECTAR_PRESENCA = `
local function salvarPreservandoTtl(chave, valor)
  local ttl = redis.call('TTL', chave)
  if ttl == -2 then
    return
  elseif ttl == -1 then
    redis.call('SET', chave, valor)
  elseif ttl > 0 then
    redis.call('SET', chave, valor, 'EX', ttl)
  else
    redis.call('SET', chave, valor)
  end
end
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({mudou=false})
end
local ok, partida = pcall(cjson.decode, raw)
if not ok or not partida or not partida.roster then
  return cjson.encode({mudou=false})
end
local mudou = false
for i, m in ipairs(partida.roster) do
  if m.jogadorId == ARGV[1] then
    if m.presenca ~= 'em_reconexao' then
      m.presenca = 'em_reconexao'
      mudou = true
    end
  end
end
if mudou then
  salvarPreservandoTtl(KEYS[1], cjson.encode(partida))
end
return cjson.encode({mudou=mudou})
`.trim();

export async function marcarDesconexao(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
): Promise<void> {
  await redis.eval(SCRIPT_DESCONECTAR_PRESENCA, 1, chaveDaPartida(partidaId), jogadorId);
}

export async function transicionarSeCompletoOuAtualizarPresenca(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
  agora: number = Date.now(),
): Promise<ResultadoTransicaoDePresenca | null> {
  const bruto = await redis.eval(
    SCRIPT_TRANSICAO_PRESENCA,
    3,
    chaveDaPartida(partidaId),
    chaveDoEstadoDaPartida(partidaId),
    chaveDoChatDaPartida(partidaId),
    jogadorId,
    String(agora),
  );
  const json = typeof bruto === 'string' ? bruto : String(bruto ?? '');
  try {
    const parsed = JSON.parse(json) as ResultadoTransicaoDePresenca;
    if (parsed.estado !== 'preparada' && parsed.estado !== 'em_andamento') {
      return null;
    }
    if (parsed.iniciou) {
      cancelarNaoInicio(partidaId);
    }
    // Normalização defensiva: Partidas persistidas por binário anterior não
    // trazem o campo e o sentinela Lua é 0 — ambos viram null (#259).
    const iniciadaEm =
      typeof parsed.iniciadaEm === 'number' && parsed.iniciadaEm > 0
        ? parsed.iniciadaEm
        : null;
    return { ...parsed, iniciadaEm };
  } catch {
    return null;
  }
}
