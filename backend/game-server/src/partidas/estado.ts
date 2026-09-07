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

const TTL_NAO_EXISTE = -2;
const TTL_SEM_EXPIRACAO = -1;

const SCRIPT_APLICAR_RETENCAO_DE_TERMINO = `
local partidaExiste = redis.call('EXISTS', KEYS[1])
local estadoExiste = redis.call('EXISTS', KEYS[2])
if partidaExiste == 0 or estadoExiste == 0 then
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[2], ARGV[1])
return 1
`.trim();

import { chaveDaPartida, chaveDoEstadoDaPartida } from './chaves.ts';

export { chaveDaPartida, chaveDoEstadoDaPartida };

/**
 * Grava o estado inicial da partida no Redis com o TTL da partida preparada.
 * O domínio exige sucesso (roster com de 2 a 4 jogadores únicos); a falha
 * é propagada para o rollback em `criarPartidaPreparada`. `KEEPTTL` não é
 * usado aqui pois a chave ainda não existe.
 */
export async function inicializarEstadoDaPartida(
  redis: Redis,
  partidaId: string,
  ttlSegundos: number,
  jogadoresEmOrdem: readonly string[],
  seed?: number,
): Promise<void> {
  const resultado = estadoInicialDaPartida(
    jogadoresEmOrdem,
    seed === undefined ? undefined : { seed },
  );
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
 * sem TTL. Ao terminar, `aplicarRetencaoDeTermino` substitui esse estado
 * persistente por uma janela finita de retenção.
 */
export async function salvarEstadoDaPartida(
  redis: Redis,
  partidaId: string,
  estado: EstadoDaPartida,
): Promise<void> {
  const chave = chaveDoEstadoDaPartida(partidaId);
  const ttl = await redis.ttl(chave);
  if (ttl === TTL_NAO_EXISTE) {
    return;
  }
  if (ttl === TTL_SEM_EXPIRACAO) {
    await redis.set(chave, JSON.stringify(estado));
    return;
  }
  if (ttl > 0) {
    await redis.set(chave, JSON.stringify(estado), 'EX', ttl);
    return;
  }
  await redis.set(chave, JSON.stringify(estado));
}

/**
 * Aplica a política de retenção do término (issue #177): fixa um TTL finito
 * nas duas chaves da partida (metadados + estado) para que o resultado
 * sobreviva ao recarregamento dentro da janela, mas não viva para sempre
 * como o `PERSIST` do ST-14.
 */
export async function aplicarRetencaoDeTermino(
  redis: Redis,
  partidaId: string,
  ttlSegundos: number,
): Promise<void> {
  if (!Number.isInteger(ttlSegundos) || ttlSegundos <= 0) {
    throw new Error(`TTL de retenção inválido para a partida ${partidaId}`);
  }
  const aplicada = await redis.eval(
    SCRIPT_APLICAR_RETENCAO_DE_TERMINO,
    2,
    `game-server:partida:${partidaId}`,
    chaveDoEstadoDaPartida(partidaId),
    ttlSegundos,
  );
  if (Number(aplicada) !== 1) {
    console.warn('[estado] retenção negada — chave ausente', { partidaId, ttlSegundos });
    throw new Error(`Não foi possível aplicar a retenção da partida ${partidaId}: chave ausente`);
  }
}

/** Remove o estado da partida (usado no cancelamento da partida). */
export async function removerEstadoDaPartida(
  redis: Redis,
  partidaId: string,
): Promise<void> {
  await redis.del(chaveDoEstadoDaPartida(partidaId));
}
