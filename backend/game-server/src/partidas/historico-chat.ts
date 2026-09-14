// Histórico do chat de Partida em lista Redis própria (issue #388).
//
// Modelo: `game-server:partida-chat:<partidaId>` (lista, fora do blob de
// estado) com cap ~50 (humanas + bot somadas) e aparo no topo, mesmo ciclo de
// vida/TTL das chaves da Partida:
//   - nasce no primeiro RPUSH com EXPIRE espelhando o TTL restante da partida
//     (lista vazia não existe no Redis — preparada sem mensagens não tem chave);
//   - PERSIST em `em_andamento` (espelha o PERSIST da transição);
//   - EXPIRE com a retenção de término;
//   - DEL em cancelamento e não-início.
// Leitura via LRANGE 0..-1 (ordem oldest→newest, a ordem do fan-out live).
// Todas as escritas acontecem DENTRO da cadeia serial por Partida
// (`enfileirarMutacao` em handlers.ts), então não há corrida entre rajada de
// bot e snapshot de Reconexão.

import type { Redis } from 'ioredis';
import type { MensagemDeChatDaPartidaEvento } from '@flicker/shared';
import { chaveDaPartida, chaveDoChatDaPartida } from './chaves.ts';

export const HISTORICO_DE_CHAT_MAXIMO_PADRAO = 50;

const TTL_NAO_EXISTE = -2;
const TTL_SEM_EXPIRACAO = -1;

function normalizarMaximo(maximo: number | undefined): number {
  if (maximo === undefined) {
    return HISTORICO_DE_CHAT_MAXIMO_PADRAO;
  }
  if (Number.isInteger(maximo) && maximo >= 1) {
    return maximo;
  }
  return HISTORICO_DE_CHAT_MAXIMO_PADRAO;
}

/**
 * Persiste uma mensagem aprovada (humana ou bot) no histórico, aparando o topo
 * para o teto e espelhando o TTL restante da Partida na lista.
 * Falhas de Redis são propagadas — o chamador (handlers.ts) as trata como warn
 * sem recusar o live.
 */
export async function adicionarMensagemAoHistorico(
  redis: Redis,
  partidaId: string,
  mensagem: MensagemDeChatDaPartidaEvento,
  maximo?: number,
): Promise<void> {
  const teto = normalizarMaximo(maximo);
  const chaveChat = chaveDoChatDaPartida(partidaId);
  await redis.rpush(chaveChat, JSON.stringify(mensagem));
  // Mantém as `teto` mais novas (aparo no topo/oldest): RPUSH anexa no tail,
  // então LTRIM -teto..-1 preserva o sufixo newest na ordem oldest→newest.
  await redis.ltrim(chaveChat, -teto, -1);
  // Espelha o ciclo/TTL da Partida (preparada com EXPIRE, em_andamento com
  // PERSIST, término com EXPIRE de retenção).
  const ttl = await redis.ttl(chaveDaPartida(partidaId));
  if (ttl === TTL_NAO_EXISTE) {
    // Partida sumiu entre o julgamento e a escrita — evita órfão sem TTL.
    await redis.del(chaveChat);
    return;
  }
  if (ttl === TTL_SEM_EXPIRACAO) {
    await redis.persist(chaveChat);
    return;
  }
  if (ttl > 0) {
    await redis.expire(chaveChat, ttl);
    return;
  }
  await redis.persist(chaveChat);
}

/** Lê o histórico na ordem oldest→newest; `[]` quando a lista não existe. */
export async function obterHistoricoDoChat(
  redis: Redis,
  partidaId: string,
): Promise<MensagemDeChatDaPartidaEvento[]> {
  const brutos = await redis.lrange(chaveDoChatDaPartida(partidaId), 0, -1);
  const historico: MensagemDeChatDaPartidaEvento[] = [];
  for (const bruto of brutos) {
    try {
      historico.push(JSON.parse(bruto) as MensagemDeChatDaPartidaEvento);
    } catch {
      // Entrada corrompida: ignora sem quebrar o snapshot.
    }
  }
  return historico;
}

/** Remove o histórico (cancelamento e não-início). */
export async function removerHistoricoDoChat(redis: Redis, partidaId: string): Promise<void> {
  await redis.del(chaveDoChatDaPartida(partidaId));
}
